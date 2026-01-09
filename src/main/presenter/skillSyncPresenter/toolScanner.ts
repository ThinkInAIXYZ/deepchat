/**
 * Tool Scanner - Discovers and scans skills from external AI tools
 *
 * This module handles:
 * - Scanning external tool directories for skills
 * - Extracting basic skill metadata
 * - Path security validation
 */

import * as fs from 'fs'
import * as path from 'path'
import { homedir } from 'os'
import type {
  ExternalToolConfig,
  ExternalSkillInfo,
  ScanResult,
  FormatCapabilities
} from '@shared/types/skillSync'
import { resolveSafePath, isFilenameSafe, validateFileSize, MAX_FILE_SIZE } from './security'

// ============================================================================
// External Tool Configuration Registry
// ============================================================================

/**
 * Default format capabilities for tools with YAML frontmatter
 */
const FRONTMATTER_CAPABILITIES: FormatCapabilities = {
  hasFrontmatter: true,
  supportsName: true,
  supportsDescription: true,
  supportsTools: true,
  supportsModel: true,
  supportsSubfolders: false,
  supportsReferences: false,
  supportsScripts: false
}

/**
 * Default format capabilities for pure Markdown tools
 */
const MARKDOWN_ONLY_CAPABILITIES: FormatCapabilities = {
  hasFrontmatter: false,
  supportsName: true,
  supportsDescription: true,
  supportsTools: false,
  supportsModel: false,
  supportsSubfolders: false,
  supportsReferences: false,
  supportsScripts: false
}

/**
 * Registry of all supported external AI tools
 */
export const EXTERNAL_TOOLS: ExternalToolConfig[] = [
  {
    id: 'claude-code',
    name: 'Claude Code',
    skillsDir: '~/.claude/skills/',
    filePattern: '*/SKILL.md',
    format: 'claude-code',
    capabilities: {
      ...FRONTMATTER_CAPABILITIES,
      supportsSubfolders: true,
      supportsReferences: true,
      supportsScripts: true
    }
  },
  {
    id: 'cursor',
    name: 'Cursor',
    skillsDir: '.cursor/commands/',
    filePattern: '*.md',
    format: 'cursor',
    capabilities: MARKDOWN_ONLY_CAPABILITIES,
    isProjectLevel: true
  },
  {
    id: 'windsurf',
    name: 'Windsurf',
    skillsDir: '.windsurf/rules/',
    filePattern: '*.md',
    format: 'windsurf',
    capabilities: MARKDOWN_ONLY_CAPABILITIES,
    isProjectLevel: true
  },
  {
    id: 'copilot',
    name: 'GitHub Copilot',
    skillsDir: '.github/',
    filePattern: '*.prompt.md',
    format: 'copilot',
    capabilities: FRONTMATTER_CAPABILITIES,
    isProjectLevel: true
  },
  {
    id: 'kiro',
    name: 'Kiro',
    skillsDir: '.kiro/rules/',
    filePattern: '*.md',
    format: 'kiro',
    capabilities: {
      ...FRONTMATTER_CAPABILITIES,
      supportsModel: false
    },
    isProjectLevel: true
  },
  {
    id: 'antigravity',
    name: 'Antigravity',
    skillsDir: '.antigravity/workflows/',
    filePattern: '*.md',
    format: 'antigravity',
    capabilities: FRONTMATTER_CAPABILITIES,
    isProjectLevel: true
  }
]

// ============================================================================
// Path Utilities
// ============================================================================

/**
 * Expand tilde (~) in paths to home directory
 */
export function expandPath(inputPath: string): string {
  if (inputPath.startsWith('~/')) {
    return path.join(homedir(), inputPath.slice(2))
  }
  return inputPath
}

/**
 * Validate that a path is safe (no path traversal attacks)
 * Returns true if the path is safe, false otherwise
 *
 * Note: For symlink-aware validation, use resolveSafePath() from ./security
 * This function is kept for backwards compatibility and cases where
 * the path may not exist yet.
 */
export function isPathSafe(targetPath: string, baseDir: string): boolean {
  // First try symlink-aware resolution for existing paths
  const safePath = resolveSafePath(targetPath, baseDir)
  if (safePath !== null) {
    return true
  }

  // Fall back to string-based check for non-existent paths
  const normalizedTarget = path.normalize(path.resolve(baseDir, targetPath))
  const normalizedBase = path.normalize(path.resolve(baseDir))

  // Ensure the target path is within or equal to the base directory
  // Add path separator to prevent prefix matching (e.g., /base-other matching /base)
  const baseWithSep = normalizedBase.endsWith(path.sep)
    ? normalizedBase
    : `${normalizedBase}${path.sep}`
  return normalizedTarget === normalizedBase || normalizedTarget.startsWith(baseWithSep)
}

/**
 * Resolve a skill directory path for a tool
 * For user-level tools: expands ~ to home directory
 * For project-level tools: resolves relative to project root
 */
