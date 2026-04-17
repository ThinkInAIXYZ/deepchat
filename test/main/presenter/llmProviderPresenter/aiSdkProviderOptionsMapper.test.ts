import { beforeEach, describe, expect, it, vi } from 'vitest'

const {
  mockGetThinkingBudgetRange,
  mockGetModel,
  mockGetReasoningPortrait,
  mockSupportsReasoning
} = vi.hoisted(() => ({
  mockGetThinkingBudgetRange: vi.fn().mockReturnValue({}),
  mockGetModel: vi.fn().mockReturnValue(undefined),
  mockGetReasoningPortrait: vi.fn().mockReturnValue(null),
  mockSupportsReasoning: vi.fn().mockReturnValue(false)
}))

vi.mock('@/presenter/configPresenter/providerDbLoader', () => ({
  providerDbLoader: {
    getModel: mockGetModel
  }
}))

vi.mock('@/presenter/configPresenter/modelCapabilities', () => ({
  modelCapabilities: {
    getThinkingBudgetRange: mockGetThinkingBudgetRange,
    getReasoningPortrait: mockGetReasoningPortrait,
    supportsReasoning: mockSupportsReasoning
  }
}))

import { buildProviderOptions } from '@/presenter/llmProviderPresenter/aiSdk/providerOptionsMapper'

describe('AI SDK provider options', () => {
  const baseModelConfig = {
    reasoning: true,
    reasoningEffort: 'high' as const,
    thinkingBudget: 2048,
    conversationId: 'conv-1'
  }

  beforeEach(() => {
    mockGetThinkingBudgetRange.mockReturnValue({})
    mockGetModel.mockReturnValue(undefined)
    mockGetReasoningPortrait.mockReturnValue(null)
    mockSupportsReasoning.mockReturnValue(false)
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

  it('maps zenmux anthropic routes to official anthropic adaptive reasoning controls', () => {
    mockGetReasoningPortrait.mockReturnValue({
      supported: true,
      defaultEnabled: false,
      mode: 'effort',
      effort: 'high',
      effortOptions: ['low', 'medium', 'high', 'xhigh', 'max'],
      visibility: 'omitted'
    })

    const result = buildProviderOptions({
      providerId: 'zenmux',
      capabilityProviderId: 'anthropic',
      supportsOfficialAnthropicReasoning: true,
      providerOptionsKey: 'anthropic',
      apiType: 'anthropic',
      modelId: 'anthropic/claude-sonnet-4.5',
      modelConfig: {
        ...baseModelConfig,
        reasoning: true,
        reasoningEffort: 'xhigh',
        reasoningVisibility: 'summarized'
      },
      tools: [],
      messages: []
    })

    expect(result.providerOptions?.anthropic).toMatchObject({
      toolStreaming: true,
      sendReasoning: true,
      effort: 'xhigh',
      thinking: {
        type: 'adaptive',
        display: 'summarized'
      }
    })
  })

  it('disables anthropic beta-only options for custom anthropic providers', () => {
    const result = buildProviderOptions({
      providerId: 'my-anthropic-proxy',
      capabilityProviderId: 'anthropic',
      providerOptionsKey: 'anthropic',
      apiType: 'anthropic',
      modelId: 'claude-sonnet-4-5',
      modelConfig: {
        reasoningEffort: 'medium' as const
      },
      tools: [],
      messages: []
    })

    expect(result.providerOptions?.anthropic).toMatchObject({
      toolStreaming: false
    })
    expect(result.providerOptions?.anthropic).not.toHaveProperty('effort')
  })

  it('keeps aws bedrock anthropic routes on the compatible reasoning dialect', () => {
    const result = buildProviderOptions({
      providerId: 'aws-bedrock',
      capabilityProviderId: 'anthropic',
      providerOptionsKey: 'anthropic',
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

  it('maps grok reasoning effort to the vendor-specific body field', () => {
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
        reasoning_effort: 'medium'
      }
    })
  })

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

  it('does not send google thinking config when a budget portrait defaults to disabled', () => {
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

    expect(result.providerOptions).toEqual({
      google: {
        streamFunctionCallArguments: true
      }
    })
  })
})
