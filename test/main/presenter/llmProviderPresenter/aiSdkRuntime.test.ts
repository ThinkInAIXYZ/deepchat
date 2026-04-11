import { beforeEach, describe, expect, it, vi } from 'vitest'

const { mockGenerateImage, mockCreateAiSdkProviderContext, mockCacheImage } = vi.hoisted(() => ({
  mockGenerateImage: vi.fn(),
  mockCreateAiSdkProviderContext: vi.fn(),
  mockCacheImage: vi.fn()
}))

vi.mock('ai', () => ({
  generateId: vi.fn(() => 'generated-id'),
  generateImage: mockGenerateImage,
  generateText: vi.fn(),
  streamText: vi.fn(),
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

import { runAiSdkCoreStream } from '@/presenter/llmProviderPresenter/aiSdk/runtime'

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
})
