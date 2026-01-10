/**
 * GitHub Copilot User-Level Format Adapter
 *
 * Handles parsing and serializing skills in GitHub Copilot user-level SKILL.md format.
 * Uses the same format as Claude Code (agent skills specification).
 */

import { ClaudeCodeAdapter } from './claudeCodeAdapter'
import type { CanonicalSkill, ParseContext } from '@shared/types/skillSync'

/**
 * GitHub Copilot user-level format adapter
 */
export class CopilotUserAdapter extends ClaudeCodeAdapter {
  readonly id = 'copilot-user'
  readonly name = 'GitHub Copilot (User)'

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
