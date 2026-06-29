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
import { publishDeepchatEvent } from '@/routes/publishDeepchatEvent'
import { ConflictStrategy } from '../../../../src/shared/types/skillSync'
import type { ISkillPresenter } from '../../../../src/shared/presenter'
import type {
  ExternalToolConfig,
  ImportPreview,
  ExportPreview
} from '../../../../src/shared/types/skillSync'

const scanWorkerMock = vi.hoisted(() => ({
  scanExternalToolsInWorker: vi.fn(),
  scanAndDetectDiscoveriesInWorker: vi.fn()
}))

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
    readlink: vi.fn(),
    readFile: vi.fn(),
    writeFile: vi.fn(),
    copyFile: vi.fn(),
    mkdir: vi.fn(),
    rm: vi.fn(),
    rename: vi.fn(),
    symlink: vi.fn(),
    access: vi.fn()
  },
  constants: {
    F_OK: 0,
    R_OK: 4,
    W_OK: 2
  },
  realpathSync: vi.fn((p) => String(p))
}))

vi.mock('@/routes/publishDeepchatEvent', () => ({
  publishDeepchatEvent: vi.fn()
}))

// Mock security module
vi.mock('../../../../src/main/presenter/skillSyncPresenter/security', () => ({
  isValidToolId: vi.fn((id) =>
    [
      'claude-code',
      'codex',
      'cursor',
      'windsurf',
      'copilot',
      'kiro',
      'antigravity',
      'opencode',
      'goose',
      'kilocode',
      'copilot-user'
    ].includes(id)
  ),
  isValidConflictStrategy: vi.fn((s) =>
    [ConflictStrategy.SKIP, ConflictStrategy.OVERWRITE, ConflictStrategy.RENAME].includes(s)
  ),
  isValidSkillName: vi.fn((name) => name && !name.includes('/') && name !== '..' && name !== '.'),
  sanitizeSkillName: vi.fn((name) => name?.replace(/[<>:"/\\|?*]/g, '-')),
  checkReadPermission: vi.fn().mockResolvedValue(true),
  checkWritePermission: vi.fn().mockResolvedValue(true),
  isFilenameSafe: vi.fn((name) => name && !name.includes('/') && name !== '..' && name !== '.'),
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

vi.mock('../../../../src/main/presenter/skillSyncPresenter/scanWorker', () => scanWorkerMock)

function getPublishedEventPayloads(eventName: string) {
  return vi
    .mocked(publishDeepchatEvent)
    .mock.calls.filter(([name]) => name === eventName)
    .map(([, payload]) => payload)
}

function createDirent(
  name: string,
  options: { directory?: boolean; symlink?: boolean; file?: boolean }
) {
  return {
    name,
    isDirectory: () => Boolean(options.directory),
    isSymbolicLink: () => Boolean(options.symlink),
    isFile: () => Boolean(options.file)
  } as fs.Dirent
}

function createFolderTool(overrides: Partial<ExternalToolConfig> = {}): ExternalToolConfig {
  return {
    id: 'codex',
    name: 'OpenAI Codex',
    skillsDir: '~/.codex/skills/',
    filePattern: '*/SKILL.md',
    format: 'codex',
    capabilities: {
      hasFrontmatter: true,
      supportsName: true,
      supportsDescription: true,
      supportsTools: true,
      supportsModel: true,
      supportsSubfolders: true,
      supportsReferences: true,
      supportsScripts: true
    },
    ...overrides
  }
}

describe('SkillSyncPresenter', () => {
  let presenter: SkillSyncPresenter
  let mockSkillPresenter: ISkillPresenter
  let mockConfigPresenter: {
    getSetting: ReturnType<typeof vi.fn>
    setSetting: ReturnType<typeof vi.fn>
  }

  beforeEach(async () => {
    vi.clearAllMocks()
    const { checkReadPermission, checkWritePermission } =
      await import('../../../../src/main/presenter/skillSyncPresenter/security')
    vi.mocked(checkReadPermission).mockResolvedValue(true)
    vi.mocked(checkWritePermission).mockResolvedValue(true)
    scanWorkerMock.scanExternalToolsInWorker.mockRejectedValue(new Error('worker unavailable'))
    scanWorkerMock.scanAndDetectDiscoveriesInWorker.mockRejectedValue(
      new Error('worker unavailable')
    )

    // Create mock skill presenter
    mockSkillPresenter = {
      getMetadataList: vi.fn().mockResolvedValue([]),
      installFromFolder: vi.fn().mockResolvedValue({ success: true }),
      loadSkillContent: vi.fn().mockResolvedValue({ content: '# Skill Content' }),
      readSkillFile: vi.fn().mockResolvedValue('---\nname: test\ndescription: Test\n---\n'),
      getSkillExtension: vi.fn().mockResolvedValue({
        version: 1,
        env: {},
        runtimePolicy: { python: 'auto', node: 'auto' },
        scriptOverrides: {}
      }),
      saveSkillWithExtension: vi.fn().mockResolvedValue({ success: true, skillName: 'test' }),
      saveSkillExtension: vi.fn().mockResolvedValue(undefined),
      listSkillScripts: vi.fn().mockResolvedValue([]),
      getSkillsDir: vi.fn().mockResolvedValue('/home/user/.deepchat/skills'),
      getUnifiedSkillCatalog: vi.fn().mockResolvedValue([]),
      getSkillManagementState: vi.fn().mockResolvedValue({ version: 1, skills: {} }),
      registerAdoptedSkill: vi.fn().mockResolvedValue(undefined),
      registerAgentSkillLink: vi.fn().mockResolvedValue(undefined),
      removeAgentSkillLink: vi.fn().mockResolvedValue(undefined)
    } as unknown as ISkillPresenter

    // Create mock config presenter
    mockConfigPresenter = {
      getSetting: vi.fn().mockResolvedValue(null),
      setSetting: vi.fn().mockResolvedValue(undefined)
    }

    presenter = new SkillSyncPresenter(mockSkillPresenter, mockConfigPresenter as any)
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
      expect(getPublishedEventPayloads('skillSync.scan.started')).toHaveLength(1)
      expect(getPublishedEventPayloads('skillSync.scan.completed')).toContainEqual(
        expect.objectContaining({
          results,
          version: expect.any(Number)
        })
      )
    })

    it('uses the worker scan when available', async () => {
      const { toolScanner } =
        await import('../../../../src/main/presenter/skillSyncPresenter/toolScanner')
      scanWorkerMock.scanExternalToolsInWorker.mockResolvedValue([
        {
          toolId: 'codex',
          toolName: 'OpenAI Codex',
          available: true,
          skillsDir: '/home/user/.codex/skills/',
          skills: []
        }
      ])
      vi.mocked(toolScanner.getAllTools).mockReturnValue([
        {
          id: 'codex',
          name: 'OpenAI Codex',
          skillsDir: '~/.codex/skills/',
          filePattern: '*/SKILL.md',
          format: 'codex',
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
        }
      ])

      const results = await presenter.scanExternalTools()

      expect(results).toHaveLength(1)
      expect(results[0].toolId).toBe('codex')
      expect(scanWorkerMock.scanExternalToolsInWorker).toHaveBeenCalled()
      expect(toolScanner.scanExternalTools).not.toHaveBeenCalled()
    })

    it('falls back to main-thread scan when the worker fails', async () => {
      const { toolScanner } =
        await import('../../../../src/main/presenter/skillSyncPresenter/toolScanner')
      scanWorkerMock.scanExternalToolsInWorker.mockRejectedValue(new Error('worker failed'))
      vi.mocked(toolScanner.scanExternalTools).mockResolvedValue([
        {
          toolId: 'claude-code',
          toolName: 'Claude Code',
          available: true,
          skillsDir: '/home/user/.claude/skills/',
          skills: []
        }
      ])
      const consoleWarnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})

      const results = await presenter.scanExternalTools()

      expect(results).toHaveLength(1)
      expect(toolScanner.scanExternalTools).toHaveBeenCalled()
      expect(consoleWarnSpy).toHaveBeenCalledWith(
        '[SkillSync] Worker scan failed, falling back to main thread:',
        expect.any(Error)
      )
      consoleWarnSpy.mockRestore()
    })

    it('publishes new discoveries after comparing cache and local skills', async () => {
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
              name: 'new-skill',
              path: '/home/user/.claude/skills/new-skill/SKILL.md',
              format: 'claude-code',
              lastModified: new Date()
            }
          ]
        }
      ])

      const discoveries = await presenter.scanAndDetectNewDiscoveries()

      expect(discoveries).toHaveLength(1)
      expect(getPublishedEventPayloads('skillSync.discoveries.changed')).toContainEqual(
        expect.objectContaining({
          discoveries,
          version: expect.any(Number)
        })
      )
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
      expect(getPublishedEventPayloads('skillSync.import.started')).toContainEqual(
        expect.objectContaining({
          total: 1,
          version: expect.any(Number)
        })
      )
      expect(getPublishedEventPayloads('skillSync.import.progress')).toContainEqual(
        expect.objectContaining({
          current: 1,
          total: 1,
          skillName: 'skill1',
          status: 'skipped',
          version: expect.any(Number)
        })
      )
      expect(getPublishedEventPayloads('skillSync.import.completed')).toContainEqual(
        expect.objectContaining({
          result,
          version: expect.any(Number)
        })
      )
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
      expect(getPublishedEventPayloads('skillSync.import.progress')).toContainEqual(
        expect.objectContaining({
          current: 1,
          total: 1,
          skillName: 'skill1',
          status: 'success',
          version: expect.any(Number)
        })
      )
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
      expect(getPublishedEventPayloads('skillSync.export.started')).toContainEqual(
        expect.objectContaining({
          total: 1,
          version: expect.any(Number)
        })
      )
      expect(getPublishedEventPayloads('skillSync.export.progress')).toContainEqual(
        expect.objectContaining({
          current: 1,
          total: 1,
          skillName: 'skill1',
          status: 'skipped',
          version: expect.any(Number)
        })
      )
      expect(getPublishedEventPayloads('skillSync.export.completed')).toContainEqual(
        expect.objectContaining({
          result,
          version: expect.any(Number)
        })
      )
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
      expect(getPublishedEventPayloads('skillSync.export.progress')).toContainEqual(
        expect.objectContaining({
          current: 1,
          total: 1,
          skillName: 'skill1',
          status: 'success',
          version: expect.any(Number)
        })
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

  describe('scanSkillAgents', () => {
    it('lists only user-level folder-format agents', async () => {
      const { toolScanner } =
        await import('../../../../src/main/presenter/skillSyncPresenter/toolScanner')
      const codexTool = createFolderTool()
      vi.mocked(toolScanner.getAllTools).mockReturnValue([
        codexTool,
        createFolderTool({
          id: 'cursor-project',
          name: 'Cursor (Project)',
          skillsDir: '.cursor/skills/',
          format: 'cursor',
          isProjectLevel: true
        }),
        createFolderTool({
          id: 'windsurf',
          name: 'Windsurf',
          skillsDir: '.windsurf/rules/',
          filePattern: '*.md',
          format: 'windsurf',
          capabilities: {
            ...codexTool.capabilities,
            supportsSubfolders: false,
            supportsReferences: false,
            supportsScripts: false
          },
          isProjectLevel: true
        })
      ])
      vi.mocked(toolScanner.scanExternalTools).mockResolvedValue([
        {
          toolId: 'codex',
          toolName: 'OpenAI Codex',
          available: true,
          skillsDir: '/home/user/.codex/skills',
          skills: [
            {
              name: 'agent-skill',
              path: '/home/user/.codex/skills/agent-skill',
              format: 'codex',
              lastModified: new Date()
            }
          ]
        }
      ])
      vi.mocked(fs.promises.readdir).mockResolvedValue([
        createDirent('agent-skill', { directory: true })
      ] as any)

      const agents = await presenter.scanSkillAgents()

      expect(agents).toEqual([
        expect.objectContaining({
          id: 'codex',
          skillsCount: 1,
          agentOwnedCount: 1,
          supportsLinkManagement: true,
          status: 'ready'
        })
      ])
    })

    it('classifies linked, agent-owned, external-link, broken-link, and conflict skills', async () => {
      const { toolScanner } =
        await import('../../../../src/main/presenter/skillSyncPresenter/toolScanner')
      const codexTool = createFolderTool()
      vi.mocked(toolScanner.getTool).mockReturnValue(codexTool)
      vi.mocked(toolScanner.scanTool).mockResolvedValue({
        toolId: 'codex',
        toolName: 'OpenAI Codex',
        available: true,
        skillsDir: '/home/user/.codex/skills',
        skills: [
          {
            name: 'agent-only',
            path: '/home/user/.codex/skills/agent-only',
            format: 'codex',
            lastModified: new Date()
          },
          {
            name: 'conflict-skill',
            path: '/home/user/.codex/skills/conflict-skill',
            format: 'codex',
            lastModified: new Date()
          }
        ]
      })
      vi.mocked(mockSkillPresenter.getUnifiedSkillCatalog).mockResolvedValue([
        {
          name: 'conflict-skill',
          description: 'DeepChat conflict',
          path: '/home/user/.deepchat/skills/conflict-skill/SKILL.md',
          skillRoot: '/home/user/.deepchat/skills/conflict-skill',
          canonicalPath: '/home/user/.deepchat/skills/conflict-skill',
          sourceType: 'created',
          deepchatDisabled: false,
          agentLinks: {},
          mutable: true
        },
        {
          name: 'linked-skill',
          description: 'Linked DeepChat skill',
          path: '/home/user/.deepchat/skills/linked-skill/SKILL.md',
          skillRoot: '/home/user/.deepchat/skills/linked-skill',
          canonicalPath: '/home/user/.deepchat/skills/linked-skill',
          sourceType: 'created',
          deepchatDisabled: false,
          agentLinks: {},
          mutable: true
        }
      ] as any)
      vi.mocked(fs.promises.readdir).mockResolvedValue([
        createDirent('agent-only', { directory: true }),
        createDirent('conflict-skill', { directory: true }),
        createDirent('linked-skill', { symlink: true }),
        createDirent('external-skill', { symlink: true }),
        createDirent('broken-skill', { symlink: true })
      ] as any)
      vi.mocked(fs.promises.readlink).mockImplementation(async (linkPath) => {
        if (String(linkPath).endsWith('/linked-skill')) {
          return '/home/user/.deepchat/skills/linked-skill'
        }
        if (String(linkPath).endsWith('/external-skill')) {
          return '/tmp/external-skill'
        }
        return '/home/user/.deepchat/skills/missing-skill'
      })
      vi.mocked(fs.promises.access).mockImplementation(async (targetPath) => {
        if (String(targetPath).includes('missing-skill')) {
          throw Object.assign(new Error('missing'), { code: 'ENOENT' })
        }
      })
      vi.mocked(fs.promises.readFile).mockImplementation(async (filePath) => {
        if (String(filePath).startsWith('/home/user/.codex/skills/conflict-skill')) {
          return 'agent content'
        }
        return 'deepchat content'
      })

      const detail = await presenter.scanSkillAgent({ agentId: 'codex' })
      const statusByName = new Map(detail.skills.map((skill) => [skill.name, skill.status]))

      expect(detail).toEqual(
        expect.objectContaining({
          id: 'codex',
          skillsCount: 5,
          linkedCount: 1,
          agentOwnedCount: 1,
          conflictCount: 1,
          brokenLinkCount: 1,
          status: 'ready'
        })
      )
      expect(statusByName).toEqual(
        new Map([
          ['agent-only', 'agent-owned'],
          ['broken-skill', 'broken-link'],
          ['conflict-skill', 'conflict'],
          ['external-skill', 'linked-out'],
          ['linked-skill', 'linked']
        ])
      )
    })

    it('reads detail markdown for a scanned agent skill', async () => {
      const { toolScanner } =
        await import('../../../../src/main/presenter/skillSyncPresenter/toolScanner')
      const codexTool = createFolderTool()
      vi.mocked(toolScanner.getTool).mockReturnValue(codexTool)
      vi.mocked(toolScanner.scanTool).mockResolvedValue({
        toolId: 'codex',
        toolName: 'OpenAI Codex',
        available: true,
        skillsDir: '/home/user/.codex/skills',
        skills: [
          {
            name: 'agent-only',
            description: 'Agent only',
            path: '/home/user/.codex/skills/agent-only',
            format: 'codex',
            lastModified: new Date()
          }
        ]
      })
      vi.mocked(fs.promises.readdir).mockResolvedValue([
        createDirent('agent-only', { directory: true })
      ] as any)
      vi.mocked(mockSkillPresenter.getUnifiedSkillCatalog).mockResolvedValue([])
      vi.mocked(fs.promises.readFile).mockResolvedValue('# Agent only')

      const detail = await presenter.getAgentSkillDetail({
        agentId: 'codex',
        skillName: 'agent-only'
      })

      expect(detail).toEqual({
        name: 'agent-only',
        description: 'Agent only',
        sourcePath: '/home/user/.codex/skills/agent-only/SKILL.md',
        markdown: '# Agent only',
        mutable: true
      })
    })

    it('previews adoption conflicts with the default renamed target', async () => {
      const { toolScanner } =
        await import('../../../../src/main/presenter/skillSyncPresenter/toolScanner')
      const codexTool = createFolderTool()
      vi.mocked(toolScanner.getTool).mockReturnValue(codexTool)
      vi.mocked(toolScanner.scanTool).mockResolvedValue({
        toolId: 'codex',
        toolName: 'OpenAI Codex',
        available: true,
        skillsDir: '/home/user/.codex/skills',
        skills: [
          {
            name: 'agent-only',
            path: '/home/user/.codex/skills/agent-only',
            format: 'codex',
            lastModified: new Date()
          }
        ]
      })
      vi.mocked(mockSkillPresenter.getUnifiedSkillCatalog).mockResolvedValue([
        {
          name: 'agent-only',
          description: 'Existing DeepChat skill',
          path: '/home/user/.deepchat/skills/agent-only/SKILL.md',
          skillRoot: '/home/user/.deepchat/skills/agent-only',
          canonicalPath: '/home/user/.deepchat/skills/agent-only',
          sourceType: 'created',
          deepchatDisabled: false,
          agentLinks: {},
          mutable: true
        }
      ] as any)
      vi.mocked(fs.promises.readdir).mockResolvedValue([
        createDirent('agent-only', { directory: true })
      ] as any)
      vi.mocked(fs.promises.readFile).mockResolvedValue(
        '---\nname: agent-only\ndescription: Agent skill\n---\n# Agent'
      )
      vi.mocked(fs.promises.access).mockRejectedValue(
        Object.assign(new Error('missing'), { code: 'ENOENT' })
      )

      const preview = await presenter.previewAdoptAgentSkill({
        agentId: 'codex',
        skillName: 'agent-only'
      })

      expect(preview).toEqual(
        expect.objectContaining({
          agentId: 'codex',
          skillName: 'agent-only',
          targetName: 'agent-only-codex',
          conflict: true,
          agentPath: '/home/user/.codex/skills/agent-only',
          targetPath: '/home/user/.deepchat/skills/agent-only-codex'
        })
      )
    })

    it('adopts an agent-owned skill through private temp and backup paths', async () => {
      const { toolScanner } =
        await import('../../../../src/main/presenter/skillSyncPresenter/toolScanner')
      const codexTool = createFolderTool()
      vi.mocked(toolScanner.getTool).mockReturnValue(codexTool)
      vi.mocked(toolScanner.scanTool).mockResolvedValue({
        toolId: 'codex',
        toolName: 'OpenAI Codex',
        available: true,
        skillsDir: '/home/user/.codex/skills',
        skills: [
          {
            name: 'agent-only',
            path: '/home/user/.codex/skills/agent-only',
            format: 'codex',
            lastModified: new Date()
          }
        ]
      })
      vi.mocked(fs.promises.readdir).mockImplementation(async (targetPath) => {
        if (String(targetPath) === '/home/user/.codex/skills') {
          return [createDirent('agent-only', { directory: true })] as any
        }
        if (String(targetPath) === '/home/user/.codex/skills/agent-only') {
          return [createDirent('SKILL.md', { file: true })] as any
        }
        return [] as any
      })
      vi.mocked(fs.promises.readFile).mockResolvedValue(
        '---\nname: agent-only\ndescription: Agent skill\n---\n# Agent'
      )
      vi.mocked(fs.promises.access).mockRejectedValue(
        Object.assign(new Error('missing'), { code: 'ENOENT' })
      )
      vi.mocked(fs.promises.mkdir).mockResolvedValue(undefined)
      vi.mocked(fs.promises.rm).mockResolvedValue(undefined)
      vi.mocked(fs.promises.copyFile).mockResolvedValue(undefined)
      vi.mocked(fs.promises.rename).mockResolvedValue(undefined)
      vi.mocked(fs.promises.symlink).mockResolvedValue(undefined)

      const result = await presenter.executeAdoptAgentSkill({
        agentId: 'codex',
        skillName: 'agent-only'
      })

      expect(result).toEqual(
        expect.objectContaining({
          success: true,
          skillName: 'agent-only',
          targetPath: '/home/user/.deepchat/skills/agent-only',
          agentPath: '/home/user/.codex/skills/agent-only'
        })
      )
      expect(fs.promises.copyFile).toHaveBeenCalledWith(
        '/home/user/.codex/skills/agent-only/SKILL.md',
        expect.stringContaining('/home/user/.deepchat/tmp/skill-adoptions/')
      )
      expect(fs.promises.rename).toHaveBeenCalledWith(
        expect.stringContaining('/home/user/.deepchat/tmp/skill-adoptions/'),
        '/home/user/.deepchat/skills/agent-only'
      )
      expect(fs.promises.rename).toHaveBeenCalledWith(
        '/home/user/.codex/skills/agent-only',
        expect.stringContaining('/home/user/.deepchat/backups/skill-adoptions/codex/agent-only/')
      )
      expect(fs.promises.symlink).toHaveBeenCalledWith(
        '/home/user/.deepchat/skills/agent-only',
        '/home/user/.codex/skills/agent-only',
        'dir'
      )
      expect(mockSkillPresenter.registerAdoptedSkill).toHaveBeenCalledWith({
        name: 'agent-only',
        canonicalPath: '/home/user/.deepchat/skills/agent-only',
        agentId: 'codex',
        agentPath: '/home/user/.codex/skills/agent-only',
        originalPath: '/home/user/.codex/skills/agent-only'
      })
    })

    it('links DeepChat skills to an agent and records link ownership', async () => {
      const { toolScanner } =
        await import('../../../../src/main/presenter/skillSyncPresenter/toolScanner')
      const codexTool = createFolderTool()
      vi.mocked(toolScanner.getTool).mockReturnValue(codexTool)
      vi.mocked(toolScanner.scanTool).mockResolvedValue({
        toolId: 'codex',
        toolName: 'OpenAI Codex',
        available: true,
        skillsDir: '/home/user/.codex/skills',
        skills: []
      })
      vi.mocked(mockSkillPresenter.getUnifiedSkillCatalog).mockResolvedValue([
        {
          name: 'deepchat-skill',
          description: 'DeepChat skill',
          path: '/home/user/.deepchat/skills/deepchat-skill/SKILL.md',
          skillRoot: '/home/user/.deepchat/skills/deepchat-skill',
          canonicalPath: '/home/user/.deepchat/skills/deepchat-skill',
          sourceType: 'created',
          deepchatDisabled: false,
          agentLinks: {},
          mutable: true
        }
      ] as any)
      vi.mocked(fs.promises.readdir).mockResolvedValue([] as any)
      vi.mocked(fs.promises.mkdir).mockResolvedValue(undefined)
      vi.mocked(fs.promises.symlink).mockResolvedValue(undefined)

      const result = await presenter.executeLinkDeepChatSkills({
        agentId: 'codex',
        skillNames: ['deepchat-skill']
      })

      expect(result).toEqual(
        expect.objectContaining({
          success: true,
          linked: 1,
          skipped: 0
        })
      )
      expect(fs.promises.symlink).toHaveBeenCalledWith(
        '/home/user/.deepchat/skills/deepchat-skill',
        '/home/user/.codex/skills/deepchat-skill',
        'dir'
      )
      expect(mockSkillPresenter.registerAgentSkillLink).toHaveBeenCalledWith({
        skillName: 'deepchat-skill',
        agentId: 'codex',
        agentPath: '/home/user/.codex/skills/deepchat-skill'
      })
    })

    it('refuses to repair or remove links not created by DeepChat', async () => {
      const { toolScanner } =
        await import('../../../../src/main/presenter/skillSyncPresenter/toolScanner')
      vi.mocked(toolScanner.getTool).mockReturnValue(createFolderTool())
      vi.mocked(mockSkillPresenter.getSkillManagementState).mockResolvedValue({
        version: 1,
        skills: {
          external: {
            name: 'external',
            canonicalPath: '/home/user/.deepchat/skills/external',
            deepchat: { disabled: false },
            extension: {
              version: 1,
              env: {},
              runtimePolicy: { python: 'auto', node: 'auto' },
              scriptOverrides: {}
            },
            source: { type: 'created' },
            agentLinks: {
              codex: {
                path: '/home/user/.codex/skills/external',
                state: 'linked',
                createdByDeepChat: false
              }
            }
          }
        }
      } as any)

      await expect(
        presenter.repairAgentSkillLink({ agentId: 'codex', skillName: 'external' })
      ).resolves.toEqual(
        expect.objectContaining({
          success: false,
          error: expect.stringContaining('not created by DeepChat')
        })
      )
      await expect(
        presenter.removeAgentSkillLink({ agentId: 'codex', skillName: 'external' })
      ).resolves.toEqual(
        expect.objectContaining({
          success: false,
          error: expect.stringContaining('not created by DeepChat')
        })
      )
      expect(fs.promises.rm).not.toHaveBeenCalled()
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
