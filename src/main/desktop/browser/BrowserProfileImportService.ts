import { createDecipheriv, createHash, pbkdf2Sync } from 'crypto'
import { execFile } from 'child_process'
import { chmod, mkdtemp, readFile, readdir, rm, stat } from 'fs/promises'
import { homedir, tmpdir } from 'os'
import { join } from 'path'
import { promisify } from 'util'
import type { CookiesSetDetails, Session } from 'electron'
import Database from 'better-sqlite3-multiple-ciphers'
import { nanoid } from 'nanoid'
import type {
  BrowserImportApplyResult,
  BrowserImportPreview,
  BrowserImportProfile,
  BrowserImportScanResult
} from '@shared/types/browser'

const execFileAsync = promisify(execFile)
const STAGE_TTL_MS = 5 * 60 * 1000
const CHROME_EPOCH_OFFSET_SECONDS = 11_644_473_600

type BrowserSource = {
  id: BrowserImportProfile['browser']
  name: string
  userDataDirectory: string
  keychainService: string
}

const BROWSER_SOURCES: BrowserSource[] = [
  {
    id: 'chrome',
    name: 'Google Chrome',
    userDataDirectory: join(homedir(), 'Library', 'Application Support', 'Google', 'Chrome'),
    keychainService: 'Chrome Safe Storage'
  },
  {
    id: 'arc',
    name: 'Arc',
    userDataDirectory: join(homedir(), 'Library', 'Application Support', 'Arc', 'User Data'),
    keychainService: 'Arc Safe Storage'
  }
]

type ChromeCookieRow = {
  host_key: string
  top_frame_site_key: string
  name: string
  value: string
  encrypted_value: Buffer
  path: string
  expires_utc: number
  is_secure: number
  is_httponly: number
  samesite: number
}

type DiscoveredProfile = BrowserImportProfile & {
  source: BrowserSource
  directoryName: string
  cookiePath: string
}

type StagedImport = {
  createdAt: number
  profile: DiscoveredProfile
  sourceSize: number
  sourceMtimeMs: number
  cookies: CookiesSetDetails[]
  skippedExpired: number
  skippedPartitioned: number
}

export class BrowserProfileImportService {
  private readonly stagedImports = new Map<string, StagedImport>()
  private readonly stageExpiryTimers = new Map<string, NodeJS.Timeout>()
  private applying = false

  constructor(
    private readonly getTargetSession: () => Session,
    private readonly getTargetUnpartitionedCookies: () => Promise<CookiesSetDetails[]>,
    private readonly platform: NodeJS.Platform = process.platform
  ) {}

  async scan(): Promise<BrowserImportScanResult> {
    if (this.platform !== 'darwin') {
      return {
        platformSupported: false,
        profiles: [],
        reason: 'platform_unsupported'
      }
    }

    const profiles = await this.discoverChromeProfiles()
    return {
      platformSupported: true,
      profiles: profiles.map(this.toPublicProfile),
      ...(profiles.length === 0 ? { reason: 'browser_not_found' as const } : {})
    }
  }

