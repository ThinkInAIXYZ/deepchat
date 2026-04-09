import { beforeEach, describe, expect, it, vi, type Mock } from 'vitest'
import { SkillTools } from '../../../../src/main/presenter/skillPresenter/skillTools'
import type {
  ISkillPresenter,
  SkillExtensionConfig,
  SkillManageRequest,
  SkillMetadata,
  SkillViewResult
} from '../../../../src/shared/types/skill'

describe('SkillTools', () => {
  let skillTools: SkillTools
  let mockSkillPresenter: ISkillPresenter

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

    mockSkillPresenter = {
      getSkillsDir: vi.fn().mockResolvedValue('/mock/skills'),
      discoverSkills: vi.fn().mockResolvedValue(mockSkillMetadata),
      getMetadataList: vi.fn().mockResolvedValue(mockSkillMetadata),
      getMetadataPrompt: vi.fn().mockResolvedValue('# Skills'),
      loadSkillContent: vi.fn().mockResolvedValue({ name: 'test', content: '# Test' }),
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
        draftPath: '/tmp/drafts/conv-123/123-code-review',
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
      setActiveSkills: vi.fn().mockResolvedValue(undefined),
      validateSkillNames: vi.fn().mockImplementation((names: string[]) => {
        const available = new Set(mockSkillMetadata.map((skill) => skill.name))
        return Promise.resolve(names.filter((name) => available.has(name)))
      }),
      getActiveSkillsAllowedTools: vi.fn().mockResolvedValue([]),
      watchSkillFiles: vi.fn(),
      stopWatching: vi.fn()
    } as unknown as ISkillPresenter

    skillTools = new SkillTools(mockSkillPresenter)
  })

  describe('handleSkillList', () => {
    it('returns metadata with pinned status when no conversation is provided', async () => {
      const result = await skillTools.handleSkillList()

      expect(result.totalCount).toBe(2)
      expect(result.pinnedCount).toBe(0)
      expect(result.activeCount).toBe(0)
      expect(result.skills).toEqual([
        expect.objectContaining({
          name: 'code-review',
          category: 'engineering',
          platforms: ['macos'],
          isPinned: false,
          active: false
        }),
        expect.objectContaining({
          name: 'git-commit',
          metadata: { tags: ['git'] },
          isPinned: false,
          active: false
        })
      ])
    })

    it('marks pinned skills for the current conversation', async () => {
      ;(mockSkillPresenter.getActiveSkills as Mock).mockResolvedValue(['git-commit'])

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
  })

  describe('handleSkillView', () => {
    it('passes file_path and conversationId through to the presenter', async () => {
      const result = await skillTools.handleSkillView('conv-123', {
        name: 'code-review',
        file_path: 'references/checklist.md'
      })

      expect(mockSkillPresenter.viewSkill).toHaveBeenCalledWith('code-review', {
        filePath: 'references/checklist.md',
        conversationId: 'conv-123'
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
      expect(mockSkillPresenter.manageDraftSkill).not.toHaveBeenCalled()
    })

    it('delegates draft operations to the presenter', async () => {
      const request: SkillManageRequest = {
        action: 'write_file',
        draftPath: '/tmp/drafts/conv-123/123-code-review',
        filePath: 'references/checklist.md',
        fileContent: '# Checklist'
      }

      await skillTools.handleSkillManage('conv-123', request)

      expect(mockSkillPresenter.manageDraftSkill).toHaveBeenCalledWith('conv-123', request)
    })
  })
})
