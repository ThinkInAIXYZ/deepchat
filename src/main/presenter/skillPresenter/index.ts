import { app, shell } from 'electron'
import path from 'path'
import fs from 'fs'
import { execFile } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { promisify } from 'node:util'
import matter from 'gray-matter'
import { unzipSync } from 'fflate'
import type { IConfigPresenter } from '@shared/presenter'
import {
  createWatcherRequestId,
  getFileWatcherService,
  type IFileWatcherService,
  type WatcherEventBatch,
  type WatcherStatus,
  type WatchHandle
} from '@/lib/fileWatcher'
import {
  ISkillPresenter,
  SkillMetadata,
  SkillContent,
  SkillInstallResult,
  SkillFolderNode,
  SkillInstallOptions,
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
  SkillManagementItem,
  SkillManagementState,
  SkillSyncDirectoryConfig,
  SkillSource,
  SkillSourceType,
  UnifiedSkillItem
} from '@shared/types/skillManagement'
import { publishDeepchatEvent } from '@/routes/publishDeepchatEvent'
import logger from '@shared/logger'
import { normalizeSkillAllowedTools } from './toolNameMapping'
import { discoverSkillMetadataInWorker, logSkillDiscoveryWorkerWarnings } from './discoveryWorker'

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
const SKILL_MANAGEMENT_STATE_KEY = 'skills.managementState'
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
 * SkillPresenter - Manages the skills system
 *
 * Responsibilities:
 * - Discover and parse SKILL.md files from ~/.deepchat/skills/
 * - Progressive loading: metadata always in memory, full content on demand
 * - Hot-reload skill files when they change
 * - Manage skill activation state per conversation
 * - Install/uninstall skills from various sources
 */
export class SkillPresenter implements ISkillPresenter {
  private skillsDir: string
  private sidecarDir: string
  private draftsRoot: string
  private metadataCache: Map<string, SkillMetadata> = new Map()
  private contentCache: Map<string, SkillContent> = new Map()
  private pluginSkillContributions: Map<
    string,
    { ownerPluginId: string; skillRoot: string; pluginRoot?: string }
  > = new Map()
  private watcher: WatchHandle | null = null
  private watcherStartPromise: Promise<void> | null = null
  private initialized: boolean = false
  // Prevent concurrent discovery calls (race condition protection)
  private discoveryPromise: Promise<SkillMetadata[]> | null = null
  private legacySkillRetirementWarnings: Set<string> = new Set()

  constructor(
    private readonly configPresenter: IConfigPresenter,
    private readonly sessionStatePort: SkillSessionStatePort,
    private readonly watcherService: IFileWatcherService = getFileWatcherService()
  ) {
    // Skills directory: ~/.deepchat/skills/
    this.skillsDir = this.resolveSkillsDir()
    this.sidecarDir = path.join(this.skillsDir, SKILL_CONFIG.SIDECAR_DIR)
    this.draftsRoot = path.join(app.getPath('temp'), SKILL_CONFIG.DRAFT_ROOT_DIR)
    this.ensureSkillsDir()
  }

