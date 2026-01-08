import crypto from 'crypto'
import fs from 'fs/promises'
import path from 'path'
import { app } from 'electron'

export type ContextKind = 'artifact' | 'history' | 'catalog'

export type ContextRef = {
  id: string
  kind: ContextKind
  mimeType?: string
  byteSize?: number
  createdAt: number
  hint: string
}

export type ContextRefStrategy = 'eager' | 'lazy'

export type ContextSource = {
  type: string
  payload: Record<string, unknown>
}

export type ContextManifestEntry = ContextRef & {
  path: string
  strategy: ContextRefStrategy
  source?: ContextSource
}

export type ContextManifest = {
  version: 1
  items: ContextManifestEntry[]
}

export type ContextMaterializer = (
  entry: ContextManifestEntry,
  targetPath: string
) => Promise<{
  content?: string | Buffer
  mimeType?: string
  byteSize?: number
} | void>

type CreateRefParams = {
  conversationId: string
  kind: ContextKind
  hint: string
  mimeType?: string
  strategy?: ContextRefStrategy
  source?: ContextSource
  id?: string
}

const KIND_DIRS: Record<ContextKind, string> = {
  artifact: 'artifacts',
  history: 'history',
  catalog: 'catalog'
}

const EXTENSION_MAP: Record<string, string> = {
  'application/json': '.json',
  'text/json': '.json',
  'text/markdown': '.md',
  'text/plain': '.txt',
  'text/html': '.html',
  'application/xml': '.xml',
  'text/xml': '.xml',
  'application/yaml': '.yaml',
  'text/yaml': '.yaml',
  'text/csv': '.csv'
}

const MANIFEST_FILE = 'manifest.json'

export class ContextStore {
  private readonly rootPath: string
  private readonly materializers: Record<string, ContextMaterializer>

  constructor(options?: {
    rootPath?: string
    materializers?: Record<string, ContextMaterializer>
  }) {
    this.rootPath = options?.rootPath ?? path.join(app.getPath('userData'), 'context')
    this.materializers = options?.materializers ?? {}
  }

  getContextRoot(): string {
    return this.rootPath
  }

  getConversationRoot(conversationId: string): string {
    return path.join(this.rootPath, this.ensureSafeSegment(conversationId))
  }

  async createRef(params: CreateRefParams): Promise<{ ref: ContextRef; path: string }> {
    const conversationRoot = await this.ensureConversationDirs(params.conversationId)
    const id = params.id || crypto.randomUUID()
    const createdAt = Date.now()
    const hint = params.hint.trim() || 'Context file'
    const extension = this.resolveExtension(params.mimeType)
    const relativePath = path.posix.join(KIND_DIRS[params.kind], `${id}${extension}`)
    const filePath = path.join(conversationRoot, relativePath)

    const entry: ContextManifestEntry = {
      id,
      kind: params.kind,
      hint,
      createdAt,
      mimeType: params.mimeType,
      path: relativePath,
      strategy: params.strategy ?? 'eager',
      source: params.source
    }

    if (entry.strategy === 'eager') {
      await fs.writeFile(filePath, '', 'utf-8')
    }

    const manifest = await this.loadManifest(params.conversationId)
    manifest.items.push(entry)
    await this.saveManifest(params.conversationId, manifest)

    return { ref: this.toRef(entry), path: filePath }
  }

  async write(conversationId: string, refId: string, content: string | Buffer): Promise<void> {
    const { manifest, entry } = await this.getEntry(conversationId, refId)
    const filePath = await this.ensureMaterialized(conversationId, entry, manifest)
    await fs.writeFile(filePath, content)
    await this.updateByteSize(conversationId, entry, manifest)
  }

  async append(conversationId: string, refId: string, content: string | Buffer): Promise<void> {
    const { manifest, entry } = await this.getEntry(conversationId, refId)
    const filePath = await this.ensureMaterialized(conversationId, entry, manifest)
    await fs.appendFile(filePath, content)
    await this.updateByteSize(conversationId, entry, manifest)
  }

  async stat(conversationId: string, refId: string): Promise<number> {
    const { manifest, entry } = await this.getEntry(conversationId, refId)
    const filePath = await this.ensureMaterialized(conversationId, entry, manifest)
    const stats = await fs.stat(filePath)
    entry.byteSize = stats.size
    await this.saveManifest(conversationId, manifest)
    return stats.size
  }

  async resolve(conversationId: string, refId: string): Promise<string> {
    const { entry } = await this.getEntry(conversationId, refId)
    return this.resolveEntryPath(conversationId, entry)
  }

  async listRefs(
    conversationId: string,
    kind?: ContextKind,
    limit?: number
  ): Promise<ContextRef[]> {
    const manifest = await this.loadManifest(conversationId)
    let items = manifest.items
    if (kind) {
      items = items.filter((item) => item.kind === kind)
    }
    if (typeof limit === 'number') {
      items = items.slice(0, Math.max(0, limit))
    }
    return items.map((entry) => this.toRef(entry))
  }

