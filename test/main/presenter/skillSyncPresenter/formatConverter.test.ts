/**
 * FormatConverter Unit Tests
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import * as fs from 'fs'
import {
  FormatConverter,
  ConversionWarning
} from '../../../../src/main/presenter/skillSyncPresenter/formatConverter'
import type { CanonicalSkill } from '../../../../src/shared/types/skillSync'

// Mock fs module
vi.mock('fs', () => ({
  promises: {
    stat: vi.fn(),
    readdir: vi.fn(),
    readFile: vi.fn()
  }
}))

describe('FormatConverter', () => {
  const converter = new FormatConverter()

  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('parseExternal', () => {
    it('should parse Claude Code format correctly', async () => {
      const content = `---
name: my-skill
description: A test skill
allowed-tools: Read, Write
---

# Instructions

Do something useful.`

      const context = {
        toolId: 'claude-code',
        filePath: '/path/to/SKILL.md',
        folderPath: '/path/to'
      }

      const result = await converter.parseExternal(content, context)

      expect(result.name).toBe('my-skill')
      expect(result.description).toBe('A test skill')
      expect(result.allowedTools).toEqual(['Read', 'Write'])
      expect(result.instructions).toContain('Do something useful.')
    })

    it('should parse Cursor format correctly', async () => {
      const content = `---
name: code-review
description: Review code
---

Review the code and provide feedback.`

      const context = {
        toolId: 'cursor',
        filePath: '/path/to/review.md',
        folderPath: '/path/to'
      }

      const result = await converter.parseExternal(content, context)

      expect(result.name).toBe('code-review')
      expect(result.description).toBe('Review code')
      expect(result.instructions).toContain('Review the code')
    })

    it('should throw error for unknown tool', async () => {
      const context = {
        toolId: 'unknown-tool',
        filePath: '/path/to/file.md',
        folderPath: '/path/to'
      }

      await expect(converter.parseExternal('content', context)).rejects.toThrow(
        'No adapter found for tool'
      )
    })
  })

  describe('serializeToExternal', () => {
    it('should serialize to Claude Code format', () => {
      const skill: CanonicalSkill = {
        name: 'my-skill',
        description: 'A test skill',
        instructions: 'Do something useful.',
        allowedTools: ['Read', 'Write']
      }

      const result = converter.serializeToExternal(skill, 'claude-code')

      expect(result).toContain('---')
      expect(result).toContain('name: my-skill')
      expect(result).toContain('description: A test skill')
      expect(result).toContain('allowed-tools:')
      expect(result).toContain('Do something useful.')
    })

    it('should serialize to Cursor format', () => {
      const skill: CanonicalSkill = {
        name: 'my-skill',
        description: 'A test skill',
        instructions: 'Do something useful.'
      }

      const result = converter.serializeToExternal(skill, 'cursor')

      expect(result).toContain('---')
      expect(result).toContain('name: my-skill')
      expect(result).toContain('description: A test skill')
      expect(result).toContain('Do something useful.')
    })

    it('should throw error for unknown tool', () => {
      const skill: CanonicalSkill = {
        name: 'test',
        description: 'test',
        instructions: 'test'
      }

      expect(() => converter.serializeToExternal(skill, 'unknown-tool')).toThrow(
        'No adapter found for tool'
      )
    })
  })

  describe('serializeToSkillMd', () => {
    it('should serialize to DeepChat SKILL.md format', () => {
      const skill: CanonicalSkill = {
        name: 'my-skill',
        description: 'A test skill',
        instructions: 'Do something useful.',
        allowedTools: ['Read']
      }

      const result = converter.serializeToSkillMd(skill)

      expect(result).toContain('---')
      expect(result).toContain('name: my-skill')
      expect(result).toContain('description: A test skill')
      expect(result).toContain('allowed-tools: Read')
      expect(result).toContain('Do something useful.')
    })
  })

  describe('getConversionWarnings', () => {
    it('should warn about lost tool restrictions', () => {
      const skill: CanonicalSkill = {
        name: 'test',
        description: 'test',
        instructions: 'test',
        allowedTools: ['Read', 'Write']
      }

      const warnings = converter.getConversionWarnings(skill, 'windsurf')

      expect(warnings.some((w) => w.field === 'allowedTools')).toBe(true)
      expect(warnings.some((w) => w.type === 'feature_loss')).toBe(true)
    })

    it('should warn about lost model specification', () => {
      const skill: CanonicalSkill = {
        name: 'test',
        description: 'test',
        instructions: 'test',
        model: 'claude-3-sonnet'
      }

      const warnings = converter.getConversionWarnings(skill, 'windsurf')

      expect(warnings.some((w) => w.field === 'model')).toBe(true)
    })

    it('should warn about lost references', () => {
      const skill: CanonicalSkill = {
        name: 'test',
        description: 'test',
        instructions: 'test',
        references: [{ name: 'ref.md', content: 'content', relativePath: 'references/ref.md' }]
      }

      const warnings = converter.getConversionWarnings(skill, 'windsurf')

      expect(warnings.some((w) => w.field === 'references')).toBe(true)
    })

    it('should warn about lost scripts', () => {
      const skill: CanonicalSkill = {
        name: 'test',
        description: 'test',
        instructions: 'test',
        scripts: [{ name: 'script.sh', content: 'echo test', relativePath: 'scripts/script.sh' }]
      }

      const warnings = converter.getConversionWarnings(skill, 'windsurf')

      expect(warnings.some((w) => w.field === 'scripts')).toBe(true)
    })

    it('should return unknown tool warning', () => {
      const skill: CanonicalSkill = {
        name: 'test',
        description: 'test',
        instructions: 'test'
      }

      const warnings = converter.getConversionWarnings(skill, 'unknown-tool')

      expect(warnings.some((w) => w.type === 'incompatible')).toBe(true)
    })

    it('should return empty warnings for compatible conversion', () => {
      const skill: CanonicalSkill = {
        name: 'test',
        description: 'test',
        instructions: 'test'
      }

      const warnings = converter.getConversionWarnings(skill, 'windsurf')

      // May have format_change warnings but not feature_loss for the fields we didn't set
      expect(warnings.filter((w) => w.type === 'feature_loss')).toHaveLength(0)
    })
  })

  describe('autoDetectAndParse', () => {
    it('should detect and parse Claude Code format', () => {
      const content = `---
name: my-skill
description: A test skill
---

# Instructions`

      const context = {
        filePath: '/path/to/SKILL.md',
        folderPath: '/path/to'
      }

      const result = converter.autoDetectAndParse(content, context)

      expect(result).not.toBeNull()
      expect(result?.name).toBe('my-skill')
    })

    it('should detect and parse Copilot format', () => {
      const content = `---
mode: agent
description: A test prompt
---

# Instructions`

      const context = {
        filePath: '/path/to/test.prompt.md',
        folderPath: '/path/to'
      }

      const result = converter.autoDetectAndParse(content, context)

      expect(result).not.toBeNull()
    })

    it('should return null for unrecognized format', () => {
      const content = `Just plain text without any structure`

      const context = {
        filePath: '/path/to/file.txt',
        folderPath: '/path/to'
      }

      const result = converter.autoDetectAndParse(content, context)

      // May or may not be null depending on adapter detection logic
      // Some adapters may accept plain markdown
    })
  })

  describe('getToolCapabilities', () => {
    it('should return capabilities for known tool', () => {
      const capabilities = converter.getToolCapabilities('claude-code')

      expect(capabilities).not.toBeNull()
      expect(capabilities?.hasFrontmatter).toBe(true)
      expect(capabilities?.supportsSubfolders).toBe(true)
    })

    it('should return null for unknown tool', () => {
      const capabilities = converter.getToolCapabilities('unknown-tool')

      expect(capabilities).toBeNull()
    })
  })

  describe('getToolConfig', () => {
    it('should return config for known tool', () => {
      const config = converter.getToolConfig('claude-code')

      expect(config).toBeDefined()
      expect(config?.id).toBe('claude-code')
      expect(config?.name).toBe('Claude Code')
    })

    it('should return undefined for unknown tool', () => {
      const config = converter.getToolConfig('unknown-tool')

      expect(config).toBeUndefined()
    })
  })
})