  private resolveSkillsDir(): string {
    const configuredPath = this.configPresenter.getSkillsPath()
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

  /**
   * Get the skills directory path
   */
  async getSkillsDir(): Promise<string> {
    return this.skillsDir
  }

  /**
   * Initialize the skill system - discover skills and start watching
   */
  async initialize(): Promise<void> {
    if (this.initialized) return

    await this.installBuiltinSkills()
    this.cleanupExpiredDrafts()
    await this.discoverSkills()
    await this.watchSkillFiles()
    this.initialized = true
  }

  /**
   * Discover all skills from the skills directory
   */
  async discoverSkills(): Promise<SkillMetadata[]> {
    this.metadataCache.clear()
    this.contentCache.clear()

    if (!fs.existsSync(this.skillsDir)) {
      return []
    }

    let discoveredSkills: SkillMetadata[]
    try {
      const workerResult = await discoverSkillMetadataInWorker({
        skillsDir: this.skillsDir,
        sidecarDirName: SKILL_CONFIG.SIDECAR_DIR,
        maxDepth: SKILL_CONFIG.FOLDER_TREE_MAX_DEPTH
      })
      logSkillDiscoveryWorkerWarnings(workerResult.warnings)
      discoveredSkills = workerResult.skills
    } catch (error) {
      console.warn('[SkillPresenter] Worker discovery failed, falling back to main thread:', error)
      discoveredSkills = await this.discoverSkillsOnMainThread()
    }

    for (const metadata of [
      ...discoveredSkills,
      ...(await this.discoverPluginSkillsOnMainThread())
    ]) {
      if (this.metadataCache.has(metadata.name)) {
        logger.warn('[SkillPresenter] Duplicate skill name discovered. Keeping the first entry.', {
          name: metadata.name,
          path: metadata.path
        })
        continue
      }
      this.metadataCache.set(metadata.name, metadata)
    }

    const skills = this.getVisibleMetadataFromCache()
    publishDeepchatEvent('skills.catalog.changed', {
      reason: 'discovered',
      skills,
      version: Date.now()
    })

    return skills
  }

  private async discoverSkillsOnMainThread(): Promise<SkillMetadata[]> {
    const discovered = new Map<string, SkillMetadata>()
    const skillManifestPaths = [...this.collectSkillManifestPaths(this.skillsDir)].sort(
      (left, right) => left.localeCompare(right)
    )

    for (const skillPath of skillManifestPaths) {
      const dirName = path.basename(path.dirname(skillPath))
      try {
        const metadata = await this.parseSkillMetadata(skillPath, dirName)
        if (!metadata) {
          continue
        }
        if (discovered.has(metadata.name)) {
          logger.warn(
            '[SkillPresenter] Duplicate skill name discovered. Keeping the first entry.',
            {
              name: metadata.name,
              path: metadata.path
            }
          )
          continue
        }
        discovered.set(metadata.name, metadata)
      } catch (error) {
        console.error(`[SkillPresenter] Failed to parse skill at ${skillPath}:`, error)
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
        logger.warn('[SkillPresenter] Plugin skill contribution is missing SKILL.md.', {
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
    ownerPluginId?: string
  ): Promise<SkillMetadata | null> {
    try {
      const content = await fs.promises.readFile(skillPath, 'utf-8')
      const { data } = matter(content)

      // Validate required fields
      if (!data.name || !data.description) {
        console.warn(`[SkillPresenter] Skill ${dirName} missing required frontmatter fields`)
        return null
      }

      // Ensure name matches directory name
      if (data.name !== dirName) {
        console.warn(
          `[SkillPresenter] Skill name "${data.name}" doesn't match directory "${dirName}"`
        )
      }

      return {
        name: data.name || dirName,
        description: data.description || '',
        path: skillPath,
        skillRoot: path.dirname(skillPath),
        category: this.deriveSkillCategory(path.dirname(skillPath)),
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
      console.error(`[SkillPresenter] Error parsing skill metadata at ${skillPath}:`, error)
      return null
    }
  }

  /**
   * Get list of all skill metadata (from cache)
   * Uses discoveryPromise pattern to prevent race conditions
   */
  async getMetadataList(): Promise<SkillMetadata[]> {
    if (this.metadataCache.size === 0) {
      if (!this.discoveryPromise) {
        this.discoveryPromise = this.discoverSkills().finally(() => {
          this.discoveryPromise = null
        })
      }
      await this.discoveryPromise
    }
    return this.getVisibleMetadataFromCache()
  }

  private getVisibleMetadataFromCache(): SkillMetadata[] {
    return this.sortSkillMetadata(
      Array.from(this.metadataCache.values()).filter((skill) => this.isSkillVisible(skill))
    )
  }

  private isSkillVisible(metadata: SkillMetadata): boolean {
    return Boolean(metadata) && !this.isSkillDeepChatDisabled(metadata.name)
  }

  private createDefaultManagementState(): SkillManagementState {
    return {
      version: 1,
      skills: {}
    }
  }

  private getStoredManagementState(): SkillManagementState {
    const stored = this.configPresenter.getSetting<unknown>(SKILL_MANAGEMENT_STATE_KEY)
    if (!stored || typeof stored !== 'object') {
      return this.createDefaultManagementState()
    }

    const candidate = stored as Partial<SkillManagementState>
    const skills: Record<string, SkillManagementItem> = {}
    for (const [name, item] of Object.entries(candidate.skills ?? {})) {
      if (!this.isSafeSkillName(name) || !item || typeof item !== 'object') {
        continue
      }
      const raw = item as Partial<SkillManagementItem>
      skills[name] = {
        name,
        canonicalPath:
          typeof raw.canonicalPath === 'string' && raw.canonicalPath.trim()
            ? raw.canonicalPath
            : path.join(this.skillsDir, name),
        deepchat: {
          disabled: raw.deepchat?.disabled === true
        },
        extension: sanitizeSkillExtensionConfig(raw.extension),
        source: this.sanitizeSkillSource(raw.source),
        agentLinks:
          raw.agentLinks && typeof raw.agentLinks === 'object'
            ? (raw.agentLinks as SkillManagementItem['agentLinks'])
            : undefined
      }
    }

    return {
      version: 1,
      skills,
      sync: this.sanitizeSyncDirectoryConfig(candidate.sync)
    }
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
    this.configPresenter.setSetting(SKILL_MANAGEMENT_STATE_KEY, state)
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

  private createDefaultManagementItem(name: string): SkillManagementItem {
    return {
      name,
      canonicalPath: path.join(this.skillsDir, name),
      deepchat: {
        disabled: false
      },
      extension: createDefaultSkillExtensionConfig(),
      source: {
        type: 'created'
      }
    }
  }

  private updateSkillManagementItem(
    name: string,
    updater: (item: SkillManagementItem) => SkillManagementItem
  ): SkillManagementItem {
    const state = this.getStoredManagementState()
    const nextItem = updater(state.skills[name] ?? this.createDefaultManagementItem(name))
    state.skills[name] = nextItem
    this.saveManagementState(state)
    return nextItem
  }

  private isSkillDeepChatDisabled(name: string): boolean {
    return this.getStoredManagementState().skills[name]?.deepchat.disabled === true
  }

  async getSkillManagementState(): Promise<SkillManagementState> {
    return this.getStoredManagementState()
  }

  async setSkillDeepChatDisabled(name: string, disabled: boolean): Promise<void> {
    if (this.metadataCache.size === 0) {
      await this.discoverSkills()
    }
    if (!this.metadataCache.has(name)) {
      throw new Error(`Skill "${name}" not found`)
    }

    this.updateSkillManagementItem(name, (item) => ({
      ...item,
      canonicalPath: this.metadataCache.get(name)?.skillRoot ?? item.canonicalPath,
      deepchat: {
        ...item.deepchat,
        disabled
      }
    }))
    this.contentCache.delete(name)
    publishDeepchatEvent('skills.catalog.changed', {
      reason: 'disabled-updated',
      name,
      version: Date.now()
    })
  }

  async getUnifiedSkillCatalog(): Promise<UnifiedSkillItem[]> {
    if (this.metadataCache.size === 0) {
      await this.discoverSkills()
    }

    const state = this.getStoredManagementState()
    return this.sortSkillMetadata(Array.from(this.metadataCache.values())).map((skill) => {
      const item = state.skills[skill.name] ?? this.createDefaultManagementItem(skill.name)
      return {
        ...skill,
        canonicalPath: item.canonicalPath || skill.skillRoot,
        sourceType: item.source.type,
        deepchatDisabled: item.deepchat.disabled,
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
  async loadSkillContent(name: string): Promise<SkillContent | null> {
    if (this.metadataCache.size === 0) {
      await this.discoverSkills()
    }

    // Get metadata to find the path
    const metadata = this.metadataCache.get(name)
    if (!metadata || !this.isSkillVisible(metadata)) {
      console.warn(`[SkillPresenter] Skill not found: ${name}`)
      return null
    }

    // Check content cache after feature visibility so disabled managed skills stay hidden.
    if (this.contentCache.has(name)) {
      return this.contentCache.get(name)!
    }

    try {
      // Check file size before reading to prevent memory exhaustion
      const stats = await fs.promises.stat(metadata.path)
      if (stats.size > SKILL_CONFIG.SKILL_FILE_MAX_SIZE) {
        console.error(
          `[SkillPresenter] Skill file too large: ${stats.size} bytes (max: ${SKILL_CONFIG.SKILL_FILE_MAX_SIZE})`
        )
        return null
      }

      const rawContent = await fs.promises.readFile(metadata.path, 'utf-8')
      const { content } = matter(rawContent)
      const renderedContent = this.replacePathVariables(content, metadata)
      const runtimeInstructions = await this.buildRuntimeInstructions(metadata)

      const skillContent: SkillContent = {
        name,
        content: [renderedContent.trim(), runtimeInstructions].filter(Boolean).join('\n\n')
      }

      // Discovery may have refreshed the caches while we were reading from disk;
      // only cache when this skill's metadata entry is still the one we read from.
      if (this.metadataCache.get(name) === metadata) {
        this.contentCache.set(name, skillContent)
      }
      return skillContent
    } catch (error) {
      console.error(`[SkillPresenter] Error loading skill content for ${name}:`, error)
      return null
    }
  }

  async viewSkill(
    name: string,
    options?: {
      filePath?: string
      conversationId?: string
    }
  ): Promise<SkillViewResult> {
    if (this.metadataCache.size === 0) {
      await this.discoverSkills()
    }

    const metadata = this.metadataCache.get(name)
    if (!metadata || !this.isSkillVisible(metadata)) {
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
        const resolvedPath = this.resolveSkillRelativePath(metadata.skillRoot, requestedFilePath)
        if (!resolvedPath) {
          return {
            success: false,
            error: 'Requested skill file is outside the skill root'
          }
        }

        if (!(await this.pathExists(resolvedPath))) {
          return {
            success: false,
            error: `Skill file not found: ${requestedFilePath}`
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
        console.error('[SkillPresenter] Failed to load requested skill file for skill_view:', {
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
      const stats = await fs.promises.stat(metadata.path)
      if (stats.size > SKILL_CONFIG.SKILL_FILE_MAX_SIZE) {
        const errorMessage = `[SkillPresenter] Skill file too large: ${stats.size} bytes (max: ${SKILL_CONFIG.SKILL_FILE_MAX_SIZE})`
        console.error(errorMessage)
        return {
          success: false,
          error: errorMessage
        }
      }

      const rawContent = await fs.promises.readFile(metadata.path, 'utf-8')
      const { content } = matter(rawContent)
      return {
        success: true,
        name: metadata.name,
        category: metadata.category ?? null,
        skillRoot: metadata.skillRoot,
        filePath: null,
        content: this.replacePathVariables(content, metadata),
        platforms: metadata.platforms,
        metadata: metadata.metadata,
        linkedFiles: await this.listSkillLinkedFiles(metadata.skillRoot),
        isPinned
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error)
      console.error('[SkillPresenter] Failed to load skill_view content:', {
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

    const result = await this.installFromDirectory(draftPath, { overwrite: false })
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

  private replacePathVariables(content: string, metadata: SkillMetadata): string {
    const pluginContribution = this.getPluginContributionForSkillRoot(metadata.skillRoot)
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

  private async buildRuntimeInstructions(metadata: SkillMetadata): Promise<string> {
    const scripts = (await this.listSkillScripts(metadata.name)).filter((script) => script.enabled)
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

      const result = await this.installFromDirectory(skillDir, { overwrite: false }, 'builtin')
      if (!result.success && result.error?.includes('already exists')) {
        continue
      }
      if (!result.success) {
        console.warn('[SkillPresenter] Failed to install builtin skill:', result.error)
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
    return this.installFromDirectory(folderPath, options, 'folder-install')
  }

  /**
   * Install a skill from a zip file
   */
  async installFromZip(
    zipPath: string,
    options?: SkillInstallOptions
  ): Promise<SkillInstallResult> {
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
      return await this.installFromDirectory(skillDir, options, 'zip-install')
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
    const tempZipPath = path.join(app.getPath('temp'), `deepchat-skill-${Date.now()}.zip`)
    try {
      await this.downloadSkillZip(url, tempZipPath)
      const result = await this.installFromZip(tempZipPath, options)
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
    }
  }

  async scanGitSkillRepo(repoUrl: string): Promise<GitSkillRepoScanResult> {
    const normalizedRepoUrl = repoUrl.trim()
    if (!normalizedRepoUrl) {
      throw new Error('Git repository URL is required')
    }

    const cloneDir = await this.cloneGitSkillRepo(normalizedRepoUrl)
    try {
      return await this.scanGitSkillRepoDirectory(normalizedRepoUrl, cloneDir)
    } finally {
      fs.rmSync(cloneDir, { recursive: true, force: true })
    }
  }

  async installSkillsFromGit(input: GitSkillInstallInput): Promise<SkillInstallResult[]> {
    const repoUrl = input.repoUrl.trim()
    const selected = new Set(input.skillNames)
    const strategy = input.strategy ?? 'rename'
    if (!repoUrl || selected.size === 0) {
      return []
    }

    const cloneDir = await this.cloneGitSkillRepo(repoUrl)
    try {
      const scan = await this.scanGitSkillRepoDirectory(repoUrl, cloneDir)
      const selectedItems = scan.skills.filter((item) => selected.has(item.name))
      const results: SkillInstallResult[] = []

      for (const item of selectedItems) {
        if (!item.valid) {
          results.push({
            success: false,
            skillName: item.name,
            error: item.error ?? 'Invalid skill',
            errorCode: 'invalid_skill'
          })
          continue
        }

        if (item.conflict && strategy === 'skip') {
          results.push({
            success: false,
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
          item.conflict && strategy === 'rename' ? this.createUniqueSkillName(item.name) : item.name
        const result = await this.installFromDirectory(
          sourceDir,
          { overwrite: item.conflict && strategy === 'overwrite' },
          'git-install',
          {
            repoUrl,
            repoFormat: scan.repoFormat,
            installedAt: new Date().toISOString()
          },
          targetName
        )
        results.push(result)
      }

      if (results.some((result) => result.success)) {
        publishDeepchatEvent('skills.catalog.changed', {
          reason: 'git-installed',
          version: Date.now()
        })
      }

      return results
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error)
      return [{ success: false, error: errorMsg, errorCode: 'io_error' }]
    } finally {
      fs.rmSync(cloneDir, { recursive: true, force: true })
    }
  }

  async getSkillsSyncConfig(): Promise<SkillSyncDirectoryConfig | null> {
    return this.getStoredManagementState().sync ?? null
  }

  async setSkillsSyncDirectory(input: {
    skillsDirectory: string
  }): Promise<SkillSyncDirectoryConfig> {
    const skillsDirectory = path.resolve(input.skillsDirectory.trim())
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
    publishDeepchatEvent('skills.catalog.changed', {
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
        fs.rmSync(item.targetPath, { recursive: true, force: true })
        this.copyDirectory(item.sourcePath, item.targetPath)
        exported += 1
      } catch (error) {
        failed.push({
          skillName: item.name,
          reason: error instanceof Error ? error.message : String(error)
        })
      }
    }

    if (exported > 0) {
      this.updateSyncDirectoryConfig({ lastExportAt: new Date().toISOString() })
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
    const strategy = input.strategy ?? 'rename'
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
      const result = await this.installFromDirectory(
        item.sourcePath,
        { overwrite: strategy === 'overwrite' },
        'imported',
        {
          importedFrom: item.sourcePath,
          importedAt: new Date().toISOString()
        },
        targetName
      )
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
      this.updateSyncDirectoryConfig({ lastImportAt: new Date().toISOString() })
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
    this.metadataCache.clear()
    this.contentCache.clear()
    if (this.initialized) {
      await this.discoverSkills()
    }
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

    publishDeepchatEvent('skills.catalog.changed', {
      reason: 'installed',
      name: input.name,
      skill: metadata,
      version: Date.now()
    })
  }

  async registerAgentSkillLink(input: SkillAgentLinkRegistration): Promise<void> {
    if (this.metadataCache.size === 0) {
      await this.discoverSkills()
    }
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

    publishDeepchatEvent('skills.catalog.changed', {
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

    publishDeepchatEvent('skills.catalog.changed', {
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

    if (changed && this.initialized) {
      this.metadataCache.clear()
      this.contentCache.clear()
      await this.discoverSkills()
    } else if (changed) {
      this.metadataCache.clear()
      this.contentCache.clear()
    }
  }

  private async installFromDirectory(
    folderPath: string,
    options?: SkillInstallOptions,
    sourceType: SkillSourceType = 'folder-install',
    sourcePatch: Partial<SkillSource> = {},
    targetName?: string
  ): Promise<SkillInstallResult> {
    try {
      this.ensureSkillsDir()
      const resolvedSource = path.resolve(folderPath)

      if (!fs.existsSync(resolvedSource)) {
        return { success: false, error: 'Skill folder not found', errorCode: 'not_found' }
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
      if (!this.isSafeSkillName(finalSkillName)) {
        return {
          success: false,
          error: 'Invalid target skill name',
          errorCode: 'invalid_skill'
        }
      }

      const targetDir = path.join(this.skillsDir, finalSkillName)
      const resolvedTarget = path.resolve(targetDir)

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
        const replaceResult = this.prepareExistingSkillTargetForInstall(
          finalSkillName,
          resolvedTarget
        )
        if (replaceResult) {
          return replaceResult
        }
        this.metadataCache.delete(finalSkillName)
        this.contentCache.delete(finalSkillName)
      }

      this.copyDirectory(resolvedSource, resolvedTarget)
      if (finalSkillName !== skillName) {
        this.rewriteSkillManifestName(resolvedTarget, finalSkillName)
      }

      const metadata = await this.parseSkillMetadata(
        path.join(resolvedTarget, 'SKILL.md'),
        finalSkillName
      )
      if (metadata) {
        this.metadataCache.set(finalSkillName, metadata)
      }
      this.updateSkillManagementItem(finalSkillName, (item) => ({
        ...item,
        canonicalPath: resolvedTarget,
        source: {
          type: sourceType,
          installedAt: new Date().toISOString(),
          ...sourcePatch
        }
      }))

      publishDeepchatEvent('skills.catalog.changed', {
        reason: 'installed',
        name: finalSkillName,
        version: Date.now()
      })

      return { success: true, skillName: finalSkillName, targetPath: resolvedTarget }
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error)
      return { success: false, error: errorMsg, errorCode: 'io_error' }
    }
  }

  private prepareExistingSkillTargetForInstall(
    skillName: string,
    targetDir: string
  ): SkillInstallResult | null {
    try {
      const existingSkillPath = path.join(targetDir, 'SKILL.md')
      if (fs.existsSync(existingSkillPath)) {
        this.backupExistingSkill(skillName)
      } else {
        fs.rmSync(targetDir, { recursive: true, force: true })
        if (fs.existsSync(targetDir)) {
          return this.createTargetLockedFailure(skillName, targetDir, 'replace')
        }
      }
      return null
    } catch (error) {
      return this.createTargetOperationFailure(skillName, targetDir, 'replace', error)
    }
  }

  private backupExistingSkill(skillName: string): string {
    const sourceDir = path.join(this.skillsDir, skillName)
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-')
    const backupRoot = path.join(app.getPath('home'), '.deepchat', 'backups', 'skill-installs')
    fs.mkdirSync(backupRoot, { recursive: true })
    let backupDir = path.join(backupRoot, `${skillName}-${timestamp}`)
    let counter = 0
    while (fs.existsSync(backupDir)) {
      counter += 1
      backupDir = path.join(backupRoot, `${skillName}-${timestamp}-${counter}`)
    }
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
    repoRoot: string
  ): Promise<GitSkillRepoScanResult> {
    const rootSkill = path.join(repoRoot, 'SKILL.md')
    if (fs.existsSync(rootSkill)) {
      return {
        repoUrl,
        repoFormat: 'single-skill',
        skills: [this.createGitScanItem(repoRoot, 'SKILL.md')]
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
              path.join('skills', entry.name, 'SKILL.md')
            )
          )
      : []

    return {
      repoUrl,
      repoFormat: 'multi-skill',
      skills: skills.sort((left, right) => left.name.localeCompare(right.name))
    }
  }

  private createGitScanItem(skillDir: string, relativePath: string): GitSkillRepoScanItem {
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
      conflict: fs.existsSync(path.join(this.skillsDir, summary.name)),
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

  private createUniqueSkillName(baseName: string): string {
    let counter = 1
    let candidate = `${baseName}-${counter}`
    while (fs.existsSync(path.join(this.skillsDir, candidate))) {
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
    return config
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
    publishDeepchatEvent('skills.catalog.changed', {
      reason: 'sync-directory-updated',
      version: Date.now()
    })
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
    try {
      const skillDir = path.join(this.skillsDir, name)

      if (!fs.existsSync(skillDir)) {
        this.cleanupUninstalledSkillState(name)
        return { success: false, error: `Skill "${name}" not found`, errorCode: 'not_found' }
      }

      fs.rmSync(skillDir, { recursive: true, force: true })
      if (fs.existsSync(skillDir)) {
        return this.createTargetLockedFailure(name, skillDir, 'remove')
      }

      this.cleanupUninstalledSkillState(name)

      publishDeepchatEvent('skills.catalog.changed', {
        reason: 'uninstalled',
        name,
        version: Date.now()
      })

      return { success: true, skillName: name }
    } catch (error) {
      return this.createTargetOperationFailure(
        name,
        path.join(this.skillsDir, name),
        'remove',
        error
      )
    }
  }

  private cleanupUninstalledSkillState(name: string): void {
    if (this.isSafeSkillName(name)) {
      try {
        this.deleteSkillManagementItem(name)
      } catch (error) {
        logger.warn('[SkillPresenter] Failed to delete skill management state after uninstall', {
          name,
          error
        })
      }
    }

    this.metadataCache.delete(name)
    this.contentCache.delete(name)
  }

  private isSafeSkillName(name: string): boolean {
    return SKILL_NAME_PATTERN.test(name) && !name.includes('/') && !name.includes('\\')
  }

  /**
   * Update a skill's SKILL.md content
   */
  async updateSkillFile(name: string, content: string): Promise<SkillInstallResult> {
    try {
      const metadata = this.metadataCache.get(name)
      if (!metadata) {
        return { success: false, error: `Skill "${name}" not found` }
      }

      fs.writeFileSync(metadata.path, content, 'utf-8')

      // Invalidate caches
      this.contentCache.delete(name)
      const newMetadata = await this.parseSkillMetadata(metadata.path, name)
      if (newMetadata) {
        this.metadataCache.set(name, newMetadata)
      }

      return { success: true, skillName: name }
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error)
      return { success: false, error: errorMsg }
    }
  }

  async saveSkillWithExtension(
    name: string,
    content: string,
    config: SkillExtensionConfig
  ): Promise<SkillInstallResult> {
    this.ensureSkillsDir()
    if (this.metadataCache.size === 0) {
      await this.discoverSkills()
    }

    const metadata = this.metadataCache.get(name)
    if (!metadata) {
      return { success: false, error: `Skill "${name}" not found` }
    }

    const previousSkillContent = fs.readFileSync(metadata.path, 'utf-8')
    const previousState = this.getStoredManagementState()
    const sanitized = sanitizeSkillExtensionConfig(config)

    try {
      fs.writeFileSync(metadata.path, content, 'utf-8')
      this.updateSkillManagementItem(name, (item) => ({
        ...item,
        canonicalPath: metadata.skillRoot,
        extension: sanitized
      }))

      this.contentCache.delete(name)
      const newMetadata = await this.parseSkillMetadata(metadata.path, name)
      if (newMetadata) {
        this.metadataCache.set(name, newMetadata)
      }

      return { success: true, skillName: name }
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error)

      try {
        fs.writeFileSync(metadata.path, previousSkillContent, 'utf-8')
        this.saveManagementState(previousState)
      } catch (rollbackError) {
        const rollbackMessage =
          rollbackError instanceof Error ? rollbackError.message : String(rollbackError)
        logger.warn('[SkillPresenter] Failed to rollback combined skill save', {
          name,
          error,
          rollbackError
        })
        return {
          success: false,
          error: `${errorMsg} (rollback failed: ${rollbackMessage})`
        }
      }

      this.contentCache.delete(name)
      return { success: false, error: errorMsg }
    }
  }

  async readSkillFile(name: string): Promise<string> {
    if (this.metadataCache.size === 0) {
      await this.discoverSkills()
    }

    const metadata = this.metadataCache.get(name)
    if (!metadata) {
      throw new Error(`Skill "${name}" not found`)
    }

    const stats = await fs.promises.stat(metadata.path)
    if (stats.size > SKILL_CONFIG.SKILL_FILE_MAX_SIZE) {
      const errorMessage = `[SkillPresenter] Skill file too large: ${stats.size} bytes (max: ${SKILL_CONFIG.SKILL_FILE_MAX_SIZE})`
      console.error(errorMessage)
      throw new Error(errorMessage)
    }

    return await fs.promises.readFile(metadata.path, 'utf-8')
  }

  /**
   * Get folder tree for a skill
   */
  async getSkillFolderTree(name: string): Promise<SkillFolderNode[]> {
    const metadata = this.metadataCache.get(name)
    if (!metadata) {
      return []
    }

    return this.buildFolderTree(metadata.skillRoot)
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
        if (entry.isSymbolicLink() || entry.name === SKILL_CONFIG.SIDECAR_DIR) {
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
      console.warn(`[SkillPresenter] Cannot read directory: ${dirPath}`, error)
      return []
    }
  }

  /**
   * Open the skills folder in file explorer
   */
  async openSkillsFolder(): Promise<void> {
    this.ensureSkillsDir()
    await shell.openPath(this.skillsDir)
  }

  async getSkillExtension(name: string): Promise<SkillExtensionConfig> {
    this.ensureSkillsDir()
    const item = this.getStoredManagementState().skills[name]
    if (item) {
      return sanitizeSkillExtensionConfig(item.extension)
    }

    return await this.migrateLegacySkillExtension(name)
  }

  private async migrateLegacySkillExtension(name: string): Promise<SkillExtensionConfig> {
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
        logger.warn('[SkillPresenter] Failed to remove migrated skill sidecar', {
          name,
          error: cleanupError
        })
      }
      return config
    } catch (error) {
      logger.warn('[SkillPresenter] Failed to read skill sidecar, using defaults', {
        name,
        error
      })
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
    this.ensureSkillsDir()
    if (this.metadataCache.size === 0) {
      await this.discoverSkills()
    }

    if (!this.metadataCache.has(name)) {
      throw new Error(`Skill "${name}" not found`)
    }

    const sanitized = sanitizeSkillExtensionConfig(config)
    const metadata = this.metadataCache.get(name)
    this.updateSkillManagementItem(name, (item) => ({
      ...item,
      canonicalPath: metadata?.skillRoot ?? item.canonicalPath,
      extension: sanitized
    }))
    this.contentCache.delete(name)
  }

  async listSkillScripts(name: string): Promise<SkillScriptDescriptor[]> {
    if (this.metadataCache.size === 0) {
      await this.discoverSkills()
    }

    const metadata = this.metadataCache.get(name)
    if (!metadata) {
      return []
    }

    const scriptsDir = path.join(metadata.skillRoot, 'scripts')
    if (!(await this.pathExists(scriptsDir))) {
      return []
    }

    const extension = await this.getSkillExtension(name)
    const descriptors = (await this.collectScriptDescriptors(scriptsDir, metadata.skillRoot)).map(
      (script) => {
        const override = extension.scriptOverrides[script.relativePath] ?? {}
        return {
          ...script,
          enabled: override.enabled ?? true,
          description: override.description
        }
      }
    )

    descriptors.sort((left, right) => left.relativePath.localeCompare(right.relativePath))
    return descriptors
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
        `[SkillPresenter] Failed to repair imported legacy session skills for ${conversationId}:`,
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
    logger.warn('[SkillPresenter] Ignoring skill state update for retired legacy conversation.', {
      conversationId
    })
  }

  /**
   * Get active skills for a conversation
   */
  async getActiveSkills(conversationId: string): Promise<string[]> {
    if (await this.isNewAgentSession(conversationId)) {
      const skills = await this.loadNewSessionSkills(conversationId)
      const validSkills = await this.validateSkillNames(skills)
      if (validSkills.length !== skills.length) {
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
      // Validate skill names
      const validSkills = await this.validateSkillNames(skills)
      if (!isNewSession) {
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
        publishDeepchatEvent('skills.session.changed', {
          conversationId,
          skills: activated,
          change: 'activated',
          version: Date.now()
        })
      }

      if (deactivated.length > 0) {
        publishDeepchatEvent('skills.session.changed', {
          conversationId,
          skills: deactivated,
          change: 'deactivated',
          version: Date.now()
        })
      }

      return validSkills
    } catch (error) {
      console.error(`[SkillPresenter] Error setting active skills for ${conversationId}:`, error)
      throw error
    }
  }

  async clearNewAgentSessionSkills(conversationId: string): Promise<void> {
    this.setPersistedNewSessionSkills(conversationId, [])
  }

  /**
   * Validate skill names against available skills
   */
  async validateSkillNames(names: string[]): Promise<string[]> {
    const available = await this.getMetadataList()
    const availableNames = new Set(available.map((s) => s.name))
    return names.filter((name) => availableNames.has(name))
  }

  /**
   * Get allowed tools for active skills in a conversation
   */
  async getActiveSkillsAllowedTools(
    conversationId: string,
    activeSkillNamesOverride?: string[]
  ): Promise<string[]> {
    if (this.metadataCache.size === 0) {
      await this.discoverSkills()
    }

    const activeSkills = activeSkillNamesOverride ?? (await this.getActiveSkills(conversationId))
    const allowedTools: Set<string> = new Set()

    for (const skillName of activeSkills) {
      const metadata = this.metadataCache.get(skillName)
      if (metadata?.allowedTools && this.isSkillVisible(metadata)) {
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
      logger.warn('[SkillPresenter] Failed to close failed file watcher.', { error })
    })
  }

  private handleWatcherStartFailure(error: unknown): void {
    this.watcher = null
    logger.warn('[SkillPresenter] File watcher unavailable; skill hot reload disabled.', {
      reason: 'start-failed',
      error
    })
  }

  /**
   * Watch skill files for changes (hot-reload)
   */
  async watchSkillFiles(): Promise<void> {
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
        logger.info('[SkillPresenter] File watcher started')
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
    logger.info('[SkillPresenter] File watcher stopped')
  }

  private createSkillWatchExcludes(): string[] {
    const root = this.skillsDir.split(path.sep).join('/')
    return [`${root}/${SKILL_CONFIG.SIDECAR_DIR}/**`, `${root}/**/${SKILL_CONFIG.SIDECAR_DIR}/**`]
  }

  private async handleSkillWatchBatch(batch: WatcherEventBatch): Promise<void> {
    if (batch.events.some((event) => event.type === 'overflow' || event.type === 'root-deleted')) {
      await this.discoverSkills()
      return
    }

    for (const event of batch.events) {
      if (!this.isWatchedSkillMarkdownPath(event.path)) {
        continue
      }

      if (event.type === 'create') {
        await this.handleSkillFileAdded(event.path)
      } else if (event.type === 'update') {
        await this.handleSkillFileChanged(event.path)
      } else if (event.type === 'delete') {
        this.handleSkillFileDeleted(event.path)
      }
    }
  }

  private handleSkillWatchStatus(status: WatcherStatus): void {
    if (status.health === 'healthy') {
      return
    }

    logger.warn('[SkillPresenter] File watcher degraded.', {
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

  private async handleSkillFileChanged(filePath: string): Promise<void> {
    const previousName = this.findSkillNameByPath(filePath) ?? path.basename(path.dirname(filePath))
    this.contentCache.delete(previousName)

    const metadata = await this.parseSkillMetadata(filePath, path.basename(path.dirname(filePath)))
    if (!metadata) {
      return
    }

    const existingMetadata = this.metadataCache.get(metadata.name)
    if (existingMetadata && existingMetadata.path !== metadata.path) {
      logger.warn('[SkillPresenter] Duplicate skill name discovered. Keeping the first entry.', {
        name: metadata.name,
        path: metadata.path,
        existingPath: existingMetadata.path
      })
      const previousMetadata = this.metadataCache.get(previousName)
      if (previousName !== metadata.name && previousMetadata?.path === metadata.path) {
        this.metadataCache.delete(previousName)
      }
      return
    }

    if (previousName !== metadata.name) {
      const previousMetadata = this.metadataCache.get(previousName)
      if (previousMetadata?.path === metadata.path) {
        this.metadataCache.delete(previousName)
      }
    }

    this.metadataCache.set(metadata.name, metadata)
    publishDeepchatEvent('skills.catalog.changed', {
      reason: 'metadata-updated',
      name: metadata.name,
      skill: metadata,
      version: Date.now()
    })
  }

  private async handleSkillFileAdded(filePath: string): Promise<void> {
    const metadata = await this.parseSkillMetadata(filePath, path.basename(path.dirname(filePath)))
    if (!metadata) {
      return
    }

    const existingMetadata = this.metadataCache.get(metadata.name)
    if (existingMetadata && existingMetadata.path !== metadata.path) {
      logger.warn('[SkillPresenter] Duplicate skill name discovered. Keeping the first entry.', {
        name: metadata.name,
        path: metadata.path,
        existingPath: existingMetadata.path
      })
      return
    }

    this.metadataCache.set(metadata.name, metadata)
    publishDeepchatEvent('skills.catalog.changed', {
      reason: 'installed',
      name: metadata.name,
      skill: metadata,
      version: Date.now()
    })
  }

  private handleSkillFileDeleted(filePath: string): void {
    const skillName = this.findSkillNameByPath(filePath) ?? path.basename(path.dirname(filePath))
    this.metadataCache.delete(skillName)
    this.contentCache.delete(skillName)
    publishDeepchatEvent('skills.catalog.changed', {
      reason: 'uninstalled',
      name: skillName,
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
      // Skip symbolic links to prevent infinite recursion
      if (entry.isSymbolicLink() || entry.name === SKILL_CONFIG.SIDECAR_DIR) {
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
    await this.stopWatching()
    this.metadataCache.clear()
    this.contentCache.clear()
    this.discoveryPromise = null
    this.initialized = false
  }

  private shouldIgnoreSkillsRootEntry(entryName: string): boolean {
    return (
      entryName === SKILL_CONFIG.SIDECAR_DIR ||
      entryName.includes('.backup-') ||
      entryName.startsWith('.')
    )
  }

  private getSidecarPath(name: string): string {
    return path.join(this.sidecarDir, `${name}.json`)
  }

  private deleteSkillManagementItem(name: string): void {
    const state = this.getStoredManagementState()
    if (state.skills[name]) {
      delete state.skills[name]
      this.saveManagementState(state)
    }
  }

  private async collectScriptDescriptors(
    currentDir: string,
    skillRoot: string,
    acc: SkillScriptDescriptor[] = []
  ): Promise<SkillScriptDescriptor[]> {
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

      acc.push({
        name: entry.name,
        relativePath: path.relative(skillRoot, fullPath),
        absolutePath: fullPath,
        runtime,
        enabled: true
      })
    }

    return acc
  }

  private collectSkillManifestPaths(
    currentDir: string,
    depth: number = 0,
    acc: string[] = []
  ): string[] {
    if (depth > SKILL_CONFIG.FOLDER_TREE_MAX_DEPTH) {
      return acc
    }

    let entries: fs.Dirent[]
    try {
      entries = fs.readdirSync(currentDir, { withFileTypes: true })
    } catch (error) {
      logger.warn('[SkillPresenter] Failed to scan skill directory, skipping subtree', {
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
        this.collectSkillManifestPaths(fullPath, depth + 1, acc)
        continue
      }

      if (entry.name === 'SKILL.md') {
        acc.push(fullPath)
      }
    }

    return acc
  }

  private deriveSkillCategory(skillRoot: string): string | null {
    const pluginContribution = this.getPluginContributionForSkillRoot(skillRoot)
    if (pluginContribution) {
      return `plugin/${pluginContribution.ownerPluginId}`
    }

    const relative = path.relative(this.skillsDir, skillRoot)
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
      await this.collectLinkedFiles(targetDir, skillRoot, kind, linkedFiles)
    }

    return linkedFiles.sort((left, right) => left.path.localeCompare(right.path))
  }

  private async collectLinkedFiles(
    currentDir: string,
    skillRoot: string,
    kind: SkillLinkedFile['kind'],
    acc: SkillLinkedFile[]
  ): Promise<void> {
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

      acc.push({
        path: path.relative(skillRoot, fullPath),
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

  private findSkillNameByPath(skillPath: string): string | null {
    for (const metadata of this.metadataCache.values()) {
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
        `[SkillPresenter] Failed to read persisted active skills for ${conversationId}:`,
        error
      )
      return []
    }
  }

  private setPersistedNewSessionSkills(conversationId: string, skills: string[]): void {
    this.sessionStatePort.setPersistedNewSessionSkills(conversationId, skills)
  }
}
