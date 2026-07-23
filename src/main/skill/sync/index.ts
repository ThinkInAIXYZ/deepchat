import logger from '@shared/logger'
/**
 * SkillSyncService manages Skill synchronization.
 *
 * Coordinates:
 * - Scanning external tools for skills
 * - Converting between formats
 * - Importing skills from external tools to DeepChat
 * - Exporting skills from DeepChat to external tools
 */

import * as fs from 'fs'
import * as path from 'path'
import { randomUUID } from 'node:crypto'
import { app } from 'electron'
import matter from 'gray-matter'
import type {
  SkillSyncServicePort,
  ExternalToolConfig,
  ScanResult,
  ImportPreview,
  ExportPreview,
  SyncResult,
  CanonicalSkill,
  ExternalSkillInfo,
  ScanCache,
  NewDiscovery,
  InstalledSkillAgent,
  InstalledSkillAgentDetail,
  AgentSkillItem,
  AdoptAgentSkillInput,
  AdoptAgentSkillPreview,
  AdoptAgentSkillResult,
  AgentSkillLinkInput,
  LinkDeepChatSkillResult,
  LinkDeepChatSkillsInput,
  LinkDeepChatSkillsPreview,
  LinkDeepChatSkillsResult,
  SkillDetail
} from '@shared/types/skillSync'
import { ConflictStrategy } from '@shared/types/skillSync'
import type { AgentLinkInfo, UnifiedSkillItem } from '@shared/types/skillManagement'
import type { SkillServicePort } from '@shared/types/skill'
import type { SkillSettingsPort } from '../settings'
import { toolScanner, resolveSkillsDir } from './toolScanner'
import { formatConverter } from './formatConverter'
import type { SyncContext } from './types'
import type { DeepchatEventPublisher, DeepchatEventPayload } from '@shared/contracts/events'
import {
  isValidToolId,
  isValidConflictStrategy,
  checkWritePermission,
  checkReadPermission,
  isFilenameSafe,
  MAX_SUBFOLDER_FILE_SIZE,
  MAX_SKILL_FOLDER_SIZE
} from './security'
import { scanAndDetectDiscoveriesInWorker, scanExternalToolsInWorker } from './scanWorker'

