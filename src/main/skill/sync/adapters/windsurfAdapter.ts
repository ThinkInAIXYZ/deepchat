/**
 * Windsurf Format Adapter
 *
 * Handles parsing and serializing skills in Windsurf Workflows format.
 *
 * Format characteristics:
 * - Pure structured Markdown (no frontmatter)
 * - Name extracted from # Title (may have " Workflow" suffix)
 * - Description extracted from text before ## Steps
 * - Uses ## Steps + ### N. numbered steps structure
 * - Single file per workflow (no subfolder support)
 */

import type {
  IFormatAdapter,
  CanonicalSkill,
  ParseContext,
  FormatCapabilities
} from '@shared/types/skillSync'

/**
 * Windsurf format adapter
 */
export class WindsurfAdapter implements IFormatAdapter {
  readonly id = 'windsurf'
  readonly name = 'Windsurf'

  /**
   * Parse Windsurf workflow format to CanonicalSkill
   */
  parse(content: string, context: ParseContext): CanonicalSkill {
    const lines = content.split('\n')

    // Extract name from title (remove " Workflow" suffix)
    const name = this.extractName(lines, context)

    // Extract description from text between title and ## Steps
    const description = this.extractDescription(lines)

    // Get steps section as instructions
    const instructions = this.extractStepsSection(lines, content)

    return {
      name,
      description,
      instructions,
      source: {
        tool: this.id,
        originalPath: context.filePath,
        originalFormat: 'steps-markdown'
      }
    }
  }

  /**
   * Serialize CanonicalSkill to Windsurf workflow format
   */
  serialize(skill: CanonicalSkill, _options?: Record<string, unknown>): string {
    // Convert name to title case and add " Workflow" suffix
    const title = this.nameToTitle(skill.name) + ' Workflow'

    let output = `# ${title}\n\n`
    output += `${skill.description}\n\n`

    // Check if instructions already have steps structure
    if (this.hasStepsStructure(skill.instructions)) {
      output += skill.instructions
    } else {
      // Wrap instructions in a single step
      output += `## Steps\n\n### 1. Execute\n\n${skill.instructions}`
    }

    return output.trim()
  }

  /**
   * Detect if content is in Windsurf format
   */
  detect(content: string): boolean {
    // Windsurf format: pure Markdown with ## Steps section and numbered steps
    // Must NOT start with --- (frontmatter)
    if (content.trim().startsWith('---')) {
      return false
    }

    const lines = content.split('\n')

    // Must have ## Steps section
    const hasStepsSection = lines.some((line) => line.trim() === '## Steps')

    // Should have numbered steps (### 1. or ### N.)
    const hasNumberedSteps = lines.some((line) => /^### \d+\./.test(line.trim()))

    return hasStepsSection || hasNumberedSteps
  }

  /**
   * Get format capabilities
   */
  getCapabilities(): FormatCapabilities {
    return {
      hasFrontmatter: false,
      supportsName: true, // From title
      supportsDescription: true, // From text before ## Steps
      supportsTools: false,
      supportsModel: false,
      supportsSubfolders: false,
      supportsReferences: false,
      supportsScripts: false
    }
  }

  /**
   * Extract name from title (removing " Workflow" suffix)
   */
  private extractName(lines: string[], context: ParseContext): string {
    const titleLine = lines.find((line) => line.startsWith('# '))

    if (titleLine) {
      let title = titleLine.replace('# ', '').trim()
      // Remove " Workflow" suffix if present
      if (title.endsWith(' Workflow')) {
        title = title.slice(0, -9)
      }
      return this.titleToName(title)
    }

    // Fallback: use filename without extension
    const filename = context.filePath.split('/').pop() || ''
    return filename.replace('.md', '')
  }

  /**
   * Extract description from text between title and ## Steps
   */
  private extractDescription(lines: string[]): string {
    const titleIndex = lines.findIndex((line) => line.startsWith('# '))
    const stepsIndex = lines.findIndex((line) => line.trim() === '## Steps')

    if (titleIndex === -1) {
      return ''
    }

    const endIndex = stepsIndex >= 0 ? stepsIndex : lines.length

    // Find first non-empty paragraph after title
    for (let i = titleIndex + 1; i < endIndex; i++) {
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
   * Extract steps section as instructions
   */
  private extractStepsSection(lines: string[], fullContent: string): string {
    const stepsIndex = lines.findIndex((line) => line.trim() === '## Steps')

    if (stepsIndex >= 0) {
      // Return everything from ## Steps onwards
      return lines.slice(stepsIndex).join('\n').trim()
    }

    // If no ## Steps section, return full content as instructions
    return fullContent.trim()
  }

  /**
   * Check if content already has steps structure
   */
  private hasStepsStructure(content: string): boolean {
    const patterns = [/^## Steps/m, /^### \d+\./m, /^### Step \d+/im]
    return patterns.some((p) => p.test(content))
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
