import type { ProviderSettingsPort } from '@/provider/settings'
import { describe, expect, it, vi } from 'vitest'
import fs from 'fs'

import type { DeepChatAgentInstance } from '@/agent/deepchat/instance/deepChatAgentInstance'
import { buildSystemPromptWithSkills } from '@/agent/deepchat/resources/systemPromptBuilder'

describe('DeepChat system prompt builder', () => {
  it('assembles and caches the prompt without constructing the runtime presenter', async () => {
    vi.mocked(fs.existsSync).mockReturnValue(false)
    vi.mocked(fs.promises.readFile).mockRejectedValue(
      Object.assign(new Error('missing'), { code: 'ENOENT' })
    )
    let cache: { prompt: string; dayKey: string; fingerprint: string } | undefined
    const instance = {
      getRuntimeState: () => ({ providerId: 'openai', modelId: 'gpt-4o' }),
      hasProjectDir: () => true,
      getProjectDir: () => '/tmp/deepchat-system-prompt-builder-test-no-agents',
      getSystemPromptCache: () => cache,
      setSystemPromptCache: (next: typeof cache) => {
        cache = next
      }
    } as unknown as DeepChatAgentInstance
    const assertCurrent = vi.fn()
    const dependencies = {
      providerSettings: {
      } as unknown as ProviderSettingsPort,
      skillSettings: {
        isEnabled: () => false,
        isDraftSuggestionsEnabled: () => false
      },
      providerCatalogPort: {
        getProviderModels: () => [{ id: 'gpt-4o', name: 'GPT-4o' }],
        getCustomModels: () => []
      },
      skillService: {
        getMetadataList: vi.fn().mockResolvedValue([]),
        getActiveSkills: vi.fn().mockResolvedValue([]),
        loadSkillContent: vi.fn(),
        resolveSessionAgentId: vi.fn().mockResolvedValue('deepchat')
      },
      toolService: {
        buildToolSystemPrompt: vi.fn().mockReturnValue('')
      },
      assertCurrent,
      isAcpBackedSubagentSession: () => false,
      resolveProjectDir: () => null,
      logSlowStep: vi.fn()
    }

    const first = await buildSystemPromptWithSkills(dependencies, {
      sessionId: 'session-1',
      basePrompt: '  BASE PROMPT  ',
      toolDefinitions: [],
      resourceInstance: instance
    })
    const second = await buildSystemPromptWithSkills(dependencies, {
      sessionId: 'session-1',
      basePrompt: '  BASE PROMPT  ',
      toolDefinitions: [],
      resourceInstance: instance
    })

    expect(first).toContain('BASE PROMPT')
    expect(first).toContain('You are powered by the model named GPT-4o.')
    expect(first).toContain('## Verification Policy')
    expect(second).toBe(first)
    expect(cache?.prompt).toBe(first)
    expect(assertCurrent).toHaveBeenCalled()
  })

  it('uses every active Skill from the scoped catalog', async () => {
    vi.mocked(fs.existsSync).mockReturnValue(false)
    vi.mocked(fs.promises.readFile).mockRejectedValue(
      Object.assign(new Error('missing'), { code: 'ENOENT' })
    )
    const instance = {
      getRuntimeState: () => ({ providerId: 'openai', modelId: 'gpt-4o' }),
      hasProjectDir: () => false,
      getSystemPromptCache: () => undefined,
      setSystemPromptCache: vi.fn()
    } as unknown as DeepChatAgentInstance
    const loadSkillContent = vi.fn(async (_agentId: string, skillName: string) => ({
      name: skillName,
      content: `${skillName} instructions`
    }))

    const prompt = await buildSystemPromptWithSkills(
      {
        providerSettings: {} as unknown as ProviderSettingsPort,
        skillSettings: {
          isEnabled: () => true,
          isDraftSuggestionsEnabled: () => false
        },
        providerCatalogPort: {
          getProviderModels: () => [{ id: 'gpt-4o', name: 'GPT-4o' }],
          getCustomModels: () => []
        },
        skillService: {
          resolveSessionAgentId: vi.fn().mockResolvedValue('writer'),
          getMetadataList: vi.fn().mockResolvedValue([
            { name: 'skill-a', description: 'Skill A' },
            { name: 'skill-b', description: 'Skill B' }
          ]),
          getActiveSkills: vi.fn().mockResolvedValue(['skill-a', 'skill-b']),
          loadSkillContent
        },
        toolService: { buildToolSystemPrompt: vi.fn().mockReturnValue('') },
        assertCurrent: vi.fn(),
        isAcpBackedSubagentSession: () => false,
        resolveProjectDir: () => null,
        logSlowStep: vi.fn()
      },
      {
        sessionId: 'session-1',
        basePrompt: '',
        toolDefinitions: [],
        activeSkillNamesOverride: ['skill-a', 'skill-b'],
        resourceInstance: instance
      }
    )

    expect(prompt).toContain('### skill-a')
    expect(prompt).toContain('### skill-b')
    expect(loadSkillContent).toHaveBeenCalledWith('writer', 'skill-b')
  })
})