const SKILL_NAME_PATTERN = /^[a-z0-9][a-z0-9._-]*$/
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
  | 'skillSync.import.started'
  | 'skillSync.import.progress'
  | 'skillSync.import.completed'
  | 'skillSync.export.started'
  | 'skillSync.export.progress'
  | 'skillSync.export.completed'

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
    const existingSkills = await this.skillService.getMetadataList()
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
    const existingSkills = await this.skillService.getMetadataList()
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
    const existingSkills = await this.skillService.getMetadataList()
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
    const existingSkills = await this.skillService.getMetadataList()
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

    this.publishSkillSyncEvent('skillSync.import.started', {
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
          this.publishSkillSyncEvent('skillSync.import.progress', {
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

        const installResult = await this.skillService.installFromFolder(tempDir, {
          overwrite: strategy === ConflictStrategy.OVERWRITE
        })

        // Cleanup temp folder
        await this.cleanupTempFolder(tempDir)

        if (installResult.success) {
          result.imported++
          processed++
          this.publishSkillSyncEvent('skillSync.import.progress', {
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
          this.publishSkillSyncEvent('skillSync.import.progress', {
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
        this.publishSkillSyncEvent('skillSync.import.progress', {
          current: processed,
          total: previews.length,
          skillName: preview.skill.name,
          status: 'failed'
        })
      }
    }

    result.success = result.failed.length === 0

    this.publishSkillSyncEvent('skillSync.import.completed', { result })

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
    logger.info(`[SkillSync] Preview export: skills=${skillNames.join(', ')}, tool=${targetToolId}`)
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
      logger.info(`[SkillSync] Target directory: ${targetDir}`)
    } catch (error) {
      console.error(`[SkillSync] Failed to resolve target directory:`, error)
      return []
    }

    // Check existing files in target
    const existingFiles = await this.getExistingFiles(targetDir, tool)

    // Process each skill
    for (const skillName of skillNames) {
      logger.info(`[SkillSync] Processing skill: ${skillName}`)
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
        logger.info(
          `[SkillSync] Loaded skill: ${skillName}, instructions length: ${skill.instructions?.length ?? 0}`
        )

        // Convert to target format with options
        const convertedContent = formatConverter.serializeToExternal(skill, targetToolId, options)
        logger.info(`[SkillSync] Converted content length: ${convertedContent.length}`)

        // Determine target path
        const targetPath = this.getExportTargetPath(skillName, targetDir, tool)
        logger.info(`[SkillSync] Target path: ${targetPath}`)

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

    this.publishSkillSyncEvent('skillSync.export.started', {
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
        this.publishSkillSyncEvent('skillSync.export.progress', {
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
          this.publishSkillSyncEvent('skillSync.export.progress', {
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
        logger.info(`[SkillSync] Exporting skill: ${preview.skillName} to ${targetPath}`)

        // Handle rename strategy
        if (preview.conflict && strategy === ConflictStrategy.RENAME) {
          targetPath = await this.generateUniqueFilePath(preview.targetPath)
          logger.info(`[SkillSync] Renamed to: ${targetPath}`)
        }

        // Security: Check write permission
        if (!(await checkWritePermission(targetPath))) {
          const err = `No write permission for: ${targetPath}`
          console.error(`[SkillSync] ${err}`)
          throw new Error(err)
        }

        // Ensure target directory exists
        const targetDir = path.dirname(targetPath)
        logger.info(`[SkillSync] Creating directory: ${targetDir}`)
        await fs.promises.mkdir(targetDir, { recursive: true })

        // Write the file
        logger.info(`[SkillSync] Writing file, content length: ${preview.convertedContent.length}`)
        await fs.promises.writeFile(targetPath, preview.convertedContent, 'utf-8')
        logger.info(`[SkillSync] Successfully exported: ${preview.skillName}`)

        result.exported++
        processed++
        this.publishSkillSyncEvent('skillSync.export.progress', {
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
        this.publishSkillSyncEvent('skillSync.export.progress', {
          current: processed,
          total: previews.length,
          skillName: preview.skillName,
          status: 'failed'
        })
      }
    }

    result.success = result.failed.length === 0
    logger.info(
      `[SkillSync] Export completed: ${result.exported} exported, ${result.skipped} skipped, ${result.failed.length} failed`
    )

    this.publishSkillSyncEvent('skillSync.export.completed', { result })

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

  async scanSkillAgents(): Promise<InstalledSkillAgent[]> {
    const results = await this.scanExternalToolsWithFallback()
    const resultByTool = new Map(results.map((result) => [result.toolId, result]))
    const agents: InstalledSkillAgent[] = []

    for (const tool of this.getManageableAgentTools()) {
      const result =
        resultByTool.get(tool.id) ??
        (await toolScanner.scanTool(tool.id, this.syncContext.projectRoot))
      const detail = await this.buildAgentDetail(tool, result)
      const { skills: _skills, ...summary } = detail
      agents.push(summary)
    }

    return agents
  }

  async scanSkillAgent(input: { agentId: string }): Promise<InstalledSkillAgentDetail> {
    const tool = toolScanner.getTool(input.agentId)
    if (!tool || !this.canManageAgentLinks(tool)) {
      return {
        id: input.agentId,
        name: input.agentId,
        skillsDir: '',
        isCustom: false,
        supportsLinkManagement: false,
        skillsCount: 0,
        linkedCount: 0,
        agentOwnedCount: 0,
        conflictCount: 0,
        brokenLinkCount: 0,
        status: 'detected-no-skills-dir',
        skills: []
      }
    }

    return this.buildAgentDetail(
      tool,
      await toolScanner.scanTool(tool.id, this.syncContext.projectRoot)
    )
  }

  async getAgentSkillDetail(input: { agentId: string; skillName: string }): Promise<SkillDetail> {
    const detail = await this.scanSkillAgent({ agentId: input.agentId })
    const skill = detail.skills.find((item) => item.name === input.skillName)
    if (!skill) {
      throw new Error(`Skill "${input.skillName}" not found in ${detail.name}`)
    }

    const markdownPath = path.join(skill.path, 'SKILL.md')
    const markdownStats = await fs.promises.lstat(markdownPath)
    if (markdownStats.isSymbolicLink()) {
      throw new Error(`External Skill manifest is a symbolic link: ${markdownPath}`)
    }
    if (!markdownStats.isFile()) {
      throw new Error(`External Skill manifest is not a file: ${markdownPath}`)
    }
    if (markdownStats.size > MAX_SUBFOLDER_FILE_SIZE) {
      throw new Error(
        `External Skill manifest is too large: ${markdownStats.size} bytes (max: ${MAX_SUBFOLDER_FILE_SIZE})`
      )
    }
    const markdown = await fs.promises.readFile(markdownPath, 'utf-8')
    return {
      name: skill.name,
      description: skill.description ?? '',
      sourcePath: markdownPath,
      markdown,
      mutable: skill.owner !== 'broken-link'
    }
  }

  async previewAdoptAgentSkill(input: AdoptAgentSkillInput): Promise<AdoptAgentSkillPreview> {
    const adoption = await this.resolveAdoptionSource(input)
    await this.readAdoptableSkill(adoption.sourcePath)

    const skillsDir = path.resolve(await this.skillService.getSkillsDir())
    const deepchatSkills = await this.skillService.getUnifiedSkillCatalog()
    const deepchatNames = new Set(deepchatSkills.map((skill) => skill.name))
    const defaultTargetName = adoption.skill.name
    const hasConflict =
      deepchatNames.has(defaultTargetName) ||
      (await this.pathExists(path.join(skillsDir, defaultTargetName)))
    const targetName =
      input.targetName ??
      (hasConflict
        ? await this.generateAdoptionTargetName(
            `${defaultTargetName}-${input.agentId}`,
            skillsDir,
            deepchatNames
          )
        : defaultTargetName)

    this.assertValidDeepChatSkillName(targetName)
    if (
      deepchatNames.has(targetName) ||
      (await this.pathExists(path.join(skillsDir, targetName)))
    ) {
      throw new Error(`Skill "${targetName}" already exists`)
    }

    const dataRoot = path.dirname(skillsDir)
    const targetPath = path.join(skillsDir, targetName)

    return {
      agentId: input.agentId,
      agentName: adoption.agent.name,
      skillName: adoption.skill.name,
      targetName,
      sourcePath: adoption.sourcePath,
      agentPath: adoption.agentPath,
      targetPath,
      backupRoot: path.join(
        dataRoot,
        'backups',
        'skill-adoptions',
        input.agentId,
        adoption.skill.name
      ),
      conflict: hasConflict,
      warnings:
        targetName === adoption.skill.name ? [] : [`Skill will be adopted as "${targetName}"`]
    }
  }

  async executeAdoptAgentSkill(input: AdoptAgentSkillInput): Promise<AdoptAgentSkillResult> {
    let tempPath = ''
    let targetCreated = false
    let originalMoved = false
    let preview: AdoptAgentSkillPreview | undefined
    let backupPath = ''

    try {
      preview = await this.previewAdoptAgentSkill(input)
      const operationId = `${Date.now()}-${randomUUID()}`
      const dataRoot = path.dirname(path.resolve(await this.skillService.getSkillsDir()))
      tempPath = path.join(dataRoot, 'tmp', 'skill-adoptions', operationId)
      backupPath = path.join(preview.backupRoot, operationId)

      await fs.promises.mkdir(path.dirname(tempPath), { recursive: true })
      await fs.promises.mkdir(path.dirname(backupPath), { recursive: true })
      await this.prepareAdoptionTemp(preview.sourcePath, tempPath, preview.targetName)

      if (await this.pathExists(preview.targetPath)) {
        throw new Error(`Skill "${preview.targetName}" already exists`)
      }

      await fs.promises.mkdir(path.dirname(preview.targetPath), { recursive: true })
      await fs.promises.rename(tempPath, preview.targetPath)
      targetCreated = true

      try {
        await fs.promises.rename(preview.agentPath, backupPath)
        originalMoved = true
        await this.createDirectoryLink(preview.targetPath, preview.agentPath)
      } catch (error) {
        if (originalMoved && !(await this.pathExists(preview.agentPath))) {
          await fs.promises.rename(backupPath, preview.agentPath).catch(() => undefined)
        }
        if (targetCreated) {
          await fs.promises.rm(preview.targetPath, { recursive: true, force: true })
        }
        throw error
      }

      await this.skillService.registerAdoptedSkill({
        name: preview.targetName,
        canonicalPath: preview.targetPath,
        agentId: preview.agentId,
        agentPath: preview.agentPath,
        originalPath: preview.sourcePath
      })

      return {
        success: true,
        skillName: preview.targetName,
        targetPath: preview.targetPath,
        agentPath: preview.agentPath,
        backupPath
      }
    } catch (error) {
      if (tempPath) {
        await fs.promises.rm(tempPath, { recursive: true, force: true }).catch(() => undefined)
      }
      return {
        success: false,
        skillName: preview?.targetName,
        targetPath: preview?.targetPath,
        agentPath: preview?.agentPath,
        backupPath: backupPath || undefined,
        error: error instanceof Error ? error.message : String(error)
      }
    }
  }

  async previewLinkDeepChatSkills(
    input: LinkDeepChatSkillsInput
  ): Promise<LinkDeepChatSkillsPreview> {
    const tool = this.resolveManageableAgentTool(input.agentId)
    const detail = await this.scanSkillAgent({ agentId: input.agentId })
    const skillsDir = detail.skillsDir || resolveSkillsDir(tool, this.syncContext.projectRoot)
    const existingByName = new Map(detail.skills.map((skill) => [skill.name, skill]))
    const deepchatByName = new Map(
      (await this.skillService.getUnifiedSkillCatalog()).map((skill) => [skill.name, skill])
    )

    return {
      agentId: input.agentId,
      agentName: tool.name,
      skillsDir,
      items: await Promise.all(
        [...new Set(input.skillNames)].map(async (skillName) => {
          this.assertValidDeepChatSkillName(skillName)
          const deepchat = deepchatByName.get(skillName)
          const targetPath = path.join(skillsDir, skillName)
          if (!deepchat) {
            return {
              skillName,
              targetPath,
              status: 'missing',
              message: `Skill "${skillName}" not found in DeepChat`
            }
          }

          const existing = existingByName.get(skillName)
          if (!existing) {
            return {
              skillName,
              sourcePath: deepchat.skillRoot,
              targetPath,
              status: 'ready'
            }
          }

          if (
            existing.status === 'linked' &&
            existing.link?.targetPath &&
            path.resolve(existing.link.targetPath) === path.resolve(deepchat.skillRoot)
          ) {
            return {
              skillName,
              sourcePath: deepchat.skillRoot,
              targetPath,
              status: 'already-linked'
            }
          }

          return {
            skillName,
            sourcePath: deepchat.skillRoot,
            targetPath,
            status: 'conflict',
            message: `Agent path already exists: ${targetPath}`
          }
        })
      )
    }
  }

  async executeLinkDeepChatSkills(
    input: LinkDeepChatSkillsInput
  ): Promise<LinkDeepChatSkillsResult> {
    const preview = await this.previewLinkDeepChatSkills(input)
    const result: LinkDeepChatSkillsResult = {
      success: true,
      linked: 0,
      skipped: 0,
      failed: []
    }

    await fs.promises.mkdir(preview.skillsDir, { recursive: true })
    if (!(await checkWritePermission(preview.skillsDir))) {
      return {
        success: false,
        linked: 0,
        skipped: 0,
        failed: input.skillNames.map((skillName) => ({
          skillName,
          reason: `No write permission for: ${preview.skillsDir}`
        }))
      }
    }

    for (const item of preview.items) {
      if (item.status === 'already-linked') {
        result.skipped += 1
        continue
      }
      if (item.status !== 'ready' || !item.sourcePath) {
        result.skipped += 1
        continue
      }

      try {
        await this.createDirectoryLink(item.sourcePath, item.targetPath)
        await this.skillService.registerAgentSkillLink({
          skillName: item.skillName,
          agentId: input.agentId,
          agentPath: item.targetPath
        })
        result.linked += 1
      } catch (error) {
        result.failed.push({
          skillName: item.skillName,
          reason: error instanceof Error ? error.message : String(error)
        })
      }
    }

    result.success = result.failed.length === 0
    return result
  }

  async repairAgentSkillLink(input: AgentSkillLinkInput): Promise<LinkDeepChatSkillResult> {
    try {
      const link = await this.resolveDeepChatOwnedAgentLink(input)
      await this.assertAgentPathIsLinkOrMissing(link.agentPath)
      await fs.promises.rm(link.agentPath, { recursive: true, force: true })
      await this.createDirectoryLink(link.targetPath, link.agentPath)
      await this.skillService.registerAgentSkillLink({
        skillName: input.skillName,
        agentId: input.agentId,
        agentPath: link.agentPath
      })
      return {
        success: true,
        skillName: input.skillName,
        agentPath: link.agentPath,
        targetPath: link.targetPath
      }
    } catch (error) {
      return {
        success: false,
        skillName: input.skillName,
        error: error instanceof Error ? error.message : String(error)
      }
    }
  }

  async removeAgentSkillLink(input: AgentSkillLinkInput): Promise<LinkDeepChatSkillResult> {
    try {
      const link = await this.resolveDeepChatOwnedAgentLink(input)
      await this.assertAgentPathIsLinkOrMissing(link.agentPath)
      await fs.promises.rm(link.agentPath, { recursive: true, force: true })
      await this.skillService.removeAgentSkillLink(input)
      return {
        success: true,
        skillName: input.skillName,
        agentPath: link.agentPath,
        targetPath: link.targetPath
      }
    } catch (error) {
      return {
        success: false,
        skillName: input.skillName,
        error: error instanceof Error ? error.message : String(error)
      }
    }
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

  private async resolveAdoptionSource(input: AdoptAgentSkillInput): Promise<{
    agent: InstalledSkillAgentDetail
    skill: AgentSkillItem
    sourcePath: string
    agentPath: string
  }> {
    const tool = toolScanner.getTool(input.agentId)
    if (!tool || !this.canManageAgentLinks(tool)) {
      throw new Error(`Agent "${input.agentId}" does not support skill adoption`)
    }

    const agent = await this.scanSkillAgent({ agentId: input.agentId })
    const skill = agent.skills.find((item) => item.name === input.skillName)
    if (!skill) {
      throw new Error(`Skill "${input.skillName}" not found in ${agent.name}`)
    }
    if (!['agent-owned', 'linked-out', 'conflict'].includes(skill.status)) {
      throw new Error(`Skill "${input.skillName}" cannot be adopted from status "${skill.status}"`)
    }
    if (!this.isInsideDirectory(skill.path, agent.skillsDir)) {
      throw new Error(`Agent path escapes skills directory: ${skill.path}`)
    }

    const sourcePath = skill.status === 'linked-out' ? skill.link?.targetPath : skill.path
    if (!sourcePath) {
      throw new Error(`Skill "${input.skillName}" source path is unavailable`)
    }
    if (!(await checkReadPermission(sourcePath))) {
      throw new Error(`No read permission for: ${sourcePath}`)
    }

    return {
      agent,
      skill,
      sourcePath,
      agentPath: skill.path
    }
  }

  private resolveManageableAgentTool(agentId: string): ExternalToolConfig {
    const tool = toolScanner.getTool(agentId)
    if (!tool || !this.canManageAgentLinks(tool)) {
      throw new Error(`Agent "${agentId}" does not support skill links`)
    }
    return tool
  }

  private async resolveDeepChatOwnedAgentLink(input: AgentSkillLinkInput): Promise<{
    agentPath: string
    targetPath: string
  }> {
    this.assertValidDeepChatSkillName(input.skillName)
    const tool = this.resolveManageableAgentTool(input.agentId)
    const skillsDir = resolveSkillsDir(tool, this.syncContext.projectRoot)
    const state = await this.skillService.getSkillManagementState()
    const link =
      state.agents?.deepchat?.skills[input.skillName]?.agentLinks?.[input.agentId] ??
      // Compatibility for persisted v1 state during the scoped-Skill migration.
      (
        state as unknown as {
          skills?: Record<string, { agentLinks?: Record<string, AgentLinkInfo> }>
        }
      ).skills?.[input.skillName]?.agentLinks?.[input.agentId]
    if (!link?.createdByDeepChat) {
      throw new Error(`Link for "${input.skillName}" was not created by DeepChat`)
    }

    const deepchat = (await this.skillService.getUnifiedSkillCatalog()).find(
      (skill) => skill.name === input.skillName
    )
    if (!deepchat || !(await this.pathExists(deepchat.skillRoot))) {
      throw new Error(`DeepChat skill "${input.skillName}" not found`)
    }

    if (!this.isInsideDirectory(link.path, skillsDir)) {
      throw new Error(`Agent link path escapes skills directory: ${link.path}`)
    }

    return {
      agentPath: link.path,
      targetPath: deepchat.skillRoot
    }
  }

  private async assertAgentPathIsLinkOrMissing(agentPath: string): Promise<void> {
    try {
      await fs.promises.readlink(agentPath)
      return
    } catch {
      if (await this.pathExists(agentPath)) {
        throw new Error(`Agent path is not a link: ${agentPath}`)
      }
    }
  }

  private async readAdoptableSkill(skillRoot: string): Promise<{
    name: string
    description: string
    parsed: matter.GrayMatterFile<string>
  }> {
    const skillPath = path.join(skillRoot, 'SKILL.md')
    const content = await fs.promises.readFile(skillPath, 'utf-8')
    const parsed = matter(content)
    const name = typeof parsed.data.name === 'string' ? parsed.data.name.trim() : ''
    const description =
      typeof parsed.data.description === 'string' ? parsed.data.description.trim() : ''
    if (!description) {
      throw new Error('Skill description not found in SKILL.md frontmatter')
    }
    return { name, description, parsed }
  }

  private assertValidDeepChatSkillName(name: string): void {
    if (!SKILL_NAME_PATTERN.test(name) || name.includes('/') || name.includes('\\')) {
      throw new Error(`Invalid skill name: ${name}`)
    }
  }

  private async generateAdoptionTargetName(
    baseName: string,
    skillsDir: string,
    existingNames: Set<string>
  ): Promise<string> {
    this.assertValidDeepChatSkillName(baseName)
    let candidate = baseName
    let counter = 2
    while (
      existingNames.has(candidate) ||
      (await this.pathExists(path.join(skillsDir, candidate)))
    ) {
      candidate = `${baseName}-${counter}`
      counter += 1
    }
    return candidate
  }

  private async prepareAdoptionTemp(
    sourcePath: string,
    tempPath: string,
    targetName: string
  ): Promise<void> {
    await fs.promises.rm(tempPath, { recursive: true, force: true })
    await this.copyDirectoryWithoutSymlinks(sourcePath, tempPath)
    const copied = await this.readAdoptableSkill(tempPath)
    if (copied.name !== targetName) {
      copied.parsed.data.name = targetName
      await fs.promises.writeFile(
        path.join(tempPath, 'SKILL.md'),
        matter.stringify(copied.parsed.content, copied.parsed.data),
        'utf-8'
      )
    }
  }

  private async copyDirectoryWithoutSymlinks(
    sourcePath: string,
    targetPath: string
  ): Promise<void> {
    await fs.promises.mkdir(targetPath, { recursive: true })
    const entries = await fs.promises.readdir(sourcePath, { withFileTypes: true })
    for (const entry of entries) {
      if (entry.isSymbolicLink() || entry.name === '.deepchat-meta') {
        continue
      }
      const sourceEntry = path.join(sourcePath, entry.name)
      const targetEntry = path.join(targetPath, entry.name)
      if (entry.isDirectory()) {
        await this.copyDirectoryWithoutSymlinks(sourceEntry, targetEntry)
      } else if (entry.isFile()) {
        await fs.promises.copyFile(sourceEntry, targetEntry)
      }
    }
  }

  private async createDirectoryLink(targetPath: string, linkPath: string): Promise<void> {
    await fs.promises.symlink(
      targetPath,
      linkPath,
      process.platform === 'win32' ? 'junction' : 'dir'
    )
  }

  private getManageableAgentTools(): ExternalToolConfig[] {
    return toolScanner.getAllTools().filter((tool) => this.canManageAgentLinks(tool))
  }

  private canManageAgentLinks(tool: ExternalToolConfig): boolean {
    return (
      !tool.isProjectLevel &&
      tool.filePattern === '*/SKILL.md' &&
      tool.capabilities.supportsSubfolders
    )
  }

  private async buildAgentDetail(
    tool: ExternalToolConfig,
    result: ScanResult
  ): Promise<InstalledSkillAgentDetail> {
    if (!result.available) {
      return this.createAgentDetail(
        tool,
        result.skillsDir || tool.skillsDir,
        'detected-no-skills-dir',
        []
      )
    }

    const skills = await this.classifyAgentSkills(result)
    const status = skills.some((skill) => skill.status === 'empty') ? 'permission-denied' : 'ready'
    return this.createAgentDetail(
      tool,
      result.skillsDir,
      status,
      skills.filter((skill) => skill.status !== 'empty')
    )
  }

  private createAgentDetail(
    tool: ExternalToolConfig,
    skillsDir: string,
    status: InstalledSkillAgent['status'],
    skills: AgentSkillItem[]
  ): InstalledSkillAgentDetail {
    return {
      id: tool.id,
      name: tool.name,
      skillsDir,
      isCustom: false,
      supportsLinkManagement: this.canManageAgentLinks(tool),
      skillsCount: skills.length,
      linkedCount: skills.filter((skill) => skill.status === 'linked').length,
      agentOwnedCount: skills.filter((skill) => skill.status === 'agent-owned').length,
      conflictCount: skills.filter((skill) => skill.status === 'conflict').length,
      brokenLinkCount: skills.filter((skill) => skill.status === 'broken-link').length,
      status,
      skills
    }
  }

  private async classifyAgentSkills(result: ScanResult): Promise<AgentSkillItem[]> {
    const deepchatSkills = await this.skillService.getUnifiedSkillCatalog()
    const deepchatByName = new Map(deepchatSkills.map((skill) => [skill.name, skill]))
    const deepchatSkillsDir = path.resolve(await this.skillService.getSkillsDir())
    const scannedByPath = new Map(result.skills.map((skill) => [path.resolve(skill.path), skill]))

    let entries: fs.Dirent[]
    try {
      entries = await fs.promises.readdir(result.skillsDir, { withFileTypes: true })
    } catch (error) {
      const code = typeof error === 'object' && error ? (error as { code?: unknown }).code : null
      if (code === 'EACCES' || code === 'EPERM') {
        return [
          {
            name: result.toolId,
            path: result.skillsDir,
            owner: 'unknown',
            status: 'empty'
          }
        ]
      }
      return []
    }

    const skills: AgentSkillItem[] = []
    for (const entry of entries) {
      if (!isFilenameSafe(entry.name) || (!entry.isDirectory() && !entry.isSymbolicLink())) {
        continue
      }

      const entryPath = path.join(result.skillsDir, entry.name)
      if (entry.isSymbolicLink()) {
        skills.push(
          await this.classifyAgentSkillLink(
            result.toolId,
            entry.name,
            entryPath,
            deepchatSkillsDir,
            deepchatByName
          )
        )
        continue
      }

      const scanInfo = scannedByPath.get(path.resolve(entryPath))
      if (!scanInfo) {
        continue
      }
      skills.push(await this.classifyAgentSkillDirectory(scanInfo, deepchatByName))
    }

    return skills.sort((left, right) => left.name.localeCompare(right.name))
  }

  private async classifyAgentSkillDirectory(
    skill: ExternalSkillInfo,
    deepchatByName: Map<string, UnifiedSkillItem>
  ): Promise<AgentSkillItem> {
    const deepchat = deepchatByName.get(skill.name)
    if (!deepchat) {
      return {
        name: skill.name,
        description: skill.description,
        path: skill.path,
        owner: 'agent',
        status: 'agent-owned',
        action: 'adopt',
        deepchat: { exists: false }
      }
    }

    const sameContent = await this.hasSameSkillContent(skill.path, deepchat.skillRoot)
    return {
      name: skill.name,
      description: skill.description || deepchat.description,
      path: skill.path,
      owner: 'agent',
      status: sameContent ? 'agent-owned' : 'conflict',
      action: sameContent ? 'adopt' : 'resolve-conflict',
      deepchat: {
        exists: true,
        path: deepchat.skillRoot,
        disabled: deepchat.deepchatDisabled,
        sameContent
      }
    }
  }

  private async classifyAgentSkillLink(
    agentId: string,
    name: string,
    linkPath: string,
    deepchatSkillsDir: string,
    deepchatByName: Map<string, UnifiedSkillItem>
  ): Promise<AgentSkillItem> {
    const targetPath = await this.readResolvedLinkTarget(linkPath)
    const targetExists = targetPath ? await this.pathExists(targetPath) : false
    const targetInsideDeepChat = Boolean(
      targetPath && this.isInsideDirectory(targetPath, deepchatSkillsDir)
    )
    const deepchat = deepchatByName.get(name)
    const createdByDeepChat =
      deepchat?.agentLinks[agentId]?.createdByDeepChat === true &&
      path.resolve(deepchat.agentLinks[agentId].path) === path.resolve(linkPath)

    if (!targetExists) {
      return {
        name,
        path: linkPath,
        owner: 'broken-link',
        status: 'broken-link',
        action: createdByDeepChat ? 'repair-link' : undefined,
        link: {
          isSymlink: true,
          targetPath,
          targetExists: false,
          targetInsideDeepChat,
          createdByDeepChat
        },
        deepchat: deepchat
          ? { exists: true, path: deepchat.skillRoot, disabled: deepchat.deepchatDisabled }
          : { exists: false }
      }
    }

    if (targetInsideDeepChat) {
      return {
        name,
        description: deepchat?.description,
        path: linkPath,
        owner: 'deepchat',
        status: 'linked',
        action: createdByDeepChat ? 'remove-link' : undefined,
        link: {
          isSymlink: true,
          targetPath,
          targetExists: true,
          targetInsideDeepChat: true,
          createdByDeepChat
        },
        deepchat: deepchat
          ? { exists: true, path: deepchat.skillRoot, disabled: deepchat.deepchatDisabled }
          : { exists: false }
      }
    }

    return {
      name,
      path: linkPath,
      owner: 'external-link',
      status: 'linked-out',
      action: 'adopt',
      link: {
        isSymlink: true,
        targetPath,
        targetExists: true,
        targetInsideDeepChat: false
      },
      deepchat: deepchat
        ? { exists: true, path: deepchat.skillRoot, disabled: deepchat.deepchatDisabled }
        : { exists: false }
    }
  }

  private async readResolvedLinkTarget(linkPath: string): Promise<string | undefined> {
    try {
      const rawTarget = await fs.promises.readlink(linkPath)
      return path.isAbsolute(rawTarget)
        ? path.resolve(rawTarget)
        : path.resolve(path.dirname(linkPath), rawTarget)
    } catch {
      return undefined
    }
  }

  private async pathExists(targetPath: string): Promise<boolean> {
    try {
      await fs.promises.access(targetPath, fs.constants.F_OK)
      return true
    } catch {
      return false
    }
  }

  private isInsideDirectory(targetPath: string, parentPath: string): boolean {
    const relative = path.relative(parentPath, path.resolve(targetPath))
    return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative))
  }

  private async hasSameSkillContent(leftRoot: string, rightRoot: string): Promise<boolean> {
    try {
      const leftPath = path.join(leftRoot, 'SKILL.md')
      const rightPath = path.join(rightRoot, 'SKILL.md')
      const [leftStats, rightStats] = await Promise.all([
        fs.promises.stat(leftPath),
        fs.promises.stat(rightPath)
      ])
      if (leftStats.size > MAX_SUBFOLDER_FILE_SIZE || rightStats.size > MAX_SUBFOLDER_FILE_SIZE) {
        return false
      }
      const [left, right] = await Promise.all([
        fs.promises.readFile(leftPath, 'utf-8'),
        fs.promises.readFile(rightPath, 'utf-8')
      ])
      return left === right
    } catch {
      return false
    }
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
   * Load a DeepChat skill for export
   */
  private async loadDeepChatSkill(skillName: string): Promise<CanonicalSkill | null> {
    logger.info(`[SkillSync] loadDeepChatSkill: ${skillName}`)
    const metadata = await this.skillService.getMetadataList()
    logger.info(`[SkillSync] Available skills: ${metadata.map((s) => s.name).join(', ')}`)
    const skillMeta = metadata.find((s) => s.name === skillName)
    if (!skillMeta) {
      console.warn(`[SkillSync] Skill metadata not found: ${skillName}`)
      return null
    }
    logger.info(
      `[SkillSync] Found skill metadata: path=${skillMeta.path}, root=${skillMeta.skillRoot}`
    )

    const content = await this.skillService.loadSkillContent(skillName)
    if (!content) {
      console.warn(`[SkillSync] Skill content not loaded: ${skillName}`)
      return null
    }
    logger.info(`[SkillSync] Loaded skill content, length: ${content.content.length}`)

    // Parse the DeepChat skill (Claude Code format)
    const skillFilePath = skillMeta.path
    const folderPath = skillMeta.skillRoot

    try {
      const fileContent = await fs.promises.readFile(skillFilePath, 'utf-8')
      logger.info(`[SkillSync] Read skill file, length: ${fileContent.length}`)
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
    const metadata = await this.skillService.getMetadataList()
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
