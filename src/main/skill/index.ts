import { app, shell } from 'electron'
import path from 'path'
import fs from 'fs'
import { execFile } from 'node:child_process'
import { createHash, randomBytes, randomUUID } from 'node:crypto'
import { promisify } from 'node:util'
import matter from 'gray-matter'
import type { SkillSettingsPort } from './settings'
import { extractSkillArchive } from './archive'
import { downloadSkillArchive } from './archiveDownload'
import {
  createWatcherRequestId,
  type IFileWatcherService,
  type WatcherEventBatch,
  type WatcherStatus,
  type WatchHandle
} from '@/platform/fileWatcher'
import {
  SkillServicePort,
  SkillMetadata,
  SkillContent,
  SkillInstallResult,
  SkillFolderNode,
  SkillInstallOptions,
  SkillImportProvenance,
  GitSkillInstallInput,
  GitSkillRepoScanItem,
  GitSkillRepoScanResult,
  SkillExtensionConfig,
  SkillSyncDirectoryExportInput,
  SkillSyncDirectoryExportPreview,
  SkillSyncDirectoryImportInput,
  SkillSyncDirectoryImportPreview,
  SkillSyncDirectoryPreviewItem,
  SkillSyncDirectoryResult,
  SkillManageRequest,
  SkillManageResult,
  SkillDraftActionResult,
  SkillRuntimePolicy,
  SkillScriptDescriptor,
  SkillScriptRuntime,
  SkillViewResult,
  SkillLinkedFile,
  EffectiveSkillContentIdentity,
  EffectiveSkillContentResolution,
  EffectiveSkillExecutionPackage,
  SKILL_ARCHIVE_MAX_INPUT_BYTES,
  SKILL_EFFECTIVE_CONTENT_MAX_BATCH_BYTES,
  SKILL_EFFECTIVE_CONTENT_MAX_BYTES,
  SKILL_EXECUTION_PACKAGE_MAX_BATCH_BYTES,
  SKILL_EXECUTION_PACKAGE_MAX_BATCH_ENCODED_BYTES,
  SKILL_EXECUTION_PACKAGE_MAX_BYTES,
  SKILL_EXECUTION_PACKAGE_MAX_DEPTH,
  SKILL_EXECUTION_PACKAGE_MAX_DIRECTORIES,
  SKILL_EXECUTION_PACKAGE_MAX_FILES,
  SKILL_EXECUTION_PACKAGE_MAX_FILE_BYTES,
  SKILL_EXECUTION_PACKAGE_MAX_ENCODED_BYTES,
  SKILL_EXECUTION_PACKAGE_MAX_PATH_BYTES,
  SKILL_EXECUTION_PACKAGE_MAX_SUPPORT_PATHS,
  SKILL_NAME_MAX_LENGTH
} from '@shared/types/skill'
import type {
  AgentSkillManagementState,
  AgentSkillBinding,
  AgentSkillBindingState,
  SharedSkillManagementItem,
  SkillManagementItem,
  SkillManagementState,
  SkillDeleteResult,
  SkillSyncDirectoryConfig,
  SkillSource,
  SkillSourceType,
  StoredSkillManagementState,
  UnifiedSkillItem
} from '@shared/types/skillManagement'
import type { DeepchatEventPublisher } from '@shared/contracts/events'
import logger from '@shared/logger'
import { normalizeSkillAllowedTools } from './toolNameMapping'
import { discoverSkillMetadataInWorker, logSkillDiscoveryWorkerWarnings } from './discoveryWorker'
import {
  BUILTIN_SKILL_AGENT_ID,
  assertSafeSkillAgentId,
  resolveAgentSkillsRoot
} from './agentSkillRoots'

const execFileAsync = promisify(execFile)
const READ_ONLY_BUNDLED_SKILL_NAMES = new Set(['deepchat-cli'])
const EFFECTIVE_SKILL_CONTENT_BUILDER_VERSION = 'skill-effective-content-v3'
// SHA-256 values cover the canonical manifest and complete pre-declaration resource tree.
const LEGACY_BUILTIN_EXECUTION_SUPPORT_MIGRATIONS = {
  docx: {
    manifestHash: '0bd90681fcab2e282025ee14acf508b60bbd6c41ac6c3bf83c0dc14d52c37933',
    treeHash: 'ccbe20a0aca2f7b6e25ce190b977a848c29b782e241cb0b44e15d74fbdc023e8',
    supportPaths: ['ooxml']
  },
  pptx: {
    manifestHash: 'b6f25545bfb358739f1532f793458b5dbc87ee009933cb7c306b2d951ab6617f',
    treeHash: '21d88544f381e3e4106d076bc3f1f8438710864c931a9392a0d31e906c8a4bce',
    supportPaths: ['ooxml']
  }
} as const

/**
 * Skill system configuration constants
 */
export const SKILL_CONFIG = {
  /** Maximum size for SKILL.md file (bytes) - prevents memory exhaustion */
  SKILL_FILE_MAX_SIZE: 5 * 1024 * 1024, // 5MB

  /** Maximum compressed ZIP input size (bytes) */
  ZIP_MAX_SIZE: SKILL_ARCHIVE_MAX_INPUT_BYTES,

  /** Download timeout (milliseconds) - prevents hanging connections */
  DOWNLOAD_TIMEOUT: 30 * 1000, // 30 seconds

  /** Maximum depth for folder tree traversal - prevents stack overflow */
  FOLDER_TREE_MAX_DEPTH: 10,

  /** File watcher debounce settings */
  WATCHER_STABILITY_THRESHOLD: 300, // ms
  WATCHER_POLL_INTERVAL: 100, // ms

  /** Sidecar configuration directory name */
  SIDECAR_DIR: '.deepchat-meta',

  /** Draft skill configuration */
  DRAFT_ROOT_DIR: 'deepchat-skill-drafts',
  DRAFT_MAX_CONTENT_CHARS: 100000,
  DRAFT_RETENTION_MS: 7 * 24 * 60 * 60 * 1000,
  MAX_LINKED_FILE_SIZE: 1024 * 1024
} as const

const SUPPORTED_SCRIPT_EXTENSIONS: Record<string, SkillScriptRuntime> = {
  '.py': 'python',
  '.js': 'node',
  '.mjs': 'node',
  '.cjs': 'node',
  '.sh': 'shell'
}

const DEFAULT_RUNTIME_POLICY: SkillRuntimePolicy = {
  python: 'auto',
  node: 'auto'
}

const SKILL_NAME_PATTERN = /^[a-z0-9][a-z0-9._-]*$/
const SKILL_NAME_ALIASES = new Map([['cua-driver', 'computer-use']])
const BINARY_LIKE_EXTENSIONS = new Set([
  '.png',
  '.jpg',
  '.jpeg',
  '.gif',
  '.webp',
  '.avif',
  '.pdf',
  '.zip',
  '.tar',
  '.gz',
  '.sqlite',
  '.db',
  '.woff',
  '.woff2',
  '.ttf',
  '.otf',
  '.exe',
  '.dll',
  '.so',
  '.dylib',
  '.mp3',
  '.mp4',
  '.mov',
  '.avi',
  '.wasm',
  '.bin',
  '.ico'
])
const DRAFT_ALLOWED_TOP_LEVEL_DIRS = new Set(['references', 'templates', 'scripts', 'assets'])
const DRAFT_CONVERSATION_ID_PATTERN = /^[A-Za-z0-9._-]+$/
const DRAFT_ID_PATTERN = /^[A-Za-z0-9._-]+$/
const DRAFT_ACTIVITY_MARKER = '.lastActivity'
const BUILTIN_SKILL_ROOT_EXCLUDED_DIRS = new Set(['.agent-scopes', '.library-migration-v3'])
const SHARED_SKILL_MIGRATION_DIR = '.library-migration-v3'
const SHARED_SKILL_MIGRATION_JOURNAL = 'journal.json'
const SKILL_INSTALL_STAGING_PREFIX = '.install-'
const SKILL_SYNC_EXPORT_STAGING_PREFIX = '.export-'
const SKILL_SYNC_EXPORT_BACKUP_PREFIX = '.export-backup-'
const DRAFT_INJECTION_PATTERNS = [
  /ignore\s+previous\s+instructions/i,
  /disregard\s+all\s+prior/i,
  /system\s+prompt/i,
  /reveal\s+hidden\s+instructions/i,
  /forget\s+all\s+above/i,
  /override\s+the\s+rules/i
]

export interface SkillSessionStatePort {
  hasNewSession(conversationId: string): Promise<boolean>
  getPersistedNewSessionSkills(conversationId: string): string[]
  setPersistedNewSessionSkills(conversationId: string, skills: string[]): void
  repairImportedLegacySessionSkills(conversationId: string): Promise<string[]>
}

export interface SkillAgentScopePort {
  isDeepChatAgent(agentId: string): Promise<boolean>
  listDeepChatAgents(): Promise<
    Array<{ id: string; enabledSkillNames?: string[] | null; protected?: boolean }>
  >
  getSessionAgentId(sessionId: string): Promise<string | null>
  listSessions(): Promise<Array<{ id: string; agentId: string }>>
}

export type RuntimeSkillContentIdentity = EffectiveSkillContentIdentity

export type RuntimeSkillViewResult = SkillViewResult & {
  /** Main-process evidence only. AgentToolManager removes it from the provider-visible result. */
  contentIdentity?: RuntimeSkillContentIdentity
  /** Exact main-process snapshot that backs runtime activation and script authority. */
  contentResolution?: EffectiveSkillContentResolution
}

interface EffectiveSkillContentBuild {
  skillContent: SkillContent
  renderedManifest: string
  scriptInventory: Array<{
    relativePath: string
    runtime: SkillScriptRuntime
    enabled: boolean
    description?: string
  }>
  executionPackage?: EffectiveSkillExecutionPackage
}

interface SkillRuntimeSnapshot {
  extension: SkillExtensionConfig
  environmentBindingId: string | null
}

interface SkillExecutionPackageSnapshot {
  scripts: SkillScriptDescriptor[]
  executionPackage: EffectiveSkillExecutionPackage
}
interface SkillDirectoryInstallContext {
  options?: SkillInstallOptions
  sourceType?: SkillSourceType
  sourcePatch?: Partial<SkillSource>
  targetName?: string
  agentId?: string
  assignToAgent?: boolean
  assignToAgentIds?: string[]
  persistManagementState?: boolean
  publishCatalogEvent?: boolean
}

interface SharedSkillMigrationPlannedCopy {
  sourcePath: string
  targetPath: string
  targetName: string
  agentId: string
  originalName: string
  source: SkillSource
}

function createDefaultSkillExtensionConfig(): SkillExtensionConfig {
  return {
    version: 1,
    env: {},
    runtimePolicy: { ...DEFAULT_RUNTIME_POLICY },
    scriptOverrides: {}
  }
}

function sameSkillRuntimeEnvironment(
  left: Readonly<Record<string, string>>,
  right: Readonly<Record<string, string>>
): boolean {
  const entries = (value: Readonly<Record<string, string>>) =>
    Object.entries(value).sort(([leftKey], [rightKey]) =>
      Buffer.compare(Buffer.from(leftKey, 'utf8'), Buffer.from(rightKey, 'utf8'))
    )
  return JSON.stringify(entries(left)) === JSON.stringify(entries(right))
}

function sameSkillExtension(left: SkillExtensionConfig, right: SkillExtensionConfig): boolean {
  const canonical = (value: SkillExtensionConfig) => ({
    version: value.version,
    env: Object.entries(value.env).sort(([leftKey], [rightKey]) =>
      Buffer.compare(Buffer.from(leftKey, 'utf8'), Buffer.from(rightKey, 'utf8'))
    ),
    runtimePolicy: value.runtimePolicy,
    scriptOverrides: Object.entries(value.scriptOverrides)
      .sort(([leftKey], [rightKey]) =>
        Buffer.compare(Buffer.from(leftKey, 'utf8'), Buffer.from(rightKey, 'utf8'))
      )
      .map(([key, override]) => [key, override] as const)
  })
  return JSON.stringify(canonical(left)) === JSON.stringify(canonical(right))
}

function sanitizeSkillExtensionConfig(input: unknown): SkillExtensionConfig {
  const fallback = createDefaultSkillExtensionConfig()
  if (!input || typeof input !== 'object') {
    return fallback
  }

  const candidate = input as Partial<SkillExtensionConfig>
  const env = Object.fromEntries(
    Object.entries(candidate.env ?? {})
      .filter(
        (entry): entry is [string, string] =>
          typeof entry[0] === 'string' && typeof entry[1] === 'string' && entry[0].trim().length > 0
      )
      .map(([key, value]) => [key.trim(), value])
  )

  const runtimePolicy = (candidate.runtimePolicy ?? {}) as Partial<SkillRuntimePolicy>
  const python =
    runtimePolicy.python === 'builtin' || runtimePolicy.python === 'system'
      ? runtimePolicy.python
      : 'auto'
  const node =
    runtimePolicy.node === 'builtin' || runtimePolicy.node === 'system'
      ? runtimePolicy.node
      : 'auto'

  const scriptOverrides = Object.fromEntries(
    Object.entries(candidate.scriptOverrides ?? {})
      .filter(([key]) => typeof key === 'string' && key.trim().length > 0)
      .map(([key, value]) => {
        const override = value && typeof value === 'object' ? value : {}
        const next: { enabled?: boolean; description?: string } = {}
        if (typeof (override as { enabled?: unknown }).enabled === 'boolean') {
          next.enabled = (override as { enabled: boolean }).enabled
        }
        if (typeof (override as { description?: unknown }).description === 'string') {
          const description = (override as { description: string }).description.trim()
          if (description) {
            next.description = description
          }
        }
        return [key.trim(), next]
      })
  )

  return {
    version: 1,
    env,
    runtimePolicy: { python, node },
    scriptOverrides
  }
}

/**
 * SkillService manages the skills system.
 *
 * Responsibilities:
 * - Discover and parse SKILL.md files from ~/.deepchat/skills/
 * - Progressive loading: metadata always in memory, full content on demand
 * - Hot-reload skill files when they change
 * - Manage skill activation state per conversation
 * - Install/uninstall skills from various sources
 */
export class SkillService implements SkillServicePort {
  private skillsDir: string
  private sidecarDir: string
  private draftsRoot: string
  private metadataCache: Map<string, SkillMetadata> = new Map()
  private contentCache: Map<string, Map<string, SkillContent>> = new Map()
  private readOnlyBundledSkills: SkillMetadata[] = []
  private deletedAgentScopes: Set<string> = new Set()
  private activeAgentScopeOperations: Map<string, number> = new Map()
  private agentScopeDrainWaiters: Map<string, Set<() => void>> = new Map()
  private pluginSkillContributions: Map<
    string,
    { ownerPluginId: string; skillRoot: string; pluginRoot?: string }
  > = new Map()
  private watcher: WatchHandle | null = null
  private watcherStartPromise: Promise<void> | null = null
  private initializationPromise: Promise<void> | null = null
  private destroyPromise: Promise<void> | null = null
  private stopped = false
  private initialized: boolean = false
  private builtinCatalogDiscovered: boolean = false
  // Prevent concurrent discovery calls (race condition protection)
  private discoveryPromise: Promise<SkillMetadata[]> | null = null
  private legacySkillRetirementWarnings: Set<string> = new Set()
  private mutationTail: Promise<void> = Promise.resolve()
  private activeSkillMutationTails = new Map<string, Promise<void>>()
  private retiredSessionSkillScopes = new Set<string>()

  constructor(
    private readonly settings: SkillSettingsPort,
    private readonly sessionStatePort: SkillSessionStatePort,
    private readonly watcherService: IFileWatcherService,
    private readonly publishEvent: DeepchatEventPublisher,
    private readonly agentScopePort?: SkillAgentScopePort
  ) {
    // Skills directory: ~/.deepchat/skills/
    this.skillsDir = this.resolveSkillsDir()
    this.sidecarDir = path.join(this.skillsDir, SKILL_CONFIG.SIDECAR_DIR)
    this.draftsRoot = path.join(app.getPath('temp'), SKILL_CONFIG.DRAFT_ROOT_DIR)
    this.ensureSkillsDir()
  }

  private resolveSkillsDir(): string {
    const configuredPath = this.settings.getPath()
    const normalized = configuredPath?.trim()
    const homePath = app.getPath('home')
    const homeDir = homePath ? path.resolve(homePath) : path.resolve('.')
    const fallbackDir = path.join(homeDir, '.deepchat', 'skills')
    const resolved = normalized ? path.resolve(normalized) : fallbackDir
    const repairedDefaultPath = normalized
      ? this.repairPortableDefaultSkillsPath(normalized, homeDir)
      : null

    if (repairedDefaultPath) {
      return repairedDefaultPath
    }

    // Repair malformed paths like: C:\Users\name.deepchat\skills
    const brokenPrefix = `${homeDir}.deepchat`
    const compareResolved = process.platform === 'win32' ? resolved.toLowerCase() : resolved
    const compareBrokenPrefix =
      process.platform === 'win32' ? brokenPrefix.toLowerCase() : brokenPrefix
    const hasBrokenPrefix = compareResolved.startsWith(compareBrokenPrefix)
    const nextChar = compareResolved.charAt(compareBrokenPrefix.length)
    const hasBoundaryAfterPrefix =
      compareResolved.length === compareBrokenPrefix.length || nextChar === '/' || nextChar === '\\'
    if (hasBrokenPrefix && hasBoundaryAfterPrefix) {
      const suffix = resolved.slice(brokenPrefix.length).replace(/^[\\/]+/, '')
      return path.join(homeDir, '.deepchat', suffix)
    }

    return resolved
  }

  private repairPortableDefaultSkillsPath(configuredPath: string, homeDir: string): string | null {
    const slashPath = configuredPath.replace(/\\/g, '/')
    const match =
      slashPath.match(/^\/Users\/[^/]+\/\.deepchat\/skills(?:\/(.*))?$/i) ??
      slashPath.match(/^[A-Za-z]:\/Users\/[^/]+\/\.deepchat\/skills(?:\/(.*))?$/i)

    if (!match) {
      return null
    }

    const suffixParts = (match[1] ?? '').split('/').filter(Boolean)
    return path.join(homeDir, '.deepchat', 'skills', ...suffixParts)
  }

  /**
   * Ensure the skills directory exists
   */
  private ensureSkillsDir(): void {
    if (!fs.existsSync(this.skillsDir)) {
      fs.mkdirSync(this.skillsDir, { recursive: true })
    }
  }

  private getAgentSkillsRoot(agentId: string): string {
    return resolveAgentSkillsRoot(this.skillsDir, agentId)
  }

  private async requireAgentScope(agentId: string): Promise<string> {
    this.assertServiceActive()
    const normalizedAgentId = assertSafeSkillAgentId(agentId)
    this.assertAgentScopeActive(normalizedAgentId)
    if (this.agentScopePort && !(await this.agentScopePort.isDeepChatAgent(normalizedAgentId))) {
      throw new Error(`DeepChat Agent not found: ${normalizedAgentId}`)
    }
    this.assertServiceActive()
    this.assertAgentScopeActive(normalizedAgentId)
    return normalizedAgentId
  }

  private assertServiceActive(): void {
    if (this.isServiceStopping()) {
      throw new Error('SkillService is shutting down')
    }
  }

  private async runMutation<T>(operation: () => Promise<T>): Promise<T> {
    const previous = this.mutationTail
    let release!: () => void
    this.mutationTail = new Promise<void>((resolve) => {
      release = resolve
    })
    await previous
    try {
      this.assertServiceActive()
      return await operation()
    } finally {
      release()
    }
  }

  private isServiceStopping(): boolean {
    return this.stopped || Boolean(this.destroyPromise)
  }

  private isServiceStoppingError(error: unknown): boolean {
    return (
      this.isServiceStopping() &&
      error instanceof Error &&
      error.message === 'SkillService is shutting down'
    )
  }

  private assertAgentScopeActive(agentId: string): void {
    if (this.deletedAgentScopes.has(agentId)) {
      throw new Error(`DeepChat Agent Skill bindings are being deleted: ${agentId}`)
    }
  }

  private beginAgentScopeOperation(agentId: string): () => void {
    this.assertServiceActive()
    this.assertAgentScopeActive(agentId)
    this.activeAgentScopeOperations.set(
      agentId,
      (this.activeAgentScopeOperations.get(agentId) ?? 0) + 1
    )
    let completed = false
    return () => {
      if (completed) return
      completed = true
      const remaining = (this.activeAgentScopeOperations.get(agentId) ?? 1) - 1
      if (remaining > 0) {
        this.activeAgentScopeOperations.set(agentId, remaining)
        return
      }
      this.activeAgentScopeOperations.delete(agentId)
      const waiters = this.agentScopeDrainWaiters.get(agentId)
      this.agentScopeDrainWaiters.delete(agentId)
      for (const resolve of waiters ?? []) resolve()
    }
  }

  private async waitForAgentScopeOperations(agentId: string): Promise<void> {
    if ((this.activeAgentScopeOperations.get(agentId) ?? 0) === 0) return
    await new Promise<void>((resolve) => {
      let waiters = this.agentScopeDrainWaiters.get(agentId)
      if (!waiters) {
        waiters = new Set()
        this.agentScopeDrainWaiters.set(agentId, waiters)
      }
      waiters.add(resolve)
    })
  }

  private getMetadataCacheForAgent(agentId: string): Map<string, SkillMetadata> {
    assertSafeSkillAgentId(agentId)
    return this.metadataCache
  }

  private getContentCacheForAgent(agentId: string): Map<string, SkillContent> {
    const normalizedAgentId = assertSafeSkillAgentId(agentId)
    let cache = this.contentCache.get(normalizedAgentId)
    if (!cache) {
      cache = new Map()
      this.contentCache.set(normalizedAgentId, cache)
    }
    return cache
  }

  private invalidateSkillContent(name: string): void {
    for (const cache of this.contentCache.values()) cache.delete(name)
  }

  private async ensureAgentCatalogDiscovered(agentId: string): Promise<void> {
    assertSafeSkillAgentId(agentId)
    if (this.builtinCatalogDiscovered || this.metadataCache.size > 0) return
    if (!this.discoveryPromise) {
      this.discoveryPromise = this.discoverSkills(BUILTIN_SKILL_AGENT_ID).finally(() => {
        this.discoveryPromise = null
      })
    }
    await this.discoveryPromise
  }

  /**
   * Get the skills directory path
   */
  async getSkillsDir(agentId: string = BUILTIN_SKILL_AGENT_ID): Promise<string> {
    await this.requireAgentScope(agentId)
    return this.skillsDir
  }

  /**
   * Initialize the skill system - discover skills and start watching
   */
  async initialize(): Promise<void> {
    if (this.stopped || this.destroyPromise) {
      throw new Error('SkillService is shutting down')
    }
    if (this.initialized) return
    if (!this.initializationPromise) {
      const initialization = this.initializeOnce()
      this.initializationPromise = initialization
      const clearInitialization = () => {
        if (this.initializationPromise === initialization) {
          this.initializationPromise = null
        }
      }
      void initialization.then(clearInitialization, clearInitialization)
    }
    await this.initializationPromise
  }

  private async initializeOnce(): Promise<void> {
    try {
      await this.installBuiltinSkills()
      if (this.isServiceStopping()) return

      this.cleanupExpiredDrafts()
      await this.discoverSkills(BUILTIN_SKILL_AGENT_ID)
      if (this.isServiceStopping()) return

      try {
        await this.migrateSharedSkills()
      } catch (error) {
        logger.warn('[SkillService] Shared Skills migration failed; startup can retry.', {
          error
        })
        throw error
      }
      if (this.isServiceStopping()) return

      await this.watchSkillFiles()
      if (this.isServiceStopping()) return
      this.initialized = true
    } catch (error) {
      if (this.isServiceStoppingError(error)) return
      throw error
    }
  }

  /**
   * Discover all skills from the skills directory
   */
  async discoverSkills(agentId: string = BUILTIN_SKILL_AGENT_ID): Promise<SkillMetadata[]> {
    const normalizedAgentId = await this.requireAgentScope(agentId)
    if (normalizedAgentId !== BUILTIN_SKILL_AGENT_ID) {
      await this.ensureAgentCatalogDiscovered(BUILTIN_SKILL_AGENT_ID)
      return this.getVisibleMetadataFromCache(normalizedAgentId)
    }

    this.metadataCache.clear()
    this.contentCache.clear()
    this.builtinCatalogDiscovered = false

    if (!fs.existsSync(this.skillsDir)) {
      this.builtinCatalogDiscovered = true
      return []
    }

    let discoveredSkills: SkillMetadata[]
    try {
      const workerResult = await discoverSkillMetadataInWorker({
        skillsDir: this.skillsDir,
        sidecarDirName: SKILL_CONFIG.SIDECAR_DIR,
        maxDepth: SKILL_CONFIG.FOLDER_TREE_MAX_DEPTH,
        excludedRootDirNames: Array.from(BUILTIN_SKILL_ROOT_EXCLUDED_DIRS)
      })
      logSkillDiscoveryWorkerWarnings(workerResult.warnings)
      discoveredSkills = workerResult.skills
    } catch (error) {
      console.warn('[SkillService] Worker discovery failed, falling back to main thread:', error)
      discoveredSkills = await this.discoverSkillsOnMainThread()
    }

    for (const metadata of [
      ...discoveredSkills,
      ...this.readOnlyBundledSkills,
      ...(await this.discoverPluginSkillsOnMainThread())
    ]) {
      if (this.metadataCache.has(metadata.name)) {
        logger.warn('[SkillService] Duplicate skill name discovered. Keeping the first entry.', {
          name: metadata.name,
          path: metadata.path
        })
        continue
      }
      this.metadataCache.set(metadata.name, metadata)
    }

    const skills = this.sortSkillMetadata(Array.from(this.metadataCache.values()))
    this.builtinCatalogDiscovered = true
    this.publishEvent('skills.catalog.changed', {
      reason: 'discovered',
      agentIds: [BUILTIN_SKILL_AGENT_ID],
      skills,
      version: Date.now()
    })

    return skills
  }

