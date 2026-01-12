/**
 * Kiro Format Adapter
 *
 * Handles parsing and serializing skills in Kiro Steering Files format.
 *
 * Format characteristics:
 * - Optional YAML frontmatter with title, inclusion, file_patterns
 * - Markdown body with instructions
 * - Supports three inclusion modes: always, conditional, on-demand
 * - Supports #filename reference syntax
 * - No description field (can be embedded as blockquote)
 */

import matter from 'gray-matter'
import type {
  IFormatAdapter,
  CanonicalSkill,
  ParseContext,
  FormatCapabilities,
  KiroExportOptions
} from '@shared/types/skillSync'

/**
 * Kiro format adapter
 */
export class KiroAdapter implements IFormatAdapter {
  readonly id = 'kiro'
  readonly name = 'Kiro'

  /**
   * Parse Kiro steering file format to CanonicalSkill
   */
  parse(content: string, context: ParseContext): CanonicalSkill {
    const { data, content: body } = matter(content)

    // Extract name from title or filename
    const name = this.extractName(data, context)

    // Kiro has no description field, try to extract from blockquote at start
    const { description, instructions } = this.extractDescriptionAndInstructions(body)

    // Store Kiro-specific metadata in source
    const skill: CanonicalSkill = {
      name,
      description,
      instructions: instructions.trim(),
      source: {
        tool: this.id,
        originalPath: context.filePath,
        originalFormat: 'kiro-steering'
      }
    }

    // Embed Kiro-specific info in instructions as comments if present
    if (data.inclusion || data.file_patterns) {
      const kiroMeta = this.buildKiroMetaComment(data)
      skill.instructions = kiroMeta + instructions.trim()
    }

    return skill
  }

  /**
   * Serialize CanonicalSkill to Kiro steering file format
   */
  serialize(skill: CanonicalSkill, options?: Record<string, unknown>): string {
    const frontmatter: Record<string, unknown> = {}
    const kiroOptions = options as KiroExportOptions | undefined

    // Convert name to title
    const title = this.nameToTitle(skill.name)
    frontmatter.title = title

    // Set inclusion mode
    if (kiroOptions?.inclusion) {
      frontmatter.inclusion = kiroOptions.inclusion

      // Add file_patterns for conditional inclusion
      if (kiroOptions.inclusion === 'conditional' && kiroOptions.filePatterns?.length) {
        frontmatter.file_patterns = kiroOptions.filePatterns
      }
    }

    // Process instructions - remove Kiro meta comments if present
    let instructions = this.removeKiroMetaComments(skill.instructions)

    // Embed description as blockquote at the start
    if (skill.description) {
      instructions = `> ${skill.description}\n\n${instructions}`
    }

    // Generate output
    if (Object.keys(frontmatter).length > 0) {
      const yamlContent = this.serializeFrontmatter(frontmatter)
      return `---\n${yamlContent}---\n\n${instructions.trim()}`
    }

    return instructions.trim()
  }

  /**
   * Detect if content is in Kiro format
   */
  detect(content: string): boolean {
    // Kiro format: optional frontmatter with specific fields
    if (!content.trim().startsWith('---')) {
      return false
    }

    try {
      const { data } = matter(content)

      // Check for Kiro-specific fields
      const hasKiroFields =
        typeof data.title === 'string' ||
        data.inclusion === 'always' ||
        data.inclusion === 'conditional' ||
        Array.isArray(data.file_patterns)

      // Should NOT have Claude Code specific fields
      const hasClaudeCodeFields =
        typeof data.name === 'string' && typeof data.description === 'string'

      return hasKiroFields && !hasClaudeCodeFields
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
      supportsName: true, // Via title field
      supportsDescription: false, // Can be embedded as blockquote
      supportsTools: false,
      supportsModel: false,
      supportsSubfolders: false,
      supportsReferences: false,
      supportsScripts: false
    }
  }

  /**
   * Extract name from title or filename
   */
  private extractName(data: Record<string, unknown>, context: ParseContext): string {
    if (typeof data.title === 'string' && data.title.trim()) {
      return this.titleToName(data.title.trim())
    }

    // Fallback: use filename without extension
    const filename = context.filePath.split('/').pop() || ''
    return filename.replace('.md', '')
  }

  /**
   * Extract description from blockquote and remaining instructions
   */
  private extractDescriptionAndInstructions(body: string): {
    description: string
    instructions: string
  } {
    const lines = body.split('\n')
    let description = ''
    let instructionsStartIndex = 0

    // Check if body starts with a blockquote (>)
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i].trim()

      if (line === '') {
        continue
      }

      if (line.startsWith('> ')) {
        // Extract blockquote content as description
        description = line.slice(2).trim()
        instructionsStartIndex = i + 1

        // Continue collecting multi-line blockquote
        for (let j = i + 1; j < lines.length; j++) {
          const nextLine = lines[j].trim()
          if (nextLine.startsWith('> ')) {
            description += ' ' + nextLine.slice(2).trim()
            instructionsStartIndex = j + 1
          } else if (nextLine === '') {
            instructionsStartIndex = j + 1
            break
          } else {
            break
          }
        }
        break
      } else {
        // No blockquote, all content is instructions
        break
      }
    }

    const instructions = lines.slice(instructionsStartIndex).join('\n')
    return { description, instructions }
  }

  /**
   * Build Kiro meta comment for embedding in instructions
   */
  private buildKiroMetaComment(data: Record<string, unknown>): string {
    const parts: string[] = []

    if (data.inclusion) {
      parts.push(`<!-- Kiro inclusion: ${data.inclusion} -->`)
    }

    if (Array.isArray(data.file_patterns) && data.file_patterns.length > 0) {
      parts.push(`<!-- file_patterns: ${data.file_patterns.join(', ')} -->`)
    }

    if (parts.length > 0) {
      return parts.join('\n') + '\n\n'
    }

    return ''
  }

  /**
   * Remove Kiro meta comments from instructions
   */
  private removeKiroMetaComments(instructions: string): string {
    return instructions
      .replace(/<!-- Kiro inclusion: \w+ -->\n?/g, '')
      .replace(/<!-- file_patterns: [^>]+ -->\n?/g, '')
      .trim()
  }

  /**
   * Convert title to kebab-case name
   */
  private titleToName(title: string): string {
    return title
      .toLowerCase()
      .replace(/[^a-z0-9\s-]/g, '')
      .replace(/\s+/g, '-')
      .replace(/-+/g, '-')
      .replace(/^-|-$/g, '')
  }

  /**
   * Convert kebab-case name to title case
   */
  private nameToTitle(name: string): string {
    return name
      .split('-')
      .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
      .join(' ')
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
        // Use inline array format
        const items = value.map((v) => `"${v}"`).join(', ')
        lines.push(`${key}: [${items}]`)
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
    return (
      value.includes(':') ||
      value.includes('#') ||
      value.includes("'") ||
      value.includes('"') ||
      value.includes('\n') ||
      value.startsWith(' ') ||
      value.endsWith(' ')
    )
  }

  /**
   * Escape special characters in YAML string
   */
  private escapeYamlString(value: string): string {
    return value.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, '\\n')
  }
}
