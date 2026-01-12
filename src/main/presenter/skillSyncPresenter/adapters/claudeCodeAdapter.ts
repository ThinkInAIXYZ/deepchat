/**
 * Claude Code Format Adapter
 *
 * Handles parsing and serializing skills in Claude Code SKILL.md format.
 *
 * Format characteristics:
 * - YAML frontmatter with name, description, allowed-tools
 * - Markdown body with instructions
 * - Supports subfolder structure (references/, scripts/)
 * - Field name: allowed-tools (with hyphen)
 */

import matter from 'gray-matter'
import type {
  IFormatAdapter,
  CanonicalSkill,
  ParseContext,
  FormatCapabilities
} from '@shared/types/skillSync'

/**
 * Claude Code format adapter
 */
export class ClaudeCodeAdapter implements IFormatAdapter {
  readonly id: string = 'claude-code'
  readonly name: string = 'Claude Code'

  /**
   * Parse Claude Code SKILL.md format to CanonicalSkill
   */
  parse(content: string, context: ParseContext): CanonicalSkill {
    const { data, content: body } = matter(content)

    // Extract name from frontmatter or fallback to directory name
    const name = this.extractName(data, context)

    // Extract description
    const description = this.extractDescription(data)

    // Extract allowed tools - handle both string and array formats
    const allowedTools = this.parseAllowedTools(data['allowed-tools'])

    return {
      name,
      description,
      instructions: body.trim(),
      allowedTools,
      model: data.model,
      tags: data.tags,
      source: {
        tool: this.id,
        originalPath: context.filePath,
        originalFormat: 'yaml-frontmatter-markdown'
      }
    }
  }

  /**
   * Serialize CanonicalSkill to Claude Code SKILL.md format
   */
  serialize(skill: CanonicalSkill, options?: Record<string, unknown>): string {
    const frontmatter: Record<string, unknown> = {
      name: skill.name,
      description: skill.description
    }

    // Convert allowedTools to allowed-tools (with hyphen)
    if (skill.allowedTools && skill.allowedTools.length > 0) {
      // Use array format for multiple tools, string for single tool
      if (skill.allowedTools.length === 1) {
        frontmatter['allowed-tools'] = skill.allowedTools[0]
      } else {
        frontmatter['allowed-tools'] = skill.allowedTools
      }
    }

    // Optional fields
    if (skill.model) {
      frontmatter.model = skill.model
    }

    if (skill.tags && skill.tags.length > 0) {
      frontmatter.tags = skill.tags
    }

    // Add license if provided in options
    if (options?.license) {
      frontmatter.license = options.license
    }

    // Generate YAML frontmatter
    const yamlContent = this.serializeFrontmatter(frontmatter)

    return `---\n${yamlContent}---\n\n${skill.instructions}`
  }

  /**
   * Detect if content is in Claude Code format
   */
  detect(content: string): boolean {
    // Claude Code format has YAML frontmatter with name and description
    if (!content.startsWith('---')) {
      return false
    }

    try {
      const { data } = matter(content)
      // Must have name and description in frontmatter
      return typeof data.name === 'string' && typeof data.description === 'string'
    } catch {
      return false
    }
  }

  /**
   * Get format capabilities
   */
  getCapabilities(): FormatCapabilities {
    return {
      hasFrontmatter: true,
      supportsName: true,
      supportsDescription: true,
      supportsTools: true,
      supportsModel: false, // Claude Code doesn't officially support model field
      supportsSubfolders: true,
      supportsReferences: true,
      supportsScripts: true
    }
  }

  /**
   * Extract name from frontmatter or context
   */
  private extractName(data: Record<string, unknown>, context: ParseContext): string {
    if (typeof data.name === 'string' && data.name.trim()) {
      return data.name.trim()
    }

    // Fallback: extract from folder path
    if (context.folderPath) {
      const parts = context.folderPath.split('/')
      return parts[parts.length - 1] || 'unnamed-skill'
    }

    return 'unnamed-skill'
  }

  /**
   * Extract description from frontmatter
   */
  private extractDescription(data: Record<string, unknown>): string {
    if (typeof data.description === 'string') {
      return data.description.trim()
    }
    return ''
  }

  /**
   * Parse allowed-tools field (supports both string and array)
   */
  private parseAllowedTools(value: unknown): string[] | undefined {
    if (!value) {
      return undefined
    }

    if (typeof value === 'string') {
      // Parse comma-separated string: "Read, Grep, Glob, Bash(git:*)"
      return value
        .split(',')
        .map((s) => s.trim())
        .filter((s) => s.length > 0)
    }

    if (Array.isArray(value)) {
      return value.filter((s): s is string => typeof s === 'string' && s.trim().length > 0)
    }

    return undefined
  }

  /**
   * Serialize frontmatter object to YAML string
   */
  private serializeFrontmatter(data: Record<string, unknown>): string {
    const lines: string[] = []

    for (const [key, value] of Object.entries(data)) {
      if (value === undefined || value === null) {
        continue
      }

      if (Array.isArray(value)) {
        if (value.length === 0) {
          continue
        }
        lines.push(`${key}:`)
        for (const item of value) {
          lines.push(`  - ${this.escapeYamlValue(String(item))}`)
        }
      } else if (typeof value === 'string') {
        // Check if value needs quoting
        if (this.needsQuoting(value)) {
          lines.push(`${key}: "${this.escapeYamlString(value)}"`)
        } else {
          lines.push(`${key}: ${value}`)
        }
      } else {
        lines.push(`${key}: ${value}`)
      }
    }

    return lines.join('\n') + '\n'
  }

  /**
   * Check if a YAML value needs quoting
   */
  private needsQuoting(value: string): boolean {
    // Quote if contains special characters or starts with special chars
    return (
      value.includes(':') ||
      value.includes('#') ||
      value.includes("'") ||
      value.includes('"') ||
      value.includes('\n') ||
      value.startsWith(' ') ||
      value.endsWith(' ') ||
      value.startsWith('-') ||
      value.startsWith('[') ||
      value.startsWith('{') ||
      /^[0-9]/.test(value) ||
      ['true', 'false', 'null', 'yes', 'no'].includes(value.toLowerCase())
    )
  }

  /**
   * Escape special characters in YAML string
   */
  private escapeYamlString(value: string): string {
    return value.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, '\\n')
  }

  /**
   * Escape YAML value for array items
   */
  private escapeYamlValue(value: string): string {
    if (this.needsQuoting(value)) {
      return `"${this.escapeYamlString(value)}"`
    }
    return value
  }
}