  private async migrateSharedSkills(): Promise<void> {
    const stored = this.settings.getManagementState()
    if (stored?.version === 3) {
      if (stored.migration?.status === 'committing') {
        await this.remapLegacySessionSkillNames(stored.migration.agentSkillNames)
        const resumedState = this.getStoredManagementState()
        if (resumedState.migration?.status === 'committing') {
          resumedState.migration = {
            ...resumedState.migration,
            status: 'completed',
            completedAt: new Date().toISOString()
          }
          this.saveManagementState(resumedState)
        }
      } else if (stored.migration?.status === 'planned') {
        throw new Error('Shared Skills migration state was committed before its packages')
      }
      await this.pruneInactiveAgentBindings()
      this.reconcileSkillManagementState()
      await this.materializeProviderBindingsForExistingAgents()
      fs.rmSync(path.join(this.skillsDir, SHARED_SKILL_MIGRATION_DIR), {
        recursive: true,
        force: true
      })
      return
    }

    const sourceVersion: 1 | 2 = stored?.version === 2 ? 2 : 1
    const legacyAgents = this.readLegacyAgentManagementStates(stored)
    const agents = this.agentScopePort
      ? await this.agentScopePort.listDeepChatAgents()
      : [{ id: BUILTIN_SKILL_AGENT_ID }]
    if (!agents.some((agent) => agent.id === BUILTIN_SKILL_AGENT_ID)) {
      agents.unshift({ id: BUILTIN_SKILL_AGENT_ID })
    }

    const startedAt = new Date().toISOString()
    const state: SkillManagementState = {
      version: 3,
      skills: {},
      agents: {},
      sync: this.sanitizeSyncDirectoryConfig(stored?.sync),
      migration: {
        sourceVersion,
        status: 'planned',
        startedAt,
        agentSkillNames: {}
      }
    }
    const migration = state.migration!
    const usedNames = new Set(this.metadataCache.keys())
    const migrationRoot = path.join(this.skillsDir, SHARED_SKILL_MIGRATION_DIR)
    const stagingRoot = path.join(migrationRoot, 'staging')
    const journalPath = path.join(migrationRoot, SHARED_SKILL_MIGRATION_JOURNAL)
    const recoveryTargets = this.readMigrationRecoveryTargets(journalPath, sourceVersion)
    const plannedCopies: SharedSkillMigrationPlannedCopy[] = []

    for (const metadata of this.metadataCache.values()) {
      const legacyItem = legacyAgents[BUILTIN_SKILL_AGENT_ID]?.skills[metadata.name]
      state.skills[metadata.name] = {
        name: metadata.name,
        canonicalPath: metadata.skillRoot,
        source:
          metadata.readOnly || metadata.ownerPluginId
            ? { type: 'builtin' }
            : this.sanitizeSkillSource(legacyItem?.source)
      }
    }

    for (const agent of agents) {
      const agentId = assertSafeSkillAgentId(agent.id)
      const legacyAgent = legacyAgents[agentId]
      const bindingState = this.getAgentBindingState(state, agentId)
      const nameMap: Record<string, string> = {}
      migration.agentSkillNames[agentId] = nameMap
      const legacyAllowList =
        sourceVersion === 2 && stored?.version === 2
          ? stored.migration?.legacySkillAllowLists?.[agentId]
          : agent.enabledSkillNames

      for (const metadata of this.metadataCache.values()) {
        const legacyItem = legacyAgent?.skills[metadata.name]
        const inheritedLegacyItem =
          sourceVersion === 1
            ? legacyAgents[BUILTIN_SKILL_AGENT_ID]?.skills[metadata.name]
            : undefined
        const providerOwned = Boolean(metadata.readOnly || metadata.ownerPluginId)
        const enabledByLegacyAllowList = Array.isArray(legacyAllowList)
          ? legacyAllowList.includes(metadata.name)
          : true
        const assigned =
          agentId === BUILTIN_SKILL_AGENT_ID
            ? legacyItem?.disabled !== true
            : providerOwned
              ? legacyItem?.disabled !== true
              : sourceVersion === 1
                ? enabledByLegacyAllowList && (legacyItem ?? inheritedLegacyItem)?.disabled !== true
                : legacyItem
                  ? legacyItem.disabled !== true
                  : Array.isArray(legacyAllowList) && enabledByLegacyAllowList
        const legacyExtensionItem = legacyItem ?? inheritedLegacyItem
        bindingState.bindings[metadata.name] = {
          assigned,
          extension: await this.resolveLegacyExtension(
            agentId,
            metadata.name,
            legacyExtensionItem,
            sourceVersion === 1
          ),
          runtimeBindingId: legacyExtensionItem?.runtimeBindingId
        }
        if (assigned) nameMap[metadata.name] = metadata.name
      }

      if (agentId === BUILTIN_SKILL_AGENT_ID) continue
      const privateRoot = this.getAgentSkillsRoot(agentId)
      if (!fs.existsSync(privateRoot)) continue
      const entries = fs.readdirSync(privateRoot, { withFileTypes: true })
      for (const entry of entries) {
        if (!entry.isDirectory() || entry.isSymbolicLink()) continue
        const sourcePath = path.join(privateRoot, entry.name)
        const summary = this.readSkillManifestSummary(sourcePath)
        if (!summary.valid || !this.isSafeSkillName(summary.name)) continue

        const legacyItem = legacyAgent?.skills[summary.name]
        const existing = this.metadataCache.get(summary.name)
        const matchingPlannedCopy = plannedCopies.find(
          (copy) =>
            copy.originalName === summary.name &&
            this.areSkillDirectoriesSame(sourcePath, copy.sourcePath)
        )
        const recoveredTargetName = recoveryTargets.get(`${agentId}\0${summary.name}`)
        let targetName = matchingPlannedCopy?.targetName ?? recoveredTargetName ?? summary.name
        if (
          !matchingPlannedCopy &&
          !recoveredTargetName &&
          ((existing && !this.areSkillDirectoriesSame(sourcePath, existing.skillRoot)) ||
            (!existing && usedNames.has(summary.name)))
        ) {
          targetName = this.findMigrationVariantName(summary.name, agentId, sourcePath, usedNames)
        }
        const targetPath = path.join(this.skillsDir, targetName)
        const targetAlreadyCommitted =
          Boolean(recoveredTargetName) &&
          fs.existsSync(targetPath) &&
          this.areMigratedSkillDirectoriesSame(sourcePath, targetPath, summary.name, targetName)
        if (recoveredTargetName && fs.existsSync(targetPath) && !targetAlreadyCommitted) {
          throw new Error(`Migration target changed before recovery: ${targetName}`)
        }
        const needsCopy =
          !matchingPlannedCopy &&
          !targetAlreadyCommitted &&
          (!fs.existsSync(targetPath) || !this.areSkillDirectoriesSame(sourcePath, targetPath))
        if (needsCopy) {
          plannedCopies.push({
            sourcePath,
            targetPath,
            targetName,
            agentId,
            originalName: summary.name,
            source: this.sanitizeSkillSource(legacyItem?.source)
          })
        }
        usedNames.add(targetName)
        nameMap[summary.name] = targetName
        state.skills[targetName] = {
          name: targetName,
          canonicalPath: targetPath,
          source: this.sanitizeSkillSource(legacyItem?.source)
        }
        if (targetName !== summary.name) {
          bindingState.bindings[summary.name] = {
            assigned: false,
            extension: sanitizeSkillExtensionConfig(legacyItem?.extension),
            runtimeBindingId: legacyItem?.runtimeBindingId
          }
        }
        bindingState.bindings[targetName] = {
          assigned: legacyItem?.disabled !== true,
          extension: sanitizeSkillExtensionConfig(legacyItem?.extension),
          runtimeBindingId: legacyItem?.runtimeBindingId
        }
      }
    }

    if (plannedCopies.length > 0) {
      fs.mkdirSync(stagingRoot, { recursive: true })
      for (const copy of plannedCopies) {
        const stagedPath = path.join(stagingRoot, copy.targetName)
        if (fs.existsSync(stagedPath)) fs.rmSync(stagedPath, { recursive: true, force: true })
        this.copyDirectory(copy.sourcePath, stagedPath)
        if (copy.targetName !== copy.originalName) {
          this.rewriteSkillManifestName(stagedPath, copy.targetName)
        }
        const summary = this.readSkillManifestSummary(stagedPath)
        if (!summary.valid || summary.name !== copy.targetName) {
          throw new Error(`Migrated Skill failed validation: ${copy.targetName}`)
        }
      }
    }

    fs.mkdirSync(migrationRoot, { recursive: true })
    await this.atomicWriteFile(
      journalPath,
      JSON.stringify({ sourceVersion, startedAt, plannedCopies }, null, 2)
    )
    migration.status = 'committing'

    for (const copy of plannedCopies) {
      const stagedPath = path.join(stagingRoot, copy.targetName)
      if (fs.existsSync(copy.targetPath)) {
        if (!this.areSkillDirectoriesSame(stagedPath, copy.targetPath)) {
          throw new Error(`Migration target changed before commit: ${copy.targetName}`)
        }
        fs.rmSync(stagedPath, { recursive: true, force: true })
      } else {
        fs.renameSync(stagedPath, copy.targetPath)
      }
      const metadata = await this.parseSkillMetadata(
        path.join(copy.targetPath, 'SKILL.md'),
        copy.targetName,
        undefined,
        this.skillsDir
      )
      if (!metadata) throw new Error(`Committed Skill failed validation: ${copy.targetName}`)
      this.metadataCache.set(copy.targetName, metadata)
    }

    state.migration = { ...migration, status: 'committing' }
    this.saveManagementState(state)
    await this.remapLegacySessionSkillNames(migration.agentSkillNames)
    const completedState = this.getStoredManagementState()
    completedState.migration = {
      ...migration,
      status: 'completed',
      completedAt: new Date().toISOString()
    }
    this.saveManagementState(completedState)
    fs.rmSync(migrationRoot, { recursive: true, force: true })
  }

  private readMigrationRecoveryTargets(
    journalPath: string,
    sourceVersion: 1 | 2
  ): Map<string, string> {
    const targets = new Map<string, string>()
    if (!fs.existsSync(journalPath)) return targets

    const journal = JSON.parse(fs.readFileSync(journalPath, 'utf-8')) as {
      sourceVersion?: unknown
      plannedCopies?: unknown
    }
    if (journal.sourceVersion !== sourceVersion || !Array.isArray(journal.plannedCopies)) {
      throw new Error('Shared Skills migration journal is invalid')
    }
    for (const rawCopy of journal.plannedCopies) {
      if (!rawCopy || typeof rawCopy !== 'object') {
        throw new Error('Shared Skills migration journal contains an invalid copy')
      }
      const copy = rawCopy as Partial<SharedSkillMigrationPlannedCopy>
      const agentId = assertSafeSkillAgentId(String(copy.agentId ?? ''))
      const originalName = String(copy.originalName ?? '')
      const targetName = String(copy.targetName ?? '')
      if (!this.isSafeSkillName(originalName) || !this.isSafeSkillName(targetName)) {
        throw new Error('Shared Skills migration journal contains an invalid Skill name')
      }
      const key = `${agentId}\0${originalName}`
      if (targets.has(key) && targets.get(key) !== targetName) {
        throw new Error('Shared Skills migration journal contains conflicting targets')
      }
      targets.set(key, targetName)
    }
    return targets
  }

  private readLegacyAgentManagementStates(
    stored: StoredSkillManagementState | null
  ): Record<string, AgentSkillManagementState> {
    const agents: Record<string, AgentSkillManagementState> = {}
    if (stored?.version === 2) {
      for (const [agentId, value] of Object.entries(stored.agents)) {
        try {
          const normalizedAgentId = assertSafeSkillAgentId(agentId)
          agents[normalizedAgentId] = this.sanitizeAgentManagementState(normalizedAgentId, value)
        } catch {
          // Ignore unsafe legacy Agent IDs.
        }
      }
    } else if (stored?.version === 1) {
      agents[BUILTIN_SKILL_AGENT_ID] = this.sanitizeAgentManagementState(BUILTIN_SKILL_AGENT_ID, {
        skills: stored.skills
      })
    }
    agents[BUILTIN_SKILL_AGENT_ID] ??= { skills: {} }
    return agents
  }

  private async resolveLegacyExtension(
    agentId: string,
    name: string,
    item?: SkillManagementItem,
    inheritBuiltinSidecar = false
  ): Promise<SkillExtensionConfig> {
    if (item) return sanitizeSkillExtensionConfig(item.extension)
    if (agentId !== BUILTIN_SKILL_AGENT_ID && !inheritBuiltinSidecar) {
      return createDefaultSkillExtensionConfig()
    }
    const sidecarPath = this.getSidecarPath(name)
    if (!(await this.pathExists(sidecarPath))) return createDefaultSkillExtensionConfig()
    try {
      return sanitizeSkillExtensionConfig(
        JSON.parse(await fs.promises.readFile(sidecarPath, 'utf-8'))
      )
    } catch {
      return createDefaultSkillExtensionConfig()
    }
  }

  private findMigrationVariantName(
    skillName: string,
    agentId: string,
    sourcePath: string,
    usedNames: ReadonlySet<string>
  ): string {
    const suffix = agentId
      .toLowerCase()
      .replace(/[^a-z0-9._-]+/g, '-')
      .replace(/^[^a-z0-9]+/, '')
    const baseName = `${skillName}-${suffix || 'agent'}`
    let candidate = baseName
    let sequence = 2
    while (usedNames.has(candidate) || fs.existsSync(path.join(this.skillsDir, candidate))) {
      const existingPath = path.join(this.skillsDir, candidate)
      if (fs.existsSync(existingPath) && this.areSkillDirectoriesSame(sourcePath, existingPath)) {
        return candidate
      }
      candidate = `${baseName}-${sequence}`
      sequence += 1
    }
    return candidate
  }

  private async remapLegacySessionSkillNames(
    agentSkillNames: Record<string, Record<string, string>>
  ): Promise<void> {
    if (!this.agentScopePort) return
    for (const session of await this.agentScopePort.listSessions()) {
      if (
        !Object.hasOwn(agentSkillNames, session.agentId) ||
        !(await this.agentScopePort.isDeepChatAgent(session.agentId))
      ) {
        continue
      }
      if (this.retiredSessionSkillScopes.has(session.id)) continue
      const mapping = agentSkillNames[session.agentId]
      const persisted = this.getPersistedNewSessionSkills(session.id)
      const remapped = persisted.map((name) => mapping[name] ?? name)
      const valid = await this.validateSkillNames(session.agentId, remapped)
      if (this.retiredSessionSkillScopes.has(session.id)) continue
      if (!this.areSkillListsEqual(persisted, valid)) {
        this.setPersistedNewSessionSkills(session.id, valid)
      }
    }
  }

  private reconcileSkillManagementState(): void {
    const state = this.getStoredManagementState()
    const availableNames = new Set(this.metadataCache.keys())
    let changed = false
    for (const metadata of this.metadataCache.values()) {
      const existing = state.skills[metadata.name]
      const source =
        metadata.readOnly || metadata.ownerPluginId
          ? ({ type: 'builtin' } as const)
          : (existing?.source ?? ({ type: 'created' } as const))
      if (existing?.canonicalPath === metadata.skillRoot && existing.source.type === source.type) {
        continue
      }
      state.skills[metadata.name] = {
        name: metadata.name,
        canonicalPath: metadata.skillRoot,
        source
      }
      changed = true
    }
    for (const name of Object.keys(state.skills)) {
      if (availableNames.has(name)) continue
      delete state.skills[name]
      for (const agent of Object.values(state.agents)) delete agent.bindings[name]
      changed = true
    }
    if (changed) this.saveManagementState(state)
  }

  private async pruneInactiveAgentBindings(): Promise<void> {
    if (!this.agentScopePort) return
    const activeAgentIds = new Set(
      (await this.agentScopePort.listDeepChatAgents()).map((agent) => agent.id)
    )
    activeAgentIds.add(BUILTIN_SKILL_AGENT_ID)

    const state = this.getStoredManagementState()
    let changed = false
    for (const agentId of Object.keys(state.agents)) {
      if (activeAgentIds.has(agentId)) continue
      delete state.agents[agentId]
      changed = true
    }
    if (changed) this.saveManagementState(state)
  }

  private async materializeProviderBindingsForExistingAgents(): Promise<void> {
    const agentIds = this.agentScopePort
      ? (await this.agentScopePort.listDeepChatAgents()).map((agent) => agent.id)
      : [BUILTIN_SKILL_AGENT_ID]
    const providerSkills = Array.from(this.metadataCache.values()).filter(
      (skill) => skill.readOnly || skill.ownerPluginId
    )
    const state = this.getStoredManagementState()
    let changed = false
    for (const agentId of agentIds) {
      const bindings = this.getAgentBindingState(state, agentId).bindings
      for (const skill of providerSkills) {
        if (bindings[skill.name]) continue
        bindings[skill.name] = {
          assigned: true,
          extension: createDefaultSkillExtensionConfig()
        }
        changed = true
      }
    }
    if (changed) this.saveManagementState(state)
  }

  async refreshAgentCatalog(agentId: string): Promise<SkillMetadata[]> {
    const normalizedAgentId = await this.requireAgentScope(agentId)
    this.metadataCache.clear()
    this.contentCache.clear()
    this.discoveryPromise = null
    this.builtinCatalogDiscovered = false
    await this.discoverSkills(BUILTIN_SKILL_AGENT_ID)
    return await this.getMetadataList(normalizedAgentId)
  }

  private async discoverSkillsOnMainThread(
    catalogRoot: string = this.skillsDir
  ): Promise<SkillMetadata[]> {
    const discovered = new Map<string, SkillMetadata>()
    const skillManifestPaths = (await this.collectSkillManifestPaths(catalogRoot)).sort(
      (left, right) => left.localeCompare(right)
    )

    for (const skillPath of skillManifestPaths) {
      const dirName = path.basename(path.dirname(skillPath))
      try {
        const metadata = await this.parseSkillMetadata(skillPath, dirName, undefined, catalogRoot)
        if (!metadata) {
          continue
        }
        if (discovered.has(metadata.name)) {
          logger.warn('[SkillService] Duplicate skill name discovered. Keeping the first entry.', {
            name: metadata.name,
            path: metadata.path
          })
          continue
        }
        discovered.set(metadata.name, metadata)
      } catch (error) {
        console.error(`[SkillService] Failed to parse skill at ${skillPath}:`, error)
      }
    }

    return Array.from(discovered.values())
  }

  private async discoverPluginSkillsOnMainThread(): Promise<SkillMetadata[]> {
    const discovered: SkillMetadata[] = []
    for (const contribution of this.pluginSkillContributions.values()) {
      const skillPath = path.join(contribution.skillRoot, 'SKILL.md')
      const dirName = path.basename(contribution.skillRoot)
      if (!(await this.pathExists(skillPath))) {
        logger.warn('[SkillService] Plugin skill contribution is missing SKILL.md.', {
          ownerPluginId: contribution.ownerPluginId,
          skillRoot: contribution.skillRoot
        })
        continue
      }

      const metadata = await this.parseSkillMetadata(skillPath, dirName, contribution.ownerPluginId)
      if (metadata) {
        discovered.push(metadata)
      }
    }

    return discovered
  }

  private async discoverReadOnlyBundledSkills(): Promise<SkillMetadata[]> {
    const builtinDir = this.resolveBuiltinSkillsDir()
    if (!builtinDir) return []

    const discovered: SkillMetadata[] = []
    for (const name of READ_ONLY_BUNDLED_SKILL_NAMES) {
      const skillPath = path.join(builtinDir, name, 'SKILL.md')
      if (!(await this.pathExists(skillPath))) continue
      const metadata = await this.parseSkillMetadata(skillPath, name, undefined, builtinDir)
      if (metadata && this.supportsCurrentPlatform(metadata.platforms)) {
        discovered.push({ ...metadata, readOnly: true })
      }
    }
    return discovered
  }

  /**
   * Parse SKILL.md frontmatter to extract metadata
   */
  private async parseSkillMetadata(
    skillPath: string,
    dirName: string,
    ownerPluginId?: string,
    catalogRoot: string = this.skillsDir
  ): Promise<SkillMetadata | null> {
    try {
      const skillRoot = path.dirname(skillPath)
      const confinedSkillPath = await this.resolvePhysicalSkillPath(skillRoot, skillPath)
      if (!confinedSkillPath) {
        logger.warn('[SkillService] Skill manifest is not physically confined to its Skill root.', {
          skillPath
        })
        return null
      }

      const content = await fs.promises.readFile(confinedSkillPath, 'utf-8')
      const { data } = matter(content)

      // Validate required fields
      if (
        typeof data.name !== 'string' ||
        typeof data.description !== 'string' ||
        !data.name ||
        !data.description.trim()
      ) {
        console.warn(`[SkillService] Skill ${dirName} missing required frontmatter fields`)
        return null
      }
      if (!this.isSafeSkillName(data.name)) {
        logger.warn('[SkillService] Skill manifest contains an unsafe Skill name.', {
          skillPath,
          name: data.name
        })
        return null
      }

      // Ensure name matches directory name
      if (data.name !== dirName) {
        console.warn(
          `[SkillService] Skill name "${data.name}" doesn't match directory "${dirName}"`
        )
      }

      return {
        name: data.name || dirName,
        description: data.description.trim(),
        path: confinedSkillPath,
        skillRoot,
        category: this.deriveSkillCategory(skillRoot, catalogRoot),
        platforms: Array.isArray(data.platforms)
          ? data.platforms.filter((platform): platform is string => typeof platform === 'string')
          : undefined,
        metadata:
          data.metadata && typeof data.metadata === 'object'
            ? (data.metadata as Record<string, unknown>)
            : undefined,
        allowedTools: Array.isArray(data.allowedTools)
          ? data.allowedTools.filter((t): t is string => typeof t === 'string')
          : undefined,
        executionSupportPaths: this.normalizeExecutionSupportPaths(data.executionSupportPaths),
        ownerPluginId
      }
    } catch (error) {
      console.error(`[SkillService] Error parsing skill metadata at ${skillPath}:`, error)
      return null
    }
  }

  /**
   * Get list of all skill metadata (from cache)
   * Uses discoveryPromise pattern to prevent race conditions
   */
  async getMetadataList(agentId: string = BUILTIN_SKILL_AGENT_ID): Promise<SkillMetadata[]> {
    const normalizedAgentId = await this.requireAgentScope(agentId)
    await this.ensureAgentCatalogDiscovered(normalizedAgentId)
    await this.ensureAgentBindingsInitialized(normalizedAgentId)
    return this.getVisibleMetadataFromCache(normalizedAgentId)
  }

  private getVisibleMetadataFromCache(agentId: string): SkillMetadata[] {
    return this.sortSkillMetadata(
      Array.from(this.getMetadataCacheForAgent(agentId).values()).filter((skill) =>
        this.isSkillVisible(skill, agentId)
      )
    )
  }

  private isSkillVisible(metadata: SkillMetadata, agentId: string): boolean {
    return Boolean(metadata) && this.isSkillAssigned(agentId, metadata.name)
  }

  private createDefaultManagementState(): SkillManagementState {
    return {
      version: 3,
      skills: {},
      agents: {}
    }
  }

  private sanitizeManagementItem(
    agentId: string,
    name: string,
    value: unknown
  ): SkillManagementItem | null {
    if (!this.isSafeSkillName(name) || !value || typeof value !== 'object') {
      return null
    }
    const raw = value as Partial<SkillManagementItem> & {
      deepchat?: { disabled?: unknown }
    }
    return {
      name,
      canonicalPath:
        typeof raw.canonicalPath === 'string' && raw.canonicalPath.trim()
          ? path.resolve(raw.canonicalPath)
          : path.join(this.getAgentSkillsRoot(agentId), name),
      disabled: raw.disabled === true || raw.deepchat?.disabled === true,
      extension: sanitizeSkillExtensionConfig(raw.extension),
      runtimeBindingId:
        typeof raw.runtimeBindingId === 'string' &&
        /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(raw.runtimeBindingId)
          ? raw.runtimeBindingId
          : undefined,
      source: this.sanitizeSkillSource(raw.source),
      agentLinks:
        raw.agentLinks && typeof raw.agentLinks === 'object'
          ? (raw.agentLinks as SkillManagementItem['agentLinks'])
          : undefined
    }
  }

  private sanitizeAgentManagementState(agentId: string, value: unknown): AgentSkillManagementState {
    const raw = value && typeof value === 'object' ? (value as Record<string, unknown>) : {}
    const rawSkills =
      raw.skills && typeof raw.skills === 'object' ? (raw.skills as Record<string, unknown>) : {}
    const skills: Record<string, SkillManagementItem> = {}
    for (const [name, item] of Object.entries(rawSkills)) {
      const sanitized = this.sanitizeManagementItem(agentId, name, item)
      if (sanitized) skills[name] = sanitized
    }
    return {
      skills,
      migratedAt: typeof raw.migratedAt === 'string' ? raw.migratedAt : undefined
    }
  }

  private getStoredManagementState(): SkillManagementState {
    const stored = this.settings.getManagementState()
    if (!stored || typeof stored !== 'object' || stored.version !== 3) {
      return this.createDefaultManagementState()
    }

    const raw = stored as unknown as Record<string, unknown>
    const skills: Record<string, SharedSkillManagementItem> = {}
    const rawSkills =
      raw.skills && typeof raw.skills === 'object'
        ? (raw.skills as Record<string, unknown>)
        : raw.library && typeof raw.library === 'object'
          ? (raw.library as Record<string, unknown>)
          : {}
    for (const [name, value] of Object.entries(rawSkills)) {
      if (!this.isSafeSkillName(name) || !value || typeof value !== 'object') continue
      const item = value as Partial<SharedSkillManagementItem>
      skills[name] = {
        name,
        canonicalPath:
          typeof item.canonicalPath === 'string' && item.canonicalPath.trim()
            ? path.resolve(item.canonicalPath)
            : path.join(this.skillsDir, name),
        source: this.sanitizeSkillSource(item.source)
      }
    }

    const agents: Record<string, AgentSkillBindingState> = {}
    const rawAgents =
      raw.agents && typeof raw.agents === 'object' ? (raw.agents as Record<string, unknown>) : {}
    for (const [agentId, value] of Object.entries(rawAgents)) {
      try {
        const normalizedAgentId = assertSafeSkillAgentId(agentId)
        const rawAgent =
          value && typeof value === 'object' ? (value as Record<string, unknown>) : {}
        const rawBindings =
          rawAgent.bindings && typeof rawAgent.bindings === 'object'
            ? (rawAgent.bindings as Record<string, unknown>)
            : {}
        const bindings: Record<string, AgentSkillBinding> = {}
        for (const [name, bindingValue] of Object.entries(rawBindings)) {
          if (!this.isSafeSkillName(name) || !bindingValue || typeof bindingValue !== 'object') {
            continue
          }
          const binding = bindingValue as Partial<AgentSkillBinding>
          bindings[name] = {
            assigned: binding.assigned === true,
            extension: sanitizeSkillExtensionConfig(binding.extension),
            runtimeBindingId:
              typeof binding.runtimeBindingId === 'string' &&
              /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(binding.runtimeBindingId)
                ? binding.runtimeBindingId
                : undefined
          }
        }
        agents[normalizedAgentId] = { bindings }
      } catch {
        // Ignore unsafe persisted Agent IDs.
      }
    }

    const rawMigration =
      raw.migration && typeof raw.migration === 'object'
        ? (raw.migration as Record<string, unknown>)
        : undefined
    const state: SkillManagementState = {
      version: 3,
      skills,
      agents,
      sync: this.sanitizeSyncDirectoryConfig(raw.sync),
      migration:
        rawMigration &&
        (rawMigration.sourceVersion === 1 || rawMigration.sourceVersion === 2) &&
        (rawMigration.status === 'planned' ||
          rawMigration.status === 'committing' ||
          rawMigration.status === 'completed') &&
        typeof rawMigration.startedAt === 'string'
          ? {
              sourceVersion: rawMigration.sourceVersion,
              status: rawMigration.status,
              startedAt: rawMigration.startedAt,
              completedAt:
                typeof rawMigration.completedAt === 'string' ? rawMigration.completedAt : undefined,
              agentSkillNames:
                rawMigration.agentSkillNames && typeof rawMigration.agentSkillNames === 'object'
                  ? (rawMigration.agentSkillNames as Record<string, Record<string, string>>)
                  : {}
            }
          : undefined
    }
    return state
  }

  private sanitizeSyncDirectoryConfig(value: unknown): SkillSyncDirectoryConfig | undefined {
    const raw =
      value && typeof value === 'object' ? (value as Partial<SkillSyncDirectoryConfig>) : {}
    if (typeof raw.skillsDirectory !== 'string' || !raw.skillsDirectory.trim()) {
      return undefined
    }

    return {
      skillsDirectory: path.resolve(raw.skillsDirectory),
      layout: 'multi-skill-repo',
      lastExportAt: typeof raw.lastExportAt === 'string' ? raw.lastExportAt : null,
      lastImportAt: typeof raw.lastImportAt === 'string' ? raw.lastImportAt : null
    }
  }

  private saveManagementState(state: SkillManagementState): void {
    this.settings.setManagementState(state)
  }

  private sanitizeSkillSource(value: unknown): SkillSource {
    const raw = value && typeof value === 'object' ? (value as Partial<SkillSource>) : {}
    const source: SkillSource = {
      type: this.normalizeSkillSourceType(raw.type)
    }
    if (typeof raw.repoUrl === 'string') source.repoUrl = raw.repoUrl
    if (raw.repoFormat === 'single-skill' || raw.repoFormat === 'multi-skill') {
      source.repoFormat = raw.repoFormat
    }
    if (typeof raw.agentId === 'string') source.agentId = raw.agentId
    if (typeof raw.originalPath === 'string') source.originalPath = raw.originalPath
    if (typeof raw.importedFrom === 'string') source.importedFrom = raw.importedFrom
    if (typeof raw.installedAt === 'string') source.installedAt = raw.installedAt
    if (typeof raw.importedAt === 'string') source.importedAt = raw.importedAt
    if (typeof raw.adoptedAt === 'string') source.adoptedAt = raw.adoptedAt
    return source
  }

