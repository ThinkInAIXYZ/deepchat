/**
 * KiroAdapter Unit Tests
 */
import { describe, it, expect } from 'vitest'
import { KiroAdapter } from '../../../../../src/main/presenter/skillSyncPresenter/adapters/kiroAdapter'
import type {
  CanonicalSkill,
  ParseContext,
  KiroExportOptions
} from '../../../../../src/shared/types/skillSync'

describe('KiroAdapter', () => {
  const adapter = new KiroAdapter()

  describe('basic properties', () => {
    it('should have correct id', () => {
      expect(adapter.id).toBe('kiro')
    })

    it('should have correct name', () => {
      expect(adapter.name).toBe('Kiro')
    })
  })

  describe('getCapabilities', () => {
    it('should return correct capabilities', () => {
      const capabilities = adapter.getCapabilities()

      expect(capabilities.hasFrontmatter).toBe(true)
      expect(capabilities.supportsName).toBe(true)
      expect(capabilities.supportsDescription).toBe(false)
      expect(capabilities.supportsTools).toBe(false)
      expect(capabilities.supportsModel).toBe(false)
      expect(capabilities.supportsSubfolders).toBe(false)
      expect(capabilities.supportsReferences).toBe(false)
      expect(capabilities.supportsScripts).toBe(false)
    })
  })

  describe('detect', () => {
    it('should detect content with title field', () => {
      const content = `---
title: My Steering File
---

# Instructions`

      expect(adapter.detect(content)).toBe(true)
    })

    it('should detect content with inclusion field (always)', () => {
      const content = `---
inclusion: always
---

# Instructions`

      expect(adapter.detect(content)).toBe(true)
    })

    it('should detect content with inclusion field (conditional)', () => {
      const content = `---
inclusion: conditional
file_patterns: ["*.ts", "*.tsx"]
---

# Instructions`

      expect(adapter.detect(content)).toBe(true)
    })

    it('should detect content with file_patterns array', () => {
      const content = `---
file_patterns: ["*.py"]
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
invalid yaml: [
---

# Content`

      expect(adapter.detect(content)).toBe(false)
    })
  })

  describe('parse', () => {
    const baseContext: ParseContext = {
      toolId: 'kiro',
      filePath: '/project/.kiro/steering/coding-standards.md'
    }

    it('should extract name from title', () => {
      const content = `---
title: Coding Standards
---

# Standards

Follow these.`

      const result = adapter.parse(content, baseContext)

      expect(result.name).toBe('coding-standards')
    })

    it('should convert title to kebab-case', () => {
      const content = `---
title: My Custom Steering File
---

Content`

      const result = adapter.parse(content, baseContext)

      expect(result.name).toBe('my-custom-steering-file')
    })

    it('should use filename as fallback name', () => {
      const content = `---
inclusion: always
---

Content`

      const context: ParseContext = {
        toolId: 'kiro',
        filePath: '/path/fallback-name.md'
      }

      const result = adapter.parse(content, context)

      expect(result.name).toBe('fallback-name')
    })

    it('should extract description from blockquote at start', () => {
      const content = `---
title: Test
---

> This is the description from a blockquote.

# Instructions

Actual instructions here.`

      const result = adapter.parse(content, baseContext)

      expect(result.description).toBe('This is the description from a blockquote.')
    })

    it('should handle multi-line blockquote description', () => {
      const content = `---
title: Test
---

> This is a multi-line
> blockquote description.

# Instructions`

      const result = adapter.parse(content, baseContext)

      expect(result.description).toBe('This is a multi-line blockquote description.')
    })

    it('should handle empty description when no blockquote', () => {
      const content = `---
title: Test
---

# Instructions

Start with heading.`

      const result = adapter.parse(content, baseContext)

      expect(result.description).toBe('')
    })

    it('should embed Kiro meta info as comments in instructions', () => {
      const content = `---
title: Conditional
inclusion: conditional
file_patterns: ["*.ts", "*.tsx"]
---

# Instructions`

      const result = adapter.parse(content, baseContext)

      expect(result.instructions).toContain('<!-- Kiro inclusion: conditional -->')
      expect(result.instructions).toContain('<!-- file_patterns: *.ts, *.tsx -->')
    })

    it('should include source information', () => {
      const content = `---
title: Test
---

Content`

      const result = adapter.parse(content, baseContext)

      expect(result.source).toEqual({
        tool: 'kiro',
        originalPath: '/project/.kiro/steering/coding-standards.md',
        originalFormat: 'kiro-steering'
      })
    })

    it('should handle inclusion: always', () => {
      const content = `---
title: Always Active
inclusion: always
---

# Instructions`

      const result = adapter.parse(content, baseContext)

      expect(result.instructions).toContain('<!-- Kiro inclusion: always -->')
    })
  })

  describe('serialize', () => {
    it('should convert name to title in frontmatter', () => {
      const skill: CanonicalSkill = {
        name: 'coding-standards',
        description: '',
        instructions: '# Standards\n\nFollow these.'
      }

      const result = adapter.serialize(skill)

      expect(result).toContain('title: Coding Standards')
    })

    it('should embed description as blockquote', () => {
      const skill: CanonicalSkill = {
        name: 'test',
        description: 'This is the skill description',
        instructions: '# Instructions\n\nDo something.'
      }

      const result = adapter.serialize(skill)

      expect(result).toContain('> This is the skill description')
    })

    it('should set inclusion mode from options', () => {
      const skill: CanonicalSkill = {
        name: 'test',
        description: '',
        instructions: 'Content'
      }

      const options: KiroExportOptions = {
        inclusion: 'always'
      }

      const result = adapter.serialize(skill, options)

      expect(result).toContain('inclusion: always')
    })

    it('should add file_patterns for conditional inclusion', () => {
      const skill: CanonicalSkill = {
        name: 'test',
        description: '',
        instructions: 'Content'
      }

      const options: KiroExportOptions = {
        inclusion: 'conditional',
        filePatterns: ['*.ts', '*.tsx']
      }

      const result = adapter.serialize(skill, options)

      expect(result).toContain('inclusion: conditional')
      expect(result).toContain('file_patterns:')
      expect(result).toContain('"*.ts"')
      expect(result).toContain('"*.tsx"')
    })

    it('should remove Kiro meta comments from instructions', () => {
      const skill: CanonicalSkill = {
        name: 'test',
        description: '',
        instructions:
          '<!-- Kiro inclusion: conditional -->\n<!-- file_patterns: *.ts -->\n\n# Instructions'
      }

      const result = adapter.serialize(skill)

      expect(result).not.toContain('<!-- Kiro inclusion:')
      expect(result).not.toContain('<!-- file_patterns:')
      expect(result).toContain('# Instructions')
    })

    it('should handle on-demand inclusion mode', () => {
      const skill: CanonicalSkill = {
        name: 'test',
        description: '',
        instructions: 'Content'
      }

      const options: KiroExportOptions = {
        inclusion: 'on-demand'
      }

      const result = adapter.serialize(skill, options)

      expect(result).toContain('inclusion: on-demand')
    })

    it('should quote title with special characters', () => {
      const skill: CanonicalSkill = {
        name: 'special-chars',
        description: '',
        instructions: 'Content'
      }

      // Name converts to "Special Chars" which shouldn't need quoting
      const result = adapter.serialize(skill)

      expect(result).toContain('title: Special Chars')
    })

    it('should handle empty instructions', () => {
      const skill: CanonicalSkill = {
        name: 'empty',
        description: 'Description only',
        instructions: ''
      }

      const result = adapter.serialize(skill)

      expect(result).toContain('> Description only')
    })
  })

  describe('round-trip conversion', () => {
    it('should preserve data through parse and serialize cycle', () => {
      const original = `---
title: My Steering File
inclusion: conditional
file_patterns: ["*.ts", "*.tsx"]
---

> This is a description embedded as blockquote.

# Instructions

Follow these guidelines for TypeScript files.`

      const context: ParseContext = {
        toolId: 'kiro',
        filePath: '/path/to/steering.md'
      }

      const parsed = adapter.parse(original, context)

      // Verify parsed data
      expect(parsed.name).toBe('my-steering-file')
      expect(parsed.description).toBe('This is a description embedded as blockquote.')
      expect(parsed.instructions).toContain('Kiro inclusion: conditional')

      // Serialize with same options
      const options: KiroExportOptions = {
        inclusion: 'conditional',
        filePatterns: ['*.ts', '*.tsx']
      }
      const serialized = adapter.serialize(parsed, options)

      // Verify serialized output
      expect(serialized).toContain('title: My Steering File')
      expect(serialized).toContain('inclusion: conditional')
      expect(serialized).toContain('file_patterns:')
    })
  })
})
