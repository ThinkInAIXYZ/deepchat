import { beforeEach, describe, expect, it, vi } from 'vitest'

const {
  mockGenerateImage,
  mockGenerateText,
  mockStreamText,
  mockCreateAiSdkProviderContext,
  mockCacheImage
} = vi.hoisted(() => ({
  mockGenerateImage: vi.fn(),
  mockGenerateText: vi.fn(),
  mockStreamText: vi.fn(),
  mockCreateAiSdkProviderContext: vi.fn(),
  mockCacheImage: vi.fn()
}))

vi.mock('ai', () => ({
  generateId: vi.fn(() => 'generated-id'),
  generateImage: mockGenerateImage,
  generateText: mockGenerateText,
  streamText: mockStreamText,
  embedMany: vi.fn()
}))

vi.mock('@/presenter', () => ({
  presenter: {
    devicePresenter: {
      cacheImage: mockCacheImage
    }
  }
}))

vi.mock('@/presenter/llmProviderPresenter/aiSdk/providerFactory', () => ({
  createAiSdkProviderContext: mockCreateAiSdkProviderContext
}))

import {
  runAiSdkCoreStream,
  runAiSdkGenerateText
} from '@/presenter/llmProviderPresenter/aiSdk/runtime'

describe('AI SDK runtime', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockCreateAiSdkProviderContext.mockReturnValue({
      providerOptionsKey: 'openai',
      apiType: 'openai_chat',
      model: {},
      imageModel: {},
      endpoint: 'https://image.example.com'
    })
    mockGenerateText.mockResolvedValue({
      text: 'ok',
      reasoningText: undefined,
      totalUsage: {
        inputTokens: 1,
        outputTokens: 1,
        totalTokens: 2
      }
    })
    mockStreamText.mockReturnValue({
      fullStream: (async function* () {})()
    })
    mockGenerateImage.mockResolvedValue({
      images: [
        {
          mediaType: 'image/png',
          base64: 'ZmFrZQ=='
        }
      ]
    })
    mockCacheImage.mockResolvedValue('cached://image')
  })

  it('builds image prompts from text-like content instead of object stringification', async () => {
    const context = {
      providerKind: 'openai-compatible',
      provider: {
        id: 'openai',
        apiType: 'openai-compatible'
      },
      configPresenter: {},
      defaultHeaders: {},
      shouldUseImageGeneration: () => true
    } as any

    const events = []
    for await (const event of runAiSdkCoreStream(
      context,
      [
        {
          role: 'user',
          content: [
            { type: 'text', text: 'draw a cat' },
            { type: 'image_url', image_url: { url: 'data:image/png;base64,AAA=' } },
            'with neon lights',
            { text: 'in the rain' },
            { foo: 'ignored' }
          ] as any
        },
        {
          role: 'user',
          content: {
            text: 'cinematic'
          } as any
        }
      ],
      'gpt-image-1',
      {
        apiEndpoint: 'image'
      } as any,
      0.7,
      1024,
      []
    )) {
      events.push(event)
    }

    expect(mockGenerateImage).toHaveBeenCalledWith(
      expect.objectContaining({
        prompt: 'draw a cat\nwith neon lights\nin the rain\n\ncinematic'
      })
    )
    expect(events).toEqual([
      {
        type: 'image_data',
        image_data: {
          data: 'cached://image',
          mimeType: 'image/png'
        }
      },
      {
        type: 'stop',
        stop_reason: 'complete'
      }
    ])
  })

  it('omits temperature for anthropic models that disable temperature control', async () => {
    const tracePayloads: Array<{ body?: Record<string, unknown> }> = []
    const context = {
      providerKind: 'anthropic',
      provider: {
        id: 'anthropic',
        apiType: 'anthropic'
      },
      configPresenter: {
        supportsTemperatureControl: vi.fn().mockReturnValue(false)
      },
      defaultHeaders: {},
      emitRequestTrace: vi.fn(async (_modelConfig, payload) => {
        tracePayloads.push(payload)
      })
    } as any

    await runAiSdkGenerateText(
      context,
      [],
      'claude-opus-4-7',
      {
        apiEndpoint: 'chat'
      } as any,
      0.3,
      1024
    )

    const request = mockGenerateText.mock.calls[0]?.[0] as Record<string, unknown>
    expect(request).not.toHaveProperty('temperature')
    expect(tracePayloads[0]?.body).not.toHaveProperty('temperature')
  })

  it('omits temperature for claude-opus-4-7-think when capability data is missing', async () => {
    const tracePayloads: Array<{ body?: Record<string, unknown> }> = []
    const context = {
      providerKind: 'openai-compatible',
      provider: {
        id: 'aihubmix',
        apiType: 'openai-compatible'
      },
      configPresenter: {
        supportsTemperatureControl: vi.fn().mockReturnValue(undefined),
        getTemperatureCapability: vi.fn().mockReturnValue(undefined)
      },
      defaultHeaders: {},
      emitRequestTrace: vi.fn(async (_modelConfig, payload) => {
        tracePayloads.push(payload)
      })
    } as any

    const events = []
    for await (const event of runAiSdkCoreStream(
      context,
      [],
      'claude-opus-4-7-think',
      {
        apiEndpoint: 'chat',
        functionCall: false
      } as any,
      0.5,
      2048,
      []
    )) {
      events.push(event)
    }

    const request = mockStreamText.mock.calls[0]?.[0] as Record<string, unknown>
    expect(request).not.toHaveProperty('temperature')
    expect(tracePayloads[0]?.body).not.toHaveProperty('temperature')
    expect(events).toEqual([])
  })

  it('keeps temperature for opus 4.6 models that still support it', async () => {
    const tracePayloads: Array<{ body?: Record<string, unknown> }> = []
    const context = {
      providerKind: 'anthropic',
      provider: {
        id: 'anthropic',
        apiType: 'anthropic'
      },
      configPresenter: {
        supportsTemperatureControl: vi.fn().mockReturnValue(true)
      },
      defaultHeaders: {},
      emitRequestTrace: vi.fn(async (_modelConfig, payload) => {
        tracePayloads.push(payload)
      })
    } as any

    await runAiSdkGenerateText(
      context,
      [],
      'claude-opus-4-6',
      {
        apiEndpoint: 'chat'
      } as any,
      0.6,
      1024
    )

    const request = mockGenerateText.mock.calls[0]?.[0] as Record<string, unknown>
    expect(request).toHaveProperty('temperature', 0.6)
    expect(tracePayloads[0]?.body).toHaveProperty('temperature', 0.6)
  })
})