export function resolveSkillsDir(tool: ExternalToolConfig, projectRoot?: string): string {
  if (tool.isProjectLevel) {
    if (!projectRoot) {
      throw new Error(`Project root required for project-level tool: ${tool.id}`)
    }
    return path.resolve(projectRoot, tool.skillsDir)
  }
  return expandPath(tool.skillsDir)
}

// ============================================================================
// Tool Scanner Class
// ============================================================================

/**
 * ToolScanner - Discovers skills from external AI tools
 */
export class ToolScanner {
  private toolRegistry: Map<string, ExternalToolConfig>

  constructor() {
    this.toolRegistry = new Map()
    for (const tool of EXTERNAL_TOOLS) {
      this.toolRegistry.set(tool.id, tool)
    }
  }

  /**
   * Get a tool configuration by ID
   */
  getTool(toolId: string): ExternalToolConfig | undefined {
    return this.toolRegistry.get(toolId)
  }

  /**
   * Get all registered tools
   */
  getAllTools(): ExternalToolConfig[] {
    return Array.from(this.toolRegistry.values())
  }

  /**
   * Check if a tool's skills directory exists
   */
  async isToolAvailable(toolId: string, projectRoot?: string): Promise<boolean> {
    const tool = this.toolRegistry.get(toolId)
    if (!tool) {
      return false
    }

    try {
      const skillsDir = resolveSkillsDir(tool, projectRoot)
      const stats = await fs.promises.stat(skillsDir)
      return stats.isDirectory()
    } catch {
      return false
    }
  }

  /**
   * Scan a specific tool for skills
   */
  async scanTool(toolId: string, projectRoot?: string): Promise<ScanResult> {
    const tool = this.toolRegistry.get(toolId)
    if (!tool) {
      return {
        toolId,
        toolName: toolId,
        available: false,
        skillsDir: '',
        skills: [],
        error: `Unknown tool: ${toolId}`
      }
    }

    let skillsDir: string
    try {
      skillsDir = resolveSkillsDir(tool, projectRoot)
    } catch (error) {
      return {
        toolId: tool.id,
        toolName: tool.name,
        available: false,
        skillsDir: tool.skillsDir,
        skills: [],
        error: error instanceof Error ? error.message : String(error)
      }
    }

    // Check if directory exists
    try {
      const stats = await fs.promises.stat(skillsDir)
      if (!stats.isDirectory()) {
        return {
          toolId: tool.id,
          toolName: tool.name,
          available: false,
          skillsDir,
          skills: [],
          error: `Path is not a directory: ${skillsDir}`
        }
      }
    } catch {
      return {
        toolId: tool.id,
        toolName: tool.name,
        available: false,
        skillsDir,
        skills: []
      }
    }

    // Scan for skills based on file pattern
    const skills = await this.scanDirectory(skillsDir, tool)

    return {
      toolId: tool.id,
      toolName: tool.name,
      available: true,
      skillsDir,
      skills
    }
  }

  /**
   * Scan all registered tools for skills
   */
  async scanExternalTools(projectRoot?: string): Promise<ScanResult[]> {
    const results: ScanResult[] = []

    for (const tool of this.toolRegistry.values()) {
      // Skip project-level tools if no project root provided
      if (tool.isProjectLevel && !projectRoot) {
        continue
      }

      const result = await this.scanTool(tool.id, projectRoot)
      results.push(result)
    }

    return results
  }

  /**
   * Scan a directory for skills based on file pattern
   */
  private async scanDirectory(
    skillsDir: string,
    tool: ExternalToolConfig
  ): Promise<ExternalSkillInfo[]> {
    const skills: ExternalSkillInfo[] = []

    try {
      // Handle different file patterns
      if (tool.filePattern.includes('/')) {
        // Pattern like "*/SKILL.md" - scan subdirectories
        skills.push(...(await this.scanSubdirectories(skillsDir, tool)))
      } else {
        // Pattern like "*.md" - scan files directly
        skills.push(...(await this.scanFiles(skillsDir, tool)))
      }
    } catch (error) {
      console.error(`Error scanning directory ${skillsDir}:`, error)
    }

    return skills
  }

  /**
   * Scan subdirectories for skill files (e.g., star/SKILL.md pattern)
   */
  private async scanSubdirectories(
    skillsDir: string,
    tool: ExternalToolConfig
  ): Promise<ExternalSkillInfo[]> {
    const skills: ExternalSkillInfo[] = []
    const fileName = tool.filePattern.split('/').pop() || 'SKILL.md'

    try {
      const entries = await fs.promises.readdir(skillsDir, { withFileTypes: true })

      for (const entry of entries) {
        if (!entry.isDirectory()) {
          continue
        }

        // Security check - validate filename
        if (!isFilenameSafe(entry.name)) {
          continue
        }

        // Security check - validate path doesn't escape
        if (!isPathSafe(entry.name, skillsDir)) {
          continue
        }

        const subDir = path.join(skillsDir, entry.name)
        const skillFile = path.join(subDir, fileName)

        try {
          const stats = await fs.promises.stat(skillFile)
          if (stats.isFile()) {
            const skillInfo = await this.extractSkillInfo(skillFile, subDir, tool)
            if (skillInfo) {
              skills.push(skillInfo)
            }
          }
        } catch {
          // File doesn't exist, skip
        }
      }
    } catch (error) {
      console.error(`Error scanning subdirectories in ${skillsDir}:`, error)
    }

    return skills
  }

