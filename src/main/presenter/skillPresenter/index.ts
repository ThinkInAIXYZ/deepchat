import { app, shell } from 'electron'
import path from 'path'
import fs from 'fs'
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
  SkillInstallOptions
} from '@shared/types/skill'
import { eventBus, SendTarget } from '@/eventbus'
import { SKILL_EVENTS } from '@/events'
import { presenter } from '@/presenter'
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
  WATCHER_POLL_INTERVAL: 100 // ms
} as const

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
  private metadataCache: Map<string, SkillMetadata> = new Map()
  private contentCache: Map<string, SkillContent> = new Map()
  private watcher: FSWatcher | null = null
  private initialized: boolean = false
  // Prevent concurrent discovery calls (race condition protection)
  private discoveryPromise: Promise<SkillMetadata[]> | null = null

  constructor(private readonly configPresenter: IConfigPresenter) {
    // Skills directory: ~/.deepchat/skills/
    this.skillsDir = this.resolveSkillsDir()
    this.ensureSkillsDir()
  }

  private resolveSkillsDir(): string {
    const configuredPath = this.configPresenter.getSkillsPath()
    const normalized = configuredPath?.trim()
    if (normalized) {
      return path.resolve(normalized)
    }
    return path.join(app.getPath('home'), '.deepchat', 'skills')
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

    const entries = fs.readdirSync(this.skillsDir, { withFileTypes: true })

    for (const entry of entries) {
      if (entry.isDirectory()) {
        const skillPath = path.join(this.skillsDir, entry.name, 'SKILL.md')
        if (fs.existsSync(skillPath)) {
          try {
            const metadata = await this.parseSkillMetadata(skillPath, entry.name)
            if (metadata) {
              this.metadataCache.set(entry.name, metadata)
            }
          } catch (error) {
            console.error(`[SkillPresenter] Failed to parse skill ${entry.name}:`, error)
          }
        }
      }
    }

    const skills = Array.from(this.metadataCache.values())
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
    return Array.from(this.metadataCache.values())
  }

  /**
   * Get metadata prompt for skill listing (used by skill_list tool)
   */
  async getMetadataPrompt(): Promise<string> {
    const skills = await this.getMetadataList()
    const header = '# Available Skills'
    const dirLine = `Skills directory: ${this.skillsDir}`

    if (skills.length === 0) {
      return `${header}\n\n${dirLine}\nNo skills are currently installed.`
    }

    const lines = skills.map((skill) => `- ${skill.name}: ${skill.description}`)
    return `${header}\n\n${dirLine}\nYou can activate these skills using skill_control tool:\n${lines.join('\n')}`
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

      const skillContent: SkillContent = {
        name,
        content: renderedContent.trim()
      }

      this.contentCache.set(name, skillContent)
      return skillContent
    } catch (error) {
      console.error(`[SkillPresenter] Error loading skill content for ${name}:`, error)
      return null
    }
  }

  private replacePathVariables(content: string, metadata: SkillMetadata): string {
    return content
      .replace(/\$\{SKILL_ROOT\}/g, metadata.skillRoot)
      .replace(/\$\{SKILLS_DIR\}/g, this.skillsDir)
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
      return { success: false, error: 'Zip file not found' }
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
      return { success: false, error: errorMsg }
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
      return { success: false, error: errorMsg }
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
        return { success: false, error: 'Skill folder not found' }
      }

      const skillMdPath = path.join(resolvedSource, 'SKILL.md')
      if (!fs.existsSync(skillMdPath)) {
        return { success: false, error: 'SKILL.md not found in the folder' }
      }

      const content = fs.readFileSync(skillMdPath, 'utf-8')
      const { data } = matter(content)
      const skillName = typeof data.name === 'string' ? data.name.trim() : ''
      const skillDescription = typeof data.description === 'string' ? data.description.trim() : ''

      if (!skillName) {
        return { success: false, error: 'Skill name not found in SKILL.md frontmatter' }
      }

      if (!skillDescription) {
        return { success: false, error: 'Skill description not found in SKILL.md frontmatter' }
      }

      if (skillName.includes('/') || skillName.includes('\\')) {
        return { success: false, error: 'Invalid skill name in SKILL.md frontmatter' }
      }

      const targetDir = path.join(this.skillsDir, skillName)
      const resolvedTarget = path.resolve(targetDir)

      if (resolvedSource === resolvedTarget) {
        return { success: false, error: `Skill "${skillName}" already exists` }
      }

      const relativeToSource = path.relative(resolvedSource, resolvedTarget)
      if (
        relativeToSource === '' ||
        (!relativeToSource.startsWith('..') && !path.isAbsolute(relativeToSource))
      ) {
        return { success: false, error: 'Target directory cannot be inside source folder' }
      }

      if (fs.existsSync(resolvedTarget)) {
        if (!options?.overwrite) {
          return { success: false, error: `Skill "${skillName}" already exists` }
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
      return { success: false, error: errorMsg }
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
        if (entry.isSymbolicLink()) {
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

  /**
   * Get active skills for a conversation
   */
  async getActiveSkills(conversationId: string): Promise<string[]> {
    try {
      const conversation = await presenter.sessionPresenter.getConversation(conversationId)
      const activeSkills = conversation?.settings?.activeSkills || []
      const validSkills = await this.validateSkillNames(activeSkills)

      if (validSkills.length !== activeSkills.length) {
        await presenter.sessionPresenter.updateConversationSettings(conversationId, {
          activeSkills: validSkills
        })
      }

      return validSkills
    } catch (error) {
      console.error(`[SkillPresenter] Error getting active skills for ${conversationId}:`, error)
      return []
    }
  }

  /**
   * Set active skills for a conversation
   */
  async setActiveSkills(conversationId: string, skills: string[]): Promise<void> {
    try {
      const previousSkills = await this.getActiveSkills(conversationId)
      const previousSet = new Set(previousSkills)

      // Validate skill names
      const validSkills = await this.validateSkillNames(skills)
      const validSet = new Set(validSkills)

      await presenter.sessionPresenter.updateConversationSettings(conversationId, {
        activeSkills: validSkills
      })

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
      depth: 2, // Watch skill directories and their immediate contents
      awaitWriteFinish: {
        stabilityThreshold: SKILL_CONFIG.WATCHER_STABILITY_THRESHOLD,
        pollInterval: SKILL_CONFIG.WATCHER_POLL_INTERVAL
      }
    })

    this.watcher.on('change', async (filePath: string) => {
      if (path.basename(filePath) === 'SKILL.md') {
        const skillDir = path.dirname(filePath)
        const skillName = path.basename(skillDir)

        // Invalidate caches
        this.contentCache.delete(skillName)

        // Re-parse metadata
        const metadata = await this.parseSkillMetadata(filePath, skillName)
        if (metadata) {
          this.metadataCache.set(skillName, metadata)
          eventBus.sendToRenderer(SKILL_EVENTS.METADATA_UPDATED, SendTarget.ALL_WINDOWS, metadata)
        }
      }
    })

    this.watcher.on('add', async (filePath: string) => {
      if (path.basename(filePath) === 'SKILL.md') {
        const skillDir = path.dirname(filePath)
        const skillName = path.basename(skillDir)

        const metadata = await this.parseSkillMetadata(filePath, skillName)
        if (metadata) {
          this.metadataCache.set(skillName, metadata)
          eventBus.sendToRenderer(SKILL_EVENTS.INSTALLED, SendTarget.ALL_WINDOWS, {
            name: skillName
          })
        }
      }
    })

    this.watcher.on('unlink', (filePath: string) => {
      if (path.basename(filePath) === 'SKILL.md') {
        const skillDir = path.dirname(filePath)
        const skillName = path.basename(skillDir)

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
      if (entry.isSymbolicLink()) {
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
}
