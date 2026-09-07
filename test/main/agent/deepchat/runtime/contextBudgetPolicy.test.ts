import { describe, expect, it } from 'vitest'
import { ApiEndpointType, ModelType } from '@shared/model'
import {
  resolveDeepChatContextBudgetLength,
  shouldBypassDeepChatContextBudget,
  shouldObserveToolSurfaceShadow,
  shouldUseNativeToolSurface,
  shouldUseDeepChatContextBudget,
  type ContextBudgetModelConfig
} from '@/agent/deepchat/runtime/contextBudgetPolicy'

const CHAT_MODEL: ContextBudgetModelConfig = {
  type: ModelType.Chat,
  apiEndpoint: ApiEndpointType.Chat
}

describe('DeepChat context budget policy', () => {
  it.each([
    {
      name: 'ACP provider',
      providerId: ' acp ',
      modelConfig: CHAT_MODEL,
      modelId: 'agent',
      expected: false
    },
    {
      name: 'image model type',
      providerId: 'openai',
      modelConfig: { type: ModelType.ImageGeneration },
      modelId: 'image-model',
      expected: false
    },
    {
      name: 'TTS model type',
      providerId: 'openai',
      modelConfig: { type: ModelType.TTS },
      modelId: 'tts-model',
      expected: false
    },
    {
      name: 'non-chat legacy endpoint',
      providerId: 'openai',
      modelConfig: { type: ModelType.Chat, apiEndpoint: ApiEndpointType.Image },
      modelId: 'model',
      expected: false
    },
    {
      name: 'image generation route',
      providerId: 'openai',
      modelConfig: { type: ModelType.Chat, endpointType: 'image-generation' },
      modelId: 'model',
      expected: false
    },
    {
      name: 'video model type',
      providerId: 'openai',
      modelConfig: { type: ModelType.VideoGeneration },
      modelId: 'model',
      expected: false
    },
    {
      name: 'video model id compatibility',
      providerId: 'openai',
      modelConfig: CHAT_MODEL,
      modelId: 'sora-2',
      expected: false
    },
    {
      name: 'ordinary chat model',
      providerId: 'openai',
      modelConfig: CHAT_MODEL,
      modelId: 'gpt-5',
      expected: true
    },
    {
      name: 'missing model config',
      providerId: 'openai',
      modelConfig: null,
      modelId: 'gpt-5',
      expected: true,
      shadowExpected: false
    },
    {
      name: 'TTS model id with a stale chat config',
      providerId: 'openai',
      modelConfig: CHAT_MODEL,
      modelId: 'gpt-4o-mini-tts',
      expected: true,
      shadowExpected: false
    },
    {
      name: 'embedding model type',
      providerId: 'openai',
      modelConfig: { type: ModelType.Embedding },
      modelId: 'text-embedding-3-small',
      expected: true,
      shadowExpected: false
    }
  ] as const)(
    'returns $expected for $name',
    ({ providerId, modelConfig, modelId, expected, ...testCase }) => {
      expect(shouldUseDeepChatContextBudget(providerId, modelConfig, modelId)).toBe(expected)
      expect(shouldBypassDeepChatContextBudget(providerId, modelConfig, modelId)).toBe(!expected)
      expect(shouldObserveToolSurfaceShadow(providerId, modelConfig, modelId)).toBe(
        'shadowExpected' in testCase ? testCase.shadowExpected : expected
      )
    }
  )

  it('maps bypassed models to an effectively unbounded local budget', () => {
    expect(resolveDeepChatContextBudgetLength('acp', 16_384, CHAT_MODEL, 'agent')).toBe(
      Number.MAX_SAFE_INTEGER
    )
    expect(resolveDeepChatContextBudgetLength('openai', 16_384, CHAT_MODEL, 'gpt-5')).toBe(
      16_384
    )
  })

  it('admits production Tool Surfaces only for native function-calling chat models', () => {
    expect(
      shouldUseNativeToolSurface(
        'openai',
        { ...CHAT_MODEL, functionCall: true },
        'gpt-5'
      )
    ).toBe(true)
    expect(
      shouldUseNativeToolSurface(
        'openai',
        { ...CHAT_MODEL, functionCall: false },
        'gpt-5'
      )
    ).toBe(false)
    expect(
      shouldUseNativeToolSurface('acp', { ...CHAT_MODEL, functionCall: true }, 'agent')
    ).toBe(false)
  })
})
