/**
 * Format Converter - Handles conversion between skill formats
 *
 * This module provides:
 * - parseExternal: Parse external tool format to CanonicalSkill
 * - serializeToExternal: Serialize CanonicalSkill to external format
 * - serializeToSkillMd: Serialize to DeepChat SKILL.md format
 * - getConversionWarnings: Get warnings about potential data loss
 */

import * as fs from 'fs'
import * as path from 'path'
import type {
  CanonicalSkill,
  ParseContext,
  FormatCapabilities,
  SkillReference,
  SkillScript,
  ExternalToolConfig
} from '@shared/types/skillSync'
import { getAdapter, getAllAdapters } from './adapters'
import { EXTERNAL_TOOLS } from './toolScanner'
import {
  isFilenameSafe,
  isPathWithinBase,
  validateFileSize,
  MAX_SUBFOLDER_FILE_SIZE
} from './security'

// ============================================================================
// Conversion Warning Types
// ============================================================================

export interface ConversionWarning {
  /** Warning type */
  type: 'feature_loss' | 'format_change' | 'truncation' | 'incompatible'
  /** Warning message */
  message: string
  /** Affected field name */
  field?: string
  /** Suggestion for user */
  suggestion?: string
}

// ============================================================================
// Format Converter Class
// ============================================================================

/**
 * FormatConverter - Handles format conversion between different AI tools
 */
export class FormatConverter {
  /**
   * Parse external tool format to CanonicalSkill
   */
  async parseExternal(
    content: string,
    context: ParseContext,
    options?: { includeSubfolders?: boolean }
  ): Promise<CanonicalSkill> {
    const adapter = getAdapter(context.toolId)
    if (!adapter) {
      throw new Error(`No adapter found for tool: ${context.toolId}`)
    }

    // Parse main content
    const skill = adapter.parse(content, context)

    // Load references and scripts if supported and requested
    if (options?.includeSubfolders && context.folderPath) {
      const capabilities = adapter.getCapabilities()

      if (capabilities.supportsReferences) {
        skill.references = await this.loadReferences(context.folderPath)
      }

      if (capabilities.supportsScripts) {
        skill.scripts = await this.loadScripts(context.folderPath)
      }
    }

    return skill
  }

  /**
   * Serialize CanonicalSkill to external tool format
   */
  serializeToExternal(
    skill: CanonicalSkill,
    targetToolId: string,
    options?: Record<string, unknown>
  ): string {
    const adapter = getAdapter(targetToolId)
    if (!adapter) {
      throw new Error(`No adapter found for tool: ${targetToolId}`)
    }

    return adapter.serialize(skill, options)
  }

  /**
   * Serialize CanonicalSkill to DeepChat SKILL.md format (Claude Code format)
   */
  serializeToSkillMd(skill: CanonicalSkill, options?: Record<string, unknown>): string {
    // DeepChat uses Claude Code format as the native format
    const adapter = getAdapter('claude-code')
    if (!adapter) {
      throw new Error('Claude Code adapter not found')
    }

    return adapter.serialize(skill, options)
  }

  /**
   * Get warnings about potential data loss when converting
   */
  getConversionWarnings(skill: CanonicalSkill, targetToolId: string): ConversionWarning[] {
    const warnings: ConversionWarning[] = []
    const targetTool = EXTERNAL_TOOLS.find((t) => t.id === targetToolId)

    if (!targetTool) {
      warnings.push({
        type: 'incompatible',
        message: `Unknown target tool: ${targetToolId}`
      })
      return warnings
    }

    const capabilities = targetTool.capabilities

    // Check allowed tools
    if (skill.allowedTools && skill.allowedTools.length > 0 && !capabilities.supportsTools) {
      warnings.push({
        type: 'feature_loss',
        message: `Tool restrictions will be lost (${targetTool.name} does not support tool restrictions)`,
        field: 'allowedTools',
        suggestion: 'Consider adding tool restrictions as a note in the instructions'
      })
    }

    // Check model specification
    if (skill.model && !capabilities.supportsModel) {
      warnings.push({
        type: 'feature_loss',
        message: `Model specification will be lost (${targetTool.name} does not support model field)`,
        field: 'model',
        suggestion: 'Consider adding model preference as a note in the instructions'
      })
    }

    // Check references
    if (skill.references && skill.references.length > 0 && !capabilities.supportsReferences) {
      warnings.push({
        type: 'feature_loss',
        message: `${skill.references.length} reference file(s) will not be included`,
        field: 'references',
        suggestion: 'Reference contents may be inlined into the instructions'
      })
    }

    // Check scripts
    if (skill.scripts && skill.scripts.length > 0 && !capabilities.supportsScripts) {
      warnings.push({
        type: 'feature_loss',
        message: `${skill.scripts.length} script file(s) will not be included`,
        field: 'scripts',
        suggestion: 'Scripts cannot be exported to this format'
      })
    }

    // Check subfolder support
    if (capabilities.supportsSubfolders === false && (skill.references || skill.scripts)) {
      if (!warnings.some((w) => w.field === 'references' || w.field === 'scripts')) {
        warnings.push({
          type: 'format_change',
          message: `Subfolder structure will be flattened (${targetTool.name} uses single-file format)`,
          suggestion: 'All content will be in a single file'
        })
      }
    }

    // Check tags
    if (skill.tags && skill.tags.length > 0) {
      // Most tools don't support tags natively
      const adapter = getAdapter(targetToolId)
      if (adapter) {
        const adapterCaps = adapter.getCapabilities()
        if (!adapterCaps.hasFrontmatter) {
          warnings.push({
            type: 'feature_loss',
            message: 'Tags will be lost (target format does not support metadata)',
            field: 'tags'
          })
        }
      }
    }

    return warnings
  }

