/**
 * SkillSyncPresenter Unit Tests
 *
 * Tests for the main presenter including:
 * - Import operations with security validations
 * - Export operations with security validations
 * - Conflict handling
 * - Tool scanning integration
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import * as fs from 'fs'
import * as path from 'path'
import { SkillSyncPresenter } from '../../../../src/main/presenter/skillSyncPresenter'
import { ConflictStrategy } from '../../../../src/shared/types/skillSync'
import type { ISkillPresenter } from '../../../../src/shared/presenter'
import type { ImportPreview, ExportPreview } from '../../../../src/shared/types/skillSync'

// Mock electron app
vi.mock('electron', () => ({
  app: {
    getPath: vi.fn().mockReturnValue('/tmp')
  }
}))

// Mock fs module
vi.mock('fs', () => ({
  promises: {
    stat: vi.fn(),
    readdir: vi.fn(),
    readFile: vi.fn(),
    writeFile: vi.fn(),
    mkdir: vi.fn(),
    rm: vi.fn(),
    access: vi.fn()
  },
  constants: {
    R_OK: 4,
    W_OK: 2
  },
  realpathSync: vi.fn((p) => String(p))
}))

// Mock eventbus
vi.mock('@/eventbus', () => ({
  eventBus: {
    sendToRenderer: vi.fn()
  },
  SendTarget: {
    ALL_WINDOWS: 'all'
  }
}))

// Mock events
vi.mock('@/events', () => ({
  SKILL_SYNC_EVENTS: {
    SCAN_STARTED: 'scan-started',
    SCAN_COMPLETED: 'scan-completed',
    IMPORT_STARTED: 'import-started',
    IMPORT_PROGRESS: 'import-progress',
    IMPORT_COMPLETED: 'import-completed',
    EXPORT_STARTED: 'export-started',
    EXPORT_PROGRESS: 'export-progress',
    EXPORT_COMPLETED: 'export-completed'
  }
}))

// Mock security module
vi.mock('../../../../src/main/presenter/skillSyncPresenter/security', () => ({
  isValidToolId: vi.fn((id) =>
    ['claude-code', 'cursor', 'windsurf', 'copilot', 'kiro', 'antigravity'].includes(id)
  ),
  isValidConflictStrategy: vi.fn((s) =>
    [ConflictStrategy.SKIP, ConflictStrategy.OVERWRITE, ConflictStrategy.RENAME].includes(s)
  ),
  isValidSkillName: vi.fn((name) => name && !name.includes('/') && name !== '..' && name !== '.'),
  sanitizeSkillName: vi.fn((name) => name?.replace(/[<>:"/\\|?*]/g, '-')),
  checkReadPermission: vi.fn().mockResolvedValue(true),
  checkWritePermission: vi.fn().mockResolvedValue(true),
  isPathWithinBase: vi.fn().mockReturnValue(true),
  validateFolderSize: vi.fn().mockResolvedValue({ valid: true, totalSize: 1024 })
}))

// Mock toolScanner
vi.mock('../../../../src/main/presenter/skillSyncPresenter/toolScanner', () => ({
  toolScanner: {
    scanExternalTools: vi.fn(),
    scanTool: vi.fn(),
    getTool: vi.fn(),
    getAllTools: vi.fn(),
    isToolAvailable: vi.fn()
  },
  resolveSkillsDir: vi.fn((tool, projectRoot) => {
    if (tool.isProjectLevel && !projectRoot) {
      throw new Error('Project root required')
    }
    return tool.isProjectLevel
      ? path.join(projectRoot, tool.skillsDir)
      : `/home/user/${tool.skillsDir}`
  })
}))

// Mock formatConverter
vi.mock('../../../../src/main/presenter/skillSyncPresenter/formatConverter', () => ({
  formatConverter: {
    parseExternal: vi.fn(),
    serializeToExternal: vi.fn(),
    serializeToSkillMd: vi.fn(),
    getConversionWarnings: vi.fn()
  }
}))

describe('SkillSyncPresenter', () => {
  let presenter: SkillSyncPresenter
  let mockSkillPresenter: ISkillPresenter

  beforeEach(() => {
    vi.clearAllMocks()

    // Create mock skill presenter
    mockSkillPresenter = {
      getMetadataList: vi.fn().mockResolvedValue([]),
      installFromFolder: vi.fn().mockResolvedValue({ success: true }),
      loadSkillContent: vi.fn().mockResolvedValue({ content: '# Skill Content' })
    } as unknown as ISkillPresenter

    presenter = new SkillSyncPresenter(mockSkillPresenter)
  })

  // ============================================================================
  // Scanning Tests
  // ============================================================================

  describe('scanExternalTools', () => {
    it('should scan all external tools', async () => {
      const { toolScanner } =
        await import('../../../../src/main/presenter/skillSyncPresenter/toolScanner')
      vi.mocked(toolScanner.scanExternalTools).mockResolvedValue([
        {
          toolId: 'claude-code',
          toolName: 'Claude Code',
          available: true,
          skillsDir: '/home/user/.claude/skills/',
          skills: [
            {
              name: 'skill1',
              path: '/path/to/skill1',
              format: 'claude-code',
              lastModified: new Date()
            }
          ]
        }
      ])

      const results = await presenter.scanExternalTools()

      expect(results).toHaveLength(1)
      expect(results[0].toolId).toBe('claude-code')
      expect(toolScanner.scanExternalTools).toHaveBeenCalled()
    })
  })

  describe('scanTool', () => {
    it('should scan a specific tool', async () => {
      const { toolScanner } =
        await import('../../../../src/main/presenter/skillSyncPresenter/toolScanner')
      vi.mocked(toolScanner.scanTool).mockResolvedValue({
        toolId: 'cursor',
        toolName: 'Cursor',
        available: true,
        skillsDir: '/project/.cursor/skills/',
        skills: []
      })

      presenter.setProjectRoot('/project')
      const result = await presenter.scanTool('cursor')

      expect(result.toolId).toBe('cursor')
      expect(toolScanner.scanTool).toHaveBeenCalledWith('cursor', '/project')
    })
  })

  // ============================================================================
  // Import Tests
  // ============================================================================

  describe('previewImport', () => {
    it('should return empty for invalid tool ID', async () => {
      const { isValidToolId } =
        await import('../../../../src/main/presenter/skillSyncPresenter/security')
      vi.mocked(isValidToolId).mockReturnValue(false)

      const result = await presenter.previewImport('invalid-tool', ['skill1'])

      expect(result).toHaveLength(0)
    })

    it('should detect conflicts with existing skills', async () => {
      const { isValidToolId } =
        await import('../../../../src/main/presenter/skillSyncPresenter/security')
      const { toolScanner } =
        await import('../../../../src/main/presenter/skillSyncPresenter/toolScanner')
      const { formatConverter } =
        await import('../../../../src/main/presenter/skillSyncPresenter/formatConverter')

      vi.mocked(isValidToolId).mockReturnValue(true)
      vi.mocked(toolScanner.scanTool).mockResolvedValue({
        toolId: 'claude-code',
        toolName: 'Claude Code',
        available: true,
        skillsDir: '/path',
        skills: [
          {
            name: 'existing-skill',
            path: '/path/to/skill',
            format: 'claude-code',
            lastModified: new Date()
          }
        ]
      })
      vi.mocked(toolScanner.getTool).mockReturnValue({
        id: 'claude-code',
        name: 'Claude Code',
        skillsDir: '~/.claude/skills/',
        filePattern: '*/SKILL.md',
        format: 'claude-code',
        capabilities: {
          hasFrontmatter: true,
          supportsName: true,
          supportsDescription: true,
          supportsTools: true,
          supportsModel: true,
          supportsSubfolders: true,
          supportsReferences: true,
          supportsScripts: true
        }
      })
      vi.mocked(formatConverter.parseExternal).mockResolvedValue({
        name: 'existing-skill',
        description: 'A skill',
        instructions: 'Do something'
      })
      vi.mocked(fs.promises.readFile).mockResolvedValue('# Content')
      vi.mocked(mockSkillPresenter.getMetadataList).mockResolvedValue([
        { name: 'existing-skill', path: '/local/path', skillRoot: '/local' }
      ] as any)

      const result = await presenter.previewImport('claude-code', ['existing-skill'])

      expect(result).toHaveLength(1)
      expect(result[0].conflict).toBeDefined()
      expect(result[0].conflict?.existingSkillName).toBe('existing-skill')
    })
  })

  describe('executeImport', () => {
    it('should reject invalid conflict strategies', async () => {
      const { isValidConflictStrategy } =
        await import('../../../../src/main/presenter/skillSyncPresenter/security')
      vi.mocked(isValidConflictStrategy).mockReturnValue(false)

      const previews: ImportPreview[] = [
        {
          skill: { name: 'skill1', description: '', instructions: '' },
          source: {
            name: 'skill1',
            path: '/path',
            format: 'claude-code',
            lastModified: new Date()
          },
          warnings: []
        }
      ]

      const result = await presenter.executeImport(previews, {
        skill1: 'INVALID' as ConflictStrategy
      })

      expect(result.success).toBe(false)
      expect(result.failed).toHaveLength(1)
      expect(result.failed[0].reason).toContain('Invalid conflict strategy')
    })

    it('should skip conflicts when strategy is SKIP', async () => {
      const { isValidConflictStrategy } =
        await import('../../../../src/main/presenter/skillSyncPresenter/security')
      vi.mocked(isValidConflictStrategy).mockReturnValue(true)

      const previews: ImportPreview[] = [
        {
          skill: { name: 'skill1', description: '', instructions: '' },
          source: {
            name: 'skill1',
            path: '/path',
            format: 'claude-code',
            lastModified: new Date()
          },
          conflict: { existingSkillName: 'skill1', strategy: ConflictStrategy.SKIP },
          warnings: []
        }
      ]

      const result = await presenter.executeImport(previews, {
        skill1: ConflictStrategy.SKIP
      })

      expect(result.skipped).toBe(1)
      expect(result.imported).toBe(0)
    })

    it('should import successfully with OVERWRITE strategy', async () => {
      const { isValidConflictStrategy } =
        await import('../../../../src/main/presenter/skillSyncPresenter/security')
      const { formatConverter } =
        await import('../../../../src/main/presenter/skillSyncPresenter/formatConverter')

      vi.mocked(isValidConflictStrategy).mockReturnValue(true)
      vi.mocked(formatConverter.serializeToSkillMd).mockReturnValue(
        '---\nname: skill1\n---\n# Content'
      )
      vi.mocked(fs.promises.mkdir).mockResolvedValue(undefined)
      vi.mocked(fs.promises.writeFile).mockResolvedValue(undefined)
      vi.mocked(fs.promises.rm).mockResolvedValue(undefined)

      const previews: ImportPreview[] = [
        {
          skill: { name: 'skill1', description: 'Test', instructions: 'Do something' },
          source: {
            name: 'skill1',
            path: '/path',
            format: 'claude-code',
            lastModified: new Date()
          },
          conflict: { existingSkillName: 'skill1', strategy: ConflictStrategy.OVERWRITE },
          warnings: []
        }
      ]

      const result = await presenter.executeImport(previews, {
        skill1: ConflictStrategy.OVERWRITE
      })

      expect(result.imported).toBe(1)
      expect(mockSkillPresenter.installFromFolder).toHaveBeenCalledWith(expect.any(String), {
        overwrite: true
      })
    })
  })

  // ============================================================================
  // Export Tests
  // ============================================================================

  describe('previewExport', () => {
    it('should return empty for invalid tool ID', async () => {
      const { isValidToolId } =
        await import('../../../../src/main/presenter/skillSyncPresenter/security')
      vi.mocked(isValidToolId).mockReturnValue(false)

      const result = await presenter.previewExport(['skill1'], 'invalid-tool')

      expect(result).toHaveLength(0)
    })

    it('should generate conversion warnings', async () => {
      const { isValidToolId } =
        await import('../../../../src/main/presenter/skillSyncPresenter/security')
      const { toolScanner } =
        await import('../../../../src/main/presenter/skillSyncPresenter/toolScanner')
      const { formatConverter } =
        await import('../../../../src/main/presenter/skillSyncPresenter/formatConverter')

      vi.mocked(isValidToolId).mockReturnValue(true)
      vi.mocked(toolScanner.getTool).mockReturnValue({
        id: 'windsurf',
        name: 'Windsurf',
        skillsDir: '.windsurf/rules/',
        filePattern: '*.md',
        format: 'windsurf',
        capabilities: {
          hasFrontmatter: false,
          supportsName: true,
          supportsDescription: true,
          supportsTools: false,
          supportsModel: false,
          supportsSubfolders: false,
          supportsReferences: false,
          supportsScripts: false
        },
        isProjectLevel: true
      })
      vi.mocked(formatConverter.parseExternal).mockResolvedValue({
        name: 'skill1',
        description: 'Test',
        instructions: 'Do something',
        allowedTools: ['Read', 'Write']
      })
      vi.mocked(formatConverter.serializeToExternal).mockReturnValue('# Skill1\n\nDo something')
      vi.mocked(formatConverter.getConversionWarnings).mockReturnValue([
        { type: 'feature_loss', message: 'Tool restrictions will be lost', field: 'allowedTools' }
      ])
      vi.mocked(mockSkillPresenter.getMetadataList).mockResolvedValue([
        { name: 'skill1', path: '/local/skill1/SKILL.md', skillRoot: '/local/skill1' }
      ] as any)
      vi.mocked(fs.promises.readFile).mockResolvedValue('---\nname: skill1\n---\n# Content')
      vi.mocked(fs.promises.readdir).mockResolvedValue([])

      presenter.setProjectRoot('/project')
      const result = await presenter.previewExport(['skill1'], 'windsurf')

      expect(result).toHaveLength(1)
      expect(result[0].warnings).toContain('Tool restrictions will be lost')
    })
  })

  describe('executeExport', () => {
    it('should reject invalid conflict strategies', async () => {
      const { isValidConflictStrategy } =
        await import('../../../../src/main/presenter/skillSyncPresenter/security')
      vi.mocked(isValidConflictStrategy).mockReturnValue(false)

      const previews: ExportPreview[] = [
        {
          skillName: 'skill1',
          targetTool: 'cursor-project',
          targetPath: '/project/.cursor/skills/skill1/SKILL.md',
          convertedContent: '# Skill1',
          warnings: []
        }
      ]

      const result = await presenter.executeExport(previews, {
        skill1: 'INVALID' as ConflictStrategy
      })

      expect(result.success).toBe(false)
      expect(result.failed).toHaveLength(1)
    })

    it('should skip conflicts when strategy is SKIP', async () => {
      const { isValidConflictStrategy } =
        await import('../../../../src/main/presenter/skillSyncPresenter/security')
      vi.mocked(isValidConflictStrategy).mockReturnValue(true)

      const previews: ExportPreview[] = [
        {
          skillName: 'skill1',
          targetTool: 'cursor-project',
          targetPath: '/project/.cursor/skills/skill1/SKILL.md',
          convertedContent: '# Skill1',
          conflict: {
            existingPath: '/project/.cursor/skills/skill1/SKILL.md',
            strategy: ConflictStrategy.SKIP
          },
          warnings: []
        }
      ]

      const result = await presenter.executeExport(previews, {
        skill1: ConflictStrategy.SKIP
      })

      expect(result.skipped).toBe(1)
      expect(result.exported).toBe(0)
    })

    it('should check write permission before exporting', async () => {
      const { isValidConflictStrategy, checkWritePermission } =
        await import('../../../../src/main/presenter/skillSyncPresenter/security')
      vi.mocked(isValidConflictStrategy).mockReturnValue(true)
      vi.mocked(checkWritePermission).mockResolvedValue(false)

      const previews: ExportPreview[] = [
        {
          skillName: 'skill1',
          targetTool: 'cursor-project',
          targetPath: '/readonly/path/skill1.md',
          convertedContent: '# Skill1',
          warnings: []
        }
      ]

      const result = await presenter.executeExport(previews, {})

      expect(result.failed).toHaveLength(1)
      expect(result.failed[0].reason).toContain('No write permission')
    })

    it('should export successfully when writable', async () => {
      const { isValidConflictStrategy, checkWritePermission } =
        await import('../../../../src/main/presenter/skillSyncPresenter/security')
      vi.mocked(isValidConflictStrategy).mockReturnValue(true)
      vi.mocked(checkWritePermission).mockResolvedValue(true)
      vi.mocked(fs.promises.mkdir).mockResolvedValue(undefined)
      vi.mocked(fs.promises.writeFile).mockResolvedValue(undefined)

      const previews: ExportPreview[] = [
        {
          skillName: 'skill1',
          targetTool: 'cursor-project',
          targetPath: '/project/.cursor/skills/skill1/SKILL.md',
          convertedContent: '# Skill1',
          warnings: []
        }
      ]

      const result = await presenter.executeExport(previews, {})

      expect(result.exported).toBe(1)
      expect(fs.promises.writeFile).toHaveBeenCalledWith(
        '/project/.cursor/skills/skill1/SKILL.md',
        '# Skill1',
        'utf-8'
      )
    })
  })

  // ============================================================================
  // Tool Configuration Tests
  // ============================================================================

  describe('getRegisteredTools', () => {
    it('should return all registered tools', async () => {
      const { toolScanner } =
        await import('../../../../src/main/presenter/skillSyncPresenter/toolScanner')
      const tools = [
        { id: 'claude-code', name: 'Claude Code' },
        { id: 'cursor', name: 'Cursor' }
      ]
      vi.mocked(toolScanner.getAllTools).mockReturnValue(tools as any)

      const result = presenter.getRegisteredTools()

      expect(result).toHaveLength(2)
      expect(toolScanner.getAllTools).toHaveBeenCalled()
    })
  })

  describe('isToolAvailable', () => {
    it('should check tool availability', async () => {
      const { toolScanner } =
        await import('../../../../src/main/presenter/skillSyncPresenter/toolScanner')
      vi.mocked(toolScanner.isToolAvailable).mockResolvedValue(true)

      const result = await presenter.isToolAvailable('claude-code')

      expect(result).toBe(true)
      expect(toolScanner.isToolAvailable).toHaveBeenCalledWith('claude-code', undefined)
    })
  })

  // ============================================================================
  // Project Root Tests
  // ============================================================================

  describe('setProjectRoot', () => {
    it('should set project root for project-level tools', async () => {
      const { toolScanner } =
        await import('../../../../src/main/presenter/skillSyncPresenter/toolScanner')
      vi.mocked(toolScanner.isToolAvailable).mockResolvedValue(true)

      presenter.setProjectRoot('/my/project')
      await presenter.isToolAvailable('cursor')

      expect(toolScanner.isToolAvailable).toHaveBeenCalledWith('cursor', '/my/project')
    })
  })
})
