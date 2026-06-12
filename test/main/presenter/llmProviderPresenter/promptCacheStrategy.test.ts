import { describe, expect, it } from 'vitest'
import {
  applyAnthropicExplicitCacheBreakpoint,
  applyOpenAIChatExplicitCacheBreakpoint,
  resolvePromptCachePlan
} from '../../../../src/main/presenter/llmProviderPresenter/promptCacheStrategy'

describe('promptCacheStrategy', () => {
  it('builds prompt_cache_key for official OpenAI models', () => {
    const plan = resolvePromptCachePlan({
      providerId: 'openai',
      apiType: 'openai_chat',
      modelId: 'gpt-5',
      messages: [],
      conversationId: 'session-1'
    })

    expect(plan).toMatchObject({
      mode: 'openai_implicit',
      ttl: null
    })
    expect(plan.cacheKey).toMatch(/^deepchat:openai:gpt-5:/)
  })

  it('enables top-level automatic cache control for Anthropic Claude', () => {
    const plan = resolvePromptCachePlan({
      providerId: 'anthropic',
      apiType: 'anthropic',
      modelId: 'claude-sonnet-4-5-20250929',
      messages: []
    })

    expect(plan).toEqual({
      mode: 'anthropic_auto',
      ttl: '5m'
    })
  })

  it('creates an explicit cache breakpoint plan for ZenMux anthropic/* models', () => {
    const plan = resolvePromptCachePlan({
      providerId: 'zenmux',
      apiType: 'anthropic',
      modelId: 'anthropic/claude-sonnet-4-5',
      messages: [
        { role: 'user', content: [{ type: 'text', text: 'history' }] },
        { role: 'assistant', content: [{ type: 'text', text: 'stable reply' }] },
        { role: 'user', content: [{ type: 'text', text: 'latest question' }] }
      ]
    })

    expect(plan).toEqual({
      mode: 'anthropic_explicit',
      ttl: '5m',
      breakpointPlan: {
        messageIndex: 1,
        contentIndex: 0
      }
    })
  })

  it('keeps new-api anthropic routes out of automatic anthropic cache mode', () => {
    const plan = resolvePromptCachePlan({
      providerId: 'new-api',
      apiType: 'anthropic',
      modelId: 'claude-opus-4-7',
      messages: []
    })

    expect(plan).toEqual({
      mode: 'disabled',
      ttl: null
    })
  })

  it('creates a single explicit breakpoint plan for Bedrock Claude', () => {
    const plan = resolvePromptCachePlan({
      providerId: 'aws-bedrock',
      apiType: 'anthropic',
      modelId: 'anthropic.claude-3-5-sonnet-20240620-v1:0',
      messages: [
        { role: 'user', content: [{ type: 'text', text: 'history' }] },
        { role: 'assistant', content: [{ type: 'text', text: 'stable reply' }] },
        { role: 'user', content: [{ type: 'text', text: 'latest question' }] }
      ]
    })

    expect(plan).toEqual({
      mode: 'anthropic_explicit',
      ttl: '5m',
      breakpointPlan: {
        messageIndex: 1,
        contentIndex: 0
      }
    })
  })

  it('creates a single explicit breakpoint plan for OpenRouter Claude', () => {
    const plan = resolvePromptCachePlan({
      providerId: 'openrouter',
      apiType: 'openai_chat',
      modelId: 'anthropic/claude-sonnet-4',
      messages: [
        { role: 'user', content: 'history' },
        { role: 'assistant', content: 'stable reply' },
        { role: 'user', content: 'latest question' }
      ]
    })

    expect(plan).toEqual({
      mode: 'anthropic_explicit',
      ttl: '5m',
      breakpointPlan: {
        messageIndex: 1,
        contentIndex: 0
      }
    })
  })

  it('keeps non-Claude OpenRouter models disabled for explicit request mutation', () => {
    const plan = resolvePromptCachePlan({
      providerId: 'openrouter',
      apiType: 'openai_chat',
      modelId: 'openai/gpt-4o',
      messages: []
    })

    expect(plan).toEqual({
      mode: 'disabled',
      ttl: null
    })
  })

  it('returns disabled for unsupported providers', () => {
    const plan = resolvePromptCachePlan({
      providerId: 'gemini',
      apiType: 'openai_chat',
      modelId: 'gemini-2.5-pro',
      messages: []
    })

    expect(plan).toEqual({
      mode: 'disabled',
      ttl: null
    })
  })

  it('annotates the selected text block for explicit cache breakpoints', () => {
    const anthropicPlan = resolvePromptCachePlan({
      providerId: 'aws-bedrock',
      apiType: 'anthropic',
      modelId: 'anthropic.claude-3-5-sonnet-20240620-v1:0',
      messages: [
        { role: 'user', content: [{ type: 'text', text: 'history' }] },
        { role: 'assistant', content: [{ type: 'text', text: 'stable reply' }] },
        { role: 'user', content: [{ type: 'text', text: 'latest question' }] }
      ]
    })
    const anthropicMessages = applyAnthropicExplicitCacheBreakpoint(
      [
        { role: 'user', content: [{ type: 'text', text: 'history' }] },
        { role: 'assistant', content: [{ type: 'text', text: 'stable reply' }] },
        { role: 'user', content: [{ type: 'text', text: 'latest question' }] }
      ] as any,
      anthropicPlan
    )

    expect(anthropicMessages[1]?.content?.[0]).toMatchObject({
      type: 'text',
      text: 'stable reply',
      cache_control: {
        type: 'ephemeral'
      }
    })

    const openAIPlan = resolvePromptCachePlan({
      providerId: 'openrouter',
      apiType: 'openai_chat',
      modelId: 'anthropic/claude-sonnet-4',
      messages: [
        { role: 'user', content: 'history' },
        { role: 'assistant', content: 'stable reply' },
        { role: 'user', content: 'latest question' }
      ]
    })
    const openAIMessages = applyOpenAIChatExplicitCacheBreakpoint(
      [
        { role: 'user', content: 'history' },
        { role: 'assistant', content: 'stable reply' },
        { role: 'user', content: 'latest question' }
      ] as any,
      openAIPlan
    )

    expect(openAIMessages[1]).toMatchObject({
      role: 'assistant',
      content: [
        {
          type: 'text',
          text: 'stable reply',
          cache_control: {
            type: 'ephemeral'
          }
        }
      ]
    })
  })
})
