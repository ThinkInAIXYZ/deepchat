import { app, shell } from 'electron'
import path from 'path'
import fs from 'fs'
import { execFile } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { promisify } from 'node:util'
import matter from 'gray-matter'
import { unzipSync } from 'fflate'
import type { SkillSettingsPort } from './settings'
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
  SkillCatalogPublicationMode,
  SkillFolderNode,
  SkillInstallOptions,
  SkillImportProvenance,
  GitSkillInstallInput,
  GitSkillRepoScanItem,
  GitSkillRepoScanResult,
  SkillAdoptionRegistration,
  SkillAgentLinkRegistration,
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
  SkillLinkedFile
} from '@shared/types/skill'
import type {
  AgentSkillManagementState,
  SkillManagementItem,
  SkillManagementState,
  SkillSyncDirectoryConfig,
  SkillSource,
  SkillSourceType,
  UnifiedSkillItem
} from '@shared/types/skillManagement'
import type { DeepchatEventPublisher } from '@shared/contracts/events'
import logger from '@shared/logger'
import { normalizeSkillAllowedTools } from './toolNameMapping'
import { discoverSkillMetadataInWorker, logSkillDiscoveryWorkerWarnings } from './discoveryWorker'
import {
  BUILTIN_SKILL_AGENT_ID,
  assertSafeSkillAgentId,
  resolveAgentSkillsRoot,
  resolveScopedAgentIdFromPath
} from './agentSkillRoots'

const execFileAsync = promisify(execFile)

/**
 * Skill system configuration constants
 */
