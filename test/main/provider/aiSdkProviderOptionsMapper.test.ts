import { beforeEach, describe, expect, it, vi } from 'vitest'

const { mockGetModel, mockGetReasoningPortrait } = vi.hoisted(() => ({
  mockGetModel: vi.fn().mockReturnValue(undefined),
  mockGetReasoningPortrait: vi.fn().mockReturnValue(null)
}))

vi.mock('@/provider/providerDbLoader', () => ({
  providerDbLoader: {
    getModel: mockGetModel,
    subscribeCatalogChanges: vi.fn()
  }
}))

import {
  buildProviderOptions as buildProviderOptionsImpl,
  type BuildProviderOptionsParams
} from '@/provider/aiSdk/providerOptionsMapper'
import { OPENAI_COMPATIBLE_PROMPT_CACHE_MARKER } from '@/provider/promptCacheStrategy'
import { resolveModelRequestPolicy } from '@shared/modelRequestPolicy'

type ProviderOptionsTestParams = Omit<
  BuildProviderOptionsParams,
  'requestPolicy' | 'reasoningPortrait'
> &
  Partial<Pick<BuildProviderOptionsParams, 'requestPolicy' | 'reasoningPortrait'>>

const buildProviderOptions = (params: ProviderOptionsTestParams) =>
  buildProviderOptionsImpl({
    ...params,
    requestPolicy:
      params.requestPolicy ??
      resolveModelRequestPolicy(params.providerId, params.modelId, params.modelConfig.reasoning),
    reasoningPortrait:
      params.reasoningPortrait !== undefined
        ? params.reasoningPortrait
        : mockGetReasoningPortrait(params.capabilityProviderId, params.modelId)
  })

