import { mkdtemp, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createCipheriv, createHash, pbkdf2Sync } from 'node:crypto'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { Cookie, CookiesSetDetails, Session } from 'electron'
import { BrowserProfileImportService } from '@/desktop/browser/BrowserProfileImportService'

const temporaryDirectories: string[] = []

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((path) => rm(path, { recursive: true, force: true }))
  )
})

const createCookie = (details: CookiesSetDetails): Cookie => ({
  name: details.name,
  value: details.value,
  domain: details.domain ?? new URL(details.url).hostname,
  hostOnly: details.domain === undefined,
  path: details.path ?? '/',
  secure: details.secure ?? false,
  httpOnly: details.httpOnly ?? false,
  session: details.expirationDate === undefined,
  sameSite: details.sameSite ?? 'unspecified'
})

const createSession = (options?: { corruptImportedValue?: boolean }) => {
  let cookies: Cookie[] = [
    createCookie({
      url: 'https://old.example/',
      name: 'old',
      value: 'old-value'
    })
  ]
  const set = vi.fn(async (details: CookiesSetDetails) => {
    const nextCookie = createCookie({
      ...details,
      value: options?.corruptImportedValue && details.name === 'session' ? 'corrupt' : details.value
    })
    const identity = (cookie: Cookie) => `${cookie.domain}\0${cookie.path}\0${cookie.name}`
    cookies = cookies.filter((cookie) => identity(cookie) !== identity(nextCookie))
    if ((details.expirationDate ?? Number.POSITIVE_INFINITY) > Date.now() / 1000) {
      cookies.push(nextCookie)
    }
  })
  const target = {
    clearStorageData: vi.fn(),
    cookies: {
      get: vi.fn(async () => [...cookies]),
      set,
      flushStore: vi.fn(async () => undefined)
    }
  } as unknown as Session
  const readCookies = () => cookies
  const readUnpartitionedCookies = async () =>
    readCookies().map((cookie) => ({
      url: `${cookie.secure ? 'https' : 'http'}://${cookie.domain?.replace(/^\./, '')}${cookie.path}`,
      name: cookie.name,
      value: cookie.value,
      path: cookie.path,
      secure: cookie.secure,
      httpOnly: cookie.httpOnly,
      sameSite: cookie.sameSite,
      ...(cookie.hostOnly ? {} : { domain: cookie.domain }),
      ...(cookie.session ? {} : { expirationDate: cookie.expirationDate })
    }))
  return { target, readCookies, readUnpartitionedCookies }
}

const stageImport = async (service: BrowserProfileImportService) => {
  const directory = await mkdtemp(join(tmpdir(), 'deepchat-import-test-'))
  temporaryDirectories.push(directory)
  const cookiePath = join(directory, 'Cookies')
  await writeFile(cookiePath, 'snapshot')
  const sourceStat = await stat(cookiePath)

  const internals = service as unknown as {
    stagedImports: Map<string, unknown>
  }
  internals.stagedImports.set('preview-token', {
    createdAt: Date.now(),
    profile: {
      id: 'chrome:Default',
      browser: 'chrome',
      browserName: 'Google Chrome',
      profileName: 'Default',
      supported: true,
      source: {},
      directoryName: 'Default',
      cookiePath
    },
    sourceSize: sourceStat.size,
    sourceMtimeMs: sourceStat.mtimeMs,
    cookies: [
      {
        url: 'https://example.com/',
        name: 'session',
        value: 'session-value',
        path: '/',
        secure: true,
        httpOnly: true,
        sameSite: 'lax'
      }
    ],
    skippedExpired: 2,
    skippedPartitioned: 1
  })
}

describe('BrowserProfileImportService', () => {
  it('reports direct import as unsupported outside macOS', async () => {
    const service = new BrowserProfileImportService(
      () => ({}) as Session,
      async () => [],
      'win32'
    )

    await expect(service.scan()).resolves.toEqual({
      platformSupported: false,
      profiles: [],
      reason: 'platform_unsupported'
    })
  })

  it('decrypts a macOS Chromium v10 cookie with the schema host digest', () => {
    const service = new BrowserProfileImportService(
      () => ({}) as Session,
      async () => [],
      'darwin'
    )
    const host = '.example.com'
    const key = pbkdf2Sync('keychain-password', 'saltysalt', 1003, 16, 'sha1')
    const cipher = createCipheriv('aes-128-cbc', key, Buffer.alloc(16, 0x20))
    const plaintext = Buffer.concat([
      createHash('sha256').update(host).digest(),
      Buffer.from('session-value')
    ])
    const encryptedValue = Buffer.concat([
      Buffer.from('v10'),
      cipher.update(plaintext),
      cipher.final()
    ])

    const internals = service as unknown as {
      decryptChromeCookie(
        row: { host_key: string; encrypted_value: Buffer },
        key: Buffer,
        schemaVersion: number
      ): string
    }
    expect(
      internals.decryptChromeCookie({ host_key: host, encrypted_value: encryptedValue }, key, 24)
    ).toBe('session-value')
  })

  it('replaces target cookies and verifies the imported values', async () => {
    const { target, readCookies, readUnpartitionedCookies } = createSession()
    const service = new BrowserProfileImportService(
      () => target,
      readUnpartitionedCookies,
      'darwin'
    )
    await stageImport(service)

    await expect(service.apply('preview-token')).resolves.toMatchObject({
      importedCookies: 1,
      skippedExpired: 2,
      skippedPartitioned: 1
    })
    expect(readCookies()).toHaveLength(1)
    expect(readCookies()[0]).toMatchObject({ name: 'session', value: 'session-value' })
    expect(target.clearStorageData).not.toHaveBeenCalled()
  })

  it('restores target cookies when readback verification fails', async () => {
    const { target, readCookies, readUnpartitionedCookies } = createSession({
      corruptImportedValue: true
    })
    const service = new BrowserProfileImportService(
      () => target,
      readUnpartitionedCookies,
      'darwin'
    )
    await stageImport(service)

    await expect(service.apply('preview-token')).rejects.toThrow(
      'browser_import_verification_failed'
    )
    expect(readCookies()).toHaveLength(1)
    expect(readCookies()[0]).toMatchObject({ name: 'old', value: 'old-value' })
    expect(target.clearStorageData).not.toHaveBeenCalled()
  })
})
