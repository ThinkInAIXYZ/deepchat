/**
 * Cursor Format Adapter
 *
 * Handles parsing and serializing skills in Cursor Commands format.
 *
 * Format characteristics:
 * - Pure structured Markdown (no frontmatter)
 * - Name extracted from # Title
 * - Description extracted from first paragraph after title
 * - Single file per command (no subfolder support)
 */

import type {
  IFormatAdapter,
  CanonicalSkill,
  ParseContext,
  FormatCapabilities
} from '@shared/types/skillSync'

/**
 * Cursor format adapter
 */
export class CursorAdapter implements IFormatAdapter {
  readonly id = 'cursor'
  readonly name = 'Cursor'

  /**
   * Parse Cursor command format to CanonicalSkill
   */
  parse(content: string, context: ParseContext): CanonicalSkill {
    const lines = content.split('\n')

    // Extract title from first # heading
    const name = this.extractName(lines, context)

    // Extract description from first paragraph after title
    const description = this.extractDescription(lines)

    return {
      name,
      description,
      instructions: content.trim(),
      source: {
        tool: this.id,
        originalPath: context.filePath,
        originalFormat: 'pure-markdown'
      }
    }
  }

  /**
   * Serialize CanonicalSkill to Cursor command format
   */
  serialize(skill: CanonicalSkill, options?: Record<string, unknown>): string {
    // Convert name to title case
    const title = this.nameToTitle(skill.name)

    let output = `# ${title}\n\n`
    output += `${skill.description}\n\n`

    // Check if instructions already start with a heading
    const instructionsHasHeading = /^#+ /.test(skill.instructions.trim())

    if (instructionsHasHeading) {
      output += skill.instructions
    } else {
      output += `## Objective\n\n`
      output += skill.instructions
    }

    // Optionally inline references
    const inlineReferences = options?.inlineReferences !== false
    if (inlineReferences && skill.references && skill.references.length > 0) {
      output += '\n\n## References\n\n'
      for (const ref of skill.references) {
        output += `### ${ref.name}\n\n${ref.content}\n\n`
      }
    }

    return output.trim()
  }

  /**
   * Detect if content is in Cursor format
   */
  detect(content: string): boolean {
    // Cursor format: pure Markdown with # title, no frontmatter
    // Must NOT start with --- (frontmatter)
    if (content.trim().startsWith('---')) {
      return false
    }

    // Must have a # title
    const lines = content.split('\n')
    const hasTitle = lines.some((line) => line.startsWith('# '))

    // Should NOT have ## Steps pattern (that's Windsurf)
    const hasStepsSection = lines.some((line) => line.trim() === '## Steps')

    return hasTitle && !hasStepsSection
  }

  /**
   * Get format capabilities
   */
  getCapabilities(): FormatCapabilities {
    return {
      hasFrontmatter: false,
      supportsName: true, // From title
      supportsDescription: true, // From first paragraph
      supportsTools: false,
      supportsModel: false,
      supportsSubfolders: false,
      supportsReferences: false, // Can be inlined
      supportsScripts: false
    }
  }

  /**
   * Extract name from title or filename
   */
  private extractName(lines: string[], context: ParseContext): string {
    const titleLine = lines.find((line) => line.startsWith('# '))

    if (titleLine) {
      // Convert title to kebab-case name
      const title = titleLine.replace('# ', '').trim()
      return this.titleToName(title)
    }

    // Fallback: use filename without extension
    const filename = context.filePath.split('/').pop() || ''
    return filename.replace('.md', '')
  }

  /**
   * Extract description from first paragraph after title
   */
  private extractDescription(lines: string[]): string {
    const titleIndex = lines.findIndex((line) => line.startsWith('# '))

    if (titleIndex === -1) {
      return ''
    }

    // Find first non-empty line after title that's not a heading
    for (let i = titleIndex + 1; i < lines.length; i++) {
      const line = lines[i].trim()
      if (line === '') {
        continue
      }
      if (line.startsWith('#')) {
        break
      }
      return line
    }

    return ''
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
}