describe('AI SDK provider options', () => {
  const baseModelConfig = {
    reasoning: true,
    reasoningEffort: 'high' as const,
    thinkingBudget: 2048,
    conversationId: 'conv-1'
  }

  beforeEach(() => {
    mockGetModel.mockReturnValue(undefined)
    mockGetReasoningPortrait.mockReturnValue(null)
  })

  it('limits OpenAI prompt cache keys to conversation requests', () => {
    const conversation = buildProviderOptions({
      providerId: 'openai',
      capabilityProviderId: 'openai',
      providerOptionsKey: 'openai',
      apiType: 'openai_chat',
      modelId: 'gpt-5',
      modelConfig: {
        conversationId: 'private-session-id'
      },
      tools: [],
      messages: [],
      cacheIntent: 'conversation'
    })
    const isolated = buildProviderOptions({
      providerId: 'openai',
      capabilityProviderId: 'openai',
      providerOptionsKey: 'openai',
      apiType: 'openai_chat',
      modelId: 'gpt-5',
      modelConfig: {
        conversationId: 'private-session-id'
      },
      tools: [],
      messages: [],
      cacheIntent: 'isolated'
    })

    expect(conversation.providerOptions?.openai.promptCacheKey).toMatch(
      /^deepchat:openai:gpt-5:[a-f0-9]{20}$/
    )
    expect(JSON.stringify(conversation.providerOptions)).not.toContain('private-session-id')
    expect(isolated.providerOptions).toBeUndefined()
  })

  it('limits Anthropic automatic cache control to conversation requests', () => {
    const baseParams = {
      providerId: 'anthropic',
      capabilityProviderId: 'anthropic',
      supportsOfficialAnthropicReasoning: true,
      providerOptionsKey: 'anthropic',
      apiType: 'anthropic' as const,
      modelId: 'claude-sonnet-4-5',
      modelConfig: {},
      tools: [],
      messages: []
    }

    const conversation = buildProviderOptions({
      ...baseParams,
      cacheIntent: 'conversation'
    })
    const isolated = buildProviderOptions({
      ...baseParams,
      cacheIntent: 'isolated'
    })

    expect(conversation.providerOptions?.anthropic).toMatchObject({
      cacheControl: {
        type: 'ephemeral'
      }
    })
    expect(isolated.providerOptions?.anthropic).not.toHaveProperty('cacheControl')
  })

  it.each([
    ['openrouter', 'anthropic/claude-sonnet-4'],
    ['zenmux', 'anthropic/claude-sonnet-4-5']
  ])('passes a private final-body cache marker for %s Claude routes', (providerId, modelId) => {
    const messages = [
      { role: 'system', content: 'stable system' },
      { role: 'user', content: [{ type: 'text', text: 'history' }] },
      { role: 'assistant', content: [{ type: 'text', text: 'stable reply' }] },
      { role: 'user', content: [{ type: 'text', text: 'latest question' }] }
    ] as any

    const result = buildProviderOptions({
      providerId,
      capabilityProviderId: 'anthropic',
      providerOptionsKey: providerId,
      apiType: 'openai_chat',
      modelId,
      modelConfig: {
        conversationId: 'private-session-id'
      },
      tools: [],
      messages,
      cacheIntent: 'conversation'
    })

    expect(result.messages).toBe(messages)
    expect(result.providerOptions?.[providerId]?.[OPENAI_COMPATIBLE_PROMPT_CACHE_MARKER]).toEqual(
      expect.objectContaining({
        version: 1,
        providerId,
        modelId,
        cacheKey: expect.stringMatching(new RegExp(`^deepchat:${providerId}:.*:[a-f0-9]{20}$`))
      })
    )
    expect(JSON.stringify(result.providerOptions)).not.toContain('private-session-id')
  })

  it.each([
    ['openrouter', 'anthropic/claude-sonnet-4'],
    ['zenmux', 'anthropic/claude-sonnet-4-5']
  ])('omits the private cache marker for isolated %s calls', (providerId, modelId) => {
    const result = buildProviderOptions({
      providerId,
      capabilityProviderId: 'anthropic',
      providerOptionsKey: providerId,
      apiType: 'openai_chat',
      modelId,
      modelConfig: {
        conversationId: 'private-session-id'
      },
      tools: [],
      messages: [],
      cacheIntent: 'isolated'
    })

    expect(result.providerOptions).toBeUndefined()
  })

  it('keeps OpenRouter router models out of explicit cache transport', () => {
    const result = buildProviderOptions({
      providerId: 'openrouter',
      capabilityProviderId: 'openrouter',
      providerOptionsKey: 'openrouter',
      apiType: 'openai_chat',
      modelId: 'openrouter/auto',
      modelConfig: {
        conversationId: 'private-session-id'
      },
      tools: [],
      messages: [],
      cacheIntent: 'conversation'
    })

    expect(result.providerOptions).toBeUndefined()
  })

  it('places Bedrock cache points on reusable history without mutating the input', () => {
    const messages = [
      { role: 'system', content: 'stable system' },
      { role: 'user', content: [{ type: 'text', text: 'history' }] },
      { role: 'assistant', content: [{ type: 'text', text: 'stable reply' }] },
      { role: 'user', content: [{ type: 'text', text: 'latest question' }] }
    ] as any

    const result = buildProviderOptions({
      providerId: 'aws-bedrock',
      capabilityProviderId: 'anthropic',
      providerOptionsKey: 'bedrock',
      apiType: 'bedrock',
      modelId: 'anthropic.claude-3-5-sonnet-20240620-v1:0',
      modelConfig: {},
      tools: [],
      messages,
      cacheIntent: 'conversation'
    })

    expect(result.messages[2]).toMatchObject({
      role: 'assistant',
      providerOptions: {
        bedrock: {
          cachePoint: {
            type: 'default'
          }
        }
      }
    })
    expect(messages[2]).not.toHaveProperty('providerOptions')
    expect(result.providerOptions?.anthropic).toBeUndefined()
  })

  it('keeps resumed Bedrock assistant content outside the cache point', () => {
    const messages = [
      { role: 'system', content: 'stable system' },
      { role: 'user', content: [{ type: 'text', text: 'earlier question' }] },
      { role: 'assistant', content: [{ type: 'text', text: 'stable reply' }] },
      { role: 'user', content: [{ type: 'text', text: 'active question' }] },
      { role: 'assistant', content: [{ type: 'text', text: 'partial reply' }] }
    ] as any

    const result = buildProviderOptions({
      providerId: 'aws-bedrock',
      capabilityProviderId: 'anthropic',
      providerOptionsKey: 'bedrock',
      apiType: 'bedrock',
      modelId: 'anthropic.claude-3-5-sonnet-20240620-v1:0',
      modelConfig: {},
      tools: [],
      messages,
      cacheIntent: 'conversation'
    })

    expect(result.messages[2]).toMatchObject({
      role: 'assistant',
      providerOptions: {
        bedrock: {
          cachePoint: {
            type: 'default'
          }
        }
      }
    })
    expect(result.messages[4]).not.toHaveProperty('providerOptions')
  })

  it('uses the leading Bedrock system message as the first-turn cache point', () => {
    const result = buildProviderOptions({
      providerId: 'aws-bedrock',
      capabilityProviderId: 'anthropic',
      providerOptionsKey: 'bedrock',
      apiType: 'bedrock',
      modelId: 'anthropic.claude-3-5-sonnet-20240620-v1:0',
      modelConfig: {},
      tools: [],
      messages: [
        { role: 'system', content: 'stable system' },
        { role: 'user', content: [{ type: 'text', text: 'latest question' }] }
      ] as any,
      cacheIntent: 'conversation'
    })

    expect(result.messages[0]).toMatchObject({
      role: 'system',
      providerOptions: {
        bedrock: {
          cachePoint: {
            type: 'default'
          }
        }
      }
    })
  })

  it('omits Bedrock cache points for isolated requests', () => {
    const result = buildProviderOptions({
      providerId: 'aws-bedrock',
      capabilityProviderId: 'anthropic',
      providerOptionsKey: 'bedrock',
      apiType: 'bedrock',
      modelId: 'anthropic.claude-3-5-sonnet-20240620-v1:0',
      modelConfig: {},
      tools: [],
      messages: [
        { role: 'system', content: 'stable system' },
        { role: 'user', content: [{ type: 'text', text: 'latest question' }] }
      ] as any,
      cacheIntent: 'isolated'
    })

    expect(result.messages.every((message) => message.providerOptions === undefined)).toBe(true)
  })

  it('maps Moonshot Kimi thinking state through providerOptions even when temperature is fixed', () => {
    const enabled = buildProviderOptions({
      providerId: 'moonshot',
      capabilityProviderId: 'moonshot',
      providerOptionsKey: 'openai',
      apiType: 'openai_chat',
      modelId: 'moonshotai/kimi-k2.6',
      modelConfig: {
        reasoning: true,
        temperature: 0.6
      } as any,
      tools: [],
      messages: []
    })

    expect(enabled.providerOptions?.openai).toMatchObject({
      thinking: {
        type: 'enabled'
      }
    })

    const disabled = buildProviderOptions({
      providerId: 'moonshot',
      capabilityProviderId: 'moonshot',
      providerOptionsKey: 'openai',
      apiType: 'openai_chat',
      modelId: 'moonshotai/kimi-k2.6',
      modelConfig: {
        reasoning: false,
        temperature: 1
      } as any,
      tools: [],
      messages: []
    })

    expect(disabled.providerOptions?.openai).toMatchObject({
      thinking: {
        type: 'disabled'
      }
    })
  })

  it('maps Kimi thinking state for transport-compatible proxy providers as well', () => {
    const result = buildProviderOptions({
      providerId: 'new-api',
      capabilityProviderId: 'new-api',
      providerOptionsKey: 'openai',
      apiType: 'openai_chat',
      modelId: 'kimi-k2.6',
      modelConfig: {
        reasoning: true,
        temperature: 1.4
      } as any,
      tools: [],
      messages: []
    })

    expect(result.providerOptions?.openai).toMatchObject({
      thinking: {
        type: 'enabled'
      }
    })
  })

  it('uses standard reasoning effort and omits legacy thinking for K3', () => {
    const result = buildProviderOptions({
      providerId: 'new-api',
      capabilityProviderId: 'moonshot',
      providerOptionsKey: 'newApi',
      apiType: 'openai_chat',
      modelId: 'kimi-k3',
      modelConfig: {
        reasoning: false,
        reasoningEffort: 'max',
        temperature: 0.6,
        topP: 0.8
      } as any,
      reasoningPortrait: {
        supported: true,
        defaultEnabled: true,
        mode: 'effort',
        effort: 'max',
        effortOptions: ['low', 'high', 'max']
      },
      tools: [],
      messages: []
    })

    expect(result.providerOptions?.newApi).toMatchObject({
      reasoningEffort: 'max'
    })
    expect(result.providerOptions?.newApi).not.toHaveProperty('thinking')
  })

  it('routes Ollama reasoning effort through OpenAI-compatible provider options', () => {
    const result = buildProviderOptions({
      providerId: 'ollama',
      capabilityProviderId: 'ollama',
      providerOptionsKey: 'ollama',
      apiType: 'openai_chat',
      modelId: 'qwen3:8b',
      modelConfig: {
        reasoning: true,
        reasoningEffort: 'high'
      } as any,
      tools: [],
      messages: []
    })

    expect(result.providerOptions?.ollama).toMatchObject({
      reasoningEffort: 'high'
    })
  })

  it('maps official anthropic adaptive reasoning controls when enabled', () => {
    mockGetReasoningPortrait.mockReturnValue({
      supported: true,
      defaultEnabled: false,
      mode: 'effort',
      effort: 'high',
      effortOptions: ['low', 'medium', 'high', 'xhigh', 'max'],
      visibility: 'omitted'
    })

    const result = buildProviderOptions({
      providerId: 'anthropic',
      capabilityProviderId: 'anthropic',
      supportsOfficialAnthropicReasoning: true,
      providerOptionsKey: 'anthropic',
      apiType: 'anthropic',
      modelId: 'claude-opus-4-7',
      modelConfig: {
        ...baseModelConfig,
        reasoning: true,
        reasoningEffort: 'max',
        reasoningVisibility: 'summarized'
      },
      tools: [],
      messages: []
    })

    expect(result.providerOptions?.anthropic).toMatchObject({
      toolStreaming: true,
      sendReasoning: true,
      effort: 'max',
      thinking: {
        type: 'adaptive',
        display: 'summarized'
      }
    })
  })

  it('maps new-api anthropic routes to official anthropic adaptive reasoning controls', () => {
    mockGetReasoningPortrait.mockReturnValue({
      supported: true,
      defaultEnabled: false,
      mode: 'effort',
      effort: 'high',
      effortOptions: ['low', 'medium', 'high', 'xhigh', 'max'],
      visibility: 'omitted'
    })

    const result = buildProviderOptions({
      providerId: 'new-api',
      capabilityProviderId: 'anthropic',
      supportsOfficialAnthropicReasoning: true,
      providerOptionsKey: 'anthropic',
      apiType: 'anthropic',
      modelId: 'claude-opus-4-7',
      modelConfig: {
        ...baseModelConfig,
        reasoning: true,
        reasoningEffort: 'max',
        reasoningVisibility: 'summarized'
      },
      tools: [],
      messages: []
    })

    expect(result.providerOptions?.anthropic).toMatchObject({
      toolStreaming: true,
      sendReasoning: true,
      effort: 'max',
      thinking: {
        type: 'adaptive',
        display: 'summarized'
      }
    })
  })

  it('omits adaptive anthropic controls for new-api anthropic routes when reasoning is disabled', () => {
    mockGetReasoningPortrait.mockReturnValue({
      supported: true,
      defaultEnabled: false,
      mode: 'effort',
      effort: 'high',
      effortOptions: ['low', 'medium', 'high', 'xhigh', 'max'],
      visibility: 'omitted'
    })

    const result = buildProviderOptions({
      providerId: 'new-api',
      capabilityProviderId: 'anthropic',
      supportsOfficialAnthropicReasoning: true,
      providerOptionsKey: 'anthropic',
      apiType: 'anthropic',
      modelId: 'claude-opus-4-7',
      modelConfig: {
        reasoning: false,
        reasoningEffort: 'max',
        reasoningVisibility: 'summarized'
      },
      tools: [],
      messages: []
    })

    expect(result.providerOptions?.anthropic).toMatchObject({
      toolStreaming: true
    })
    expect(result.providerOptions?.anthropic).not.toHaveProperty('sendReasoning')
    expect(result.providerOptions?.anthropic).not.toHaveProperty('effort')
    expect(result.providerOptions?.anthropic).not.toHaveProperty('thinking')
  })

  it('keeps transport-compatible anthropic providers off official anthropic adaptive reasoning controls', () => {
    mockGetReasoningPortrait.mockReturnValue({
      supported: true,
      defaultEnabled: false,
      mode: 'effort',
      effort: 'high',
      effortOptions: ['low', 'medium', 'high', 'xhigh', 'max'],
      visibility: 'omitted'
    })

    const result = buildProviderOptions({
      providerId: 'my-anthropic-proxy',
      capabilityProviderId: 'my-anthropic-proxy',
      supportsOfficialAnthropicReasoning: false,
      providerOptionsKey: 'anthropic',
      apiType: 'anthropic',
      modelId: 'claude-sonnet-4-5',
      modelConfig: {
        reasoning: true,
        reasoningEffort: 'xhigh' as const,
        reasoningVisibility: 'summarized',
        thinkingBudget: 4096
      },
      tools: [],
      messages: []
    })

    expect(result.providerOptions?.anthropic).toMatchObject({
      toolStreaming: false,
      thinking: {
        type: 'enabled',
        budgetTokens: 4096
      }
    })
    expect(result.providerOptions?.anthropic).not.toHaveProperty('sendReasoning')
    expect(result.providerOptions?.anthropic).not.toHaveProperty('effort')
  })

  it.each([
    ['minimax', 'minimax', 'MiniMax-M3'],
    ['minimax-cn', 'minimax-cn', 'MiniMax-M3'],
    ['minimax-global', 'minimax', 'minimax-m3'],
    ['minimax', 'minimax', 'MiniMaxAI/MiniMax-M3']
  ])(
    'maps MiniMax-M3 reasoning to Anthropic-compatible adaptive thinking for %s/%s/%s',
    (providerId, capabilityProviderId, modelId) => {
      mockGetReasoningPortrait.mockReturnValue({
        supported: true,
        defaultEnabled: true
      })

      const result = buildProviderOptions({
        providerId,
        capabilityProviderId,
        providerOptionsKey: 'anthropic',
        apiType: 'anthropic',
        modelId,
        modelConfig: {
          reasoning: true
        } as any,
        tools: [],
        messages: []
      })

      expect(result.providerOptions?.anthropic).toEqual({
        toolStreaming: false,
        thinking: {
          type: 'adaptive'
        }
      })
    }
  )

  it('does not send MiniMax-M3 adaptive thinking when reasoning is disabled', () => {
    mockGetReasoningPortrait.mockReturnValue({
      supported: true,
      defaultEnabled: true
    })

    const result = buildProviderOptions({
      providerId: 'minimax',
      capabilityProviderId: 'minimax',
      providerOptionsKey: 'anthropic',
      apiType: 'anthropic',
      modelId: 'MiniMax-M3',
      modelConfig: {
        reasoning: false
      } as any,
      tools: [],
      messages: []
    })

    expect(result.providerOptions?.anthropic).toEqual({
      toolStreaming: false
    })
  })

  it('maps aws bedrock reasoning through the bedrock namespace', () => {
    const result = buildProviderOptions({
      providerId: 'aws-bedrock',
      capabilityProviderId: 'anthropic',
      providerOptionsKey: 'bedrock',
      apiType: 'bedrock',
      modelId: 'anthropic.claude-3-5-sonnet-20240620-v1:0',
      modelConfig: {
        reasoning: true,
        reasoningEffort: 'xhigh',
        reasoningVisibility: 'summarized',
        thinkingBudget: 4096
      },
      tools: [],
      messages: []
    })

    expect(result.providerOptions).toEqual({
      bedrock: {
        reasoningConfig: {
          type: 'enabled',
          budgetTokens: 4096
        }
      }
    })
    expect(result.providerOptions?.bedrock).not.toHaveProperty('anthropic')
    expect(result.providerOptions?.bedrock).toMatchObject({
      reasoningConfig: {
        type: 'enabled',
        budgetTokens: 4096
      }
    })
  })

  it('does not emit anthropic official reasoning parameters for openrouter claude models', () => {
    const result = buildProviderOptions({
      providerId: 'openrouter',
      capabilityProviderId: 'anthropic',
      supportsOfficialAnthropicReasoning: true,
      providerOptionsKey: 'openai',
      apiType: 'openai_chat',
      modelId: 'anthropic/claude-sonnet-4',
      modelConfig: {
        reasoning: true
      },
      tools: [],
      messages: []
    })

    expect(result.providerOptions?.anthropic).toBeUndefined()
  })

  it('adds doubao thinking options through providerOptions instead of monkey-patching the sdk client', () => {
    mockGetModel.mockReturnValue({
      extra_capabilities: {
        reasoning: {
          notes: ['doubao-thinking-parameter']
        }
      }
    })

    const result = buildProviderOptions({
      providerId: 'doubao',
      capabilityProviderId: 'doubao',
      providerOptionsKey: 'openai',
      apiType: 'openai_chat',
      modelId: 'doubao-seed-2.0-pro',
      modelConfig: {
        reasoning: true
      },
      tools: [],
      messages: []
    })

    expect(result.providerOptions).toEqual({
      openai: {
        thinking: {
          type: 'enabled'
        }
      }
    })
  })

  it('adds siliconcloud thinking flags through providerOptions for supported models', () => {
    const result = buildProviderOptions({
      providerId: 'siliconcloud',
      capabilityProviderId: 'siliconcloud',
      providerOptionsKey: 'openai',
      apiType: 'openai_chat',
      modelId: 'Qwen/Qwen3-32B',
      modelConfig: {
        reasoning: true
      },
      tools: [],
      messages: []
    })

    expect(result.providerOptions).toEqual({
      openai: {
        enable_thinking: true
      }
    })
  })

  it('keeps an explicit DashScope thinking budget when the portrait is unresolved', () => {
    const result = buildProviderOptions({
      providerId: 'dashscope',
      capabilityProviderId: 'dashscope',
      providerOptionsKey: 'openai',
      apiType: 'openai_chat',
      modelId: 'custom-qwen-reasoning',
      modelConfig: {
        reasoning: true,
        thinkingBudget: 4096
      },
      reasoningPortrait: null,
      tools: [],
      messages: []
    })

    expect(result.providerOptions).toEqual({
      openai: {
        thinking_budget: 4096
      }
    })
  })

  it('uses supported DashScope portrait defaults for automatic thinking', () => {
    const result = buildProviderOptions({
      providerId: 'dashscope',
      capabilityProviderId: 'dashscope',
      providerOptionsKey: 'openai',
      apiType: 'openai_chat',
      modelId: 'qwen-plus',
      modelConfig: {
        reasoning: true
      },
      reasoningPortrait: {
        supported: true,
        defaultEnabled: true,
        mode: 'budget',
        budget: { default: 2048 }
      },
      tools: [],
      messages: []
    })

    expect(result.providerOptions).toEqual({
      openai: {
        enable_thinking: true,
        thinking_budget: 2048
      }
    })
  })

  it('does not send DashScope thinking options for an explicitly unsupported portrait', () => {
    const result = buildProviderOptions({
      providerId: 'dashscope',
      capabilityProviderId: 'dashscope',
      providerOptionsKey: 'openai',
      apiType: 'openai_chat',
      modelId: 'qwen-non-reasoning',
      modelConfig: {
        reasoning: true,
        thinkingBudget: 4096
      },
      reasoningPortrait: {
        supported: false
      },
      tools: [],
      messages: []
    })

    expect(result.providerOptions).toBeUndefined()
  })

  it('maps Grok Mini reasoning effort through the standard adapter option', () => {
    const result = buildProviderOptions({
      providerId: 'grok',
      capabilityProviderId: 'grok',
      providerOptionsKey: 'openai',
      apiType: 'openai_chat',
      modelId: 'grok-3-mini',
      modelConfig: {
        reasoningEffort: 'medium' as const
      },
      tools: [],
      messages: []
    })

    expect(result.providerOptions).toEqual({
      openai: {
        reasoningEffort: 'medium'
      }
    })
  })

  it.each(['grok-4', 'not-grok-3-mini'])(
    'does not add reasoning effort to unsupported Grok model %s',
    (modelId) => {
      const result = buildProviderOptions({
        providerId: 'grok',
        capabilityProviderId: 'grok',
        providerOptionsKey: 'openai',
        apiType: 'openai_chat',
        modelId,
        modelConfig: {
          reasoningEffort: 'high'
        },
        tools: [],
        messages: []
      })

      expect(result.providerOptions).toBeUndefined()
    }
  )

  it('passes through extended OpenAI reasoning effort values', () => {
    mockGetReasoningPortrait.mockReturnValue({
      supported: true,
      defaultEnabled: false,
      mode: 'effort',
      effort: 'none',
      effortOptions: ['none', 'low', 'medium', 'high', 'xhigh']
    })

    const result = buildProviderOptions({
      providerId: 'openai',
      capabilityProviderId: 'openai',
      providerOptionsKey: 'openai',
      apiType: 'openai_responses',
      modelId: 'gpt-5.2',
      modelConfig: {
        reasoningEffort: 'none' as const
      },
      tools: [],
      messages: []
    })

    expect(result.providerOptions).toEqual({
      openai: {
        reasoningEffort: 'none'
      }
    })
  })

  it('maps OpenAI Codex system prompts to Responses instructions', () => {
    const result = buildProviderOptions({
      providerId: 'openai-codex',
      capabilityProviderId: 'openai',
      providerOptionsKey: 'openai',
      apiType: 'openai_responses',
      modelId: 'gpt-5.5',
      modelConfig: {
        reasoning: true,
        reasoningEffort: 'high'
      } as any,
      tools: [],
      messages: [
        {
          role: 'system',
          content: 'Follow DeepChat instructions.'
        },
        {
          role: 'user',
          content: 'Hello'
        }
      ] as any
    })

    expect(result.providerOptions?.openai).toMatchObject({
      instructions: 'Follow DeepChat instructions.',
      reasoningEffort: 'high',
      store: false
    })
  })

  it('adds fallback instructions for OpenAI Codex requests without system prompts', () => {
    const result = buildProviderOptions({
      providerId: 'openai-codex',
      capabilityProviderId: 'openai',
      providerOptionsKey: 'openai',
      apiType: 'openai_responses',
      modelId: 'gpt-5.5',
      modelConfig: {},
      tools: [],
      messages: [
        {
          role: 'user',
          content: 'Hello'
        }
      ] as any
    })

    expect(result.providerOptions?.openai).toMatchObject({
      instructions: 'You are DeepChat, an AI assistant. Follow the user instructions.',
      store: false
    })
  })

  it('treats effort as the source of truth when the legacy reasoning boolean is stale', () => {
    mockGetReasoningPortrait.mockReturnValue({
      supported: true,
      defaultEnabled: false,
      mode: 'effort',
      effort: 'none',
      effortOptions: ['none', 'low', 'medium', 'high', 'xhigh']
    })

    const result = buildProviderOptions({
      providerId: 'openai',
      capabilityProviderId: 'openai',
      providerOptionsKey: 'openai',
      apiType: 'openai_responses',
      modelId: 'gpt-5.4',
      modelConfig: {
        reasoning: false,
        reasoningEffort: 'xhigh'
      },
      tools: [],
      messages: []
    })

    expect(result.providerOptions).toEqual({
      openai: {
        reasoningEffort: 'xhigh'
      }
    })
  })

  it('disables vertex function-call argument streaming when no tools are present', () => {
    const result = buildProviderOptions({
      providerId: 'vertex',
      capabilityProviderId: 'vertex',
      providerOptionsKey: 'vertex',
      apiType: 'vertex',
      modelId: 'gemini-2.5-flash',
      modelConfig: {},
      tools: [],
      messages: []
    })

    expect(result.providerOptions?.vertex).toMatchObject({
      streamFunctionCallArguments: false
    })
  })

  it('enables vertex function-call argument streaming when tools are present', () => {
    const result = buildProviderOptions({
      providerId: 'vertex',
      capabilityProviderId: 'vertex',
      providerOptionsKey: 'vertex',
      apiType: 'vertex',
      modelId: 'gemini-2.5-flash',
      modelConfig: {},
      tools: [
        {
          type: 'function',
          function: {
            name: 'skill_manage',
            description: 'Manage a skill',
            parameters: {
              type: 'object',
              properties: {
                name: {
                  type: 'string'
                }
              }
            }
          }
        }
      ] as any,
      messages: []
    })

    expect(result.providerOptions?.vertex).toMatchObject({
      streamFunctionCallArguments: true
    })
  })

  it('keeps azure responses options under the azure namespace without prompt cache keys', () => {
    const result = buildProviderOptions({
      providerId: 'azure-openai',
      capabilityProviderId: 'azure-openai',
      providerOptionsKey: 'azure',
      apiType: 'azure_responses',
      modelId: 'my-gpt-4.1-deployment',
      modelConfig: {
        reasoningEffort: 'medium' as const,
        verbosity: 'high' as const,
        maxCompletionTokens: 2048,
        conversationId: 'conv-1'
      },
      tools: [],
      messages: []
    })

    expect(result.providerOptions).toEqual({
      azure: {
        reasoningEffort: 'medium',
        textVerbosity: 'high',
        maxCompletionTokens: 2048
      }
    })
    expect(result.providerOptions?.azure).not.toHaveProperty('promptCacheKey')
  })

  it('passes through xhigh for azure responses models', () => {
    const result = buildProviderOptions({
      providerId: 'azure-openai',
      capabilityProviderId: 'azure-openai',
      providerOptionsKey: 'azure',
      apiType: 'azure_responses',
      modelId: 'my-gpt-5.4-pro-deployment',
      modelConfig: {
        reasoningEffort: 'xhigh' as const
      },
      tools: [],
      messages: []
    })

    expect(result.providerOptions).toEqual({
      azure: {
        reasoningEffort: 'xhigh'
      }
    })
  })

  it('does not send anthropic reasoning flags when the toggle-backed default is disabled', () => {
    mockGetReasoningPortrait.mockReturnValue({
      supported: true,
      defaultEnabled: false,
      mode: 'budget',
      budget: { min: 1024, default: 2048 }
    })

    const result = buildProviderOptions({
      providerId: 'anthropic',
      capabilityProviderId: 'anthropic',
      supportsOfficialAnthropicReasoning: true,
      providerOptionsKey: 'anthropic',
      apiType: 'anthropic',
      modelId: 'claude-4-sonnet',
      modelConfig: {
        reasoning: false,
        thinkingBudget: 2048
      },
      tools: [],
      messages: []
    })

    expect(result.providerOptions?.anthropic).toMatchObject({
      toolStreaming: true
    })
    expect(result.providerOptions?.anthropic).not.toHaveProperty('sendReasoning')
    expect(result.providerOptions?.anthropic).not.toHaveProperty('thinking')
  })

  it('ignores stale anthropic adaptive reasoning overrides when model reasoning is disabled', () => {
    mockGetReasoningPortrait.mockReturnValue({
      supported: true,
      defaultEnabled: false,
      mode: 'effort',
      effort: 'high',
      effortOptions: ['low', 'medium', 'high', 'xhigh', 'max'],
      visibility: 'omitted'
    })

    const result = buildProviderOptions({
      providerId: 'anthropic',
      capabilityProviderId: 'anthropic',
      supportsOfficialAnthropicReasoning: true,
      providerOptionsKey: 'anthropic',
      apiType: 'anthropic',
      modelId: 'claude-opus-4-7',
      modelConfig: {
        reasoning: false,
        reasoningEffort: 'max',
        reasoningVisibility: 'summarized'
      },
      tools: [],
      messages: []
    })

    expect(result.providerOptions?.anthropic).toMatchObject({
      toolStreaming: true
    })
    expect(result.providerOptions?.anthropic).not.toHaveProperty('sendReasoning')
    expect(result.providerOptions?.anthropic).not.toHaveProperty('effort')
    expect(result.providerOptions?.anthropic).not.toHaveProperty('thinking')
  })

  it('does not send vertex-only tool argument streaming to the google provider', () => {
    mockGetReasoningPortrait.mockReturnValue({
      supported: true,
      defaultEnabled: false,
      mode: 'budget',
      budget: { min: 512, default: -1, max: 24576, auto: -1, off: 0, unit: 'tokens' }
    })

    const result = buildProviderOptions({
      providerId: 'google',
      capabilityProviderId: 'google',
      providerOptionsKey: 'google',
      apiType: 'google',
      modelId: 'gemini-2.5-flash-lite-preview-09-2025',
      modelConfig: {
        reasoning: false,
        thinkingBudget: -1
      },
      tools: [
        {
          type: 'function',
          function: {
            name: 'search_web',
            description: 'Search the web',
            parameters: {
              type: 'object',
              properties: {}
            }
          }
        }
      ] as any,
      messages: []
    })

    expect(result.providerOptions).toBeUndefined()
  })

  it('keeps google thinking config when tools are present without adding vertex-only options', () => {
    const result = buildProviderOptions({
      providerId: 'google',
      capabilityProviderId: 'google',
      providerOptionsKey: 'google',
      apiType: 'google',
      modelId: 'gemini-3.1-flash-lite-preview',
      modelConfig: {
        reasoning: true,
        thinkingBudget: 1024
      },
      tools: [
        {
          type: 'function',
          function: {
            name: 'search_web',
            description: 'Search the web',
            parameters: {
              type: 'object',
              properties: {}
            }
          }
        }
      ] as any,
      messages: []
    })

    expect(result.providerOptions).toEqual({
      google: {
        thinkingConfig: {
          thinkingBudget: 1024,
          includeThoughts: true
        }
      }
    })
  })
})
