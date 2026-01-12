/**
 * CursorAdapter Unit Tests
 *
 * Cursor now uses SKILL.md format (same as Claude Code)
 */
import { describe, it, expect } from 'vitest'
import { CursorAdapter } from '../../../../../src/main/presenter/skillSyncPresenter/adapters/cursorAdapter'
import type { CanonicalSkill, ParseContext } from '../../../../../src/shared/types/skillSync'

describe('CursorAdapter', () => {
  const adapter = new CursorAdapter()

  describe('basic properties', () => {
    it('should have correct id', () => {
      expect(adapter.id).toBe('cursor')
    })

    it('should have correct name', () => {
      expect(adapter.name).toBe('Cursor')
    })
  })

  describe('getCapabilities', () => {
    it('should return correct capabilities', () => {
      const capabilities = adapter.getCapabilities()

      expect(capabilities.hasFrontmatter).toBe(true)
      expect(capabilities.supportsName).toBe(true)
      expect(capabilities.supportsDescription).toBe(true)
      expect(capabilities.supportsTools).toBe(true)
      expect(capabilities.supportsSubfolders).toBe(true)
      expect(capabilities.supportsReferences).toBe(true)
      expect(capabilities.supportsScripts).toBe(true)
    })
  })

  describe('detect', () => {
    it('should detect SKILL.md format with name and description', () => {
      const content = `---
name: my-skill
description: A test skill
---

# Instructions

Do something useful.`

      expect(adapter.detect(content)).toBe(true)
    })

    it('should not detect content without frontmatter', () => {
      const content = `# My Command

This is just some markdown content.`

      expect(adapter.detect(content)).toBe(false)
    })

    it('should not detect frontmatter without name', () => {
      const content = `---
description: A test skill
---

# Instructions`

      expect(adapter.detect(content)).toBe(false)
    })

    it('should not detect frontmatter without description', () => {
      const content = `---
name: my-skill
---

# Instructions`

      expect(adapter.detect(content)).toBe(false)
    })
  })

  describe('parse', () => {
    const baseContext: ParseContext = {
      toolId: 'cursor',
      filePath: '/project/.cursor/skills/my-skill/SKILL.md',
      folderPath: '/project/.cursor/skills/my-skill'
    }

    it('should parse basic frontmatter', () => {
      const content = `---
name: my-skill
description: A test skill description
---

# Instructions

Follow these steps.`

      const result = adapter.parse(content, baseContext)

      expect(result.name).toBe('my-skill')
      expect(result.description).toBe('A test skill description')
      expect(result.instructions).toBe('# Instructions\n\nFollow these steps.')
      expect(result.source?.tool).toBe('cursor')
      expect(result.source?.originalFormat).toBe('yaml-frontmatter-markdown')
    })

    it('should parse allowed-tools as string', () => {
      const content = `---
name: git-skill
description: Git helper
allowed-tools: Read, Grep, Bash(git:*)
---

# Git Helper`

      const result = adapter.parse(content, baseContext)

      expect(result.allowedTools).toEqual(['Read', 'Grep', 'Bash(git:*)'])
    })

    it('should parse allowed-tools as array', () => {
      const content = `---
name: git-skill
description: Git helper
allowed-tools:
  - Read
  - Grep
  - Bash(git:*)
---

# Git Helper`

      const result = adapter.parse(content, baseContext)

      expect(result.allowedTools).toEqual(['Read', 'Grep', 'Bash(git:*)'])
    })
  })

  describe('serialize', () => {
    it('should serialize skill to SKILL.md format', () => {
      const skill: CanonicalSkill = {
        name: 'my-skill',
        description: 'A test skill',
        instructions: '# Do something useful'
      }

      const result = adapter.serialize(skill)

      expect(result).toContain('---')
      expect(result).toContain('name: my-skill')
      expect(result).toContain('description: A test skill')
      expect(result).toContain('# Do something useful')
    })

    it('should serialize allowed-tools', () => {
      const skill: CanonicalSkill = {
        name: 'git-skill',
        description: 'Git helper',
        instructions: '# Git operations',
        allowedTools: ['Read', 'Grep', 'Bash(git:*)']
      }

      const result = adapter.serialize(skill)

      expect(result).toContain('allowed-tools:')
      expect(result).toContain('Read')
      expect(result).toContain('Grep')
      expect(result).toContain('Bash(git:*)')
    })
  })
})
