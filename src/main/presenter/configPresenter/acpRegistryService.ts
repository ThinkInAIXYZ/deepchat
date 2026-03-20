import fs from 'fs'
import path from 'path'
import { app } from 'electron'
import type {
  AcpRegistryAgent,
  AcpRegistryBinaryDistribution,
  AcpRegistryDistribution,
  AcpRegistryPackageDistribution
} from '@shared/presenter'
import {
  ACP_REGISTRY_CACHE_TTL_MS,
  ACP_REGISTRY_RESOURCE_PATH,
  ACP_REGISTRY_URL
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

  return {
    archive,
    cmd,
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
  private manifest: RegistryManifest | null = null

  constructor() {
    const userDataPath = app.getPath('userData')
    this.cacheDir = path.join(userDataPath, 'acp-registry')
    this.cacheFilePath = path.join(this.cacheDir, 'registry.json')
    this.metaFilePath = path.join(this.cacheDir, 'meta.json')

    try {
      if (!fs.existsSync(this.cacheDir)) {
        fs.mkdirSync(this.cacheDir, { recursive: true })
      }
    } catch (error) {
      console.warn('[ACP Registry] Failed to create cache directory:', error)
    }
  }

  async initialize(): Promise<void> {
    this.manifest = this.loadFromBuiltIn() ?? this.loadFromCache()
    const cached = this.loadFromCache()
    if (cached) {
      this.manifest = cached
    }

    await this.refreshIfNeeded(false)
  }

  listAgents(): AcpRegistryAgent[] {
    return clone(this.getManifest().agents)
  }

  getAgent(agentId: string): AcpRegistryAgent | null {
    const agent = this.getManifest().agents.find((item) => item.id === agentId)
    return agent ? clone(agent) : null
  }

  async refresh(force = false): Promise<AcpRegistryAgent[]> {
    await this.refreshIfNeeded(force)
    return this.listAgents()
  }

  private getManifest(): RegistryManifest {
    if (this.manifest) {
      return this.manifest
    }

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
    const candidatePaths = [
      path.join(app.getAppPath(), ...ACP_REGISTRY_RESOURCE_PATH),
      path.join(process.cwd(), ...ACP_REGISTRY_RESOURCE_PATH)
    ]

    for (const candidate of candidatePaths) {
      try {
        if (!fs.existsSync(candidate)) {
          continue
        }
        const parsed = JSON.parse(fs.readFileSync(candidate, 'utf-8'))
        const normalized = normalizeManifest(parsed)
        if (normalized) {
          return normalized
        }
      } catch (error) {
        console.warn('[ACP Registry] Failed to load built-in snapshot:', candidate, error)
      }
    }

    return null
  }

  private async refreshIfNeeded(force: boolean): Promise<void> {
    const meta = this.readMeta()
    const now = Date.now()
    const expired = !meta || now - meta.lastUpdated > ACP_REGISTRY_CACHE_TTL_MS

    if (!force && !expired && this.manifest) {
      return
    }

    await this.fetchAndCache(meta)
  }

  private async fetchAndCache(previousMeta: RegistryCacheMeta | null): Promise<void> {
    const now = Date.now()
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), 15000)

    try {
      const response = await fetch(ACP_REGISTRY_URL, {
        signal: controller.signal
      })

      if (!response.ok) {
        if (previousMeta) {
          this.writeMeta({ ...previousMeta, lastAttemptedAt: now })
        }
        return
      }

      const text = await response.text()
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
      if (previousMeta) {
        this.writeMeta({ ...previousMeta, lastAttemptedAt: now })
      }
      console.warn('[ACP Registry] Failed to refresh registry manifest:', error)
    } finally {
      clearTimeout(timeout)
    }
  }
}
