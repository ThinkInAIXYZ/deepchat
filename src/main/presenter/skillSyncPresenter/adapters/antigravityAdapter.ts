/**
 * Antigravity Format Adapter
 *
 * Handles parsing and serializing skills in Google Antigravity (Project IDX) Workflows format.
 *
 * Format characteristics:
 * - Optional YAML frontmatter with description only
 * - Markdown body with ## Steps + numbered steps structure
 * - Similar to Windsurf but has frontmatter
 * - Single file per workflow (no subfolder support)
 */

import matter from 'gray-matter'
import type {
  IFormatAdapter,
  CanonicalSkill,
  ParseContext,
  FormatCapabilities
} from '@shared/types/skillSync'

/**
 * Antigravity format adapter
 */
export class AntigravityAdapter implements IFormatAdapter {
  readonly id = 'antigravity'
  readonly name = 'Antigravity'

  /**
   * Parse Antigravity workflow format to CanonicalSkill
   */
  parse(content: string, context: ParseContext): CanonicalSkill {
    const { data, content: body } = matter(content)

    // Extract name from filename
    const name = this.extractName(context)

    // Extract description from frontmatter
    const description = typeof data.description === 'string' ? data.description : ''

    return {
      name,
      description,
      instructions: body.trim(),
      source: {
        tool: this.id,
        originalPath: context.filePath,
        originalFormat: 'antigravity-workflow'
      }
    }
  }

  /**
   * Serialize CanonicalSkill to Antigravity workflow format
   */
  serialize(skill: CanonicalSkill, _options?: Record<string, unknown>): string {
    let output = ''

    // Add frontmatter with description if present
    if (skill.description) {
      output += `---\ndescription: ${this.formatYamlValue(skill.description)}\n---\n\n`
    }

    // Check if instructions already have steps structure
    if (this.hasStepsStructure(skill.instructions)) {
      output += skill.instructions
    } else {
      // Wrap instructions in steps structure
      output += `## Steps\n\n### 1. Execute\n\n${skill.instructions}`
    }

    return output.trim()
  }

  /**
   * Detect if content is in Antigravity format
   */
  detect(content: string): boolean {
    // Antigravity format: optional frontmatter with description only
    // and ## Steps structure
    const hasFrontmatter = content.trim().startsWith('---')

    if (hasFrontmatter) {
      try {
        const { data, content: body } = matter(content)

        // Antigravity frontmatter only has description (no name, tools, etc.)
        const hasDescriptionOnly =
          typeof data.description === 'string' &&
          !data.name &&
          !data.tools &&
          !data.title &&
          !data.inclusion

        // Should have steps structure
        const hasStepsStructure =
          body.includes('## Steps') || /^### \d+\./m.test(body) || /^### Step \d+/im.test(body)

        return hasDescriptionOnly && hasStepsStructure
      } catch {
        return false
      }
    }

    return false
  }

  /**
   * Get format capabilities
   */
  getCapabilities(): FormatCapabilities {
    return {
      hasFrontmatter: true,
      supportsName: false, // Name from filename only
      supportsDescription: true,
      supportsTools: false,
      supportsModel: false,
      supportsSubfolders: false,
      supportsReferences: false,
      supportsScripts: false
    }
  }

  /**
   * Extract name from filename
   */
  private extractName(context: ParseContext): string {
    const filename = context.filePath.split('/').pop() || ''
    return filename.replace('.md', '')
  }

  /**
   * Check if content already has steps structure
   */
  private hasStepsStructure(content: string): boolean {
    const patterns = [/^## Steps/m, /^### \d+\./m, /^### Step \d+/im]
    return patterns.some((p) => p.test(content))
  }

  /**
   * Format a value for YAML
   */
  private formatYamlValue(value: string): string {
    // Check if value needs quoting
    if (
      value.includes(':') ||
      value.includes('#') ||
      value.includes("'") ||
      value.includes('"') ||
      value.includes('\n') ||
      value.startsWith(' ') ||
      value.endsWith(' ')
    ) {
      return `"${value.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, '\\n')}"`
    }
    return value
  }
}
