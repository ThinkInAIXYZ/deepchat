import logger from '@shared/logger'
/**
 * SkillSyncService manages Skill synchronization.
 *
 * Coordinates:
 * - Scanning external tools for skills
 * - Converting between formats
 * - Converting external Skills for validated snapshot import
 */

import * as fs from 'fs'
import * as path from 'path'
import type {
  SkillSyncServicePort,
  ExternalToolConfig,
  ScanResult,
  ImportPreview,
  CanonicalSkill,
  ExternalSkillInfo,
  ScanCache,
  NewDiscovery
} from '@shared/types/skillSync'
import { ConflictStrategy } from '@shared/types/skillSync'
import type { SkillServicePort } from '@shared/types/skill'
import type { SkillSettingsPort } from '../settings'
import { toolScanner, resolveSkillsDir } from './toolScanner'
import { formatConverter } from './formatConverter'
import type { SyncContext } from './types'
import type { DeepchatEventPublisher, DeepchatEventPayload } from '@shared/contracts/events'
import { isValidToolId, MAX_SUBFOLDER_FILE_SIZE, MAX_SKILL_FOLDER_SIZE } from './security'
import { scanAndDetectDiscoveriesInWorker, scanExternalToolsInWorker } from './scanWorker'

const EXTERNAL_SKILL_MAX_DIRECTORY_DEPTH = 10
const EXTERNAL_SKILL_MAX_DIRECTORY_ENTRIES = 1000

interface ExternalSkillTraversalBudget {
  entries: number
  totalBytes: number
}

type SkillSyncEventName =
  | 'skillSync.discoveries.changed'
  | 'skillSync.scan.started'
  | 'skillSync.scan.completed'

// ============================================================================
// SkillSyncService Implementation
// ============================================================================

export class SkillSyncService implements SkillSyncServicePort {
  private skillService: SkillServicePort
  private settings: SkillSettingsPort
  private syncContext: SyncContext = {}
  private initialized: boolean = false

  constructor(
    skillService: SkillServicePort,
    settings: SkillSettingsPort,
    private readonly publishEvent: DeepchatEventPublisher
  ) {
    this.skillService = skillService
    this.settings = settings
  }

  private publishSkillSyncEvent(
    name: SkillSyncEventName,
    payload: Record<string, unknown> = {}
  ): void {
    this.publishEvent(name, {
      ...payload,
      version: Date.now()
    } as DeepchatEventPayload<SkillSyncEventName>)
  }

  /** Initialize the synchronization runtime. */
  async initialize(): Promise<void> {
    if (this.initialized) return
    this.initialized = true
  }

  /**
   * Set project root for project-level tools
   */
  setProjectRoot(projectRoot: string): void {
    this.syncContext.projectRoot = projectRoot
  }

  // ============================================================================
  // Scan Cache Operations
  // ============================================================================

  /**
   * Get cached scan results from config
   */
  async getScanCache(): Promise<ScanCache | null> {
    return this.settings.getScanCache()
  }

  /**
   * Save scan results to cache
   */
  async saveScanCache(results: ScanResult[]): Promise<void> {
    const cache: ScanCache = {
      timestamp: new Date().toISOString(),
      tools: results.map((result) => ({
        toolId: result.toolId,
        available: result.available,
        skills: result.skills.map((skill) => ({
          name: skill.name,
          lastModified: skill.lastModified.toISOString()
        }))
      }))
    }
    this.settings.setScanCache(cache)
  }

  /**
   * Scan external tools and detect new discoveries by comparing with cache and current skills
   * This is the main method called on app startup
   */
  async scanAndDetectNewDiscoveries(): Promise<NewDiscovery[]> {
    logger.info('[SkillSync] Starting background scan for new discoveries')

    // 1. Get cached scan results
    const cache = await this.getScanCache()

    // 3. Get current DeepChat skills
    const existingSkills = await this.skillService.getAllSkills()
    const existingSkillNames = new Set(existingSkills.map((s) => s.name))

    // 2/4. Scan and compare off-main when possible
    const { scanResults, discoveries: newDiscoveries } =
      await this.scanAndDetectDiscoveriesWithFallback(cache, existingSkillNames)

    // 5. Save new cache
    await this.saveScanCache(scanResults)

    // 6. Emit event if there are new discoveries
    if (newDiscoveries.length > 0) {
      const totalNewSkills = newDiscoveries.reduce((sum, d) => sum + d.newSkills.length, 0)
      logger.info(
        `[SkillSync] Found ${totalNewSkills} new skills from ${newDiscoveries.length} tools`
      )
      this.publishSkillSyncEvent('skillSync.discoveries.changed', {
        discoveries: newDiscoveries
      })
    } else {
      logger.info('[SkillSync] No new discoveries found')
    }

    return newDiscoveries
  }