  async preview(profileId: string): Promise<BrowserImportPreview> {
    if (this.platform !== 'darwin') {
      throw new Error('browser_import_platform_unsupported')
    }
    this.removeExpiredStages()
    const profile = (await this.discoverChromeProfiles()).find((item) => item.id === profileId)
    if (!profile || !profile.supported) {
      throw new Error('browser_import_profile_unavailable')
    }

    const sourceStat = await stat(profile.cookiePath)
    const password = await this.readSafeStoragePassword(profile.source.keychainService)
    const temporaryDirectory = await mkdtemp(join(tmpdir(), 'deepchat-browser-import-'))
    await chmod(temporaryDirectory, 0o700)
    const snapshotPath = join(temporaryDirectory, 'Cookies')

    try {
      const sourceDatabase = new Database(profile.cookiePath, {
        readonly: true,
        fileMustExist: true
      })
      try {
        await sourceDatabase.backup(snapshotPath)
      } finally {
        sourceDatabase.close()
      }

      const decoded = this.readCookieSnapshot(snapshotPath, password)
      const token = nanoid(24)
      this.stagedImports.set(token, {
        createdAt: Date.now(),
        profile,
        sourceSize: sourceStat.size,
        sourceMtimeMs: sourceStat.mtimeMs,
        cookies: decoded.cookies,
        skippedExpired: decoded.skippedExpired,
        skippedPartitioned: decoded.skippedPartitioned
      })
      const expiryTimer = setTimeout(() => this.deleteStage(token), STAGE_TTL_MS)
      expiryTimer.unref()
      this.stageExpiryTimers.set(token, expiryTimer)

      return {
        token,
        profile: this.toPublicProfile(profile),
        cookieCount: decoded.cookies.length,
        skippedExpired: decoded.skippedExpired,
        skippedPartitioned: decoded.skippedPartitioned
      }
    } finally {
      password.fill(0)
      await rm(temporaryDirectory, { recursive: true, force: true })
    }
  }

  async apply(token: string): Promise<BrowserImportApplyResult> {
    if (this.applying) {
      throw new Error('browser_import_already_running')
    }

    this.removeExpiredStages()
    const staged = this.stagedImports.get(token)
    if (!staged) {
      throw new Error('browser_import_preview_expired')
    }

    const sourceStat = await stat(staged.profile.cookiePath)
    if (sourceStat.size !== staged.sourceSize || sourceStat.mtimeMs !== staged.sourceMtimeMs) {
      this.deleteStage(token)
      throw new Error('browser_import_source_changed')
    }

    this.applying = true
    try {
      const target = this.getTargetSession()
      const rollbackCookies = await this.getTargetUnpartitionedCookies()

      try {
        await this.removeCookies(target, rollbackCookies)
        await this.setCookies(target, staged.cookies)
        await target.cookies.flushStore()
        await this.verifyCookies(staged.cookies)
      } catch (error) {
        await this.removeCookies(target, await this.getTargetUnpartitionedCookies())
        await this.setCookies(target, rollbackCookies)
        await target.cookies.flushStore()
        throw error
      }
    } finally {
      this.deleteStage(token)
      this.applying = false
    }

    return {
      importedCookies: staged.cookies.length,
      skippedExpired: staged.skippedExpired,
      skippedPartitioned: staged.skippedPartitioned,
      syncedAt: Date.now()
    }
  }

  private async discoverChromeProfiles(): Promise<DiscoveredProfile[]> {
    const profiles: DiscoveredProfile[] = []
    for (const source of BROWSER_SOURCES) {
      let entries: Array<{ name: string; isDirectory(): boolean }>
      try {
        entries = await readdir(source.userDataDirectory, { withFileTypes: true })
      } catch {
        continue
      }

      const profileNames = await this.readProfileNames(source)
      for (const entry of entries) {
        if (!entry.isDirectory() || !/^(Default|Profile \d+)$/.test(entry.name)) {
          continue
        }

        const profileDirectory = join(source.userDataDirectory, entry.name)
        const networkCookiePath = join(profileDirectory, 'Network', 'Cookies')
        const legacyCookiePath = join(profileDirectory, 'Cookies')
        const cookiePath = await this.firstExistingPath([networkCookiePath, legacyCookiePath])
        if (!cookiePath) {
          continue
        }

        profiles.push({
          id: `${source.id}:${entry.name}`,
          browser: source.id,
          browserName: source.name,
          profileName: profileNames.get(entry.name) || entry.name,
          supported: true,
          source,
          directoryName: entry.name,
          cookiePath
        })
      }
    }

    return profiles.sort((left, right) => left.id.localeCompare(right.id))
  }

