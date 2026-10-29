import fs from 'fs'
import path from 'path'
import type { AcpRegistryAgent } from '@shared/types/acp'
import type {
  AcpRegistryBinaryDistribution,
  AcpRegistryDistribution,
  AcpRegistryPackageDistribution
} from '@shared/types/acp'
import { SVGSanitizer } from '@/lib/svgSanitizer'
import {
  ACP_REGISTRY_CACHE_TTL_MS,
  ACP_REGISTRY_ICON_CACHE_DIRNAME,
  ACP_REGISTRY_URL,
  getAcpRegistryIconFileName,
  isAcpRegistryIconUrl
} from './acpRegistryConstants'

type RegistryCacheMeta = {
  version?: string
  lastUpdated: number
  lastAttemptedAt?: number
  sourceUrl: string
}

type RegistryManifest = {
  version: string
  agents: AcpRegistryAgent[]
}

export type AcpRegistryServiceOptions = {
  userDataDirectory: string
  builtInDirectory: string
  fetchIcon: (url: string, signal: AbortSignal) => Promise<string>
  isPrivacyModeEnabled?: () => boolean
}

const SHA256_PATTERN = /^[a-f0-9]{64}$/i

const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T

const normalizeArgs = (value: unknown): string[] | undefined => {
  if (!Array.isArray(value)) {
    return undefined
  }

  const cleaned = value
    .map((item) => (typeof item === 'string' ? item.trim() : String(item).trim()))
    .filter((item) => item.length > 0)

  return cleaned.length > 0 ? cleaned : undefined
}

const normalizeEnv = (value: unknown): Record<string, string> | undefined => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return undefined
  }

  const entries = Object.entries(value)
    .map(([key, envValue]) => [
      key.trim(),
      typeof envValue === 'string' ? envValue : String(envValue)
    ])
    .filter(([key]) => key.length > 0)

  return entries.length > 0 ? Object.fromEntries(entries) : undefined
}

const normalizeBinaryTarget = (value: unknown): AcpRegistryBinaryDistribution | null => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return null
  }
  const record = value as Record<string, unknown>

  const archive = typeof record.archive === 'string' ? record.archive.trim() : ''
  const cmd = typeof record.cmd === 'string' ? record.cmd.trim() : ''
  if (!archive || !cmd) {
    return null
  }

  const rawSha256 = record.sha256
  const sha256 = typeof rawSha256 === 'string' ? rawSha256.trim().toLowerCase() : undefined
  if (rawSha256 !== undefined && (!sha256 || !SHA256_PATTERN.test(sha256))) {
    return null
  }

  return {
    archive,
    cmd,
    ...(sha256 ? { sha256 } : {}),
    args: normalizeArgs(record.args),
    env: normalizeEnv(record.env)
  }
}

const normalizePackageTarget = (value: unknown): AcpRegistryPackageDistribution | null => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return null
  }
  const record = value as Record<string, unknown>

  const pkg = typeof record.package === 'string' ? record.package.trim() : ''
  if (!pkg) {
    return null
  }

  return {
    package: pkg,
    args: normalizeArgs(record.args),
    env: normalizeEnv(record.env)
  }
}

const normalizeDistribution = (value: unknown): AcpRegistryDistribution | null => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return null
  }
  const record = value as Record<string, unknown>

  const binaryTargets = record.binary
  const normalizedBinary: Record<string, AcpRegistryBinaryDistribution> = {}
  if (binaryTargets && typeof binaryTargets === 'object' && !Array.isArray(binaryTargets)) {
    Object.entries(binaryTargets).forEach(([target, config]) => {
      const normalized = normalizeBinaryTarget(config)
      if (normalized) {
        normalizedBinary[target] = normalized
      }
    })
  }

  const npx = normalizePackageTarget(record.npx)
  const uvx = normalizePackageTarget(record.uvx)

  if (!Object.keys(normalizedBinary).length && !npx && !uvx) {
    return null
  }

  return {
    binary: Object.keys(normalizedBinary).length ? normalizedBinary : undefined,
    npx: npx ?? undefined,
    uvx: uvx ?? undefined
  }
}