  private normalizeSkillSourceType(value: unknown): SkillSourceType {
    const allowed: SkillSourceType[] = [
      'builtin',
      'created',
      'folder-install',
      'zip-install',
      'url-install',
      'git-install',
      'adopted',
      'imported'
    ]
    return typeof value === 'string' && allowed.includes(value as SkillSourceType)
      ? (value as SkillSourceType)
      : 'created'
  }

  private createDefaultSkillItem(name: string): SharedSkillManagementItem {
    return {
      name,
      canonicalPath: path.join(this.skillsDir, name),
      source: {
        type: 'created'
      }
    }
  }

  private updateSkillManagementItem(
    name: string,
    updater: (item: SharedSkillManagementItem) => SharedSkillManagementItem
  ): SharedSkillManagementItem {
    const state = this.getStoredManagementState()
    const nextItem = updater(state.skills[name] ?? this.createDefaultSkillItem(name))
    state.skills[name] = nextItem
    this.saveManagementState(state)
    return nextItem
  }

  private nextSkillRuntimeBindingId(
    binding: AgentSkillBinding,
    extension: SkillExtensionConfig
  ): string | undefined {
    if (Object.keys(extension.env).length === 0) return undefined
    return binding.runtimeBindingId &&
      sameSkillRuntimeEnvironment(binding.extension.env, extension.env)
      ? binding.runtimeBindingId
      : randomUUID()
  }

  private async captureSkillRuntimeSnapshot(
    agentId: string,
    name: string
  ): Promise<SkillRuntimeSnapshot> {
    const extension = await this.getSkillExtensionForAgent(agentId, name)
    if (Object.keys(extension.env).length === 0) {
      return { extension, environmentBindingId: null }
    }

    const state = this.getStoredManagementState()
    const binding = state.agents[agentId]?.bindings[name]
    if (!binding || !sameSkillRuntimeEnvironment(binding.extension.env, extension.env)) {
      throw new Error(`Skill "${name}" runtime environment changed while it was being resolved`)
    }
    if (!binding.runtimeBindingId) {
      // One-time migration for pre-binding extension state. New writes always assign this eagerly.
      binding.runtimeBindingId = randomUUID()
      this.saveManagementState(state)
    }
    return { extension, environmentBindingId: binding.runtimeBindingId }
  }

  private assertCurrentSkillRuntimeSnapshot(
    agentId: string,
    name: string,
    expected: SkillRuntimeSnapshot
  ): void {
    const binding = this.getStoredManagementState().agents[agentId]?.bindings[name]
    const extension = binding
      ? sanitizeSkillExtensionConfig(binding.extension)
      : createDefaultSkillExtensionConfig()
    const environmentBindingId =
      Object.keys(extension.env).length > 0 ? (binding?.runtimeBindingId ?? null) : null
    if (
      environmentBindingId !== expected.environmentBindingId ||
      !sameSkillExtension(extension, expected.extension)
    ) {
      throw new Error(`Skill "${name}" runtime configuration changed while it was being resolved`)
    }
  }

  private getAgentBindingState(
    state: SkillManagementState,
    agentId: string
  ): AgentSkillBindingState {
    const normalizedAgentId = assertSafeSkillAgentId(agentId)
    state.agents[normalizedAgentId] ??= { bindings: {} }
    return state.agents[normalizedAgentId]
  }

  private isSkillAssigned(agentId: string, name: string): boolean {
    return this.getStoredManagementState().agents[agentId]?.bindings[name]?.assigned === true
  }

  private getAssignedAgentIds(name: string): string[] {
    return Object.entries(this.getStoredManagementState().agents)
      .filter(([, agent]) => agent.bindings[name]?.assigned === true)
      .map(([agentId]) => agentId)
      .sort((left, right) => left.localeCompare(right))
  }

  private async ensureAgentBindingsInitialized(agentId: string): Promise<void> {
    const state = this.getStoredManagementState()
    if (state.agents[agentId]) return
    const agentState = this.getAgentBindingState(state, agentId)
    for (const metadata of this.metadataCache.values()) {
      if (!metadata.readOnly && !metadata.ownerPluginId) continue
      agentState.bindings[metadata.name] = {
        assigned: true,
        extension: createDefaultSkillExtensionConfig()
      }
    }
    this.saveManagementState(state)
  }

  async getSkillManagementState(): Promise<SkillManagementState> {
    return this.getStoredManagementState()
  }

  async setSkillDeepChatDisabled(name: string, disabled: boolean): Promise<void> {
    await this.setSkillDisabledForAgent(BUILTIN_SKILL_AGENT_ID, name, disabled)
  }

  async setSkillDisabledForAgent(agentId: string, name: string, disabled: boolean): Promise<void> {
    await this.setSkillAssignment(agentId, name, !disabled)
  }

  async setSkillAssignment(agentId: string, name: string, assigned: boolean): Promise<void> {
    await this.setSkillAssignmentForAgents([agentId], name, assigned)
  }

  async setSkillAssignmentForAgents(
    agentIds: string[],
    name: string,
    assigned: boolean
  ): Promise<void> {
    await this.runMutation(async () => {
      await this.setSkillAssignmentForAgentsUnlocked(agentIds, name, assigned)
    })
  }

  private async setSkillAssignmentForAgentsUnlocked(
    agentIds: string[],
    name: string,
    assigned: boolean
  ): Promise<void> {
    const normalizedAgentIds: string[] = []
    const finishOperations: Array<() => void> = []
    try {
      for (const agentId of Array.from(new Set(agentIds)).sort((left, right) =>
        left.localeCompare(right)
      )) {
        const normalizedAgentId = await this.requireAgentScope(agentId)
        if (normalizedAgentIds.includes(normalizedAgentId)) continue
        normalizedAgentIds.push(normalizedAgentId)
        finishOperations.push(this.beginAgentScopeOperation(normalizedAgentId))
      }
      if (normalizedAgentIds.length === 0) throw new Error('At least one target Agent is required')
      await this.ensureAgentCatalogDiscovered(normalizedAgentIds[0])
      if (!this.metadataCache.has(name)) {
        throw new Error(`Skill "${name}" not found`)
      }
      for (const agentId of normalizedAgentIds) {
        await this.ensureAgentBindingsInitialized(agentId)
        this.assertAgentScopeActive(agentId)
      }
      const state = this.getStoredManagementState()
      for (const agentId of normalizedAgentIds) {
        const bindingState = this.getAgentBindingState(state, agentId)
        const previous = bindingState.bindings[name]
        bindingState.bindings[name] = {
          assigned,
          extension: sanitizeSkillExtensionConfig(previous?.extension),
          runtimeBindingId: previous?.runtimeBindingId
        }
      }
      this.saveManagementState(state)
      if (!assigned) {
        await Promise.all(
          normalizedAgentIds.map((agentId) => this.revalidateSessionsForAgent(agentId))
        )
      }
      this.publishEvent('skills.catalog.changed', {
        reason: 'assignments-updated',
        name,
        agentIds: normalizedAgentIds,
        version: Date.now()
      })
    } finally {
      for (const finishOperation of finishOperations.reverse()) finishOperation()
    }
  }

  async setSkillAssignments(agentId: string, skillNames: string[]): Promise<string[]> {
    return await this.runMutation(
      async () => await this.setSkillAssignmentsUnlocked(agentId, skillNames)
    )
  }

  private async setSkillAssignmentsUnlocked(
    agentId: string,
    skillNames: string[]
  ): Promise<string[]> {
    const normalizedAgentId = await this.requireAgentScope(agentId)
    const finishOperation = this.beginAgentScopeOperation(normalizedAgentId)
    try {
      await this.ensureAgentCatalogDiscovered(normalizedAgentId)
      const requested = new Set(skillNames)
      for (const name of requested) {
        if (!this.metadataCache.has(name)) throw new Error(`Skill "${name}" not found`)
      }
      const state = this.getStoredManagementState()
      const bindingState = this.getAgentBindingState(state, normalizedAgentId)
      for (const name of this.metadataCache.keys()) {
        const previous = bindingState.bindings[name]
        bindingState.bindings[name] = {
          assigned: requested.has(name),
          extension: sanitizeSkillExtensionConfig(previous?.extension),
          runtimeBindingId: previous?.runtimeBindingId
        }
      }
      this.saveManagementState(state)
      await this.revalidateSessionsForAgent(normalizedAgentId)
      this.publishEvent('skills.catalog.changed', {
        reason: 'assignments-updated',
        agentIds: [normalizedAgentId],
        version: Date.now()
      })
      return Array.from(requested).sort((left, right) => left.localeCompare(right))
    } finally {
      finishOperation()
    }
  }

  private async revalidateSessionsForAgent(agentId: string): Promise<void> {
    if (!this.agentScopePort) return
    try {
      for (const session of await this.agentScopePort.listSessions()) {
        if (session.agentId !== agentId) continue
        await this.revalidateActiveSkillsForAgent(session.id, agentId)
      }
    } catch (error) {
      logger.warn('[SkillService] Failed to persist revalidated Session Skills.', {
        agentId,
        error
      })
    }
  }

  async getUnifiedSkillCatalog(
    agentId: string = BUILTIN_SKILL_AGENT_ID
  ): Promise<UnifiedSkillItem[]> {
    const normalizedAgentId = await this.requireAgentScope(agentId)
    await this.ensureAgentCatalogDiscovered(normalizedAgentId)
    await this.ensureAgentBindingsInitialized(normalizedAgentId)

    const state = this.getStoredManagementState()
    return this.sortSkillMetadata(Array.from(this.metadataCache.values()))
      .filter((skill) => state.agents[normalizedAgentId]?.bindings[skill.name]?.assigned === true)
      .map((skill) => this.toUnifiedSkillItem(skill, normalizedAgentId, state))
  }

  async getAllSkills(): Promise<UnifiedSkillItem[]> {
    await this.ensureAgentCatalogDiscovered(BUILTIN_SKILL_AGENT_ID)
    const state = this.getStoredManagementState()
    return this.sortSkillMetadata(Array.from(this.metadataCache.values())).map((skill) =>
      this.toUnifiedSkillItem(skill, BUILTIN_SKILL_AGENT_ID, state, true)
    )
  }

  private toUnifiedSkillItem(
    skill: SkillMetadata,
    agentId: string,
    state: SkillManagementState,
    globalView = false
  ): UnifiedSkillItem {
    const item = state.skills[skill.name] ?? this.createDefaultSkillItem(skill.name)
    const assignedAgentIds = Object.entries(state.agents)
      .filter(([, agent]) => agent.bindings[skill.name]?.assigned === true)
      .map(([assignedAgentId]) => assignedAgentId)
      .sort((left, right) => left.localeCompare(right))
    const assigned = state.agents[agentId]?.bindings[skill.name]?.assigned === true
    return {
      ...skill,
      agentId,
      canonicalPath: skill.readOnly || skill.ownerPluginId ? skill.skillRoot : item.canonicalPath,
      sourceType: skill.readOnly || skill.ownerPluginId ? 'builtin' : item.source.type,
      assigned,
      assignedAgentIds: globalView ? assignedAgentIds : [],
      disabled: !assigned,
      deepchatDisabled: !assigned,
      agentLinks: {},
      mutable: !skill.ownerPluginId && !skill.readOnly
    }
  }

  private sortSkillMetadata(skills: SkillMetadata[]): SkillMetadata[] {
    return [...skills].sort((left, right) => {
      return (
        (left.category ?? '').localeCompare(right.category ?? '') ||
        left.name.localeCompare(right.name)
      )
    })
  }

  /**
   * Load full skill content (lazy loading)
   */
  async loadSkillContent(name: string): Promise<SkillContent | null>
  async loadSkillContent(agentId: string, name: string): Promise<SkillContent | null>
  async loadSkillContent(agentIdOrName: string, maybeName?: string): Promise<SkillContent | null> {
    const agentId =
      maybeName === undefined ? BUILTIN_SKILL_AGENT_ID : await this.requireAgentScope(agentIdOrName)
    const name = maybeName ?? agentIdOrName
    const metadataCache = this.getMetadataCacheForAgent(agentId)
    const contentCache = this.getContentCacheForAgent(agentId)
    await this.ensureAgentCatalogDiscovered(agentId)

    // Get metadata to find the path
    const metadata = metadataCache.get(name)
    if (!metadata) {
      console.warn(`[SkillService] Skill not found: ${name}`)
      return null
    }

    // Rendered content includes Agent-specific runtime configuration.
    if (contentCache.has(name)) {
      return contentCache.get(name)!
    }

    try {
      const build = await this.buildEffectiveSkillContent(agentId, metadata)
      if (!build) return null
      const skillContent = build.skillContent

      // Discovery may have refreshed the caches while we were reading from disk;
      // only cache when this skill's metadata entry is still the one we read from.
      if (metadataCache.get(name) === metadata) {
        contentCache.set(name, skillContent)
      }
      return skillContent
    } catch (error) {
      console.error(`[SkillService] Error loading skill content for ${name}:`, error)
      return null
    }
  }

  private async buildEffectiveSkillContent(
    agentId: string,
    metadata: SkillMetadata,
    freshEvidence: boolean = false
  ): Promise<EffectiveSkillContentBuild | null> {
    const confinedSkillPath = await this.resolvePhysicalSkillPath(metadata.skillRoot, metadata.path)
    if (!confinedSkillPath) {
      logger.warn('[SkillService] Refusing to load a Skill manifest outside its physical root.', {
        agentId,
        name: metadata.name,
        skillPath: metadata.path
      })
      return null
    }

    let rawContent: string
    let freshManifestBytes: Buffer | undefined
    if (freshEvidence) {
      freshManifestBytes = await this.readStableRegularFile(
        confinedSkillPath,
        SKILL_CONFIG.SKILL_FILE_MAX_SIZE
      )
      rawContent = freshManifestBytes.toString('utf8')
    } else {
      const stats = await fs.promises.stat(confinedSkillPath)
      if (stats.size > SKILL_CONFIG.SKILL_FILE_MAX_SIZE) {
        throw new Error(
          `[SkillService] Skill file too large: ${stats.size} bytes (max: ${SKILL_CONFIG.SKILL_FILE_MAX_SIZE})`
        )
      }
      rawContent = await fs.promises.readFile(confinedSkillPath, 'utf-8')
    }
    const { content, data } = matter(rawContent)
    if (
      freshEvidence &&
      (data.name !== metadata.name ||
        typeof data.description !== 'string' ||
        !data.description.trim())
    ) {
      throw new Error('Skill manifest identity changed before materialization')
    }
    const renderedContent = this.replacePathVariables(content, metadata, agentId).trim()
    const executionSupportPaths = freshEvidence
      ? this.normalizeExecutionSupportPaths(data.executionSupportPaths, true)
      : undefined
    const legacySupport =
      LEGACY_BUILTIN_EXECUTION_SUPPORT_MIGRATIONS[
        metadata.name as keyof typeof LEGACY_BUILTIN_EXECUTION_SUPPORT_MIGRATIONS
      ]
    const undeclaredLegacySupportPaths =
      freshEvidence &&
      executionSupportPaths === undefined &&
      legacySupport &&
      createHash('sha256').update(rawContent).digest('hex') === legacySupport.manifestHash
        ? legacySupport.supportPaths
        : []
    const freshPackage = freshEvidence
      ? await this.snapshotSkillExecutionPackage(
          agentId,
          metadata,
          executionSupportPaths,
          undeclaredLegacySupportPaths
        )
      : undefined
    if (freshManifestBytes) {
      const confirmedManifestBytes = await this.readStableRegularFile(
        confinedSkillPath,
        SKILL_CONFIG.SKILL_FILE_MAX_SIZE
      )
      if (!confirmedManifestBytes.equals(freshManifestBytes)) {
        throw new Error('Skill manifest changed while its execution package was being snapshotted')
      }
    }
    const scripts =
      freshPackage?.scripts ?? (await this.listSkillScriptsFromMetadata(agentId, metadata))
    const runtimeInstructions = this.buildRuntimeInstructions(metadata, scripts)
    const scriptInventory = scripts.map(({ relativePath, runtime, enabled, description }) => ({
      relativePath,
      runtime,
      enabled,
      ...(description ? { description } : {})
    }))
    return {
      skillContent: {
        name: metadata.name,
        content: [renderedContent, runtimeInstructions].filter(Boolean).join('\n\n')
      },
      renderedManifest: renderedContent,
      scriptInventory,
      executionPackage: freshPackage?.executionPackage
    }
  }

  private buildEffectiveSkillContentResolution(
    agentId: string,
    metadata: SkillMetadata,
    build: EffectiveSkillContentBuild
  ): EffectiveSkillContentResolution {
    if (!build.executionPackage) {
      throw new Error('Fresh Skill execution package was not constructed')
    }
    return {
      identity: this.buildSkillContentIdentity(agentId, metadata),
      effectiveContent: build.skillContent.content,
      builderVersion: EFFECTIVE_SKILL_CONTENT_BUILDER_VERSION,
      renderedManifestHash: this.hashSkillEvidence(build.renderedManifest),
      scriptInventoryHash: this.hashSkillEvidence(JSON.stringify(build.scriptInventory)),
      executionPackage: build.executionPackage
    }
  }

  async resolveFreshEffectiveSkillContents(
    agentId: string,
    names: readonly string[]
  ): Promise<EffectiveSkillContentResolution[]> {
    const normalizedAgentId = await this.requireAgentScope(agentId)
    await this.ensureAgentCatalogDiscovered(normalizedAgentId)
    const metadataCache = this.getMetadataCacheForAgent(normalizedAgentId)

    const resolutions: EffectiveSkillContentResolution[] = []
    let effectiveContentBytes = 0
    let packageBytes = 0
    let encodedPackageBytes = 0
    for (const name of names) {
      const metadata = metadataCache.get(name)
      if (!metadata || !this.isSkillVisible(metadata, normalizedAgentId)) {
        throw new Error(`[SkillService] Requested visible Skill "${name}" is no longer available`)
      }

      try {
        // Intentionally bypass contentCache: materialization must describe current disk state.
        const build = await this.buildEffectiveSkillContent(normalizedAgentId, metadata, true)
        if (!build) {
          throw new Error('manifest could not be loaded safely')
        }
        if (
          metadataCache.get(name) !== metadata ||
          !this.isSkillVisible(metadata, normalizedAgentId)
        ) {
          throw new Error('catalog changed while effective content was being resolved')
        }
        if (
          Buffer.byteLength(build.skillContent.content, 'utf8') > SKILL_EFFECTIVE_CONTENT_MAX_BYTES
        ) {
          throw new Error(`effective content exceeds ${SKILL_EFFECTIVE_CONTENT_MAX_BYTES} bytes`)
        }
        const resolution = this.buildEffectiveSkillContentResolution(
          normalizedAgentId,
          metadata,
          build
        )
        if (
          metadataCache.get(name) !== metadata ||
          !this.isSkillVisible(metadata, normalizedAgentId)
        ) {
          throw new Error('catalog changed while execution package was being snapshotted')
        }
        effectiveContentBytes += Buffer.byteLength(resolution.effectiveContent, 'utf8')
        packageBytes += resolution.executionPackage.files.reduce(
          (total, file) => total + file.byteCount,
          0
        )
        const currentEncodedBytes = Buffer.byteLength(
          JSON.stringify(resolution.executionPackage),
          'utf8'
        )
        encodedPackageBytes += currentEncodedBytes
        if (effectiveContentBytes > SKILL_EFFECTIVE_CONTENT_MAX_BATCH_BYTES) {
          throw new Error('effective content batch exceeds 2 MiB')
        }
        if (packageBytes > SKILL_EXECUTION_PACKAGE_MAX_BATCH_BYTES) {
          throw new Error('execution package batch exceeds 16 MiB')
        }
        if (currentEncodedBytes > SKILL_EXECUTION_PACKAGE_MAX_ENCODED_BYTES) {
          throw new Error('execution package encoding exceeds 7 MiB')
        }
        if (encodedPackageBytes > SKILL_EXECUTION_PACKAGE_MAX_BATCH_ENCODED_BYTES) {
          throw new Error('execution package encoded batch exceeds 28 MiB')
        }
        resolutions.push(resolution)
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        throw new Error(`[SkillService] Failed to resolve requested Skill "${name}": ${message}`)
      }
    }
    return resolutions
  }

  private hashSkillEvidence(value: string): string {
    return createHash('sha256').update(value, 'utf8').digest('hex')
  }