export const SKILL_CONFIG = {
  /** Maximum size for SKILL.md file (bytes) - prevents memory exhaustion */
  SKILL_FILE_MAX_SIZE: 5 * 1024 * 1024, // 5MB

  /** Maximum size for ZIP file (bytes) - prevents ZIP bomb attacks */
  ZIP_MAX_SIZE: 200 * 1024 * 1024, // 200MB

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
const BUILTIN_SKILL_ROOT_EXCLUDED_DIRS = new Set(['.agent-scopes'])
const AGENT_SKILL_MIGRATION_MARKER = '.deepchat-skill-migration.json'
const AGENT_SKILL_MIGRATION_STAGING_PREFIX = '.migration-'
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

interface ScopedSkillCatalog {
  metadataCache: Map<string, SkillMetadata>
  contentCache: Map<string, SkillContent>
  discoveryPromise: Promise<SkillMetadata[]> | null
  discovered: boolean
}

interface SkillDirectoryInstallContext {
  options?: SkillInstallOptions
  sourceType?: SkillSourceType
  sourcePatch?: Partial<SkillSource>
  targetName?: string
  agentId?: string
  publishCatalogEvent?: boolean
}

function createDefaultSkillExtensionConfig(): SkillExtensionConfig {
  return {
    version: 1,
    env: {},
    runtimePolicy: { ...DEFAULT_RUNTIME_POLICY },
    scriptOverrides: {}
  }
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
  private contentCache: Map<string, SkillContent> = new Map()
  private scopedCatalogs: Map<string, ScopedSkillCatalog> = new Map()
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

  private ensureAgentSkillsRoot(agentId: string): string {
    const root = this.getAgentSkillsRoot(agentId)
    if (agentId === BUILTIN_SKILL_AGENT_ID) {
      fs.mkdirSync(root, { recursive: true })
      return root
    }

    const scopesRoot = path.dirname(root)
    fs.mkdirSync(scopesRoot, { recursive: true })
    this.getAgentSkillsRoot(agentId)
    fs.mkdirSync(root, { recursive: true })
    return this.getAgentSkillsRoot(agentId)
  }

  private ensureAgentSkillScopesRoot(agentId: string): { root: string; scopesRoot: string } {
    const root = this.getAgentSkillsRoot(agentId)
    const scopesRoot = path.dirname(root)
    fs.mkdirSync(scopesRoot, { recursive: true })
    return { root: this.getAgentSkillsRoot(agentId), scopesRoot }
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
      throw new Error(`DeepChat Agent Skill scope is being deleted: ${agentId}`)
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

  private getScopedCatalog(agentId: string): ScopedSkillCatalog {
    const normalizedAgentId = assertSafeSkillAgentId(agentId)
    let catalog = this.scopedCatalogs.get(normalizedAgentId)
    if (!catalog) {
      catalog = {
        metadataCache: new Map(),
        contentCache: new Map(),
        discoveryPromise: null,
        discovered: false
      }
      this.scopedCatalogs.set(normalizedAgentId, catalog)
    }
    return catalog
  }

  private getMetadataCacheForAgent(agentId: string): Map<string, SkillMetadata> {
    return agentId === BUILTIN_SKILL_AGENT_ID
      ? this.metadataCache
      : this.getScopedCatalog(agentId).metadataCache
  }

  private getContentCacheForAgent(agentId: string): Map<string, SkillContent> {
    return agentId === BUILTIN_SKILL_AGENT_ID
      ? this.contentCache
      : this.getScopedCatalog(agentId).contentCache
  }

  private async ensureAgentCatalogDiscovered(agentId: string): Promise<void> {
    if (agentId === BUILTIN_SKILL_AGENT_ID) {
      if (this.builtinCatalogDiscovered || this.metadataCache.size > 0) return
      if (!this.discoveryPromise) {
        this.discoveryPromise = this.discoverSkills(agentId).finally(() => {
          this.discoveryPromise = null
        })
      }
      await this.discoveryPromise
      return
    }

    const catalog = this.getScopedCatalog(agentId)
    if (catalog.discovered) return
    if (!catalog.discoveryPromise) {
      catalog.discoveryPromise = this.discoverSkills(agentId).finally(() => {
        catalog.discoveryPromise = null
      })
    }
    await catalog.discoveryPromise
  }

  private withSkillCategoryForRoot(metadata: SkillMetadata, catalogRoot: string): SkillMetadata {
    return {
      ...metadata,
      category: this.deriveSkillCategory(metadata.skillRoot, catalogRoot)
    }
  }

  /**
   * Get the skills directory path
   */
  async getSkillsDir(agentId: string = BUILTIN_SKILL_AGENT_ID): Promise<string> {
    const normalizedAgentId = await this.requireAgentScope(agentId)
    return this.getAgentSkillsRoot(normalizedAgentId)
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
        await this.migrateLegacyAgentSkillScopes()
      } catch (error) {
        logger.warn('[SkillService] Agent Skill migration failed; continuing startup.', { error })
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
      return await this.discoverScopedSkills(normalizedAgentId)
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

    const skills = this.getVisibleMetadataFromCache(BUILTIN_SKILL_AGENT_ID)
    this.builtinCatalogDiscovered = true
    this.publishEvent('skills.catalog.changed', {
      reason: 'discovered',
      agentIds: [BUILTIN_SKILL_AGENT_ID],
      skills,
      version: Date.now()
    })

    return skills
  }

  private async migrateLegacyAgentSkillScopes(): Promise<void> {
    if (!this.agentScopePort) return

    let state = this.getStoredManagementState()
    if (state.migration?.completedAt) return

    const agents = await this.agentScopePort.listDeepChatAgents()
    const agentsById = new Map(agents.map((agent) => [agent.id, agent]))
    const targetAgentIds = state.migration?.targetAgentIds
      ? [...state.migration.targetAgentIds]
      : agents
          .filter((agent) => agent.id !== BUILTIN_SKILL_AGENT_ID)
          .map((agent) => assertSafeSkillAgentId(agent.id))
          .sort()
    const completed = new Set(state.migration?.completedAgentIds ?? [])
    if (!state.migration?.targetAgentIds) {
      state.migration = {
        ...state.migration,
        targetAgentIds,
        completedAgentIds: Array.from(completed).sort()
      }
      this.saveManagementState(state)
    }

    const builtinCatalog = await this.getUnifiedSkillCatalog(BUILTIN_SKILL_AGENT_ID)
    // Sidecars predate management state. Absorb them before default items can mask their config.
    for (const skill of builtinCatalog) {
      if (!state.agents[BUILTIN_SKILL_AGENT_ID]?.skills[skill.name]) {
        try {
          await this.migrateLegacySkillExtension(skill.name, true)
        } catch (error) {
          logger.warn('[SkillService] Failed to migrate a legacy Skill sidecar; continuing.', {
            skillName: skill.name,
            error
          })
        }
      }
    }
    state = this.getStoredManagementState()
    this.materializeLegacySkillAllowList(
      state,
      BUILTIN_SKILL_AGENT_ID,
      builtinCatalog,
      agentsById.get(BUILTIN_SKILL_AGENT_ID)?.enabledSkillNames
    )
    this.saveManagementState(state)
    const builtinByName = new Map(
      builtinCatalog.filter((skill) => !skill.ownerPluginId).map((skill) => [skill.name, skill])
    )

    for (const agentId of targetAgentIds) {
      if (completed.has(agentId)) continue
      const agent = agentsById.get(agentId)
      const agentStillExists = await this.agentScopePort.isDeepChatAgent(agentId)
      if (agent && agentStillExists && !this.deletedAgentScopes.has(agentId)) {
        const legacyEnabledSkillNames =
          state.migration?.legacySkillAllowLists?.[agentId] ?? agent.enabledSkillNames
        const selected = Array.isArray(legacyEnabledSkillNames)
          ? legacyEnabledSkillNames
          : builtinCatalog
              .filter((skill) => !skill.disabled && !skill.ownerPluginId)
              .map((skill) => skill.name)
        await this.migrateLegacyAgentSkillScope(
          agentId,
          selected,
          legacyEnabledSkillNames,
          builtinCatalog,
          builtinByName,
          state
        )
      }
      completed.add(agentId)
      state.migration = {
        ...state.migration,
        targetAgentIds,
        completedAgentIds: Array.from(completed).sort()
      }
      this.saveManagementState(state)
    }

    for (const session of await this.agentScopePort.listSessions()) {
      if (!(await this.agentScopePort.isDeepChatAgent(session.agentId))) continue
      const persisted = this.getPersistedNewSessionSkills(session.id)
      const valid = await this.validateSkillNames(session.agentId, persisted)
      if (!this.areSkillListsEqual(persisted, valid))
        this.setPersistedNewSessionSkills(session.id, valid)
    }
    state.migration = {
      ...state.migration,
      targetAgentIds,
      completedAgentIds: Array.from(completed).sort(),
      completedAt: new Date().toISOString()
    }
    this.saveManagementState(state)
  }

  private async migrateLegacyAgentSkillScope(
    agentId: string,
    selectedNames: string[],
    enabledSkillNames: string[] | null | undefined,
    builtinCatalog: UnifiedSkillItem[],
    builtinByName: ReadonlyMap<string, UnifiedSkillItem>,
    state: SkillManagementState
  ): Promise<void> {
    const normalizedAgentId = assertSafeSkillAgentId(agentId)
    const { root, scopesRoot } = this.ensureAgentSkillScopesRoot(normalizedAgentId)
    const selected = Array.from(new Set(selectedNames)).filter(
      (name) => this.isSafeSkillName(name) && builtinByName.has(name)
    )

    const rootExists = fs.existsSync(root)
    const committedMigrationRoot = this.isCommittedAgentSkillMigrationRoot(
      root,
      normalizedAgentId,
      selected
    )
    const preexistingIndependentRoot = rootExists && !committedMigrationRoot

    if (!rootExists) {
      const stagingRoot = path.join(
        scopesRoot,
        `${AGENT_SKILL_MIGRATION_STAGING_PREFIX}${normalizedAgentId}`
      )
      this.removeMigrationStagingRoot(stagingRoot)
      fs.mkdirSync(stagingRoot, { recursive: true })
      try {
        for (const name of selected) {
          const source = builtinByName.get(name)
          if (!source) continue
          this.copyDirectory(source.skillRoot, path.join(stagingRoot, name))
          const summary = this.readSkillManifestSummary(path.join(stagingRoot, name))
          if (!summary.valid || summary.name !== name) {
            throw new Error(`Migrated Skill failed validation: ${name}`)
          }
        }
        fs.writeFileSync(
          path.join(stagingRoot, AGENT_SKILL_MIGRATION_MARKER),
          JSON.stringify({ agentId: normalizedAgentId, skillNames: selected }),
          'utf-8'
        )
        fs.renameSync(stagingRoot, root)
      } catch (error) {
        this.removeMigrationStagingRoot(stagingRoot)
        throw error
      }
    }

    const agentState = this.getAgentManagementState(state, normalizedAgentId)
    if (!preexistingIndependentRoot) agentState.skills = {}
    agentState.migratedAt = new Date().toISOString()
    // A runtime read may have discovered the missing scope while startup migration was pending.
    // Drop that snapshot after commit so the private copy becomes authoritative immediately.
    this.scopedCatalogs.delete(normalizedAgentId)
    const migratedCatalog = preexistingIndependentRoot
      ? await this.discoverScopedSkills(normalizedAgentId)
      : [
          ...selected
            .map((name) => builtinByName.get(name))
            .filter((skill): skill is UnifiedSkillItem => Boolean(skill))
            .map((skill) => ({ ...skill, skillRoot: path.join(root, skill.name) })),
          ...builtinCatalog.filter((skill) => Boolean(skill.ownerPluginId))
        ]
    this.materializeLegacySkillAllowList(
      state,
      normalizedAgentId,
      migratedCatalog,
      enabledSkillNames
    )
  }

  private materializeLegacySkillAllowList(
    state: SkillManagementState,
    agentId: string,
    catalog: Array<SkillMetadata & { disabled?: boolean }>,
    enabledSkillNames: string[] | null | undefined
  ): void {
    const agentState = this.getAgentManagementState(state, agentId)
    const allowed = Array.isArray(enabledSkillNames) ? new Set(enabledSkillNames) : null
    for (const skill of catalog) {
      const existing = agentState.skills[skill.name]
      const builtinTemplate =
        agentId === BUILTIN_SKILL_AGENT_ID
          ? undefined
          : state.agents[BUILTIN_SKILL_AGENT_ID]?.skills[skill.name]
      agentState.skills[skill.name] = {
        ...(existing ??
          (builtinTemplate
            ? {
                ...builtinTemplate,
                extension: sanitizeSkillExtensionConfig(builtinTemplate.extension),
                source: { ...builtinTemplate.source },
                agentLinks: undefined
              }
            : this.createDefaultManagementItem(skill.name, agentId))),
        name: skill.name,
        canonicalPath: skill.skillRoot,
        disabled:
          existing?.disabled === true ||
          skill.disabled === true ||
          Boolean(allowed && !allowed.has(skill.name))
      }
    }
  }

  private isCommittedAgentSkillMigrationRoot(
    root: string,
    agentId: string,
    selectedNames: string[]
  ): boolean {
    if (!fs.existsSync(root)) return false
    const markerPath = path.join(root, AGENT_SKILL_MIGRATION_MARKER)
    if (!fs.existsSync(markerPath)) return false
    try {
      const marker = JSON.parse(fs.readFileSync(markerPath, 'utf-8')) as {
        agentId?: unknown
        skillNames?: unknown
      }
      if (
        marker.agentId !== agentId ||
        !Array.isArray(marker.skillNames) ||
        !marker.skillNames.every((name): name is string => typeof name === 'string') ||
        !this.areSkillListsEqual(marker.skillNames, selectedNames)
      ) {
        return false
      }
      return selectedNames.every((name) => {
        const summary = this.readSkillManifestSummary(path.join(root, name))
        return summary.valid && summary.name === name
      })
    } catch {
      return false
    }
  }

  private removeMigrationStagingRoot(stagingRoot: string): void {
    if (!fs.existsSync(stagingRoot)) return
    const stats = fs.lstatSync(stagingRoot)
    if (stats.isSymbolicLink()) {
      throw new Error(`Agent Skill migration staging path is a symbolic link: ${stagingRoot}`)
    }
    fs.rmSync(stagingRoot, { recursive: true, force: true })
  }

  async refreshAgentCatalog(agentId: string): Promise<SkillMetadata[]> {
    const normalizedAgentId = await this.requireAgentScope(agentId)
    if (normalizedAgentId === BUILTIN_SKILL_AGENT_ID) {
      this.metadataCache.clear()
      this.contentCache.clear()
      this.discoveryPromise = null
      this.builtinCatalogDiscovered = false
      return await this.discoverSkills(normalizedAgentId)
    }
    const catalog = this.getScopedCatalog(normalizedAgentId)
    catalog.metadataCache.clear()
    catalog.contentCache.clear()
    catalog.discoveryPromise = null
    catalog.discovered = false
    return await this.discoverSkills(normalizedAgentId)
  }

  private async discoverScopedSkills(agentId: string): Promise<SkillMetadata[]> {
    const root = this.getAgentSkillsRoot(agentId)
    const catalog = this.getScopedCatalog(agentId)
    const finishOperation = this.beginAgentScopeOperation(agentId)
    try {
      const discoveredByName = new Map<string, SkillMetadata>()
      let discoveredSkills: SkillMetadata[] = []
      if (fs.existsSync(root)) {
        try {
          const workerResult = await discoverSkillMetadataInWorker({
            skillsDir: root,
            sidecarDirName: SKILL_CONFIG.SIDECAR_DIR,
            maxDepth: SKILL_CONFIG.FOLDER_TREE_MAX_DEPTH
          })
          logSkillDiscoveryWorkerWarnings(workerResult.warnings)
          discoveredSkills = workerResult.skills.map((metadata) =>
            this.withSkillCategoryForRoot(metadata, root)
          )
        } catch (error) {
          console.warn(
            `[SkillService] Worker discovery failed for Agent ${agentId}, falling back to main thread:`,
            error
          )
          discoveredSkills = await this.discoverSkillsOnMainThread(root)
        }
      }

      for (const metadata of [
        ...discoveredSkills,
        ...(await this.discoverPluginSkillsOnMainThread())
      ]) {
        if (!discoveredByName.has(metadata.name)) {
          discoveredByName.set(metadata.name, metadata)
        }
      }

      this.assertAgentScopeActive(agentId)
      catalog.metadataCache.clear()
      catalog.contentCache.clear()
      for (const [name, metadata] of discoveredByName) {
        catalog.metadataCache.set(name, metadata)
      }
      const skills = this.getVisibleMetadataFromCache(agentId)
      catalog.discovered = true
      this.publishEvent('skills.catalog.changed', {
        reason: 'discovered',
        agentIds: [agentId],
        skills,
        version: Date.now()
      })
      return skills
    } finally {
      finishOperation()
    }
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
    return Boolean(metadata) && !this.isSkillDisabled(agentId, metadata.name)
  }

  private createDefaultManagementState(): SkillManagementState {
    return {
      version: 2,
      agents: {
        [BUILTIN_SKILL_AGENT_ID]: { skills: {} }
      }
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
    if (!stored || typeof stored !== 'object') {
      return this.createDefaultManagementState()
    }

    const raw = stored as unknown as Record<string, unknown>
    const agents: Record<string, AgentSkillManagementState> = {}
    if (raw.version === 2 && raw.agents && typeof raw.agents === 'object') {
      for (const [agentId, value] of Object.entries(raw.agents as Record<string, unknown>)) {
        try {
          const normalizedAgentId = assertSafeSkillAgentId(agentId)
          agents[normalizedAgentId] = this.sanitizeAgentManagementState(normalizedAgentId, value)
        } catch {
          // Ignore unsafe legacy keys.
        }
      }
    } else {
      agents[BUILTIN_SKILL_AGENT_ID] = this.sanitizeAgentManagementState(BUILTIN_SKILL_AGENT_ID, {
        skills: raw.skills
      })
    }

    if (!agents[BUILTIN_SKILL_AGENT_ID]) {
      agents[BUILTIN_SKILL_AGENT_ID] = { skills: {} }
    }

    const rawMigration =
      raw.migration && typeof raw.migration === 'object'
        ? (raw.migration as Record<string, unknown>)
        : null
    const state: SkillManagementState = {
      version: 2,
      agents,
      sync: this.sanitizeSyncDirectoryConfig(raw.sync),
      migration: rawMigration
        ? {
            completedAgentIds: Array.isArray(rawMigration.completedAgentIds)
              ? rawMigration.completedAgentIds.filter(
                  (agentId): agentId is string => typeof agentId === 'string'
                )
              : [],
            targetAgentIds: Array.isArray(rawMigration.targetAgentIds)
              ? rawMigration.targetAgentIds.filter((agentId): agentId is string => {
                  if (typeof agentId !== 'string') return false
                  try {
                    assertSafeSkillAgentId(agentId)
                    return true
                  } catch {
                    return false
                  }
                })
              : undefined,
            legacySkillAllowLists:
              rawMigration.legacySkillAllowLists &&
              typeof rawMigration.legacySkillAllowLists === 'object'
                ? Object.fromEntries(
                    Object.entries(
                      rawMigration.legacySkillAllowLists as Record<string, unknown>
                    ).flatMap(([agentId, value]) => {
                      try {
                        const normalizedAgentId = assertSafeSkillAgentId(agentId)
                        if (!Array.isArray(value)) return []
                        const names = value.filter(
                          (name): name is string =>
                            typeof name === 'string' && this.isSafeSkillName(name)
                        )
                        return [[normalizedAgentId, Array.from(new Set(names))]]
                      } catch {
                        return []
                      }
                    })
                  )
                : undefined,
            completedAt:
              typeof rawMigration.completedAt === 'string' ? rawMigration.completedAt : undefined
          }
        : undefined
    }

    if (raw.version !== 2) {
      this.saveManagementState(state)
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

  private createDefaultManagementItem(
    name: string,
    agentId: string = BUILTIN_SKILL_AGENT_ID
  ): SkillManagementItem {
    return {
      name,
      canonicalPath: path.join(this.getAgentSkillsRoot(agentId), name),
      disabled: false,
      extension: createDefaultSkillExtensionConfig(),
      source: {
        type: 'created'
      }
    }
  }

  private updateSkillManagementItem(
    name: string,
    updater: (item: SkillManagementItem) => SkillManagementItem,
    agentId: string = BUILTIN_SKILL_AGENT_ID
  ): SkillManagementItem {
    const state = this.getStoredManagementState()
    const agentState = this.getAgentManagementState(state, agentId)
    const nextItem = updater(
      agentState.skills[name] ?? this.createDefaultManagementItem(name, agentId)
    )
    agentState.skills[name] = nextItem
    this.saveManagementState(state)
    return nextItem
  }

  private getAgentManagementState(
    state: SkillManagementState,
    agentId: string
  ): AgentSkillManagementState {
    const normalizedAgentId = assertSafeSkillAgentId(agentId)
    state.agents[normalizedAgentId] ??= { skills: {} }
    return state.agents[normalizedAgentId]
  }

  private isSkillDisabled(agentId: string, name: string): boolean {
    return this.getStoredManagementState().agents[agentId]?.skills[name]?.disabled === true
  }

  async getSkillManagementState(): Promise<SkillManagementState> {
    return this.getStoredManagementState()
  }

  async setSkillDeepChatDisabled(name: string, disabled: boolean): Promise<void> {
    await this.setSkillDisabledForAgent(BUILTIN_SKILL_AGENT_ID, name, disabled)
  }

  async setSkillDisabledForAgent(agentId: string, name: string, disabled: boolean): Promise<void> {
    const normalizedAgentId = await this.requireAgentScope(agentId)
    const finishOperation = this.beginAgentScopeOperation(normalizedAgentId)
    try {
      const metadataCache = this.getMetadataCacheForAgent(normalizedAgentId)
      await this.ensureAgentCatalogDiscovered(normalizedAgentId)
      this.assertAgentScopeActive(normalizedAgentId)
      if (!metadataCache.has(name)) {
        throw new Error(`Skill "${name}" not found`)
      }

      this.updateSkillManagementItem(
        name,
        (item) => ({
          ...item,
          canonicalPath: metadataCache.get(name)?.skillRoot ?? item.canonicalPath,
          disabled
        }),
        normalizedAgentId
      )
      this.getContentCacheForAgent(normalizedAgentId).delete(name)
      this.publishEvent('skills.catalog.changed', {
        reason: 'disabled-updated',
        name,
        disabled,
        agentIds: [normalizedAgentId],
        version: Date.now()
      })
    } finally {
      finishOperation()
    }
  }

  async getUnifiedSkillCatalog(
    agentId: string = BUILTIN_SKILL_AGENT_ID
  ): Promise<UnifiedSkillItem[]> {
    const normalizedAgentId = await this.requireAgentScope(agentId)
    const metadataCache = this.getMetadataCacheForAgent(normalizedAgentId)
    await this.ensureAgentCatalogDiscovered(normalizedAgentId)

    const state = this.getStoredManagementState()
    const agentState = this.getAgentManagementState(state, normalizedAgentId)
    return this.sortSkillMetadata(Array.from(metadataCache.values())).map((skill) => {
      const item =
        agentState.skills[skill.name] ??
        this.createDefaultManagementItem(skill.name, normalizedAgentId)
      return {
        ...skill,
        agentId: normalizedAgentId,
        canonicalPath: item.canonicalPath || skill.skillRoot,
        sourceType: item.source.type,
        disabled: item.disabled,
        deepchatDisabled: item.disabled,
        agentLinks: item.agentLinks ?? {},
        mutable: !skill.ownerPluginId
      }
    })
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
   * Get metadata prompt for skill listing (used by skill_list tool)
   */
  async getMetadataPrompt(): Promise<string> {
    const skills = await this.getMetadataList()
    const header = '# Available Skills'
    const dirLine = `Skills directory: \`${this.skillsDir}\``

    if (skills.length === 0) {
      return `${header}\n\n${dirLine}\nNo skills are currently installed.`
    }

    const lines = skills.map((skill) => {
      const details: string[] = []
      if (skill.category) {
        details.push(`category=${skill.category}`)
      }
      if (skill.platforms?.length) {
        details.push(`platforms=${skill.platforms.join(',')}`)
      }
      const suffix = details.length > 0 ? ` (${details.join('; ')})` : ''
      return `- ${skill.name}: ${skill.description}${suffix}`
    })
    return [
      header,
      '',
      dirLine,
      'Inspect these skills with `skill_view` before relying on them.',
      ...lines
    ].join('\n')
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
    if (!metadata || !this.isSkillVisible(metadata, agentId)) {
      console.warn(`[SkillService] Skill not found: ${name}`)
      return null
    }

    // Check content cache after feature visibility so disabled managed skills stay hidden.
    if (contentCache.has(name)) {
      return contentCache.get(name)!
    }

    try {
      const confinedSkillPath = await this.resolvePhysicalSkillPath(
        metadata.skillRoot,
        metadata.path
      )
      if (!confinedSkillPath) {
        logger.warn('[SkillService] Refusing to load a Skill manifest outside its physical root.', {
          agentId,
          name,
          skillPath: metadata.path
        })
        return null
      }
      // Check file size before reading to prevent memory exhaustion
      const stats = await fs.promises.stat(confinedSkillPath)
      if (stats.size > SKILL_CONFIG.SKILL_FILE_MAX_SIZE) {
        console.error(
          `[SkillService] Skill file too large: ${stats.size} bytes (max: ${SKILL_CONFIG.SKILL_FILE_MAX_SIZE})`
        )
        return null
      }

      const rawContent = await fs.promises.readFile(confinedSkillPath, 'utf-8')
      const { content } = matter(rawContent)
      const renderedContent = this.replacePathVariables(content, metadata, agentId)
      const runtimeInstructions = await this.buildRuntimeInstructions(metadata, agentId)

      const skillContent: SkillContent = {
        name,
        content: [renderedContent.trim(), runtimeInstructions].filter(Boolean).join('\n\n')
      }

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

  async viewSkillForAgent(
    agentId: string,
    name: string,
    options?: { filePath?: string; conversationId?: string }
  ): Promise<SkillViewResult> {
    const normalizedAgentId = await this.requireAgentScope(agentId)
    return await this.viewSkillInAgentScope(normalizedAgentId, name, options)
  }

  async viewSkill(
    name: string,
    options?: { filePath?: string; conversationId?: string }
  ): Promise<SkillViewResult> {
    return await this.viewSkillInAgentScope(BUILTIN_SKILL_AGENT_ID, name, options)
  }

  private async viewSkillInAgentScope(
    agentId: string,
    name: string,
    options?: { filePath?: string; conversationId?: string }
  ): Promise<SkillViewResult> {
    const metadataCache = this.getMetadataCacheForAgent(agentId)
    await this.ensureAgentCatalogDiscovered(agentId)

    const metadata = metadataCache.get(name)
    if (!metadata || !this.isSkillVisible(metadata, agentId)) {
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
      const confinedSkillPath = await this.resolvePhysicalSkillPath(
        metadata.skillRoot,
        metadata.path
      )
      if (!confinedSkillPath) {
        return {
          success: false,
          error: 'Skill manifest is outside the physical skill root'
        }
      }
      const stats = await fs.promises.stat(confinedSkillPath)
      if (stats.size > SKILL_CONFIG.SKILL_FILE_MAX_SIZE) {
        const errorMessage = `[SkillService] Skill file too large: ${stats.size} bytes (max: ${SKILL_CONFIG.SKILL_FILE_MAX_SIZE})`
        console.error(errorMessage)
        return {
          success: false,
          error: errorMessage
        }
      }

      const rawContent = await fs.promises.readFile(confinedSkillPath, 'utf-8')
      const { content } = matter(rawContent)
      return {
        success: true,
        name: metadata.name,
        category: metadata.category ?? null,
        skillRoot: metadata.skillRoot,
        filePath: null,
        content: this.replacePathVariables(content, metadata, agentId),
        platforms: metadata.platforms,
        metadata: metadata.metadata,
        linkedFiles: await this.listSkillLinkedFiles(metadata.skillRoot),
        isPinned
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
        error: `Failed to load skill view: ${errorMessage}`
      }
    }
  }

  async manageDraftSkill(
    conversationId: string,
    request: SkillManageRequest
  ): Promise<SkillManageResult> {
    const action = request.action

    try {
      switch (action) {
        case 'create': {
          const parsed = this.validateDraftSkillDocument(request.content)
          if (!parsed.success) {
            return { success: false, action, error: parsed.error }
          }
          const { draftId, draftPath } = this.createDraftHandle(conversationId)
          this.atomicWriteFile(path.join(draftPath, 'SKILL.md'), request.content!)
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
          this.atomicWriteFile(path.join(draftPath, 'SKILL.md'), request.content!)
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
          fs.mkdirSync(path.dirname(resolvedFilePath), { recursive: true })
          this.atomicWriteFile(resolvedFilePath, request.fileContent)
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
          fs.rmSync(draftPath, { recursive: true, force: true })
          return { success: true, action, draftId }
        }
        default:
          return { success: false, action, error: `Unsupported draft action: ${action}` }
      }
    } catch (error) {
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
    const agentSkillsRoot = this.getAgentSkillsRoot(agentId)
    return content
      .replace(/\$\{SKILL_ROOT\}/g, metadata.skillRoot)
      .replace(/\$\{SKILLS_DIR\}/g, agentSkillsRoot)
      .replace(/\$\{PLUGIN_ROOT\}/g, pluginContribution?.pluginRoot ?? '')
      .replace(/\$\{PROCESS_ARCH\}/g, process.arch)
      .replace(
        /\$\{OWNER_PLUGIN_ID\}/g,
        metadata.ownerPluginId ?? pluginContribution?.ownerPluginId ?? ''
      )
  }

  private async buildRuntimeInstructions(
    metadata: SkillMetadata,
    agentId: string = BUILTIN_SKILL_AGENT_ID
  ): Promise<string> {
    const scripts = (await this.listSkillScriptsForAgent(agentId, metadata.name)).filter(
      (script) => script.enabled
    )
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
      return
    }

    const entries = fs.readdirSync(builtinDir, { withFileTypes: true })
    for (const entry of entries) {
      if (!entry.isDirectory()) continue
      const skillDir = path.join(builtinDir, entry.name)
      const skillMdPath = path.join(skillDir, 'SKILL.md')
      if (!fs.existsSync(skillMdPath)) continue

      const metadata = await this.parseSkillMetadata(skillMdPath, entry.name)
      if (!metadata || !this.supportsCurrentPlatform(metadata.platforms)) {
        continue
      }

      const result = await this.installFromDirectory(skillDir, {
        options: { overwrite: false },
        sourceType: 'builtin'
      })
      if (!result.success && result.error?.includes('already exists')) {
        continue
      }
      if (!result.success) {
        console.warn('[SkillService] Failed to install builtin skill:', result.error)
      }
    }
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
    return await this.installFromFolderForAgent(BUILTIN_SKILL_AGENT_ID, folderPath, options)
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

  async installImportedSkillForAgent(
    agentId: string,
    folderPath: string,
    provenance: SkillImportProvenance,
    options?: SkillInstallOptions,
    catalogPublication: SkillCatalogPublicationMode = 'immediate'
  ): Promise<SkillInstallResult> {
    const normalizedAgentId = await this.requireAgentScope(agentId)
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
      agentId: normalizedAgentId,
      publishCatalogEvent: catalogPublication === 'immediate'
    })
  }

  /**
   * Install a skill from a zip file
   */
  async installFromZip(
    zipPath: string,
    options?: SkillInstallOptions
  ): Promise<SkillInstallResult> {
    return await this.installFromZipForAgent(BUILTIN_SKILL_AGENT_ID, zipPath, options)
  }

  async installFromZipForAgent(
    agentId: string,
    zipPath: string,
    options?: SkillInstallOptions
  ): Promise<SkillInstallResult> {
    const normalizedAgentId = await this.requireAgentScope(agentId)
    if (!fs.existsSync(zipPath)) {
      return { success: false, error: 'Zip file not found', errorCode: 'not_found' }
    }

    const tempDir = fs.mkdtempSync(path.join(app.getPath('temp'), 'deepchat-skill-'))
    try {
      this.extractZipToDirectory(zipPath, tempDir)
      const skillDir = this.resolveSkillDirFromExtracted(tempDir)
      if (!skillDir) {
        return { success: false, error: 'SKILL.md not found in zip archive' }
      }
      return await this.installFromDirectory(skillDir, {
        options,
        sourceType: 'zip-install',
        agentId: normalizedAgentId
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
    return await this.installFromUrlForAgent(BUILTIN_SKILL_AGENT_ID, url, options)
  }

  async installFromUrlForAgent(
    agentId: string,
    url: string,
    options?: SkillInstallOptions
  ): Promise<SkillInstallResult> {
    const normalizedAgentId = await this.requireAgentScope(agentId)
    const finishOperation = this.beginAgentScopeOperation(normalizedAgentId)
    const tempZipPath = path.join(app.getPath('temp'), `deepchat-skill-${Date.now()}.zip`)
    try {
      await this.downloadSkillZip(url, tempZipPath)
      const result = await this.installFromZipForAgent(normalizedAgentId, tempZipPath, options)
      if (result.success && result.skillName) {
        this.updateSkillManagementItem(
          result.skillName,
          (item) => ({
            ...item,
            source: {
              type: 'url-install',
              installedAt: new Date().toISOString()
            }
          }),
          normalizedAgentId
        )
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
    return await this.installSkillsFromGitForAgent(BUILTIN_SKILL_AGENT_ID, input)
  }

  async installSkillsFromGitForAgent(
    agentId: string,
    input: GitSkillInstallInput
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
      const targetSkillsRoot = this.getAgentSkillsRoot(normalizedAgentId)

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

        const targetConflict = fs.existsSync(path.join(targetSkillsRoot, item.name))
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
            ? this.createUniqueSkillName(item.name, normalizedAgentId)
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
          publishCatalogEvent: false
        })
        results.push({ ...result, sourceSkillName: item.name })
      }

      if (results.some((result) => result.success)) {
        this.publishEvent('skills.catalog.changed', {
          reason: 'git-installed',
          agentIds: [normalizedAgentId],
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
    const skills = (await this.getUnifiedSkillCatalog()).filter((skill) => {
      if (!selected.has(skill.name)) return false
      return input.includeDisabled === true || !skill.deepchatDisabled
    })

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
        agentIds: [BUILTIN_SKILL_AGENT_ID],
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
  }

  async registerAdoptedSkill(input: SkillAdoptionRegistration): Promise<void> {
    const skillRoot = path.resolve(input.canonicalPath)
    const metadata = await this.parseSkillMetadata(path.join(skillRoot, 'SKILL.md'), input.name)
    if (!metadata || metadata.name !== input.name) {
      throw new Error(`Adopted skill "${input.name}" is invalid`)
    }

    this.metadataCache.set(input.name, metadata)
    this.contentCache.delete(input.name)
    this.updateSkillManagementItem(input.name, (item) => ({
      ...item,
      canonicalPath: skillRoot,
      source: {
        type: 'adopted',
        agentId: input.agentId,
        originalPath: input.originalPath,
        adoptedAt: new Date().toISOString()
      },
      agentLinks: {
        ...item.agentLinks,
        [input.agentId]: {
          path: input.agentPath,
          state: 'linked',
          createdByDeepChat: true,
          linkedAt: new Date().toISOString()
        }
      }
    }))

    this.publishEvent('skills.catalog.changed', {
      reason: 'installed',
      name: input.name,
      skill: metadata,
      version: Date.now()
    })
  }

  async registerAgentSkillLink(input: SkillAgentLinkRegistration): Promise<void> {
    await this.ensureAgentCatalogDiscovered(BUILTIN_SKILL_AGENT_ID)
    const metadata = this.metadataCache.get(input.skillName)
    if (!metadata) {
      throw new Error(`Skill "${input.skillName}" not found`)
    }

    this.updateSkillManagementItem(input.skillName, (item) => ({
      ...item,
      canonicalPath: metadata.skillRoot,
      agentLinks: {
        ...item.agentLinks,
        [input.agentId]: {
          path: input.agentPath,
          state: 'linked',
          createdByDeepChat: true,
          linkedAt: new Date().toISOString()
        }
      }
    }))

    this.publishEvent('skills.catalog.changed', {
      reason: 'management-state-updated',
      name: input.skillName,
      version: Date.now()
    })
  }

  async removeAgentSkillLink(input: { skillName: string; agentId: string }): Promise<void> {
    this.updateSkillManagementItem(input.skillName, (item) => {
      const agentLinks = { ...item.agentLinks }
      delete agentLinks[input.agentId]
      return {
        ...item,
        agentLinks: Object.keys(agentLinks).length > 0 ? agentLinks : undefined
      }
    })

    this.publishEvent('skills.catalog.changed', {
      reason: 'management-state-updated',
      name: input.skillName,
      version: Date.now()
    })
  }

  async unregisterPluginSkillsByOwner(ownerPluginId: string): Promise<void> {
    let changed = false
    for (const [key, contribution] of this.pluginSkillContributions.entries()) {
      if (contribution.ownerPluginId === ownerPluginId) {
        this.pluginSkillContributions.delete(key)
        changed = true
      }
    }

    if (changed) await this.invalidateCatalogsForPluginChange()
  }

  private async invalidateCatalogsForPluginChange(): Promise<void> {
    const scopedAgentIds = Array.from(this.scopedCatalogs.keys())
    this.metadataCache.clear()
    this.contentCache.clear()
    this.builtinCatalogDiscovered = false
    for (const catalog of this.scopedCatalogs.values()) {
      catalog.metadataCache.clear()
      catalog.contentCache.clear()
      catalog.discoveryPromise = null
      catalog.discovered = false
    }
    if (!this.initialized) return

    await this.discoverSkills(BUILTIN_SKILL_AGENT_ID)
    for (const agentId of scopedAgentIds) {
      try {
        await this.discoverSkills(agentId)
      } catch (error) {
        logger.warn('[SkillService] Failed to refresh Agent catalog after Plugin Skill change.', {
          agentId,
          error
        })
      }
    }
  }

  private async installFromDirectory(
    folderPath: string,
    context: SkillDirectoryInstallContext = {}
  ): Promise<SkillInstallResult> {
    const {
      options,
      sourceType = 'folder-install',
      sourcePatch = {},
      targetName,
      agentId = BUILTIN_SKILL_AGENT_ID,
      publishCatalogEvent = true
    } = context
    let targetPath = this.skillsDir
    let skillNameForFailure = targetName?.trim() || path.basename(folderPath)
    let finishAgentOperation: (() => void) | undefined
    try {
      const normalizedAgentId = await this.requireAgentScope(agentId)
      finishAgentOperation = this.beginAgentScopeOperation(normalizedAgentId)
      const skillsRoot = this.ensureAgentSkillsRoot(normalizedAgentId)
      const metadataCache = this.getMetadataCacheForAgent(normalizedAgentId)
      const contentCache = this.getContentCacheForAgent(normalizedAgentId)
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
      const hadPreviousContent = contentCache.has(finalSkillName)
      const previousContent = contentCache.get(finalSkillName)
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
          backupDir = this.backupExistingSkill(finalSkillName, normalizedAgentId)
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
        contentCache.delete(finalSkillName)
        managementStateTouched = true
        this.updateSkillManagementItem(
          finalSkillName,
          (item) => ({
            ...item,
            canonicalPath: resolvedTarget,
            source: {
              type: sourceType,
              installedAt: new Date().toISOString(),
              ...sourcePatch
            }
          }),
          normalizedAgentId
        )

        if (publishCatalogEvent) {
          this.publishEvent('skills.catalog.changed', {
            reason: 'installed',
            name: finalSkillName,
            agentIds: [normalizedAgentId],
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
          if (hadPreviousContent && previousContent !== undefined) {
            contentCache.set(finalSkillName, previousContent)
          } else {
            contentCache.delete(finalSkillName)
          }
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
      finishAgentOperation?.()
    }
  }

  private backupExistingSkill(skillName: string, agentId: string = BUILTIN_SKILL_AGENT_ID): string {
    const sourceDir = path.join(this.getAgentSkillsRoot(agentId), skillName)
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

  private extractZipToDirectory(zipPath: string, targetDir: string): void {
    // Check ZIP file size before loading to prevent memory exhaustion
    const stats = fs.statSync(zipPath)
    if (stats.size > SKILL_CONFIG.ZIP_MAX_SIZE) {
      throw new Error(`ZIP file too large: ${stats.size} bytes (max: ${SKILL_CONFIG.ZIP_MAX_SIZE})`)
    }

    const zipContent = new Uint8Array(fs.readFileSync(zipPath))
    const extracted = unzipSync(zipContent)
    const resolvedTargetDir = path.resolve(targetDir)

    for (const entryName of Object.keys(extracted)) {
      const fileContent = extracted[entryName]
      if (!fileContent) {
        continue
      }

      const normalizedEntry = entryName.replace(/\\/g, '/')
      if (!normalizedEntry) {
        continue
      }

      if (/^[A-Za-z]:/.test(normalizedEntry) || normalizedEntry.startsWith('/')) {
        throw new Error('Invalid zip entry')
      }

      const segments = normalizedEntry.split('/')
      const safeSegments: string[] = []
      for (const segment of segments) {
        if (!segment || segment === '.') {
          continue
        }
        if (segment === '..') {
          throw new Error('Invalid zip entry')
        }
        safeSegments.push(segment)
      }

      if (safeSegments.length === 0) {
        continue
      }

      const isDirectoryEntry = normalizedEntry.endsWith('/')
      const destination = path.resolve(resolvedTargetDir, ...safeSegments)
      const relativeToTarget = path.relative(resolvedTargetDir, destination)
      if (relativeToTarget.startsWith('..') || path.isAbsolute(relativeToTarget)) {
        throw new Error('Invalid zip entry')
      }

      if (isDirectoryEntry) {
        fs.mkdirSync(destination, { recursive: true })
        continue
      }

      fs.mkdirSync(path.dirname(destination), { recursive: true })
      fs.writeFileSync(destination, Buffer.from(fileContent))
    }
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

  private async downloadSkillZip(url: string, destPath: string): Promise<void> {
    const controller = new AbortController()
    const timeoutId = setTimeout(() => controller.abort(), SKILL_CONFIG.DOWNLOAD_TIMEOUT)

    try {
      const response = await fetch(url, { signal: controller.signal })
      if (!response.ok) {
        throw new Error(`Failed to download skill zip: ${response.status} ${response.statusText}`)
      }

      // Check Content-Length to prevent memory exhaustion
      const contentLength = response.headers.get('content-length')
      if (contentLength && parseInt(contentLength) > SKILL_CONFIG.ZIP_MAX_SIZE) {
        throw new Error(
          `File too large: ${contentLength} bytes (max: ${SKILL_CONFIG.ZIP_MAX_SIZE})`
        )
      }

      // Validate Content-Type
      const contentType = response.headers.get('content-type')
      if (
        contentType &&
        !contentType.includes('application/zip') &&
        !contentType.includes('application/octet-stream') &&
        !contentType.includes('application/x-zip')
      ) {
        throw new Error(`Expected ZIP file but got: ${contentType}`)
      }

      const buffer = new Uint8Array(await response.arrayBuffer())

      // Double-check actual size after download
      if (buffer.length > SKILL_CONFIG.ZIP_MAX_SIZE) {
        throw new Error(
          `Downloaded file too large: ${buffer.length} bytes (max: ${SKILL_CONFIG.ZIP_MAX_SIZE})`
        )
      }

      fs.writeFileSync(destPath, Buffer.from(buffer))
    } finally {
      clearTimeout(timeoutId)
    }
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
    agentId: string = BUILTIN_SKILL_AGENT_ID
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
      conflict: fs.existsSync(path.join(this.getAgentSkillsRoot(agentId), summary.name)),
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
    agentId: string = BUILTIN_SKILL_AGENT_ID
  ): string {
    const skillsRoot = this.getAgentSkillsRoot(agentId)
    let counter = 1
    let candidate = `${baseName}-${counter}`
    while (fs.existsSync(path.join(skillsRoot, candidate))) {
      counter += 1
      candidate = `${baseName}-${counter}`
    }
    return candidate
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
    if (!fs.existsSync(targetPath)) {
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

    const existingSource =
      this.getStoredManagementState().agents[BUILTIN_SKILL_AGENT_ID]?.skills[summary.name]?.source
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
    let skillDir = this.skillsDir
    let finishAgentOperation: (() => void) | undefined
    try {
      const normalizedAgentId = await this.requireAgentScope(agentId)
      finishAgentOperation = this.beginAgentScopeOperation(normalizedAgentId)
      if (!this.isSafeSkillName(name)) {
        return {
          success: false,
          error: 'Invalid skill name',
          errorCode: 'invalid_skill',
          skillName: name
        }
      }
      const metadataCache = this.getMetadataCacheForAgent(normalizedAgentId)
      await this.ensureAgentCatalogDiscovered(normalizedAgentId)
      this.assertAgentScopeActive(normalizedAgentId)
      const metadata = metadataCache.get(name)

      if (!metadata || !fs.existsSync(metadata.skillRoot)) {
        this.cleanupUninstalledSkillState(name, normalizedAgentId)
        return { success: false, error: `Skill "${name}" not found`, errorCode: 'not_found' }
      }
      this.assertMutableSkillOwnership(normalizedAgentId, metadata)
      skillDir = path.resolve(metadata.skillRoot)

      fs.rmSync(skillDir, { recursive: true, force: true })
      if (fs.existsSync(skillDir)) {
        return this.createTargetLockedFailure(name, skillDir, 'remove')
      }

      this.cleanupUninstalledSkillState(name, normalizedAgentId)

      this.publishEvent('skills.catalog.changed', {
        reason: 'uninstalled',
        name,
        agentIds: [normalizedAgentId],
        version: Date.now()
      })

      return { success: true, skillName: name }
    } catch (error) {
      return this.createTargetOperationFailure(name, skillDir, 'remove', error)
    } finally {
      finishAgentOperation?.()
    }
  }

  async cleanupAgentSkills(agentId: string): Promise<void> {
    const normalizedAgentId = assertSafeSkillAgentId(agentId)
    if (normalizedAgentId === BUILTIN_SKILL_AGENT_ID) {
      throw new Error('The built-in DeepChat Agent Skill root cannot be deleted')
    }

    this.deletedAgentScopes.add(normalizedAgentId)
    try {
      await this.waitForAgentScopeOperations(normalizedAgentId)
      const root = this.getAgentSkillsRoot(normalizedAgentId)
      if (fs.existsSync(root)) {
        fs.rmSync(root, { recursive: true, force: true })
        if (fs.existsSync(root)) {
          throw new Error(`Agent Skill root could not be removed: ${root}`)
        }
      }
    } catch (error) {
      this.deletedAgentScopes.delete(normalizedAgentId)
      throw error
    }

    this.scopedCatalogs.delete(normalizedAgentId)
    const state = this.getStoredManagementState()
    let changed = Boolean(state.agents[normalizedAgentId])
    delete state.agents[normalizedAgentId]
    if (state.migration) {
      const targetAgentIds = state.migration.targetAgentIds?.filter(
        (targetAgentId) => targetAgentId !== normalizedAgentId
      )
      const completedAgentIds = state.migration.completedAgentIds.filter(
        (completedAgentId) => completedAgentId !== normalizedAgentId
      )
      const legacySkillAllowLists = { ...state.migration.legacySkillAllowLists }
      const hadLegacySkillAllowList = normalizedAgentId in legacySkillAllowLists
      delete legacySkillAllowLists[normalizedAgentId]
      changed =
        changed ||
        targetAgentIds?.length !== state.migration.targetAgentIds?.length ||
        completedAgentIds.length !== state.migration.completedAgentIds.length ||
        hadLegacySkillAllowList
      state.migration = {
        ...state.migration,
        targetAgentIds,
        completedAgentIds,
        legacySkillAllowLists
      }
    }
    if (changed) this.saveManagementState(state)

    this.publishEvent('skills.catalog.changed', {
      reason: 'uninstalled',
      agentIds: [normalizedAgentId],
      version: Date.now()
    })
  }

  private cleanupUninstalledSkillState(
    name: string,
    agentId: string = BUILTIN_SKILL_AGENT_ID
  ): void {
    if (this.isSafeSkillName(name)) {
      try {
        this.deleteSkillManagementItem(name, agentId)
      } catch (error) {
        logger.warn('[SkillService] Failed to delete skill management state after uninstall', {
          name,
          error
        })
      }
    }

    this.getMetadataCacheForAgent(agentId).delete(name)
    this.getContentCacheForAgent(agentId).delete(name)
  }

  private isSafeSkillName(name: string): boolean {
    return SKILL_NAME_PATTERN.test(name) && !name.includes('/') && !name.includes('\\')
  }

  private assertMutableSkillOwnership(agentId: string, metadata: SkillMetadata): void {
    if (metadata.ownerPluginId) {
      throw new Error('Plugin-owned Skills cannot be modified as Agent-owned files')
    }

    const agentRoot = this.getAgentSkillsRoot(agentId)
    const resolvedSkillRoot = path.resolve(metadata.skillRoot)
    const relative = path.relative(agentRoot, resolvedSkillRoot)
    if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) {
      throw new Error(`Skill is outside the owning Agent root: ${metadata.name}`)
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
      throw new Error(`Skill is outside the owning Agent root: ${metadata.name}`)
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
    let finishAgentOperation: (() => void) | undefined
    try {
      const normalizedAgentId = await this.requireAgentScope(agentId)
      finishAgentOperation = this.beginAgentScopeOperation(normalizedAgentId)
      const metadataCache = this.getMetadataCacheForAgent(normalizedAgentId)
      const contentCache = this.getContentCacheForAgent(normalizedAgentId)
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
      const hadPreviousContent = contentCache.has(name)
      const previousContent = contentCache.get(name)
      let manifestWriteStarted = false
      let cachesTouched = false

      try {
        manifestWriteStarted = true
        fs.writeFileSync(confinedSkillPath, content, 'utf-8')

        const newMetadata = await this.parseSkillMetadata(
          confinedSkillPath,
          name,
          undefined,
          this.getAgentSkillsRoot(normalizedAgentId)
        )
        if (!newMetadata || newMetadata.name !== name) {
          throw new Error(`Saved Skill failed validation: ${name}`)
        }
        this.assertAgentScopeActive(normalizedAgentId)

        cachesTouched = true
        metadataCache.set(name, newMetadata)
        contentCache.delete(name)
        this.publishEvent('skills.catalog.changed', {
          reason: 'metadata-updated',
          name: newMetadata.name,
          skill: newMetadata,
          agentIds: [normalizedAgentId],
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
          if (hadPreviousContent && previousContent !== undefined) {
            contentCache.set(name, previousContent)
          } else {
            contentCache.delete(name)
          }
        }
        if (rollbackError) {
          metadataCache.delete(name)
          contentCache.delete(name)
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
    const normalizedAgentId = await this.requireAgentScope(agentId)
    const finishOperation = this.beginAgentScopeOperation(normalizedAgentId)
    try {
      const metadataCache = this.getMetadataCacheForAgent(normalizedAgentId)
      const contentCache = this.getContentCacheForAgent(normalizedAgentId)
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
      const hadPreviousContent = contentCache.has(name)
      const previousContent = contentCache.get(name)
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
          this.getAgentSkillsRoot(normalizedAgentId)
        )
        if (!newMetadata || newMetadata.name !== name) {
          throw new Error(`Saved Skill failed validation: ${name}`)
        }
        this.assertAgentScopeActive(normalizedAgentId)

        managementStateTouched = true
        this.updateSkillManagementItem(
          name,
          (item) => ({
            ...item,
            canonicalPath: metadata.skillRoot,
            extension: sanitized
          }),
          normalizedAgentId
        )

        this.assertAgentScopeActive(normalizedAgentId)
        cachesTouched = true
        metadataCache.set(name, newMetadata)
        contentCache.delete(name)
        this.publishEvent('skills.catalog.changed', {
          reason: 'metadata-updated',
          name: newMetadata.name,
          skill: newMetadata,
          extensionChanged: true,
          agentIds: [normalizedAgentId],
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
          if (hadPreviousContent && previousContent !== undefined) {
            contentCache.set(name, previousContent)
          } else {
            contentCache.delete(name)
          }
        }
        if (rollbackErrors.length > 0) {
          metadataCache.delete(name)
          contentCache.delete(name)
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
      const root = this.ensureAgentSkillsRoot(normalizedAgentId)
      await shell.openPath(root)
    } finally {
      finishOperation()
    }
  }

  async getSkillExtension(name: string): Promise<SkillExtensionConfig> {
    return await this.getSkillExtensionForAgent(BUILTIN_SKILL_AGENT_ID, name)
  }

  async getSkillExtensionForAgent(agentId: string, name: string): Promise<SkillExtensionConfig> {
    const normalizedAgentId = await this.requireAgentScope(agentId)
    const item = this.getStoredManagementState().agents[normalizedAgentId]?.skills[name]
    if (item) return sanitizeSkillExtensionConfig(item.extension)
    return normalizedAgentId === BUILTIN_SKILL_AGENT_ID
      ? await this.migrateLegacySkillExtension(name)
      : createDefaultSkillExtensionConfig()
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
      this.updateSkillManagementItem(name, (item) => ({
        ...item,
        extension: config
      }))
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
    const normalizedAgentId = await this.requireAgentScope(agentId)
    const finishOperation = this.beginAgentScopeOperation(normalizedAgentId)
    try {
      const metadataCache = this.getMetadataCacheForAgent(normalizedAgentId)
      await this.ensureAgentCatalogDiscovered(normalizedAgentId)
      this.assertAgentScopeActive(normalizedAgentId)
      if (!metadataCache.has(name)) throw new Error(`Skill "${name}" not found`)
      const metadata = metadataCache.get(name)
      this.updateSkillManagementItem(
        name,
        (item) => ({
          ...item,
          canonicalPath: metadata?.skillRoot ?? item.canonicalPath,
          extension: sanitizeSkillExtensionConfig(config)
        }),
        normalizedAgentId
      )
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

    const scriptsDir = path.join(metadata.skillRoot, 'scripts')
    if (!(await this.pathExists(scriptsDir))) {
      return []
    }
    const confinedScriptsDir = await this.resolvePhysicalSkillPath(metadata.skillRoot, scriptsDir)
    if (!confinedScriptsDir) {
      logger.warn('[SkillService] Ignoring a scripts directory outside the physical Skill root.', {
        agentId: normalizedAgentId,
        name,
        scriptsDir
      })
      return []
    }

    const extension = await this.getSkillExtensionForAgent(normalizedAgentId, name)
    const descriptors = (
      await this.collectScriptDescriptors(confinedScriptsDir, metadata.skillRoot)
    ).map((script) => {
      const override = extension.scriptOverrides[script.relativePath] ?? {}
      return {
        ...script,
        enabled: override.enabled ?? true,
        description: override.description
      }
    })

    descriptors.sort((left, right) => left.relativePath.localeCompare(right.relativePath))
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
    if (await this.isNewAgentSession(conversationId)) {
      const agentId = await this.resolveSessionAgentId(conversationId)
      if (!agentId) return []
      const skills = await this.loadNewSessionSkills(conversationId)
      const validSkills = await this.validateSkillNames(agentId, skills)
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
    try {
      const isNewSession = await this.isNewAgentSession(conversationId)
      const agentId = await this.resolveSessionAgentId(conversationId)
      // Validate skill names against the owning Agent's catalog.
      const validSkills = agentId ? await this.validateSkillNames(agentId, skills) : []
      if (!isNewSession || !agentId) {
        this.warnLegacySkillRetired(conversationId)
        return await this.getActiveSkills(conversationId)
      }

      const previousSkills = await this.getActiveSkills(conversationId)
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
    this.setPersistedNewSessionSkills(conversationId, [])
  }

  async revalidateActiveSkillsForAgent(conversationId: string, agentId: string): Promise<string[]> {
    const persisted = this.getPersistedNewSessionSkills(conversationId)
    const valid = await this.validateSkillNames(agentId, persisted)
    if (!this.areSkillListsEqual(persisted, valid)) {
      this.setPersistedNewSessionSkills(conversationId, valid)
    }
    return valid
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
      if (metadata?.allowedTools && this.isSkillVisible(metadata, agentId)) {
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
    return [`${root}/${SKILL_CONFIG.SIDECAR_DIR}/**`, `${root}/**/${SKILL_CONFIG.SIDECAR_DIR}/**`]
  }

  private async handleSkillWatchBatch(batch: WatcherEventBatch): Promise<void> {
    if (batch.events.some((event) => event.type === 'overflow' || event.type === 'root-deleted')) {
      await this.discoverSkills(BUILTIN_SKILL_AGENT_ID)
      for (const agentId of this.scopedCatalogs.keys()) await this.refreshAgentCatalog(agentId)
      return
    }

    for (const event of batch.events) {
      if (!this.isWatchedSkillMarkdownPath(event.path)) continue
      if (
        this.isWithinAgentScopesDirectory(event.path) &&
        !resolveScopedAgentIdFromPath(this.skillsDir, event.path)
      ) {
        continue
      }
      const agentId =
        resolveScopedAgentIdFromPath(this.skillsDir, event.path) ?? BUILTIN_SKILL_AGENT_ID
      if (this.deletedAgentScopes.has(agentId)) {
        continue
      }
      if (event.type === 'create') {
        await this.handleSkillFileAdded(event.path, agentId)
      } else if (event.type === 'update') {
        await this.handleSkillFileChanged(event.path, agentId)
      } else if (event.type === 'delete') {
        this.handleSkillFileDeleted(event.path, agentId)
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
    const contentCache = this.getContentCacheForAgent(agentId)
    const previousName =
      this.findSkillNameByPath(filePath, agentId) ?? path.basename(path.dirname(filePath))
    contentCache.delete(previousName)

    const metadata = await this.parseSkillMetadata(
      filePath,
      path.basename(path.dirname(filePath)),
      undefined,
      this.getAgentSkillsRoot(agentId)
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
      agentIds: [agentId],
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
      this.getAgentSkillsRoot(agentId)
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
    this.publishEvent('skills.catalog.changed', {
      reason: 'installed',
      name: metadata.name,
      skill: metadata,
      agentIds: [agentId],
      version: Date.now()
    })
  }

  private handleSkillFileDeleted(filePath: string, agentId: string = BUILTIN_SKILL_AGENT_ID): void {
    if (this.deletedAgentScopes.has(agentId)) return
    const skillName =
      this.findSkillNameByPath(filePath, agentId) ?? path.basename(path.dirname(filePath))
    this.getMetadataCacheForAgent(agentId).delete(skillName)
    this.getContentCacheForAgent(agentId).delete(skillName)
    this.publishEvent('skills.catalog.changed', {
      reason: 'uninstalled',
      name: skillName,
      agentIds: [agentId],
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
    this.scopedCatalogs.clear()
    this.deletedAgentScopes.clear()
    this.activeAgentScopeOperations.clear()
    this.agentScopeDrainWaiters.clear()
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

  private deleteSkillManagementItem(name: string, agentId: string = BUILTIN_SKILL_AGENT_ID): void {
    const state = this.getStoredManagementState()
    const skills = this.getAgentManagementState(state, agentId).skills
    if (skills[name]) {
      delete skills[name]
      this.saveManagementState(state)
    }
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

      acc.push({
        name: entry.name,
        relativePath: path.relative(skillRoot, confinedFilePath),
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

  private atomicWriteFile(targetPath: string, content: string): void {
    const tempPath = path.join(
      path.dirname(targetPath),
      `.${path.basename(targetPath)}.${process.pid}.${Date.now()}.tmp`
    )
    fs.writeFileSync(tempPath, content, 'utf-8')
    fs.renameSync(tempPath, targetPath)
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
