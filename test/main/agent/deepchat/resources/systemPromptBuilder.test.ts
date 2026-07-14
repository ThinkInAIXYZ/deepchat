import { describe, expect, it, vi } from 'vitest'
import fs from 'fs'
import type { IConfigPresenter } from '@shared/presenter'
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
      configPresenter: {
        getSkillsEnabled: () => false,
        getSkillDraftSuggestionsEnabled: () => false
      } as unknown as IConfigPresenter,
      providerCatalogPort: {
        getProviderModels: () => [{ id: 'gpt-4o', name: 'GPT-4o' }],
        getCustomModels: () => []
      },
      toolPresenter: null,
      assertCurrent,
      isAcpBackedSubagentSession: () => false,
      resolveProjectDir: () => null,
      resolveAgentExtensionPolicy: vi.fn().mockResolvedValue({}),
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
})
