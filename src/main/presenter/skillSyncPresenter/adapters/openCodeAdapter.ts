/**
 * OpenCode Format Adapter
 *
 * Handles parsing and serializing skills in OpenCode SKILL.md format.
 * Uses the same format as Claude Code (agent skills specification).
 */

import { ClaudeCodeAdapter } from './claudeCodeAdapter'
import type { CanonicalSkill, ParseContext } from '@shared/types/skillSync'

/**
 * OpenCode format adapter
 */
export class OpenCodeAdapter extends ClaudeCodeAdapter {
  readonly id = 'opencode'
  readonly name = 'OpenCode'

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
