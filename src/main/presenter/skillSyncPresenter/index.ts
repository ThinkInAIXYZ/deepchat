/**
 * SkillSyncPresenter - Main presenter for skill synchronization
 *
 * Coordinates:
 * - Scanning external tools for skills
 * - Converting between formats
 * - Importing skills from external tools to DeepChat
 * - Exporting skills from DeepChat to external tools
 */

import * as fs from 'fs'
import * as path from 'path'
import { app } from 'electron'
import type {
  ISkillSyncPresenter,
  ExternalToolConfig,
  ScanResult,
  ImportPreview,
  ExportPreview,
  SyncResult,
  CanonicalSkill,
  ExternalSkillInfo,
  ScanCache,
  NewDiscovery
} from '@shared/types/skillSync'
import { ConflictStrategy } from '@shared/types/skillSync'
import type { ISkillPresenter, IConfigPresenter } from '@shared/presenter'
import { toolScanner, resolveSkillsDir } from './toolScanner'
import { formatConverter } from './formatConverter'
import type { SyncContext } from './types'
import { eventBus, SendTarget } from '@/eventbus'
import { SKILL_SYNC_EVENTS } from '@/events'
import { isValidToolId, isValidConflictStrategy, checkWritePermission } from './security'

// ============================================================================
// SkillSyncPresenter Implementation
// ============================================================================

export class SkillSyncPresenter implements ISkillSyncPresenter {
  private skillPresenter: ISkillPresenter
  private configPresenter: IConfigPresenter
  private syncContext: SyncContext = {}
  private initialized: boolean = false

  constructor(skillPresenter: ISkillPresenter, configPresenter: IConfigPresenter) {
    this.skillPresenter = skillPresenter
    this.configPresenter = configPresenter
  }

  /**
   * Initialize the sync presenter - scan for external tools on startup
   */
  async initialize(): Promise<void> {
    if (this.initialized) return
    this.initialized = true

    // Scan in background after a short delay to not block startup
    setTimeout(async () => {
      try {
        await this.scanAndDetectNewDiscoveries()
      } catch (error) {
        console.error('[SkillSync] Background scan failed:', error)
      }
    }, 3000) // 3 second delay after app starts
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
    try {
      const cache = await this.configPresenter.getSetting('skills.scanCache')
      return cache as ScanCache | null
    } catch {
      return null
    }
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
    await this.configPresenter.setSetting('skills.scanCache', cache)
  }