  /**
   * Compare scan results with cache and existing skills to find new discoveries
   */
  private compareWithCacheAndSkills(
    scanResults: ScanResult[],
    cache: ScanCache | null,
    existingSkillNames: Set<string>
  ): NewDiscovery[] {
    const discoveries: NewDiscovery[] = []

    // Build cache lookup map
    const cacheMap = new Map<string, Set<string>>()
    if (cache) {
      for (const tool of cache.tools) {
        cacheMap.set(tool.toolId, new Set(tool.skills.map((s) => s.name)))
      }
    }

    for (const result of scanResults) {
      // Only consider available user-level tools
      if (!result.available || result.toolId.includes('project')) {
        continue
      }

      const cachedSkillNames = cacheMap.get(result.toolId) || new Set<string>()
      const newSkills: ExternalSkillInfo[] = []

      for (const skill of result.skills) {
        // A skill is "new" if:
        // 1. It's not in the cache (newly discovered)
        // 2. It's not already imported into DeepChat
        const isInCache = cachedSkillNames.has(skill.name)
        const isAlreadyImported = existingSkillNames.has(skill.name)

        if (!isInCache && !isAlreadyImported) {
          newSkills.push(skill)
        }
      }

      if (newSkills.length > 0) {
        discoveries.push({
          toolId: result.toolId,
          toolName: result.toolName,
          newSkills
        })
      }
    }

    return discoveries
  }

  /**
   * Get new discoveries by comparing current scan with cache and existing skills
   * Note: This does trigger a scan to get fresh results
   */
  async getNewDiscoveries(): Promise<NewDiscovery[]> {
    const cache = await this.getScanCache()
    const existingSkills = await this.skillService.getAllSkills()
    const existingSkillNames = new Set(existingSkills.map((s) => s.name))
    const { discoveries } = await this.scanAndDetectDiscoveriesWithFallback(
      cache,
      existingSkillNames
    )
    return discoveries
  }

  /**
   * Get both scan results and new discoveries in a single call
   * This is more efficient than calling scanExternalTools and getNewDiscoveries separately
   */
  async getToolsAndDiscoveries(): Promise<{ tools: ScanResult[]; discoveries: NewDiscovery[] }> {
    const cache = await this.getScanCache()
    const existingSkills = await this.skillService.getAllSkills()
    const existingSkillNames = new Set(existingSkills.map((s) => s.name))
    const { scanResults, discoveries } = await this.scanAndDetectDiscoveriesWithFallback(
      cache,
      existingSkillNames
    )
    return { tools: scanResults, discoveries }
  }

  /**
   * Mark discoveries as acknowledged (update cache without showing them again)
   */
  async acknowledgeDiscoveries(): Promise<void> {
    const scanResults = await this.scanExternalToolsWithFallback()
    await this.saveScanCache(scanResults)
  }

  // ============================================================================
  // Scanning Operations
  // ============================================================================

  /**
   * Scan all registered external tools for skills
   */
  async scanExternalTools(): Promise<ScanResult[]> {
    this.publishSkillSyncEvent('skillSync.scan.started')
    const results = await this.scanExternalToolsWithFallback()
    this.publishSkillSyncEvent('skillSync.scan.completed', { results })
    return results
  }

  /**
   * Scan a specific external tool for skills
   */
  async scanTool(toolId: string): Promise<ScanResult> {
    return toolScanner.scanTool(toolId, this.syncContext.projectRoot)
  }

