/**
 * CopilotAdapter Unit Tests
 */
import { describe, it, expect } from 'vitest'
import { CopilotAdapter } from '../../../../../src/main/presenter/skillSyncPresenter/adapters/copilotAdapter'
import type { CanonicalSkill, ParseContext } from '../../../../../src/shared/types/skillSync'

describe('CopilotAdapter', () => {
  const adapter = new CopilotAdapter()

  describe('basic properties', () => {
    it('should have correct id', () => {
      expect(adapter.id).toBe('copilot')
    })

    it('should have correct name', () => {
      expect(adapter.name).toBe('GitHub Copilot')
    })
  })

  describe('getCapabilities', () => {
    it('should return correct capabilities', () => {
      const capabilities = adapter.getCapabilities()

      expect(capabilities.hasFrontmatter).toBe(true)
      expect(capabilities.supportsName).toBe(false)
      expect(capabilities.supportsDescription).toBe(true)
      expect(capabilities.supportsTools).toBe(true)
      expect(capabilities.supportsModel).toBe(true)
      expect(capabilities.supportsSubfolders).toBe(false)
      expect(capabilities.supportsReferences).toBe(true)
      expect(capabilities.supportsScripts).toBe(false)
    })
  })

  describe('detect', () => {
    it('should detect content with agent field', () => {
      const content = `---
description: A prompt file
agent: agent
---

# Instructions`

      expect(adapter.detect(content)).toBe(true)
    })

    it('should detect content with tools array', () => {
      const content = `---
description: A prompt
tools: ['read', 'edit']
---

# Instructions`

      expect(adapter.detect(content)).toBe(true)
    })

    it('should detect content with description but no name', () => {
      const content = `---
description: Just a description
---

# Instructions`

      expect(adapter.detect(content)).toBe(true)
    })

    it('should not detect content without frontmatter', () => {
      const content = `# Just Markdown

Content here.`

      expect(adapter.detect(content)).toBe(false)
    })

    it('should not detect Claude Code format (has name and description)', () => {
      const content = `---
name: my-skill
description: Claude Code skill
---

# Instructions`

      expect(adapter.detect(content)).toBe(false)
    })

    it('should not detect invalid frontmatter', () => {
      const content = `---
invalid: yaml: [
---

# Content`

      expect(adapter.detect(content)).toBe(false)
    })
  })

  describe('parse', () => {
    const baseContext: ParseContext = {
      toolId: 'copilot',
      filePath: '/project/.github/prompts/code-review.prompt.md'
    }

    it('should extract name from filename', () => {
      const content = `---
description: Review code
---

# Instructions`

      const result = adapter.parse(content, baseContext)

      expect(result.name).toBe('code-review')
    })

    it('should remove .prompt.md extension from name', () => {
      const context: ParseContext = {
        toolId: 'copilot',
        filePath: '/path/my-prompt.prompt.md'
      }

      const content = `---
description: Test
---

Content`

      const result = adapter.parse(content, context)

      expect(result.name).toBe('my-prompt')
    })

    it('should extract description from frontmatter', () => {
      const content = `---
description: This is the prompt description
agent: agent
---

# Instructions`

      const result = adapter.parse(content, baseContext)

      expect(result.description).toBe('This is the prompt description')
    })

    it('should map Copilot tools to DeepChat format', () => {
      const content = `---
description: Tool test
tools: ['read', 'edit', 'runCommands', 'search/codebase']
---

# Content`

      const result = adapter.parse(content, baseContext)

      expect(result.allowedTools).toContain('Read')
      expect(result.allowedTools).toContain('Edit')
      expect(result.allowedTools).toContain('Bash')
      expect(result.allowedTools).toContain('Grep')
    })

    it('should preserve unknown tool names', () => {
      const content = `---
description: Test
tools: ['customTool', 'anotherTool']
---

Content`

      const result = adapter.parse(content, baseContext)

      expect(result.allowedTools).toContain('customTool')
      expect(result.allowedTools).toContain('anotherTool')
    })

    it('should parse model field', () => {
      const content = `---
description: Test
model: gpt-4
---

Content`

      const result = adapter.parse(content, baseContext)

      expect(result.model).toBe('gpt-4')
    })

    it('should convert #file references to SKILL_ROOT paths', () => {
      const content = `---
description: Test
---

Check #file:'docs/api.md' for API info.
Also see #file:'rules/coding.md' for coding rules.`

      const result = adapter.parse(content, baseContext)

      expect(result.instructions).toContain('${SKILL_ROOT}/references/docs/api.md')
      expect(result.instructions).toContain('${SKILL_ROOT}/references/rules/coding.md')
    })

    it('should include source information', () => {
      const content = `---
description: Test
---

Content`

      const result = adapter.parse(content, baseContext)

      expect(result.source).toEqual({
        tool: 'copilot',
        originalPath: '/project/.github/prompts/code-review.prompt.md',
        originalFormat: 'prompt-md'
      })
    })

    it('should handle missing description', () => {
      const content = `---
agent: agent
---

Content`

      const result = adapter.parse(content, baseContext)

      expect(result.description).toBe('')
    })

    it('should deduplicate mapped tools', () => {
      const content = `---
description: Test
tools: ['read', 'read', 'edit']
---

Content`

      const result = adapter.parse(content, baseContext)

      const readCount = result.allowedTools?.filter((t) => t === 'Read').length
      expect(readCount).toBe(1)
    })
  })

  describe('serialize', () => {
    it('should include description in frontmatter', () => {
      const skill: CanonicalSkill = {
        name: 'my-prompt',
        description: 'A test prompt',
        instructions: '# Instructions\n\nDo something.'
      }

      const result = adapter.serialize(skill)

      expect(result).toContain('description: A test prompt')
    })

    it('should always add agent field', () => {
      const skill: CanonicalSkill = {
        name: 'test',
        description: 'Test',
        instructions: 'Content'
      }

      const result = adapter.serialize(skill)

      expect(result).toContain('agent: agent')
    })

    it('should include model when present', () => {
      const skill: CanonicalSkill = {
        name: 'test',
        description: 'Test',
        instructions: 'Content',
        model: 'gpt-4-turbo'
      }

      const result = adapter.serialize(skill)

      expect(result).toContain('model: gpt-4-turbo')
    })

    it('should map DeepChat tools to Copilot format', () => {
      const skill: CanonicalSkill = {
        name: 'test',
        description: 'Test',
        instructions: 'Content',
        allowedTools: ['Read', 'Edit', 'Bash', 'Grep', 'Glob']
      }

      const result = adapter.serialize(skill)

      expect(result).toContain("'read'")
      expect(result).toContain("'edit'")
      expect(result).toContain("'runCommands'")
      expect(result).toContain("'search/codebase'")
    })

    it('should convert SKILL_ROOT references to #file syntax', () => {
      const skill: CanonicalSkill = {
        name: 'test',
        description: 'Test',
        instructions: 'See ${SKILL_ROOT}/references/docs/api.md for details.'
      }

      const result = adapter.serialize(skill)

      expect(result).toContain("#file:'docs/api.md'")
    })

    it('should add references as #file references', () => {
      const skill: CanonicalSkill = {
        name: 'test',
        description: 'Test',
        instructions: 'Main content.',
        references: [
          { name: 'guide.md', content: 'Guide', relativePath: 'references/guide.md' },
          { name: 'rules.md', content: 'Rules', relativePath: 'references/rules.md' }
        ]
      }

      const result = adapter.serialize(skill)

      expect(result).toContain('## References')
      expect(result).toContain("#file:'references/guide.md'")
      expect(result).toContain("#file:'references/rules.md'")
    })

    it('should quote description with special characters', () => {
      const skill: CanonicalSkill = {
        name: 'test',
        description: 'A prompt: with special #chars',
        instructions: 'Content'
      }

      const result = adapter.serialize(skill)

      expect(result).toContain('"A prompt: with special #chars"')
    })

    it('should output only content when no frontmatter needed', () => {
      const skill: CanonicalSkill = {
        name: 'test',
        description: '',
        instructions: 'Just content'
      }

      const result = adapter.serialize(skill)

      // Should still have agent field
      expect(result).toContain('agent: agent')
    })

    it('should deduplicate mapped tools', () => {
      const skill: CanonicalSkill = {
        name: 'test',
        description: 'Test',
        instructions: 'Content',
        allowedTools: ['Grep', 'Glob'] // Both map to search/codebase
      }

      const result = adapter.serialize(skill)

      const matches = result.match(/'search\/codebase'/g)
      expect(matches?.length).toBe(1)
    })
  })

  describe('round-trip conversion', () => {
    it('should preserve data through parse and serialize cycle', () => {
      const original = `---
description: A code review prompt
agent: agent
model: gpt-4
tools: ['read', 'edit']
---

# Code Review

Review the code carefully.

Check #file:'docs/standards.md' for coding standards.`

      const context: ParseContext = {
        toolId: 'copilot',
        filePath: '/path/to/review.prompt.md'
      }

      const parsed = adapter.parse(original, context)
      const serialized = adapter.serialize(parsed)
      const reparsed = adapter.parse(serialized, context)

      expect(reparsed.name).toBe(parsed.name)
      expect(reparsed.description).toBe(parsed.description)
      expect(reparsed.model).toBe(parsed.model)
      expect(reparsed.allowedTools).toEqual(parsed.allowedTools)
    })
  })
})