  async getEntry(
    conversationId: string,
    refId: string
  ): Promise<{ manifest: ContextManifest; entry: ContextManifestEntry }> {
    const manifest = await this.loadManifest(conversationId)
    const entry = manifest.items.find((item) => item.id === refId)
    if (!entry) {
      throw new Error(`Context ref not found: ${refId}`)
    }
    return { manifest, entry }
  }

  async ensureMaterialized(
    conversationId: string,
    entry: ContextManifestEntry,
    manifest?: ContextManifest
  ): Promise<string> {
    const filePath = this.resolveEntryPath(conversationId, entry)
    await fs.mkdir(path.dirname(filePath), { recursive: true })
    if (entry.strategy !== 'lazy') {
      return filePath
    }

    const exists = await this.fileExists(filePath)
    if (exists) {
      return filePath
    }

    if (!entry.source?.type) {
      throw new Error(`Lazy context ref missing materializer metadata: ${entry.id}`)
    }

    const materializer = this.materializers[entry.source.type]
    if (!materializer) {
      throw new Error(`No materializer registered for source type: ${entry.source.type}`)
    }

    const result = await materializer(entry, filePath)
    if (result?.content !== undefined) {
      await fs.writeFile(filePath, result.content)
    }

    if (result?.mimeType) {
      entry.mimeType = result.mimeType
    }

    if (result?.byteSize !== undefined) {
      entry.byteSize = result.byteSize
    } else {
      try {
        const stats = await fs.stat(filePath)
        entry.byteSize = stats.size
      } catch {
        entry.byteSize = entry.byteSize ?? 0
      }
    }

    if (manifest) {
      await this.saveManifest(conversationId, manifest)
    } else {
      const refreshed = await this.loadManifest(conversationId)
      const index = refreshed.items.findIndex((item) => item.id === entry.id)
      if (index !== -1) {
        refreshed.items[index] = entry
        await this.saveManifest(conversationId, refreshed)
      }
    }

    return filePath
  }

  private async ensureConversationDirs(conversationId: string): Promise<string> {
    const conversationRoot = this.getConversationRoot(conversationId)
    await fs.mkdir(conversationRoot, { recursive: true })
    await Promise.all(
      Object.values(KIND_DIRS).map((dir) =>
        fs.mkdir(path.join(conversationRoot, dir), { recursive: true })
      )
    )
    return conversationRoot
  }

  private async loadManifest(conversationId: string): Promise<ContextManifest> {
    const manifestPath = this.getManifestPath(conversationId)
    try {
      const raw = await fs.readFile(manifestPath, 'utf-8')
      const parsed = JSON.parse(raw) as ContextManifest
      if (!parsed || parsed.version !== 1 || !Array.isArray(parsed.items)) {
        return { version: 1, items: [] }
      }
      return parsed
    } catch {
      return { version: 1, items: [] }
    }
  }

  private async saveManifest(conversationId: string, manifest: ContextManifest): Promise<void> {
    const manifestPath = this.getManifestPath(conversationId)
    await fs.mkdir(path.dirname(manifestPath), { recursive: true })
    const tmpPath = `${manifestPath}.tmp`
    await fs.writeFile(tmpPath, JSON.stringify(manifest, null, 2), 'utf-8')
    await fs.rename(tmpPath, manifestPath)
  }

  private getManifestPath(conversationId: string): string {
    return path.join(this.getConversationRoot(conversationId), MANIFEST_FILE)
  }

  private resolveExtension(mimeType?: string): string {
    if (!mimeType) return '.txt'
    return EXTENSION_MAP[mimeType] ?? '.txt'
  }

  private toRef(entry: ContextManifestEntry): ContextRef {
    return {
      id: entry.id,
      kind: entry.kind,
      mimeType: entry.mimeType,
      byteSize: entry.byteSize,
      createdAt: entry.createdAt,
      hint: entry.hint
    }
  }

  private resolveEntryPath(conversationId: string, entry: ContextManifestEntry): string {
    const conversationRoot = this.getConversationRoot(conversationId)
    const normalizedPath = entry.path.replace(/\\/g, '/')
    const resolved = path.resolve(conversationRoot, normalizedPath)
    const relative = path.relative(conversationRoot, resolved)
    if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) {
      throw new Error(`Resolved path escapes context root: ${entry.path}`)
    }
    return resolved
  }

  private ensureSafeSegment(segment: string): string {
    const trimmed = segment.trim()
    if (!trimmed) {
      throw new Error('Conversation ID is required')
    }
    if (/[\\/]/.test(trimmed) || trimmed === '.' || trimmed === '..') {
      throw new Error('Invalid conversation ID')
    }
    return trimmed
  }

  private async fileExists(filePath: string): Promise<boolean> {
    try {
      await fs.access(filePath)
      return true
    } catch {
      return false
    }
  }

  private async updateByteSize(
    conversationId: string,
    entry: ContextManifestEntry,
    manifest: ContextManifest
  ): Promise<void> {
    try {
      const stats = await fs.stat(this.resolveEntryPath(conversationId, entry))
      entry.byteSize = stats.size
    } catch {
      entry.byteSize = entry.byteSize ?? 0
    }
    await this.saveManifest(conversationId, manifest)
  }
}