  private async readProfileNames(source: BrowserSource): Promise<Map<string, string>> {
    const result = new Map<string, string>()
    try {
      const contents = await readFile(join(source.userDataDirectory, 'Local State'), 'utf8')
      const parsed = JSON.parse(contents) as {
        profile?: { info_cache?: Record<string, { name?: unknown }> }
      }
      for (const [directoryName, value] of Object.entries(parsed.profile?.info_cache ?? {})) {
        if (typeof value.name === 'string' && value.name.trim()) {
          result.set(directoryName, value.name.trim())
        }
      }
    } catch {
      // Directory names remain usable when Local State is absent or malformed.
    }
    return result
  }

  private async firstExistingPath(paths: string[]): Promise<string | null> {
    for (const path of paths) {
      try {
        if ((await stat(path)).isFile()) {
          return path
        }
      } catch {
        // Continue to the next known path.
      }
    }
    return null
  }

  private async readSafeStoragePassword(keychainService: string): Promise<Buffer> {
    try {
      const { stdout } = await execFileAsync('/usr/bin/security', [
        'find-generic-password',
        '-w',
        '-s',
        keychainService
      ])
      const password = stdout.trim()
      if (!password) {
        throw new Error('empty keychain result')
      }
      return Buffer.from(password, 'utf8')
    } catch {
      throw new Error('browser_import_key_access_denied')
    }
  }

  private readCookieSnapshot(
    snapshotPath: string,
    password: Buffer
  ): {
    cookies: CookiesSetDetails[]
    skippedExpired: number
    skippedPartitioned: number
  } {
    const database = new Database(snapshotPath, { readonly: true, fileMustExist: true })
    try {
      const integrity = database.pragma('integrity_check', { simple: true })
      if (integrity !== 'ok') {
        throw new Error('browser_import_source_snapshot_invalid')
      }

      const schemaVersion = Number(
        (
          database.prepare("SELECT value FROM meta WHERE key = 'version'").get() as
            | { value?: unknown }
            | undefined
        )?.value ?? 0
      )
      const cookieColumns = database.prepare('PRAGMA table_info(cookies)').all() as Array<{
        name: string
      }>
      const hasTopFrameSiteKey = cookieColumns.some(
        (column) => column.name === 'top_frame_site_key'
      )
      const rows = database
        .prepare(
          `SELECT host_key, ${hasTopFrameSiteKey ? 'top_frame_site_key' : "'' AS top_frame_site_key"}, name, value,
                  CAST(encrypted_value AS BLOB) AS encrypted_value,
                  path, expires_utc, is_secure, is_httponly, samesite
             FROM cookies`
        )
        .all() as ChromeCookieRow[]

      const key = pbkdf2Sync(password, 'saltysalt', 1003, 16, 'sha1')
      const cookies: CookiesSetDetails[] = []
      let skippedExpired = 0
      let skippedPartitioned = 0
      const nowSeconds = Date.now() / 1000

      try {
        for (const row of rows) {
          const expirationDate = this.chromeTimeToUnixSeconds(row.expires_utc)
          if (expirationDate !== undefined && expirationDate <= nowSeconds) {
            skippedExpired += 1
            continue
          }
          if (row.top_frame_site_key) {
            skippedPartitioned += 1
            continue
          }

          const value = row.value || this.decryptChromeCookie(row, key, schemaVersion)
          cookies.push(this.rowToCookieDetails(row, value, expirationDate))
        }
      } finally {
        key.fill(0)
      }

      return { cookies, skippedExpired, skippedPartitioned }
    } finally {
      database.close()
    }
  }

  private decryptChromeCookie(row: ChromeCookieRow, key: Buffer, schemaVersion: number): string {
    if (!Buffer.isBuffer(row.encrypted_value) || row.encrypted_value.length <= 3) {
      return ''
    }
    if (row.encrypted_value.subarray(0, 3).toString('ascii') !== 'v10') {
      throw new Error('browser_import_encryption_unsupported')
    }

    const decipher = createDecipheriv('aes-128-cbc', key, Buffer.alloc(16, 0x20))
    const plaintext = Buffer.concat([
      decipher.update(row.encrypted_value.subarray(3)),
      decipher.final()
    ])
    const value = schemaVersion >= 24 ? this.removeHostDigest(row.host_key, plaintext) : plaintext
    return value.toString('utf8')
  }

