/**
 * CursorAdapter Unit Tests
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

      expect(capabilities.hasFrontmatter).toBe(false)
      expect(capabilities.supportsName).toBe(true)
      expect(capabilities.supportsDescription).toBe(true)
      expect(capabilities.supportsTools).toBe(false)
      expect(capabilities.supportsModel).toBe(false)
      expect(capabilities.supportsSubfolders).toBe(false)
      expect(capabilities.supportsReferences).toBe(false)
      expect(capabilities.supportsScripts).toBe(false)
    })
  })

  describe('detect', () => {
    it('should detect pure markdown with title', () => {
      const content = `# My Command

This is a command description.

## Objective

Do something useful.`

      expect(adapter.detect(content)).toBe(true)
    })

    it('should not detect content with frontmatter', () => {
      const content = `---
name: my-skill
---

# My Command

Content here.`

      expect(adapter.detect(content)).toBe(false)
    })

    it('should not detect content without title', () => {
      const content = `This is just some markdown content.

With multiple paragraphs.`

      expect(adapter.detect(content)).toBe(false)
    })

    it('should not detect Windsurf format (has ## Steps)', () => {
      const content = `# My Workflow

A workflow description.

## Steps

### 1. First step

Do something.`

      expect(adapter.detect(content)).toBe(false)
    })

    it('should detect markdown with multiple headings', () => {
      const content = `# Code Review Command

Review the current code for issues.

## Guidelines

- Check for bugs
- Look for performance issues`

      expect(adapter.detect(content)).toBe(true)
    })
  })

  describe('parse', () => {
    const baseContext: ParseContext = {
      toolId: 'cursor',
      filePath: '/project/.cursor/commands/my-command.md'
    }

    it('should extract name from title', () => {
      const content = `# My Custom Command

This is the description.

## Objective

Do something.`

      const result = adapter.parse(content, baseContext)

      expect(result.name).toBe('my-custom-command')
    })

    it('should extract description from first paragraph after title', () => {
      const content = `# Test Command

This is the description paragraph.

## More content

Additional info.`

      const result = adapter.parse(content, baseContext)

      expect(result.description).toBe('This is the description paragraph.')
    })

    it('should use full content as instructions', () => {
      const content = `# My Command

Description here.

## Steps

1. Do this
2. Do that`

      const result = adapter.parse(content, baseContext)

      expect(result.instructions).toBe(content.trim())
    })

    it('should include source information', () => {
      const content = `# Test

Description.`

      const result = adapter.parse(content, baseContext)

      expect(result.source).toEqual({
        tool: 'cursor',
        originalPath: '/project/.cursor/commands/my-command.md',
        originalFormat: 'pure-markdown'
      })
    })

    it('should use filename as fallback when no title', () => {
      const content = `Just some content without a title.

More content.`

      const context: ParseContext = {
        toolId: 'cursor',
        filePath: '/path/to/fallback-name.md'
      }

      const result = adapter.parse(content, context)

      expect(result.name).toBe('fallback-name')
    })

    it('should convert title to kebab-case name', () => {
      const content = `# Code Review Helper

Review code.`

      const result = adapter.parse(content, baseContext)

      expect(result.name).toBe('code-review-helper')
    })

    it('should handle empty description', () => {
      const content = `# Command

## First Section

Content.`

      const result = adapter.parse(content, baseContext)

      expect(result.description).toBe('')
    })

    it('should remove special characters from name', () => {
      const content = `# Code Review: The Best! (2024)

A command.`

      const result = adapter.parse(content, baseContext)

      expect(result.name).toBe('code-review-the-best-2024')
    })
  })

  describe('serialize', () => {
    it('should serialize with title and description', () => {
      const skill: CanonicalSkill = {
        name: 'my-command',
        description: 'A test command description',
        instructions: 'Do something useful.'
      }

      const result = adapter.serialize(skill)

      expect(result).toContain('# My Command')
      expect(result).toContain('A test command description')
    })

    it('should add Objective section if instructions have no heading', () => {
      const skill: CanonicalSkill = {
        name: 'simple-command',
        description: 'A simple command',
        instructions: 'Just do this thing.'
      }

      const result = adapter.serialize(skill)

      expect(result).toContain('## Objective')
      expect(result).toContain('Just do this thing.')
    })

    it('should preserve existing headings in instructions', () => {
      const skill: CanonicalSkill = {
        name: 'complex-command',
        description: 'A complex command',
        instructions: '## Steps\n\n1. First step\n2. Second step'
      }

      const result = adapter.serialize(skill)

      expect(result).not.toMatch(/## Objective[\s\S]*## Steps/)
      expect(result).toContain('## Steps')
    })

    it('should inline references when present', () => {
      const skill: CanonicalSkill = {
        name: 'command-with-refs',
        description: 'Has references',
        instructions: 'Main content.',
        references: [
          { name: 'guide.md', content: 'Guide content', relativePath: 'references/guide.md' },
          { name: 'rules.md', content: 'Rules content', relativePath: 'references/rules.md' }
        ]
      }

      const result = adapter.serialize(skill)

      expect(result).toContain('## References')
      expect(result).toContain('### guide.md')
      expect(result).toContain('Guide content')
      expect(result).toContain('### rules.md')
      expect(result).toContain('Rules content')
    })

    it('should not inline references when inlineReferences is false', () => {
      const skill: CanonicalSkill = {
        name: 'command-with-refs',
        description: 'Has references',
        instructions: 'Main content.',
        references: [
          { name: 'guide.md', content: 'Guide content', relativePath: 'references/guide.md' }
        ]
      }

      const result = adapter.serialize(skill, { inlineReferences: false })

      expect(result).not.toContain('## References')
      expect(result).not.toContain('Guide content')
    })

    it('should convert kebab-case name to title case', () => {
      const skill: CanonicalSkill = {
        name: 'complex-multi-word-name',
        description: 'Test',
        instructions: 'Content'
      }

      const result = adapter.serialize(skill)

      expect(result).toContain('# Complex Multi Word Name')
    })
  })

  describe('round-trip conversion', () => {
    it('should preserve basic data through parse and serialize cycle', () => {
      const original = `# My Test Command

This is the command description.

## Objective

Follow these instructions carefully.`

      const context: ParseContext = {
        toolId: 'cursor',
        filePath: '/path/to/command.md'
      }

      const parsed = adapter.parse(original, context)
      const serialized = adapter.serialize(parsed)
      const reparsed = adapter.parse(serialized, context)

      expect(reparsed.name).toBe(parsed.name)
      expect(reparsed.description).toBe(parsed.description)
    })
  })
})
