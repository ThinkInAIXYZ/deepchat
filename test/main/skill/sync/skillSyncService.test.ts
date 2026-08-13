/**
 * SkillSyncService Unit Tests
 *
 * Tests for the main presenter including:
 * - External snapshot preview security validation
 * - Tool scanning integration
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import * as fs from 'fs'
import * as path from 'path'
import { SkillSyncService } from '../../../../src/main/skill/sync'
import type { SkillServicePort } from '@shared/types/skill'
import type { ExternalToolConfig } from '../../../../src/shared/types/skillSync'

const scanWorkerMock = vi.hoisted(() => ({
  scanExternalToolsInWorker: vi.fn(),
  scanAndDetectDiscoveriesInWorker: vi.fn()
}))
const publishDeepchatEvent = vi.fn()

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
    lstat: vi.fn(),
    realpath: vi.fn(),
    readdir: vi.fn(),
    opendir: vi.fn(),
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

// Mock security module
vi.mock('../../../../src/main/skill/sync/security', () => ({
  isValidToolId: vi.fn((id) =>
    [
      'agents',
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
  isValidSkillName: vi.fn((name) => name && !name.includes('/') && name !== '..' && name !== '.'),
  sanitizeSkillName: vi.fn((name) => name?.replace(/[<>:"/\\|?*]/g, '-')),
  checkReadPermission: vi.fn().mockResolvedValue(true),
  checkWritePermission: vi.fn().mockResolvedValue(true),
  MAX_SUBFOLDER_FILE_SIZE: 5 * 1024 * 1024,
  MAX_SKILL_FOLDER_SIZE: 50 * 1024 * 1024,
  isFilenameSafe: vi.fn((name) => name && !name.includes('/') && name !== '..' && name !== '.'),
  isPathWithinBase: vi.fn().mockReturnValue(true),
  validateFolderSize: vi.fn().mockResolvedValue({ valid: true, totalSize: 1024 })
}))

// Mock toolScanner
vi.mock('../../../../src/main/skill/sync/toolScanner', () => ({
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
    if (tool.isProjectLevel) return path.join(projectRoot, tool.skillsDir)
    if (path.isAbsolute(tool.skillsDir)) return tool.skillsDir
    return tool.skillsDir.startsWith('~/')
      ? path.join('/home/user', tool.skillsDir.slice(2))
      : path.join('/home/user', tool.skillsDir)
  })
}))

// Mock formatConverter
vi.mock('../../../../src/main/skill/sync/formatConverter', () => ({
  formatConverter: {
    parseExternal: vi.fn(),
    serializeToExternal: vi.fn(),
    serializeToSkillMd: vi.fn(),
    getConversionWarnings: vi.fn()
  }
}))

vi.mock('../../../../src/main/skill/sync/scanWorker', () => scanWorkerMock)

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

describe('SkillSyncService', () => {
  let presenter: SkillSyncService
  let mockSkillService: SkillServicePort
  let mockProviderSettings: {
    getScanCache: ReturnType<typeof vi.fn>
    setScanCache: ReturnType<typeof vi.fn>
  }

  beforeEach(async () => {
    vi.clearAllMocks()
    const { checkReadPermission, checkWritePermission } =
      await import('../../../../src/main/skill/sync/security')
    vi.mocked(checkReadPermission).mockResolvedValue(true)
    vi.mocked(checkWritePermission).mockResolvedValue(true)
    vi.mocked(fs.promises.lstat).mockImplementation(async (targetPath) => {
      const value = String(targetPath)
      return {
        isSymbolicLink: () => false,
        isDirectory: () => !value.endsWith('.md'),
        isFile: () => value.endsWith('.md')
      } as fs.Stats
    })
    vi.mocked(fs.promises.realpath).mockImplementation(async (targetPath) =>
      path.resolve(String(targetPath))
    )
    vi.mocked(fs.promises.readdir).mockResolvedValue([])
    vi.mocked(fs.promises.opendir).mockResolvedValue({
      async *[Symbol.asyncIterator]() {}
    } as fs.Dir)
    scanWorkerMock.scanExternalToolsInWorker.mockRejectedValue(new Error('worker unavailable'))
    scanWorkerMock.scanAndDetectDiscoveriesInWorker.mockRejectedValue(
      new Error('worker unavailable')
    )

    // Create mock skill presenter
    mockSkillService = {
      getMetadataList: vi.fn().mockResolvedValue([]),
      getAllSkills: vi.fn().mockResolvedValue([]),
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
      getSkillManagementState: vi.fn().mockResolvedValue({ version: 1, skills: {} })
    } as unknown as SkillServicePort

    // Create mock config presenter
    mockProviderSettings = {
      getScanCache: vi.fn().mockReturnValue(null),
      setScanCache: vi.fn()
    }

    presenter = new SkillSyncService(
      mockSkillService,
      mockProviderSettings as any,
      publishDeepchatEvent
    )
  })

  // ============================================================================
  // Scanning Tests
  // ============================================================================

  describe('scanExternalTools', () => {
    it('should scan all external tools', async () => {
      const { toolScanner } = await import('../../../../src/main/skill/sync/toolScanner')
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
      const { toolScanner } = await import('../../../../src/main/skill/sync/toolScanner')
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
      const { toolScanner } = await import('../../../../src/main/skill/sync/toolScanner')
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
      const { toolScanner } = await import('../../../../src/main/skill/sync/toolScanner')
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
      const { toolScanner } = await import('../../../../src/main/skill/sync/toolScanner')
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
      const { isValidToolId } = await import('../../../../src/main/skill/sync/security')
      vi.mocked(isValidToolId).mockReturnValue(false)

      const result = await presenter.previewImport('invalid-tool', ['skill1'])

      expect(result).toHaveLength(0)
    })

    it('should detect conflicts with existing skills', async () => {
      const { isValidToolId } = await import('../../../../src/main/skill/sync/security')
      const { toolScanner } = await import('../../../../src/main/skill/sync/toolScanner')
      const { formatConverter } = await import('../../../../src/main/skill/sync/formatConverter')

      vi.mocked(isValidToolId).mockReturnValue(true)
      vi.mocked(toolScanner.scanTool).mockResolvedValue({
        toolId: 'claude-code',
        toolName: 'Claude Code',
        available: true,
        skillsDir: '/home/user/.claude/skills',
        skills: [
          {
            name: 'existing-skill',
            path: '/home/user/.claude/skills/existing-skill',
            format: 'claude-code',
            lastModified: new Date()
          }
        ]
      })
      vi.mocked(toolScanner.getTool).mockReturnValue({
        id: 'claude-code',
        name: 'Claude Code',
        skillsDir: '/home/user/.claude/skills',
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
      vi.mocked(mockSkillService.getAllSkills).mockResolvedValue([
        { name: 'existing-skill', path: '/local/path', skillRoot: '/local' }
      ] as any)

      const result = await presenter.previewImport('claude-code', ['existing-skill'])

      expect(result).toHaveLength(1)
      expect(result[0].conflict).toBeDefined()
      expect(result[0].conflict?.existingSkillName).toBe('existing-skill')
    })

    it.skipIf(process.platform === 'win32')(
      'rejects a symbolic-link SKILL.md before parsing an external Skill',
      async () => {
        const actualFs = await vi.importActual<typeof import('node:fs')>('node:fs')
        const { isValidToolId } = await import('../../../../src/main/skill/sync/security')
        const { toolScanner } = await import('../../../../src/main/skill/sync/toolScanner')
        const { formatConverter } = await import('../../../../src/main/skill/sync/formatConverter')
        const tempRoot = await actualFs.promises.mkdtemp(
          path.join((await import('node:os')).tmpdir(), 'deepchat-external-skill-test-')
        )
        const skillRoot = path.join(tempRoot, 'linked-skill')
        const outsideFile = path.join(tempRoot, 'outside.md')

        try {
          await actualFs.promises.mkdir(skillRoot)
          await actualFs.promises.writeFile(outsideFile, '# Outside', 'utf-8')
          await actualFs.promises.symlink(outsideFile, path.join(skillRoot, 'SKILL.md'))
          vi.mocked(fs.promises.lstat).mockImplementation(actualFs.promises.lstat)
          vi.mocked(fs.promises.realpath).mockImplementation(actualFs.promises.realpath)
          vi.mocked(fs.promises.readdir).mockImplementation(actualFs.promises.readdir as any)
          vi.mocked(fs.promises.opendir).mockImplementation(actualFs.promises.opendir)
          vi.mocked(isValidToolId).mockReturnValue(true)
          vi.mocked(toolScanner.scanTool).mockResolvedValue({
            toolId: 'codex',
            toolName: 'OpenAI Codex',
            available: true,
            skillsDir: tempRoot,
            skills: [
              {
                name: 'linked-skill',
                path: skillRoot,
                format: 'codex',
                lastModified: new Date()
              }
            ]
          })
          vi.mocked(toolScanner.getTool).mockReturnValue(createFolderTool({ skillsDir: tempRoot }))

          const result = await presenter.previewImport('codex', ['linked-skill'])

          expect(result).toHaveLength(1)
          expect(result[0].warnings).toEqual([
            expect.stringContaining('Parse error: External Skill source contains a symbolic link')
          ])
          expect(formatConverter.parseExternal).not.toHaveBeenCalled()
        } finally {
          await actualFs.promises.rm(tempRoot, { recursive: true, force: true })
        }
      }
    )

    it.skipIf(process.platform === 'win32')(
      'rejects symbolic links nested in imported external Skill subfolders',
      async () => {
        const actualFs = await vi.importActual<typeof import('node:fs')>('node:fs')
        const { isValidToolId } = await import('../../../../src/main/skill/sync/security')
        const { toolScanner } = await import('../../../../src/main/skill/sync/toolScanner')
        const { formatConverter } = await import('../../../../src/main/skill/sync/formatConverter')
        const tempRoot = await actualFs.promises.mkdtemp(
          path.join((await import('node:os')).tmpdir(), 'deepchat-external-skill-test-')
        )
        const skillRoot = path.join(tempRoot, 'nested-link-skill')
        const referencesRoot = path.join(skillRoot, 'references')
        const outsideDirectory = path.join(tempRoot, 'outside-directory')

        try {
          await Promise.all([
            actualFs.promises.mkdir(referencesRoot, { recursive: true }),
            actualFs.promises.mkdir(outsideDirectory)
          ])
          await actualFs.promises.writeFile(path.join(skillRoot, 'SKILL.md'), '# Skill', 'utf-8')
          await actualFs.promises.symlink(
            outsideDirectory,
            path.join(referencesRoot, 'nested-directory')
          )
          vi.mocked(fs.promises.lstat).mockImplementation(actualFs.promises.lstat)
          vi.mocked(fs.promises.realpath).mockImplementation(actualFs.promises.realpath)
          vi.mocked(fs.promises.readdir).mockImplementation(actualFs.promises.readdir as any)
          vi.mocked(fs.promises.opendir).mockImplementation(actualFs.promises.opendir)
          vi.mocked(isValidToolId).mockReturnValue(true)
          vi.mocked(toolScanner.scanTool).mockResolvedValue({
            toolId: 'codex',
            toolName: 'OpenAI Codex',
            available: true,
            skillsDir: tempRoot,
            skills: [
              {
                name: 'nested-link-skill',
                path: skillRoot,
                format: 'codex',
                lastModified: new Date()
              }
            ]
          })
          vi.mocked(toolScanner.getTool).mockReturnValue(createFolderTool({ skillsDir: tempRoot }))

          const result = await presenter.previewImport('codex', ['nested-link-skill'])

          expect(result).toHaveLength(1)
          expect(result[0].warnings).toEqual([
            expect.stringContaining('Parse error: External Skill source contains a symbolic link')
          ])
          expect(formatConverter.parseExternal).not.toHaveBeenCalled()
        } finally {
          await actualFs.promises.rm(tempRoot, { recursive: true, force: true })
        }
      }
    )

    it('rejects an oversized external SKILL.md before reading or parsing it', async () => {
      const actualFs = await vi.importActual<typeof import('node:fs')>('node:fs')
      const { isValidToolId } = await import('../../../../src/main/skill/sync/security')
      const { toolScanner } = await import('../../../../src/main/skill/sync/toolScanner')
      const { formatConverter } = await import('../../../../src/main/skill/sync/formatConverter')
      const tempRoot = await actualFs.promises.mkdtemp(
        path.join((await import('node:os')).tmpdir(), 'deepchat-external-skill-test-')
      )
      const skillRoot = path.join(tempRoot, 'oversized-skill')
      const skillFile = path.join(skillRoot, 'SKILL.md')

      try {
        await actualFs.promises.mkdir(skillRoot)
        await actualFs.promises.writeFile(skillFile, Buffer.alloc(5 * 1024 * 1024 + 1))
        vi.mocked(fs.promises.lstat).mockImplementation(actualFs.promises.lstat)
        vi.mocked(fs.promises.realpath).mockImplementation(actualFs.promises.realpath)
        vi.mocked(fs.promises.readdir).mockImplementation(actualFs.promises.readdir as any)
        vi.mocked(fs.promises.opendir).mockImplementation(actualFs.promises.opendir)
        vi.mocked(isValidToolId).mockReturnValue(true)
        vi.mocked(toolScanner.scanTool).mockResolvedValue({
          toolId: 'codex',
          toolName: 'OpenAI Codex',
          available: true,
          skillsDir: tempRoot,
          skills: [
            {
              name: 'oversized-skill',
              path: skillRoot,
              format: 'codex',
              lastModified: new Date()
            }
          ]
        })
        vi.mocked(toolScanner.getTool).mockReturnValue(createFolderTool({ skillsDir: tempRoot }))

        const result = await presenter.previewImport('codex', ['oversized-skill'])

        expect(result).toHaveLength(1)
        expect(result[0].warnings).toEqual([
          expect.stringContaining('Parse error: External Skill manifest is too large')
        ])
        expect(fs.promises.readFile).not.toHaveBeenCalled()
        expect(formatConverter.parseExternal).not.toHaveBeenCalled()
      } finally {
        await actualFs.promises.rm(tempRoot, { recursive: true, force: true })
      }
    })

    it('rejects external Skill subfolders deeper than the traversal limit', async () => {
      const actualFs = await vi.importActual<typeof import('node:fs')>('node:fs')
      const { isValidToolId } = await import('../../../../src/main/skill/sync/security')
      const { toolScanner } = await import('../../../../src/main/skill/sync/toolScanner')
      const { formatConverter } = await import('../../../../src/main/skill/sync/formatConverter')
      const tempRoot = await actualFs.promises.mkdtemp(
        path.join((await import('node:os')).tmpdir(), 'deepchat-external-skill-test-')
      )
      const skillRoot = path.join(tempRoot, 'deep-skill')
      let nestedDirectory = path.join(skillRoot, 'references')

      try {
        await actualFs.promises.mkdir(nestedDirectory, { recursive: true })
        await actualFs.promises.writeFile(path.join(skillRoot, 'SKILL.md'), '# Skill', 'utf-8')
        for (let depth = 0; depth <= 10; depth += 1) {
          nestedDirectory = path.join(nestedDirectory, `level-${depth}`)
          await actualFs.promises.mkdir(nestedDirectory)
        }
        vi.mocked(fs.promises.lstat).mockImplementation(actualFs.promises.lstat)
        vi.mocked(fs.promises.realpath).mockImplementation(actualFs.promises.realpath)
        vi.mocked(fs.promises.readdir).mockImplementation(actualFs.promises.readdir as any)
        vi.mocked(fs.promises.opendir).mockImplementation(actualFs.promises.opendir)
        vi.mocked(isValidToolId).mockReturnValue(true)
        vi.mocked(toolScanner.scanTool).mockResolvedValue({
          toolId: 'codex',
          toolName: 'OpenAI Codex',
          available: true,
          skillsDir: tempRoot,
          skills: [
            {
              name: 'deep-skill',
              path: skillRoot,
              format: 'codex',
              lastModified: new Date()
            }
          ]
        })
        vi.mocked(toolScanner.getTool).mockReturnValue(createFolderTool({ skillsDir: tempRoot }))

        const result = await presenter.previewImport('codex', ['deep-skill'])

        expect(result).toHaveLength(1)
        expect(result[0].warnings).toEqual([
          expect.stringContaining(
            'Parse error: External Skill source exceeds maximum directory depth'
          )
        ])
        expect(fs.promises.readFile).not.toHaveBeenCalled()
        expect(formatConverter.parseExternal).not.toHaveBeenCalled()
      } finally {
        await actualFs.promises.rm(tempRoot, { recursive: true, force: true })
      }
    })

    it('rejects external Skill subfolders over the shared entry budget', async () => {
      const actualFs = await vi.importActual<typeof import('node:fs')>('node:fs')
      const { isValidToolId } = await import('../../../../src/main/skill/sync/security')
      const { toolScanner } = await import('../../../../src/main/skill/sync/toolScanner')
      const { formatConverter } = await import('../../../../src/main/skill/sync/formatConverter')
      const tempRoot = await actualFs.promises.mkdtemp(
        path.join((await import('node:os')).tmpdir(), 'deepchat-external-skill-test-')
      )
      const skillRoot = path.join(tempRoot, 'wide-skill')
      const referencesRoot = path.join(skillRoot, 'references')
      const scriptsRoot = path.join(skillRoot, 'scripts')

      try {
        await Promise.all([
          actualFs.promises.mkdir(referencesRoot, { recursive: true }),
          actualFs.promises.mkdir(scriptsRoot, { recursive: true })
        ])
        await actualFs.promises.writeFile(path.join(skillRoot, 'SKILL.md'), '# Skill', 'utf-8')
        const entries = Array.from({ length: 1001 }, (_, index) => ({
          directory: index < 600 ? referencesRoot : scriptsRoot,
          name: `entry-${index}`
        }))
        for (let start = 0; start <= 1000; start += 100) {
          const end = Math.min(start + 100, 1001)
          await Promise.all(
            entries
              .slice(start, end)
              .map((entry) =>
                actualFs.promises.writeFile(path.join(entry.directory, entry.name), '')
              )
          )
        }
        vi.mocked(fs.promises.lstat).mockImplementation(actualFs.promises.lstat)
        vi.mocked(fs.promises.realpath).mockImplementation(actualFs.promises.realpath)
        vi.mocked(fs.promises.readdir).mockImplementation(actualFs.promises.readdir as any)
        vi.mocked(fs.promises.opendir).mockImplementation(actualFs.promises.opendir)
        vi.mocked(isValidToolId).mockReturnValue(true)
        vi.mocked(toolScanner.scanTool).mockResolvedValue({
          toolId: 'codex',
          toolName: 'OpenAI Codex',
          available: true,
          skillsDir: tempRoot,
          skills: [
            {
              name: 'wide-skill',
              path: skillRoot,
              format: 'codex',
              lastModified: new Date()
            }
          ]
        })
        vi.mocked(toolScanner.getTool).mockReturnValue(createFolderTool({ skillsDir: tempRoot }))

        const result = await presenter.previewImport('codex', ['wide-skill'])

        expect(result).toHaveLength(1)
        expect(result[0].warnings).toEqual([
          expect.stringContaining('Parse error: External Skill source exceeds maximum entry count')
        ])
        expect(fs.promises.readFile).not.toHaveBeenCalled()
        expect(formatConverter.parseExternal).not.toHaveBeenCalled()
      } finally {
        await actualFs.promises.rm(tempRoot, { recursive: true, force: true })
      }
    })

    it('rejects external Skill content over the shared total-size budget before reading', async () => {
      const actualFs = await vi.importActual<typeof import('node:fs')>('node:fs')
      const { isValidToolId } = await import('../../../../src/main/skill/sync/security')
      const { toolScanner } = await import('../../../../src/main/skill/sync/toolScanner')
      const { formatConverter } = await import('../../../../src/main/skill/sync/formatConverter')
      const tempRoot = await actualFs.promises.mkdtemp(
        path.join((await import('node:os')).tmpdir(), 'deepchat-external-skill-test-')
      )
      const skillRoot = path.join(tempRoot, 'large-skill')
      const referencesRoot = path.join(skillRoot, 'references')
      const scriptsRoot = path.join(skillRoot, 'scripts')

      try {
        await Promise.all([
          actualFs.promises.mkdir(referencesRoot, { recursive: true }),
          actualFs.promises.mkdir(scriptsRoot, { recursive: true })
        ])
        await actualFs.promises.writeFile(path.join(skillRoot, 'SKILL.md'), '# Skill', 'utf-8')
        for (let index = 0; index < 11; index += 1) {
          const directory = index < 6 ? referencesRoot : scriptsRoot
          const filePath = path.join(directory, `content-${index}.md`)
          await actualFs.promises.writeFile(filePath, '')
          await actualFs.promises.truncate(filePath, 5 * 1024 * 1024)
        }
        vi.mocked(fs.promises.lstat).mockImplementation(actualFs.promises.lstat)
        vi.mocked(fs.promises.realpath).mockImplementation(actualFs.promises.realpath)
        vi.mocked(fs.promises.readdir).mockImplementation(actualFs.promises.readdir as any)
        vi.mocked(fs.promises.opendir).mockImplementation(actualFs.promises.opendir)
        vi.mocked(isValidToolId).mockReturnValue(true)
        vi.mocked(toolScanner.scanTool).mockResolvedValue({
          toolId: 'codex',
          toolName: 'OpenAI Codex',
          available: true,
          skillsDir: tempRoot,
          skills: [
            {
              name: 'large-skill',
              path: skillRoot,
              format: 'codex',
              lastModified: new Date()
            }
          ]
        })
        vi.mocked(toolScanner.getTool).mockReturnValue(createFolderTool({ skillsDir: tempRoot }))

        const result = await presenter.previewImport('codex', ['large-skill'])

        expect(result).toHaveLength(1)
        expect(result[0].warnings).toEqual([
          expect.stringContaining('Parse error: External Skill source exceeds maximum total size')
        ])
        expect(fs.promises.readFile).not.toHaveBeenCalled()
        expect(formatConverter.parseExternal).not.toHaveBeenCalled()
      } finally {
        await actualFs.promises.rm(tempRoot, { recursive: true, force: true })
      }
    })
  })

  describe('isToolAvailable', () => {
    it('should check tool availability', async () => {
      const { toolScanner } = await import('../../../../src/main/skill/sync/toolScanner')
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
      const { toolScanner } = await import('../../../../src/main/skill/sync/toolScanner')
      vi.mocked(toolScanner.isToolAvailable).mockResolvedValue(true)

      presenter.setProjectRoot('/my/project')
      await presenter.isToolAvailable('cursor')

      expect(toolScanner.isToolAvailable).toHaveBeenCalledWith('cursor', '/my/project')
    })
  })
})