const normalizeAgent = (value: unknown): AcpRegistryAgent | null => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return null
  }
  const record = value as Record<string, unknown>

  const id = typeof record.id === 'string' ? record.id.trim() : ''
  const name = typeof record.name === 'string' ? record.name.trim() : ''
  const version = typeof record.version === 'string' ? record.version.trim() : ''
  const distribution = normalizeDistribution(record.distribution)

  if (!id || !name || !version || !distribution) {
    return null
  }

  return {
    id,
    name,
    version,
    description: typeof record.description === 'string' ? record.description.trim() : undefined,
    repository: typeof record.repository === 'string' ? record.repository.trim() : undefined,
    website: typeof record.website === 'string' ? record.website.trim() : undefined,
    authors: Array.isArray(record.authors)
      ? record.authors
          .map((author) => (typeof author === 'string' ? author.trim() : String(author).trim()))
          .filter((author) => author.length > 0)
      : undefined,
    license: typeof record.license === 'string' ? record.license.trim() : undefined,
    icon: typeof record.icon === 'string' ? record.icon.trim() : undefined,
    distribution,
    source: 'registry',
    enabled: false,
    envOverride: undefined,
    installState: null
  }
}

const normalizeManifest = (value: unknown): RegistryManifest | null => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return null
  }
  const record = value as Record<string, unknown>

  const version = typeof record.version === 'string' ? record.version.trim() : ''
  const rawAgents = Array.isArray(record.agents) ? record.agents : []
  const agents = rawAgents
    .map((agent) => normalizeAgent(agent))
    .filter((agent): agent is AcpRegistryAgent => Boolean(agent))
  const agentIds = new Set<string>()

  for (const agent of agents) {
    if (agentIds.has(agent.id)) {
      return null
    }
    agentIds.add(agent.id)
  }

  if (!version || agents.length === 0) {
    return null
  }

  return {
    version,
    agents
  }
}

export class AcpRegistryService {
  private readonly cacheDir: string
  private readonly cacheFilePath: string
  private readonly metaFilePath: string
  private readonly iconCacheDir: string
  private readonly svgSanitizer = new SVGSanitizer()
  private readonly iconMarkupCache = new Map<string, Promise<string | null>>()
  private readonly isPrivacyModeEnabled: () => boolean
  private manifest: RegistryManifest | null = null
  private readonly stopController = new AbortController()
  private refreshPromise: Promise<void> | null = null

  constructor(private readonly options: AcpRegistryServiceOptions) {
    if (!path.isAbsolute(options.userDataDirectory) || !path.isAbsolute(options.builtInDirectory)) {
      throw new Error('ACP registry directories must be absolute')
    }
    this.isPrivacyModeEnabled = options.isPrivacyModeEnabled ?? (() => false)
    this.cacheDir = path.join(options.userDataDirectory, 'acp-registry')
    this.cacheFilePath = path.join(this.cacheDir, 'registry.json')
    this.metaFilePath = path.join(this.cacheDir, 'meta.json')
    this.iconCacheDir = path.join(this.cacheDir, ACP_REGISTRY_ICON_CACHE_DIRNAME)

    try {
      fs.mkdirSync(this.cacheDir, { recursive: true })
      fs.mkdirSync(this.iconCacheDir, { recursive: true })
    } catch (error) {
      console.warn('[ACP Registry] Failed to create cache directory:', error)
    }
  }

  initialize(): void {
    if (this.stopController.signal.aborted) return
    this.manifest = this.loadFromBuiltIn() ?? this.loadFromCache()
    const cached = this.loadFromCache()
    if (cached) {
      this.manifest = cached
    }
  }

  stop(): void {
    this.stopController.abort()
  }

  get isStopped(): boolean {
    return this.stopController.signal.aborted
  }

  async drain(): Promise<void> {
    await Promise.allSettled([this.refreshPromise])
  }

  listAgents(): AcpRegistryAgent[] {
    return clone(this.getManifest().agents)
  }

  getAgent(agentId: string): AcpRegistryAgent | null {
    const agent = this.getManifest().agents.find((item) => item.id === agentId)
    return agent ? clone(agent) : null
  }

  async refresh(
    force = false,
    options: { automatic?: boolean; signal?: AbortSignal } = {}
  ): Promise<AcpRegistryAgent[]> {
    await this.refreshIfNeeded(force, options)
    return this.listAgents()
  }

  async getIconMarkup(agentId: string, iconUrl?: string): Promise<string | null> {
    const normalizedAgentId = agentId.trim()
    const normalizedIconUrl = iconUrl?.trim()
    if (!normalizedAgentId) {
      return null
    }

    if (this.stopController.signal.aborted) return null

    if (normalizedIconUrl && !isAcpRegistryIconUrl(normalizedIconUrl)) {
      return null
    }

    let pending = this.iconMarkupCache.get(normalizedAgentId)
    if (!pending) {
      pending = this.loadIconMarkupFromDisk(normalizedAgentId).catch((error) => {
        this.iconMarkupCache.delete(normalizedAgentId)
        console.warn('[ACP Registry] Failed to load icon markup:', normalizedAgentId, error)
        return null
      })
      this.iconMarkupCache.set(normalizedAgentId, pending)
    }

    const markup = await pending
    return this.stopController.signal.aborted ? null : markup
  }

