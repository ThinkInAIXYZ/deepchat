import { describe, expect, it } from 'vitest'
import { buildProviderOptions } from '@/presenter/llmProviderPresenter/aiSdk/providerOptionsMapper'

describe('AI SDK anthropic provider options', () => {
  const baseModelConfig = {
    reasoning: true,
    reasoningEffort: 'high' as const,
    thinkingBudget: 2048,
    conversationId: 'conv-1'
  }

  it('keeps official anthropic beta features enabled', () => {
    const result = buildProviderOptions({
      providerId: 'anthropic',
      providerOptionsKey: 'anthropic',
      apiType: 'anthropic',
      modelId: 'claude-sonnet-4-5',
      modelConfig: baseModelConfig,
      tools: [],
      messages: []
    })

    expect(result.providerOptions?.anthropic).toMatchObject({
      toolStreaming: true,
      sendReasoning: true,
      effort: 'high',
      thinking: {
        type: 'enabled',
        budgetTokens: 2048
      }
    })
  })

  it('disables anthropic beta-only options for compatible providers', () => {
    const result = buildProviderOptions({
      providerId: 'zenmux',
      providerOptionsKey: 'anthropic',
      apiType: 'anthropic',
      modelId: 'anthropic/claude-sonnet-4.5',
      modelConfig: baseModelConfig,
      tools: [],
      messages: []
    })

    expect(result.providerOptions?.anthropic).toMatchObject({
      toolStreaming: false,
      thinking: {
        type: 'enabled',
        budgetTokens: 2048
      }
    })
    expect(result.providerOptions?.anthropic).not.toHaveProperty('sendReasoning')
    expect(result.providerOptions?.anthropic).not.toHaveProperty('effort')
  })

  it('disables anthropic beta-only options for custom anthropic providers', () => {
    const result = buildProviderOptions({
      providerId: 'my-anthropic-proxy',
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

  it('disables vertex function-call argument streaming when no tools are present', () => {
    const result = buildProviderOptions({
      providerId: 'vertex',
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
})
