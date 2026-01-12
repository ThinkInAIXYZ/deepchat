/**
 * Goose Format Adapter
 *
 * Handles parsing and serializing skills in Goose SKILL.md format.
 * Uses the same format as Claude Code (agent skills specification).
 */

import { ClaudeCodeAdapter } from './claudeCodeAdapter'
import type { CanonicalSkill, ParseContext } from '@shared/types/skillSync'

/**
 * Goose format adapter
 */
export class GooseAdapter extends ClaudeCodeAdapter {
  readonly id = 'goose'
  readonly name = 'Goose'

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