  private async readStableRegularFile(filePath: string, maxBytes: number): Promise<Buffer> {
    const before = await fs.promises.lstat(filePath)
    if (
      before.isSymbolicLink() ||
      !before.isFile() ||
      (before.nlink !== undefined && before.nlink !== 1)
    ) {
      throw new Error(`execution evidence rejects unsafe file: ${filePath}`)
    }
    if (before.size > maxBytes) {
      throw new Error(`execution evidence file exceeds ${maxBytes} bytes: ${filePath}`)
    }
    const handle = await fs.promises.open(
      filePath,
      fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW ?? 0)
    )
    try {
      const opened = await handle.stat()
      if (
        !opened.isFile() ||
        opened.dev !== before.dev ||
        opened.ino !== before.ino ||
        (opened.nlink !== undefined && opened.nlink !== 1) ||
        !Number.isSafeInteger(opened.size) ||
        opened.size < 0 ||
        opened.size > maxBytes
      ) {
        throw new Error(`execution evidence file changed before read: ${filePath}`)
      }
      const bytes = Buffer.allocUnsafe(opened.size)
      let offset = 0
      while (offset < opened.size) {
        const { bytesRead } = await handle.read(bytes, offset, opened.size - offset, offset)
        if (bytesRead === 0) {
          throw new Error(`execution evidence file changed during read: ${filePath}`)
        }
        offset += bytesRead
      }
      const trailing = Buffer.allocUnsafe(1)
      if ((await handle.read(trailing, 0, 1, opened.size)).bytesRead !== 0) {
        throw new Error(`execution evidence file exceeds ${maxBytes} bytes: ${filePath}`)
      }
      const after = await handle.stat()
      if (
        after.dev !== opened.dev ||
        after.ino !== opened.ino ||
        after.size !== opened.size ||
        after.mtimeMs !== opened.mtimeMs ||
        after.ctimeMs !== opened.ctimeMs ||
        bytes.byteLength !== opened.size
      ) {
        throw new Error(`execution evidence file changed during read: ${filePath}`)
      }
      const finalPath = await fs.promises.lstat(filePath)
      if (
        finalPath.isSymbolicLink() ||
        !finalPath.isFile() ||
        finalPath.dev !== opened.dev ||
        finalPath.ino !== opened.ino ||
        finalPath.size !== opened.size ||
        finalPath.mtimeMs !== opened.mtimeMs ||
        finalPath.ctimeMs !== opened.ctimeMs
      ) {
        throw new Error(`execution evidence path changed during read: ${filePath}`)
      }
      return bytes
    } finally {
      await handle.close()
    }
  }

  private assertPortableExecutionPackagePath(relativePath: string): void {
    if (
      !relativePath ||
      relativePath !== relativePath.normalize('NFC') ||
      relativePath.startsWith('/') ||
      /^[A-Za-z]:\//.test(relativePath) ||
      relativePath.includes('\\') ||
      relativePath.includes('\0') ||
      relativePath.split('/').length > SKILL_EXECUTION_PACKAGE_MAX_DEPTH + 2 ||
      Buffer.byteLength(relativePath, 'utf8') > SKILL_EXECUTION_PACKAGE_MAX_PATH_BYTES
    ) {
      throw new Error(`execution package contains a non-portable path: ${relativePath}`)
    }
    const windowsDevices = /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])$/i
    for (const segment of relativePath.split('/')) {
      const deviceStem = segment.split('.')[0].replace(/[ .]+$/g, '')
      if (
        !segment ||
        segment === '.' ||
        segment === '..' ||
        segment.startsWith('.') ||
        segment.endsWith('.') ||
        segment.endsWith(' ') ||
        /[<>:"|?*]/.test(segment) ||
        Array.from(segment).some((character) => character.charCodeAt(0) <= 0x1f) ||
        windowsDevices.test(deviceStem)
      ) {
        throw new Error(`execution package contains a non-portable path: ${relativePath}`)
      }
    }
  }

  private async snapshotSkillExecutionPackage(
    agentId: string,
    metadata: SkillMetadata,
    executionSupportPaths?: readonly string[],
    undeclaredLegacySupportPaths: readonly string[] = []
  ): Promise<SkillExecutionPackageSnapshot> {
    const empty = (): SkillExecutionPackageSnapshot => {
      const extension = createDefaultSkillExtensionConfig()
      return {
        scripts: [],
        executionPackage: {
          files: [],
          executables: [],
          runtimePolicy: extension.runtimePolicy,
          environmentBindingId: null
        }
      }
    }
    if (executionSupportPaths === undefined) {
      for (const supportPath of undeclaredLegacySupportPaths) {
        if (await this.pathExists(path.join(metadata.skillRoot, supportPath))) {
          throw new Error(
            `Skill "${metadata.name}" has legacy runtime files but no executionSupportPaths declaration; reinstall it or declare "${supportPath}" explicitly`
          )
        }
      }
    }
    const declaredSupportPaths = [...(executionSupportPaths ?? [])]
    if (declaredSupportPaths.length > SKILL_EXECUTION_PACKAGE_MAX_SUPPORT_PATHS) {
      throw new Error(
        `execution package exceeds ${SKILL_EXECUTION_PACKAGE_MAX_SUPPORT_PATHS} support paths`
      )
    }
    const packageRoots = ['scripts', ...declaredSupportPaths]
    for (const supportPath of declaredSupportPaths) {
      this.assertPortableExecutionPackagePath(supportPath)
      const foldedSupportPath = supportPath.toLowerCase()
      if (
        foldedSupportPath === 'scripts' ||
        foldedSupportPath.startsWith('scripts/') ||
        foldedSupportPath === 'skill.md'
      ) {
        throw new Error(`execution package support path is reserved: ${supportPath}`)
      }
    }
    packageRoots.sort((left, right) =>
      Buffer.compare(Buffer.from(left, 'utf8'), Buffer.from(right, 'utf8'))
    )
    for (let leftIndex = 0; leftIndex < packageRoots.length; leftIndex += 1) {
      for (let rightIndex = leftIndex + 1; rightIndex < packageRoots.length; rightIndex += 1) {
        const left = packageRoots[leftIndex].toLowerCase()
        const right = packageRoots[rightIndex].toLowerCase()
        if (left === right || left.startsWith(`${right}/`) || right.startsWith(`${left}/`)) {
          throw new Error(
            `execution package support paths overlap: ${packageRoots[leftIndex]}, ${packageRoots[rightIndex]}`
          )
        }
      }
    }

    const scriptsDir = path.join(metadata.skillRoot, 'scripts')
    if (!(await this.pathExists(scriptsDir))) {
      if (declaredSupportPaths.length > 0) {
        throw new Error('executionSupportPaths requires a scripts directory')
      }
      return empty()
    }
    const confinedScriptsDir = await this.resolvePhysicalSkillPath(metadata.skillRoot, scriptsDir)
    if (!confinedScriptsDir) {
      throw new Error('execution package scripts directory could not be loaded safely')
    }

    const files: EffectiveSkillContentResolution['executionPackage']['files'] = []
    const discoveredScripts: SkillScriptDescriptor[] = []
    let packageBytes = 0
    let directoryCount = 0
    const snapshotFile = async (absolutePath: string, relativePath: string): Promise<void> => {
      this.assertPortableExecutionPackagePath(relativePath)
      const before = await fs.promises.lstat(absolutePath)
      if (before.isSymbolicLink())
        throw new Error(`execution package rejects symlink: ${relativePath}`)
      if (!before.isFile()) {
        throw new Error(`execution package rejects special file: ${relativePath}`)
      }
      if (files.length >= SKILL_EXECUTION_PACKAGE_MAX_FILES) {
        throw new Error(`execution package exceeds ${SKILL_EXECUTION_PACKAGE_MAX_FILES} files`)
      }
      const bytes = await this.readStableRegularFile(
        absolutePath,
        SKILL_EXECUTION_PACKAGE_MAX_FILE_BYTES
      )
      packageBytes += bytes.byteLength
      if (packageBytes > SKILL_EXECUTION_PACKAGE_MAX_BYTES) {
        throw new Error('execution package exceeds 4 MiB')
      }
      files.push({
        relativePath,
        base64: bytes.toString('base64'),
        byteCount: bytes.byteLength,
        sha256: createHash('sha256').update(bytes).digest('hex')
      })
      const runtime = relativePath.startsWith('scripts/')
        ? SUPPORTED_SCRIPT_EXTENSIONS[path.extname(relativePath).toLowerCase()]
        : undefined
      if (runtime) {
        discoveredScripts.push({
          name: path.basename(relativePath),
          relativePath,
          absolutePath,
          runtime,
          enabled: true
        })
      }
    }
    const visit = async (directory: string, prefix = '', depth = 0): Promise<void> => {
      if (depth > SKILL_EXECUTION_PACKAGE_MAX_DEPTH) {
        throw new Error(
          `execution package exceeds ${SKILL_EXECUTION_PACKAGE_MAX_DEPTH} directory levels`
        )
      }
      directoryCount += 1
      if (directoryCount > SKILL_EXECUTION_PACKAGE_MAX_DIRECTORIES) {
        throw new Error(
          `execution package exceeds ${SKILL_EXECUTION_PACKAGE_MAX_DIRECTORIES} directories`
        )
      }
      const directoryBefore = await fs.promises.lstat(directory)
      if (directoryBefore.isSymbolicLink() || !directoryBefore.isDirectory()) {
        throw new Error(`execution package rejects unsafe directory: ${prefix || '.'}`)
      }
      const entries: fs.Dirent[] = []
      const openedDirectory = await fs.promises.opendir(directory)
      for await (const entry of openedDirectory) {
        if (
          entries.length >=
          SKILL_EXECUTION_PACKAGE_MAX_FILES + SKILL_EXECUTION_PACKAGE_MAX_DIRECTORIES
        ) {
          throw new Error('execution package directory contains too many entries')
        }
        entries.push(entry)
      }
      entries.sort((left, right) =>
        Buffer.compare(Buffer.from(left.name, 'utf8'), Buffer.from(right.name, 'utf8'))
      )
      for (const entry of entries) {
        if (!entry.name || entry.name !== entry.name.normalize('NFC')) {
          throw new Error('execution package contains a non-NFC path')
        }
        if (entry.name.startsWith('.')) {
          throw new Error(`execution package rejects hidden path: ${entry.name}`)
        }
        const relativePath = prefix ? `${prefix}/${entry.name}` : entry.name
        this.assertPortableExecutionPackagePath(relativePath)
        const absolutePath = path.join(directory, entry.name)
        const before = await fs.promises.lstat(absolutePath)
        if (before.isSymbolicLink())
          throw new Error(`execution package rejects symlink: ${relativePath}`)
        if (before.isDirectory()) {
          await visit(absolutePath, relativePath, depth + 1)
          continue
        }
        await snapshotFile(absolutePath, relativePath)
      }
      const directoryAfter = await fs.promises.lstat(directory)
      if (
        !directoryAfter.isDirectory() ||
        directoryAfter.isSymbolicLink() ||
        directoryAfter.dev !== directoryBefore.dev ||
        directoryAfter.ino !== directoryBefore.ino ||
        directoryAfter.mtimeMs !== directoryBefore.mtimeMs ||
        directoryAfter.ctimeMs !== directoryBefore.ctimeMs
      ) {
        throw new Error(`execution package directory changed during read: ${prefix || '.'}`)
      }
    }
    for (const packageRoot of packageRoots) {
      const absolutePath =
        packageRoot === 'scripts'
          ? confinedScriptsDir
          : path.join(metadata.skillRoot, ...packageRoot.split('/'))
      const confinedPath = await this.resolvePhysicalSkillPath(metadata.skillRoot, absolutePath)
      if (!confinedPath) {
        throw new Error(`execution package support path could not be loaded safely: ${packageRoot}`)
      }
      const stat = await fs.promises.lstat(confinedPath)
      if (stat.isDirectory()) await visit(confinedPath, packageRoot)
      else await snapshotFile(confinedPath, packageRoot)
    }

    files.sort((left, right) =>
      Buffer.compare(
        Buffer.from(left.relativePath, 'utf8'),
        Buffer.from(right.relativePath, 'utf8')
      )
    )
    const folded = new Set<string>()
    for (const file of files) {
      const key = file.relativePath.toLowerCase()
      if (folded.has(key)) throw new Error(`execution package path collision: ${file.relativePath}`)
      folded.add(key)
    }
    const runtimeSnapshot = await this.captureSkillRuntimeSnapshot(agentId, metadata.name)
    const scripts = discoveredScripts
      .map((script) => {
        const legacyRelativePath = script.relativePath.replaceAll('/', path.sep)
        const override =
          runtimeSnapshot.extension.scriptOverrides[script.relativePath] ??
          runtimeSnapshot.extension.scriptOverrides[legacyRelativePath] ??
          {}
        return {
          ...script,
          enabled: override.enabled ?? true,
          description: override.description
        }
      })
      .sort((left, right) =>
        Buffer.compare(
          Buffer.from(left.relativePath, 'utf8'),
          Buffer.from(right.relativePath, 'utf8')
        )
      )
    this.assertCurrentSkillRuntimeSnapshot(agentId, metadata.name, runtimeSnapshot)
    const executionPackage: EffectiveSkillExecutionPackage = {
      files,
      executables: scripts.map(({ relativePath, runtime, enabled }) => ({
        relativePath,
        runtime,
        enabled
      })),
      runtimePolicy: runtimeSnapshot.extension.runtimePolicy,
      environmentBindingId: runtimeSnapshot.environmentBindingId
    }
    return {
      scripts,
      executionPackage
    }
  }

  async viewSkillForAgent(
    agentId: string,
    name: string,
    options?: { filePath?: string; conversationId?: string; activeSkillNames?: readonly string[] }
  ): Promise<RuntimeSkillViewResult> {
    const normalizedAgentId = await this.requireAgentScope(agentId)
    return await this.viewSkillInAgentScope(normalizedAgentId, name, options, true)
  }

  async viewSkill(
    name: string,
    options?: { filePath?: string; conversationId?: string }
  ): Promise<SkillViewResult> {
    const {
      contentIdentity: _contentIdentity,
      contentResolution: _contentResolution,
      ...result
    } = await this.viewSkillInAgentScope(BUILTIN_SKILL_AGENT_ID, name, options, false)
    return result
  }

  private async viewSkillInAgentScope(
    agentId: string,
    name: string,
    options:
      | { filePath?: string; conversationId?: string; activeSkillNames?: readonly string[] }
      | undefined,
    captureExecutionSnapshot: boolean
  ): Promise<RuntimeSkillViewResult> {
    const metadataCache = this.getMetadataCacheForAgent(agentId)
    await this.ensureAgentCatalogDiscovered(agentId)

    const metadata = metadataCache.get(name)
    const authorizedForRun = options?.activeSkillNames?.includes(name) === true
    if (!metadata || (!authorizedForRun && !this.isSkillVisible(metadata, agentId))) {
      return {
        success: false,
        error: `Skill "${name}" not found`
      }
    }

    const pinnedSkills = options?.conversationId
      ? await this.getActiveSkills(options.conversationId)
      : []
    const isPinned = pinnedSkills.includes(metadata.name)

    if (options?.filePath?.trim()) {
      try {
        const requestedFilePath = options.filePath.trim()
        const candidatePath = this.resolveSkillRelativePath(metadata.skillRoot, requestedFilePath)
        if (!candidatePath) {
          return {
            success: false,
            error: 'Requested skill file is outside the skill root'
          }
        }

        if (!(await this.pathExists(candidatePath))) {
          return {
            success: false,
            error: `Skill file not found: ${requestedFilePath}`
          }
        }

        const resolvedPath = await this.resolvePhysicalSkillPath(metadata.skillRoot, candidatePath)
        if (!resolvedPath) {
          return {
            success: false,
            error: 'Requested skill file is outside the physical skill root'
          }
        }

        const stats = await fs.promises.stat(resolvedPath)
        if (!stats.isFile()) {
          return {
            success: false,
            error: 'Requested skill path is not a file'
          }
        }
        if (stats.size > SKILL_CONFIG.MAX_LINKED_FILE_SIZE) {
          return {
            success: false,
            error: 'Requested skill file is too large to load inline'
          }
        }
        if (this.isBinaryLikeFile(resolvedPath)) {
          return {
            success: false,
            error: 'Binary skill files cannot be loaded with skill_view'
          }
        }

        return {
          success: true,
          name: metadata.name,
          category: metadata.category ?? null,
          skillRoot: metadata.skillRoot,
          filePath: path.relative(metadata.skillRoot, resolvedPath),
          content: await fs.promises.readFile(resolvedPath, 'utf-8'),
          platforms: metadata.platforms,
          metadata: metadata.metadata,
          isPinned
        }
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error)
        console.error('[SkillService] Failed to load requested skill file for skill_view:', {
          name: metadata.name,
          filePath: options.filePath.trim(),
          error
        })
        return {
          success: false,
          error: `Failed to load requested skill file: ${errorMessage}`
        }
      }
    }

    try {
      const build = await this.buildEffectiveSkillContent(
        agentId,
        metadata,
        captureExecutionSnapshot
      )
      if (!build) {
        return {
          success: false,
          error: 'Skill manifest could not be loaded safely'
        }
      }
      const skillContent = build.skillContent
      const contentResolution = captureExecutionSnapshot
        ? this.buildEffectiveSkillContentResolution(agentId, metadata, build)
        : undefined
      if (
        captureExecutionSnapshot &&
        (metadataCache.get(name) !== metadata ||
          (!authorizedForRun && !this.isSkillVisible(metadata, agentId)))
      ) {
        throw new Error('Skill catalog changed while its execution snapshot was being built')
      }
      const effectiveContentBytes = Buffer.byteLength(skillContent.content, 'utf8')
      if (effectiveContentBytes > SKILL_EFFECTIVE_CONTENT_MAX_BYTES) {
        return {
          success: false,
          error: `Effective Skill content exceeds ${SKILL_EFFECTIVE_CONTENT_MAX_BYTES} bytes and cannot be activated inline`
        }
      }
      return {
        success: true,
        name: metadata.name,
        category: metadata.category ?? null,
        skillRoot: metadata.skillRoot,
        filePath: null,
        content: skillContent.content,
        platforms: metadata.platforms,
        metadata: metadata.metadata,
        linkedFiles: await this.listSkillLinkedFiles(metadata.skillRoot),
        isPinned,
        contentIdentity:
          contentResolution?.identity ?? this.buildSkillContentIdentity(agentId, metadata),
        ...(contentResolution ? { contentResolution } : {})
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error)
      console.error('[SkillService] Failed to load skill_view content:', {
        name: metadata.name,
        path: metadata.path,
        error
      })
      return {
        success: false,
        error: errorMessage.startsWith('[SkillService] Skill file too large:')
          ? errorMessage
          : `Failed to load skill view: ${errorMessage}`
      }
    }
  }

  private buildSkillContentIdentity(
    agentId: string,
    metadata: SkillMetadata
  ): RuntimeSkillContentIdentity {
    const state = this.getStoredManagementState()
    const item = state.skills[metadata.name] ?? this.createDefaultSkillItem(metadata.name)
    return {
      agentId,
      sourceType: metadata.readOnly ? 'builtin' : item.source.type,
      sourceId: metadata.readOnly
        ? metadata.skillRoot
        : metadata.ownerPluginId
          ? metadata.skillRoot
          : item.canonicalPath || metadata.skillRoot,
      skillName: metadata.name
    }
  }

  async manageDraftSkill(
    conversationId: string,
    request: SkillManageRequest,
    options: { beforeMutation?: () => void } = {}
  ): Promise<SkillManageResult> {
    const action = request.action
    let mutationCommitFailed = false
    const commitMutation = () => {
      try {
        options.beforeMutation?.()
      } catch (error) {
        mutationCommitFailed = true
        throw error
      }
    }

    try {
      switch (action) {
        case 'create': {
          const parsed = this.validateDraftSkillDocument(request.content)
          if (!parsed.success) {
            return { success: false, action, error: parsed.error }
          }
          if (!this.validateDraftConversationId(conversationId)) {
            return { success: false, action, error: 'Invalid conversationId for draft access' }
          }
          commitMutation()
          const { draftId, draftPath } = this.createDraftHandle(conversationId)
          await this.atomicWriteFile(path.join(draftPath, 'SKILL.md'), request.content!)
          this.touchDraftActivity(draftPath)
          return {
            success: true,
            action,
            draftId,
            skillName: parsed.skillName,
            draftStatus: 'created'
          }
        }
        case 'edit': {
          const parsed = this.validateDraftSkillDocument(request.content)
          if (!parsed.success) {
            return { success: false, action, error: parsed.error }
          }
          const draftId = this.validateDraftId(request.draftId)
          if (!draftId) {
            return {
              success: false,
              action,
              error: 'Draft handle is invalid for this conversation'
            }
          }
          const draftPath = this.getDraftPathForId(conversationId, draftId)
          if (!draftPath) {
            return {
              success: false,
              action,
              error: 'Draft handle is invalid for this conversation'
            }
          }
          if (!fs.existsSync(draftPath)) {
            return { success: false, action, error: 'Draft not found' }
          }
          commitMutation()
          await this.atomicWriteFile(path.join(draftPath, 'SKILL.md'), request.content!)
          this.touchDraftActivity(draftPath)
          return {
            success: true,
            action,
            draftId,
            skillName: parsed.skillName,
            draftStatus: 'updated'
          }
        }
        case 'write_file': {
          const draftId = this.validateDraftId(request.draftId)
          if (!draftId) {
            return {
              success: false,
              action,
              error: 'Draft handle is invalid for this conversation'
            }
          }
          const draftPath = this.getDraftPathForId(conversationId, draftId)
          if (!draftPath) {
            return {
              success: false,
              action,
              error: 'Draft handle is invalid for this conversation'
            }
          }
          if (!request.filePath?.trim()) {
            return { success: false, action, error: 'filePath is required for write_file' }
          }
          if (typeof request.fileContent !== 'string') {
            return { success: false, action, error: 'fileContent is required for write_file' }
          }
          const resolvedFilePath = this.resolveDraftFilePath(draftPath, request.filePath)
          if (!resolvedFilePath) {
            return {
              success: false,
              action,
              error: 'Draft file path must stay within allowed draft folders'
            }
          }
          const blockedPattern = this.findDraftInjectionPattern(request.fileContent)
          if (blockedPattern) {
            return {
              success: false,
              action,
              error: `Draft content rejected by security scan: ${blockedPattern}`
            }
          }
          commitMutation()
          fs.mkdirSync(path.dirname(resolvedFilePath), { recursive: true })
          await this.atomicWriteFile(resolvedFilePath, request.fileContent)
          this.touchDraftActivity(draftPath)
          return {
            success: true,
            action,
            draftId,
            filePath: path.relative(draftPath, resolvedFilePath)
          }
        }
        case 'remove_file': {
          const draftId = this.validateDraftId(request.draftId)
          if (!draftId) {
            return {
              success: false,
              action,
              error: 'Draft handle is invalid for this conversation'
            }
          }
          const draftPath = this.getDraftPathForId(conversationId, draftId)
          if (!draftPath) {
            return {
              success: false,
              action,
              error: 'Draft handle is invalid for this conversation'
            }
          }
          if (!request.filePath?.trim()) {
            return { success: false, action, error: 'filePath is required for remove_file' }
          }
          const resolvedFilePath = this.resolveDraftFilePath(draftPath, request.filePath)
          if (!resolvedFilePath) {
            return {
              success: false,
              action,
              error: 'Draft file path must stay within allowed draft folders'
            }
          }
          if (!fs.existsSync(resolvedFilePath)) {
            return { success: false, action, error: 'Draft file not found' }
          }
          commitMutation()
          fs.rmSync(resolvedFilePath, { force: true })
          this.touchDraftActivity(draftPath)
          return {
            success: true,
            action,
            draftId,
            filePath: path.relative(draftPath, resolvedFilePath)
          }
        }
        case 'delete': {
          const draftId = this.validateDraftId(request.draftId)
          if (!draftId) {
            return {
              success: false,
              action,
              error: 'Draft handle is invalid for this conversation'
            }
          }
          const draftPath = this.getDraftPathForId(conversationId, draftId)
          if (!draftPath) {
            return {
              success: false,
              action,
              error: 'Draft handle is invalid for this conversation'
            }
          }
          if (!fs.existsSync(draftPath)) {
            return { success: false, action, error: 'Draft not found' }
          }
          commitMutation()
          fs.rmSync(draftPath, { recursive: true, force: true })
          return { success: true, action, draftId }
        }
        default:
          return { success: false, action, error: `Unsupported draft action: ${action}` }
      }
    } catch (error) {
      if (mutationCommitFailed) throw error
      return {
        success: false,
        action,
        error: error instanceof Error ? error.message : String(error)
      }
    }
  }

  async viewDraftSkill(conversationId: string, draftId: string): Promise<SkillDraftActionResult> {
    const normalizedDraftId = this.validateDraftId(draftId)
    if (!normalizedDraftId) {
      return { success: false, action: 'view', draftId, error: 'Draft handle is invalid' }
    }

    const draftPath = this.getDraftPathForId(conversationId, normalizedDraftId)
    if (!draftPath || !(await this.pathExists(draftPath))) {
      return {
        success: false,
        action: 'view',
        draftId: normalizedDraftId,
        error: 'Draft not found'
      }
    }

    try {
      const skillMdPath = path.join(draftPath, 'SKILL.md')
      const stats = await fs.promises.stat(skillMdPath)
      if (!stats.isFile()) {
        return {
          success: false,
          action: 'view',
          draftId: normalizedDraftId,
          error: 'Draft SKILL.md not found'
        }
      }
      if (stats.size > SKILL_CONFIG.SKILL_FILE_MAX_SIZE) {
        return {
          success: false,
          action: 'view',
          draftId: normalizedDraftId,
          error: `Draft skill file too large: ${stats.size} bytes`
        }
      }
      const content = await fs.promises.readFile(skillMdPath, 'utf-8')
      this.touchDraftActivity(draftPath)
      const parsed = this.validateDraftSkillDocument(content)
      return {
        success: parsed.success,
        action: 'view',
        draftId: normalizedDraftId,
        ...(parsed.success ? { skillName: parsed.skillName, content } : { error: parsed.error })
      }
    } catch (error) {
      return {
        success: false,
        action: 'view',
        draftId: normalizedDraftId,
        error: error instanceof Error ? error.message : String(error)
      }
    }
  }

  async installDraftSkill(
    conversationId: string,
    draftId: string
  ): Promise<SkillDraftActionResult> {
    const normalizedDraftId = this.validateDraftId(draftId)
    if (!normalizedDraftId) {
      return { success: false, action: 'install', draftId, error: 'Draft handle is invalid' }
    }

    const draftPath = this.getDraftPathForId(conversationId, normalizedDraftId)
    if (!draftPath || !fs.existsSync(draftPath)) {
      return {
        success: false,
        action: 'install',
        draftId: normalizedDraftId,
        error: 'Draft not found'
      }
    }

    const viewed = await this.viewDraftSkill(conversationId, normalizedDraftId)
    if (!viewed.success) {
      return { ...viewed, action: 'install' }
    }

    const agentId = await this.resolveSessionAgentId(conversationId)
    if (!agentId) {
      return {
        success: false,
        action: 'install',
        draftId: normalizedDraftId,
        skillName: viewed.skillName,
        error: 'No DeepChat Agent context available for draft installation'
      }
    }
    const result = await this.installFromDirectory(draftPath, {
      options: { overwrite: false },
      sourceType: 'created',
      agentId
    })
    if (!result.success) {
      return {
        success: false,
        action: 'install',
        draftId: normalizedDraftId,
        skillName: viewed.skillName,
        error: result.error
      }
    }

    fs.rmSync(draftPath, { recursive: true, force: true })
    this.removeEmptyDraftConversationDir(conversationId)
    return {
      success: true,
      action: 'install',
      draftId: normalizedDraftId,
      skillName: viewed.skillName,
      installedSkillName: result.skillName ?? viewed.skillName
    }
  }

  async discardDraftSkill(
    conversationId: string,
    draftId: string
  ): Promise<SkillDraftActionResult> {
    const normalizedDraftId = this.validateDraftId(draftId)
    if (!normalizedDraftId) {
      return { success: false, action: 'discard', draftId, error: 'Draft handle is invalid' }
    }

    const draftPath = this.getDraftPathForId(conversationId, normalizedDraftId)
    if (!draftPath || !fs.existsSync(draftPath)) {
      return {
        success: false,
        action: 'discard',
        draftId: normalizedDraftId,
        error: 'Draft not found'
      }
    }

    fs.rmSync(draftPath, { recursive: true, force: true })
    this.removeEmptyDraftConversationDir(conversationId)
    return { success: true, action: 'discard', draftId: normalizedDraftId }
  }

  private replacePathVariables(
    content: string,
    metadata: SkillMetadata,
    agentId: string = BUILTIN_SKILL_AGENT_ID
  ): string {
    const pluginContribution = this.getPluginContributionForSkillRoot(metadata.skillRoot)
    assertSafeSkillAgentId(agentId)
    return content
      .replace(/\$\{SKILL_ROOT\}/g, metadata.skillRoot)
      .replace(/\$\{SKILLS_DIR\}/g, this.skillsDir)
      .replace(/\$\{PLUGIN_ROOT\}/g, pluginContribution?.pluginRoot ?? '')
      .replace(/\$\{PROCESS_ARCH\}/g, process.arch)
      .replace(
        /\$\{OWNER_PLUGIN_ID\}/g,
        metadata.ownerPluginId ?? pluginContribution?.ownerPluginId ?? ''
      )
  }

  private buildRuntimeInstructions(
    metadata: SkillMetadata,
    scriptInventory: SkillScriptDescriptor[]
  ): string {
    const scripts = scriptInventory.filter((script) => script.enabled)
    const lines = [
      '## DeepChat Runtime Context',
      `- Skill root: \`${metadata.skillRoot}\`.`,
      '- Relative paths mentioned by this skill are relative to the skill root unless stated otherwise.',
      '- When this skill needs script execution, prefer `skill_run` over `exec`.'
    ]

    if (scripts.length > 0) {
      lines.push('- Bundled runnable scripts:')
      lines.push(
        ...scripts.map((script) => {
          const suffix = script.description ? ` - ${script.description}` : ''
          return `  - ${script.relativePath} (${script.runtime})${suffix}`
        })
      )
    } else {
      lines.push('- No bundled scripts detected for this skill.')
    }

    lines.push('- Do not guess script paths or change directories to locate skill files.')

    return lines.join('\n')
  }

  /**
   * Install built-in skills from resources
   */
  async installBuiltinSkills(): Promise<void> {
    const builtinDir = this.resolveBuiltinSkillsDir()
    if (!builtinDir || !fs.existsSync(builtinDir)) {
      this.readOnlyBundledSkills = []
      return
    }

    const entries = fs.readdirSync(builtinDir, { withFileTypes: true })
    const managementStateIsV3 = this.settings.getManagementState()?.version === 3
    for (const entry of entries) {
      if (!entry.isDirectory()) continue
      if (READ_ONLY_BUNDLED_SKILL_NAMES.has(entry.name)) continue
      const skillDir = path.join(builtinDir, entry.name)
      const skillMdPath = path.join(skillDir, 'SKILL.md')
      if (!fs.existsSync(skillMdPath)) continue

      const metadata = await this.parseSkillMetadata(skillMdPath, entry.name)
      if (!metadata || !this.supportsCurrentPlatform(metadata.platforms)) {
        continue
      }

      try {
        await this.migrateLegacyBuiltinExecutionSupport(entry.name)
      } catch (error) {
        logger.warn('[SkillService] Legacy builtin Skill manifest migration failed.', {
          name: entry.name,
          error
        })
      }

      const result = await this.installFromDirectory(skillDir, {
        options: { overwrite: false },
        sourceType: 'builtin',
        assignToAgent: managementStateIsV3,
        persistManagementState: managementStateIsV3
      })
      if (!result.success && result.error?.includes('already exists')) {
        continue
      }
      if (!result.success) {
        console.warn('[SkillService] Failed to install builtin skill:', result.error)
      }
    }
    this.readOnlyBundledSkills = await this.discoverReadOnlyBundledSkills()
  }

  private async migrateLegacyBuiltinExecutionSupport(
    name: string,
    skillsRoot: string = this.skillsDir
  ): Promise<void> {
    const migration =
      LEGACY_BUILTIN_EXECUTION_SUPPORT_MIGRATIONS[
        name as keyof typeof LEGACY_BUILTIN_EXECUTION_SUPPORT_MIGRATIONS
      ]
    if (!migration) return

    const skillRoot = path.join(skillsRoot, name)
    const manifestPath = path.join(skillRoot, 'SKILL.md')
    if (!fs.existsSync(manifestPath)) return

    const manifestBytes = await this.readStableRegularFile(
      manifestPath,
      SKILL_CONFIG.SKILL_FILE_MAX_SIZE
    )
    const manifest = manifestBytes.toString('utf8')
    const parsed = matter(manifest)
    if (parsed.data.executionSupportPaths !== undefined) return
    if (createHash('sha256').update(manifestBytes).digest('hex') !== migration.manifestHash) return

    const treeHash = await this.createBoundedSkillTreeHash(skillRoot)
    if (treeHash !== migration.treeHash) return

    const closingFrontmatter = manifest.indexOf('\n---', 4)
    if (!manifest.startsWith('---\n') || closingFrontmatter < 0) {
      throw new Error(`Legacy builtin Skill manifest is malformed: ${name}`)
    }
    const supportDeclaration = [
      'executionSupportPaths:',
      ...migration.supportPaths.map((supportPath) => `  - ${supportPath}`),
      ''
    ].join('\n')
    const upgraded =
      manifest.slice(0, closingFrontmatter + 1) +
      supportDeclaration +
      manifest.slice(closingFrontmatter + 1)
    const upgradedData = matter(upgraded).data
    if (
      !Array.isArray(upgradedData.executionSupportPaths) ||
      upgradedData.executionSupportPaths.length !== migration.supportPaths.length ||
      !migration.supportPaths.every(
        (supportPath, index) => upgradedData.executionSupportPaths[index] === supportPath
      )
    ) {
      throw new Error(`Legacy builtin Skill manifest migration is invalid: ${name}`)
    }

    if ((await this.createBoundedSkillTreeHash(skillRoot)) !== treeHash) {
      throw new Error(`Legacy builtin Skill tree changed during migration: ${name}`)
    }
    const currentManifest = await this.readStableRegularFile(
      manifestPath,
      SKILL_CONFIG.SKILL_FILE_MAX_SIZE
    )
    if (!currentManifest.equals(manifestBytes)) {
      throw new Error(`Legacy builtin Skill manifest changed during migration: ${name}`)
    }
    await this.atomicWriteFile(manifestPath, upgraded, manifestBytes)
  }

  private async createBoundedSkillTreeHash(root: string): Promise<string> {
    const directories: string[] = []
    const files: Array<{ relativePath: string; byteCount: number; sha256: string }> = []
    let directoryCount = 0
    let totalBytes = 0
    const visit = async (directory: string, prefix = '', depth = 0): Promise<void> => {
      if (depth > SKILL_EXECUTION_PACKAGE_MAX_DEPTH) {
        throw new Error('Legacy builtin Skill tree exceeds the migration depth limit')
      }
      directoryCount += 1
      if (directoryCount > SKILL_EXECUTION_PACKAGE_MAX_DIRECTORIES) {
        throw new Error('Legacy builtin Skill tree exceeds the migration directory limit')
      }
      const directoryBefore = await fs.promises.lstat(directory)
      if (directoryBefore.isSymbolicLink() || !directoryBefore.isDirectory()) {
        throw new Error('Legacy builtin Skill tree contains an unsafe directory')
      }
      if (prefix) directories.push(prefix)
      const entries: fs.Dirent[] = []
      const openedDirectory = await fs.promises.opendir(directory)
      for await (const entry of openedDirectory) {
        if (
          entries.length >=
          SKILL_EXECUTION_PACKAGE_MAX_FILES + SKILL_EXECUTION_PACKAGE_MAX_DIRECTORIES
        ) {
          throw new Error('Legacy builtin Skill tree contains too many entries')
        }
        entries.push(entry)
      }
      entries.sort((left, right) =>
        Buffer.compare(Buffer.from(left.name, 'utf8'), Buffer.from(right.name, 'utf8'))
      )
      for (const entry of entries) {
        const relativePath = prefix ? `${prefix}/${entry.name}` : entry.name
        this.assertPortableExecutionPackagePath(relativePath)
        const absolutePath = path.join(directory, entry.name)
        const stat = await fs.promises.lstat(absolutePath)
        if (stat.isSymbolicLink()) {
          throw new Error('Legacy builtin Skill tree contains a symbolic link')
        }
        if (stat.isDirectory()) {
          await visit(absolutePath, relativePath, depth + 1)
          continue
        }
        if (!stat.isFile()) {
          throw new Error('Legacy builtin Skill tree contains a special file')
        }
        if (files.length >= SKILL_EXECUTION_PACKAGE_MAX_FILES) {
          throw new Error('Legacy builtin Skill tree exceeds the migration file limit')
        }
        const bytes = await this.readStableRegularFile(
          absolutePath,
          SKILL_EXECUTION_PACKAGE_MAX_FILE_BYTES
        )
        totalBytes += bytes.byteLength
        if (totalBytes > SKILL_EXECUTION_PACKAGE_MAX_BYTES) {
          throw new Error('Legacy builtin Skill tree exceeds the migration byte limit')
        }
        files.push({
          relativePath,
          byteCount: bytes.byteLength,
          sha256: createHash('sha256').update(bytes).digest('hex')
        })
      }
      const directoryAfter = await fs.promises.lstat(directory)
      if (
        directoryAfter.isSymbolicLink() ||
        !directoryAfter.isDirectory() ||
        directoryAfter.dev !== directoryBefore.dev ||
        directoryAfter.ino !== directoryBefore.ino ||
        directoryAfter.mtimeMs !== directoryBefore.mtimeMs ||
        directoryAfter.ctimeMs !== directoryBefore.ctimeMs
      ) {
        throw new Error('Legacy builtin Skill tree changed during migration')
      }
    }

    await visit(root)
    directories.sort((left, right) =>
      Buffer.compare(Buffer.from(left, 'utf8'), Buffer.from(right, 'utf8'))
    )
    files.sort((left, right) =>
      Buffer.compare(
        Buffer.from(left.relativePath, 'utf8'),
        Buffer.from(right.relativePath, 'utf8')
      )
    )
    return createHash('sha256').update(JSON.stringify({ directories, files })).digest('hex')
  }

  private normalizeExecutionSupportPaths(
    value: unknown,
    strict: boolean = false
  ): string[] | undefined {
    if (value === undefined) return undefined
    if (!Array.isArray(value)) {
      if (strict) throw new Error('executionSupportPaths must be an array of strings')
      return undefined
    }
    if (strict && value.some((supportPath) => typeof supportPath !== 'string')) {
      throw new Error('executionSupportPaths must contain only strings')
    }
    return value.filter((supportPath): supportPath is string => typeof supportPath === 'string')
  }

  private supportsCurrentPlatform(platforms?: string[]): boolean {
    if (!platforms?.length) {
      return true
    }

    const aliases = this.getCurrentPlatformAliases()
    return platforms.some((platform) => aliases.has(platform.trim().toLowerCase()))
  }

  private getCurrentPlatformAliases(): Set<string> {
    switch (process.platform) {
      case 'darwin':
        return new Set(['darwin', 'macos', 'mac'])
      case 'win32':
        return new Set(['win32', 'windows', 'win'])
      case 'linux':
        return new Set(['linux'])
      default:
        return new Set([process.platform])
    }
  }

  private resolveBuiltinSkillsDir(): string | null {
    const candidates = this.getBuiltinSkillsDirCandidates()
    for (const candidate of candidates) {
      if (fs.existsSync(candidate)) {
        return candidate
      }
    }
    return null
  }

  private getBuiltinSkillsDirCandidates(): string[] {
    if (!app.isPackaged) {
      return [path.join(app.getAppPath(), 'resources', 'skills')]
    }
    return [
      path.join(process.resourcesPath, 'app.asar.unpacked', 'resources', 'skills'),
      path.join(process.resourcesPath, 'resources', 'skills'),
      path.join(process.resourcesPath, 'skills')
    ]
  }

  /**
   * Install a skill from a folder path
   */
  async installFromFolder(
    folderPath: string,
    options?: SkillInstallOptions
  ): Promise<SkillInstallResult> {
    return await this.installFromDirectory(folderPath, {
      options,
      sourceType: 'folder-install',
      targetName: options?.targetName,
      assignToAgent: false
    })
  }

  async installFromFolderForAgent(
    agentId: string,
    folderPath: string,
    options?: SkillInstallOptions
  ): Promise<SkillInstallResult> {
    const normalizedAgentId = await this.requireAgentScope(agentId)
    return await this.installFromDirectory(folderPath, {
      options,
      sourceType: 'folder-install',
      targetName: options?.targetName,
      agentId: normalizedAgentId
    })
  }

  async installImportedSkill(
    agentIds: string[],
    folderPath: string,
    provenance: SkillImportProvenance,
    options?: SkillInstallOptions
  ): Promise<SkillInstallResult> {
    const importedFrom = provenance.importedFrom.trim()
    if (!importedFrom) {
      return { success: false, error: 'Imported Skill provenance is required' }
    }
    const sourceAgentId = provenance.sourceAgentId?.trim()
    if (sourceAgentId) {
      assertSafeSkillAgentId(sourceAgentId)
    }
    return await this.installFromDirectory(folderPath, {
      options,
      sourceType: 'imported',
      sourcePatch: {
        importedFrom,
        importedAt: new Date().toISOString(),
        ...(sourceAgentId ? { agentId: sourceAgentId } : {})
      },
      targetName: options?.targetName,
      assignToAgentIds: agentIds,
      publishCatalogEvent: true
    })
  }

  /**
   * Install a skill from a zip file
   */
  async installFromZip(
    zipPath: string,
    options?: SkillInstallOptions
  ): Promise<SkillInstallResult> {
    return await this.installFromZipWithAssignment(BUILTIN_SKILL_AGENT_ID, zipPath, options, false)
  }

  async installFromZipForAgent(
    agentId: string,
    zipPath: string,
    options?: SkillInstallOptions
  ): Promise<SkillInstallResult> {
    return await this.installFromZipWithAssignment(agentId, zipPath, options, true)
  }

  private async installFromZipWithAssignment(
    agentId: string,
    zipPath: string,
    options: SkillInstallOptions | undefined,
    assignToAgent: boolean
  ): Promise<SkillInstallResult> {
    const normalizedAgentId = await this.requireAgentScope(agentId)
    if (!fs.existsSync(zipPath)) {
      return { success: false, error: 'Zip file not found', errorCode: 'not_found' }
    }

    const tempDir = fs.mkdtempSync(path.join(app.getPath('temp'), 'deepchat-skill-'))
    try {
      await extractSkillArchive(zipPath, tempDir, {
        maxArchiveBytes: SKILL_CONFIG.ZIP_MAX_SIZE
      })
      const skillDir = this.resolveSkillDirFromExtracted(tempDir)
      if (!skillDir) {
        return { success: false, error: 'SKILL.md not found in zip archive' }
      }
      return await this.installFromDirectory(skillDir, {
        options,
        sourceType: 'zip-install',
        agentId: normalizedAgentId,
        assignToAgent
      })
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error)
      return { success: false, error: errorMsg, errorCode: 'io_error' }
    } finally {
      fs.rmSync(tempDir, { recursive: true, force: true })
    }
  }

  /**
   * Install a skill from a URL
   */
  async installFromUrl(url: string, options?: SkillInstallOptions): Promise<SkillInstallResult> {
    return await this.installFromUrlWithAssignment(BUILTIN_SKILL_AGENT_ID, url, options, false)
  }

  async installFromUrlForAgent(
    agentId: string,
    url: string,
    options?: SkillInstallOptions
  ): Promise<SkillInstallResult> {
    return await this.installFromUrlWithAssignment(agentId, url, options, true)
  }

  private async installFromUrlWithAssignment(
    agentId: string,
    url: string,
    options: SkillInstallOptions | undefined,
    assignToAgent: boolean
  ): Promise<SkillInstallResult> {
    const normalizedAgentId = await this.requireAgentScope(agentId)
    const finishOperation = this.beginAgentScopeOperation(normalizedAgentId)
    const tempZipPath = path.join(app.getPath('temp'), `deepchat-skill-${randomUUID()}.zip`)
    try {
      await downloadSkillArchive(url, tempZipPath, {
        maxBytes: SKILL_CONFIG.ZIP_MAX_SIZE,
        timeoutMs: SKILL_CONFIG.DOWNLOAD_TIMEOUT
      })
      const result = await this.installFromZipWithAssignment(
        normalizedAgentId,
        tempZipPath,
        options,
        assignToAgent
      )
      if (result.success && result.skillName) {
        this.updateSkillManagementItem(result.skillName, (item) => ({
          ...item,
          source: {
            type: 'url-install',
            installedAt: new Date().toISOString()
          }
        }))
      }
      return result
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error)
      return { success: false, error: errorMsg, errorCode: 'io_error' }
    } finally {
      if (fs.existsSync(tempZipPath)) {
        fs.rmSync(tempZipPath, { force: true })
      }
      finishOperation()
    }
  }

  async scanGitSkillRepo(repoUrl: string): Promise<GitSkillRepoScanResult> {
    return await this.scanGitSkillRepoForAgent(BUILTIN_SKILL_AGENT_ID, repoUrl)
  }

  async scanGitSkillRepoForAgent(
    agentId: string,
    repoUrl: string
  ): Promise<GitSkillRepoScanResult> {
    const normalizedAgentId = await this.requireAgentScope(agentId)
    const normalizedRepoUrl = repoUrl.trim()
    if (!normalizedRepoUrl) {
      throw new Error('Git repository URL is required')
    }

    const cloneDir = await this.cloneGitSkillRepo(normalizedRepoUrl)
    try {
      return await this.scanGitSkillRepoDirectory(normalizedRepoUrl, cloneDir, normalizedAgentId)
    } finally {
      fs.rmSync(cloneDir, { recursive: true, force: true })
    }
  }

  async installSkillsFromGit(input: GitSkillInstallInput): Promise<SkillInstallResult[]> {
    return await this.installSkillsFromGitForAgent(BUILTIN_SKILL_AGENT_ID, input, false)
  }

  async installSkillsFromGitForAgent(
    agentId: string,
    input: GitSkillInstallInput,
    assignToAgent = true
  ): Promise<SkillInstallResult[]> {
    const normalizedAgentId = await this.requireAgentScope(agentId)
    const finishOperation = this.beginAgentScopeOperation(normalizedAgentId)
    const repoUrl = input.repoUrl.trim()
    const selected = new Set(input.skillNames)
    const strategy = input.strategy ?? 'rename'
    if (!repoUrl || selected.size === 0) {
      finishOperation()
      return []
    }

    let cloneDir: string
    try {
      cloneDir = await this.cloneGitSkillRepo(repoUrl)
    } catch (error) {
      finishOperation()
      const errorMsg = error instanceof Error ? error.message : String(error)
      return [{ success: false, error: errorMsg, errorCode: 'io_error' }]
    }
    try {
      const scan = await this.scanGitSkillRepoDirectory(repoUrl, cloneDir, normalizedAgentId)
      const selectedItems = scan.skills.filter((item) => selected.has(item.name))
      const results: SkillInstallResult[] = []
      for (const item of selectedItems) {
        if (!item.valid) {
          results.push({
            success: false,
            sourceSkillName: item.name,
            skillName: item.name,
            error: item.error ?? 'Invalid skill',
            errorCode: 'invalid_skill'
          })
          continue
        }

        const targetConflict = this.isSkillNameOccupied(item.name)
        if (targetConflict && strategy === 'skip') {
          results.push({
            success: false,
            sourceSkillName: item.name,
            skillName: item.name,
            existingSkillName: item.name,
            error: `Skill "${item.name}" already exists`,
            errorCode: 'conflict'
          })
          continue
        }

        const sourceDir =
          scan.repoFormat === 'single-skill'
            ? cloneDir
            : path.join(cloneDir, item.relativePath.replace(/\/SKILL\.md$/, ''))
        const targetName =
          targetConflict && strategy === 'rename'
            ? this.createUniqueSkillName(item.name)
            : item.name
        const result = await this.installFromDirectory(sourceDir, {
          options: { overwrite: targetConflict && strategy === 'overwrite' },
          sourceType: 'git-install',
          sourcePatch: {
            repoUrl,
            repoFormat: scan.repoFormat,
            installedAt: new Date().toISOString()
          },
          targetName,
          agentId: normalizedAgentId,
          assignToAgent,
          publishCatalogEvent: false
        })
        results.push({ ...result, sourceSkillName: item.name })
      }

      if (results.some((result) => result.success)) {
        this.publishEvent('skills.catalog.changed', {
          reason: 'git-installed',
          agentIds: assignToAgent ? [normalizedAgentId] : undefined,
          version: Date.now()
        })
      }

      return results
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error)
      return [{ success: false, error: errorMsg, errorCode: 'io_error' }]
    } finally {
      fs.rmSync(cloneDir, { recursive: true, force: true })
      finishOperation()
    }
  }

  async getSkillsSyncConfig(): Promise<SkillSyncDirectoryConfig | null> {
    return this.getStoredManagementState().sync ?? null
  }

  async setSkillsSyncDirectory(input: {
    skillsDirectory: string
  }): Promise<SkillSyncDirectoryConfig> {
    const requestedDirectory = input.skillsDirectory.trim()
    if (!requestedDirectory) {
      throw new Error('Skills sync directory must not be empty')
    }
    const skillsDirectory = path.resolve(requestedDirectory)
    this.assertSyncDirectoryIsolated(skillsDirectory)
    const config: SkillSyncDirectoryConfig = {
      skillsDirectory,
      layout: 'multi-skill-repo',
      lastExportAt: null,
      lastImportAt: null
    }

    fs.mkdirSync(path.join(skillsDirectory, 'skills'), { recursive: true })
    const state = this.getStoredManagementState()
    state.sync = {
      ...state.sync,
      ...config
    }
    this.saveManagementState(state)
    this.publishEvent('skills.catalog.changed', {
      reason: 'sync-directory-updated',
      version: Date.now()
    })
    return state.sync
  }

  async previewSyncDirectoryExport(
    input: SkillSyncDirectoryExportInput
  ): Promise<SkillSyncDirectoryExportPreview> {
    const config = this.requireSyncDirectoryConfig()
    const selected = new Set(input.skillNames)
    const skills = (await this.getAllSkills()).filter((skill) => selected.has(skill.name))

    return {
      skillsDirectory: config.skillsDirectory,
      items: skills.map((skill) => {
        const targetPath = path.join(config.skillsDirectory, 'skills', skill.name)
        if (!skill.mutable || !fs.existsSync(path.join(skill.skillRoot, 'SKILL.md'))) {
          return {
            name: skill.name,
            state: 'invalid',
            sourcePath: skill.skillRoot,
            targetPath,
            error: 'Skill cannot be exported'
          }
        }
        return {
          name: skill.name,
          state: this.resolveExportPreviewState(skill.skillRoot, targetPath),
          sourcePath: skill.skillRoot,
          targetPath
        }
      })
    }
  }

  async executeSyncDirectoryExport(
    input: SkillSyncDirectoryExportInput
  ): Promise<SkillSyncDirectoryResult> {
    const preview = await this.previewSyncDirectoryExport(input)
    let exported = 0
    let skipped = 0
    const failed: Array<{ skillName: string; reason: string }> = []

    fs.mkdirSync(path.join(preview.skillsDirectory, 'skills'), { recursive: true })
    this.ensureSyncDirectoryReadme(preview.skillsDirectory)

    for (const item of preview.items) {
      if (item.state === 'invalid') {
        skipped += 1
        failed.push({ skillName: item.name, reason: item.error ?? 'Invalid skill' })
        continue
      }

      try {
        this.replaceSyncDirectorySkill(item.sourcePath, item.targetPath)
        exported += 1
      } catch (error) {
        failed.push({
          skillName: item.name,
          reason: error instanceof Error ? error.message : String(error)
        })
      }
    }

    if (exported > 0) {
      this.tryUpdateSyncDirectoryActivity('export', {
        lastExportAt: new Date().toISOString()
      })
    }

    return {
      success: failed.length === 0,
      exported,
      skipped,
      failed
    }
  }

  async previewSyncDirectoryImport(): Promise<SkillSyncDirectoryImportPreview> {
    const config = this.requireSyncDirectoryConfig()
    const skillsRoot = path.join(config.skillsDirectory, 'skills')
    const items: SkillSyncDirectoryPreviewItem[] = []
    if (!fs.existsSync(skillsRoot)) {
      return { skillsDirectory: config.skillsDirectory, items }
    }

    for (const entry of fs.readdirSync(skillsRoot, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue
      if (
        entry.name.startsWith(SKILL_SYNC_EXPORT_STAGING_PREFIX) ||
        entry.name.startsWith(SKILL_SYNC_EXPORT_BACKUP_PREFIX)
      ) {
        continue
      }
      const sourcePath = path.join(skillsRoot, entry.name)
      const targetPath = path.join(this.skillsDir, entry.name)
      items.push(this.createImportPreviewItem(sourcePath, targetPath))
    }

    return {
      skillsDirectory: config.skillsDirectory,
      items: items.sort((left, right) => left.name.localeCompare(right.name))
    }
  }

  async executeSyncDirectoryImport(
    input: SkillSyncDirectoryImportInput
  ): Promise<SkillSyncDirectoryResult> {
    const preview = await this.previewSyncDirectoryImport()
    const selected = new Set(input.skillNames)
    const strategy = input.strategy ?? 'overwrite'
    let imported = 0
    let skipped = 0
    const failed: Array<{ skillName: string; reason: string }> = []

    for (const item of preview.items.filter((candidate) => selected.has(candidate.name))) {
      if (item.state === 'invalid' || item.state === 'same') {
        skipped += 1
        if (item.state === 'invalid') {
          failed.push({ skillName: item.name, reason: item.error ?? 'Invalid skill' })
        }
        continue
      }

      if ((item.state === 'conflict' || item.state === 'modified') && strategy === 'skip') {
        skipped += 1
        continue
      }

      const targetName =
        (item.state === 'conflict' || item.state === 'modified') && strategy === 'rename'
          ? this.createUniqueSkillName(item.name)
          : item.name
      const result = await this.installFromDirectory(item.sourcePath, {
        options: { overwrite: strategy === 'overwrite' },
        sourceType: 'imported',
        sourcePatch: {
          importedFrom: item.sourcePath,
          importedAt: new Date().toISOString()
        },
        targetName,
        assignToAgent: false,
        publishCatalogEvent: false
      })
      if (result.success) {
        imported += 1
      } else {
        failed.push({
          skillName: item.name,
          reason: result.error ?? 'Import failed'
        })
      }
    }

    if (imported > 0) {
      this.tryUpdateSyncDirectoryActivity('import', {
        lastImportAt: new Date().toISOString()
      })
      this.publishEvent('skills.catalog.changed', {
        reason: 'sync-imported',
        version: Date.now()
      })
    }

    return {
      success: failed.length === 0,
      imported,
      skipped,
      failed
    }
  }

  async registerPluginSkill(input: {
    ownerPluginId: string
    id: string
    skillRoot: string
    pluginRoot?: string
  }): Promise<void> {
    const skillRoot = path.resolve(input.skillRoot)
    const skillPath = path.join(skillRoot, 'SKILL.md')
    if (!fs.existsSync(skillPath)) {
      throw new Error(`Plugin skill "${input.id}" is missing SKILL.md`)
    }

    this.pluginSkillContributions.set(`${input.ownerPluginId}:${input.id}`, {
      ownerPluginId: input.ownerPluginId,
      skillRoot,
      pluginRoot: input.pluginRoot ? path.resolve(input.pluginRoot) : undefined
    })
    await this.invalidateCatalogsForPluginChange()
    await this.materializePluginBindings(input.ownerPluginId)
  }

  async unregisterPluginSkillsByOwner(ownerPluginId: string): Promise<void> {
    const removedNames = Array.from(this.metadataCache.values())
      .filter((skill) => skill.ownerPluginId === ownerPluginId)
      .map((skill) => skill.name)
    let changed = false
    for (const [key, contribution] of this.pluginSkillContributions.entries()) {
      if (contribution.ownerPluginId === ownerPluginId) {
        this.pluginSkillContributions.delete(key)
        changed = true
      }
    }

    if (changed) {
      const state = this.getStoredManagementState()
      const affectedAgentIds = Object.entries(state.agents)
        .filter(([, agent]) => removedNames.some((name) => agent.bindings[name]?.assigned === true))
        .map(([agentId]) => agentId)
      for (const name of removedNames) {
        delete state.skills[name]
        for (const agent of Object.values(state.agents)) delete agent.bindings[name]
      }
      this.saveManagementState(state)
      await this.invalidateCatalogsForPluginChange()
      await Promise.all(affectedAgentIds.map((agentId) => this.revalidateSessionsForAgent(agentId)))
      if (affectedAgentIds.length > 0) {
        this.publishEvent('skills.catalog.changed', {
          reason: 'assignments-updated',
          agentIds: affectedAgentIds,
          version: Date.now()
        })
      }
    }
  }

  private async invalidateCatalogsForPluginChange(): Promise<void> {
    this.metadataCache.clear()
    this.contentCache.clear()
    this.builtinCatalogDiscovered = false
    if (!this.initialized) return

    await this.discoverSkills(BUILTIN_SKILL_AGENT_ID)
    this.reconcileSkillManagementState()
  }

  private async materializePluginBindings(ownerPluginId: string): Promise<void> {
    const names = Array.from(this.metadataCache.values())
      .filter((skill) => skill.ownerPluginId === ownerPluginId)
      .map((skill) => skill.name)
    if (names.length === 0) return
    const state = this.getStoredManagementState()
    const agentIds = this.agentScopePort
      ? (await this.agentScopePort.listDeepChatAgents()).map((agent) => agent.id)
      : [BUILTIN_SKILL_AGENT_ID]
    let changed = false
    for (const agentId of agentIds) {
      const bindings = this.getAgentBindingState(state, agentId).bindings
      for (const name of names) {
        if (!bindings[name]) {
          bindings[name] = {
            assigned: true,
            extension: createDefaultSkillExtensionConfig()
          }
          changed = true
        }
      }
    }
    if (changed) {
      this.saveManagementState(state)
      this.publishEvent('skills.catalog.changed', {
        reason: 'assignments-updated',
        agentIds,
        version: Date.now()
      })
    }
  }

  private async installFromDirectory(
    folderPath: string,
    context: SkillDirectoryInstallContext = {}
  ): Promise<SkillInstallResult> {
    return await this.runMutation(
      async () => await this.installFromDirectoryUnlocked(folderPath, context)
    )
  }

  private async installFromDirectoryUnlocked(
    folderPath: string,
    context: SkillDirectoryInstallContext = {}
  ): Promise<SkillInstallResult> {
    const {
      options,
      sourceType = 'folder-install',
      sourcePatch = {},
      targetName,
      agentId = BUILTIN_SKILL_AGENT_ID,
      assignToAgent = true,
      assignToAgentIds,
      persistManagementState = true,
      publishCatalogEvent = true
    } = context
    let targetPath = this.skillsDir
    let skillNameForFailure = targetName?.trim() || path.basename(folderPath)
    const finishAgentOperations: Array<() => void> = []
    try {
      const requestedAssignmentAgentIds = assignToAgentIds ?? (assignToAgent ? [agentId] : [])
      const requestedOperationAgentIds =
        requestedAssignmentAgentIds.length > 0 ? requestedAssignmentAgentIds : [agentId]
      const normalizedOperationAgentIds: string[] = []
      for (const requestedAgentId of Array.from(new Set(requestedOperationAgentIds)).sort(
        (left, right) => left.localeCompare(right)
      )) {
        const normalizedAgentId = await this.requireAgentScope(requestedAgentId)
        if (!normalizedOperationAgentIds.includes(normalizedAgentId)) {
          normalizedOperationAgentIds.push(normalizedAgentId)
        }
      }
      if (assignToAgentIds && normalizedOperationAgentIds.length === 0) {
        return { success: false, error: 'At least one target Agent is required' }
      }
      for (const normalizedAgentId of normalizedOperationAgentIds) {
        finishAgentOperations.push(this.beginAgentScopeOperation(normalizedAgentId))
      }
      await this.ensureAgentCatalogDiscovered(normalizedOperationAgentIds[0])
      const normalizedAssignmentAgentIds =
        requestedAssignmentAgentIds.length > 0 ? normalizedOperationAgentIds : []
      if (persistManagementState) {
        for (const normalizedAgentId of normalizedAssignmentAgentIds) {
          await this.ensureAgentBindingsInitialized(normalizedAgentId)
          this.assertAgentScopeActive(normalizedAgentId)
        }
      }
      const skillsRoot = this.skillsDir
      const metadataCache = this.metadataCache
      const resolvedSource = path.resolve(folderPath)

      if (!fs.existsSync(resolvedSource)) {
        return { success: false, error: 'Skill folder not found', errorCode: 'not_found' }
      }
      const sourceStats = fs.lstatSync(resolvedSource)
      if (sourceStats.isSymbolicLink() || !sourceStats.isDirectory()) {
        return {
          success: false,
          error: 'Skill source must be a real directory, not a symbolic link',
          errorCode: 'invalid_skill'
        }
      }

      const skillMdPath = path.join(resolvedSource, 'SKILL.md')
      if (!fs.existsSync(skillMdPath)) {
        return {
          success: false,
          error: 'SKILL.md not found in the folder',
          errorCode: 'invalid_skill'
        }
      }

      const content = fs.readFileSync(skillMdPath, 'utf-8')
      const { data } = matter(content)
      const skillName = typeof data.name === 'string' ? data.name.trim() : ''
      const skillDescription = typeof data.description === 'string' ? data.description.trim() : ''

      if (!skillName) {
        return {
          success: false,
          error: 'Skill name not found in SKILL.md frontmatter',
          errorCode: 'invalid_skill'
        }
      }

      if (!skillDescription) {
        return {
          success: false,
          error: 'Skill description not found in SKILL.md frontmatter',
          errorCode: 'invalid_skill'
        }
      }

      if (
        skillName.includes('/') ||
        skillName.includes('\\') ||
        !SKILL_NAME_PATTERN.test(skillName)
      ) {
        return {
          success: false,
          error: 'Invalid skill name in SKILL.md frontmatter',
          errorCode: 'invalid_skill'
        }
      }

      const finalSkillName = targetName?.trim() || skillName
      skillNameForFailure = finalSkillName
      if (!this.isSafeSkillName(finalSkillName)) {
        return {
          success: false,
          error: 'Invalid target skill name',
          errorCode: 'invalid_skill'
        }
      }

      const targetDir = path.join(skillsRoot, finalSkillName)
      const resolvedTarget = path.resolve(targetDir)
      targetPath = resolvedTarget
      const catalogEntry = metadataCache.get(finalSkillName)
      if (catalogEntry && path.resolve(catalogEntry.skillRoot) !== resolvedTarget) {
        return {
          success: false,
          error: `Skill "${finalSkillName}" is owned by a read-only provider`,
          errorCode: options?.overwrite ? 'permission_denied' : 'conflict',
          existingSkillName: finalSkillName
        }
      }

      if (resolvedSource === resolvedTarget) {
        return {
          success: false,
          error: `Skill "${finalSkillName}" already exists`,
          errorCode: 'conflict',
          existingSkillName: finalSkillName
        }
      }

      const relativeToSource = path.relative(resolvedSource, resolvedTarget)
      if (
        relativeToSource === '' ||
        (!relativeToSource.startsWith('..') && !path.isAbsolute(relativeToSource))
      ) {
        return {
          success: false,
          error: 'Target directory cannot be inside source folder',
          errorCode: 'invalid_skill'
        }
      }

      if (fs.existsSync(resolvedTarget)) {
        if (!options?.overwrite) {
          return {
            success: false,
            error: `Skill "${finalSkillName}" already exists`,
            errorCode: 'conflict',
            existingSkillName: finalSkillName
          }
        }
        if (options.acknowledgedAgentIds) {
          const currentImpact = this.getAssignedAgentIds(finalSkillName)
          const acknowledgedImpact = Array.from(new Set(options.acknowledgedAgentIds)).sort()
          if (!this.areSkillListsEqual(currentImpact, acknowledgedImpact)) {
            return {
              success: false,
              error: 'Skill assignment impact changed; preview the operation again',
              errorCode: 'stale_impact',
              existingSkillName: finalSkillName
            }
          }
        }
      }

      const stagingDir = path.join(
        skillsRoot,
        `${SKILL_INSTALL_STAGING_PREFIX}${finalSkillName}-${randomUUID()}`
      )
      if (fs.existsSync(stagingDir)) {
        const stagingStats = fs.lstatSync(stagingDir)
        if (stagingStats.isSymbolicLink()) {
          throw new Error(`Skill install staging path is a symbolic link: ${stagingDir}`)
        }
        fs.rmSync(stagingDir, { recursive: true, force: true })
      }
      const previousState = this.getStoredManagementState()
      const hadPreviousMetadata = metadataCache.has(finalSkillName)
      const previousMetadata = metadataCache.get(finalSkillName)
      let backupDir: string | null = null
      let committedNewTarget = false
      let cachesTouched = false
      let managementStateTouched = false

      try {
        this.copyDirectory(resolvedSource, stagingDir)
        if (finalSkillName !== skillName) {
          this.rewriteSkillManifestName(stagingDir, finalSkillName)
        }
        const stagedSummary = this.readSkillManifestSummary(stagingDir)
        if (!stagedSummary.valid || stagedSummary.name !== finalSkillName) {
          throw new Error(`Staged Skill failed validation: ${finalSkillName}`)
        }

        if (fs.existsSync(resolvedTarget)) {
          if (!options?.overwrite) {
            fs.rmSync(stagingDir, { recursive: true, force: true })
            return {
              success: false,
              error: `Skill "${finalSkillName}" already exists`,
              errorCode: 'conflict',
              existingSkillName: finalSkillName
            }
          }
          backupDir = this.backupExistingSkill(finalSkillName)
        }
        fs.renameSync(stagingDir, resolvedTarget)
        committedNewTarget = true

        const metadata = await this.parseSkillMetadata(
          path.join(resolvedTarget, 'SKILL.md'),
          finalSkillName,
          undefined,
          skillsRoot
        )
        if (!metadata || metadata.name !== finalSkillName) {
          throw new Error(`Installed Skill failed validation: ${finalSkillName}`)
        }
        cachesTouched = true
        metadataCache.set(finalSkillName, metadata)
        this.invalidateSkillContent(finalSkillName)
        if (persistManagementState) {
          managementStateTouched = true
          const state = this.getStoredManagementState()
          state.skills[finalSkillName] = {
            name: finalSkillName,
            canonicalPath: resolvedTarget,
            source: {
              type: sourceType,
              installedAt: new Date().toISOString(),
              ...sourcePatch
            }
          }
          for (const normalizedAgentId of normalizedAssignmentAgentIds) {
            const bindingState = this.getAgentBindingState(state, normalizedAgentId)
            const previousBinding = bindingState.bindings[finalSkillName]
            bindingState.bindings[finalSkillName] = {
              assigned: true,
              extension: sanitizeSkillExtensionConfig(previousBinding?.extension),
              runtimeBindingId: previousBinding?.runtimeBindingId
            }
          }
          this.saveManagementState(state)
        }

        if (publishCatalogEvent) {
          this.publishEvent('skills.catalog.changed', {
            reason: 'installed',
            name: finalSkillName,
            agentIds:
              normalizedAssignmentAgentIds.length > 0 ? normalizedAssignmentAgentIds : undefined,
            version: Date.now()
          })
        }

        return { success: true, skillName: finalSkillName, targetPath: resolvedTarget }
      } catch (error) {
        const rollbackErrors: unknown[] = []
        try {
          if (fs.existsSync(stagingDir)) {
            fs.rmSync(stagingDir, { recursive: true, force: true })
          }
        } catch (rollbackError) {
          rollbackErrors.push(rollbackError)
        }
        try {
          if (committedNewTarget && fs.existsSync(resolvedTarget)) {
            fs.rmSync(resolvedTarget, { recursive: true, force: true })
          }
        } catch (rollbackError) {
          rollbackErrors.push(rollbackError)
        }
        try {
          if (backupDir) {
            fs.renameSync(backupDir, resolvedTarget)
          }
        } catch (rollbackError) {
          rollbackErrors.push(rollbackError)
        }
        try {
          if (managementStateTouched) this.saveManagementState(previousState)
        } catch (rollbackError) {
          rollbackErrors.push(rollbackError)
        }
        if (cachesTouched) {
          if (hadPreviousMetadata && previousMetadata) {
            metadataCache.set(finalSkillName, previousMetadata)
          } else {
            metadataCache.delete(finalSkillName)
          }
          this.invalidateSkillContent(finalSkillName)
        }

        const failure = this.createTargetOperationFailure(
          finalSkillName,
          resolvedTarget,
          'replace',
          error
        )
        if (rollbackErrors.length > 0) {
          const rollbackMessage = rollbackErrors
            .map((rollbackError) =>
              rollbackError instanceof Error ? rollbackError.message : String(rollbackError)
            )
            .join('; ')
          failure.error = `${failure.error} (rollback failed: ${rollbackMessage})`
        }
        return failure
      }
    } catch (error) {
      return this.createTargetOperationFailure(skillNameForFailure, targetPath, 'replace', error)
    } finally {
      for (const finishAgentOperation of finishAgentOperations.reverse()) {
        finishAgentOperation()
      }
    }
  }

  private backupExistingSkill(skillName: string): string {
    const sourceDir = path.join(this.skillsDir, skillName)
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-')
    const backupRoot = path.join(app.getPath('home'), '.deepchat', 'backups', 'skill-installs')
    fs.mkdirSync(backupRoot, { recursive: true })
    const backupDir = path.join(backupRoot, `${skillName}-${timestamp}-${randomUUID()}`)
    fs.renameSync(sourceDir, backupDir)
    return backupDir
  }

  private rewriteSkillManifestName(skillDir: string, name: string): void {
    const skillPath = path.join(skillDir, 'SKILL.md')
    const raw = fs.readFileSync(skillPath, 'utf-8')
    const parsed = matter(raw)
    fs.writeFileSync(skillPath, matter.stringify(parsed.content, { ...parsed.data, name }), 'utf-8')
  }

  private createTargetLockedFailure(
    skillName: string,
    targetPath: string,
    operation: 'replace' | 'remove'
  ): SkillInstallResult {
    const verb = operation === 'remove' ? 'removed' : 'replaced'
    return {
      success: false,
      error: `Skill "${skillName}" cannot be ${verb} because its folder is in use: ${targetPath}`,
      errorCode: 'target_locked',
      skillName,
      targetPath
    }
  }

  private createTargetOperationFailure(
    skillName: string,
    targetPath: string,
    operation: 'replace' | 'remove',
    error: unknown
  ): SkillInstallResult {
    const errorMsg = error instanceof Error ? error.message : String(error)
    if (this.isFileSystemLockError(error)) {
      return this.createTargetLockedFailure(skillName, targetPath, operation)
    }

    return {
      success: false,
      error: errorMsg,
      errorCode: 'io_error',
      skillName,
      targetPath
    }
  }

  private isFileSystemLockError(error: unknown): boolean {
    const code = (error as { code?: unknown } | null)?.code
    return code === 'EPERM' || code === 'EBUSY' || code === 'EACCES' || code === 'ENOTEMPTY'
  }

  private resolveSkillDirFromExtracted(extractDir: string): string | null {
    const rootSkill = path.join(extractDir, 'SKILL.md')
    if (fs.existsSync(rootSkill)) {
      return extractDir
    }

    const entries = fs.readdirSync(extractDir, { withFileTypes: true })
    const candidates = entries.filter((entry) => {
      if (!entry.isDirectory()) return false
      const skillPath = path.join(extractDir, entry.name, 'SKILL.md')
      return fs.existsSync(skillPath)
    })

    if (candidates.length === 1) {
      return path.join(extractDir, candidates[0].name)
    }

    return null
  }

  private async cloneGitSkillRepo(repoUrl: string): Promise<string> {
    const operationRoot = path.join(app.getPath('home'), '.deepchat', 'tmp', 'skill-installs')
    fs.mkdirSync(operationRoot, { recursive: true })
    const cloneDir = path.join(operationRoot, `${Date.now()}-${randomUUID()}`)
    try {
      await execFileAsync('git', ['clone', '--depth', '1', repoUrl, cloneDir], {
        timeout: SKILL_CONFIG.DOWNLOAD_TIMEOUT
      })
      return cloneDir
    } catch (error) {
      fs.rmSync(cloneDir, { recursive: true, force: true })
      const errorMsg = error instanceof Error ? error.message : String(error)
      throw new Error(`Failed to clone Git repository: ${errorMsg}`)
    }
  }

  private async scanGitSkillRepoDirectory(
    repoUrl: string,
    repoRoot: string,
    agentId: string = BUILTIN_SKILL_AGENT_ID
  ): Promise<GitSkillRepoScanResult> {
    const rootSkill = path.join(repoRoot, 'SKILL.md')
    if (fs.existsSync(rootSkill)) {
      return {
        repoUrl,
        repoFormat: 'single-skill',
        skills: [this.createGitScanItem(repoRoot, 'SKILL.md', agentId)]
      }
    }

    const skillsRoot = path.join(repoRoot, 'skills')
    const skills = fs.existsSync(skillsRoot)
      ? fs
          .readdirSync(skillsRoot, { withFileTypes: true })
          .filter((entry) => entry.isDirectory())
          .map((entry) =>
            this.createGitScanItem(
              path.join(skillsRoot, entry.name),
              path.join('skills', entry.name, 'SKILL.md'),
              agentId
            )
          )
      : []

    return {
      repoUrl,
      repoFormat: 'multi-skill',
      skills: skills.sort((left, right) => left.name.localeCompare(right.name))
    }
  }

  private createGitScanItem(
    skillDir: string,
    relativePath: string,
    _agentId: string = BUILTIN_SKILL_AGENT_ID
  ): GitSkillRepoScanItem {
    const summary = this.readSkillManifestSummary(skillDir)
    if (!summary.valid) {
      return {
        name: path.basename(skillDir),
        description: '',
        relativePath,
        conflict: false,
        valid: false,
        error: summary.error
      }
    }

    return {
      name: summary.name,
      description: summary.description,
      relativePath,
      conflict: this.isSkillNameOccupied(summary.name),
      valid: true
    }
  }

  private readSkillManifestSummary(
    skillDir: string
  ): { valid: true; name: string; description: string } | { valid: false; error: string } {
    const skillPath = path.join(skillDir, 'SKILL.md')
    if (!fs.existsSync(skillPath)) {
      return { valid: false, error: 'SKILL.md not found' }
    }

    try {
      const content = fs.readFileSync(skillPath, 'utf-8')
      const { data } = matter(content)
      const name = typeof data.name === 'string' ? data.name.trim() : ''
      const description = typeof data.description === 'string' ? data.description.trim() : ''
      if (!name || !description || !this.isSafeSkillName(name)) {
        return { valid: false, error: 'Invalid SKILL.md frontmatter' }
      }
      return { valid: true, name, description }
    } catch (error) {
      return { valid: false, error: error instanceof Error ? error.message : String(error) }
    }
  }

  private createUniqueSkillName(
    baseName: string,
    _agentId: string = BUILTIN_SKILL_AGENT_ID
  ): string {
    let counter = 1
    let suffix = `-${counter}`
    let candidate = `${baseName.slice(0, SKILL_NAME_MAX_LENGTH - suffix.length)}${suffix}`
    while (this.isSkillNameOccupied(candidate)) {
      counter += 1
      suffix = `-${counter}`
      candidate = `${baseName.slice(0, SKILL_NAME_MAX_LENGTH - suffix.length)}${suffix}`
    }
    return candidate
  }

  private isSkillNameOccupied(name: string): boolean {
    return (
      this.metadataCache.has(name) ||
      Boolean(this.getStoredManagementState().skills[name]) ||
      fs.existsSync(path.join(this.skillsDir, name))
    )
  }

  private requireSyncDirectoryConfig(): SkillSyncDirectoryConfig {
    const config = this.getStoredManagementState().sync
    if (!config) {
      throw new Error('Skills sync directory is not configured')
    }
    this.assertSyncDirectoryIsolated(config.skillsDirectory)
    return config
  }

  private assertSyncDirectoryIsolated(syncDirectory: string): void {
    const syncSkillsDirectory = path.join(syncDirectory, 'skills')
    const managedSkillsDirectory = path.resolve(this.skillsDir)
    const physicalSyncSkillsDirectory = this.resolveDirectoryCandidate(syncSkillsDirectory)
    const physicalManagedSkillsDirectory = this.resolveDirectoryCandidate(managedSkillsDirectory)
    if (
      this.directoriesOverlap(syncSkillsDirectory, managedSkillsDirectory) ||
      this.directoriesOverlap(physicalSyncSkillsDirectory, physicalManagedSkillsDirectory)
    ) {
      throw new Error('Skills sync layout must not overlap the managed Skills directory')
    }
  }

  private resolveDirectoryCandidate(directory: string): string {
    let existingAncestor = path.resolve(directory)
    const missingSegments: string[] = []
    while (!fs.existsSync(existingAncestor)) {
      const parent = path.dirname(existingAncestor)
      if (parent === existingAncestor) break
      missingSegments.unshift(path.basename(existingAncestor))
      existingAncestor = parent
    }
    const physicalAncestor = fs.existsSync(existingAncestor)
      ? fs.realpathSync(existingAncestor)
      : existingAncestor
    return path.resolve(physicalAncestor, ...missingSegments)
  }

  private directoriesOverlap(left: string, right: string): boolean {
    const normalizedLeft = path.resolve(left)
    const normalizedRight = path.resolve(right)
    const leftToRight = path.relative(normalizedLeft, normalizedRight)
    const rightToLeft = path.relative(normalizedRight, normalizedLeft)
    return (
      leftToRight === '' ||
      (!leftToRight.startsWith('..') && !path.isAbsolute(leftToRight)) ||
      (!rightToLeft.startsWith('..') && !path.isAbsolute(rightToLeft))
    )
  }

  private updateSyncDirectoryConfig(patch: Partial<SkillSyncDirectoryConfig>): void {
    const state = this.getStoredManagementState()
    if (!state.sync) {
      throw new Error('Skills sync directory is not configured')
    }
    state.sync = {
      ...state.sync,
      ...patch
    }
    this.saveManagementState(state)
    this.publishEvent('skills.catalog.changed', {
      reason: 'sync-directory-updated',
      version: Date.now()
    })
  }

  private tryUpdateSyncDirectoryActivity(
    operation: 'export' | 'import',
    patch:
      | Pick<SkillSyncDirectoryConfig, 'lastExportAt'>
      | Pick<SkillSyncDirectoryConfig, 'lastImportAt'>
  ): void {
    try {
      this.updateSyncDirectoryConfig(patch)
    } catch (error) {
      logger.warn('[SkillService] Failed to persist sync directory activity timestamp.', {
        operation,
        error
      })
    }
  }

  private replaceSyncDirectorySkill(sourcePath: string, targetPath: string): void {
    const parentDirectory = path.dirname(targetPath)
    const targetName = path.basename(targetPath)
    const operationId = randomUUID()
    const stagingPath = path.join(
      parentDirectory,
      `${SKILL_SYNC_EXPORT_STAGING_PREFIX}${targetName}-${operationId}`
    )
    const backupPath = path.join(
      parentDirectory,
      `${SKILL_SYNC_EXPORT_BACKUP_PREFIX}${targetName}-${operationId}`
    )
    let targetBackedUp = false
    let stagingCommitted = false

    try {
      this.copyDirectory(sourcePath, stagingPath)
      if (fs.existsSync(targetPath)) {
        fs.renameSync(targetPath, backupPath)
        targetBackedUp = true
      }
      fs.renameSync(stagingPath, targetPath)
      stagingCommitted = true
    } catch (error) {
      const rollbackErrors: unknown[] = []
      try {
        if (fs.existsSync(stagingPath)) {
          fs.rmSync(stagingPath, { recursive: true, force: true })
        }
      } catch (rollbackError) {
        rollbackErrors.push(rollbackError)
      }
      try {
        if (stagingCommitted && fs.existsSync(targetPath)) {
          fs.rmSync(targetPath, { recursive: true, force: true })
        }
      } catch (rollbackError) {
        rollbackErrors.push(rollbackError)
      }
      try {
        if (targetBackedUp) {
          fs.renameSync(backupPath, targetPath)
        }
      } catch (rollbackError) {
        rollbackErrors.push(rollbackError)
      }

      if (rollbackErrors.length > 0) {
        const rollbackMessage = rollbackErrors
          .map((rollbackError) =>
            rollbackError instanceof Error ? rollbackError.message : String(rollbackError)
          )
          .join('; ')
        const errorMessage = error instanceof Error ? error.message : String(error)
        throw new Error(`${errorMessage} (rollback failed: ${rollbackMessage})`)
      }
      throw error
    }

    if (!targetBackedUp) return
    try {
      fs.rmSync(backupPath, { recursive: true, force: true })
    } catch (error) {
      logger.warn('[SkillService] Failed to remove completed Skill export backup.', {
        targetName,
        error
      })
    }
  }

  private ensureSyncDirectoryReadme(syncDirectory: string): void {
    const readmePath = path.join(syncDirectory, 'README.md')
    if (!fs.existsSync(readmePath)) {
      fs.writeFileSync(
        readmePath,
        '# DeepChat Skills\n\nThis directory stores portable DeepChat skills under `skills/`.\n',
        'utf-8'
      )
    }
  }

  private resolveExportPreviewState(
    sourcePath: string,
    targetPath: string
  ): SkillSyncDirectoryPreviewItem['state'] {
    if (!fs.existsSync(targetPath)) {
      return 'new'
    }
    return this.areSkillDirectoriesSame(sourcePath, targetPath) ? 'same' : 'modified'
  }

  private createImportPreviewItem(
    sourcePath: string,
    fallbackTargetPath: string
  ): SkillSyncDirectoryPreviewItem {
    const summary = this.readSkillManifestSummary(sourcePath)
    if (!summary.valid) {
      return {
        name: path.basename(sourcePath),
        state: 'invalid',
        sourcePath,
        targetPath: fallbackTargetPath,
        error: summary.error
      }
    }

    const targetPath = path.join(this.skillsDir, summary.name)
    if (!this.isSkillNameOccupied(summary.name)) {
      return {
        name: summary.name,
        state: 'new',
        sourcePath,
        targetPath
      }
    }

    if (this.areSkillDirectoriesSame(sourcePath, targetPath)) {
      return {
        name: summary.name,
        state: 'same',
        sourcePath,
        targetPath
      }
    }

    const existingSource = this.getStoredManagementState().skills[summary.name]?.source
    const state =
      existingSource?.type === 'imported' && existingSource.importedFrom === sourcePath
        ? 'modified'
        : 'conflict'
    return {
      name: summary.name,
      state,
      sourcePath,
      targetPath
    }
  }

  private areSkillDirectoriesSame(left: string, right: string): boolean {
    try {
      return this.createSkillDirectorySnapshot(left) === this.createSkillDirectorySnapshot(right)
    } catch {
      return false
    }
  }

  private areMigratedSkillDirectoriesSame(
    sourceRoot: string,
    targetRoot: string,
    sourceName: string,
    targetName: string
  ): boolean {
    try {
      const sourceFiles = this.collectSkillDirectoryFiles(sourceRoot).sort()
      const targetFiles = this.collectSkillDirectoryFiles(targetRoot).sort()
      if (!this.areSkillListsEqual(sourceFiles, targetFiles)) return false

      for (const relativePath of sourceFiles) {
        const sourceContent = fs.readFileSync(path.join(sourceRoot, relativePath))
        const targetContent = fs.readFileSync(path.join(targetRoot, relativePath))
        if (relativePath !== 'SKILL.md') {
          if (!sourceContent.equals(targetContent)) return false
          continue
        }

        const sourceManifest = matter(sourceContent.toString('utf-8'))
        const targetManifest = matter(targetContent.toString('utf-8'))
        if (sourceManifest.data.name !== sourceName || targetManifest.data.name !== targetName) {
          return false
        }
        if (sourceManifest.content !== targetManifest.content) return false
        const normalizedSource = { ...sourceManifest.data, name: sourceName }
        const normalizedTarget = { ...targetManifest.data, name: sourceName }
        if (this.stableSerialize(normalizedSource) !== this.stableSerialize(normalizedTarget)) {
          return false
        }
      }
      return true
    } catch {
      return false
    }
  }

  private stableSerialize(value: unknown): string {
    if (Array.isArray(value)) {
      return `[${value.map((item) => this.stableSerialize(item)).join(',')}]`
    }
    if (value && typeof value === 'object') {
      return `{${Object.entries(value as Record<string, unknown>)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, item]) => `${JSON.stringify(key)}:${this.stableSerialize(item)}`)
        .join(',')}}`
    }
    return JSON.stringify(value) ?? 'undefined'
  }

  private createSkillDirectorySnapshot(root: string): string {
    return this.collectSkillDirectoryFiles(root)
      .sort()
      .map((relativePath) => {
        const content = fs.readFileSync(path.join(root, relativePath)).toString('base64')
        return `${relativePath}\0${content}`
      })
      .join('\0')
  }

  private collectSkillDirectoryFiles(root: string, current: string = root): string[] {
    const files: string[] = []
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      if (entry.isSymbolicLink() || entry.name === SKILL_CONFIG.SIDECAR_DIR) {
        continue
      }
      const fullPath = path.join(current, entry.name)
      if (entry.isDirectory()) {
        files.push(...this.collectSkillDirectoryFiles(root, fullPath))
      } else {
        files.push(path.relative(root, fullPath))
      }
    }
    return files
  }

  /**
   * Uninstall a skill
   */
  async uninstallSkill(name: string): Promise<SkillInstallResult> {
    return await this.uninstallSkillForAgent(BUILTIN_SKILL_AGENT_ID, name)
  }

  async uninstallSkillForAgent(agentId: string, name: string): Promise<SkillInstallResult> {
    try {
      const normalizedAgentId = await this.requireAgentScope(agentId)
      if (!this.isSafeSkillName(name)) {
        return {
          success: false,
          error: 'Invalid skill name',
          errorCode: 'invalid_skill',
          skillName: name
        }
      }
      await this.ensureAgentCatalogDiscovered(normalizedAgentId)
      if (!this.metadataCache.has(name)) {
        return { success: false, error: `Skill "${name}" not found`, errorCode: 'not_found' }
      }
      await this.setSkillAssignment(normalizedAgentId, name, false)
      return { success: true, skillName: name }
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : String(error) }
    }
  }

  async deleteSkill(name: string, acknowledgedAgentIds: string[]): Promise<SkillDeleteResult> {
    return await this.runMutation(
      async () => await this.deleteSkillUnlocked(name, acknowledgedAgentIds)
    )
  }

  private async deleteSkillUnlocked(
    name: string,
    acknowledgedAgentIds: string[]
  ): Promise<SkillDeleteResult> {
    await this.ensureAgentCatalogDiscovered(BUILTIN_SKILL_AGENT_ID)
    if (!this.isSafeSkillName(name)) {
      return {
        success: false,
        skillName: name,
        error: 'Invalid skill name',
        errorCode: 'invalid_skill'
      }
    }
    const metadata = this.metadataCache.get(name)
    if (!metadata) {
      return {
        success: false,
        skillName: name,
        error: `Skill "${name}" not found`,
        errorCode: 'not_found'
      }
    }
    try {
      this.assertMutableSkillOwnership(BUILTIN_SKILL_AGENT_ID, metadata)
    } catch (error) {
      return {
        success: false,
        skillName: name,
        error: error instanceof Error ? error.message : String(error),
        errorCode: 'permission_denied'
      }
    }

    const state = this.getStoredManagementState()
    const previousState = structuredClone(state)
    const impact = Object.entries(state.agents)
      .filter(([, agent]) => agent.bindings[name]?.assigned === true)
      .map(([agentId]) => agentId)
      .sort()
    const acknowledged = Array.from(new Set(acknowledgedAgentIds)).sort()
    if (!this.areSkillListsEqual(impact, acknowledged)) {
      return {
        success: false,
        skillName: name,
        error: 'Skill assignment impact changed; review the affected Agents and try again',
        errorCode: 'stale_impact',
        affectedAgentIds: impact
      }
    }

    const skillDir = path.resolve(metadata.skillRoot)
    const backupRoot = path.join(app.getPath('home'), '.deepchat', 'backups', 'skill-deletes')
    fs.mkdirSync(backupRoot, { recursive: true })
    const backupDir = path.join(backupRoot, `${name}-${Date.now()}-${randomUUID()}`)
    const sessions = this.agentScopePort ? await this.agentScopePort.listSessions() : []
    const previousSelections = new Map(
      sessions.map((session) => [session.id, this.getPersistedNewSessionSkills(session.id)])
    )
    let moved = false
    try {
      fs.renameSync(skillDir, backupDir)
      moved = true
      delete state.skills[name]
      for (const agent of Object.values(state.agents)) delete agent.bindings[name]
      this.saveManagementState(state)
      this.metadataCache.delete(name)
      this.invalidateSkillContent(name)
      for (const session of sessions) {
        const previous = previousSelections.get(session.id) ?? []
        const next = previous.filter((skillName) => skillName !== name)
        if (!this.areSkillListsEqual(previous, next))
          this.setPersistedNewSessionSkills(session.id, next)
      }
      this.publishEvent('skills.catalog.changed', {
        reason: 'uninstalled',
        name,
        agentIds: impact,
        version: Date.now()
      })
    } catch (error) {
      try {
        this.saveManagementState(previousState)
      } catch {
        // The filesystem restore below is still preferable to losing the package.
      }
      for (const [sessionId, selection] of previousSelections) {
        this.setPersistedNewSessionSkills(sessionId, selection)
      }
      if (moved && fs.existsSync(backupDir) && !fs.existsSync(skillDir)) {
        fs.renameSync(backupDir, skillDir)
      }
      this.metadataCache.set(name, metadata)
      return this.createTargetOperationFailure(name, skillDir, 'remove', error)
    }
    try {
      fs.rmSync(backupDir, { recursive: true, force: true })
    } catch (error) {
      logger.warn('[SkillService] Failed to remove completed Skill deletion backup.', {
        name,
        backupDir,
        error
      })
    }
    return { success: true, skillName: name, affectedAgentIds: impact }
  }

  async cleanupAgentSkills(agentId: string): Promise<void> {
    const normalizedAgentId = assertSafeSkillAgentId(agentId)
    if (normalizedAgentId === BUILTIN_SKILL_AGENT_ID) {
      throw new Error('The built-in DeepChat Agent Skill bindings cannot be deleted')
    }

    this.deletedAgentScopes.add(normalizedAgentId)
    try {
      await this.waitForAgentScopeOperations(normalizedAgentId)
      await this.runMutation(async () => {
        const state = this.getStoredManagementState()
        const changed = Boolean(state.agents[normalizedAgentId])
        delete state.agents[normalizedAgentId]
        if (changed) this.saveManagementState(state)
      })
      this.publishEvent('skills.catalog.changed', {
        reason: 'assignments-updated',
        agentIds: [normalizedAgentId],
        version: Date.now()
      })
    } finally {
      this.deletedAgentScopes.delete(normalizedAgentId)
    }
  }

  private isSafeSkillName(name: string): boolean {
    return (
      name.length <= SKILL_NAME_MAX_LENGTH &&
      SKILL_NAME_PATTERN.test(name) &&
      !name.includes('/') &&
      !name.includes('\\')
    )
  }

  private assertMutableSkillOwnership(agentId: string, metadata: SkillMetadata): void {
    if (metadata.readOnly) {
      throw new Error('Read-only bundled Skills cannot be modified')
    }
    if (metadata.ownerPluginId) {
      throw new Error('Plugin-owned Skills cannot be modified')
    }

    assertSafeSkillAgentId(agentId)
    const agentRoot = this.skillsDir
    const resolvedSkillRoot = path.resolve(metadata.skillRoot)
    const relative = path.relative(agentRoot, resolvedSkillRoot)
    if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) {
      throw new Error(`Skill is outside the global Skills root: ${metadata.name}`)
    }
    const stats = fs.lstatSync(resolvedSkillRoot)
    if (stats.isSymbolicLink() || !stats.isDirectory()) {
      throw new Error(`Skill root is not a real directory: ${metadata.name}`)
    }
    const canonicalAgentRoot = fs.realpathSync(agentRoot)
    const canonicalSkillRoot = fs.realpathSync(resolvedSkillRoot)
    const physicalRelative = path.relative(canonicalAgentRoot, canonicalSkillRoot)
    if (
      !physicalRelative ||
      physicalRelative.startsWith('..') ||
      path.isAbsolute(physicalRelative)
    ) {
      throw new Error(`Skill is outside the global Skills root: ${metadata.name}`)
    }
  }

  /**
   * Update a skill's SKILL.md content
   */
  async updateSkillFile(name: string, content: string): Promise<SkillInstallResult> {
    return await this.updateSkillFileForAgent(BUILTIN_SKILL_AGENT_ID, name, content)
  }

  async updateSkillFileForAgent(
    agentId: string,
    name: string,
    content: string
  ): Promise<SkillInstallResult> {
    return await this.runMutation(
      async () => await this.updateSkillFileForAgentUnlocked(agentId, name, content)
    )
  }

  private async updateSkillFileForAgentUnlocked(
    agentId: string,
    name: string,
    content: string
  ): Promise<SkillInstallResult> {
    let finishAgentOperation: (() => void) | undefined
    try {
      const normalizedAgentId = await this.requireAgentScope(agentId)
      finishAgentOperation = this.beginAgentScopeOperation(normalizedAgentId)
      const metadataCache = this.getMetadataCacheForAgent(normalizedAgentId)
      await this.ensureAgentCatalogDiscovered(normalizedAgentId)
      const metadata = metadataCache.get(name)
      if (!metadata) {
        return { success: false, error: `Skill "${name}" not found` }
      }
      this.assertMutableSkillOwnership(normalizedAgentId, metadata)
      const confinedSkillPath = await this.resolvePhysicalSkillPath(
        metadata.skillRoot,
        metadata.path
      )
      if (!confinedSkillPath) {
        return {
          success: false,
          error: `Skill manifest is outside the physical Skill root: ${name}`
        }
      }

      const previousSkillContent = fs.readFileSync(confinedSkillPath, 'utf-8')
      let manifestWriteStarted = false
      let cachesTouched = false

      try {
        manifestWriteStarted = true
        fs.writeFileSync(confinedSkillPath, content, 'utf-8')

        const newMetadata = await this.parseSkillMetadata(
          confinedSkillPath,
          name,
          undefined,
          this.skillsDir
        )
        if (!newMetadata || newMetadata.name !== name) {
          throw new Error(`Saved Skill failed validation: ${name}`)
        }
        this.assertAgentScopeActive(normalizedAgentId)

        cachesTouched = true
        metadataCache.set(name, newMetadata)
        this.invalidateSkillContent(name)
        this.publishEvent('skills.catalog.changed', {
          reason: 'metadata-updated',
          name: newMetadata.name,
          skill: newMetadata,
          agentIds: this.getAssignedAgentIds(name),
          version: Date.now()
        })

        return { success: true, skillName: name }
      } catch (error) {
        const errorMsg = error instanceof Error ? error.message : String(error)
        let rollbackError: unknown

        if (manifestWriteStarted) {
          try {
            fs.writeFileSync(confinedSkillPath, previousSkillContent, 'utf-8')
          } catch (error) {
            rollbackError = error
          }
        }
        if (cachesTouched) {
          metadataCache.set(name, metadata)
          this.invalidateSkillContent(name)
        }
        if (rollbackError) {
          metadataCache.delete(name)
          this.invalidateSkillContent(name)
          const rollbackMessage =
            rollbackError instanceof Error ? rollbackError.message : String(rollbackError)
          logger.warn('[SkillService] Failed to rollback Skill manifest update', {
            name,
            error,
            rollbackError
          })
          return {
            success: false,
            error: `${errorMsg} (rollback failed: ${rollbackMessage})`
          }
        }

        return { success: false, error: errorMsg }
      }
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error)
      return { success: false, error: errorMsg }
    } finally {
      finishAgentOperation?.()
    }
  }

  async saveSkillWithExtension(
    name: string,
    content: string,
    config: SkillExtensionConfig
  ): Promise<SkillInstallResult> {
    return await this.saveSkillWithExtensionForAgent(BUILTIN_SKILL_AGENT_ID, name, content, config)
  }

  async saveSkillWithExtensionForAgent(
    agentId: string,
    name: string,
    content: string,
    config: SkillExtensionConfig
  ): Promise<SkillInstallResult> {
    return await this.runMutation(
      async () => await this.saveSkillWithExtensionForAgentUnlocked(agentId, name, content, config)
    )
  }

  private async saveSkillWithExtensionForAgentUnlocked(
    agentId: string,
    name: string,
    content: string,
    config: SkillExtensionConfig
  ): Promise<SkillInstallResult> {
    const normalizedAgentId = await this.requireAgentScope(agentId)
    const finishOperation = this.beginAgentScopeOperation(normalizedAgentId)
    try {
      const metadataCache = this.getMetadataCacheForAgent(normalizedAgentId)
      await this.ensureAgentCatalogDiscovered(normalizedAgentId)
      this.assertAgentScopeActive(normalizedAgentId)

      const metadata = metadataCache.get(name)
      if (!metadata) {
        return { success: false, error: `Skill "${name}" not found` }
      }
      this.assertMutableSkillOwnership(normalizedAgentId, metadata)
      const confinedSkillPath = await this.resolvePhysicalSkillPath(
        metadata.skillRoot,
        metadata.path
      )
      if (!confinedSkillPath) {
        return {
          success: false,
          error: `Skill manifest is outside the physical Skill root: ${name}`
        }
      }

      const previousSkillContent = fs.readFileSync(confinedSkillPath, 'utf-8')
      const previousState = this.getStoredManagementState()
      const sanitized = sanitizeSkillExtensionConfig(config)
      let manifestWriteStarted = false
      let managementStateTouched = false
      let cachesTouched = false

      try {
        manifestWriteStarted = true
        fs.writeFileSync(confinedSkillPath, content, 'utf-8')
        const newMetadata = await this.parseSkillMetadata(
          confinedSkillPath,
          name,
          undefined,
          this.skillsDir
        )
        if (!newMetadata || newMetadata.name !== name) {
          throw new Error(`Saved Skill failed validation: ${name}`)
        }
        this.assertAgentScopeActive(normalizedAgentId)

        managementStateTouched = true
        const nextState = this.getStoredManagementState()
        const bindingState = this.getAgentBindingState(nextState, normalizedAgentId)
        const binding = bindingState.bindings[name] ?? {
          assigned: false,
          extension: createDefaultSkillExtensionConfig()
        }
        bindingState.bindings[name] = {
          assigned: binding.assigned,
          extension: sanitized,
          runtimeBindingId: this.nextSkillRuntimeBindingId(binding, sanitized)
        }
        this.saveManagementState(nextState)

        this.assertAgentScopeActive(normalizedAgentId)
        cachesTouched = true
        metadataCache.set(name, newMetadata)
        this.invalidateSkillContent(name)
        this.publishEvent('skills.catalog.changed', {
          reason: 'metadata-updated',
          name: newMetadata.name,
          skill: newMetadata,
          extensionChanged: true,
          agentIds: this.getAssignedAgentIds(name),
          version: Date.now()
        })

        return { success: true, skillName: name }
      } catch (error) {
        const errorMsg = error instanceof Error ? error.message : String(error)
        const rollbackErrors: unknown[] = []

        if (manifestWriteStarted) {
          try {
            fs.writeFileSync(confinedSkillPath, previousSkillContent, 'utf-8')
          } catch (rollbackError) {
            rollbackErrors.push(rollbackError)
          }
        }
        if (managementStateTouched) {
          try {
            this.saveManagementState(previousState)
          } catch (rollbackError) {
            rollbackErrors.push(rollbackError)
          }
        }
        if (cachesTouched) {
          metadataCache.set(name, metadata)
          this.invalidateSkillContent(name)
        }
        if (rollbackErrors.length > 0) {
          metadataCache.delete(name)
          this.invalidateSkillContent(name)
          const rollbackMessage = rollbackErrors
            .map((rollbackError) =>
              rollbackError instanceof Error ? rollbackError.message : String(rollbackError)
            )
            .join('; ')
          logger.warn('[SkillService] Failed to rollback combined skill save', {
            name,
            error,
            rollbackErrors
          })
          return {
            success: false,
            error: `${errorMsg} (rollback failed: ${rollbackMessage})`
          }
        }

        return { success: false, error: errorMsg }
      }
    } finally {
      finishOperation()
    }
  }

  async readSkillFile(name: string): Promise<string> {
    return await this.readSkillFileForAgent(BUILTIN_SKILL_AGENT_ID, name)
  }

  async readSkillFileForAgent(agentId: string, name: string): Promise<string> {
    const normalizedAgentId = await this.requireAgentScope(agentId)
    const metadataCache = this.getMetadataCacheForAgent(normalizedAgentId)
    await this.ensureAgentCatalogDiscovered(normalizedAgentId)

    const metadata = metadataCache.get(name)
    if (!metadata) {
      throw new Error(`Skill "${name}" not found`)
    }
    const confinedSkillPath = await this.resolvePhysicalSkillPath(metadata.skillRoot, metadata.path)
    if (!confinedSkillPath) {
      throw new Error(`Skill manifest is outside the physical Skill root: ${name}`)
    }

    const stats = await fs.promises.stat(confinedSkillPath)
    if (stats.size > SKILL_CONFIG.SKILL_FILE_MAX_SIZE) {
      const errorMessage = `[SkillService] Skill file too large: ${stats.size} bytes (max: ${SKILL_CONFIG.SKILL_FILE_MAX_SIZE})`
      console.error(errorMessage)
      throw new Error(errorMessage)
    }

    return await fs.promises.readFile(confinedSkillPath, 'utf-8')
  }

  /**
   * Get folder tree for a skill
   */
  async getSkillFolderTree(name: string): Promise<SkillFolderNode[]> {
    return await this.getSkillFolderTreeForAgent(BUILTIN_SKILL_AGENT_ID, name)
  }

  async getSkillFolderTreeForAgent(agentId: string, name: string): Promise<SkillFolderNode[]> {
    const normalizedAgentId = await this.requireAgentScope(agentId)
    const metadataCache = this.getMetadataCacheForAgent(normalizedAgentId)
    await this.ensureAgentCatalogDiscovered(normalizedAgentId)
    const metadata = metadataCache.get(name)
    return metadata ? await this.buildFolderTree(metadata.skillRoot) : []
  }

  /**
   * Build folder tree recursively with depth limit and symlink protection
   */
  private async buildFolderTree(
    dirPath: string,
    depth: number = 0,
    maxDepth: number = SKILL_CONFIG.FOLDER_TREE_MAX_DEPTH
  ): Promise<SkillFolderNode[]> {
    if (depth >= maxDepth) {
      return []
    }

    try {
      const entries = await fs.promises.readdir(dirPath, { withFileTypes: true })
      const nodes: SkillFolderNode[] = []

      for (const entry of entries) {
        // Skip symbolic links to prevent infinite recursion
        if (entry.isSymbolicLink?.() || entry.name === SKILL_CONFIG.SIDECAR_DIR) {
          continue
        }

        const fullPath = path.join(dirPath, entry.name)
        if (entry.isDirectory()) {
          nodes.push({
            name: entry.name,
            type: 'directory',
            path: fullPath,
            children: await this.buildFolderTree(fullPath, depth + 1, maxDepth)
          })
        } else {
          nodes.push({
            name: entry.name,
            type: 'file',
            path: fullPath
          })
        }
      }

      return nodes
    } catch (error) {
      console.warn(`[SkillService] Cannot read directory: ${dirPath}`, error)
      return []
    }
  }

  /**
   * Open the skills folder in file explorer
   */
  async openSkillsFolder(): Promise<void> {
    await this.openSkillsFolderForAgent(BUILTIN_SKILL_AGENT_ID)
  }

  async openSkillsFolderForAgent(agentId: string): Promise<void> {
    const normalizedAgentId = await this.requireAgentScope(agentId)
    const finishOperation = this.beginAgentScopeOperation(normalizedAgentId)
    try {
      await shell.openPath(this.skillsDir)
    } finally {
      finishOperation()
    }
  }

  async getSkillExtension(name: string): Promise<SkillExtensionConfig> {
    return await this.getSkillExtensionForAgent(BUILTIN_SKILL_AGENT_ID, name)
  }

  async getSkillExtensionForAgent(agentId: string, name: string): Promise<SkillExtensionConfig> {
    const normalizedAgentId = await this.requireAgentScope(agentId)
    await this.ensureAgentCatalogDiscovered(normalizedAgentId)
    await this.ensureAgentBindingsInitialized(normalizedAgentId)
    const binding = this.getStoredManagementState().agents[normalizedAgentId]?.bindings[name]
    if (binding) return sanitizeSkillExtensionConfig(binding.extension)
    return normalizedAgentId === BUILTIN_SKILL_AGENT_ID
      ? await this.migrateLegacySkillExtension(name)
      : createDefaultSkillExtensionConfig()
  }

  async resolveSkillRuntimeEnvironmentBinding(
    agentId: string,
    name: string,
    expectedBindingId: string | null
  ): Promise<Record<string, string>> {
    const normalizedAgentId = await this.requireAgentScope(agentId)
    const binding = this.getStoredManagementState().agents[normalizedAgentId]?.bindings[name]
    const extension = binding
      ? sanitizeSkillExtensionConfig(binding.extension)
      : createDefaultSkillExtensionConfig()
    const hasEnvironment = Object.keys(extension.env).length > 0
    let actualBindingId: string | null = null
    if (hasEnvironment && !binding?.runtimeBindingId) {
      throw new Error(`Skill "${name}" runtime environment is missing an execution binding`)
    }
    if (hasEnvironment && binding?.runtimeBindingId) actualBindingId = binding.runtimeBindingId
    if (actualBindingId !== expectedBindingId) {
      throw new Error(`Skill "${name}" runtime environment binding changed before execution`)
    }
    return { ...extension.env }
  }

  private async migrateLegacySkillExtension(
    name: string,
    failOnUnreadable: boolean = false
  ): Promise<SkillExtensionConfig> {
    const sidecarPath = this.getSidecarPath(name)
    if (!(await this.pathExists(sidecarPath))) {
      return createDefaultSkillExtensionConfig()
    }
    try {
      const content = await fs.promises.readFile(sidecarPath, 'utf-8')
      const config = sanitizeSkillExtensionConfig(JSON.parse(content))
      const state = this.getStoredManagementState()
      const bindingState = this.getAgentBindingState(state, BUILTIN_SKILL_AGENT_ID)
      const previous = bindingState.bindings[name] ?? {
        assigned: true,
        extension: createDefaultSkillExtensionConfig()
      }
      bindingState.bindings[name] = {
        assigned: previous.assigned,
        extension: config,
        runtimeBindingId: this.nextSkillRuntimeBindingId(previous, config)
      }
      this.saveManagementState(state)
      try {
        fs.rmSync(sidecarPath, { force: true })
        this.removeLegacySidecarDirIfEmpty()
      } catch (cleanupError) {
        logger.warn('[SkillService] Failed to remove migrated skill sidecar', {
          name,
          error: cleanupError
        })
      }
      return config
    } catch (error) {
      logger.warn('[SkillService] Failed to read skill sidecar, using defaults', {
        name,
        error
      })
      if (failOnUnreadable) {
        throw new Error(`Legacy Skill extension migration failed: ${name}`, { cause: error })
      }
      return createDefaultSkillExtensionConfig()
    }
  }

  private removeLegacySidecarDirIfEmpty(): void {
    try {
      if (fs.existsSync(this.sidecarDir) && fs.readdirSync(this.sidecarDir).length === 0) {
        fs.rmSync(this.sidecarDir, { force: true, recursive: false })
      }
    } catch {
      // Keep legacy residue for the next migration attempt.
    }
  }

  async saveSkillExtension(name: string, config: SkillExtensionConfig): Promise<void> {
    await this.saveSkillExtensionForAgent(BUILTIN_SKILL_AGENT_ID, name, config)
  }

  async saveSkillExtensionForAgent(
    agentId: string,
    name: string,
    config: SkillExtensionConfig
  ): Promise<void> {
    await this.runMutation(async () => {
      await this.saveSkillExtensionForAgentUnlocked(agentId, name, config)
    })
  }

  private async saveSkillExtensionForAgentUnlocked(
    agentId: string,
    name: string,
    config: SkillExtensionConfig
  ): Promise<void> {
    const normalizedAgentId = await this.requireAgentScope(agentId)
    const finishOperation = this.beginAgentScopeOperation(normalizedAgentId)
    try {
      const metadataCache = this.getMetadataCacheForAgent(normalizedAgentId)
      await this.ensureAgentCatalogDiscovered(normalizedAgentId)
      this.assertAgentScopeActive(normalizedAgentId)
      if (!metadataCache.has(name)) throw new Error(`Skill "${name}" not found`)
      const state = this.getStoredManagementState()
      const bindingState = this.getAgentBindingState(state, normalizedAgentId)
      const binding = bindingState.bindings[name]
      if (!binding?.assigned) throw new Error(`Skill "${name}" is not assigned to Agent`)
      const sanitized = sanitizeSkillExtensionConfig(config)
      bindingState.bindings[name] = {
        assigned: true,
        extension: sanitized,
        runtimeBindingId: this.nextSkillRuntimeBindingId(binding, sanitized)
      }
      this.saveManagementState(state)
      this.getContentCacheForAgent(normalizedAgentId).delete(name)
    } finally {
      finishOperation()
    }
  }

  async listSkillScripts(name: string): Promise<SkillScriptDescriptor[]> {
    return await this.listSkillScriptsForAgent(BUILTIN_SKILL_AGENT_ID, name)
  }

  async listSkillScriptsForAgent(agentId: string, name: string): Promise<SkillScriptDescriptor[]> {
    const normalizedAgentId = await this.requireAgentScope(agentId)
    const metadataCache = this.getMetadataCacheForAgent(normalizedAgentId)
    await this.ensureAgentCatalogDiscovered(normalizedAgentId)

    const metadata = metadataCache.get(name)
    if (!metadata) {
      return []
    }

    return await this.listSkillScriptsFromMetadata(normalizedAgentId, metadata)
  }

  private async listSkillScriptsFromMetadata(
    agentId: string,
    metadata: SkillMetadata
  ): Promise<SkillScriptDescriptor[]> {
    const scriptsDir = path.join(metadata.skillRoot, 'scripts')
    if (!(await this.pathExists(scriptsDir))) {
      return []
    }
    const confinedScriptsDir = await this.resolvePhysicalSkillPath(metadata.skillRoot, scriptsDir)
    if (!confinedScriptsDir) {
      logger.warn('[SkillService] Ignoring a scripts directory outside the physical Skill root.', {
        agentId,
        name: metadata.name,
        scriptsDir
      })
      return []
    }

    const extension = await this.getSkillExtensionForAgent(agentId, metadata.name)
    const descriptors = (
      await this.collectScriptDescriptors(confinedScriptsDir, metadata.skillRoot)
    ).map((script) => {
      const legacyRelativePath = script.relativePath.replaceAll('/', path.sep)
      const override =
        extension.scriptOverrides[script.relativePath] ??
        extension.scriptOverrides[legacyRelativePath] ??
        {}
      return {
        ...script,
        enabled: override.enabled ?? true,
        description: override.description
      }
    })

    descriptors.sort((left, right) =>
      Buffer.compare(
        Buffer.from(left.relativePath, 'utf8'),
        Buffer.from(right.relativePath, 'utf8')
      )
    )
    return descriptors
  }

  async resolveSessionAgentId(conversationId: string): Promise<string | null> {
    if (!this.agentScopePort) return BUILTIN_SKILL_AGENT_ID
    const agentId = await this.agentScopePort.getSessionAgentId(conversationId)
    return agentId && (await this.agentScopePort.isDeepChatAgent(agentId)) ? agentId : null
  }

  private async isNewAgentSession(conversationId: string): Promise<boolean> {
    try {
      return await this.sessionStatePort.hasNewSession(conversationId)
    } catch {
      return false
    }
  }

  private isImportedLegacySessionId(conversationId: string): boolean {
    return conversationId.startsWith('legacy-session-')
  }

  private async loadNewSessionSkills(conversationId: string): Promise<string[]> {
    const persistedSkills = this.getPersistedNewSessionSkills(conversationId)
    if (persistedSkills.length > 0 || !this.isImportedLegacySessionId(conversationId)) {
      return persistedSkills
    }

    try {
      return await this.sessionStatePort.repairImportedLegacySessionSkills(conversationId)
    } catch (error) {
      console.warn(
        `[SkillService] Failed to repair imported legacy session skills for ${conversationId}:`,
        error
      )
      return persistedSkills
    }
  }

  private warnLegacySkillRetired(conversationId: string): void {
    if (this.legacySkillRetirementWarnings.has(conversationId)) {
      return
    }

    this.legacySkillRetirementWarnings.add(conversationId)
    logger.warn('[SkillService] Ignoring skill state update for retired legacy conversation.', {
      conversationId
    })
  }

  /**
   * Get active skills for a conversation
   */
  async getActiveSkills(conversationId: string): Promise<string[]> {
    return await this.runActiveSkillMutation(conversationId, () =>
      this.getActiveSkillsUnlocked(conversationId)
    )
  }

  private async getActiveSkillsUnlocked(conversationId: string): Promise<string[]> {
    if (this.retiredSessionSkillScopes.has(conversationId)) return []
    if (await this.isNewAgentSession(conversationId)) {
      const agentId = await this.resolveSessionAgentId(conversationId)
      if (!agentId) return []
      const skills = await this.loadNewSessionSkills(conversationId)
      const validSkills = await this.validateSkillNames(agentId, skills)
      if (this.retiredSessionSkillScopes.has(conversationId)) return []
      if (!this.areSkillListsEqual(validSkills, skills)) {
        this.setPersistedNewSessionSkills(conversationId, validSkills)
      }
      return validSkills
    }

    return []
  }

  /**
   * Set active skills for a conversation
   */
  async setActiveSkills(conversationId: string, skills: string[]): Promise<string[]> {
    return await this.runActiveSkillMutation(conversationId, () =>
      this.setActiveSkillsUnlocked(conversationId, skills)
    )
  }

  async removeActiveSkill(conversationId: string, skill: string): Promise<string[]> {
    return await this.runActiveSkillMutation(conversationId, async () => {
      const activeSkills = await this.getActiveSkillsUnlocked(conversationId)
      if (!activeSkills.includes(skill)) return activeSkills
      return await this.setActiveSkillsUnlocked(
        conversationId,
        activeSkills.filter((activeSkill) => activeSkill !== skill)
      )
    })
  }

  private async runActiveSkillMutation<T>(
    conversationId: string,
    operation: () => Promise<T>
  ): Promise<T> {
    const previous = this.activeSkillMutationTails.get(conversationId) ?? Promise.resolve()
    let release!: () => void
    const current = new Promise<void>((resolve) => {
      release = resolve
    })
    const tail = previous.catch(() => undefined).then(() => current)
    this.activeSkillMutationTails.set(conversationId, tail)
    await previous.catch(() => undefined)
    try {
      return await operation()
    } finally {
      release()
      if (this.activeSkillMutationTails.get(conversationId) === tail) {
        this.activeSkillMutationTails.delete(conversationId)
      }
    }
  }

  private async setActiveSkillsUnlocked(
    conversationId: string,
    skills: string[]
  ): Promise<string[]> {
    try {
      if (this.retiredSessionSkillScopes.has(conversationId)) return []
      const isNewSession = await this.isNewAgentSession(conversationId)
      const agentId = await this.resolveSessionAgentId(conversationId)
      // Validate skill names against the owning Agent's catalog.
      const validSkills = agentId ? await this.validateSkillNames(agentId, skills) : []
      if (this.retiredSessionSkillScopes.has(conversationId)) return []
      if (!isNewSession || !agentId) {
        this.warnLegacySkillRetired(conversationId)
        return await this.getActiveSkillsUnlocked(conversationId)
      }

      const previousSkills = await this.getActiveSkillsUnlocked(conversationId)
      const previousSet = new Set(previousSkills)
      const validSet = new Set(validSkills)

      this.setPersistedNewSessionSkills(conversationId, validSkills)

      const activated = validSkills.filter((skill) => !previousSet.has(skill))
      const deactivated = previousSkills.filter((skill) => !validSet.has(skill))

      if (activated.length > 0) {
        this.publishEvent('skills.session.changed', {
          conversationId,
          skills: activated,
          change: 'activated',
          version: Date.now()
        })
      }

      if (deactivated.length > 0) {
        this.publishEvent('skills.session.changed', {
          conversationId,
          skills: deactivated,
          change: 'deactivated',
          version: Date.now()
        })
      }

      return validSkills
    } catch (error) {
      console.error(`[SkillService] Error setting active skills for ${conversationId}:`, error)
      throw error
    }
  }

  async clearNewAgentSessionSkills(conversationId: string): Promise<void> {
    // Session deletion is terminal for this service instance. Mark it before joining the mutation
    // queue so an in-flight or newly queued validation cannot restore stale persistent state.
    this.retiredSessionSkillScopes.add(conversationId)
    await this.runActiveSkillMutation(conversationId, async () => {
      this.setPersistedNewSessionSkills(conversationId, [])
    })
  }

  completeNewAgentSessionSkillsDeletion(conversationId: string): void {
    // The Session row is gone, so stale writers can no longer restore persistent state. Keep the
    // tombstone until this explicit lifecycle boundary rather than retaining every deleted ID for
    // the lifetime of the process.
    this.retiredSessionSkillScopes.delete(conversationId)
  }

  async revalidateActiveSkillsForAgent(conversationId: string, agentId: string): Promise<string[]> {
    return await this.runActiveSkillMutation(conversationId, async () => {
      if (this.retiredSessionSkillScopes.has(conversationId)) return []
      const persisted = this.getPersistedNewSessionSkills(conversationId)
      const valid = await this.validateSkillNames(agentId, persisted)
      if (this.retiredSessionSkillScopes.has(conversationId)) return []
      if (!this.areSkillListsEqual(persisted, valid)) {
        this.setPersistedNewSessionSkills(conversationId, valid)
      }
      return valid
    })
  }

  /**
   * Validate skill names against available skills
   */
  async validateSkillNames(names: string[]): Promise<string[]>
  async validateSkillNames(agentId: string, names: string[]): Promise<string[]>
  async validateSkillNames(
    agentIdOrNames: string | string[],
    maybeNames?: string[]
  ): Promise<string[]> {
    const agentId = Array.isArray(agentIdOrNames)
      ? BUILTIN_SKILL_AGENT_ID
      : await this.requireAgentScope(agentIdOrNames)
    const names = Array.isArray(agentIdOrNames) ? agentIdOrNames : (maybeNames ?? [])
    const available = await this.getMetadataList(agentId)
    const availableNames = new Set(available.map((s) => s.name))
    const seen = new Set<string>()
    const validNames: string[] = []
    for (const name of names) {
      const resolvedName = availableNames.has(name) ? name : (SKILL_NAME_ALIASES.get(name) ?? name)
      if (!availableNames.has(resolvedName) || seen.has(resolvedName)) {
        continue
      }
      seen.add(resolvedName)
      validNames.push(resolvedName)
    }
    return validNames
  }

  private areSkillListsEqual(left: string[], right: string[]): boolean {
    return left.length === right.length && left.every((skill, index) => skill === right[index])
  }

  /**
   * Get allowed tools for active skills in a conversation
   */
  async getActiveSkillsAllowedTools(
    conversationId: string,
    activeSkillNamesOverride?: string[]
  ): Promise<string[]> {
    const agentId = await this.resolveSessionAgentId(conversationId)
    if (!agentId) return []
    const metadataCache = this.getMetadataCacheForAgent(agentId)
    await this.ensureAgentCatalogDiscovered(agentId)

    const activeSkills = activeSkillNamesOverride ?? (await this.getActiveSkills(conversationId))
    const allowedTools: Set<string> = new Set()

    for (const skillName of activeSkills) {
      const metadata = metadataCache.get(skillName)
      const visibleInSnapshot =
        activeSkillNamesOverride !== undefined ||
        (metadata && this.isSkillVisible(metadata, agentId))
      if (metadata?.allowedTools && visibleInSnapshot) {
        metadata.allowedTools.forEach((tool) => allowedTools.add(tool))
      }
    }

    const result = normalizeSkillAllowedTools(Array.from(allowedTools))
    for (const warning of result.warnings) {
      logger.warn(warning, { conversationId })
    }
    return result.tools
  }

  private closeFailedWatcher(watcher: WatchHandle): void {
    void watcher.close().catch((error) => {
      logger.warn('[SkillService] Failed to close failed file watcher.', { error })
    })
  }

  private handleWatcherStartFailure(error: unknown): void {
    this.watcher = null
    logger.warn('[SkillService] File watcher unavailable; skill hot reload disabled.', {
      reason: 'start-failed',
      error
    })
  }

  /**
   * Watch skill files for changes (hot-reload)
   */
  async watchSkillFiles(): Promise<void> {
    this.assertServiceActive()

    if (this.watcher) {
      return
    }

    if (this.watcherStartPromise) {
      return await this.watcherStartPromise
    }

    this.watcherStartPromise = this.watcherService
      .watch(
        {
          id: createWatcherRequestId('content', 'skills', this.skillsDir),
          rootPath: this.skillsDir,
          hostKind: 'content',
          purpose: 'skills',
          recursive: true,
          excludes: this.createSkillWatchExcludes(),
          fallbackMode: 'snapshot-polling'
        },
        (batch) => this.handleSkillWatchBatch(batch),
        (status) => this.handleSkillWatchStatus(status)
      )
      .then((handle) => {
        this.watcher = handle
        logger.info('[SkillService] File watcher started')
      })
      .catch((error) => {
        this.handleWatcherStartFailure(error)
      })
      .finally(() => {
        this.watcherStartPromise = null
      })

    return await this.watcherStartPromise
  }

  /**
   * Stop watching skill files
   */
  async stopWatching(): Promise<void> {
    await this.watcherStartPromise

    if (!this.watcher) {
      return
    }

    await this.watcher.close()
    this.watcher = null
    logger.info('[SkillService] File watcher stopped')
  }

  private createSkillWatchExcludes(): string[] {
    const root = this.skillsDir.split(path.sep).join('/')
    return [
      `${root}/${SKILL_CONFIG.SIDECAR_DIR}/**`,
      `${root}/**/${SKILL_CONFIG.SIDECAR_DIR}/**`,
      `${root}/.agent-scopes/**`,
      `${root}/${SKILL_INSTALL_STAGING_PREFIX}*/**`,
      `${root}/${SHARED_SKILL_MIGRATION_DIR}/**`
    ]
  }

  private async handleSkillWatchBatch(batch: WatcherEventBatch): Promise<void> {
    if (batch.events.some((event) => event.type === 'overflow' || event.type === 'root-deleted')) {
      await this.discoverSkills(BUILTIN_SKILL_AGENT_ID)
      return
    }

    for (const event of batch.events) {
      if (!this.isWatchedSkillMarkdownPath(event.path)) continue
      if (this.isWithinAgentScopesDirectory(event.path)) continue
      const agentId = BUILTIN_SKILL_AGENT_ID
      if (event.type === 'create') {
        await this.handleSkillFileAdded(event.path, agentId)
      } else if (event.type === 'update') {
        await this.handleSkillFileChanged(event.path, agentId)
      } else if (event.type === 'delete') {
        await this.handleSkillFileDeleted(event.path, agentId)
      }
    }
  }

  private handleSkillWatchStatus(status: WatcherStatus): void {
    if (status.health === 'healthy') {
      return
    }

    logger.warn('[SkillService] File watcher degraded.', {
      health: status.health,
      mode: status.mode,
      reason: status.reason,
      message: status.message
    })

    if (status.health !== 'failed' || !this.watcher) {
      return
    }

    const watcher = this.watcher
    this.watcher = null
    this.closeFailedWatcher(watcher)
  }

  private isWithinAgentScopesDirectory(filePath: string): boolean {
    const relativePath = path.relative(this.skillsDir, filePath)
    if (!relativePath || relativePath.startsWith('..') || path.isAbsolute(relativePath)) {
      return false
    }
    return relativePath.split(/[\\/]+/).filter(Boolean)[0] === '.agent-scopes'
  }

  private isWatchedSkillMarkdownPath(filePath: string): boolean {
    if (path.basename(filePath) !== 'SKILL.md') {
      return false
    }

    const relativePath = path.relative(this.skillsDir, filePath)
    if (!relativePath || relativePath.startsWith('..') || path.isAbsolute(relativePath)) {
      return false
    }

    const segments = relativePath.split(/[\\/]+/).filter(Boolean)
    return (
      !segments[0]?.startsWith('.') &&
      !segments.includes(SKILL_CONFIG.SIDECAR_DIR) &&
      segments.length - 1 <= SKILL_CONFIG.FOLDER_TREE_MAX_DEPTH
    )
  }

  private async handleSkillFileChanged(
    filePath: string,
    agentId: string = BUILTIN_SKILL_AGENT_ID
  ): Promise<void> {
    if (this.deletedAgentScopes.has(agentId)) return
    const metadataCache = this.getMetadataCacheForAgent(agentId)
    const previousName =
      this.findSkillNameByPath(filePath, agentId) ?? path.basename(path.dirname(filePath))
    this.invalidateSkillContent(previousName)

    const metadata = await this.parseSkillMetadata(
      filePath,
      path.basename(path.dirname(filePath)),
      undefined,
      this.skillsDir
    )
    if (!metadata || this.deletedAgentScopes.has(agentId)) {
      return
    }

    const existingMetadata = metadataCache.get(metadata.name)
    if (existingMetadata && existingMetadata.path !== metadata.path) {
      logger.warn('[SkillService] Duplicate skill name discovered. Keeping the first entry.', {
        name: metadata.name,
        path: metadata.path,
        existingPath: existingMetadata.path
      })
      const previousMetadata = metadataCache.get(previousName)
      if (previousName !== metadata.name && previousMetadata?.path === metadata.path) {
        metadataCache.delete(previousName)
      }
      return
    }

    if (previousName !== metadata.name) {
      const previousMetadata = metadataCache.get(previousName)
      if (previousMetadata?.path === metadata.path) {
        metadataCache.delete(previousName)
      }
    }

    metadataCache.set(metadata.name, metadata)
    this.publishEvent('skills.catalog.changed', {
      reason: 'metadata-updated',
      name: metadata.name,
      skill: metadata,
      agentIds: this.getAssignedAgentIds(metadata.name),
      version: Date.now()
    })
  }

  private async handleSkillFileAdded(
    filePath: string,
    agentId: string = BUILTIN_SKILL_AGENT_ID
  ): Promise<void> {
    if (this.deletedAgentScopes.has(agentId)) return
    const metadata = await this.parseSkillMetadata(
      filePath,
      path.basename(path.dirname(filePath)),
      undefined,
      this.skillsDir
    )
    if (!metadata || this.deletedAgentScopes.has(agentId)) return

    const metadataCache = this.getMetadataCacheForAgent(agentId)
    const existingMetadata = metadataCache.get(metadata.name)
    if (existingMetadata && existingMetadata.path !== metadata.path) {
      logger.warn('[SkillService] Duplicate skill name discovered. Keeping the first entry.', {
        name: metadata.name,
        path: metadata.path,
        existingPath: existingMetadata.path
      })
      return
    }

    metadataCache.set(metadata.name, metadata)
    this.reconcileSkillManagementState()
    this.publishEvent('skills.catalog.changed', {
      reason: 'installed',
      name: metadata.name,
      skill: metadata,
      agentIds: this.getAssignedAgentIds(metadata.name),
      version: Date.now()
    })
  }

  private async handleSkillFileDeleted(
    filePath: string,
    agentId: string = BUILTIN_SKILL_AGENT_ID
  ): Promise<void> {
    if (this.deletedAgentScopes.has(agentId)) return
    const skillName = this.findSkillNameByPath(filePath, agentId)
    if (!skillName) return
    if (fs.existsSync(filePath)) {
      await this.handleSkillFileChanged(filePath, agentId)
      return
    }

    this.getMetadataCacheForAgent(agentId).delete(skillName)
    this.invalidateSkillContent(skillName)
    this.publishEvent('skills.catalog.changed', {
      reason: 'uninstalled',
      name: skillName,
      agentIds: this.getAssignedAgentIds(skillName),
      version: Date.now()
    })
  }

  /**
   * Utility: Copy directory recursively (skips symbolic links)
   */
  private copyDirectory(src: string, dest: string): void {
    fs.mkdirSync(dest, { recursive: true })

    const entries = fs.readdirSync(src, { withFileTypes: true })

    for (const entry of entries) {
      if (entry.isSymbolicLink()) {
        throw new Error(`Symbolic links are not allowed in Skill snapshots: ${src}`)
      }
      if (entry.name === SKILL_CONFIG.SIDECAR_DIR) {
        continue
      }

      const srcPath = path.join(src, entry.name)
      const destPath = path.join(dest, entry.name)

      if (entry.isDirectory()) {
        this.copyDirectory(srcPath, destPath)
      } else {
        fs.copyFileSync(srcPath, destPath)
      }
    }
  }

  /**
   * Cleanup resources on shutdown
   */
  async destroy(): Promise<void> {
    if (this.destroyPromise) {
      await this.destroyPromise
      return
    }
    this.stopped = true
    const destruction = this.destroyOnce()
    this.destroyPromise = destruction
    try {
      await destruction
    } finally {
      if (this.destroyPromise === destruction) {
        this.destroyPromise = null
      }
    }
  }

  private async destroyOnce(): Promise<void> {
    const pendingInitialization = this.initializationPromise
    if (pendingInitialization) {
      try {
        await pendingInitialization
      } catch (error) {
        logger.warn('[SkillService] Initialization failed while shutdown was draining.', { error })
      }
    }
    await Promise.all(
      Array.from(this.activeAgentScopeOperations.keys()).map(async (agentId) => {
        await this.waitForAgentScopeOperations(agentId)
      })
    )
    await this.stopWatching()
    this.metadataCache.clear()
    this.contentCache.clear()
    this.readOnlyBundledSkills = []
    this.deletedAgentScopes.clear()
    this.activeAgentScopeOperations.clear()
    this.agentScopeDrainWaiters.clear()
    this.retiredSessionSkillScopes.clear()
    this.discoveryPromise = null
    this.initializationPromise = null
    this.builtinCatalogDiscovered = false
    this.initialized = false
  }

  private shouldIgnoreSkillsRootEntry(entryName: string): boolean {
    return (
      entryName === SKILL_CONFIG.SIDECAR_DIR ||
      BUILTIN_SKILL_ROOT_EXCLUDED_DIRS.has(entryName) ||
      entryName.includes('.backup-') ||
      entryName.startsWith('.')
    )
  }

  private getSidecarPath(name: string): string {
    return path.join(this.sidecarDir, `${name}.json`)
  }

  private async collectScriptDescriptors(
    currentDir: string,
    skillRoot: string,
    acc: SkillScriptDescriptor[] = []
  ): Promise<SkillScriptDescriptor[]> {
    if (!(await this.resolvePhysicalSkillPath(skillRoot, currentDir))) {
      return acc
    }
    const entries = await fs.promises.readdir(currentDir, { withFileTypes: true })

    for (const entry of entries) {
      if (entry.isSymbolicLink()) {
        continue
      }

      const fullPath = path.join(currentDir, entry.name)
      if (entry.isDirectory()) {
        await this.collectScriptDescriptors(fullPath, skillRoot, acc)
        continue
      }

      const runtime = SUPPORTED_SCRIPT_EXTENSIONS[path.extname(entry.name).toLowerCase()]
      if (!runtime) {
        continue
      }
      const confinedFilePath = await this.resolvePhysicalSkillPath(skillRoot, fullPath)
      if (!confinedFilePath) {
        continue
      }

      const relativePath = path
        .relative(skillRoot, confinedFilePath)
        .split(path.sep)
        .join('/')
        .normalize('NFC')
      acc.push({
        name: entry.name,
        relativePath,
        absolutePath: confinedFilePath,
        runtime,
        enabled: true
      })
    }

    return acc
  }

  private async collectSkillManifestPaths(
    currentDir: string,
    depth: number = 0,
    acc: string[] = []
  ): Promise<string[]> {
    if (depth > SKILL_CONFIG.FOLDER_TREE_MAX_DEPTH) {
      return acc
    }

    let entries: fs.Dirent[]
    try {
      entries = await fs.promises.readdir(currentDir, { withFileTypes: true })
    } catch (error) {
      logger.warn('[SkillService] Failed to scan skill directory, skipping subtree', {
        currentDir,
        error
      })
      return acc
    }

    for (const entry of entries) {
      if (entry.isSymbolicLink()) {
        continue
      }

      const fullPath = path.join(currentDir, entry.name)
      if (entry.isDirectory()) {
        if (this.shouldIgnoreSkillsRootEntry(entry.name)) {
          continue
        }
        await this.collectSkillManifestPaths(fullPath, depth + 1, acc)
        continue
      }

      if (entry.name === 'SKILL.md') {
        acc.push(fullPath)
      }
    }

    return acc
  }

  private deriveSkillCategory(
    skillRoot: string,
    catalogRoot: string = this.skillsDir
  ): string | null {
    const pluginContribution = this.getPluginContributionForSkillRoot(skillRoot)
    if (pluginContribution) {
      return `plugin/${pluginContribution.ownerPluginId}`
    }

    const relative = path.relative(catalogRoot, skillRoot)
    if (!relative || relative === '.' || path.isAbsolute(relative)) {
      return null
    }

    const segments = relative.split(path.sep).filter(Boolean)
    return segments.length > 1 ? segments.slice(0, -1).join('/') : null
  }

  private getPluginContributionForSkillRoot(
    skillRoot: string
  ): { ownerPluginId: string; skillRoot: string; pluginRoot?: string } | undefined {
    return Array.from(this.pluginSkillContributions.values()).find(
      (contribution) => path.resolve(contribution.skillRoot) === path.resolve(skillRoot)
    )
  }

  private async listSkillLinkedFiles(skillRoot: string): Promise<SkillLinkedFile[]> {
    const linkedFiles: SkillLinkedFile[] = []
    for (const [dirName, kind] of [
      ['references', 'reference'],
      ['templates', 'template'],
      ['scripts', 'script'],
      ['assets', 'asset']
    ] as const) {
      const targetDir = path.join(skillRoot, dirName)
      if (!(await this.pathExists(targetDir))) {
        continue
      }
      const confinedTargetDir = await this.resolvePhysicalSkillPath(skillRoot, targetDir)
      if (!confinedTargetDir) {
        continue
      }
      await this.collectLinkedFiles(confinedTargetDir, skillRoot, kind, linkedFiles)
    }

    return linkedFiles.sort((left, right) => left.path.localeCompare(right.path))
  }

  private async collectLinkedFiles(
    currentDir: string,
    skillRoot: string,
    kind: SkillLinkedFile['kind'],
    acc: SkillLinkedFile[]
  ): Promise<void> {
    if (!(await this.resolvePhysicalSkillPath(skillRoot, currentDir))) {
      return
    }
    const entries = await fs.promises.readdir(currentDir, { withFileTypes: true })

    for (const entry of entries) {
      if (entry.isSymbolicLink()) {
        continue
      }

      const fullPath = path.join(currentDir, entry.name)
      if (entry.isDirectory()) {
        await this.collectLinkedFiles(fullPath, skillRoot, kind, acc)
        continue
      }

      const confinedFilePath = await this.resolvePhysicalSkillPath(skillRoot, fullPath)
      if (!confinedFilePath) {
        continue
      }
      acc.push({
        path: path.relative(skillRoot, confinedFilePath),
        kind
      })
    }
  }

  private resolveSkillRelativePath(skillRoot: string, filePath: string): string | null {
    const resolvedPath = path.resolve(skillRoot, filePath)
    const relativePath = path.relative(skillRoot, resolvedPath)
    if (!relativePath || relativePath.startsWith('..') || path.isAbsolute(relativePath)) {
      return null
    }
    return resolvedPath
  }

  private async resolvePhysicalSkillPath(
    skillRoot: string,
    candidatePath: string
  ): Promise<string | null> {
    const resolvedRoot = path.resolve(skillRoot)
    const resolvedCandidate = path.resolve(candidatePath)
    const relativeCandidate = path.relative(resolvedRoot, resolvedCandidate)
    if (
      !relativeCandidate ||
      relativeCandidate.startsWith('..') ||
      path.isAbsolute(relativeCandidate)
    ) {
      return null
    }

    try {
      const rootStats = await fs.promises.lstat(resolvedRoot)
      if (rootStats.isSymbolicLink() || !rootStats.isDirectory()) {
        return null
      }

      let currentPath = resolvedRoot
      for (const segment of relativeCandidate.split(path.sep).filter(Boolean)) {
        currentPath = path.join(currentPath, segment)
        const stats = await fs.promises.lstat(currentPath)
        if (stats.isSymbolicLink()) {
          return null
        }
      }

      const [canonicalRoot, canonicalCandidate] = await Promise.all([
        fs.promises.realpath(resolvedRoot),
        fs.promises.realpath(resolvedCandidate)
      ])
      const physicalRelative = path.relative(canonicalRoot, canonicalCandidate)
      if (
        !physicalRelative ||
        physicalRelative.startsWith('..') ||
        path.isAbsolute(physicalRelative)
      ) {
        return null
      }
      return resolvedCandidate
    } catch {
      return null
    }
  }

  private isBinaryLikeFile(filePath: string): boolean {
    return BINARY_LIKE_EXTENSIONS.has(path.extname(filePath).toLowerCase())
  }

  private async pathExists(target: string): Promise<boolean> {
    try {
      await fs.promises.access(target)
      return true
    } catch {
      return false
    }
  }

  private validateDraftSkillDocument(
    content: string | undefined
  ): { success: true; skillName: string } | { success: false; error: string } {
    if (typeof content !== 'string' || content.trim().length === 0) {
      return { success: false, error: 'content is required' }
    }
    if (!content.trimStart().startsWith('---')) {
      return { success: false, error: 'Draft skill content must include YAML frontmatter' }
    }
    if (content.length > SKILL_CONFIG.DRAFT_MAX_CONTENT_CHARS) {
      return {
        success: false,
        error: `Draft skill content exceeds ${SKILL_CONFIG.DRAFT_MAX_CONTENT_CHARS} characters`
      }
    }

    const blockedPattern = this.findDraftInjectionPattern(content)
    if (blockedPattern) {
      return {
        success: false,
        error: `Draft content rejected by security scan: ${blockedPattern}`
      }
    }

    const { data, content: body } = matter(content)
    const skillName = typeof data.name === 'string' ? data.name.trim() : ''
    const description = typeof data.description === 'string' ? data.description.trim() : ''
    if (!skillName) {
      return { success: false, error: 'Skill frontmatter must include name' }
    }
    if (!SKILL_NAME_PATTERN.test(skillName) || skillName.length > 64) {
      return {
        success: false,
        error: 'Skill name must match ^[a-z0-9][a-z0-9._-]*$ and be <= 64 characters'
      }
    }
    if (!description || description.length > 1024) {
      return {
        success: false,
        error: 'Skill description is required and must be <= 1024 characters'
      }
    }
    if (!body.trim()) {
      return { success: false, error: 'Skill body cannot be empty' }
    }

    return { success: true, skillName }
  }

  private findDraftInjectionPattern(content: string): string | null {
    const matched = DRAFT_INJECTION_PATTERNS.find((pattern) => pattern.test(content))
    return matched ? matched.source : null
  }

  private ensureDraftRoot(): void {
    if (!fs.existsSync(this.draftsRoot)) {
      fs.mkdirSync(this.draftsRoot, { recursive: true })
    }
  }

  private validateDraftConversationId(conversationId: string): string | null {
    const normalizedConversationId = conversationId.trim()
    if (!normalizedConversationId) {
      return null
    }
    if (path.isAbsolute(normalizedConversationId)) {
      return null
    }
    if (normalizedConversationId !== path.basename(normalizedConversationId)) {
      return null
    }
    if (
      normalizedConversationId.includes('..') ||
      normalizedConversationId.includes('/') ||
      normalizedConversationId.includes('\\') ||
      normalizedConversationId.includes(path.sep)
    ) {
      return null
    }
    if (!DRAFT_CONVERSATION_ID_PATTERN.test(normalizedConversationId)) {
      return null
    }
    return normalizedConversationId
  }

  private validateDraftId(draftId: string | undefined): string | null {
    const normalizedDraftId = draftId?.trim()
    if (!normalizedDraftId) {
      return null
    }
    if (path.isAbsolute(normalizedDraftId)) {
      return null
    }
    if (normalizedDraftId !== path.basename(normalizedDraftId)) {
      return null
    }
    if (
      normalizedDraftId.includes('..') ||
      normalizedDraftId.includes('/') ||
      normalizedDraftId.includes('\\') ||
      normalizedDraftId.includes(path.sep)
    ) {
      return null
    }
    if (!DRAFT_ID_PATTERN.test(normalizedDraftId)) {
      return null
    }
    return normalizedDraftId
  }

  private createDraftHandle(conversationId: string): { draftId: string; draftPath: string } {
    const safeConversationId = this.validateDraftConversationId(conversationId)
    if (!safeConversationId) {
      throw new Error('Invalid conversationId for draft access')
    }
    this.ensureDraftRoot()
    const conversationRoot = path.join(this.draftsRoot, safeConversationId)
    fs.mkdirSync(conversationRoot, { recursive: true })
    const draftId = `draft-${randomUUID()}`
    const draftPath = path.join(conversationRoot, draftId)
    fs.mkdirSync(draftPath, { recursive: true })
    return { draftId, draftPath }
  }

  private getDraftPathForId(conversationId: string, draftId: string): string | null {
    const safeDraftId = this.validateDraftId(draftId)
    if (!safeDraftId) {
      return null
    }
    const safeConversationId = this.validateDraftConversationId(conversationId)
    if (!safeConversationId) {
      return null
    }
    const conversationRoot = path.resolve(this.draftsRoot, safeConversationId)
    const resolvedDraftPath = path.resolve(conversationRoot, safeDraftId)
    const relativePath = path.relative(conversationRoot, resolvedDraftPath)
    if (!relativePath || relativePath.startsWith('..') || path.isAbsolute(relativePath)) {
      return null
    }
    return resolvedDraftPath
  }

  private resolveDraftFilePath(draftPath: string, relativeFilePath: string): string | null {
    const normalizedFilePath = relativeFilePath.trim().replace(/\\/g, '/').replace(/^\/+/, '')
    const [topLevelDir] = normalizedFilePath.split('/')
    if (!topLevelDir || !DRAFT_ALLOWED_TOP_LEVEL_DIRS.has(topLevelDir)) {
      return null
    }

    const resolvedPath = path.resolve(draftPath, normalizedFilePath)
    const relativePath = path.relative(draftPath, resolvedPath)
    if (!relativePath || relativePath.startsWith('..') || path.isAbsolute(relativePath)) {
      return null
    }
    return resolvedPath
  }

  private getDraftActivityMarkerPath(draftPath: string): string {
    return path.join(draftPath, DRAFT_ACTIVITY_MARKER)
  }

  private touchDraftActivity(draftPath: string): void {
    fs.writeFileSync(this.getDraftActivityMarkerPath(draftPath), `${Date.now()}`, 'utf-8')
  }

  private getDraftLastActivityMs(draftPath: string): number {
    const markerPath = this.getDraftActivityMarkerPath(draftPath)
    if (fs.existsSync(markerPath)) {
      return fs.statSync(markerPath).mtimeMs
    }
    return fs.statSync(draftPath).mtimeMs
  }

  private async atomicWriteFile(
    targetPath: string,
    content: string,
    expectedContent?: Buffer
  ): Promise<void> {
    const tempPath = path.join(
      path.dirname(targetPath),
      `.${path.basename(targetPath)}.${process.pid}.${randomBytes(8).toString('hex')}.tmp`
    )
    let tempHandle: number | null = null
    let ownsTemp = false
    try {
      const originalMode = expectedContent ? fs.lstatSync(targetPath).mode & 0o7777 : undefined
      tempHandle = fs.openSync(
        tempPath,
        fs.constants.O_CREAT | fs.constants.O_EXCL | fs.constants.O_WRONLY,
        originalMode ?? 0o666
      )
      ownsTemp = true
      fs.writeFileSync(tempHandle, content, 'utf-8')
      fs.closeSync(tempHandle)
      tempHandle = null
      if (originalMode !== undefined && process.platform !== 'win32') {
        fs.chmodSync(tempPath, originalMode)
      }
      if (expectedContent) {
        const current = await this.readStableRegularFile(targetPath, expectedContent.byteLength)
        if (!current.equals(expectedContent)) {
          throw new Error(`Managed file changed during operation: ${targetPath}`)
        }
      }
      fs.renameSync(tempPath, targetPath)
      ownsTemp = false
    } finally {
      if (tempHandle !== null) {
        try {
          fs.closeSync(tempHandle)
        } catch {
          // Preserve the original write/close failure while still attempting cleanup.
        }
      }
      if (ownsTemp) fs.rmSync(tempPath, { force: true })
    }
  }

  private cleanupExpiredDrafts(): void {
    if (!fs.existsSync(this.draftsRoot)) {
      return
    }

    const now = Date.now()
    const conversationEntries = fs.readdirSync(this.draftsRoot, { withFileTypes: true })
    for (const conversationEntry of conversationEntries) {
      if (!conversationEntry.isDirectory()) {
        continue
      }

      const conversationDir = path.join(this.draftsRoot, conversationEntry.name)
      const draftEntries = fs.readdirSync(conversationDir, { withFileTypes: true })
      for (const draftEntry of draftEntries) {
        if (!draftEntry.isDirectory()) {
          continue
        }

        const draftDir = path.join(conversationDir, draftEntry.name)
        const lastActivityMs = this.getDraftLastActivityMs(draftDir)
        if (now - lastActivityMs > SKILL_CONFIG.DRAFT_RETENTION_MS) {
          fs.rmSync(draftDir, { recursive: true, force: true })
        }
      }

      if (fs.existsSync(conversationDir) && fs.readdirSync(conversationDir).length === 0) {
        fs.rmSync(conversationDir, { recursive: true, force: true })
      }
    }
  }

  private findSkillNameByPath(
    skillPath: string,
    agentId: string = BUILTIN_SKILL_AGENT_ID
  ): string | null {
    for (const metadata of this.getMetadataCacheForAgent(agentId).values()) {
      if (metadata.path === skillPath) {
        return metadata.name
      }
    }
    return null
  }

  private removeEmptyDraftConversationDir(conversationId: string): void {
    const safeConversationId = this.validateDraftConversationId(conversationId)
    if (!safeConversationId) {
      return
    }

    const conversationDir = path.join(this.draftsRoot, safeConversationId)
    if (fs.existsSync(conversationDir) && fs.readdirSync(conversationDir).length === 0) {
      fs.rmSync(conversationDir, { recursive: true, force: true })
    }
  }

  private getPersistedNewSessionSkills(conversationId: string): string[] {
    try {
      return this.sessionStatePort.getPersistedNewSessionSkills(conversationId)
    } catch (error) {
      console.warn(
        `[SkillService] Failed to read persisted active skills for ${conversationId}:`,
        error
      )
      return []
    }
  }

  private setPersistedNewSessionSkills(conversationId: string, skills: string[]): void {
    this.sessionStatePort.setPersistedNewSessionSkills(conversationId, skills)
  }
}