  private async scanExternalToolsWithFallback(): Promise<ScanResult[]> {
    try {
      return await scanExternalToolsInWorker({
        tools: toolScanner.getAllTools(),
        projectRoot: this.syncContext.projectRoot
      })
    } catch (error) {
      console.warn('[SkillSync] Worker scan failed, falling back to main thread:', error)
      return await toolScanner.scanExternalTools(this.syncContext.projectRoot)
    }
  }

  private async scanAndDetectDiscoveriesWithFallback(
    cache: ScanCache | null,
    existingSkillNames: Set<string>
  ): Promise<{ scanResults: ScanResult[]; discoveries: NewDiscovery[] }> {
    try {
      return await scanAndDetectDiscoveriesInWorker({
        tools: toolScanner.getAllTools(),
        projectRoot: this.syncContext.projectRoot,
        cache,
        existingSkillNames: [...existingSkillNames]
      })
    } catch (error) {
      console.warn('[SkillSync] Worker discovery scan failed, falling back to main thread:', error)
      const scanResults = await toolScanner.scanExternalTools(this.syncContext.projectRoot)
      return {
        scanResults,
        discoveries: this.compareWithCacheAndSkills(scanResults, cache, existingSkillNames)
      }
    }
  }

  // ============================================================================
  // Import Operations (External Tool → DeepChat)
  // ============================================================================

  /**
   * Preview import operation - parse skills and detect conflicts
   */
  async previewImport(toolId: string, skillNames: string[]): Promise<ImportPreview[]> {
    const previews: ImportPreview[] = []

    // Security: Validate tool ID
    if (!isValidToolId(toolId)) {
      console.warn(`Invalid tool ID: ${toolId}`)
      return []
    }

    // Get scan result for the tool
    const scanResult = await this.scanTool(toolId)
    if (!scanResult.available) {
      return []
    }

    // Get existing skills in DeepChat
    const existingSkills = await this.skillService.getAllSkills()
    const existingNames = new Set(existingSkills.map((s) => s.name))

    // Process each requested skill
    for (const skillName of skillNames) {
      const skillInfo = scanResult.skills.find((s) => s.name === skillName)
      if (!skillInfo) {
        continue
      }

      try {
        // Parse the external skill
        const skill = await this.parseExternalSkill(skillInfo, toolId, scanResult.skillsDir)

        // Check for conflicts
        const hasConflict = existingNames.has(skill.name)

        // Generate warnings
        const warnings = this.getImportWarnings(skill, toolId)

        previews.push({
          skill,
          source: skillInfo,
          conflict: hasConflict
            ? {
                existingSkillName: skill.name,
                strategy: ConflictStrategy.SKIP
              }
            : undefined,
          warnings
        })
      } catch (error) {
        console.error(`Error parsing skill ${skillName}:`, error)
        // Add error preview
        previews.push({
          skill: {
            name: skillName,
            description: '',
            instructions: ''
          },
          source: skillInfo,
          warnings: [`Parse error: ${error instanceof Error ? error.message : String(error)}`]
        })
      }
    }

    return previews
  }

  // ============================================================================
  // Tool Configuration
  // ============================================================================

  /**
   * Get all registered external tools
   */
  getRegisteredTools(): ExternalToolConfig[] {
    return toolScanner.getAllTools()
  }

  /**
   * Check if a tool's directory exists
   */
  async isToolAvailable(toolId: string): Promise<boolean> {
    return toolScanner.isToolAvailable(toolId, this.syncContext.projectRoot)
  }

  // ============================================================================
  // Cleanup
  // ============================================================================

  destroy(): void {
    // Cleanup resources if needed
  }

  // ============================================================================
  // Private Helper Methods
  // ============================================================================

