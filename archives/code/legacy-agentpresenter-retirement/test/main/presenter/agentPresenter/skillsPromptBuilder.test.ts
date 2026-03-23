import { describe, expect, it, vi } from 'vitest'
import {
  buildSkillsMetadataPrompt,
  buildSkillsPrompt,
  getSkillsAllowedTools
} from '@/presenter/agentPresenter/message/skillsPromptBuilder'

describe('skillsPromptBuilder', () => {
  it('returns empty outputs when skills are disabled', async () => {
    const promptRuntime = {
      getSkillsEnabled: vi.fn().mockReturnValue(false),
      getMetadataPrompt: vi.fn(),
      getActiveSkills: vi.fn(),
      loadSkillContent: vi.fn(),
      getActiveSkillsAllowedTools: vi.fn()
    } as any

    await expect(buildSkillsMetadataPrompt(promptRuntime)).resolves.toBe('')
    await expect(buildSkillsPrompt(promptRuntime, 'conv-1')).resolves.toBe('')
    await expect(getSkillsAllowedTools(promptRuntime, 'conv-1')).resolves.toEqual([])
    expect(promptRuntime.getMetadataPrompt).not.toHaveBeenCalled()
    expect(promptRuntime.getActiveSkills).not.toHaveBeenCalled()
  })

  it('builds metadata, active skill prompt, and allowed tools from prompt runtime', async () => {
    const promptRuntime = {
      getSkillsEnabled: vi.fn().mockReturnValue(true),
      getMetadataPrompt: vi.fn().mockResolvedValue('# Metadata'),
      getActiveSkills: vi.fn().mockResolvedValue(['ocr', 'coder']),
      loadSkillContent: vi.fn(async (name: string) =>
        name === 'ocr'
          ? { name: 'ocr', content: 'OCR content' }
          : { name: 'coder', content: 'Coder content' }
      ),
      getActiveSkillsAllowedTools: vi.fn().mockResolvedValue(['read', 'grep'])
    } as any

    await expect(buildSkillsMetadataPrompt(promptRuntime)).resolves.toBe('# Metadata')
    const prompt = await buildSkillsPrompt(promptRuntime, 'conv-1')
    expect(prompt).toContain('## Skill: ocr')
    expect(prompt).toContain('Coder content')
    await expect(getSkillsAllowedTools(promptRuntime, 'conv-1')).resolves.toEqual(['read', 'grep'])
  })

  it('returns empty active skill prompt when no skill content can be loaded', async () => {
    const promptRuntime = {
      getSkillsEnabled: vi.fn().mockReturnValue(true),
      getActiveSkills: vi.fn().mockResolvedValue(['ocr']),
      loadSkillContent: vi.fn().mockResolvedValue(null)
    } as any

    await expect(buildSkillsPrompt(promptRuntime, 'conv-1')).resolves.toBe('')
  })
})
