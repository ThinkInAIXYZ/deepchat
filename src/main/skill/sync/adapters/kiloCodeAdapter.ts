/**
 * Kilo Code Format Adapter
 *
 * Handles parsing and serializing skills in Kilo Code SKILL.md format.
 * Uses the same format as Claude Code (agent skills specification).
 */

import { ClaudeCodeAdapter } from './claudeCodeAdapter'
import type { CanonicalSkill, ParseContext } from '@shared/types/skillSync'

/**
 * Kilo Code format adapter
 */
export class KiloCodeAdapter extends ClaudeCodeAdapter {
  readonly id = 'kilocode'
  readonly name = 'Kilo Code'

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