  private isInsideDirectory(targetPath: string, parentPath: string): boolean {
    const relative = path.relative(parentPath, path.resolve(targetPath))
    return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative))
  }

  /**
   * Parse an external skill file
   */
  private async parseExternalSkill(
    skillInfo: ExternalSkillInfo,
    toolId: string,
    scannedSkillsDir: string
  ): Promise<CanonicalSkill> {
    const tool = toolScanner.getTool(toolId)
    if (!tool) {
      throw new Error(`Unknown tool: ${toolId}`)
    }

    const configuredSkillsDir = path.resolve(resolveSkillsDir(tool, this.syncContext.projectRoot))
    const sourceRoot = this.resolveExternalSourceRoot(scannedSkillsDir, configuredSkillsDir)
    let filePath: string
    let folderPath: string | undefined

    if (tool.filePattern.includes('/')) {
      // Subfolder pattern - path is folder, main file is inside
      folderPath = this.resolveExternalCandidatePath(skillInfo.path, sourceRoot)
      const fileName = tool.filePattern.split('/').pop() || 'SKILL.md'
      filePath = path.join(skillInfo.path, fileName)
    } else {
      // Single file pattern
      filePath = this.resolveExternalCandidatePath(skillInfo.path, sourceRoot)
      folderPath = path.dirname(skillInfo.path)
    }

    filePath = this.resolveExternalCandidatePath(filePath, sourceRoot)
    const manifestSize = await this.validateExternalSkillPaths(sourceRoot, folderPath, filePath)
    if (tool.capabilities.supportsSubfolders && folderPath) {
      await this.rejectSymlinksInImportedSubfolders(sourceRoot, folderPath, manifestSize)
    }

    const content = await fs.promises.readFile(filePath, 'utf-8')

    return formatConverter.parseExternal(
      content,
      { toolId, filePath, folderPath },
      { includeSubfolders: tool.capabilities.supportsSubfolders }
    )
  }

  private resolveExternalSourceRoot(scannedSkillsDir: string, configuredSkillsDir: string): string {
    if (!path.isAbsolute(scannedSkillsDir)) {
      throw new Error('External Skill source root must be absolute')
    }

    const sourceRoot = path.resolve(scannedSkillsDir)
    if (sourceRoot !== configuredSkillsDir) {
      throw new Error('External Skill source root does not match the configured Agent root')
    }
    return sourceRoot
  }

  private resolveExternalCandidatePath(candidatePath: string, sourceRoot: string): string {
    if (!path.isAbsolute(candidatePath)) {
      throw new Error('External Skill source path must be absolute')
    }

    const resolvedCandidate = path.resolve(candidatePath)
    if (!this.isInsideDirectory(resolvedCandidate, sourceRoot)) {
      throw new Error('External Skill source path is outside the configured Agent root')
    }
    return resolvedCandidate
  }

  private async validateExternalSkillPaths(
    sourceRoot: string,
    folderPath: string,
    filePath: string
  ): Promise<number> {
    const rootStats = await fs.promises.lstat(sourceRoot)
    if (rootStats.isSymbolicLink()) {
      throw new Error(`External Skill source contains a symbolic link: ${sourceRoot}`)
    }
    if (!rootStats.isDirectory()) {
      throw new Error(`External Skill source root is not a directory: ${sourceRoot}`)
    }

    await this.rejectSymlinkPathSegments(sourceRoot, filePath)

    const [folderStats, fileStats, realSourceRoot, realFolderPath, realFilePath] =
      await Promise.all([
        folderPath === sourceRoot ? Promise.resolve(rootStats) : fs.promises.lstat(folderPath),
        fs.promises.lstat(filePath),
        fs.promises.realpath(sourceRoot),
        fs.promises.realpath(folderPath),
        fs.promises.realpath(filePath)
      ])
    if (folderStats.isSymbolicLink() || fileStats.isSymbolicLink()) {
      throw new Error('External Skill source contains a symbolic link')
    }
    if (!folderStats.isDirectory()) {
      throw new Error(`External Skill folder is not a directory: ${folderPath}`)
    }
    if (!fileStats.isFile()) {
      throw new Error(`External Skill entry is not a file: ${filePath}`)
    }
    if (fileStats.size > MAX_SUBFOLDER_FILE_SIZE) {
      throw new Error(
        `External Skill manifest is too large: ${fileStats.size} bytes (max: ${MAX_SUBFOLDER_FILE_SIZE})`
      )
    }
    this.assertRealPathInsideRoot(realFolderPath, realSourceRoot)
    this.assertRealPathInsideRoot(realFilePath, realSourceRoot)
    return fileStats.size
  }

  private async rejectSymlinkPathSegments(
    sourceRoot: string,
    candidatePath: string
  ): Promise<void> {
    const relativePath = path.relative(sourceRoot, candidatePath)
    if (relativePath === '' || relativePath.startsWith('..') || path.isAbsolute(relativePath)) {
      throw new Error('External Skill source path is outside the configured Agent root')
    }

    let currentPath = sourceRoot
    for (const segment of relativePath.split(path.sep)) {
      currentPath = path.join(currentPath, segment)
      const stats = await fs.promises.lstat(currentPath)
      if (stats.isSymbolicLink()) {
        throw new Error(`External Skill source contains a symbolic link: ${currentPath}`)
      }
    }
  }

  private async rejectSymlinksInImportedSubfolders(
    sourceRoot: string,
    skillFolder: string,
    manifestSize: number
  ): Promise<void> {
    const realSourceRoot = await fs.promises.realpath(sourceRoot)
    const traversalBudget: ExternalSkillTraversalBudget = {
      entries: 0,
      totalBytes: manifestSize
    }
    for (const subfolderName of ['references', 'scripts']) {
      const subfolderPath = path.join(skillFolder, subfolderName)
      let stats: fs.Stats
      try {
        stats = await fs.promises.lstat(subfolderPath)
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') continue
        throw error
      }

      if (stats.isSymbolicLink()) {
        throw new Error(`External Skill source contains a symbolic link: ${subfolderPath}`)
      }
      if (!stats.isDirectory()) continue

      this.assertRealPathInsideRoot(await fs.promises.realpath(subfolderPath), realSourceRoot)
      await this.rejectSymlinksRecursively(subfolderPath, realSourceRoot, traversalBudget, 0)
    }
  }

  private async rejectSymlinksRecursively(
    directoryPath: string,
    realSourceRoot: string,
    traversalBudget: ExternalSkillTraversalBudget,
    depth: number
  ): Promise<void> {
    if (depth > EXTERNAL_SKILL_MAX_DIRECTORY_DEPTH) {
      throw new Error(
        `External Skill source exceeds maximum directory depth of ${EXTERNAL_SKILL_MAX_DIRECTORY_DEPTH}`
      )
    }

    const directory = await fs.promises.opendir(directoryPath)
    for await (const entry of directory) {
      traversalBudget.entries += 1
      if (traversalBudget.entries > EXTERNAL_SKILL_MAX_DIRECTORY_ENTRIES) {
        throw new Error(
          `External Skill source exceeds maximum entry count of ${EXTERNAL_SKILL_MAX_DIRECTORY_ENTRIES}`
        )
      }

      const entryPath = path.join(directoryPath, entry.name)
      const stats = await fs.promises.lstat(entryPath)
      if (stats.isSymbolicLink()) {
        throw new Error(`External Skill source contains a symbolic link: ${entryPath}`)
      }
      if (stats.isFile()) {
        traversalBudget.totalBytes += stats.size
        if (traversalBudget.totalBytes > MAX_SKILL_FOLDER_SIZE) {
          throw new Error(
            `External Skill source exceeds maximum total size of ${MAX_SKILL_FOLDER_SIZE} bytes`
          )
        }
      }

      this.assertRealPathInsideRoot(await fs.promises.realpath(entryPath), realSourceRoot)
      if (stats.isDirectory()) {
        await this.rejectSymlinksRecursively(entryPath, realSourceRoot, traversalBudget, depth + 1)
      }
    }
  }

  private assertRealPathInsideRoot(realPath: string, realSourceRoot: string): void {
    if (!this.isInsideDirectory(realPath, realSourceRoot)) {
      throw new Error('External Skill source resolves outside the configured Agent root')
    }
  }

  /**
   * Get import warnings for a skill
   */
  private getImportWarnings(skill: CanonicalSkill, _sourceToolId: string): string[] {
    const warnings: string[] = []

    // Check if source has features that DeepChat also supports
    // (no warnings needed for import since DeepChat supports most features)

    if (!skill.name || skill.name === 'unnamed-skill') {
      warnings.push('Skill name could not be determined')
    }

    if (!skill.description) {
      warnings.push('Skill description is empty')
    }

    return warnings
  }
}
