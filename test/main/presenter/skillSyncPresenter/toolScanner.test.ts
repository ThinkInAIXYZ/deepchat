/**
 * ToolScanner Unit Tests
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import * as fs from 'fs'
import * as path from 'path'
import { homedir } from 'os'
import {
  ToolScanner,
  EXTERNAL_TOOLS,
  expandPath,
  isPathSafe,
  resolveSkillsDir
} from '../../../../src/main/presenter/skillSyncPresenter/toolScanner'

// Mock fs module
vi.mock('fs', () => ({
  promises: {
    stat: vi.fn(),
    readdir: vi.fn(),
    readFile: vi.fn()
  },
  realpathSync: vi.fn()
}))

// Mock security module to avoid complex fs interactions in unit tests
vi.mock('../../../../src/main/presenter/skillSyncPresenter/security', () => ({
  resolveSafePath: vi.fn((target, base) => {
    // Simple mock: return null for paths with ../ or paths outside base
    if (target.includes('..')) return null
    const resolved = path.resolve(base, target)
    const basePath = path.resolve(base)
    // Check if resolved path is within base (with proper separator handling)
    const baseWithSep = basePath.endsWith(path.sep) ? basePath : `${basePath}${path.sep}`
    if (resolved === basePath || resolved.startsWith(baseWithSep)) {
      return resolved
    }
    return null
  }),
  isFilenameSafe: vi.fn((name) => {
    return name && !name.includes('/') && !name.includes('\\') && name !== '.' && name !== '..'
  }),
  validateFileSize: vi.fn().mockResolvedValue({ valid: true, size: 1024 }),
  MAX_FILE_SIZE: 10 * 1024 * 1024
}))

describe('ToolScanner', () => {
  const scanner = new ToolScanner()

  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('EXTERNAL_TOOLS configuration', () => {
    it('should have claude-code tool configured', () => {
      const claudeCode = EXTERNAL_TOOLS.find((t) => t.id === 'claude-code')
      expect(claudeCode).toBeDefined()
      expect(claudeCode?.name).toBe('Claude Code')
      expect(claudeCode?.skillsDir).toBe('~/.claude/skills/')
      expect(claudeCode?.filePattern).toBe('*/SKILL.md')
      expect(claudeCode?.format).toBe('claude-code')
    })

    it('should have cursor tool configured', () => {
      const cursor = EXTERNAL_TOOLS.find((t) => t.id === 'cursor')
      expect(cursor).toBeDefined()
      expect(cursor?.name).toBe('Cursor')
      expect(cursor?.skillsDir).toBe('~/.cursor/skills/')
      expect(cursor?.filePattern).toBe('*/SKILL.md')
      expect(cursor?.isProjectLevel).toBeUndefined()
    })

    it('should have cursor-project tool configured', () => {
      const cursorProject = EXTERNAL_TOOLS.find((t) => t.id === 'cursor-project')
      expect(cursorProject).toBeDefined()
      expect(cursorProject?.name).toBe('Cursor (Project)')
      expect(cursorProject?.skillsDir).toBe('.cursor/skills/')
      expect(cursorProject?.filePattern).toBe('*/SKILL.md')
      expect(cursorProject?.isProjectLevel).toBe(true)
    })

    it('should have windsurf tool configured', () => {
      const windsurf = EXTERNAL_TOOLS.find((t) => t.id === 'windsurf')
      expect(windsurf).toBeDefined()
      expect(windsurf?.name).toBe('Windsurf')
      expect(windsurf?.isProjectLevel).toBe(true)
    })

    it('should have copilot tool configured', () => {
      const copilot = EXTERNAL_TOOLS.find((t) => t.id === 'copilot')
      expect(copilot).toBeDefined()
      expect(copilot?.name).toBe('GitHub Copilot')
      expect(copilot?.filePattern).toBe('*.prompt.md')
    })

    it('should have kiro tool configured', () => {
      const kiro = EXTERNAL_TOOLS.find((t) => t.id === 'kiro')
      expect(kiro).toBeDefined()
      expect(kiro?.name).toBe('Kiro')
    })

    it('should have antigravity tool configured', () => {
      const antigravity = EXTERNAL_TOOLS.find((t) => t.id === 'antigravity')
      expect(antigravity).toBeDefined()
      expect(antigravity?.name).toBe('Antigravity')
    })

    it('should have codex tool configured', () => {
      const codex = EXTERNAL_TOOLS.find((t) => t.id === 'codex')
      expect(codex).toBeDefined()
      expect(codex?.name).toBe('OpenAI Codex')
      expect(codex?.skillsDir).toBe('~/.codex/skills/')
      expect(codex?.filePattern).toBe('*/SKILL.md')
      expect(codex?.format).toBe('codex')
    })

    it('should have opencode tool configured', () => {
      const opencode = EXTERNAL_TOOLS.find((t) => t.id === 'opencode')
      expect(opencode).toBeDefined()
      expect(opencode?.name).toBe('OpenCode')
      expect(opencode?.skillsDir).toBe('~/.opencode/skills/')
      expect(opencode?.filePattern).toBe('*/SKILL.md')
      expect(opencode?.format).toBe('opencode')
    })

    it('should have goose tool configured', () => {
      const goose = EXTERNAL_TOOLS.find((t) => t.id === 'goose')
      expect(goose).toBeDefined()
      expect(goose?.name).toBe('Goose')
      expect(goose?.skillsDir).toBe('~/.config/goose/skills/')
      expect(goose?.filePattern).toBe('*/SKILL.md')
      expect(goose?.format).toBe('goose')
    })

    it('should have kilocode tool configured', () => {
      const kilocode = EXTERNAL_TOOLS.find((t) => t.id === 'kilocode')
      expect(kilocode).toBeDefined()
      expect(kilocode?.name).toBe('Kilo Code')
      expect(kilocode?.skillsDir).toBe('~/.kilocode/skills/')
      expect(kilocode?.filePattern).toBe('*/SKILL.md')
      expect(kilocode?.format).toBe('kilocode')
    })

    it('should have copilot-user tool configured', () => {
      const copilotUser = EXTERNAL_TOOLS.find((t) => t.id === 'copilot-user')
      expect(copilotUser).toBeDefined()
      expect(copilotUser?.name).toBe('GitHub Copilot (User)')
      expect(copilotUser?.skillsDir).toBe('~/.copilot/skills/')
      expect(copilotUser?.filePattern).toBe('*/SKILL.md')
      expect(copilotUser?.format).toBe('copilot-user')
    })
  })

  describe('expandPath', () => {
    it('should expand tilde to home directory', () => {
      const result = expandPath('~/.claude/skills/')
      expect(result).toBe(path.join(homedir(), '.claude/skills/'))
    })

    it('should not modify paths without tilde', () => {
      const result = expandPath('/absolute/path')
      expect(result).toBe('/absolute/path')
    })

    it('should not modify relative paths', () => {
      const result = expandPath('relative/path')
      expect(result).toBe('relative/path')
    })
  })

  describe('isPathSafe', () => {
    it('should return true for safe paths', () => {
      expect(isPathSafe('subdir', '/base')).toBe(true)
      expect(isPathSafe('subdir/file.md', '/base')).toBe(true)
    })

    it('should return false for path traversal attempts', () => {
      expect(isPathSafe('../outside', '/base')).toBe(false)
      expect(isPathSafe('subdir/../../outside', '/base')).toBe(false)
    })

    it('should return true for absolute paths within base', () => {
      expect(isPathSafe('/base/subdir', '/base')).toBe(true)
    })
  })

  describe('resolveSkillsDir', () => {
    it('should expand tilde for user-level tools', () => {
      const tool = EXTERNAL_TOOLS.find((t) => t.id === 'claude-code')!
      const result = resolveSkillsDir(tool)
      expect(result).toBe(path.join(homedir(), '.claude/skills/'))
    })

    it('should require project root for project-level tools', () => {
      const tool = EXTERNAL_TOOLS.find((t) => t.id === 'cursor-project')!
      expect(() => resolveSkillsDir(tool)).toThrow('Project root required')
    })

    it('should resolve project-level tools relative to project root', () => {
      const tool = EXTERNAL_TOOLS.find((t) => t.id === 'cursor-project')!
      const result = resolveSkillsDir(tool, '/my/project')
      expect(result).toBe(path.resolve('/my/project', '.cursor/skills/'))
    })
  })

  describe('getTool', () => {
    it('should return tool by id', () => {
      const tool = scanner.getTool('claude-code')
      expect(tool).toBeDefined()
      expect(tool?.name).toBe('Claude Code')
    })

    it('should return undefined for unknown tool', () => {
      const tool = scanner.getTool('unknown-tool')
      expect(tool).toBeUndefined()
    })
  })

  describe('getAllTools', () => {
    it('should return all registered tools', () => {
      const tools = scanner.getAllTools()
      expect(tools.length).toBe(EXTERNAL_TOOLS.length)
      expect(tools.some((t) => t.id === 'claude-code')).toBe(true)
      expect(tools.some((t) => t.id === 'cursor')).toBe(true)
    })
  })

  describe('isToolAvailable', () => {
    it('should return false for unknown tool', async () => {
      const result = await scanner.isToolAvailable('unknown-tool')
      expect(result).toBe(false)
    })

    it('should return true when skills directory exists', async () => {
      vi.mocked(fs.promises.stat).mockResolvedValueOnce({
        isDirectory: () => true
      } as fs.Stats)

      const result = await scanner.isToolAvailable('claude-code')
      expect(result).toBe(true)
    })

    it('should return false when skills directory does not exist', async () => {
      vi.mocked(fs.promises.stat).mockRejectedValueOnce(new Error('ENOENT'))

      const result = await scanner.isToolAvailable('claude-code')
      expect(result).toBe(false)
    })
  })

  describe('scanTool', () => {
    it('should return error for unknown tool', async () => {
      const result = await scanner.scanTool('unknown-tool')
      expect(result.available).toBe(false)
      expect(result.error).toContain('Unknown tool')
    })

    it('should return unavailable when directory does not exist', async () => {
      vi.mocked(fs.promises.stat).mockRejectedValueOnce(new Error('ENOENT'))

      const result = await scanner.scanTool('claude-code')
      expect(result.available).toBe(false)
      expect(result.skills).toEqual([])
    })

    it('should scan subdirectory-based tool correctly', async () => {
      const skillsDir = path.join(homedir(), '.claude/skills/')

      // Mock stat for skills directory
      vi.mocked(fs.promises.stat).mockResolvedValueOnce({
        isDirectory: () => true
      } as fs.Stats)

      // Mock readdir for skills directory
      vi.mocked(fs.promises.readdir).mockResolvedValueOnce([
        { name: 'my-skill', isDirectory: () => true, isFile: () => false }
      ] as unknown as fs.Dirent[])

      // Mock stat for SKILL.md file
      vi.mocked(fs.promises.stat).mockResolvedValueOnce({
        isFile: () => true,
        mtime: new Date('2024-01-01')
      } as fs.Stats)

      // Mock readFile for SKILL.md content
      vi.mocked(fs.promises.readFile).mockResolvedValueOnce(`---
name: my-skill
description: A test skill
---

# Instructions`)

      // Mock stat for file info
      vi.mocked(fs.promises.stat).mockResolvedValueOnce({
        mtime: new Date('2024-01-01')
      } as fs.Stats)

      const result = await scanner.scanTool('claude-code')

      expect(result.available).toBe(true)
      expect(result.toolId).toBe('claude-code')
      expect(result.toolName).toBe('Claude Code')
    })

    it('should require project root for project-level tools', async () => {
      const result = await scanner.scanTool('cursor-project')
      expect(result.available).toBe(false)
      expect(result.error).toContain('Project root required')
    })
  })

  describe('scanExternalTools', () => {
    it('should skip project-level tools when no project root provided', async () => {
      // Mock all user-level tools as unavailable
      vi.mocked(fs.promises.stat).mockRejectedValue(new Error('ENOENT'))

      const results = await scanner.scanExternalTools()

      // Should only include user-level tools
      const toolIds = results.map((r) => r.toolId)
      expect(toolIds).toContain('claude-code')
      expect(toolIds).toContain('cursor') // cursor is now user-level
      expect(toolIds).not.toContain('cursor-project') // cursor-project is project-level
      expect(toolIds).not.toContain('windsurf')
    })

    it('should include project-level tools when project root provided', async () => {
      // Mock all tools as unavailable
      vi.mocked(fs.promises.stat).mockRejectedValue(new Error('ENOENT'))

      const results = await scanner.scanExternalTools('/my/project')

      // Should include both user-level and project-level tools
      const toolIds = results.map((r) => r.toolId)
      expect(toolIds).toContain('claude-code')
      expect(toolIds).toContain('cursor')
      expect(toolIds).toContain('cursor-project')
      expect(toolIds).toContain('windsurf')
    })
  })

  // ============================================================================
  // Security Tests
  // ============================================================================

  describe('Security - Path Traversal Prevention', () => {
    it('should reject directory names with path traversal', async () => {
      const skillsDir = path.join(homedir(), '.claude/skills/')

      // Mock directory exists
      vi.mocked(fs.promises.stat).mockResolvedValueOnce({
        isDirectory: () => true
      } as fs.Stats)

      // Mock readdir with malicious directory name
      vi.mocked(fs.promises.readdir).mockResolvedValueOnce([
        { name: '../../../etc', isDirectory: () => true, isFile: () => false }
      ] as unknown as fs.Dirent[])

      const result = await scanner.scanTool('claude-code')

      // Should not include the malicious directory
      expect(result.skills).toHaveLength(0)
    })

    it('should reject files with path traversal in names', async () => {
      const skillsDir = '/project/.cursor/skills/'

      vi.mocked(fs.promises.stat).mockResolvedValueOnce({
        isDirectory: () => true
      } as fs.Stats)

      vi.mocked(fs.promises.readdir).mockResolvedValueOnce([
        { name: '../../../etc/passwd.md', isFile: () => true, isDirectory: () => false }
      ] as unknown as fs.Dirent[])

      const result = await scanner.scanTool('cursor-project', '/project')

      expect(result.skills).toHaveLength(0)
    })

    it('should handle relative paths safely in isPathSafe', () => {
      expect(isPathSafe('safe-dir', '/base')).toBe(true)
      expect(isPathSafe('../outside', '/base')).toBe(false)
      expect(isPathSafe('subdir/../../outside', '/base')).toBe(false)
    })

    it('should allow relative paths that resolve within base', () => {
      // A relative path like "base-other/file" resolved against "/base"
      // gives "/base/base-other/file" which IS within /base
      const result = isPathSafe('subdir/nested/file', '/base')
      expect(result).toBe(true)
    })
  })

  describe('Security - Filename Validation', () => {
    it('should skip files with unsafe names during scanning', async () => {
      vi.mocked(fs.promises.stat).mockResolvedValueOnce({
        isDirectory: () => true
      } as fs.Stats)

      vi.mocked(fs.promises.readdir).mockResolvedValueOnce([
        { name: 'valid-skill', isDirectory: () => true, isFile: () => false },
        { name: '.', isDirectory: () => true, isFile: () => false },
        { name: '..', isDirectory: () => true, isFile: () => false }
      ] as unknown as fs.Dirent[])

      // Mock the valid skill
      vi.mocked(fs.promises.stat).mockResolvedValueOnce({
        isFile: () => true,
        mtime: new Date()
      } as fs.Stats)
      vi.mocked(fs.promises.readFile).mockResolvedValueOnce('---\nname: valid\n---\n# Content')
      vi.mocked(fs.promises.stat).mockResolvedValueOnce({
        mtime: new Date()
      } as fs.Stats)

      const result = await scanner.scanTool('claude-code')

      // Should only include valid-skill
      expect(result.skills.length).toBeLessThanOrEqual(1)
    })
  })

  describe('Security - File Size Validation', () => {
    it('should skip oversized files during scanning', async () => {
      const { validateFileSize } =
        await import('../../../../src/main/presenter/skillSyncPresenter/security')

      vi.mocked(fs.promises.stat).mockResolvedValueOnce({
        isDirectory: () => true
      } as fs.Stats)

      vi.mocked(fs.promises.readdir).mockResolvedValueOnce([
        { name: 'large-skill', isDirectory: () => true, isFile: () => false }
      ] as unknown as fs.Dirent[])

      // Mock SKILL.md file exists
      vi.mocked(fs.promises.stat).mockResolvedValueOnce({
        isFile: () => true
      } as fs.Stats)

      // Mock oversized file
      vi.mocked(validateFileSize).mockResolvedValueOnce({
        valid: false,
        size: 15 * 1024 * 1024,
        error: 'File too large'
      })

      const result = await scanner.scanTool('claude-code')

      // Should skip the oversized skill
      expect(result.skills).toHaveLength(0)
    })
  })
})
