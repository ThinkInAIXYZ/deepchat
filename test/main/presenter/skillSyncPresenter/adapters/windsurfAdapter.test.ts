/**
 * WindsurfAdapter Unit Tests
 */
import { describe, it, expect } from 'vitest'
import { WindsurfAdapter } from '../../../../../src/main/presenter/skillSyncPresenter/adapters/windsurfAdapter'
import type { CanonicalSkill, ParseContext } from '../../../../../src/shared/types/skillSync'

describe('WindsurfAdapter', () => {
  const adapter = new WindsurfAdapter()

  describe('basic properties', () => {
    it('should have correct id', () => {
      expect(adapter.id).toBe('windsurf')
    })

    it('should have correct name', () => {
      expect(adapter.name).toBe('Windsurf')
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
    it('should detect workflow with ## Steps section', () => {
      const content = `# Code Review Workflow

Review code quality.

## Steps

### 1. Analyze Code

Look for issues.

### 2. Report Findings

Document problems.`

      expect(adapter.detect(content)).toBe(true)
    })

    it('should detect workflow with numbered steps only', () => {
      const content = `# Build Workflow

Build the project.

### 1. Install Dependencies

Run npm install.

### 2. Run Build

Run npm run build.`

      expect(adapter.detect(content)).toBe(true)
    })

    it('should not detect content with frontmatter', () => {
      const content = `---
name: workflow
---

# My Workflow

## Steps

### 1. Step One`

      expect(adapter.detect(content)).toBe(false)
    })

    it('should not detect plain markdown without steps', () => {
      const content = `# My Command

This is just a command without steps.

## Guidelines

Some guidelines.`

      expect(adapter.detect(content)).toBe(false)
    })

    it('should detect content with "### 1." format without ## Steps header', () => {
      const content = `# Test Workflow

Description.

### 1. Prepare

Do prep.

### 2. Execute

Run it.`

      expect(adapter.detect(content)).toBe(true)
    })
  })

  describe('parse', () => {
    const baseContext: ParseContext = {
      toolId: 'windsurf',
      filePath: '/project/.windsurf/workflows/code-review.md'
    }

    it('should extract name from title and remove Workflow suffix', () => {
      const content = `# Code Review Workflow

Review code.

## Steps

### 1. Review

Look at code.`

      const result = adapter.parse(content, baseContext)

      expect(result.name).toBe('code-review')
    })

    it('should extract name without Workflow suffix when not present', () => {
      const content = `# Simple Task

Do task.

## Steps

### 1. Execute

Run.`

      const result = adapter.parse(content, baseContext)

      expect(result.name).toBe('simple-task')
    })

    it('should extract description from text before ## Steps', () => {
      const content = `# Test Workflow

This is the workflow description.

## Steps

### 1. First

Do first.`

      const result = adapter.parse(content, baseContext)

      expect(result.description).toBe('This is the workflow description.')
    })

    it('should extract steps section as instructions', () => {
      const content = `# My Workflow

Description.

## Steps

### 1. First Step

Do first thing.

### 2. Second Step

Do second thing.`

      const result = adapter.parse(content, baseContext)

      expect(result.instructions).toContain('## Steps')
      expect(result.instructions).toContain('### 1. First Step')
      expect(result.instructions).toContain('### 2. Second Step')
    })

    it('should use full content as instructions if no ## Steps', () => {
      const content = `# Quick Workflow

Just do it.

### 1. Only Step

Execute.`

      const result = adapter.parse(content, baseContext)

      expect(result.instructions).toBe(content.trim())
    })

    it('should include source information', () => {
      const content = `# Test

Desc.

## Steps

### 1. Step`

      const result = adapter.parse(content, baseContext)

      expect(result.source).toEqual({
        tool: 'windsurf',
        originalPath: '/project/.windsurf/workflows/code-review.md',
        originalFormat: 'steps-markdown'
      })
    })

    it('should use filename as fallback name', () => {
      const content = `No title here.

## Steps

### 1. Step`

      const context: ParseContext = {
        toolId: 'windsurf',
        filePath: '/path/fallback-workflow.md'
      }

      const result = adapter.parse(content, context)

      expect(result.name).toBe('fallback-workflow')
    })

    it('should handle empty description', () => {
      const content = `# Workflow

## Steps

### 1. Do it`

      const result = adapter.parse(content, baseContext)

      expect(result.description).toBe('')
    })
  })

  describe('serialize', () => {
    it('should add Workflow suffix to title', () => {
      const skill: CanonicalSkill = {
        name: 'code-review',
        description: 'Review code quality',
        instructions: '## Steps\n\n### 1. Review\n\nCheck code.'
      }

      const result = adapter.serialize(skill)

      expect(result).toContain('# Code Review Workflow')
    })

    it('should include description', () => {
      const skill: CanonicalSkill = {
        name: 'test',
        description: 'A test workflow description',
        instructions: '## Steps\n\n### 1. Step'
      }

      const result = adapter.serialize(skill)

      expect(result).toContain('A test workflow description')
    })

    it('should preserve existing steps structure', () => {
      const skill: CanonicalSkill = {
        name: 'build',
        description: 'Build project',
        instructions:
          '## Steps\n\n### 1. Install\n\nRun npm install.\n\n### 2. Build\n\nRun npm build.'
      }

      const result = adapter.serialize(skill)

      expect(result).toContain('## Steps')
      expect(result).toContain('### 1. Install')
      expect(result).toContain('### 2. Build')
    })

    it('should wrap non-steps content in steps structure', () => {
      const skill: CanonicalSkill = {
        name: 'simple',
        description: 'Simple workflow',
        instructions: 'Just do this thing.'
      }

      const result = adapter.serialize(skill)

      expect(result).toContain('## Steps')
      expect(result).toContain('### 1. Execute')
      expect(result).toContain('Just do this thing.')
    })

    it('should detect "### Step N" format as steps structure', () => {
      const skill: CanonicalSkill = {
        name: 'test',
        description: 'Test',
        instructions: '### Step 1\n\nDo something.\n\n### Step 2\n\nDo more.'
      }

      const result = adapter.serialize(skill)

      // Should not wrap in additional steps
      expect(result).toContain('### Step 1')
      expect(result).not.toMatch(/## Steps[\s\S]*### 1. Execute/)
    })

    it('should convert kebab-case name to title case', () => {
      const skill: CanonicalSkill = {
        name: 'multi-word-workflow-name',
        description: 'Test',
        instructions: '## Steps\n\n### 1. Step'
      }

      const result = adapter.serialize(skill)

      expect(result).toContain('# Multi Word Workflow Name Workflow')
    })
  })

  describe('round-trip conversion', () => {
    it('should preserve data through parse and serialize cycle', () => {
      const original = `# Build And Test Workflow

This workflow builds and tests the project.

## Steps

### 1. Install Dependencies

Run npm install.

### 2. Run Build

Run npm run build.

### 3. Run Tests

Run npm test.`

      const context: ParseContext = {
        toolId: 'windsurf',
        filePath: '/path/to/workflow.md'
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
    })
  })
})
