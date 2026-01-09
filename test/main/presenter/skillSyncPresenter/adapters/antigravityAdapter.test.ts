/**
 * AntigravityAdapter Unit Tests
 */
import { describe, it, expect } from 'vitest'
import { AntigravityAdapter } from '../../../../../src/main/presenter/skillSyncPresenter/adapters/antigravityAdapter'
import type { CanonicalSkill, ParseContext } from '../../../../../src/shared/types/skillSync'

describe('AntigravityAdapter', () => {
  const adapter = new AntigravityAdapter()

  describe('basic properties', () => {
    it('should have correct id', () => {
      expect(adapter.id).toBe('antigravity')
    })

    it('should have correct name', () => {
      expect(adapter.name).toBe('Antigravity')
    })
  })

  describe('getCapabilities', () => {
    it('should return correct capabilities', () => {
      const capabilities = adapter.getCapabilities()

      expect(capabilities.hasFrontmatter).toBe(true)
      expect(capabilities.supportsName).toBe(false)
      expect(capabilities.supportsDescription).toBe(true)
      expect(capabilities.supportsTools).toBe(false)
      expect(capabilities.supportsModel).toBe(false)
      expect(capabilities.supportsSubfolders).toBe(false)
      expect(capabilities.supportsReferences).toBe(false)
      expect(capabilities.supportsScripts).toBe(false)
    })
  })

  describe('detect', () => {
    it('should detect content with description-only frontmatter and steps', () => {
      const content = `---
description: A workflow for building
---

## Steps

### 1. Build

Run build command.`

      expect(adapter.detect(content)).toBe(true)
    })

    it('should detect content with numbered steps pattern', () => {
      const content = `---
description: Test workflow
---

### 1. First Step

Do first thing.

### 2. Second Step

Do second thing.`

      expect(adapter.detect(content)).toBe(true)
    })

    it('should detect content with "Step N" pattern', () => {
      const content = `---
description: Another workflow
---

### Step 1

Do something.

### Step 2

Do more.`

      expect(adapter.detect(content)).toBe(true)
    })

    it('should not detect content without frontmatter', () => {
      const content = `# Build Workflow

## Steps

### 1. Build

Run npm build.`

      expect(adapter.detect(content)).toBe(false)
    })

    it('should not detect content with name in frontmatter (Claude Code)', () => {
      const content = `---
name: my-skill
description: A skill
---

## Steps

### 1. Step`

      expect(adapter.detect(content)).toBe(false)
    })

    it('should not detect content with tools in frontmatter (Copilot)', () => {
      const content = `---
description: A prompt
tools: ['read', 'edit']
---

## Steps

### 1. Step`

      expect(adapter.detect(content)).toBe(false)
    })

    it('should not detect content with title in frontmatter (Kiro)', () => {
      const content = `---
title: My Steering
description: A steering file
---

## Steps

### 1. Step`

      expect(adapter.detect(content)).toBe(false)
    })

    it('should not detect content with inclusion in frontmatter (Kiro)', () => {
      const content = `---
description: Test
inclusion: always
---

## Steps

### 1. Step`

      expect(adapter.detect(content)).toBe(false)
    })

    it('should not detect description-only frontmatter without steps', () => {
      const content = `---
description: Just a prompt
---

# Instructions

Do something without steps.`

      expect(adapter.detect(content)).toBe(false)
    })

    it('should not detect invalid frontmatter', () => {
      const content = `---
invalid: yaml: [
---

## Steps`

      expect(adapter.detect(content)).toBe(false)
    })
  })

  describe('parse', () => {
    const baseContext: ParseContext = {
      toolId: 'antigravity',
      filePath: '/project/.idx/workflows/build-deploy.md'
    }

    it('should extract name from filename', () => {
      const content = `---
description: Build and deploy
---

## Steps

### 1. Build

Run build.`

      const result = adapter.parse(content, baseContext)

      expect(result.name).toBe('build-deploy')
    })

    it('should extract description from frontmatter', () => {
      const content = `---
description: This is the workflow description
---

## Steps

### 1. Execute

Do something.`

      const result = adapter.parse(content, baseContext)

      expect(result.description).toBe('This is the workflow description')
    })

    it('should use body as instructions', () => {
      const content = `---
description: Test
---

## Steps

### 1. First Step

First instruction.

### 2. Second Step

Second instruction.`

      const result = adapter.parse(content, baseContext)

      expect(result.instructions).toContain('## Steps')
      expect(result.instructions).toContain('### 1. First Step')
      expect(result.instructions).toContain('### 2. Second Step')
    })

    it('should include source information', () => {
      const content = `---
description: Test
---

## Steps

### 1. Step`

      const result = adapter.parse(content, baseContext)

      expect(result.source).toEqual({
        tool: 'antigravity',
        originalPath: '/project/.idx/workflows/build-deploy.md',
        originalFormat: 'antigravity-workflow'
      })
    })

    it('should handle empty description', () => {
      const content = `---
description:
---

## Steps

### 1. Step`

      const result = adapter.parse(content, baseContext)

      expect(result.description).toBe('')
    })

    it('should handle missing description field', () => {
      // Note: This won't pass detect() but parse() should still handle it
      const content = `---
other: field
---

## Steps

### 1. Step`

      const result = adapter.parse(content, baseContext)

      expect(result.description).toBe('')
    })

    it('should trim instructions', () => {
      const content = `---
description: Test
---


## Steps

### 1. Step


`

      const result = adapter.parse(content, baseContext)

      expect(result.instructions).toBe('## Steps\n\n### 1. Step')
    })
  })

  describe('serialize', () => {
    it('should include description in frontmatter', () => {
      const skill: CanonicalSkill = {
        name: 'build-workflow',
        description: 'Build the project',
        instructions: '## Steps\n\n### 1. Build\n\nRun npm build.'
      }

      const result = adapter.serialize(skill)

      expect(result).toContain('---')
      expect(result).toContain('description: Build the project')
      expect(result).toContain('---')
    })

    it('should not add frontmatter when no description', () => {
      const skill: CanonicalSkill = {
        name: 'simple',
        description: '',
        instructions: '## Steps\n\n### 1. Do it'
      }

      const result = adapter.serialize(skill)

      expect(result).not.toContain('---')
      expect(result).toContain('## Steps')
    })

    it('should preserve existing steps structure', () => {
      const skill: CanonicalSkill = {
        name: 'test',
        description: 'Test workflow',
        instructions: '## Steps\n\n### 1. First\n\nDo first.\n\n### 2. Second\n\nDo second.'
      }

      const result = adapter.serialize(skill)

      expect(result).toContain('## Steps')
      expect(result).toContain('### 1. First')
      expect(result).toContain('### 2. Second')
    })

    it('should wrap non-steps content in steps structure', () => {
      const skill: CanonicalSkill = {
        name: 'simple',
        description: 'A simple workflow',
        instructions: 'Just run this command.'
      }

      const result = adapter.serialize(skill)

      expect(result).toContain('## Steps')
      expect(result).toContain('### 1. Execute')
      expect(result).toContain('Just run this command.')
    })

    it('should detect "### Step N" format as steps structure', () => {
      const skill: CanonicalSkill = {
        name: 'test',
        description: 'Test',
        instructions: '### Step 1\n\nFirst.\n\n### Step 2\n\nSecond.'
      }

      const result = adapter.serialize(skill)

      // Should not wrap in additional steps
      expect(result).not.toMatch(/## Steps[\s\S]*### 1. Execute/)
      expect(result).toContain('### Step 1')
    })

    it('should quote description with special characters', () => {
      const skill: CanonicalSkill = {
        name: 'test',
        description: 'A workflow: with special #characters',
        instructions: '## Steps\n\n### 1. Do'
      }

      const result = adapter.serialize(skill)

      expect(result).toContain('"A workflow: with special #characters"')
    })

    it('should escape quotes in description', () => {
      const skill: CanonicalSkill = {
        name: 'test',
        description: 'A workflow with "quotes"',
        instructions: '## Steps\n\n### 1. Do'
      }

      const result = adapter.serialize(skill)

      expect(result).toContain('\\"quotes\\"')
    })

    it('should handle numbered steps pattern (### N.)', () => {
      const skill: CanonicalSkill = {
        name: 'test',
        description: 'Test',
        instructions: '### 1. Setup\n\nSetup step.\n\n### 2. Build\n\nBuild step.'
      }

      const result = adapter.serialize(skill)

      // Should not add extra steps wrapper
      expect(result).not.toMatch(/## Steps[\s\S]*### 1. Execute/)
      expect(result).toContain('### 1. Setup')
      expect(result).toContain('### 2. Build')
    })
  })

  describe('round-trip conversion', () => {
    it('should preserve data through parse and serialize cycle', () => {
      const original = `---
description: A comprehensive build workflow
---

## Steps

### 1. Install Dependencies

Run npm install to install all dependencies.

### 2. Run Linter

Run npm run lint to check code quality.

### 3. Run Tests

Run npm test to execute the test suite.

### 4. Build

Run npm run build to create production build.`

      const context: ParseContext = {
        toolId: 'antigravity',
        filePath: '/path/to/build.md'
      }

      const parsed = adapter.parse(original, context)
      const serialized = adapter.serialize(parsed)
      const reparsed = adapter.parse(serialized, context)

      expect(reparsed.name).toBe(parsed.name)
      expect(reparsed.description).toBe(parsed.description)
      expect(reparsed.instructions).toContain('## Steps')
      expect(reparsed.instructions).toContain('### 1.')
      expect(reparsed.instructions).toContain('### 2.')
      expect(reparsed.instructions).toContain('### 3.')
      expect(reparsed.instructions).toContain('### 4.')
    })
  })
})