  private removeHostDigest(host: string, plaintext: Buffer): Buffer {
    if (plaintext.length < 32) {
      throw new Error('browser_import_cookie_digest_missing')
    }
    const expected = createHash('sha256').update(host).digest()
    if (!plaintext.subarray(0, 32).equals(expected)) {
      throw new Error('browser_import_cookie_digest_invalid')
    }
    return plaintext.subarray(32)
  }

  private rowToCookieDetails(
    row: ChromeCookieRow,
    value: string,
    expirationDate?: number
  ): CookiesSetDetails {
    const hostname = row.host_key.replace(/^\./, '')
    const secure = Boolean(row.is_secure)
    return {
      url: `${secure ? 'https' : 'http'}://${hostname}${row.path || '/'}`,
      name: row.name,
      value,
      path: row.path || '/',
      secure,
      httpOnly: Boolean(row.is_httponly),
      sameSite: this.toElectronSameSite(row.samesite),
      ...(row.host_key.startsWith('.') ? { domain: row.host_key } : {}),
      ...(expirationDate === undefined ? {} : { expirationDate })
    }
  }

  private chromeTimeToUnixSeconds(value: number): number | undefined {
    if (!Number.isFinite(value) || value <= 0) {
      return undefined
    }
    return value / 1_000_000 - CHROME_EPOCH_OFFSET_SECONDS
  }

  private toElectronSameSite(value: number): CookiesSetDetails['sameSite'] {
    if (value === 0) return 'no_restriction'
    if (value === 1) return 'lax'
    if (value === 2) return 'strict'
    return 'unspecified'
  }

  private async setCookies(target: Session, cookies: CookiesSetDetails[]): Promise<void> {
    const batchSize = 50
    for (let index = 0; index < cookies.length; index += batchSize) {
      await Promise.all(
        cookies.slice(index, index + batchSize).map((cookie) => target.cookies.set(cookie))
      )
    }
  }

  private async removeCookies(target: Session, cookies: CookiesSetDetails[]): Promise<void> {
    await this.setCookies(
      target,
      cookies.map((cookie) => ({
        ...cookie,
        value: '',
        expirationDate: 1
      }))
    )
  }

  private async verifyCookies(expected: CookiesSetDetails[]): Promise<void> {
    const actual = await this.getTargetUnpartitionedCookies()
    const actualValues = new Map(
      actual.map((cookie) => [
        `${cookie.domain ?? new URL(cookie.url).hostname}\u0000${cookie.path ?? '/'}\u0000${cookie.name}`,
        cookie.value
      ])
    )

    for (const cookie of expected) {
      const domain = cookie.domain ?? new URL(cookie.url).hostname
      const identity = `${domain}\u0000${cookie.path ?? '/'}\u0000${cookie.name}`
      if (actualValues.get(identity) !== cookie.value) {
        throw new Error('browser_import_verification_failed')
      }
    }
  }

  private removeExpiredStages(): void {
    const now = Date.now()
    for (const [token, staged] of this.stagedImports) {
      if (now - staged.createdAt > STAGE_TTL_MS) {
        this.deleteStage(token)
      }
    }
  }

  private deleteStage(token: string): void {
    this.stagedImports.delete(token)
    const timer = this.stageExpiryTimers.get(token)
    if (timer) clearTimeout(timer)
    this.stageExpiryTimers.delete(token)
  }

  private toPublicProfile(profile: DiscoveredProfile): BrowserImportProfile {
    return {
      id: profile.id,
      browser: profile.browser,
      browserName: profile.browserName,
      profileName: profile.profileName,
      supported: profile.supported,
      ...(profile.reason ? { reason: profile.reason } : {})
    }
  }
}