  private getManifest(): RegistryManifest {
    if (this.manifest) {
      return this.manifest
    }
    this.stopController.signal.throwIfAborted()

    this.manifest = this.loadFromCache() ?? this.loadFromBuiltIn()
    if (!this.manifest) {
      throw new Error('[ACP Registry] No registry snapshot is available.')
    }
    return this.manifest
  }

  private readMeta(): RegistryCacheMeta | null {
    try {
      if (!fs.existsSync(this.metaFilePath)) {
        return null
      }
      return JSON.parse(fs.readFileSync(this.metaFilePath, 'utf-8')) as RegistryCacheMeta
    } catch {
      return null
    }
  }

  private writeMeta(meta: RegistryCacheMeta): void {
    try {
      fs.writeFileSync(this.metaFilePath, JSON.stringify(meta, null, 2), 'utf-8')
    } catch (error) {
      console.warn('[ACP Registry] Failed to write cache meta:', error)
    }
  }

  private loadFromCache(): RegistryManifest | null {
    try {
      if (!fs.existsSync(this.cacheFilePath)) {
        return null
      }
      const parsed = JSON.parse(fs.readFileSync(this.cacheFilePath, 'utf-8'))
      return normalizeManifest(parsed)
    } catch {
      return null
    }
  }

  private loadFromBuiltIn(): RegistryManifest | null {
    const file = path.join(this.options.builtInDirectory, 'registry.json')
    try {
      if (!fs.existsSync(file)) return null
      return normalizeManifest(JSON.parse(fs.readFileSync(file, 'utf-8')))
    } catch (error) {
      console.warn('[ACP Registry] Failed to load built-in snapshot:', file, error)
    }
    return null
  }

  private async refreshIfNeeded(
    force: boolean,
    options: {
      automatic?: boolean
      signal?: AbortSignal
    } = {}
  ): Promise<void> {
    this.stopController.signal.throwIfAborted()
    options.signal?.throwIfAborted()
    if (options.automatic && this.isAutomaticRefreshBlocked()) {
      return
    }

    if (this.refreshPromise) return this.refreshPromise

    const meta = this.readMeta()
    const now = Date.now()
    const expired = !meta || now - meta.lastUpdated > ACP_REGISTRY_CACHE_TTL_MS

    if (!force && !expired && this.manifest) {
      return
    }

    this.refreshPromise = this.fetchAndCache(meta, options.signal).finally(() => {
      this.refreshPromise = null
    })
    await this.refreshPromise
  }

  private isAutomaticRefreshBlocked(): boolean {
    try {
      return Boolean(this.isPrivacyModeEnabled())
    } catch {
      return false
    }
  }

