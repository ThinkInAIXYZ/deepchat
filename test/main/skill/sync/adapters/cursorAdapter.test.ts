import { describe, expect, it } from 'vitest'
import { CursorAdapter } from '../../../../../src/main/skill/sync/adapters/cursorAdapter'

describe('CursorAdapter', () => {
  const adapter = new CursorAdapter()

  it('keeps Cursor identity while reusing the Claude Code format contract', () => {
    const result = adapter.parse(
      `---
name: my-skill
description: A test skill
allowed-tools: Read, Grep
---

# Instructions`,
      {
        toolId: 'cursor',
        filePath: '/project/.cursor/skills/my-skill/SKILL.md',
        folderPath: '/project/.cursor/skills/my-skill'
      }
    )

    expect(adapter.id).toBe('cursor')
    expect(adapter.name).toBe('Cursor')
    expect(result).toMatchObject({
      name: 'my-skill',
      description: 'A test skill',
      instructions: '# Instructions',
      allowedTools: ['Read', 'Grep'],
      source: {
        tool: 'cursor',
        originalPath: '/project/.cursor/skills/my-skill/SKILL.md',
        originalFormat: 'yaml-frontmatter-markdown'
      }
    })
  })
})
