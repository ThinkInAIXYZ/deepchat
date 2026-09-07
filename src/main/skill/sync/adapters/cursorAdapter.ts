/**
 * Cursor Format Adapter
 *
 * Handles parsing and serializing skills in Cursor SKILL.md format.
 * Uses the same format as Claude Code (agent skills specification).
 */

import { ClaudeCodeAdapter } from './claudeCodeAdapter'
import type { CanonicalSkill, ParseContext } from '@shared/types/skillSync'

/**
 * Cursor format adapter
 */
export class CursorAdapter extends ClaudeCodeAdapter {
  readonly id = 'cursor'
  readonly name = 'Cursor'

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