  private async fetchAndCache(
    previousMeta: RegistryCacheMeta | null,
    callerSignal?: AbortSignal
  ): Promise<void> {
    const now = Date.now()
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), 15000)
    const signal = AbortSignal.any([
      this.stopController.signal,
      controller.signal,
      ...(callerSignal ? [callerSignal] : [])
    ])
    const assertCurrent = () => {
      this.stopController.signal.throwIfAborted()
      callerSignal?.throwIfAborted()
    }

    try {
      const response = await fetch(ACP_REGISTRY_URL, {
        signal
      })
      assertCurrent()

      if (!response.ok) {
        if (previousMeta) {
          this.writeMeta({ ...previousMeta, lastAttemptedAt: now })
        }
        return
      }

      const text = await response.text()
      assertCurrent()
      if (!text || text.length > 5 * 1024 * 1024) {
        if (previousMeta) {
          this.writeMeta({ ...previousMeta, lastAttemptedAt: now })
        }
        return
      }

      const normalized = normalizeManifest(JSON.parse(text))
      if (!normalized) {
        if (previousMeta) {
          this.writeMeta({ ...previousMeta, lastAttemptedAt: now })
        }
        return
      }

      try {
        await this.syncIconCache(normalized, signal)
      } catch (error) {
        assertCurrent()
        console.warn('[ACP Registry] Failed to sync icon cache after manifest refresh:', error)
      }
      assertCurrent()

      const tmpPath = `${this.cacheFilePath}.tmp`
      fs.writeFileSync(tmpPath, JSON.stringify(normalized, null, 2), 'utf-8')
      fs.renameSync(tmpPath, this.cacheFilePath)

      this.writeMeta({
        version: normalized.version,
        lastUpdated: now,
        lastAttemptedAt: now,
        sourceUrl: ACP_REGISTRY_URL
      })

      this.manifest = normalized
    } catch (error) {
      assertCurrent()
      if (previousMeta) {
        this.writeMeta({ ...previousMeta, lastAttemptedAt: now })
      }
      console.warn('[ACP Registry] Failed to refresh registry manifest:', error)
    } finally {
      clearTimeout(timeout)
    }
  }

  private getCachedIconPath(agentId: string): string {
    return path.join(this.iconCacheDir, getAcpRegistryIconFileName(agentId))
  }

  private resolveLocalIconPath(agentId: string): string | null {
    const cachedPath = this.getCachedIconPath(agentId)
    if (fs.existsSync(cachedPath)) {
      return cachedPath
    }

    const builtInPath = path.join(
      this.options.builtInDirectory,
      ACP_REGISTRY_ICON_CACHE_DIRNAME,
      getAcpRegistryIconFileName(agentId)
    )
    return fs.existsSync(builtInPath) ? builtInPath : null
  }

  private async loadIconMarkupFromDisk(agentId: string): Promise<string | null> {
    const iconPath = this.resolveLocalIconPath(agentId)
    if (!iconPath) {
      return null
    }

    try {
      const content = await fs.promises.readFile(iconPath, 'utf-8')
      const sanitized = this.svgSanitizer.sanitize(content)
      if (!sanitized) {
        return null
      }
      return this.decorateIconMarkup(sanitized)
    } catch (error) {
      console.warn('[ACP Registry] Failed to read icon from disk:', iconPath, error)
      return null
    }
  }

  private async syncIconCache(manifest: RegistryManifest, signal: AbortSignal): Promise<void> {
    signal.throwIfAborted()
    fs.mkdirSync(this.iconCacheDir, { recursive: true })

    const cacheableAgents = manifest.agents.filter(
      (agent) => agent.icon && isAcpRegistryIconUrl(agent.icon.trim())
    )
    const expectedAgentIds = new Set(cacheableAgents.map((agent) => agent.id))

    await Promise.allSettled(cacheableAgents.map((agent) => this.syncAgentIcon(agent, signal)))
    signal.throwIfAborted()
    this.pruneStaleIconCache(expectedAgentIds)
    this.iconMarkupCache.clear()
  }

  private async syncAgentIcon(agent: AcpRegistryAgent, refreshSignal: AbortSignal): Promise<void> {
    const iconUrl = agent.icon?.trim()
    if (!iconUrl || !isAcpRegistryIconUrl(iconUrl)) {
      return
    }

    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), 10000)
    const signal = AbortSignal.any([refreshSignal, controller.signal])

    try {
      const text = await this.options.fetchIcon(iconUrl, signal)
      signal.throwIfAborted()
      const sanitized = this.svgSanitizer.sanitize(text)
      if (!sanitized) {
        throw new Error(`Failed to sanitize icon for agent ${agent.id}`)
      }

      const iconPath = this.getCachedIconPath(agent.id)
      const tmpPath = `${iconPath}.tmp`
      fs.writeFileSync(tmpPath, sanitized, 'utf-8')
      fs.renameSync(tmpPath, iconPath)
    } finally {
      clearTimeout(timeout)
    }
  }

  private pruneStaleIconCache(expectedAgentIds: Set<string>): void {
    try {
      const files = fs.readdirSync(this.iconCacheDir)
      for (const file of files) {
        if (!file.endsWith('.svg')) {
          continue
        }

        const agentId = file.slice(0, -4)
        if (expectedAgentIds.has(agentId)) {
          continue
        }

        fs.rmSync(path.join(this.iconCacheDir, file), { force: true })
      }
    } catch (error) {
      console.warn('[ACP Registry] Failed to prune stale icon cache:', error)
    }
  }

  private decorateIconMarkup(markup: string): string {
    return markup.replace(/<svg\b([^>]*)>/i, (_match, attrs: string) => {
      let nextAttrs = attrs

      if (!/\sfocusable\s*=/.test(nextAttrs)) {
        nextAttrs += ' focusable="false"'
      }

      if (!/\saria-hidden\s*=/.test(nextAttrs)) {
        nextAttrs += ' aria-hidden="true"'
      }

      if (!/\scolor\s*=/.test(nextAttrs)) {
        nextAttrs += ' color="currentColor"'
      }

      if (/\sstyle\s*=\s*["'][^"']*["']/i.test(nextAttrs)) {
        nextAttrs = nextAttrs.replace(
          /\sstyle\s*=\s*(["'])([^"']*)\1/i,
          (_styleMatch, quote: string, styleValue: string) =>
            ` style=${quote}color: currentColor; ${styleValue}${quote}`
        )
      } else {
        nextAttrs += ' style="color: currentColor;"'
      }

      return `<svg${nextAttrs}>`
    })
  }
}
