/**
 * Security Module Unit Tests
 *
 * Tests for path safety, file size limits, permissions, and input validation
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import * as fs from 'fs'
import * as path from 'path'
import { ConflictStrategy } from '../../../../src/shared/types/skillSync'
import {
  resolveSafePath,
  isFilenameSafe,
  isPathWithinBase,
  validateFileSize,
  validateFolderSize,
  checkReadPermission,
  checkWritePermission,
  isDirectoryAccessible,
  isValidToolId,
  getValidatedTool,
  isValidConflictStrategy,
  sanitizeSkillName,
  isValidSkillName,
  isValidUtf8,
  hasBOM,
  stripBOM,
  validateImportOperation,
  validateExportOperation,
  MAX_FILE_SIZE,
  MAX_SKILL_FOLDER_SIZE,
  MAX_SUBFOLDER_FILE_SIZE
} from '../../../../src/main/presenter/skillSyncPresenter/security'

// Mock fs module
vi.mock('fs', () => ({
  promises: {
    stat: vi.fn(),
    access: vi.fn(),
    readdir: vi.fn()
  },
  constants: {
    R_OK: 4,
    W_OK: 2
  },
  realpathSync: vi.fn()
}))

describe('Security Module', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  // ============================================================================
  // Path Security Tests
  // ============================================================================

  describe('resolveSafePath', () => {
    it('should return null for path traversal attempts', () => {
      // Mock realpathSync to throw (path doesn't exist)
      vi.mocked(fs.realpathSync).mockImplementation(() => {
        throw new Error('ENOENT')
      })

      expect(resolveSafePath('../outside', '/base')).toBeNull()
      expect(resolveSafePath('subdir/../../outside', '/base')).toBeNull()
    })

    it('should return resolved path for safe paths when path exists', () => {
      const basePath = '/base'
      const targetPath = '/base/subdir/file.md'

      vi.mocked(fs.realpathSync).mockImplementation((p) => {
        if (p === targetPath || p === path.normalize(targetPath)) return targetPath
        if (p === basePath) return basePath
        throw new Error('ENOENT')
      })

      expect(resolveSafePath('subdir/file.md', basePath)).toBe(targetPath)
    })

    it('should handle symlinks by resolving to real path', () => {
      const basePath = '/base'
      const symlinkPath = '/base/symlink'
      const realTarget = '/other/directory' // Outside base

      vi.mocked(fs.realpathSync).mockImplementation((p) => {
        if (p === basePath) return basePath
        if (String(p).includes('symlink')) return realTarget
        throw new Error('ENOENT')
      })

      // Should return null because symlink resolves outside base
      expect(resolveSafePath('symlink', basePath)).toBeNull()
    })

    it('should return path for non-existent file if parent is safe', () => {
      const basePath = '/base'
      const parentPath = '/base/subdir'

      vi.mocked(fs.realpathSync).mockImplementation((p) => {
        if (p === basePath) return basePath
        if (p === parentPath) return parentPath
        throw new Error('ENOENT')
      })

      const result = resolveSafePath('subdir/newfile.md', basePath)
      expect(result).not.toBeNull()
    })
  })

  describe('isFilenameSafe', () => {
    it('should return true for valid filenames', () => {
      expect(isFilenameSafe('my-skill.md')).toBe(true)
      expect(isFilenameSafe('SKILL.md')).toBe(true)
      expect(isFilenameSafe('test_file.txt')).toBe(true)
      expect(isFilenameSafe('123.json')).toBe(true)
    })

    it('should return false for empty names', () => {
      expect(isFilenameSafe('')).toBe(false)
      expect(isFilenameSafe('   ')).toBe(false)
    })

    it('should return false for names with path separators', () => {
      expect(isFilenameSafe('path/to/file.md')).toBe(false)
      expect(isFilenameSafe('path\\to\\file.md')).toBe(false)
    })

    it('should return false for dot traversal', () => {
      expect(isFilenameSafe('.')).toBe(false)
      expect(isFilenameSafe('..')).toBe(false)
    })

    it('should return false for names with control characters', () => {
      expect(isFilenameSafe('file\x00name')).toBe(false)
      expect(isFilenameSafe('file\nname')).toBe(false)
      expect(isFilenameSafe('file\rname')).toBe(false)
    })
  })

  describe('isPathWithinBase', () => {
    it('should return true for paths within base', () => {
      vi.mocked(fs.realpathSync).mockImplementation((p) => String(p))

      expect(isPathWithinBase('/base/subdir', '/base')).toBe(true)
    })

    it('should return false for paths outside base', () => {
      vi.mocked(fs.realpathSync).mockImplementation(() => {
        throw new Error('ENOENT')
      })

      expect(isPathWithinBase('/other/path', '/base')).toBe(false)
    })
  })

  // ============================================================================
  // File Size Validation Tests
  // ============================================================================

  describe('validateFileSize', () => {
    it('should return valid for files under limit', async () => {
      vi.mocked(fs.promises.stat).mockResolvedValue({
        isFile: () => true,
        size: 1024
      } as fs.Stats)

      const result = await validateFileSize('/path/to/file.md')
      expect(result.valid).toBe(true)
      expect(result.size).toBe(1024)
    })

    it('should return invalid for files over limit', async () => {
      vi.mocked(fs.promises.stat).mockResolvedValue({
        isFile: () => true,
        size: MAX_FILE_SIZE + 1
      } as fs.Stats)

      const result = await validateFileSize('/path/to/file.md')
      expect(result.valid).toBe(false)
      expect(result.error).toContain('too large')
    })

    it('should return invalid for non-files', async () => {
      vi.mocked(fs.promises.stat).mockResolvedValue({
        isFile: () => false,
        size: 0
      } as fs.Stats)

      const result = await validateFileSize('/path/to/dir')
      expect(result.valid).toBe(false)
      expect(result.error).toBe('Not a file')
    })

    it('should handle stat errors', async () => {
      vi.mocked(fs.promises.stat).mockRejectedValue(new Error('ENOENT'))

      const result = await validateFileSize('/nonexistent')
      expect(result.valid).toBe(false)
      expect(result.error).toContain('ENOENT')
    })

    it('should use custom size limit', async () => {
      vi.mocked(fs.promises.stat).mockResolvedValue({
        isFile: () => true,
        size: 100
      } as fs.Stats)

      const result = await validateFileSize('/path/to/file.md', 50)
      expect(result.valid).toBe(false)
    })
  })

  describe('validateFolderSize', () => {
    it('should return valid for folders under limit', async () => {
      vi.mocked(fs.promises.readdir).mockResolvedValue([
        { name: 'file1.md', isFile: () => true, isDirectory: () => false },
        { name: 'file2.md', isFile: () => true, isDirectory: () => false }
      ] as unknown as fs.Dirent[])

      vi.mocked(fs.promises.stat).mockResolvedValue({
        size: 1024
      } as fs.Stats)

      const result = await validateFolderSize('/path/to/folder')
      expect(result.valid).toBe(true)
      expect(result.totalSize).toBe(2048)
    })

    it('should return invalid for folders over limit', async () => {
      vi.mocked(fs.promises.readdir).mockResolvedValue([
        { name: 'large.bin', isFile: () => true, isDirectory: () => false }
      ] as unknown as fs.Dirent[])

      vi.mocked(fs.promises.stat).mockResolvedValue({
        size: MAX_SKILL_FOLDER_SIZE + 1
      } as fs.Stats)

      const result = await validateFolderSize('/path/to/folder')
      expect(result.valid).toBe(false)
      expect(result.error).toContain('too large')
    })
  })

  // ============================================================================
  // Permission Tests
  // ============================================================================

  describe('checkReadPermission', () => {
    it('should return true when readable', async () => {
      vi.mocked(fs.promises.access).mockResolvedValue(undefined)

      const result = await checkReadPermission('/readable/file')
      expect(result).toBe(true)
    })

    it('should return false when not readable', async () => {
      vi.mocked(fs.promises.access).mockRejectedValue(new Error('EACCES'))

      const result = await checkReadPermission('/unreadable/file')
      expect(result).toBe(false)
    })
  })

  describe('checkWritePermission', () => {
    it('should return true when writable', async () => {
      vi.mocked(fs.promises.access).mockResolvedValue(undefined)

      const result = await checkWritePermission('/writable/file')
      expect(result).toBe(true)
    })

    it('should check parent directory if file does not exist', async () => {
      vi.mocked(fs.promises.access)
        .mockRejectedValueOnce(new Error('ENOENT')) // file doesn't exist
        .mockResolvedValue(undefined) // parent is writable

      const result = await checkWritePermission('/parent/newfile')
      expect(result).toBe(true)
    })

    it('should return false when neither file nor parent is writable', async () => {
      vi.mocked(fs.promises.access).mockRejectedValue(new Error('EACCES'))

      const result = await checkWritePermission('/unwritable/file')
      expect(result).toBe(false)
    })
  })

  describe('isDirectoryAccessible', () => {
    it('should return true for accessible directories', async () => {
      vi.mocked(fs.promises.stat).mockResolvedValue({
        isDirectory: () => true
      } as fs.Stats)
      vi.mocked(fs.promises.access).mockResolvedValue(undefined)

      const result = await isDirectoryAccessible('/accessible/dir')
      expect(result).toBe(true)
    })

    it('should return false for files', async () => {
      vi.mocked(fs.promises.stat).mockResolvedValue({
        isDirectory: () => false
      } as fs.Stats)

      const result = await isDirectoryAccessible('/path/to/file')
      expect(result).toBe(false)
    })

    it('should return false for inaccessible directories', async () => {
      vi.mocked(fs.promises.stat).mockResolvedValue({
        isDirectory: () => true
      } as fs.Stats)
      vi.mocked(fs.promises.access).mockRejectedValue(new Error('EACCES'))

      const result = await isDirectoryAccessible('/inaccessible/dir')
      expect(result).toBe(false)
    })
  })

  // ============================================================================
  // Input Validation Tests
  // ============================================================================

  describe('isValidToolId', () => {
    it('should return true for known tool IDs', () => {
      expect(isValidToolId('claude-code')).toBe(true)
      expect(isValidToolId('cursor')).toBe(true)
      expect(isValidToolId('windsurf')).toBe(true)
      expect(isValidToolId('copilot')).toBe(true)
      expect(isValidToolId('kiro')).toBe(true)
      expect(isValidToolId('antigravity')).toBe(true)
    })

    it('should return false for unknown tool IDs', () => {
      expect(isValidToolId('unknown-tool')).toBe(false)
      expect(isValidToolId('')).toBe(false)
      expect(isValidToolId('CLAUDE-CODE')).toBe(false) // case sensitive
    })
  })

  describe('getValidatedTool', () => {
    it('should return tool config for valid IDs', () => {
      const tool = getValidatedTool('claude-code')
      expect(tool).not.toBeNull()
      expect(tool?.id).toBe('claude-code')
      expect(tool?.name).toBe('Claude Code')
    })

    it('should return null for invalid IDs', () => {
      expect(getValidatedTool('unknown')).toBeNull()
      expect(getValidatedTool('')).toBeNull()
    })

    it('should return null for non-string inputs', () => {
      expect(getValidatedTool(null as unknown as string)).toBeNull()
      expect(getValidatedTool(undefined as unknown as string)).toBeNull()
    })
  })

  describe('isValidConflictStrategy', () => {
    it('should return true for valid strategies', () => {
      expect(isValidConflictStrategy(ConflictStrategy.SKIP)).toBe(true)
      expect(isValidConflictStrategy(ConflictStrategy.OVERWRITE)).toBe(true)
      expect(isValidConflictStrategy(ConflictStrategy.RENAME)).toBe(true)
    })

    it('should return false for invalid strategies', () => {
      expect(isValidConflictStrategy('invalid')).toBe(false)
      expect(isValidConflictStrategy(null)).toBe(false)
      expect(isValidConflictStrategy(undefined)).toBe(false)
      expect(isValidConflictStrategy(123)).toBe(false)
    })
  })

  describe('sanitizeSkillName', () => {
    it('should return clean name for valid input', () => {
      expect(sanitizeSkillName('my-skill')).toBe('my-skill')
      expect(sanitizeSkillName('my_skill')).toBe('my_skill')
      expect(sanitizeSkillName('mySkill123')).toBe('mySkill123')
    })

    it('should remove unsafe characters', () => {
      expect(sanitizeSkillName('my<skill>')).toBe('my-skill')
      expect(sanitizeSkillName('my:skill')).toBe('my-skill')
      expect(sanitizeSkillName('path/to/skill')).toBe('path-to-skill')
    })

    it('should handle multiple hyphens', () => {
      expect(sanitizeSkillName('my---skill')).toBe('my-skill')
    })

    it('should trim leading/trailing hyphens', () => {
      expect(sanitizeSkillName('-my-skill-')).toBe('my-skill')
    })

    it('should return null for invalid input', () => {
      expect(sanitizeSkillName('')).toBeNull()
      expect(sanitizeSkillName('   ')).toBeNull()
      expect(sanitizeSkillName('..')).toBeNull()
    })

    it('should truncate long names', () => {
      const longName = 'a'.repeat(150)
      const result = sanitizeSkillName(longName)
      expect(result?.length).toBe(100)
    })
  })

  describe('isValidSkillName', () => {
    it('should return true for valid names', () => {
      expect(isValidSkillName('my-skill')).toBe(true)
      expect(isValidSkillName('my_skill')).toBe(true)
      expect(isValidSkillName('MySkill123')).toBe(true)
    })

    it('should return false for empty names', () => {
      expect(isValidSkillName('')).toBe(false)
      expect(isValidSkillName('   ')).toBe(false)
    })

    it('should return false for names with path components', () => {
      expect(isValidSkillName('path/to/skill')).toBe(false)
      expect(isValidSkillName('path\\to\\skill')).toBe(false)
    })

    it('should return false for reserved names', () => {
      expect(isValidSkillName('.')).toBe(false)
      expect(isValidSkillName('..')).toBe(false)
    })

    it('should return false for names with control characters', () => {
      expect(isValidSkillName('skill\x00name')).toBe(false)
    })

    it('should return false for very long names', () => {
      expect(isValidSkillName('a'.repeat(101))).toBe(false)
    })
  })

  // ============================================================================
  // Content Validation Tests
  // ============================================================================

  describe('isValidUtf8', () => {
    it('should return true for valid UTF-8', () => {
      expect(isValidUtf8('Hello World')).toBe(true)
      expect(isValidUtf8('你好世界')).toBe(true)
      expect(isValidUtf8('🎉')).toBe(true)
    })

    it('should return false for content with replacement characters', () => {
      expect(isValidUtf8('Hello \uFFFD World')).toBe(false)
    })
  })

  describe('hasBOM', () => {
    it('should detect BOM', () => {
      expect(hasBOM('\uFEFFHello')).toBe(true)
    })

    it('should return false when no BOM', () => {
      expect(hasBOM('Hello')).toBe(false)
    })
  })

  describe('stripBOM', () => {
    it('should remove BOM', () => {
      expect(stripBOM('\uFEFFHello')).toBe('Hello')
    })

    it('should not modify content without BOM', () => {
      expect(stripBOM('Hello')).toBe('Hello')
    })
  })

  // ============================================================================
  // Comprehensive Validation Tests
  // ============================================================================

  describe('validateImportOperation', () => {
    it('should return valid for correct parameters', async () => {
      vi.mocked(fs.realpathSync).mockImplementation((p) => String(p))
      vi.mocked(fs.promises.access).mockResolvedValue(undefined)
      vi.mocked(fs.promises.stat).mockResolvedValue({
        isFile: () => true,
        size: 1024
      } as fs.Stats)

      const result = await validateImportOperation(
        '/base/skill.md',
        'claude-code',
        'my-skill',
        '/base'
      )

      expect(result.valid).toBe(true)
      expect(result.errors).toHaveLength(0)
    })

    it('should return invalid for unknown tool ID', async () => {
      const result = await validateImportOperation(
        '/base/skill.md',
        'unknown-tool',
        'my-skill',
        '/base'
      )

      expect(result.valid).toBe(false)
      expect(result.errors.some((e) => e.includes('Invalid tool ID'))).toBe(true)
    })

    it('should return invalid for bad skill name', async () => {
      const result = await validateImportOperation(
        '/base/skill.md',
        'claude-code',
        '../bad-name',
        '/base'
      )

      expect(result.valid).toBe(false)
      expect(result.errors.some((e) => e.includes('Invalid skill name'))).toBe(true)
    })
  })

  describe('validateExportOperation', () => {
    it('should return valid for correct parameters', async () => {
      vi.mocked(fs.realpathSync).mockImplementation((p) => String(p))
      vi.mocked(fs.promises.access).mockResolvedValue(undefined)

      const result = await validateExportOperation(
        '/base/output/skill.md',
        'cursor',
        'my-skill',
        '/base'
      )

      expect(result.valid).toBe(true)
      expect(result.errors).toHaveLength(0)
    })

    it('should return invalid for path outside base', async () => {
      vi.mocked(fs.realpathSync).mockImplementation(() => {
        throw new Error('ENOENT')
      })

      const result = await validateExportOperation(
        '/other/path/skill.md',
        'cursor',
        'my-skill',
        '/base'
      )

      expect(result.valid).toBe(false)
      expect(result.errors.some((e) => e.includes('escapes allowed directory'))).toBe(true)
    })

    it('should return invalid when no write permission', async () => {
      vi.mocked(fs.realpathSync).mockImplementation((p) => String(p))
      vi.mocked(fs.promises.access).mockRejectedValue(new Error('EACCES'))

      const result = await validateExportOperation(
        '/base/output/skill.md',
        'cursor',
        'my-skill',
        '/base'
      )

      expect(result.valid).toBe(false)
      expect(result.errors.some((e) => e.includes('No write permission'))).toBe(true)
    })
  })

  // ============================================================================
  // Constants Tests
  // ============================================================================

  describe('Constants', () => {
    it('should have appropriate size limits', () => {
      expect(MAX_FILE_SIZE).toBe(10 * 1024 * 1024) // 10 MB
      expect(MAX_SKILL_FOLDER_SIZE).toBe(50 * 1024 * 1024) // 50 MB
      expect(MAX_SUBFOLDER_FILE_SIZE).toBe(5 * 1024 * 1024) // 5 MB
    })
  })
})
