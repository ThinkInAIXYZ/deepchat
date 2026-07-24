import type { ProviderSettingsPort } from '@/provider/settings'
import { describe, expect, it, vi } from 'vitest'
import fs from 'fs'

import type { DeepChatAgentInstance } from '@/agent/deepchat/instance/deepChatAgentInstance'
import { buildSystemPromptWithSkills } from '@/agent/deepchat/resources/systemPromptBuilder'

describe('DeepChat system prompt builder', () => {
  it('assembles byte-identical prompts without a composed-prompt memo', async () => {
    vi.mocked(fs.existsSync).mockReturnValue(false)
    vi.mocked(fs.promises.readFile).mockRejectedValue(
      Object.assign(new Error('missing'), { code: 'ENOENT' })
    )
    const instance = {
      getRuntimeState: () => ({ providerId: 'openai', modelId: 'gpt-4o' }),
      hasProjectDir: () => true,
      getProjectDir: () => '/tmp/deepchat-system-prompt-builder-test-no-agents'
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
    expect(assertCurrent).toHaveBeenCalled()
  })

  it('uses every active Skill from the scoped catalog', async () => {
    vi.mocked(fs.existsSync).mockReturnValue(false)
    vi.mocked(fs.promises.readFile).mockRejectedValue(
      Object.assign(new Error('missing'), { code: 'ENOENT' })
    )
    const instance = {
      getRuntimeState: () => ({ providerId: 'openai', modelId: 'gpt-4o' }),
      hasProjectDir: () => false
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

  it('observes model, tool prompt, and package script changes on the next assembly', async () => {
    let modelName = 'Model One'
    let toolPrompt = 'TOOL PROMPT ONE'
    let packageJson = JSON.stringify({
      name: 'example',
      scripts: { verify: 'vitest run' }
    })
    vi.mocked(fs.existsSync).mockImplementation((filePath) =>
      String(filePath).endsWith('package.json')
    )
    vi.mocked(fs.readFileSync).mockImplementation(() => packageJson)
    vi.mocked(fs.promises.readFile).mockRejectedValue(
      Object.assign(new Error('missing'), { code: 'ENOENT' })
    )
    const instance = {
      getRuntimeState: () => ({ providerId: 'openai', modelId: 'dynamic-model' }),
      hasProjectDir: () => true,
      getProjectDir: () => '/tmp/dynamic-system-prompt'
    } as unknown as DeepChatAgentInstance
    const dependencies = {
      providerSettings: {} as unknown as ProviderSettingsPort,
      skillSettings: {
        isEnabled: () => false,
        isDraftSuggestionsEnabled: () => false
      },
      providerCatalogPort: {
        getProviderModels: () => [{ id: 'dynamic-model', name: modelName }],
        getCustomModels: () => []
      },
      skillService: {
        getMetadataList: vi.fn().mockResolvedValue([]),
        getActiveSkills: vi.fn().mockResolvedValue([]),
        loadSkillContent: vi.fn(),
        resolveSessionAgentId: vi.fn().mockResolvedValue('deepchat')
      },
      toolService: {
        buildToolSystemPrompt: vi.fn(() => toolPrompt)
      },
      assertCurrent: vi.fn(),
      isAcpBackedSubagentSession: () => false,
      resolveProjectDir: () => null,
      logSlowStep: vi.fn()
    }
    const input = {
      sessionId: 'session-1',
      basePrompt: 'Base',
      toolDefinitions: [],
      resourceInstance: instance
    }

    const first = await buildSystemPromptWithSkills(dependencies, input)
    modelName = 'Model Two'
    toolPrompt = 'TOOL PROMPT TWO'
    packageJson = JSON.stringify({
      name: 'example',
      scripts: { check: 'tsgo --noEmit' }
    })
    const second = await buildSystemPromptWithSkills(dependencies, input)

    expect(first).toContain('Model One')
    expect(first).toContain('TOOL PROMPT ONE')
    expect(first).toContain('`verify`')
    expect(second).toContain('Model Two')
    expect(second).toContain('TOOL PROMPT TWO')
    expect(second).toContain('`check`')
    expect(second).not.toContain('TOOL PROMPT ONE')
    expect(second).not.toContain('`verify`')
    expect(fs.readFileSync).toHaveBeenCalledTimes(2)
  })
})
