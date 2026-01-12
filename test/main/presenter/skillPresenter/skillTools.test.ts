import { describe, it, expect, beforeEach, vi, Mock } from 'vitest'
import { SkillTools } from '../../../../src/main/presenter/skillPresenter/skillTools'
import type { ISkillPresenter, SkillMetadata } from '../../../../src/shared/types/skill'

describe('SkillTools', () => {
  let skillTools: SkillTools
  let mockSkillPresenter: ISkillPresenter

  const mockSkillMetadata: SkillMetadata[] = [
    {
      name: 'code-review',
      description: 'Code review assistant',
      path: '/skills/code-review/SKILL.md',
      skillRoot: '/skills/code-review',
      allowedTools: ['read_file', 'list_files']
    },
    {
      name: 'git-commit',
      description: 'Git commit message generator',
      path: '/skills/git-commit/SKILL.md',
      skillRoot: '/skills/git-commit',
      allowedTools: ['run_terminal_cmd']
    },
    {
      name: 'documentation',
      description: 'Documentation writer',
      path: '/skills/documentation/SKILL.md',
      skillRoot: '/skills/documentation'
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
      installBuiltinSkills: vi.fn().mockResolvedValue(undefined),
      installFromFolder: vi.fn().mockResolvedValue({ success: true, skillName: 'test' }),
      installFromZip: vi.fn().mockResolvedValue({ success: true, skillName: 'test' }),
      installFromUrl: vi.fn().mockResolvedValue({ success: true, skillName: 'test' }),
      uninstallSkill: vi.fn().mockResolvedValue({ success: true, skillName: 'test' }),
      updateSkillFile: vi.fn().mockResolvedValue({ success: true }),
      getSkillFolderTree: vi.fn().mockResolvedValue([]),
      openSkillsFolder: vi.fn().mockResolvedValue(undefined),
      getActiveSkills: vi.fn().mockResolvedValue([]),
      setActiveSkills: vi.fn().mockResolvedValue(undefined),
      validateSkillNames: vi.fn().mockImplementation((names: string[]) => {
        const available = new Set(mockSkillMetadata.map((s) => s.name))
        return Promise.resolve(names.filter((n) => available.has(n)))
      }),
      getActiveSkillsAllowedTools: vi.fn().mockResolvedValue([]),
      watchSkillFiles: vi.fn(),
      stopWatching: vi.fn()
    }

    skillTools = new SkillTools(mockSkillPresenter)
  })

  describe('handleSkillList', () => {
    it('should return all skills with inactive status when no conversationId', async () => {
      const result = await skillTools.handleSkillList()

      expect(result.skills).toHaveLength(3)
      expect(result.activeCount).toBe(0)
      expect(result.totalCount).toBe(3)
      expect(result.skills.every((s) => s.active === false)).toBe(true)
    })

    it('should return all skills with inactive status when no active skills', async () => {
      ;(mockSkillPresenter.getActiveSkills as Mock).mockResolvedValue([])

      const result = await skillTools.handleSkillList('conv-123')

      expect(result.skills).toHaveLength(3)
      expect(result.activeCount).toBe(0)
      expect(result.totalCount).toBe(3)
      expect(result.skills.every((s) => s.active === false)).toBe(true)
    })

    it('should mark active skills correctly', async () => {
      ;(mockSkillPresenter.getActiveSkills as Mock).mockResolvedValue(['code-review', 'git-commit'])

      const result = await skillTools.handleSkillList('conv-123')

      expect(result.skills).toHaveLength(3)
      expect(result.activeCount).toBe(2)
      expect(result.totalCount).toBe(3)

      const codeReview = result.skills.find((s) => s.name === 'code-review')
      const gitCommit = result.skills.find((s) => s.name === 'git-commit')
      const documentation = result.skills.find((s) => s.name === 'documentation')

      expect(codeReview?.active).toBe(true)
      expect(gitCommit?.active).toBe(true)
      expect(documentation?.active).toBe(false)
    })

    it('should include skill descriptions', async () => {
      const result = await skillTools.handleSkillList()

      expect(result.skills[0].description).toBe('Code review assistant')
      expect(result.skills[1].description).toBe('Git commit message generator')
      expect(result.skills[2].description).toBe('Documentation writer')
    })

    it('should return empty list when no skills available', async () => {
      ;(mockSkillPresenter.getMetadataList as Mock).mockResolvedValue([])

      const result = await skillTools.handleSkillList('conv-123')

      expect(result.skills).toHaveLength(0)
      expect(result.activeCount).toBe(0)
      expect(result.totalCount).toBe(0)
    })
  })

  describe('handleSkillControl', () => {
    describe('input validation', () => {
      it('should fail when no conversationId provided', async () => {
        const result = await skillTools.handleSkillControl(undefined, 'activate', ['code-review'])

        expect(result.success).toBe(false)
        expect(result.error).toContain('No conversation context')
      })

      it('should fail when empty skill names provided', async () => {
        const result = await skillTools.handleSkillControl('conv-123', 'activate', [])

        expect(result.success).toBe(false)
        expect(result.error).toContain('No skill names provided')
      })
    })

    describe('activate action', () => {
      it('should activate a single skill', async () => {
        ;(mockSkillPresenter.getActiveSkills as Mock).mockResolvedValue([])

        const result = await skillTools.handleSkillControl('conv-123', 'activate', ['code-review'])

        expect(result.success).toBe(true)
        expect(result.action).toBe('activate')
        expect(result.affectedSkills).toContain('code-review')
        expect(result.activeSkills).toContain('code-review')
        expect(mockSkillPresenter.setActiveSkills).toHaveBeenCalledWith(
          'conv-123',
          expect.arrayContaining(['code-review'])
        )
      })

      it('should activate multiple skills', async () => {
        ;(mockSkillPresenter.getActiveSkills as Mock).mockResolvedValue([])

        const result = await skillTools.handleSkillControl('conv-123', 'activate', [
          'code-review',
          'git-commit'
        ])

        expect(result.success).toBe(true)
        expect(result.affectedSkills).toContain('code-review')
        expect(result.affectedSkills).toContain('git-commit')
        expect(result.activeSkills).toHaveLength(2)
      })

      it('should add to existing active skills', async () => {
        ;(mockSkillPresenter.getActiveSkills as Mock).mockResolvedValue(['documentation'])

        const result = await skillTools.handleSkillControl('conv-123', 'activate', ['code-review'])

        expect(result.success).toBe(true)
        expect(result.activeSkills).toContain('documentation')
        expect(result.activeSkills).toContain('code-review')
      })

      it('should not duplicate already active skills', async () => {
        ;(mockSkillPresenter.getActiveSkills as Mock).mockResolvedValue(['code-review'])

        const result = await skillTools.handleSkillControl('conv-123', 'activate', ['code-review'])

        expect(result.success).toBe(true)
        expect(result.activeSkills?.filter((s) => s === 'code-review')).toHaveLength(1)
      })

      it('should validate skill names before activation', async () => {
        ;(mockSkillPresenter.getActiveSkills as Mock).mockResolvedValue([])
        ;(mockSkillPresenter.validateSkillNames as Mock).mockResolvedValue(['code-review'])

        const result = await skillTools.handleSkillControl('conv-123', 'activate', [
          'code-review',
          'invalid-skill'
        ])

        expect(result.success).toBe(true)
        expect(result.affectedSkills).toEqual(['code-review'])
        expect(result.activeSkills).toEqual(['code-review'])
      })
    })

    describe('deactivate action', () => {
      it('should deactivate a single skill', async () => {
        ;(mockSkillPresenter.getActiveSkills as Mock).mockResolvedValue([
          'code-review',
          'git-commit'
        ])

        const result = await skillTools.handleSkillControl('conv-123', 'deactivate', [
          'code-review'
        ])

        expect(result.success).toBe(true)
        expect(result.action).toBe('deactivate')
        expect(result.affectedSkills).toContain('code-review')
        expect(result.activeSkills).not.toContain('code-review')
        expect(result.activeSkills).toContain('git-commit')
      })

      it('should deactivate multiple skills', async () => {
        ;(mockSkillPresenter.getActiveSkills as Mock).mockResolvedValue([
          'code-review',
          'git-commit',
          'documentation'
        ])

        const result = await skillTools.handleSkillControl('conv-123', 'deactivate', [
          'code-review',
          'git-commit'
        ])

        expect(result.success).toBe(true)
        expect(result.activeSkills).toEqual(['documentation'])
      })

      it('should handle deactivating non-active skill gracefully', async () => {
        ;(mockSkillPresenter.getActiveSkills as Mock).mockResolvedValue(['git-commit'])

        const result = await skillTools.handleSkillControl('conv-123', 'deactivate', [
          'code-review'
        ])

        expect(result.success).toBe(true)
        expect(result.activeSkills).toEqual(['git-commit'])
      })

      it('should handle deactivating all skills', async () => {
        ;(mockSkillPresenter.getActiveSkills as Mock).mockResolvedValue([
          'code-review',
          'git-commit'
        ])

        const result = await skillTools.handleSkillControl('conv-123', 'deactivate', [
          'code-review',
          'git-commit'
        ])

        expect(result.success).toBe(true)
        expect(result.activeSkills).toEqual([])
      })

      it('should not validate skill names for deactivation', async () => {
        ;(mockSkillPresenter.getActiveSkills as Mock).mockResolvedValue(['code-review'])

        // Even invalid skills should be in affectedSkills for deactivate
        const result = await skillTools.handleSkillControl('conv-123', 'deactivate', [
          'code-review',
          'deleted-skill'
        ])

        expect(result.success).toBe(true)
        expect(result.affectedSkills).toContain('code-review')
        expect(result.affectedSkills).toContain('deleted-skill')
      })
    })

    describe('setActiveSkills integration', () => {
      it('should call setActiveSkills with correct conversation ID', async () => {
        ;(mockSkillPresenter.getActiveSkills as Mock).mockResolvedValue([])

        await skillTools.handleSkillControl('conv-456', 'activate', ['code-review'])

        expect(mockSkillPresenter.setActiveSkills).toHaveBeenCalledWith(
          'conv-456',
          expect.any(Array)
        )
      })

      it('should call setActiveSkills with final active skills list', async () => {
        ;(mockSkillPresenter.getActiveSkills as Mock).mockResolvedValue(['git-commit'])

        await skillTools.handleSkillControl('conv-123', 'activate', ['code-review'])

        expect(mockSkillPresenter.setActiveSkills).toHaveBeenCalledWith(
          'conv-123',
          expect.arrayContaining(['git-commit', 'code-review'])
        )
      })
    })
  })

  describe('edge cases', () => {
    it('should handle skill list with special characters in names', async () => {
      const specialSkills: SkillMetadata[] = [
        {
          name: 'skill_with_underscore',
          description: 'Test',
          path: '/skills/skill_with_underscore/SKILL.md',
          skillRoot: '/skills/skill_with_underscore'
        },
        {
          name: 'skill-with-dash',
          description: 'Test',
          path: '/skills/skill-with-dash/SKILL.md',
          skillRoot: '/skills/skill-with-dash'
        }
      ]
      ;(mockSkillPresenter.getMetadataList as Mock).mockResolvedValue(specialSkills)
      ;(mockSkillPresenter.getActiveSkills as Mock).mockResolvedValue(['skill_with_underscore'])
      ;(mockSkillPresenter.validateSkillNames as Mock).mockImplementation((names: string[]) => {
        const available = new Set(specialSkills.map((s) => s.name))
        return Promise.resolve(names.filter((n) => available.has(n)))
      })

      const listResult = await skillTools.handleSkillList('conv-123')

      expect(listResult.skills).toHaveLength(2)
      expect(listResult.skills.find((s) => s.name === 'skill_with_underscore')?.active).toBe(true)
    })

    it('should handle rapid activate/deactivate operations', async () => {
      let currentActive: string[] = []
      ;(mockSkillPresenter.getActiveSkills as Mock).mockImplementation(() =>
        Promise.resolve([...currentActive])
      )
      ;(mockSkillPresenter.setActiveSkills as Mock).mockImplementation(
        (_id: string, skills: string[]) => {
          currentActive = [...skills]
          return Promise.resolve()
        }
      )

      // Activate
      await skillTools.handleSkillControl('conv-123', 'activate', ['code-review'])
      expect(currentActive).toContain('code-review')

      // Deactivate
      await skillTools.handleSkillControl('conv-123', 'deactivate', ['code-review'])
      expect(currentActive).not.toContain('code-review')

      // Activate multiple
      await skillTools.handleSkillControl('conv-123', 'activate', ['code-review', 'git-commit'])
      expect(currentActive).toContain('code-review')
      expect(currentActive).toContain('git-commit')
    })

    it('should handle empty metadata list gracefully', async () => {
      ;(mockSkillPresenter.getMetadataList as Mock).mockResolvedValue([])
      ;(mockSkillPresenter.getActiveSkills as Mock).mockResolvedValue([])
      ;(mockSkillPresenter.validateSkillNames as Mock).mockResolvedValue([])

      const listResult = await skillTools.handleSkillList('conv-123')
      expect(listResult.skills).toEqual([])
      expect(listResult.totalCount).toBe(0)

      const controlResult = await skillTools.handleSkillControl('conv-123', 'activate', [
        'nonexistent'
      ])
      expect(controlResult.success).toBe(true)
      expect(controlResult.affectedSkills).toEqual([])
    })
  })
})
