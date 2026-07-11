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
  type WatchEventType,
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
  SkillLinkedFile,
  PublishedSkillEntry,
  PublishedSkillSourceError,
  SkillRuntimeSnapshot,
  WaitForStableSkillRuntimeOptions,
  PersistedSkillPinsReadError
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
import {
  createQuarantinedEntry,
  createMetadataOnlyEntry,
  createSkillSourceVersion,
  freezeScriptDescriptors,
  freezeSkillExtension,
  freezeSkillMetadata,
  SkillRuntimeSnapshotCoordinator,
  withPublishedSourceError
} from './runtimeSnapshot'

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
const SKILL_MANAGEMENT_STATE_KEY = 'skills.managementState'
const SKILL_RUNTIME_WAIT_BUDGET_MS = 200
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
  private runtimeContentViews = new WeakMap<PublishedSkillEntry, SkillContent>()
  private readonly runtimeSnapshots = new SkillRuntimeSnapshotCoordinator({
    stageEntry: (metadata) => this.stagePublishedSkillEntry(metadata),
    onPublished: (entries) => this.syncCompatibilityCaches(entries),
    onStageError: (metadata, error) => {
      logger.warn('[SkillPresenter] Failed to stage skill runtime source.', {
        name: metadata.name,
        path: metadata.path,
        error
      })
    }
  })
  private runtimeSnapshotReadDepth = 0
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

  getPublishedRuntimeSnapshot(): SkillRuntimeSnapshot {
    return this.runtimeSnapshots.snapshot
  }

  async waitForStableRuntimeSnapshot(
    options: WaitForStableSkillRuntimeOptions
  ): Promise<SkillRuntimeSnapshot> {
    this.seedRuntimeSnapshotFromCompatibilityCache()
    return await this.runtimeSnapshots.wait(options)
  }

  private seedRuntimeSnapshotFromCompatibilityCache(): void {
    this.runtimeSnapshots.seedFromMetadata(this.metadataCache.values())
  }

  private beginRuntimePublish(): () => void {
    return this.runtimeSnapshots.beginPublish()
  }

  private beginRuntimePublishIfCurrent(sourcePath: string, sequence: number): (() => void) | null {
    return this.runtimeSnapshots.beginPublishIfCurrent(sourcePath, sequence)
  }

  private publishRuntimeEntry(entry: PublishedSkillEntry, previousName?: string): void {
    this.runtimeSnapshots.publishEntry(entry, previousName)
  }

  private publishRuntimeEntryIfCurrent(
    sourcePath: string,
    sequence: number,
    entry: PublishedSkillEntry,
    previousName?: string
  ): boolean {
    return this.runtimeSnapshots.publishEntryIfCurrent(sourcePath, sequence, entry, previousName)
  }

  private publishRuntimeSourceError(
    name: string,
    error: { code: string; message: string },
    sourcePath?: string
  ): void {
    this.runtimeSnapshots.publishSourceError(name, error, sourcePath)
  }

  private publishRuntimeSourceErrorIfCurrent(
    sourcePath: string,
    sequence: number,
    name: string,
    error: { code: string; message: string }
  ): boolean {
    return this.runtimeSnapshots.publishSourceErrorIfCurrent(sourcePath, sequence, name, error)
  }

  private syncCompatibilityCaches(entries: ReadonlyMap<string, PublishedSkillEntry>): void {
    this.metadataCache.clear()
    this.contentCache.clear()
    for (const [name, entry] of entries) {
      if (entry.availability === 'quarantined') continue
      this.metadataCache.set(name, entry.metadata as SkillMetadata)
      if (entry.availability === 'ready' && entry.renderedContent !== undefined) {
        this.contentCache.set(name, this.getRuntimeContentView(entry))
      }
    }
  }

  private getRuntimeContentView(entry: PublishedSkillEntry): SkillContent {
    const cached = this.runtimeContentViews.get(entry)
    if (cached) return cached
    const content = Object.freeze({
      name: entry.metadata.name,
      content: entry.renderedContent ?? ''
    })
    this.runtimeContentViews.set(entry, content)
    return content
  }

  private async stagePublishedSkillEntry(
    metadataHint: SkillMetadata,
    options: {
      rawContent?: string
      extension?: SkillExtensionConfig
      scriptSourceRoot?: string
    } = {}
  ): Promise<PublishedSkillEntry | null> {
    this.assertSourceReadAllowed()
    let rawContent = options.rawContent
    if (rawContent === undefined) {
      const stats = await fs.promises.stat(metadataHint.path)
      if (stats.size > SKILL_CONFIG.SKILL_FILE_MAX_SIZE) {
        throw new Error(
          `Skill file too large: ${stats.size} bytes (max: ${SKILL_CONFIG.SKILL_FILE_MAX_SIZE})`
        )
      }
      rawContent = await fs.promises.readFile(metadataHint.path, 'utf-8')
    }

    const parsed = this.parseSkillMetadataFromContent(
      rawContent,
      metadataHint.path,
      path.basename(metadataHint.skillRoot),
      metadataHint.ownerPluginId
    )
    if (!parsed) {
      return null
    }

    const extension = sanitizeSkillExtensionConfig(
      options.extension ?? (await this.loadSkillExtensionForStage(parsed.name))
    )
    const scriptSourceRoot = options.scriptSourceRoot ?? parsed.skillRoot
    const scripts = await this.collectStagedScriptDescriptors(
      scriptSourceRoot,
      parsed.skillRoot,
      extension
    )
    const linkedFiles = await this.listSkillLinkedFiles(scriptSourceRoot)
    const parsedContent = matter(rawContent).content
    const renderedBody = this.replacePathVariables(parsedContent, parsed).trim()
    const runtimeInstructions = this.buildRuntimeInstructionsFromScripts(parsed, scripts)
    const renderedContent = [renderedBody, runtimeInstructions].filter(Boolean).join('\n\n')
    const pluginContribution = this.getPluginContributionForSkillRoot(parsed.skillRoot)
    const frozenMetadata = freezeSkillMetadata(parsed)
    const frozenExtension = freezeSkillExtension(extension)
    const frozenScripts = freezeScriptDescriptors(scripts)
    const frozenLinkedFiles = Object.freeze(
      linkedFiles.map((linkedFile) => Object.freeze({ ...linkedFile }))
    )
    const allowedTools = Object.freeze([...(frozenMetadata.allowedTools ?? [])])
    const sourceVersion = createSkillSourceVersion({
      rawContent,
      extension: frozenExtension,
      scripts: frozenScripts.map(({ relativePath, runtime, enabled, description }) => ({
        relativePath,
        runtime,
        enabled,
        description
      })),
      linkedFiles: frozenLinkedFiles,
      skillRoot: parsed.skillRoot,
      skillsDir: this.skillsDir,
      pluginRoot: pluginContribution?.pluginRoot ?? null,
      ownerPluginId: parsed.ownerPluginId ?? pluginContribution?.ownerPluginId ?? null,
      processArch: process.arch
    })

    return Object.freeze({
      sourceVersion,
      availability: 'ready' as const,
      metadata: frozenMetadata,
      renderedContent,
      allowedTools,
      extension: frozenExtension,
      scripts: frozenScripts,
      linkedFiles: frozenLinkedFiles
    })
  }

  private async collectStagedScriptDescriptors(
    sourceRoot: string,
    publishedRoot: string,
    extension: SkillExtensionConfig
  ): Promise<SkillScriptDescriptor[]> {
    const scriptsDir = path.join(sourceRoot, 'scripts')
    if (!(await this.pathExists(scriptsDir))) {
      return []
    }
    const descriptors = await this.collectScriptDescriptors(scriptsDir, sourceRoot)
    return descriptors
      .map((script) => {
        const override = extension.scriptOverrides[script.relativePath] ?? {}
        return {
          ...script,
          absolutePath: path.join(publishedRoot, script.relativePath),
          enabled: override.enabled ?? true,
          description: override.description
        }
      })
      .sort((left, right) => left.relativePath.localeCompare(right.relativePath))
  }

  private assertSourceReadAllowed(): void {
    if (this.runtimeSnapshotReadDepth > 0) {
      throw new Error('Skill source disk read attempted inside a published runtime snapshot read')
    }
  }

  private readCapturedRuntimeSnapshot<T>(reader: (snapshot: SkillRuntimeSnapshot) => T): T {
    this.runtimeSnapshotReadDepth += 1
    try {
      return reader(this.runtimeSnapshots.snapshot)
    } finally {
      this.runtimeSnapshotReadDepth -= 1
    }
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
    const discoveryObservation = this.runtimeSnapshots.beginCatalogObservation()
    if (!fs.existsSync(this.skillsDir)) {
      this.runtimeSnapshots.replaceIfCatalogCurrent(discoveryObservation, new Map())
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

    const previousEntries = this.runtimeSnapshots.snapshot.entries
    const nextEntries = new Map<string, PublishedSkillEntry>()
    const observedPaths = new Set<string>()
    for (const metadata of [
      ...discoveredSkills,
      ...(await this.discoverPluginSkillsOnMainThread())
    ]) {
      observedPaths.add(metadata.path)
      if (nextEntries.has(metadata.name)) {
        logger.warn('[SkillPresenter] Duplicate skill name discovered. Keeping the first entry.', {
          name: metadata.name,
          path: metadata.path
        })
        continue
      }
      const previous = previousEntries.get(metadata.name)
      if (previous?.availability === 'ready' && previous.metadata.path === metadata.path) {
        try {
          const staged = await this.stagePublishedSkillEntry(metadata)
          if (staged) {
            nextEntries.set(staged.metadata.name, staged)
            continue
          }
        } catch (error) {
          logger.warn('[SkillPresenter] Failed to refresh a ready skill during discovery.', {
            name: metadata.name,
            path: metadata.path,
            error
          })
        }
        nextEntries.set(
          metadata.name,
          withPublishedSourceError(previous, {
            code: 'DISCOVERY_REFRESH_FAILED',
            message: 'Skill discovery could not refresh the source'
          })
        )
        continue
      }
      nextEntries.set(metadata.name, createMetadataOnlyEntry(metadata))
    }

    for (const [name, previous] of previousEntries) {
      if (nextEntries.has(name) || observedPaths.has(previous.metadata.path)) {
        continue
      }
      const pluginStillRegistered = previous.metadata.ownerPluginId
        ? Array.from(this.pluginSkillContributions.values()).some(
            (contribution) =>
              contribution.ownerPluginId === previous.metadata.ownerPluginId &&
              path.join(contribution.skillRoot, 'SKILL.md') === previous.metadata.path
          )
        : true
      if (pluginStillRegistered && fs.existsSync(previous.metadata.path)) {
        nextEntries.set(
          name,
          withPublishedSourceError(previous, {
            code: 'INVALID_SOURCE',
            message: 'Skill source is invalid'
          })
        )
      }
    }

    if (!this.runtimeSnapshots.replaceIfCatalogCurrent(discoveryObservation, nextEntries)) {
      return this.getVisibleMetadataFromSnapshot(this.runtimeSnapshots.snapshot)
    }
    const skills = this.getVisibleMetadataFromSnapshot(this.runtimeSnapshots.snapshot)
    publishDeepchatEvent('skills.catalog.changed', {
      reason: 'discovered',
      skills,
      version: Date.now()
    })

    return skills
  }

  private async discoverSkillsOnMainThread(): Promise<SkillMetadata[]> {
    const discovered = new Map<string, SkillMetadata>()
    const skillManifestPaths = (await this.collectSkillManifestPaths(this.skillsDir)).sort(
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
      return this.parseSkillMetadataFromContent(content, skillPath, dirName, ownerPluginId)
    } catch (error) {
      console.error(`[SkillPresenter] Error parsing skill metadata at ${skillPath}:`, error)
      return null
    }
  }

  private parseSkillMetadataFromContent(
    content: string,
    skillPath: string,
    dirName: string,
    ownerPluginId?: string
  ): SkillMetadata | null {
    try {
      const { data } = matter(content)
      if (!data.name || !data.description) {
        console.warn(`[SkillPresenter] Skill ${dirName} missing required frontmatter fields`)
        return null
      }
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
          ? data.allowedTools.filter((tool): tool is string => typeof tool === 'string')
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
    this.seedRuntimeSnapshotFromCompatibilityCache()
    if (this.runtimeSnapshots.snapshot.entries.size === 0) {
      if (!this.discoveryPromise) {
        this.discoveryPromise = this.discoverSkills().finally(() => {
          this.discoveryPromise = null
        })
      }
      await this.discoveryPromise
    }
    return this.readCapturedRuntimeSnapshot((snapshot) =>
      this.getVisibleMetadataFromSnapshot(snapshot)
    )
  }

  private getVisibleMetadataFromSnapshot(snapshot: SkillRuntimeSnapshot): SkillMetadata[] {
    return this.sortSkillMetadata(
      Array.from(snapshot.entries.values())
        .filter((entry) => entry.availability !== 'quarantined')
        .map((entry) => entry.metadata as SkillMetadata)
        .filter((skill) => this.isSkillVisible(skill))
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
    await this.getMetadataList()
    const metadata = this.runtimeSnapshots.snapshot.entries.get(name)?.metadata
    if (!metadata) {
      throw new Error(`Skill "${name}" not found`)
    }

    const endPublish = this.beginRuntimePublish()
    try {
      this.updateSkillManagementItem(name, (item) => ({
        ...item,
        canonicalPath: metadata.skillRoot,
        deepchat: {
          ...item.deepchat,
          disabled
        }
      }))
    } finally {
      endPublish()
    }
    publishDeepchatEvent('skills.catalog.changed', {
      reason: 'disabled-updated',
      name,
      version: Date.now()
    })
  }

  async getUnifiedSkillCatalog(): Promise<UnifiedSkillItem[]> {
    await this.getMetadataList()

    const state = this.getStoredManagementState()
    const metadata = this.readCapturedRuntimeSnapshot((snapshot) =>
      Array.from(snapshot.entries.values())
        .filter((entry) => entry.availability !== 'quarantined')
        .map((entry) => entry.metadata as SkillMetadata)
    )
    return this.sortSkillMetadata(metadata).map((skill) => {
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
    await this.getMetadataList()
    const snapshot = await this.waitForStableRuntimeSnapshot({
      requiredSkillNames: [name],
      signal: new AbortController().signal,
      deadlineAt: Date.now() + SKILL_RUNTIME_WAIT_BUDGET_MS
    })
    const entry = snapshot.entries.get(name)
    if (
      !entry ||
      entry.availability !== 'ready' ||
      entry.renderedContent === undefined ||
      !this.isSkillVisible(entry.metadata as SkillMetadata)
    ) {
      console.warn(`[SkillPresenter] Skill not found: ${name}`)
      return null
    }
    this.runtimeSnapshotReadDepth += 1
    try {
      return this.getRuntimeContentView(entry)
    } finally {
      this.runtimeSnapshotReadDepth -= 1
    }
  }

  async viewSkill(
    name: string,
    options?: {
      filePath?: string
      conversationId?: string
    }
  ): Promise<SkillViewResult> {
    await this.getMetadataList()
    const metadata = this.runtimeSnapshots.snapshot.entries.get(name)?.metadata as
      | SkillMetadata
      | undefined
    if (!metadata || !this.isSkillVisible(metadata)) {
      return {
        success: false,
        error: `Skill "${name}" not found`
      }
    }

    const requestedFilePath = options?.filePath?.trim()
    const requestedPath = requestedFilePath
      ? this.resolveSkillRelativePath(metadata.skillRoot, requestedFilePath)
      : metadata.path
    const isRootView =
      requestedPath !== null && path.resolve(requestedPath) === path.resolve(metadata.path)

    if (requestedFilePath && !isRootView) {
      try {
        if (!requestedPath) {
          return {
            success: false,
            error: 'Requested skill file is outside the skill root'
          }
        }

        if (!(await this.pathExists(requestedPath))) {
          return {
            success: false,
            error: `Skill file not found: ${requestedFilePath}`
          }
        }

        const stats = await fs.promises.stat(requestedPath)
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
        if (this.isBinaryLikeFile(requestedPath)) {
          return {
            success: false,
            error: 'Binary skill files cannot be loaded with skill_view'
          }
        }

        const pinnedSkills = options?.conversationId
          ? await this.getActiveSkills(options.conversationId)
          : []
        return {
          success: true,
          name: metadata.name,
          category: metadata.category ?? null,
          skillRoot: metadata.skillRoot,
          filePath: path.relative(metadata.skillRoot, requestedPath),
          content: await fs.promises.readFile(requestedPath, 'utf-8'),
          platforms: metadata.platforms,
          metadata: metadata.metadata,
          isPinned: pinnedSkills.includes(metadata.name)
        }
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error)
        console.error('[SkillPresenter] Failed to load requested skill file for skill_view:', {
          name: metadata.name,
          filePath: requestedFilePath,
          error
        })
        return {
          success: false,
          error: `Failed to load requested skill file: ${errorMessage}`
        }
      }
    }

    const snapshot = await this.waitForStableRuntimeSnapshot({
      requiredSkillNames: [name],
      signal: new AbortController().signal,
      deadlineAt: Date.now() + SKILL_RUNTIME_WAIT_BUDGET_MS
    })
    const entry = snapshot.entries.get(name)
    if (
      !entry ||
      entry.availability !== 'ready' ||
      entry.renderedContent === undefined ||
      !this.isSkillVisible(entry.metadata as SkillMetadata)
    ) {
      return {
        success: false,
        error: `Skill "${name}" not found`
      }
    }

    const pinnedSkills = options?.conversationId
      ? await this.getActiveSkills(options.conversationId)
      : []
    const capturedMetadata = entry.metadata as SkillMetadata
    this.runtimeSnapshotReadDepth += 1
    try {
      return {
        success: true,
        name: capturedMetadata.name,
        category: capturedMetadata.category ?? null,
        skillRoot: capturedMetadata.skillRoot,
        filePath: null,
        content: entry.renderedContent,
        platforms: capturedMetadata.platforms,
        metadata: capturedMetadata.metadata,
        linkedFiles: (entry.linkedFiles ?? []).map((linkedFile) => ({ ...linkedFile })),
        isPinned: pinnedSkills.includes(capturedMetadata.name)
      }
    } finally {
      this.runtimeSnapshotReadDepth -= 1
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

  private buildRuntimeInstructionsFromScripts(
    metadata: SkillMetadata,
    stagedScripts: readonly SkillScriptDescriptor[]
  ): string {
    const scripts = stagedScripts.filter((script) => script.enabled)
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

    const contribution = {
      ownerPluginId: input.ownerPluginId,
      skillRoot,
      pluginRoot: input.pluginRoot ? path.resolve(input.pluginRoot) : undefined
    }
    this.pluginSkillContributions.set(`${input.ownerPluginId}:${input.id}`, contribution)
    await this.discoverSkills()
    await this.ensurePluginContributionPublished(contribution)
  }

  private async ensurePluginContributionPublished(contribution: {
    ownerPluginId: string
    skillRoot: string
    pluginRoot?: string
  }): Promise<void> {
    const skillPath = path.join(contribution.skillRoot, 'SKILL.md')
    for (let attempt = 0; attempt < 2; attempt += 1) {
      const sequence = this.runtimeSnapshots.nextObservation(skillPath)
      const metadata = await this.parseSkillMetadata(
        skillPath,
        path.basename(contribution.skillRoot),
        contribution.ownerPluginId
      )
      if (!metadata) {
        throw new Error(`Plugin skill at "${contribution.skillRoot}" is invalid`)
      }
      const candidate = await this.stagePublishedSkillEntry(metadata)
      if (!candidate) {
        throw new Error(`Plugin skill at "${contribution.skillRoot}" is invalid`)
      }

      const conflict = this.runtimeSnapshots.snapshot.entries.get(candidate.metadata.name)
      if (conflict && conflict.metadata.path !== skillPath) {
        throw new Error(`Plugin skill name "${candidate.metadata.name}" is already registered`)
      }
      const current = Array.from(this.runtimeSnapshots.snapshot.entries.values()).find(
        (entry) =>
          entry.metadata.path === skillPath &&
          entry.metadata.ownerPluginId === contribution.ownerPluginId
      )
      if (
        current?.sourceVersion === candidate.sourceVersion &&
        this.runtimeSnapshots.isCurrentObservation(skillPath, sequence)
      ) {
        return
      }

      const previousName = Array.from(this.runtimeSnapshots.snapshot.entries.entries()).find(
        ([, entry]) => entry.metadata.path === skillPath
      )?.[0]
      if (this.publishRuntimeEntryIfCurrent(skillPath, sequence, candidate, previousName)) {
        publishDeepchatEvent('skills.catalog.changed', {
          reason: 'installed',
          name: candidate.metadata.name,
          skill: candidate.metadata,
          version: Date.now()
        })
        return
      }
    }

    throw new Error(`Plugin skill at "${contribution.skillRoot}" changed during registration`)
  }

  async registerAdoptedSkill(input: SkillAdoptionRegistration): Promise<void> {
    const skillRoot = path.resolve(input.canonicalPath)
    const metadata = await this.parseSkillMetadata(path.join(skillRoot, 'SKILL.md'), input.name)
    if (!metadata || metadata.name !== input.name) {
      throw new Error(`Adopted skill "${input.name}" is invalid`)
    }
    const sequence = this.runtimeSnapshots.nextObservation(metadata.path)
    const candidate = await this.stagePublishedSkillEntry(metadata)
    if (!candidate) {
      throw new Error(`Adopted skill "${input.name}" is invalid`)
    }

    const previousState = this.getStoredManagementState()
    const endPublish = this.beginRuntimePublishIfCurrent(metadata.path, sequence)
    if (!endPublish) {
      throw new Error(`Adopted skill "${input.name}" changed while registration was staged`)
    }
    try {
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
      this.publishRuntimeEntry(candidate)
    } catch (error) {
      this.saveManagementState(previousState)
      throw error
    } finally {
      endPublish()
    }

    publishDeepchatEvent('skills.catalog.changed', {
      reason: 'installed',
      name: input.name,
      skill: metadata,
      version: Date.now()
    })
  }

  async registerAgentSkillLink(input: SkillAgentLinkRegistration): Promise<void> {
    await this.getMetadataList()
    const metadata = this.runtimeSnapshots.snapshot.entries.get(input.skillName)?.metadata
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
    const removedContributions: Array<{
      ownerPluginId: string
      skillRoot: string
      pluginRoot?: string
    }> = []
    for (const [key, contribution] of this.pluginSkillContributions.entries()) {
      if (contribution.ownerPluginId === ownerPluginId) {
        removedContributions.push(contribution)
        this.pluginSkillContributions.delete(key)
      }
    }

    if (removedContributions.length === 0) return
    await this.discoverSkills()

    let removedPublishedEntry = false
    for (const contribution of removedContributions) {
      const skillPath = path.join(contribution.skillRoot, 'SKILL.md')
      const sequence = this.runtimeSnapshots.nextObservation(skillPath)
      const names = Array.from(this.runtimeSnapshots.snapshot.entries.entries())
        .filter(
          ([, entry]) =>
            entry.metadata.path === skillPath && entry.metadata.ownerPluginId === ownerPluginId
        )
        .map(([name]) => name)
      for (const name of names) {
        if (!this.runtimeSnapshots.removeIfCurrent(skillPath, sequence, name)) {
          throw new Error(`Plugin skill "${name}" changed during unregistration`)
        }
        removedPublishedEntry = true
      }
    }

    if (removedPublishedEntry) {
      publishDeepchatEvent('skills.catalog.changed', {
        reason: 'uninstalled',
        ownerPluginId,
        version: Date.now()
      })
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

      const targetExists = fs.existsSync(resolvedTarget)
      if (targetExists && !options?.overwrite) {
        return {
          success: false,
          error: `Skill "${finalSkillName}" already exists`,
          errorCode: 'conflict',
          existingSkillName: finalSkillName
        }
      }

      const stagingDir = path.join(
        this.skillsDir,
        `.${finalSkillName}.install-${process.pid}-${randomUUID()}`
      )
      this.copyDirectory(resolvedSource, stagingDir)
      if (finalSkillName !== skillName) {
        this.rewriteSkillManifestName(stagingDir, finalSkillName)
      }
      const stagedContent = fs.readFileSync(path.join(stagingDir, 'SKILL.md'), 'utf-8')
      const metadata = this.parseSkillMetadataFromContent(
        stagedContent,
        path.join(resolvedTarget, 'SKILL.md'),
        finalSkillName
      )
      if (!metadata) {
        fs.rmSync(stagingDir, { recursive: true, force: true })
        return { success: false, error: 'Staged skill is invalid', errorCode: 'invalid_skill' }
      }
      const sequence = this.runtimeSnapshots.nextObservation(metadata.path)
      const candidate = await this.stagePublishedSkillEntry(metadata, {
        rawContent: stagedContent,
        scriptSourceRoot: stagingDir
      })
      if (!candidate || candidate.metadata.name !== finalSkillName) {
        fs.rmSync(stagingDir, { recursive: true, force: true })
        return { success: false, error: 'Staged skill is invalid', errorCode: 'invalid_skill' }
      }

      this.seedRuntimeSnapshotFromCompatibilityCache()
      const previousEntry = this.runtimeSnapshots.snapshot.entries.get(finalSkillName)
      const previousState = this.getStoredManagementState()
      const endPublish = this.beginRuntimePublishIfCurrent(metadata.path, sequence)
      if (!endPublish) {
        fs.rmSync(stagingDir, { recursive: true, force: true })
        return {
          success: false,
          error: `Skill "${finalSkillName}" changed while installation was staged`,
          errorCode: 'conflict'
        }
      }
      let backupDir: string | null = null
      let retiredTargetDir: string | null = null
      let installedTarget = false
      try {
        if (targetExists) {
          if (fs.existsSync(path.join(resolvedTarget, 'SKILL.md'))) {
            backupDir = this.backupExistingSkill(finalSkillName)
          } else {
            retiredTargetDir = path.join(
              this.skillsDir,
              `.${finalSkillName}.replaced-${process.pid}-${randomUUID()}`
            )
            fs.renameSync(resolvedTarget, retiredTargetDir)
          }
        }
        fs.renameSync(stagingDir, resolvedTarget)
        installedTarget = true
        this.updateSkillManagementItem(finalSkillName, (item) => ({
          ...item,
          canonicalPath: resolvedTarget,
          source: {
            type: sourceType,
            installedAt: new Date().toISOString(),
            ...sourcePatch
          }
        }))
        this.publishRuntimeEntry(candidate)
      } catch (error) {
        let rollbackFailed = false
        try {
          if (installedTarget) {
            fs.rmSync(resolvedTarget, { recursive: true, force: true })
          }
          if (backupDir) {
            fs.renameSync(backupDir, resolvedTarget)
          } else if (retiredTargetDir) {
            fs.renameSync(retiredTargetDir, resolvedTarget)
          }
          this.saveManagementState(previousState)
          if (previousEntry) {
            this.publishRuntimeSourceError(finalSkillName, {
              code: 'MUTATION_ROLLED_BACK',
              message: error instanceof Error ? error.message : String(error)
            })
          }
        } catch (rollbackError) {
          rollbackFailed = true
          logger.warn('[SkillPresenter] Failed to rollback skill installation.', {
            name: finalSkillName,
            error,
            rollbackError
          })
          await this.reconcileUnknownSkillSource(finalSkillName, metadata, previousEntry)
        }
        const failure = this.createTargetOperationFailure(
          finalSkillName,
          resolvedTarget,
          'replace',
          error
        )
        if (rollbackFailed) {
          failure.error = `${failure.error} (rollback failed)`
        }
        return failure
      } finally {
        endPublish()
        if (fs.existsSync(stagingDir)) {
          fs.rmSync(stagingDir, { recursive: true, force: true })
        }
      }
      if (retiredTargetDir) {
        fs.rmSync(retiredTargetDir, { recursive: true, force: true })
      }

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
    this.seedRuntimeSnapshotFromCompatibilityCache()
    const previousEntry = this.runtimeSnapshots.snapshot.entries.get(name)
    const previousState = this.getStoredManagementState()
    const skillDir = path.join(this.skillsDir, name)
    const trashDir = path.join(this.skillsDir, `.${name}.uninstall-${process.pid}-${randomUUID()}`)
    const sourcePath = previousEntry?.metadata.path ?? path.join(skillDir, 'SKILL.md')
    const sequence = this.runtimeSnapshots.nextObservation(sourcePath)
    try {
      if (!fs.existsSync(skillDir)) {
        if (!previousEntry) {
          if (previousState.skills[name]) this.cleanupUninstalledSkillManagementState(name)
          return { success: false, error: `Skill "${name}" not found`, errorCode: 'not_found' }
        }

        const endPublish = this.beginRuntimePublishIfCurrent(sourcePath, sequence)
        if (!endPublish) {
          return { success: false, error: `Skill "${name}" changed before cleanup` }
        }
        try {
          this.cleanupUninstalledSkillState(name, sourcePath, sequence)
        } finally {
          endPublish()
        }
        return { success: false, error: `Skill "${name}" not found`, errorCode: 'not_found' }
      }

      const endPublish = this.beginRuntimePublishIfCurrent(sourcePath, sequence)
      if (!endPublish) {
        return { success: false, error: `Skill "${name}" changed before uninstall` }
      }
      try {
        fs.renameSync(skillDir, trashDir)
        this.cleanupUninstalledSkillState(name, sourcePath, sequence)
      } catch (error) {
        try {
          if (fs.existsSync(trashDir)) {
            fs.renameSync(trashDir, skillDir)
          }
          this.saveManagementState(previousState)
          if (previousEntry) {
            this.publishRuntimeEntry(previousEntry)
          }
        } catch (rollbackError) {
          logger.warn('[SkillPresenter] Failed to rollback skill uninstall.', {
            name,
            error,
            rollbackError
          })
          if (previousEntry) {
            this.publishRuntimeEntry(
              withPublishedSourceError(previousEntry, {
                code: 'RECONCILE_REQUIRED',
                message: 'Skill source requires reconciliation'
              })
            )
          }
        }
        return this.createTargetOperationFailure(name, skillDir, 'remove', error)
      } finally {
        endPublish()
      }

      try {
        fs.rmSync(trashDir, { recursive: true, force: true })
      } catch (error) {
        logger.warn('[SkillPresenter] Failed to remove retired skill directory.', {
          name,
          path: trashDir,
          error
        })
      }

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

  private cleanupUninstalledSkillState(name: string, sourcePath: string, sequence: number): void {
    if (!this.runtimeSnapshots.isCurrentObservation(sourcePath, sequence)) {
      throw new Error(`Skill "${name}" changed before cleanup`)
    }
    this.cleanupUninstalledSkillManagementState(name)

    if (this.runtimeSnapshots.snapshot.entries.has(name)) {
      if (!this.runtimeSnapshots.removeIfCurrent(sourcePath, sequence, name)) {
        throw new Error(`Skill "${name}" changed before cleanup`)
      }
    }
  }

  private cleanupUninstalledSkillManagementState(name: string): void {
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
  }

  private isSafeSkillName(name: string): boolean {
    return SKILL_NAME_PATTERN.test(name) && !name.includes('/') && !name.includes('\\')
  }

  /**
   * Update a skill's SKILL.md content
   */
  async updateSkillFile(name: string, content: string): Promise<SkillInstallResult> {
    await this.getMetadataList()
    const previousEntry = this.runtimeSnapshots.snapshot.entries.get(name)
    const metadata = previousEntry?.metadata as SkillMetadata | undefined
    if (!metadata) {
      return { success: false, error: `Skill "${name}" not found` }
    }

    const sequence = this.runtimeSnapshots.nextObservation(metadata.path)
    const candidate = await this.stagePublishedSkillEntry(metadata, { rawContent: content })
    if (!candidate || candidate.metadata.name !== name) {
      return { success: false, error: `Skill "${name}" content is invalid` }
    }

    const previousContent = await this.readSkillFile(name)
    const endPublish = this.beginRuntimePublishIfCurrent(metadata.path, sequence)
    if (!endPublish) {
      return { success: false, error: `Skill "${name}" changed while the update was staged` }
    }
    let wroteSource = false
    try {
      this.atomicWriteFile(metadata.path, content)
      wroteSource = true
      this.publishRuntimeEntry(candidate)
      return { success: true, skillName: name }
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error)
      let rollbackError: unknown
      if (wroteSource) {
        try {
          this.atomicWriteFile(metadata.path, previousContent)
          this.publishRuntimeSourceError(name, {
            code: 'MUTATION_ROLLED_BACK',
            message: errorMsg
          })
        } catch (rollbackFailure) {
          rollbackError = rollbackFailure
          await this.reconcileUnknownSkillSource(name, metadata, previousEntry)
        }
      }
      const rollbackMessage = rollbackError
        ? ` (rollback failed: ${rollbackError instanceof Error ? rollbackError.message : String(rollbackError)})`
        : ''
      return { success: false, error: `${errorMsg}${rollbackMessage}` }
    } finally {
      endPublish()
    }
  }

  async saveSkillWithExtension(
    name: string,
    content: string,
    config: SkillExtensionConfig
  ): Promise<SkillInstallResult> {
    this.ensureSkillsDir()
    await this.getMetadataList()
    const previousEntry = this.runtimeSnapshots.snapshot.entries.get(name)
    const metadata = previousEntry?.metadata as SkillMetadata | undefined
    if (!metadata) {
      return { success: false, error: `Skill "${name}" not found` }
    }

    const previousSkillContent = await this.readSkillFile(name)
    const previousState = this.getStoredManagementState()
    const sanitized = sanitizeSkillExtensionConfig(config)
    const sequence = this.runtimeSnapshots.nextObservation(metadata.path)
    const candidate = await this.stagePublishedSkillEntry(metadata, {
      rawContent: content,
      extension: sanitized
    })
    if (!candidate || candidate.metadata.name !== name) {
      return { success: false, error: `Skill "${name}" content is invalid` }
    }

    const endPublish = this.beginRuntimePublishIfCurrent(metadata.path, sequence)
    if (!endPublish) {
      return { success: false, error: `Skill "${name}" changed while the update was staged` }
    }
    let wroteSource = false
    try {
      this.atomicWriteFile(metadata.path, content)
      wroteSource = true
      this.updateSkillManagementItem(name, (item) => ({
        ...item,
        canonicalPath: metadata.skillRoot,
        extension: sanitized
      }))

      this.publishRuntimeEntry(candidate)
      return { success: true, skillName: name }
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error)
      let rollbackError: unknown
      try {
        if (wroteSource) {
          this.atomicWriteFile(metadata.path, previousSkillContent)
        }
        this.saveManagementState(previousState)
        this.publishRuntimeSourceError(name, {
          code: 'MUTATION_ROLLED_BACK',
          message: errorMsg
        })
      } catch (rollbackFailure) {
        rollbackError = rollbackFailure
        logger.warn('[SkillPresenter] Failed to rollback combined skill save', {
          name,
          error,
          rollbackError: rollbackFailure
        })
        await this.reconcileUnknownSkillSource(name, metadata, previousEntry)
      }
      const rollbackMessage = rollbackError
        ? ` (rollback failed: ${rollbackError instanceof Error ? rollbackError.message : String(rollbackError)})`
        : ''
      return { success: false, error: `${errorMsg}${rollbackMessage}` }
    } finally {
      endPublish()
    }
  }

  async readSkillFile(name: string): Promise<string> {
    await this.getMetadataList()
    const metadata = this.runtimeSnapshots.snapshot.entries.get(name)?.metadata
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

  private async reconcileUnknownSkillSource(
    name: string,
    metadata: SkillMetadata,
    previousEntry?: PublishedSkillEntry
  ): Promise<void> {
    const sequence = this.runtimeSnapshots.nextObservation(metadata.path)
    const reconcileError: PublishedSkillSourceError = {
      code: 'RECONCILE_REQUIRED',
      message: 'Skill source requires reconciliation'
    }
    let timer: ReturnType<typeof setTimeout> | undefined
    try {
      const staged = this.stagePublishedSkillEntry(metadata)
      const candidate = await Promise.race([
        staged,
        new Promise<null>((resolve) => {
          timer = setTimeout(() => resolve(null), SKILL_RUNTIME_WAIT_BUDGET_MS)
        })
      ])
      if (candidate && candidate.metadata.name === name) {
        this.publishRuntimeEntryIfCurrent(metadata.path, sequence, candidate)
        return
      }
    } catch (error) {
      logger.warn('[SkillPresenter] Immediate skill reconcile failed.', { name, error })
    } finally {
      if (timer) clearTimeout(timer)
    }

    if (!this.runtimeSnapshots.isCurrentObservation(metadata.path, sequence)) {
      return
    }

    if (previousEntry) {
      this.publishRuntimeEntryIfCurrent(
        metadata.path,
        sequence,
        withPublishedSourceError(previousEntry, reconcileError)
      )
      return
    }

    this.publishRuntimeEntryIfCurrent(
      metadata.path,
      sequence,
      createQuarantinedEntry(metadata, reconcileError)
    )
  }

  /**
   * Get folder tree for a skill
   */
  async getSkillFolderTree(name: string): Promise<SkillFolderNode[]> {
    await this.getMetadataList()
    const metadata = this.runtimeSnapshots.snapshot.entries.get(name)?.metadata
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
    await this.getMetadataList()
    if (this.runtimeSnapshots.snapshot.entries.has(name)) {
      const snapshot = await this.waitForStableRuntimeSnapshot({
        requiredSkillNames: [name],
        signal: new AbortController().signal,
        deadlineAt: Date.now() + SKILL_RUNTIME_WAIT_BUDGET_MS
      })
      const extension = snapshot.entries.get(name)?.extension
      if (extension) {
        return structuredClone(extension) as SkillExtensionConfig
      }
    }
    return await this.loadSkillExtensionForStage(name)
  }

  private async loadSkillExtensionForStage(name: string): Promise<SkillExtensionConfig> {
    this.assertSourceReadAllowed()
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
    await this.getMetadataList()
    const previousEntry = this.runtimeSnapshots.snapshot.entries.get(name)
    const metadata = previousEntry?.metadata as SkillMetadata | undefined
    if (!metadata) {
      throw new Error(`Skill "${name}" not found`)
    }

    const sanitized = sanitizeSkillExtensionConfig(config)
    const previousState = this.getStoredManagementState()
    const sequence = this.runtimeSnapshots.nextObservation(metadata.path)
    const candidate = await this.stagePublishedSkillEntry(metadata, { extension: sanitized })
    if (!candidate || candidate.metadata.name !== name) {
      throw new Error(`Skill "${name}" source is invalid`)
    }

    const endPublish = this.beginRuntimePublishIfCurrent(metadata.path, sequence)
    if (!endPublish) {
      throw new Error(`Skill "${name}" changed while the extension was staged`)
    }
    try {
      this.updateSkillManagementItem(name, (item) => ({
        ...item,
        canonicalPath: metadata.skillRoot,
        extension: sanitized
      }))
      this.publishRuntimeEntry(candidate)
    } catch (error) {
      try {
        this.saveManagementState(previousState)
        this.publishRuntimeSourceError(name, {
          code: 'MUTATION_ROLLED_BACK',
          message: error instanceof Error ? error.message : String(error)
        })
      } catch (rollbackError) {
        logger.warn('[SkillPresenter] Failed to rollback skill extension save.', {
          name,
          error,
          rollbackError
        })
        await this.reconcileUnknownSkillSource(name, metadata, previousEntry)
      }
      throw error
    } finally {
      endPublish()
    }
  }

  async listSkillScripts(name: string): Promise<SkillScriptDescriptor[]> {
    await this.getMetadataList()
    if (!this.runtimeSnapshots.snapshot.entries.has(name)) {
      return []
    }
    const snapshot = await this.waitForStableRuntimeSnapshot({
      requiredSkillNames: [name],
      signal: new AbortController().signal,
      deadlineAt: Date.now() + SKILL_RUNTIME_WAIT_BUDGET_MS
    })
    const entry = snapshot.entries.get(name)
    if (entry?.availability !== 'ready') {
      return []
    }
    this.runtimeSnapshotReadDepth += 1
    try {
      return (entry.scripts ?? []).map((script) => ({ ...script }))
    } finally {
      this.runtimeSnapshotReadDepth -= 1
    }
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
   * Get persisted skill pins without triggering catalog discovery.
   * Runtime callers validate these names against one bounded immutable snapshot.
   */
  async getPinnedActiveSkills(conversationId: string): Promise<string[]> {
    try {
      return this.sessionStatePort.getPersistedNewSessionSkills(conversationId)
    } catch (error) {
      throw new PersistedSkillPinsReadError(conversationId, error)
    }
  }

  /**
   * Get active skills for a conversation
   */
  async getActiveSkills(conversationId: string): Promise<string[]> {
    const skills = (await this.isNewAgentSession(conversationId))
      ? await this.loadNewSessionSkills(conversationId)
      : []
    const validSkills = await this.validateSkillNames(skills)
    if (!this.areSkillListsEqual(validSkills, skills)) {
      this.setPersistedNewSessionSkills(conversationId, validSkills)
    }
    return validSkills
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
    await this.getMetadataList()
    const activeSkills = activeSkillNamesOverride ?? (await this.getActiveSkills(conversationId))
    const snapshot = await this.waitForStableRuntimeSnapshot({
      requiredSkillNames: activeSkills,
      signal: new AbortController().signal,
      deadlineAt: Date.now() + SKILL_RUNTIME_WAIT_BUDGET_MS
    })
    const allowedTools: Set<string> = new Set()

    this.runtimeSnapshotReadDepth += 1
    try {
      for (const skillName of activeSkills) {
        const entry = snapshot.entries.get(skillName)
        if (
          entry?.availability === 'ready' &&
          this.isSkillVisible(entry.metadata as SkillMetadata)
        ) {
          entry.allowedTools.forEach((tool) => allowedTools.add(tool))
        }
      }
    } finally {
      this.runtimeSnapshotReadDepth -= 1
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
        if (event.type === 'create' || event.type === 'update' || event.type === 'delete') {
          await this.handlePublishedSkillAuxiliarySourceChanged(event.path, event.type)
        }
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
      !segments.slice(0, -1).some((segment) => this.shouldIgnoreSkillsRootEntry(segment)) &&
      segments.length - 1 <= SKILL_CONFIG.FOLDER_TREE_MAX_DEPTH
    )
  }

  private async handleSkillFileChanged(filePath: string): Promise<void> {
    this.seedRuntimeSnapshotFromCompatibilityCache()
    const previousName = this.findSkillNameByPath(filePath) ?? path.basename(path.dirname(filePath))
    const previousEntry = this.runtimeSnapshots.snapshot.entries.get(previousName)
    const hint =
      (previousEntry?.metadata as SkillMetadata | undefined) ??
      this.createStageMetadataHint(filePath, previousName)
    const sequence = this.runtimeSnapshots.nextObservation(filePath)
    let candidate: PublishedSkillEntry | null
    try {
      candidate = await this.stagePublishedSkillEntry(hint)
    } catch (error) {
      logger.warn('[SkillPresenter] Failed to stage watcher skill update.', {
        name: previousName,
        path: filePath,
        error
      })
      this.publishRuntimeSourceErrorIfCurrent(filePath, sequence, previousName, {
        code: 'SOURCE_READ_FAILED',
        message: 'Skill source could not be read'
      })
      return
    }
    if (!candidate) {
      this.publishRuntimeSourceErrorIfCurrent(filePath, sequence, previousName, {
        code: 'INVALID_SOURCE',
        message: 'Skill source is invalid'
      })
      return
    }

    const existingEntry = this.runtimeSnapshots.snapshot.entries.get(candidate.metadata.name)
    if (existingEntry && existingEntry.metadata.path !== candidate.metadata.path) {
      logger.warn('[SkillPresenter] Duplicate skill name discovered. Keeping the first entry.', {
        name: candidate.metadata.name,
        path: candidate.metadata.path,
        existingPath: existingEntry.metadata.path
      })
      this.publishRuntimeSourceErrorIfCurrent(filePath, sequence, previousName, {
        code: 'DUPLICATE_SKILL_NAME',
        message: 'Skill source conflicts with an existing skill name'
      })
      return
    }

    if (!this.publishRuntimeEntryIfCurrent(filePath, sequence, candidate, previousName)) return
    this.runtimeSnapshots.deleteDiagnostic(filePath)
    publishDeepchatEvent('skills.catalog.changed', {
      reason: 'metadata-updated',
      name: candidate.metadata.name,
      skill: candidate.metadata,
      version: Date.now()
    })
  }

  private async handleSkillFileAdded(filePath: string): Promise<void> {
    this.seedRuntimeSnapshotFromCompatibilityCache()
    const hint = this.createStageMetadataHint(filePath, path.basename(path.dirname(filePath)))
    const sequence = this.runtimeSnapshots.nextObservation(filePath)
    let candidate: PublishedSkillEntry | null
    try {
      candidate = await this.stagePublishedSkillEntry(hint)
    } catch (error) {
      logger.warn('[SkillPresenter] Failed to stage watcher skill addition.', {
        path: filePath,
        error
      })
      this.runtimeSnapshots.setDiagnosticIfCurrent(filePath, sequence, {
        code: 'SOURCE_READ_FAILED',
        message: 'Skill source could not be read'
      })
      return
    }
    if (!candidate) {
      this.runtimeSnapshots.setDiagnosticIfCurrent(filePath, sequence, {
        code: 'INVALID_SOURCE',
        message: 'Skill source is invalid'
      })
      return
    }

    const existingEntry = this.runtimeSnapshots.snapshot.entries.get(candidate.metadata.name)
    if (existingEntry && existingEntry.metadata.path !== candidate.metadata.path) {
      logger.warn('[SkillPresenter] Duplicate skill name discovered. Keeping the first entry.', {
        name: candidate.metadata.name,
        path: candidate.metadata.path,
        existingPath: existingEntry.metadata.path
      })
      return
    }

    if (!this.publishRuntimeEntryIfCurrent(filePath, sequence, candidate)) return
    this.runtimeSnapshots.deleteDiagnostic(filePath)
    publishDeepchatEvent('skills.catalog.changed', {
      reason: 'installed',
      name: candidate.metadata.name,
      skill: candidate.metadata,
      version: Date.now()
    })
  }

  private handleSkillFileDeleted(filePath: string): void {
    this.seedRuntimeSnapshotFromCompatibilityCache()
    const skillName = this.findSkillNameByPath(filePath) ?? path.basename(path.dirname(filePath))
    const sequence = this.runtimeSnapshots.nextObservation(filePath)
    if (!this.runtimeSnapshots.removeIfCurrent(filePath, sequence, skillName)) return
    this.runtimeSnapshots.deleteDiagnostic(filePath)
    publishDeepchatEvent('skills.catalog.changed', {
      reason: 'uninstalled',
      name: skillName,
      version: Date.now()
    })
  }

  private createStageMetadataHint(filePath: string, name: string): SkillMetadata {
    return {
      name,
      description: '',
      path: filePath,
      skillRoot: path.dirname(filePath),
      category: this.deriveSkillCategory(path.dirname(filePath))
    }
  }

  private async handlePublishedSkillAuxiliarySourceChanged(
    filePath: string,
    eventType: WatchEventType
  ): Promise<void> {
    const entry = Array.from(this.runtimeSnapshots.snapshot.entries.values()).find((candidate) => {
      const relativePath = path.relative(candidate.metadata.skillRoot, filePath)
      const sourceDirectory = relativePath.split(/[\\/]+/)[0]
      const affectsPublishedSnapshot =
        sourceDirectory === 'scripts' ||
        (eventType !== 'update' && ['assets', 'references', 'templates'].includes(sourceDirectory))
      return (
        relativePath !== '' &&
        !relativePath.startsWith('..') &&
        !path.isAbsolute(relativePath) &&
        affectsPublishedSnapshot
      )
    })
    if (!entry) {
      return
    }

    const sourcePath = entry.metadata.path
    const sequence = this.runtimeSnapshots.nextObservation(sourcePath)
    if (entry.availability !== 'ready') {
      return
    }
    try {
      const candidate = await this.stagePublishedSkillEntry(entry.metadata as SkillMetadata)
      if (candidate) {
        this.publishRuntimeEntryIfCurrent(sourcePath, sequence, candidate)
      } else {
        this.publishRuntimeSourceErrorIfCurrent(sourcePath, sequence, entry.metadata.name, {
          code: 'INVALID_SOURCE',
          message: 'Skill source is invalid'
        })
      }
    } catch (error) {
      logger.warn('[SkillPresenter] Failed to stage watcher script update.', {
        name: entry.metadata.name,
        path: filePath,
        error
      })
      this.publishRuntimeSourceErrorIfCurrent(sourcePath, sequence, entry.metadata.name, {
        code: 'SOURCE_READ_FAILED',
        message: 'Skill source could not be read'
      })
    }
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
    this.runtimeSnapshots.reset()
    this.metadataCache.clear()
    this.contentCache.clear()
    this.runtimeContentViews = new WeakMap()
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
        await this.collectSkillManifestPaths(fullPath, depth + 1, acc)
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
    try {
      fs.writeFileSync(tempPath, content, 'utf-8')
      fs.renameSync(tempPath, targetPath)
    } finally {
      if (fs.existsSync(tempPath)) {
        fs.rmSync(tempPath, { force: true })
      }
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

  private findSkillNameByPath(skillPath: string): string | null {
    for (const entry of this.runtimeSnapshots.snapshot.entries.values()) {
      if (entry.metadata.path === skillPath) {
        return entry.metadata.name
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
