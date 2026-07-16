/**
 * GitHub Copilot Format Adapter
 *
 * Handles parsing and serializing skills in GitHub Copilot Prompt Files format.
 *
 * Format characteristics:
 * - Optional YAML frontmatter with description, agent, model, tools
 * - Markdown body with instructions
 * - File pattern: *.prompt.md
 * - Supports #file:'path' reference syntax
 * - Tool names need mapping (read ↔ Read, runCommands ↔ Bash)
 */

import matter from 'gray-matter'
import type {
  IFormatAdapter,
  CanonicalSkill,
  ParseContext,
  FormatCapabilities
} from '@shared/types/skillSync'

/**
 * Tool name mappings between Copilot and DeepChat
 */
const COPILOT_TO_DEEPCHAT_TOOLS: Record<string, string> = {
  read: 'Read',
  edit: 'Edit',
  runCommands: 'Bash',
  'search/codebase': 'Grep',
  githubRepo: 'githubRepo',
  terminalLastCommand: 'terminalLastCommand'
}

const DEEPCHAT_TO_COPILOT_TOOLS: Record<string, string> = {
  Read: 'read',
  Edit: 'edit',
  Bash: 'runCommands',
  Grep: 'search/codebase',
  Glob: 'search/codebase'
}

/**
 * GitHub Copilot format adapter
 */
export class CopilotAdapter implements IFormatAdapter {
  readonly id = 'copilot'
  readonly name = 'GitHub Copilot'

  /**
   * Parse Copilot prompt file format to CanonicalSkill
   */
  parse(content: string, context: ParseContext): CanonicalSkill {
    const { data, content: body } = matter(content)

    // Extract name from filename (remove .prompt.md extension)
    const name = this.extractName(context)

    // Extract description from frontmatter
    const description = typeof data.description === 'string' ? data.description : ''

    // Map tool names from Copilot to DeepChat format
    const allowedTools = this.mapCopilotTools(data.tools)

    // Convert #file:'path' references to ${SKILL_ROOT}/references/path
    const processedBody = this.processFileReferences(body)

    return {
      name,
      description,
      instructions: processedBody.trim(),
      allowedTools,
      model: data.model,
      source: {
        tool: this.id,
        originalPath: context.filePath,
        originalFormat: 'prompt-md'
      }
    }
  }

  /**
   * Serialize CanonicalSkill to Copilot prompt file format
   */
  serialize(skill: CanonicalSkill, _options?: Record<string, unknown>): string {
    const frontmatter: Record<string, unknown> = {}

    // Add description if present
    if (skill.description) {
      frontmatter.description = skill.description
    }

    // Always set agent to 'agent'
    frontmatter.agent = 'agent'

    // Add model if present
    if (skill.model) {
      frontmatter.model = skill.model
    }

    // Map tool names from DeepChat to Copilot format
    if (skill.allowedTools && skill.allowedTools.length > 0) {
      frontmatter.tools = this.mapDeepChatTools(skill.allowedTools)
    }

    // Process instructions - convert ${SKILL_ROOT}/references/ to #file:'path'
    let instructions = this.processSkillRootReferences(skill.instructions)

    // Add references as #file references if present
    if (skill.references && skill.references.length > 0) {
      instructions += '\n\n## References\n\n'
      for (const ref of skill.references) {
        instructions += `See #file:'${ref.relativePath}' for ${ref.name}\n`
      }
    }

    // Generate output
    if (Object.keys(frontmatter).length > 0) {
      const yamlContent = this.serializeFrontmatter(frontmatter)
      return `---\n${yamlContent}---\n\n${instructions.trim()}`
    }

    return instructions.trim()
  }

  /**
   * Detect if content is in Copilot format
   */
  detect(content: string): boolean {
    // Copilot format: optional frontmatter, but when present has specific fields
    if (!content.trim().startsWith('---')) {
      // Without frontmatter, can't definitively identify as Copilot
      return false
    }

    try {
      const { data } = matter(content)

      // Check for Copilot-specific fields
      const hasCopilotFields =
        data.agent === 'agent' ||
        Array.isArray(data.tools) ||
        (typeof data.description === 'string' && !data.name)

      return hasCopilotFields
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
      supportsName: false, // Name from filename only
      supportsDescription: true,
      supportsTools: true,
      supportsModel: true,
      supportsSubfolders: false,
      supportsReferences: true, // Via #file syntax
      supportsScripts: false
    }
  }

  /**
   * Extract name from filename
   */
  private extractName(context: ParseContext): string {
    const filename = context.filePath.split('/').pop() || ''
    // Remove .prompt.md extension
    return filename.replace(/\.prompt\.md$/, '').replace(/\.md$/, '')
  }

  /**
   * Map Copilot tool names to DeepChat format
   */
  private mapCopilotTools(tools: unknown): string[] | undefined {
    if (!Array.isArray(tools)) {
      return undefined
    }

    const mapped: string[] = []
    for (const tool of tools) {
      if (typeof tool === 'string') {
        const deepChatTool = COPILOT_TO_DEEPCHAT_TOOLS[tool] || tool
        if (!mapped.includes(deepChatTool)) {
          mapped.push(deepChatTool)
        }
      }
    }

    return mapped.length > 0 ? mapped : undefined
  }

  /**
   * Map DeepChat tool names to Copilot format
   */
  private mapDeepChatTools(tools: string[]): string[] {
    const mapped: string[] = []
    for (const tool of tools) {
      const copilotTool = DEEPCHAT_TO_COPILOT_TOOLS[tool] || tool.toLowerCase()
      if (!mapped.includes(copilotTool)) {
        mapped.push(copilotTool)
      }
    }
    return mapped
  }

  /**
   * Convert #file:'path' references to ${SKILL_ROOT}/references/path
   */
  private processFileReferences(content: string): string {
    // Match #file:'...' patterns
    return content.replace(/#file:'([^']+)'/g, (_, path) => {
      return `\${SKILL_ROOT}/references/${path}`
    })
  }

  /**
   * Convert ${SKILL_ROOT}/references/ to #file:'path'
   */
  private processSkillRootReferences(content: string): string {
    // Match ${SKILL_ROOT}/references/... patterns
    return content.replace(/\$\{SKILL_ROOT\}\/references\/([^\s]+)/g, (_, path) => {
      return `#file:'${path}'`
    })
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
        // Use inline array format for tools
        const items = value.map((v) => `'${v}'`).join(', ')
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
