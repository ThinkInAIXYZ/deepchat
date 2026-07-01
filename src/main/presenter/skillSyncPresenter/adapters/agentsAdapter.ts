/**
 * Agents Format Adapter
 *
 * Handles parsing and serializing skills in the generic Agents SKILL.md format.
 * Uses the same format as Claude Code (agent skills specification).
 */

import { ClaudeCodeAdapter } from './claudeCodeAdapter'
import type { CanonicalSkill, ParseContext } from '@shared/types/skillSync'

/**
 * Generic Agents format adapter
 */
export class AgentsAdapter extends ClaudeCodeAdapter {
  readonly id = 'agents'
  readonly name = 'Agents'

  parse(content: string, context: ParseContext): CanonicalSkill {
    const skill = super.parse(content, context)
    skill.source = {
      tool: this.id,
      originalPath: context.filePath,
      originalFormat: 'yaml-frontmatter-markdown'
    }
    return skill
  }
}