  /**
   * Scan external tools and detect new discoveries by comparing with cache and current skills
   * This is the main method called on app startup
   */
  async scanAndDetectNewDiscoveries(): Promise<NewDiscovery[]> {
    console.log('[SkillSync] Starting background scan for new discoveries')

    // 1. Get cached scan results
    const cache = await this.getScanCache()

    // 2. Scan all external tools
    const scanResults = await toolScanner.scanExternalTools(this.syncContext.projectRoot)

    // 3. Get current DeepChat skills
    const existingSkills = await this.skillPresenter.getMetadataList()
    const existingSkillNames = new Set(existingSkills.map((s) => s.name))

    // 4. Compare and find new discoveries
    const newDiscoveries = this.compareWithCacheAndSkills(scanResults, cache, existingSkillNames)

    // 5. Save new cache
    await this.saveScanCache(scanResults)

    // 6. Emit event if there are new discoveries
    if (newDiscoveries.length > 0) {
      const totalNewSkills = newDiscoveries.reduce((sum, d) => sum + d.newSkills.length, 0)
      console.log(
        `[SkillSync] Found ${totalNewSkills} new skills from ${newDiscoveries.length} tools`
      )
      eventBus.sendToRenderer(SKILL_SYNC_EVENTS.NEW_DISCOVERIES, SendTarget.ALL_WINDOWS, {
        discoveries: newDiscoveries
      })
    } else {
      console.log('[SkillSync] No new discoveries found')
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
    const scanResults = await toolScanner.scanExternalTools(this.syncContext.projectRoot)
    const existingSkills = await this.skillPresenter.getMetadataList()
    const existingSkillNames = new Set(existingSkills.map((s) => s.name))

    return this.compareWithCacheAndSkills(scanResults, cache, existingSkillNames)
  }

  /**
   * Get both scan results and new discoveries in a single call
   * This is more efficient than calling scanExternalTools and getNewDiscoveries separately
   */
  async getToolsAndDiscoveries(): Promise<{ tools: ScanResult[]; discoveries: NewDiscovery[] }> {
    const cache = await this.getScanCache()
    const scanResults = await toolScanner.scanExternalTools(this.syncContext.projectRoot)
    const existingSkills = await this.skillPresenter.getMetadataList()
    const existingSkillNames = new Set(existingSkills.map((s) => s.name))

    const discoveries = this.compareWithCacheAndSkills(scanResults, cache, existingSkillNames)
    return { tools: scanResults, discoveries }
  }

  /**
   * Mark discoveries as acknowledged (update cache without showing them again)
   */
  async acknowledgeDiscoveries(): Promise<void> {
    const scanResults = await toolScanner.scanExternalTools(this.syncContext.projectRoot)
    await this.saveScanCache(scanResults)
  }

  // ============================================================================
  // Scanning Operations
  // ============================================================================

  /**
   * Scan all registered external tools for skills
   */
  async scanExternalTools(): Promise<ScanResult[]> {
    eventBus.sendToRenderer(SKILL_SYNC_EVENTS.SCAN_STARTED, SendTarget.ALL_WINDOWS, {})
    const results = await toolScanner.scanExternalTools(this.syncContext.projectRoot)
    eventBus.sendToRenderer(SKILL_SYNC_EVENTS.SCAN_COMPLETED, SendTarget.ALL_WINDOWS, { results })
    return results
  }

  /**
   * Scan a specific external tool for skills
   */
  async scanTool(toolId: string): Promise<ScanResult> {
    return toolScanner.scanTool(toolId, this.syncContext.projectRoot)
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
    const existingSkills = await this.skillPresenter.getMetadataList()
    const existingNames = new Set(existingSkills.map((s) => s.name))

    // Process each requested skill
    for (const skillName of skillNames) {
      const skillInfo = scanResult.skills.find((s) => s.name === skillName)
      if (!skillInfo) {
        continue
      }

      try {
        // Parse the external skill
        const skill = await this.parseExternalSkill(skillInfo, toolId)

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

  /**
   * Execute import operation with conflict strategies
   */
  async executeImport(
    previews: ImportPreview[],
    strategies: Record<string, ConflictStrategy>
  ): Promise<SyncResult> {
    // Security: Validate all strategies
    for (const [skillName, strategy] of Object.entries(strategies)) {
      if (!isValidConflictStrategy(strategy)) {
        console.warn(`Invalid conflict strategy for ${skillName}: ${strategy}`)
        return {
          success: false,
          imported: 0,
          exported: 0,
          skipped: 0,
          failed: [{ skill: skillName, reason: 'Invalid conflict strategy' }]
        }
      }
    }

    eventBus.sendToRenderer(SKILL_SYNC_EVENTS.IMPORT_STARTED, SendTarget.ALL_WINDOWS, {
      total: previews.length
    })

    const result: SyncResult = {
      success: true,
      imported: 0,
      exported: 0,
      skipped: 0,
      failed: []
    }

    let processed = 0
    for (const preview of previews) {
      const strategy = strategies[preview.skill.name] || ConflictStrategy.SKIP

      // Handle conflict based on strategy
      if (preview.conflict) {
        if (strategy === ConflictStrategy.SKIP) {
          result.skipped++
          processed++
          eventBus.sendToRenderer(SKILL_SYNC_EVENTS.IMPORT_PROGRESS, SendTarget.ALL_WINDOWS, {
            current: processed,
            total: previews.length,
            skillName: preview.skill.name,
            status: 'skipped'
          })
          continue
        }
      }

      try {
        // Determine target name (possibly renamed)
        let targetName = preview.skill.name
        if (preview.conflict && strategy === ConflictStrategy.RENAME) {
          targetName = await this.generateUniqueName(preview.skill.name)
          preview.skill.name = targetName
        }

        // Create temporary folder and install
        const tempDir = await this.createTempSkillFolder(preview.skill)

        const installResult = await this.skillPresenter.installFromFolder(tempDir, {
          overwrite: strategy === ConflictStrategy.OVERWRITE
        })

        // Cleanup temp folder
        await this.cleanupTempFolder(tempDir)

        if (installResult.success) {
          result.imported++
          processed++
          eventBus.sendToRenderer(SKILL_SYNC_EVENTS.IMPORT_PROGRESS, SendTarget.ALL_WINDOWS, {
            current: processed,
            total: previews.length,
            skillName: preview.skill.name,
            status: 'success'
          })
        } else {
          result.failed.push({
            skill: preview.skill.name,
            reason: installResult.error || 'Unknown error'
          })
          processed++
          eventBus.sendToRenderer(SKILL_SYNC_EVENTS.IMPORT_PROGRESS, SendTarget.ALL_WINDOWS, {
            current: processed,
            total: previews.length,
            skillName: preview.skill.name,
            status: 'failed'
          })
        }
      } catch (error) {
        result.failed.push({
          skill: preview.skill.name,
          reason: error instanceof Error ? error.message : String(error)
        })
        processed++
        eventBus.sendToRenderer(SKILL_SYNC_EVENTS.IMPORT_PROGRESS, SendTarget.ALL_WINDOWS, {
          current: processed,
          total: previews.length,
          skillName: preview.skill.name,
          status: 'failed'
        })
      }
    }

    result.success = result.failed.length === 0

    eventBus.sendToRenderer(SKILL_SYNC_EVENTS.IMPORT_COMPLETED, SendTarget.ALL_WINDOWS, { result })

    return result
  }

  // ============================================================================
  // Export Operations (DeepChat → External Tool)
  // ============================================================================

  /**
   * Preview export operation - convert skills and detect conflicts
   */
  async previewExport(
    skillNames: string[],
    targetToolId: string,
    options?: Record<string, unknown>
  ): Promise<ExportPreview[]> {
    console.log(`[SkillSync] Preview export: skills=${skillNames.join(', ')}, tool=${targetToolId}`)
    const previews: ExportPreview[] = []

    // Security: Validate tool ID
    if (!isValidToolId(targetToolId)) {
      console.warn(`[SkillSync] Invalid target tool ID: ${targetToolId}`)
      return []
    }

    const tool = toolScanner.getTool(targetToolId)
    if (!tool) {
      console.warn(`[SkillSync] Tool not found: ${targetToolId}`)
      return []
    }

    // Get target directory
    let targetDir: string
    try {
      targetDir = resolveSkillsDir(tool, this.syncContext.projectRoot)
      console.log(`[SkillSync] Target directory: ${targetDir}`)
    } catch (error) {
      console.error(`[SkillSync] Failed to resolve target directory:`, error)
      return []
    }

    // Check existing files in target
    const existingFiles = await this.getExistingFiles(targetDir, tool)

    // Process each skill
    for (const skillName of skillNames) {
      console.log(`[SkillSync] Processing skill: ${skillName}`)
      try {
        // Load skill from DeepChat
        const skill = await this.loadDeepChatSkill(skillName)
        if (!skill) {
          console.warn(`[SkillSync] Skill not found: ${skillName}`)
          previews.push({
            skillName,
            targetTool: targetToolId,
            targetPath: '',
            convertedContent: '',
            warnings: ['Skill not found'],
            conflict: undefined
          })
          continue
        }
        console.log(
          `[SkillSync] Loaded skill: ${skillName}, instructions length: ${skill.instructions?.length ?? 0}`
        )

        // Convert to target format with options
        const convertedContent = formatConverter.serializeToExternal(skill, targetToolId, options)
        console.log(`[SkillSync] Converted content length: ${convertedContent.length}`)

        // Determine target path
        const targetPath = this.getExportTargetPath(skillName, targetDir, tool)
        console.log(`[SkillSync] Target path: ${targetPath}`)

        // Check for conflicts
        const hasConflict = existingFiles.has(path.basename(targetPath))

        // Get conversion warnings
        const warnings = formatConverter
          .getConversionWarnings(skill, targetToolId)
          .map((w) => w.message)

        previews.push({
          skillName,
          targetTool: targetToolId,
          targetPath,
          convertedContent,
          warnings,
          conflict: hasConflict
            ? {
                existingPath: targetPath,
                strategy: ConflictStrategy.SKIP
              }
            : undefined,
          exportOptions: options
        })
      } catch (error) {
        previews.push({
          skillName,
          targetTool: targetToolId,
          targetPath: '',
          convertedContent: '',
          warnings: [`Export error: ${error instanceof Error ? error.message : String(error)}`],
          conflict: undefined
        })
      }
    }

    return previews
  }

  /**
   * Execute export operation with conflict strategies
   */
  async executeExport(
    previews: ExportPreview[],
    strategies: Record<string, ConflictStrategy>
  ): Promise<SyncResult> {
    // Security: Validate all strategies
    for (const [skillName, strategy] of Object.entries(strategies)) {
      if (!isValidConflictStrategy(strategy)) {
        console.warn(`Invalid conflict strategy for ${skillName}: ${strategy}`)
        return {
          success: false,
          imported: 0,
          exported: 0,
          skipped: 0,
          failed: [{ skill: skillName, reason: 'Invalid conflict strategy' }]
        }
      }
    }

    eventBus.sendToRenderer(SKILL_SYNC_EVENTS.EXPORT_STARTED, SendTarget.ALL_WINDOWS, {
      total: previews.length
    })

    const result: SyncResult = {
      success: true,
      imported: 0,
      exported: 0,
      skipped: 0,
      failed: []
    }

    let processed = 0
    for (const preview of previews) {
      if (!preview.targetPath || !preview.convertedContent) {
        console.error(
          `[SkillSync] Invalid export preview for ${preview.skillName}: targetPath=${preview.targetPath}, contentLength=${preview.convertedContent?.length ?? 0}`
        )
        result.failed.push({
          skill: preview.skillName,
          reason: `Invalid export preview (path: ${preview.targetPath ? 'ok' : 'missing'}, content: ${preview.convertedContent ? 'ok' : 'missing'})`
        })
        processed++
        eventBus.sendToRenderer(SKILL_SYNC_EVENTS.EXPORT_PROGRESS, SendTarget.ALL_WINDOWS, {
          current: processed,
          total: previews.length,
          skillName: preview.skillName,
          status: 'failed'
        })
        continue
      }

      const strategy = strategies[preview.skillName] || ConflictStrategy.SKIP

      // Handle conflict based on strategy
      if (preview.conflict) {
        if (strategy === ConflictStrategy.SKIP) {
          result.skipped++
          processed++
          eventBus.sendToRenderer(SKILL_SYNC_EVENTS.EXPORT_PROGRESS, SendTarget.ALL_WINDOWS, {
            current: processed,
            total: previews.length,
            skillName: preview.skillName,
            status: 'skipped'
          })
          continue
        }
      }

      try {
        let targetPath = preview.targetPath
        console.log(`[SkillSync] Exporting skill: ${preview.skillName} to ${targetPath}`)

        // Handle rename strategy
        if (preview.conflict && strategy === ConflictStrategy.RENAME) {
          targetPath = await this.generateUniqueFilePath(preview.targetPath)
          console.log(`[SkillSync] Renamed to: ${targetPath}`)
        }

        // Security: Check write permission
        if (!(await checkWritePermission(targetPath))) {
          const err = `No write permission for: ${targetPath}`
          console.error(`[SkillSync] ${err}`)
          throw new Error(err)
        }

        // Ensure target directory exists
        const targetDir = path.dirname(targetPath)
        console.log(`[SkillSync] Creating directory: ${targetDir}`)
        await fs.promises.mkdir(targetDir, { recursive: true })

        // Write the file
        console.log(`[SkillSync] Writing file, content length: ${preview.convertedContent.length}`)
        await fs.promises.writeFile(targetPath, preview.convertedContent, 'utf-8')
        console.log(`[SkillSync] Successfully exported: ${preview.skillName}`)

        result.exported++
        processed++
        eventBus.sendToRenderer(SKILL_SYNC_EVENTS.EXPORT_PROGRESS, SendTarget.ALL_WINDOWS, {
          current: processed,
          total: previews.length,
          skillName: preview.skillName,
          status: 'success'
        })
      } catch (error) {
        const reason = error instanceof Error ? error.message : String(error)
        console.error(`[SkillSync] Export failed for ${preview.skillName}:`, error)
        result.failed.push({
          skill: preview.skillName,
          reason
        })
        processed++
        eventBus.sendToRenderer(SKILL_SYNC_EVENTS.EXPORT_PROGRESS, SendTarget.ALL_WINDOWS, {
          current: processed,
          total: previews.length,
          skillName: preview.skillName,
          status: 'failed'
        })
      }
    }

    result.success = result.failed.length === 0
    console.log(
      `[SkillSync] Export completed: ${result.exported} exported, ${result.skipped} skipped, ${result.failed.length} failed`
    )

    eventBus.sendToRenderer(SKILL_SYNC_EVENTS.EXPORT_COMPLETED, SendTarget.ALL_WINDOWS, { result })

    return result
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

  /**
   * Parse an external skill file
   */
  private async parseExternalSkill(
    skillInfo: ExternalSkillInfo,
    toolId: string
  ): Promise<CanonicalSkill> {
    const tool = toolScanner.getTool(toolId)
    if (!tool) {
      throw new Error(`Unknown tool: ${toolId}`)
    }

    let filePath: string
    let folderPath: string | undefined

    if (tool.filePattern.includes('/')) {
      // Subfolder pattern - path is folder, main file is inside
      folderPath = skillInfo.path
      const fileName = tool.filePattern.split('/').pop() || 'SKILL.md'
      filePath = path.join(skillInfo.path, fileName)
    } else {
      // Single file pattern
      filePath = skillInfo.path
      folderPath = path.dirname(skillInfo.path)
    }

    const content = await fs.promises.readFile(filePath, 'utf-8')

    return formatConverter.parseExternal(
      content,
      { toolId, filePath, folderPath },
      { includeSubfolders: tool.capabilities.supportsSubfolders }
    )
  }

  /**
   * Load a DeepChat skill for export
   */
  private async loadDeepChatSkill(skillName: string): Promise<CanonicalSkill | null> {
    console.log(`[SkillSync] loadDeepChatSkill: ${skillName}`)
    const metadata = await this.skillPresenter.getMetadataList()
    console.log(`[SkillSync] Available skills: ${metadata.map((s) => s.name).join(', ')}`)
    const skillMeta = metadata.find((s) => s.name === skillName)
    if (!skillMeta) {
      console.warn(`[SkillSync] Skill metadata not found: ${skillName}`)
      return null
    }
    console.log(
      `[SkillSync] Found skill metadata: path=${skillMeta.path}, root=${skillMeta.skillRoot}`
    )

    const content = await this.skillPresenter.loadSkillContent(skillName)
    if (!content) {
      console.warn(`[SkillSync] Skill content not loaded: ${skillName}`)
      return null
    }
    console.log(`[SkillSync] Loaded skill content, length: ${content.content.length}`)

    // Parse the DeepChat skill (Claude Code format)
    const skillFilePath = skillMeta.path
    const folderPath = skillMeta.skillRoot

    try {
      const fileContent = await fs.promises.readFile(skillFilePath, 'utf-8')
      console.log(`[SkillSync] Read skill file, length: ${fileContent.length}`)
      return formatConverter.parseExternal(
        fileContent,
        { toolId: 'claude-code', filePath: skillFilePath, folderPath },
        { includeSubfolders: true }
      )
    } catch (error) {
      console.error(`[SkillSync] Failed to read/parse skill file:`, error)
      return null
    }
  }

  /**
   * Create a temporary skill folder for import
   */
  private async createTempSkillFolder(skill: CanonicalSkill): Promise<string> {
    const tempDir = path.join(app.getPath('temp'), `deepchat-skill-${Date.now()}-${skill.name}`)
    await fs.promises.mkdir(tempDir, { recursive: true })

    // Write SKILL.md
    const skillMdContent = formatConverter.serializeToSkillMd(skill)
    await fs.promises.writeFile(path.join(tempDir, 'SKILL.md'), skillMdContent, 'utf-8')

    // Write references if any
    if (skill.references && skill.references.length > 0) {
      const refsDir = path.join(tempDir, 'references')
      await fs.promises.mkdir(refsDir, { recursive: true })
      for (const ref of skill.references) {
        await fs.promises.writeFile(path.join(refsDir, ref.name), ref.content, 'utf-8')
      }
    }

    // Write scripts if any
    if (skill.scripts && skill.scripts.length > 0) {
      const scriptsDir = path.join(tempDir, 'scripts')
      await fs.promises.mkdir(scriptsDir, { recursive: true })
      for (const script of skill.scripts) {
        await fs.promises.writeFile(path.join(scriptsDir, script.name), script.content, 'utf-8')
      }
    }

    return tempDir
  }

  /**
   * Cleanup temporary folder
   */
  private async cleanupTempFolder(folderPath: string): Promise<void> {
    try {
      await fs.promises.rm(folderPath, { recursive: true, force: true })
    } catch {
      // Ignore cleanup errors
    }
  }

  /**
   * Generate a unique skill name
   */
  private async generateUniqueName(baseName: string): Promise<string> {
    const metadata = await this.skillPresenter.getMetadataList()
    const existingNames = new Set(metadata.map((s) => s.name))

    let counter = 1
    let newName = `${baseName}-${counter}`
    while (existingNames.has(newName)) {
      counter++
      newName = `${baseName}-${counter}`
    }

    return newName
  }

  /**
   * Generate a unique file path
   */
  private async generateUniqueFilePath(basePath: string): Promise<string> {
    const ext = path.extname(basePath)
    const base = basePath.slice(0, -ext.length)

    let counter = 1
    let newPath = `${base}-${counter}${ext}`
    while (await this.fileExists(newPath)) {
      counter++
      newPath = `${base}-${counter}${ext}`
    }

    return newPath
  }

  /**
   * Check if file exists
   */
  private async fileExists(filePath: string): Promise<boolean> {
    try {
      await fs.promises.access(filePath)
      return true
    } catch {
      return false
    }
  }

  /**
   * Get existing files in target directory
   */
  private async getExistingFiles(
    targetDir: string,
    _tool: ExternalToolConfig
  ): Promise<Set<string>> {
    const files = new Set<string>()

    try {
      const entries = await fs.promises.readdir(targetDir, { withFileTypes: true })
      for (const entry of entries) {
        if (entry.isFile() || entry.isDirectory()) {
          files.add(entry.name)
        }
      }
    } catch {
      // Directory doesn't exist yet
    }

    return files
  }

  /**
   * Get export target path for a skill
   */
  private getExportTargetPath(
    skillName: string,
    targetDir: string,
    tool: ExternalToolConfig
  ): string {
    if (tool.filePattern.includes('/')) {
      // Subfolder pattern - create folder with SKILL.md inside
      const fileName = tool.filePattern.split('/').pop() || 'SKILL.md'
      return path.join(targetDir, skillName, fileName)
    } else {
      // Single file pattern
      const extension = this.getFileExtension(tool.filePattern)
      return path.join(targetDir, `${skillName}${extension}`)
    }
  }

  /**
   * Get file extension from pattern
   */
  private getFileExtension(pattern: string): string {
    const match = pattern.match(/\*(\.[a-z.]+)$/)
    return match ? match[1] : '.md'
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
