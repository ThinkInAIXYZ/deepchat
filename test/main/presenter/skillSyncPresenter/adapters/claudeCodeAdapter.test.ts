/**
 * ClaudeCodeAdapter Unit Tests
 */
import { describe, it, expect } from 'vitest'
import { ClaudeCodeAdapter } from '../../../../../src/main/presenter/skillSyncPresenter/adapters/claudeCodeAdapter'
import type { CanonicalSkill, ParseContext } from '../../../../../src/shared/types/skillSync'

describe('ClaudeCodeAdapter', () => {
  const adapter = new ClaudeCodeAdapter()

  describe('basic properties', () => {
    it('should have correct id', () => {
      expect(adapter.id).toBe('claude-code')
    })

    it('should have correct name', () => {
      expect(adapter.name).toBe('Claude Code')
    })
  })

  describe('getCapabilities', () => {
    it('should return correct capabilities', () => {
      const capabilities = adapter.getCapabilities()

      expect(capabilities.hasFrontmatter).toBe(true)
      expect(capabilities.supportsName).toBe(true)
      expect(capabilities.supportsDescription).toBe(true)
      expect(capabilities.supportsTools).toBe(true)
      expect(capabilities.supportsModel).toBe(false)
      expect(capabilities.supportsSubfolders).toBe(true)
      expect(capabilities.supportsReferences).toBe(true)
      expect(capabilities.supportsScripts).toBe(true)
    })
  })

  describe('detect', () => {
    it('should detect valid Claude Code format with name and description', () => {
      const content = `---
name: my-skill
description: A test skill
---

# Instructions

Do something useful.`

      expect(adapter.detect(content)).toBe(true)
    })

    it('should not detect content without frontmatter', () => {
      const content = `# My Skill

Just some markdown content.`

      expect(adapter.detect(content)).toBe(false)
    })

    it('should not detect content with invalid frontmatter', () => {
      const content = `---
invalid yaml: [
---

# Content`

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

    it('should detect frontmatter with allowed-tools', () => {
      const content = `---
name: git-skill
description: Git helper
allowed-tools: Read, Grep, Bash(git:*)
---

# Git Helper`

      expect(adapter.detect(content)).toBe(true)
    })
  })

  describe('parse', () => {
    const baseContext: ParseContext = {
      toolId: 'claude-code',
      filePath: '/home/user/.claude/skills/my-skill/SKILL.md',
      folderPath: '/home/user/.claude/skills/my-skill'
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
    })

    it('should parse allowed-tools as comma-separated string', () => {
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

    it('should parse model field', () => {
      const content = `---
name: special-skill
description: Uses specific model
model: claude-3-opus
---

# Content`

      const result = adapter.parse(content, baseContext)

      expect(result.model).toBe('claude-3-opus')
    })

    it('should parse tags field', () => {
      const content = `---
name: tagged-skill
description: Has tags
tags:
  - git
  - automation
---

# Content`

      const result = adapter.parse(content, baseContext)

      expect(result.tags).toEqual(['git', 'automation'])
    })

    it('should include source information', () => {
      const content = `---
name: my-skill
description: Test
---

Content`

      const result = adapter.parse(content, baseContext)

      expect(result.source).toEqual({
        tool: 'claude-code',
        originalPath: '/home/user/.claude/skills/my-skill/SKILL.md',
        originalFormat: 'yaml-frontmatter-markdown'
      })
    })

    it('should extract name from folder path when not in frontmatter', () => {
      const content = `---
description: A skill without name
---

Content`

      const result = adapter.parse(content, baseContext)

      expect(result.name).toBe('my-skill')
    })

    it('should return unnamed-skill when no name available', () => {
      const content = `---
description: No name skill
---

Content`

      const contextWithoutFolder: ParseContext = {
        toolId: 'claude-code',
        filePath: '/some/path/SKILL.md'
      }

      const result = adapter.parse(content, contextWithoutFolder)

      expect(result.name).toBe('unnamed-skill')
    })

    it('should handle empty description', () => {
      const content = `---
name: my-skill
description:
---

Content`

      const result = adapter.parse(content, baseContext)

      expect(result.description).toBe('')
    })

    it('should trim whitespace from instructions', () => {
      const content = `---
name: my-skill
description: Test
---


  Content here
   `

      const result = adapter.parse(content, baseContext)

      expect(result.instructions).toBe('Content here')
    })
  })

  describe('serialize', () => {
    it('should serialize basic skill', () => {
      const skill: CanonicalSkill = {
        name: 'my-skill',
        description: 'A test skill',
        instructions: '# Instructions\n\nDo something.'
      }

      const result = adapter.serialize(skill)

      expect(result).toContain('---')
      expect(result).toContain('name: my-skill')
      expect(result).toContain('description: A test skill')
      expect(result).toContain('# Instructions')
      expect(result).toContain('Do something.')
    })

    it('should serialize single allowed tool as string', () => {
      const skill: CanonicalSkill = {
        name: 'my-skill',
        description: 'Test',
        instructions: 'Content',
        allowedTools: ['Read']
      }

      const result = adapter.serialize(skill)

      expect(result).toContain('allowed-tools: Read')
    })

    it('should serialize multiple allowed tools as array', () => {
      const skill: CanonicalSkill = {
        name: 'my-skill',
        description: 'Test',
        instructions: 'Content',
        allowedTools: ['Read', 'Grep', 'Bash']
      }

      const result = adapter.serialize(skill)

      expect(result).toContain('allowed-tools:')
      expect(result).toContain('  - Read')
      expect(result).toContain('  - Grep')
      expect(result).toContain('  - Bash')
    })

    it('should serialize model when present', () => {
      const skill: CanonicalSkill = {
        name: 'my-skill',
        description: 'Test',
        instructions: 'Content',
        model: 'claude-3-sonnet'
      }

      const result = adapter.serialize(skill)

      expect(result).toContain('model: claude-3-sonnet')
    })

    it('should serialize tags when present', () => {
      const skill: CanonicalSkill = {
        name: 'my-skill',
        description: 'Test',
        instructions: 'Content',
        tags: ['git', 'automation']
      }

      const result = adapter.serialize(skill)

      expect(result).toContain('tags:')
      expect(result).toContain('  - git')
      expect(result).toContain('  - automation')
    })

    it('should add license when provided in options', () => {
      const skill: CanonicalSkill = {
        name: 'my-skill',
        description: 'Test',
        instructions: 'Content'
      }

      const result = adapter.serialize(skill, { license: 'MIT' })

      expect(result).toContain('license: MIT')
    })

    it('should quote values with special characters', () => {
      const skill: CanonicalSkill = {
        name: 'my-skill',
        description: 'A skill with: colons and # hashes',
        instructions: 'Content'
      }

      const result = adapter.serialize(skill)

      expect(result).toContain('description: "A skill with: colons and # hashes"')
    })

    it('should escape quotes in values', () => {
      const skill: CanonicalSkill = {
        name: 'my-skill',
        description: 'A skill with "quotes"',
        instructions: 'Content'
      }

      const result = adapter.serialize(skill)

      expect(result).toContain('A skill with \\"quotes\\"')
    })

    it('should not include empty allowedTools array', () => {
      const skill: CanonicalSkill = {
        name: 'my-skill',
        description: 'Test',
        instructions: 'Content',
        allowedTools: []
      }

      const result = adapter.serialize(skill)

      expect(result).not.toContain('allowed-tools')
    })

    it('should not include empty tags array', () => {
      const skill: CanonicalSkill = {
        name: 'my-skill',
        description: 'Test',
        instructions: 'Content',
        tags: []
      }

      const result = adapter.serialize(skill)

      expect(result).not.toContain('tags')
    })
  })

  describe('round-trip conversion', () => {
    it('should preserve data through parse and serialize cycle', () => {
      const original = `---
name: round-trip-skill
description: Testing round-trip conversion
allowed-tools:
  - Read
  - Grep
tags:
  - test
  - conversion
---

# Instructions

This is a test skill with multiple features.

## Steps

1. First step
2. Second step`

      const context: ParseContext = {
        toolId: 'claude-code',
        filePath: '/path/to/SKILL.md'
      }

      const parsed = adapter.parse(original, context)
      const serialized = adapter.serialize(parsed)
      const reparsed = adapter.parse(serialized, context)

      expect(reparsed.name).toBe(parsed.name)
      expect(reparsed.description).toBe(parsed.description)
      expect(reparsed.allowedTools).toEqual(parsed.allowedTools)
      expect(reparsed.tags).toEqual(parsed.tags)
      expect(reparsed.instructions).toBe(parsed.instructions)
    })
  })
})
