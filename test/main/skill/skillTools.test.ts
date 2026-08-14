import { beforeEach, describe, expect, it, vi, type Mock } from 'vitest'
import { SkillTools } from '../../../src/main/skill/skillTools'
import type {
  SkillServicePort,
  SkillExtensionConfig,
  SkillManageRequest,
  SkillMetadata,
  SkillViewResult
} from '../../../src/shared/types/skill'

describe('SkillTools', () => {
  let skillTools: SkillTools
  let mockSkillService: SkillServicePort

  const defaultExtension: SkillExtensionConfig = {
    version: 1,
    env: {},
    runtimePolicy: { python: 'auto', node: 'auto' },
    scriptOverrides: {}
  }

  const mockSkillMetadata: SkillMetadata[] = [
    {
      name: 'code-review',
      description: 'Code review assistant',
      path: '/skills/code-review/SKILL.md',
      skillRoot: '/skills/code-review',
      allowedTools: ['read_file', 'list_files'],
      category: 'engineering',
      platforms: ['macos']
    },
    {
      name: 'git-commit',
      description: 'Git commit message generator',
      path: '/skills/git-commit/SKILL.md',
      skillRoot: '/skills/git-commit',
      allowedTools: ['run_terminal_cmd'],
      metadata: { tags: ['git'] }
    }
  ]

  beforeEach(() => {
    vi.clearAllMocks()

    mockSkillService = {
      getSkillsDir: vi.fn().mockResolvedValue('/mock/skills'),
      discoverSkills: vi.fn().mockResolvedValue(mockSkillMetadata),
      resolveSessionAgentId: vi.fn().mockResolvedValue('deepchat'),
      getMetadataList: vi.fn().mockResolvedValue(mockSkillMetadata),
      getAllSkills: vi.fn().mockResolvedValue(mockSkillMetadata),
      loadSkillContent: vi.fn().mockResolvedValue({ name: 'test', content: '# Test' }),
      viewSkillForAgent: vi.fn().mockResolvedValue({
        success: true,
        name: 'code-review',
        category: 'engineering',
        skillRoot: '/skills/code-review',
        filePath: null,
        content: '# Code Review',
        isPinned: true
      } satisfies SkillViewResult),
      viewSkill: vi.fn().mockResolvedValue({
        success: true,
        name: 'code-review',
        category: 'engineering',
        skillRoot: '/skills/code-review',
        filePath: null,
        content: '# Code Review',
        isPinned: true
      } satisfies SkillViewResult),
      manageDraftSkill: vi.fn().mockResolvedValue({
        success: true,
        action: 'create',
        draftId: 'draft-abc123',
        skillName: 'code-review'
      }),
      installBuiltinSkills: vi.fn().mockResolvedValue(undefined),
      installFromFolder: vi.fn().mockResolvedValue({ success: true, skillName: 'test' }),
      installFromZip: vi.fn().mockResolvedValue({ success: true, skillName: 'test' }),
      installFromUrl: vi.fn().mockResolvedValue({ success: true, skillName: 'test' }),
      uninstallSkill: vi.fn().mockResolvedValue({ success: true, skillName: 'test' }),
      readSkillFile: vi.fn().mockResolvedValue('---\nname: test\ndescription: Test\n---\n'),
      updateSkillFile: vi.fn().mockResolvedValue({ success: true }),
      saveSkillWithExtension: vi.fn().mockResolvedValue({ success: true, skillName: 'test' }),
      getSkillFolderTree: vi.fn().mockResolvedValue([]),
      openSkillsFolder: vi.fn().mockResolvedValue(undefined),
      getSkillExtension: vi.fn().mockResolvedValue(defaultExtension),
      saveSkillExtension: vi.fn().mockResolvedValue(undefined),
      listSkillScripts: vi.fn().mockResolvedValue([]),
      getActiveSkills: vi.fn().mockResolvedValue([]),
      setActiveSkills: vi.fn().mockResolvedValue([]),
      validateSkillNames: vi.fn().mockImplementation((names: string[]) => {
        const available = new Set(mockSkillMetadata.map((skill) => skill.name))
        return Promise.resolve(names.filter((name) => available.has(name)))
      }),
      getActiveSkillsAllowedTools: vi.fn().mockResolvedValue([]),
      watchSkillFiles: vi.fn(),
      stopWatching: vi.fn()
    } as unknown as SkillServicePort

    skillTools = new SkillTools(mockSkillService)
  })

  describe('handleSkillList', () => {
    it('returns bounded routing cards without private metadata', async () => {
      const result = await skillTools.handleSkillList()

      expect(result.totalCount).toBe(2)
      expect(result.pinnedCount).toBe(0)
      expect(result.activeCount).toBe(0)
      expect(result.skills).toEqual([
        expect.objectContaining({
          name: 'git-commit',
          isPinned: false,
          active: false
        }),
        expect.objectContaining({
          name: 'code-review',
          category: 'engineering',
          platforms: ['macos'],
          isPinned: false,
          active: false
        })
      ])
      expect(result.skills.every((skill) => !('metadata' in skill))).toBe(true)
    })

    it('marks pinned skills for the current conversation', async () => {
      ;(mockSkillService.getActiveSkills as Mock).mockResolvedValue(['git-commit'])

      const result = await skillTools.handleSkillList('conv-123')

      expect(result.pinnedCount).toBe(1)
      expect(result.activeCount).toBe(1)
      expect(result.skills.find((skill) => skill.name === 'git-commit')).toEqual(
        expect.objectContaining({
          isPinned: true,
          active: true
        })
      )
      expect(result.skills.find((skill) => skill.name === 'code-review')).toEqual(
        expect.objectContaining({
          isPinned: false,
          active: false
        })
      )
    })

    it('returns an empty catalog when the conversation has no DeepChat Agent scope', async () => {
      ;(mockSkillService.resolveSessionAgentId as Mock).mockResolvedValue(null)

      await expect(skillTools.handleSkillList('acp-session')).resolves.toEqual({
        skills: [],
        sessionActiveCount: 0,
        activeForExecutionCount: 0,
        pinnedCount: 0,
        activeCount: 0,
        totalCount: 0,
        totalMatched: 0,
        omittedCount: 0
      })
      expect(mockSkillService.getMetadataList).not.toHaveBeenCalled()
      expect(mockSkillService.getActiveSkills).not.toHaveBeenCalled()
    })

    it('rejects a stale cursor when the conversation loses its Agent scope', async () => {
      const firstPage = await skillTools.handleSkillList('conv-123', [], { limit: 1 })
      ;(mockSkillService.resolveSessionAgentId as Mock).mockResolvedValue(null)

      await expect(
        skillTools.handleSkillList('conv-123', [], {
          cursor: firstPage.nextCursor,
          limit: 1
        })
      ).rejects.toThrow('does not match the current query and catalog')
    })

    it('reports current-message active skills without pinning them', async () => {
      ;(mockSkillService.getActiveSkills as Mock).mockResolvedValue([])
      ;(mockSkillService.getMetadataList as Mock).mockResolvedValue([mockSkillMetadata[0]])

      const result = await skillTools.handleSkillList('conv-123', ['git-commit'])

      expect(result.totalCount).toBe(2)
      expect(result.pinnedCount).toBe(0)
      expect(result.activeCount).toBe(1)
      expect(result.skills.find((skill) => skill.name === 'git-commit')).toEqual(
        expect.objectContaining({ isPinned: false, active: true })
      )
      expect(mockSkillService.getAllSkills).toHaveBeenCalledOnce()
    })

    it('keeps plugin-owned skills available through the Agent catalog', async () => {
      ;(mockSkillService.getMetadataList as Mock).mockResolvedValue([
        {
          name: 'plugin-skill',
          description: 'Plugin skill',
          path: '/plugins/fixture/SKILL.md',
          skillRoot: '/plugins/fixture',
          ownerPluginId: 'com.deepchat.plugins.fixture'
        }
      ])

      const result = await skillTools.handleSkillList('conv-123')

      expect(result.skills.map((skill) => skill.name)).toEqual(['plugin-skill'])
    })

    it('finds skills omitted from the first page through deterministic search', async () => {
      const firstPage = await skillTools.handleSkillList('conv-123', [], { limit: 1 })

      expect(firstPage.skills).toHaveLength(1)
      expect(firstPage.nextCursor).toBeTypeOf('string')
      expect(firstPage.omittedCount).toBe(1)

      const searched = await skillTools.handleSkillList('conv-123', [], {
        query: 'commit',
        limit: 1
      })
      expect(searched.skills.map((skill) => skill.name)).toEqual(['git-commit'])
      expect(searched.totalMatched).toBe(1)
    })

    it('rejects a cursor after the searchable catalog changes', async () => {
      const firstPage = await skillTools.handleSkillList('conv-123', [], { limit: 1 })
      ;(mockSkillService.getMetadataList as Mock).mockResolvedValue([
        ...mockSkillMetadata,
        {
          name: 'new-skill',
          description: 'New skill',
          path: '/skills/new-skill/SKILL.md',
          skillRoot: '/skills/new-skill'
        }
      ])

      await expect(
        skillTools.handleSkillList('conv-123', [], {
          cursor: firstPage.nextCursor,
          limit: 1
        })
      ).rejects.toThrow('does not match the current query and catalog')
    })
  })

  describe('handleSkillView', () => {
    it('passes the Run Skill snapshot through to the presenter', async () => {
      const result = await skillTools.handleSkillView(
        'conv-123',
        {
          name: ' code-review ',
          file_path: 'references/checklist.md'
        },
        ['code-review']
      )

      expect(mockSkillService.viewSkillForAgent).toHaveBeenCalledWith('deepchat', 'code-review', {
        filePath: 'references/checklist.md',
        conversationId: 'conv-123',
        activeSkillNames: ['code-review']
      })
      expect(result).toEqual(
        expect.objectContaining({
          success: true,
          name: 'code-review'
        })
      )
    })
  })

  describe('handleSkillManage', () => {
    it('rejects draft management without a conversation context', async () => {
      const request: SkillManageRequest = {
        action: 'create',
        content: '---\nname: draft-skill\ndescription: Draft\n---\n\n# Draft'
      }

      const result = await skillTools.handleSkillManage(undefined, request)

      expect(result).toEqual({
        success: false,
        action: 'create',
        error: 'No conversation context available for skill_manage'
      })
      expect(mockSkillService.manageDraftSkill).not.toHaveBeenCalled()
    })

    it('delegates draft operations to the presenter', async () => {
      const request: SkillManageRequest = {
        action: 'write_file',
        draftId: 'draft-abc123',
        filePath: 'references/checklist.md',
        fileContent: '# Checklist'
      }

      await skillTools.handleSkillManage('conv-123', request)

      expect(mockSkillService.manageDraftSkill).toHaveBeenCalledWith('conv-123', request)
    })
  })
})
