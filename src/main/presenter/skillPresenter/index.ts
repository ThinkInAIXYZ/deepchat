import { app, shell } from 'electron'
import path from 'path'
import fs from 'fs'
import { randomUUID } from 'node:crypto'
import { FSWatcher, watch } from 'chokidar'
import matter from 'gray-matter'
import { unzipSync } from 'fflate'
import type { IConfigPresenter } from '@shared/presenter'
import {
  ISkillPresenter,
  SkillMetadata,
  SkillContent,
  SkillInstallResult,
  SkillFolderNode,
  SkillInstallOptions,
  SkillExtensionConfig,
  SkillManageRequest,
  SkillManageResult,
  SkillRuntimePolicy,
  SkillScriptDescriptor,
  SkillScriptRuntime,
  SkillViewResult,
  SkillLinkedFile
} from '@shared/types/skill'
import { eventBus, SendTarget } from '@/eventbus'
import { SKILL_EVENTS } from '@/events'
import logger from '@shared/logger'
import { normalizeSkillAllowedTools } from './toolNameMapping'

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
  private watcher: FSWatcher | null = null
  private initialized: boolean = false
  // Prevent concurrent discovery calls (race condition protection)
  private discoveryPromise: Promise<SkillMetadata[]> | null = null
  private legacySkillRetirementWarnings: Set<string> = new Set()

  constructor(
    private readonly configPresenter: IConfigPresenter,
    private readonly sessionStatePort: SkillSessionStatePort
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

  /**
   * Ensure the skills directory exists
   */
  private ensureSkillsDir(): void {
    if (!fs.existsSync(this.skillsDir)) {
      fs.mkdirSync(this.skillsDir, { recursive: true })
    }
    if (!fs.existsSync(this.sidecarDir)) {
      fs.mkdirSync(this.sidecarDir, { recursive: true })
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
    this.watchSkillFiles()
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
        if (this.metadataCache.has(metadata.name)) {
          logger.warn(
            '[SkillPresenter] Duplicate skill name discovered. Keeping the first entry.',
            {
              name: metadata.name,
              path: metadata.path
            }
          )
          continue
        }
        this.metadataCache.set(metadata.name, metadata)
      } catch (error) {
        console.error(`[SkillPresenter] Failed to parse skill at ${skillPath}:`, error)
      }
    }

    const skills = Array.from(this.metadataCache.values()).sort((left, right) => {
      return (
        (left.category ?? '').localeCompare(right.category ?? '') ||
        left.name.localeCompare(right.name)
      )
    })
    eventBus.sendToRenderer(SKILL_EVENTS.DISCOVERED, SendTarget.ALL_WINDOWS, skills)

    return skills
  }

  /**
   * Parse SKILL.md frontmatter to extract metadata
   */
  private async parseSkillMetadata(
    skillPath: string,
    dirName: string
  ): Promise<SkillMetadata | null> {
    try {
      const content = fs.readFileSync(skillPath, 'utf-8')
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
          : undefined
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
    return Array.from(this.metadataCache.values()).sort((left, right) => {
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
    // Check content cache first
    if (this.contentCache.has(name)) {
      return this.contentCache.get(name)!
    }

    if (this.metadataCache.size === 0) {
      await this.discoverSkills()
    }

    // Get metadata to find the path
    const metadata = this.metadataCache.get(name)
    if (!metadata) {
      console.warn(`[SkillPresenter] Skill not found: ${name}`)
      return null
    }

    try {
      // Check file size before reading to prevent memory exhaustion
      const stats = fs.statSync(metadata.path)
      if (stats.size > SKILL_CONFIG.SKILL_FILE_MAX_SIZE) {
        console.error(
          `[SkillPresenter] Skill file too large: ${stats.size} bytes (max: ${SKILL_CONFIG.SKILL_FILE_MAX_SIZE})`
        )
        return null
      }

      const rawContent = fs.readFileSync(metadata.path, 'utf-8')
      const { content } = matter(rawContent)
      const renderedContent = this.replacePathVariables(content, metadata)
      const runtimeInstructions = await this.buildRuntimeInstructions(metadata)

      const skillContent: SkillContent = {
        name,
        content: [renderedContent.trim(), runtimeInstructions].filter(Boolean).join('\n\n')
      }

      this.contentCache.set(name, skillContent)
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
    if (!metadata) {
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

        if (!fs.existsSync(resolvedPath)) {
          return {
            success: false,
            error: `Skill file not found: ${requestedFilePath}`
          }
        }

        const stats = fs.statSync(resolvedPath)
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
          content: fs.readFileSync(resolvedPath, 'utf-8'),
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
      const stats = fs.statSync(metadata.path)
      if (stats.size > SKILL_CONFIG.SKILL_FILE_MAX_SIZE) {
        const errorMessage = `[SkillPresenter] Skill file too large: ${stats.size} bytes (max: ${SKILL_CONFIG.SKILL_FILE_MAX_SIZE})`
        console.error(errorMessage)
        return {
          success: false,
          error: errorMessage
        }
      }

      const rawContent = fs.readFileSync(metadata.path, 'utf-8')
      const { content } = matter(rawContent)
      let nextIsPinned = isPinned

      if (options?.conversationId && !isPinned) {
        await this.setActiveSkills(options.conversationId, [...pinnedSkills, metadata.name])
        nextIsPinned = true
      }

      return {
        success: true,
        name: metadata.name,
        category: metadata.category ?? null,
        skillRoot: metadata.skillRoot,
        filePath: null,
        content: this.replacePathVariables(content, metadata),
        platforms: metadata.platforms,
        metadata: metadata.metadata,
        linkedFiles: this.listSkillLinkedFiles(metadata.skillRoot),
        isPinned: nextIsPinned
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
          return { success: true, action, draftId, skillName: parsed.skillName }
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
          return { success: true, action, draftId, skillName: parsed.skillName }
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

  private replacePathVariables(content: string, metadata: SkillMetadata): string {
    return content
      .replace(/\$\{SKILL_ROOT\}/g, metadata.skillRoot)
      .replace(/\$\{SKILLS_DIR\}/g, this.skillsDir)
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

      const result = await this.installFromDirectory(skillDir, { overwrite: false })
      if (!result.success && result.error?.includes('already exists')) {
        continue
      }
      if (!result.success) {
        console.warn('[SkillPresenter] Failed to install builtin skill:', result.error)
      }
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
    return this.installFromDirectory(folderPath, options)
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
      return await this.installFromDirectory(skillDir, options)
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
      return await this.installFromZip(tempZipPath, options)
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error)
      return { success: false, error: errorMsg, errorCode: 'io_error' }
    } finally {
      if (fs.existsSync(tempZipPath)) {
        fs.rmSync(tempZipPath, { force: true })
      }
    }
  }

  private async installFromDirectory(
    folderPath: string,
    options?: SkillInstallOptions
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

      if (skillName.includes('/') || skillName.includes('\\')) {
        return {
          success: false,
          error: 'Invalid skill name in SKILL.md frontmatter',
          errorCode: 'invalid_skill'
        }
      }

      const targetDir = path.join(this.skillsDir, skillName)
      const resolvedTarget = path.resolve(targetDir)

      if (resolvedSource === resolvedTarget) {
        return {
          success: false,
          error: `Skill "${skillName}" already exists`,
          errorCode: 'conflict',
          existingSkillName: skillName
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
            error: `Skill "${skillName}" already exists`,
            errorCode: 'conflict',
            existingSkillName: skillName
          }
        }
        this.backupExistingSkill(skillName)
        this.metadataCache.delete(skillName)
        this.contentCache.delete(skillName)
      }

      this.copyDirectory(resolvedSource, resolvedTarget)

      const metadata = await this.parseSkillMetadata(
        path.join(resolvedTarget, 'SKILL.md'),
        skillName
      )
      if (metadata) {
        this.metadataCache.set(skillName, metadata)
      }

      eventBus.sendToRenderer(SKILL_EVENTS.INSTALLED, SendTarget.ALL_WINDOWS, { name: skillName })

      return { success: true, skillName }
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error)
      return { success: false, error: errorMsg, errorCode: 'io_error' }
    }
  }

  private backupExistingSkill(skillName: string): string {
    const sourceDir = path.join(this.skillsDir, skillName)
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-')
    let backupDir = path.join(this.skillsDir, `${skillName}.backup-${timestamp}`)
    let counter = 0
    while (fs.existsSync(backupDir)) {
      counter += 1
      backupDir = path.join(this.skillsDir, `${skillName}.backup-${timestamp}-${counter}`)
    }
    fs.renameSync(sourceDir, backupDir)
    return backupDir
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

  /**
   * Uninstall a skill
   */
  async uninstallSkill(name: string): Promise<SkillInstallResult> {
    try {
      const skillDir = path.join(this.skillsDir, name)

      if (!fs.existsSync(skillDir)) {
        return { success: false, error: `Skill "${name}" not found` }
      }

      // Remove from caches
      this.metadataCache.delete(name)
      this.contentCache.delete(name)

      // Delete the directory
      fs.rmSync(skillDir, { recursive: true, force: true })
      this.deleteSkillExtension(name)

      eventBus.sendToRenderer(SKILL_EVENTS.UNINSTALLED, SendTarget.ALL_WINDOWS, { name })

      return { success: true, skillName: name }
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error)
      return { success: false, error: errorMsg }
    }
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

    const sidecarPath = this.getSidecarPath(name)
    const previousSkillContent = fs.readFileSync(metadata.path, 'utf-8')
    const hadSidecar = fs.existsSync(sidecarPath)
    const previousSidecarContent = hadSidecar ? fs.readFileSync(sidecarPath, 'utf-8') : null
    const sanitized = sanitizeSkillExtensionConfig(config)

    try {
      fs.writeFileSync(metadata.path, content, 'utf-8')
      fs.writeFileSync(sidecarPath, JSON.stringify(sanitized, null, 2), 'utf-8')

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
        if (hadSidecar && previousSidecarContent !== null) {
          fs.writeFileSync(sidecarPath, previousSidecarContent, 'utf-8')
        } else if (fs.existsSync(sidecarPath)) {
          fs.rmSync(sidecarPath, { force: true })
        }
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
  private buildFolderTree(
    dirPath: string,
    depth: number = 0,
    maxDepth: number = SKILL_CONFIG.FOLDER_TREE_MAX_DEPTH
  ): SkillFolderNode[] {
    if (depth >= maxDepth) {
      return []
    }

    try {
      const entries = fs.readdirSync(dirPath, { withFileTypes: true })
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
            children: this.buildFolderTree(fullPath, depth + 1, maxDepth)
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
    const sidecarPath = this.getSidecarPath(name)
    if (!fs.existsSync(sidecarPath)) {
      return createDefaultSkillExtensionConfig()
    }

    try {
      const content = fs.readFileSync(sidecarPath, 'utf-8')
      return sanitizeSkillExtensionConfig(JSON.parse(content))
    } catch (error) {
      logger.warn('[SkillPresenter] Failed to read skill sidecar, using defaults', {
        name,
        error
      })
      return createDefaultSkillExtensionConfig()
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
    fs.writeFileSync(this.getSidecarPath(name), JSON.stringify(sanitized, null, 2), 'utf-8')
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
    if (!fs.existsSync(scriptsDir)) {
      return []
    }

    const extension = await this.getSkillExtension(name)
    const descriptors = this.collectScriptDescriptors(scriptsDir, metadata.skillRoot).map(
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
  async setActiveSkills(conversationId: string, skills: string[]): Promise<void> {
    try {
      const isNewSession = await this.isNewAgentSession(conversationId)
      // Validate skill names
      const validSkills = await this.validateSkillNames(skills)
      if (!isNewSession) {
        this.warnLegacySkillRetired(conversationId)
        return
      }

      const previousSkills = await this.getActiveSkills(conversationId)
      const previousSet = new Set(previousSkills)
      const validSet = new Set(validSkills)

      this.setPersistedNewSessionSkills(conversationId, validSkills)

      const activated = validSkills.filter((skill) => !previousSet.has(skill))
      const deactivated = previousSkills.filter((skill) => !validSet.has(skill))

      if (activated.length > 0) {
        eventBus.sendToRenderer(SKILL_EVENTS.ACTIVATED, SendTarget.ALL_WINDOWS, {
          conversationId,
          skills: activated
        })
      }

      if (deactivated.length > 0) {
        eventBus.sendToRenderer(SKILL_EVENTS.DEACTIVATED, SendTarget.ALL_WINDOWS, {
          conversationId,
          skills: deactivated
        })
      }
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
  async getActiveSkillsAllowedTools(conversationId: string): Promise<string[]> {
    if (this.metadataCache.size === 0) {
      await this.discoverSkills()
    }

    const activeSkills = await this.getActiveSkills(conversationId)
    const allowedTools: Set<string> = new Set()

    for (const skillName of activeSkills) {
      const metadata = this.metadataCache.get(skillName)
      if (metadata?.allowedTools) {
        metadata.allowedTools.forEach((tool) => allowedTools.add(tool))
      }
    }

    const result = normalizeSkillAllowedTools(Array.from(allowedTools))
    for (const warning of result.warnings) {
      logger.warn(warning, { conversationId })
    }
    return result.tools
  }

  /**
   * Watch skill files for changes (hot-reload)
   */
  watchSkillFiles(): void {
    if (this.watcher) {
      return
    }

    this.watcher = watch(this.skillsDir, {
      ignoreInitial: true,
      depth: SKILL_CONFIG.FOLDER_TREE_MAX_DEPTH,
      ignored: (watchPath) =>
        watchPath.includes(`${path.sep}${SKILL_CONFIG.SIDECAR_DIR}${path.sep}`) ||
        path.basename(watchPath) === SKILL_CONFIG.SIDECAR_DIR,
      awaitWriteFinish: {
        stabilityThreshold: SKILL_CONFIG.WATCHER_STABILITY_THRESHOLD,
        pollInterval: SKILL_CONFIG.WATCHER_POLL_INTERVAL
      }
    })

    this.watcher.on('change', async (filePath: string) => {
      if (path.basename(filePath) === 'SKILL.md') {
        const previousName =
          this.findSkillNameByPath(filePath) ?? path.basename(path.dirname(filePath))
        this.contentCache.delete(previousName)

        // Re-parse metadata
        const metadata = await this.parseSkillMetadata(
          filePath,
          path.basename(path.dirname(filePath))
        )
        if (metadata) {
          const existingMetadata = this.metadataCache.get(metadata.name)
          if (existingMetadata && existingMetadata.path !== metadata.path) {
            logger.warn(
              '[SkillPresenter] Duplicate skill name discovered. Keeping the first entry.',
              {
                name: metadata.name,
                path: metadata.path,
                existingPath: existingMetadata.path
              }
            )
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
          eventBus.sendToRenderer(SKILL_EVENTS.METADATA_UPDATED, SendTarget.ALL_WINDOWS, metadata)
        }
      }
    })

    this.watcher.on('add', async (filePath: string) => {
      if (path.basename(filePath) === 'SKILL.md') {
        const metadata = await this.parseSkillMetadata(
          filePath,
          path.basename(path.dirname(filePath))
        )
        if (metadata) {
          const existingMetadata = this.metadataCache.get(metadata.name)
          if (existingMetadata && existingMetadata.path !== metadata.path) {
            logger.warn(
              '[SkillPresenter] Duplicate skill name discovered. Keeping the first entry.',
              {
                name: metadata.name,
                path: metadata.path,
                existingPath: existingMetadata.path
              }
            )
            return
          }

          this.metadataCache.set(metadata.name, metadata)
          eventBus.sendToRenderer(SKILL_EVENTS.INSTALLED, SendTarget.ALL_WINDOWS, {
            name: metadata.name
          })
        }
      }
    })

    this.watcher.on('unlink', (filePath: string) => {
      if (path.basename(filePath) === 'SKILL.md') {
        const skillName =
          this.findSkillNameByPath(filePath) ?? path.basename(path.dirname(filePath))
        this.metadataCache.delete(skillName)
        this.contentCache.delete(skillName)
        eventBus.sendToRenderer(SKILL_EVENTS.UNINSTALLED, SendTarget.ALL_WINDOWS, {
          name: skillName
        })
      }
    })

    this.watcher.on('error', (error) => {
      console.error('[SkillPresenter] File watcher error:', error)
    })

    console.log('[SkillPresenter] File watcher started')
  }

  /**
   * Stop watching skill files
   */
  stopWatching(): void {
    if (this.watcher) {
      this.watcher.close()
      this.watcher = null
      console.log('[SkillPresenter] File watcher stopped')
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
  destroy(): void {
    this.stopWatching()
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

  private deleteSkillExtension(name: string): void {
    const sidecarPath = this.getSidecarPath(name)
    if (fs.existsSync(sidecarPath)) {
      fs.rmSync(sidecarPath, { force: true })
    }
  }

  private collectScriptDescriptors(
    currentDir: string,
    skillRoot: string,
    acc: SkillScriptDescriptor[] = []
  ): SkillScriptDescriptor[] {
    const entries = fs.readdirSync(currentDir, { withFileTypes: true })

    for (const entry of entries) {
      if (entry.isSymbolicLink()) {
        continue
      }

      const fullPath = path.join(currentDir, entry.name)
      if (entry.isDirectory()) {
        this.collectScriptDescriptors(fullPath, skillRoot, acc)
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
    const relative = path.relative(this.skillsDir, skillRoot)
    if (!relative || relative === '.' || path.isAbsolute(relative)) {
      return null
    }

    const segments = relative.split(path.sep).filter(Boolean)
    return segments.length > 1 ? segments.slice(0, -1).join('/') : null
  }

  private listSkillLinkedFiles(skillRoot: string): SkillLinkedFile[] {
    const linkedFiles: SkillLinkedFile[] = []
    for (const [dirName, kind] of [
      ['references', 'reference'],
      ['templates', 'template'],
      ['scripts', 'script'],
      ['assets', 'asset']
    ] as const) {
      const targetDir = path.join(skillRoot, dirName)
      if (!fs.existsSync(targetDir)) {
        continue
      }
      this.collectLinkedFiles(targetDir, skillRoot, kind, linkedFiles)
    }

    return linkedFiles.sort((left, right) => left.path.localeCompare(right.path))
  }

  private collectLinkedFiles(
    currentDir: string,
    skillRoot: string,
    kind: SkillLinkedFile['kind'],
    acc: SkillLinkedFile[]
  ): void {
    const entries = fs.readdirSync(currentDir, { withFileTypes: true })

    for (const entry of entries) {
      if (entry.isSymbolicLink()) {
        continue
      }

      const fullPath = path.join(currentDir, entry.name)
      if (entry.isDirectory()) {
        this.collectLinkedFiles(fullPath, skillRoot, kind, acc)
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