  /**
   * Auto-detect format and parse content
   */
  autoDetectAndParse(
    content: string,
    context: Omit<ParseContext, 'toolId'>
  ): CanonicalSkill | null {
    for (const adapter of getAllAdapters()) {
      if (adapter.detect(content)) {
        return adapter.parse(content, { ...context, toolId: adapter.id })
      }
    }
    return null
  }

  /**
   * Get capabilities for a specific tool
   */
  getToolCapabilities(toolId: string): FormatCapabilities | null {
    const adapter = getAdapter(toolId)
    if (adapter) {
      return adapter.getCapabilities()
    }

    const tool = EXTERNAL_TOOLS.find((t) => t.id === toolId)
    if (tool) {
      return tool.capabilities
    }

    return null
  }

  /**
   * Get tool configuration by ID
   */
  getToolConfig(toolId: string): ExternalToolConfig | undefined {
    return EXTERNAL_TOOLS.find((t) => t.id === toolId)
  }

  // ============================================================================
  // Private Helper Methods
  // ============================================================================

  /**
   * Load reference files from skill folder
   */
  private async loadReferences(folderPath: string): Promise<SkillReference[]> {
    const referencesDir = path.join(folderPath, 'references')
    return this.loadSubfolderFiles(referencesDir, 'references')
  }

  /**
   * Load script files from skill folder
   */
  private async loadScripts(folderPath: string): Promise<SkillScript[]> {
    const scriptsDir = path.join(folderPath, 'scripts')
    return this.loadSubfolderFiles(scriptsDir, 'scripts')
  }

  /**
   * Load files from a subfolder with security validations
   */
  private async loadSubfolderFiles(
    dirPath: string,
    subfolderName: string
  ): Promise<Array<{ name: string; content: string; relativePath: string }>> {
    const files: Array<{ name: string; content: string; relativePath: string }> = []

    try {
      const stats = await fs.promises.stat(dirPath)
      if (!stats.isDirectory()) {
        return files
      }

      const entries = await fs.promises.readdir(dirPath, { withFileTypes: true })

      for (const entry of entries) {
        if (!entry.isFile()) {
          continue
        }

        // Security: Validate filename is safe
        if (!isFilenameSafe(entry.name)) {
          console.warn(`Skipping file with unsafe name: ${entry.name}`)
          continue
        }

        const filePath = path.join(dirPath, entry.name)

        // Security: Validate file path is within expected directory
        if (!isPathWithinBase(filePath, dirPath)) {
          console.warn(`Skipping file outside allowed directory: ${filePath}`)
          continue
        }

        // Security: Validate file size
        const sizeResult = await validateFileSize(filePath, MAX_SUBFOLDER_FILE_SIZE)
        if (!sizeResult.valid) {
          console.warn(`Skipping oversized file ${filePath}: ${sizeResult.error}`)
          continue
        }

        const content = await fs.promises.readFile(filePath, 'utf-8')

        files.push({
          name: entry.name,
          content,
          relativePath: path.join(subfolderName, entry.name)
        })
      }
    } catch {
      // Directory doesn't exist or not readable, return empty array
    }

    return files
  }
}

/**
 * Create a singleton instance
 */
export const formatConverter = new FormatConverter()