  /**
   * Scan files directly in directory (e.g., *.md pattern)
   */
  private async scanFiles(
    skillsDir: string,
    tool: ExternalToolConfig
  ): Promise<ExternalSkillInfo[]> {
    const skills: ExternalSkillInfo[] = []

    try {
      const entries = await fs.promises.readdir(skillsDir, { withFileTypes: true })

      for (const entry of entries) {
        if (!entry.isFile()) {
          continue
        }

        // Check file extension match
        if (!this.matchesPattern(entry.name, tool.filePattern)) {
          continue
        }

        // Security check - validate filename
        if (!isFilenameSafe(entry.name)) {
          continue
        }

        // Security check - validate path doesn't escape
        if (!isPathSafe(entry.name, skillsDir)) {
          continue
        }

        const filePath = path.join(skillsDir, entry.name)
        const skillInfo = await this.extractSkillInfo(filePath, skillsDir, tool)
        if (skillInfo) {
          skills.push(skillInfo)
        }
      }
    } catch (error) {
      console.error(`Error scanning files in ${skillsDir}:`, error)
    }

    return skills
  }

  /**
   * Extract skill info from a file
   */
  private async extractSkillInfo(
    filePath: string,
    folderPath: string,
    tool: ExternalToolConfig
  ): Promise<ExternalSkillInfo | null> {
    try {
      // Security: Validate file size before reading
      const sizeResult = await validateFileSize(filePath, MAX_FILE_SIZE)
      if (!sizeResult.valid) {
        console.warn(`Skipping oversized file ${filePath}: ${sizeResult.error}`)
        return null
      }

      const content = await fs.promises.readFile(filePath, 'utf-8')
      const stats = await fs.promises.stat(filePath)

      // Extract name from file/folder
      let name: string
      if (tool.filePattern.includes('/')) {
        // For subdirectory patterns, use folder name
        name = path.basename(folderPath)
      } else {
        // For file patterns, extract from filename
        name = this.extractNameFromFile(path.basename(filePath), tool.filePattern)
      }

      // Try to extract description from content
      const description = this.extractDescription(content, tool)

      return {
        name,
        description,
        path: tool.filePattern.includes('/') ? folderPath : filePath,
        format: tool.format,
        lastModified: stats.mtime
      }
    } catch (error) {
      console.error(`Error extracting skill info from ${filePath}:`, error)
      return null
    }
  }

  /**
   * Extract name from filename based on pattern
   */
  private extractNameFromFile(filename: string, pattern: string): string {
    if (pattern === '*.prompt.md') {
      // Remove .prompt.md extension
      return filename.replace(/\.prompt\.md$/, '')
    }
    // Remove .md extension
    return filename.replace(/\.md$/, '')
  }

  /**
   * Extract description from file content
   * This is a quick extraction, not full parsing
   */
  private extractDescription(content: string, tool: ExternalToolConfig): string | undefined {
    // Try YAML frontmatter first
    if (tool.capabilities.hasFrontmatter) {
      const frontmatterMatch = content.match(/^---\n([\s\S]*?)\n---/)
      if (frontmatterMatch) {
        const descriptionMatch = frontmatterMatch[1].match(/description:\s*["']?([^\n"']+)["']?/)
        if (descriptionMatch) {
          return descriptionMatch[1].trim()
        }
      }
    }

    // Try first paragraph after title
    const lines = content.split('\n')
    let foundTitle = false
    for (const line of lines) {
      const trimmed = line.trim()
      if (trimmed.startsWith('#')) {
        foundTitle = true
        continue
      }
      if (foundTitle && trimmed && !trimmed.startsWith('---')) {
        // Return first non-empty line as description (truncated)
        return trimmed.length > 200 ? trimmed.slice(0, 200) + '...' : trimmed
      }
    }

    return undefined
  }

  /**
   * Get extension from pattern
   */
  private getPatternExtension(pattern: string): string {
    const match = pattern.match(/\*(\.[a-z.]+)$/)
    return match ? match[1] : '.md'
  }

  /**
   * Check if filename matches pattern
   */
  private matchesPattern(filename: string, pattern: string): boolean {
    if (pattern === '*.md') {
      return filename.endsWith('.md')
    }
    if (pattern === '*.prompt.md') {
      return filename.endsWith('.prompt.md')
    }
    // Generic pattern matching
    const extension = this.getPatternExtension(pattern)
    return filename.endsWith(extension)
  }
}

/**
 * Create a singleton instance
 */
export const toolScanner = new ToolScanner()
