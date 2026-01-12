/**
 * OpenAI Codex Format Adapter
 *
 * Handles parsing and serializing skills in OpenAI Codex SKILL.md format.
 *
 * Format characteristics:
 * - YAML frontmatter with name, description, allowed-tools
 * - Markdown body with instructions
 * - Supports subfolder structure (references/, scripts/)
 * - Follows the agent skills specification (agentskills.io)
 * - Identical format to Claude Code
 */

import { ClaudeCodeAdapter } from './claudeCodeAdapter'
import type { CanonicalSkill, ParseContext } from '@shared/types/skillSync'

/**
 * OpenAI Codex format adapter
 *
 * Codex uses the same SKILL.md format as Claude Code, following the
 * agent skills specification. This adapter extends ClaudeCodeAdapter
 * and only overrides the id, name, and source tracking.
 */
export class CodexAdapter extends ClaudeCodeAdapter {
  readonly id = 'codex'
  readonly name = 'OpenAI Codex'

  /**
   * Parse Codex SKILL.md format to CanonicalSkill
   * Uses the same parsing logic as Claude Code, but updates source info
   */
  parse(content: string, context: ParseContext): CanonicalSkill {
    const skill = super.parse(content, context)

    // Update source to reflect Codex origin
    skill.source = {
      tool: this.id,
      originalPath: context.filePath,
      originalFormat: 'yaml-frontmatter-markdown'
    }

    return skill
  }
}
