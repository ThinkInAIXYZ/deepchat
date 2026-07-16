import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const {
  mockGenerateImage,
  mockGenerateText,
  mockStreamText,
  mockEmbedMany,
  mockWrapEmbeddingModel,
  mockCreateAiSdkProviderContext,
  mockCacheImage
} = vi.hoisted(() => ({
  mockGenerateImage: vi.fn(),
  mockGenerateText: vi.fn(),
  mockStreamText: vi.fn(),
  mockEmbedMany: vi.fn(),
  mockWrapEmbeddingModel: vi.fn(
    ({ model, middleware }: { model: Record<string, unknown>; middleware: any }) => ({
      ...model,
      maxEmbeddingsPerCall: middleware.overrideMaxEmbeddingsPerCall({ model })
    })
  ),
  mockCreateAiSdkProviderContext: vi.fn(),
  mockCacheImage: vi.fn()
}))

vi.mock('ai', () => ({
  generateId: vi.fn(() => 'generated-id'),
  generateImage: mockGenerateImage,
  generateText: mockGenerateText,
  streamText: mockStreamText,
  embedMany: mockEmbedMany,
  wrapEmbeddingModel: mockWrapEmbeddingModel
}))

vi.mock('@/platform/imageCache', () => ({
  cacheImage: mockCacheImage
}))

vi.mock('@/provider/aiSdk/providerFactory', () => ({
  createAiSdkProviderContext: mockCreateAiSdkProviderContext,
  normalizeGeminiBaseUrl: vi.fn((baseUrl?: string) => {
    const normalized = (baseUrl || '').trim().replace(/\/+$/, '')
    if (!normalized) {
      return 'https://generativelanguage.googleapis.com/v1beta'
    }
    if (/\/v1beta1$/i.test(normalized) || /\/v1beta$/i.test(normalized)) {
      return normalized
    }
    if (/\/v1$/i.test(normalized)) {
      return normalized.replace(/\/v1$/i, '/v1beta')
    }
    return `${normalized}/v1beta`
  })
}))

import {
  runAiSdkCoreStream,
  runAiSdkDimensions,
  runAiSdkEmbeddings,
  runAiSdkGenerateText
} from '@/provider/aiSdk/runtime'
import { modelCapabilities } from '@/provider/modelCapabilities'
import { APICallError } from '@ai-sdk/provider'
import { clearLearnedEmbeddingBatchLimits } from '@/provider/aiSdk/embeddingBatchLimits'

describe('AI SDK runtime', () => {
  const createProviderSettings = () => ({
    getCapabilityProviderId: vi.fn((providerId: string) => providerId),
    supportsTemperatureControl: vi.fn((providerId: string, modelId: string) =>
      modelCapabilities.supportsTemperatureControl(providerId, modelId)
    ),
    getTemperatureCapability: vi.fn((providerId: string, modelId: string) =>
      modelCapabilities.getTemperatureCapability(providerId, modelId)
    )
  })

  const createTextRuntimeContext = (overrides: Record<string, unknown> = {}) =>
    ({
      providerKind: 'openai-compatible',
      provider: {
        id: 'openai',
        apiType: 'openai-compatible'
      },
      providerSettings: createProviderSettings(),
      defaultHeaders: {},
      ...overrides
    }) as any

  beforeEach(() => {
    vi.clearAllMocks()
    clearLearnedEmbeddingBatchLimits()
    mockCreateAiSdkProviderContext.mockReturnValue({
      providerOptionsKey: 'openai',
      apiType: 'openai_chat',
      model: {},
      embeddingModel: {},
      imageModel: {},
      endpoint: 'https://image.example.com'
    })
    mockGenerateText.mockResolvedValue({
      text: 'ok',
      usage: {
        inputTokens: 1,
        outputTokens: 1,
        totalTokens: 2
      },
      finalStep: {
        reasoningText: undefined
      }
    })
    mockStreamText.mockReturnValue({
      stream: (async function* () {})()
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
    mockEmbedMany.mockImplementation(async ({ values }: { values: string[] }) => ({
      embeddings: values.map((value) => [Number(value) || 1])
    }))
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllGlobals()
  })

  const createBatchError = (message: string) =>
    new APICallError({
      message,
      url: 'https://example.com/embeddings',
      requestBodyValues: {},
      statusCode: 400
    })

  it('applies the static batch limit, bounded parallelism, and abort signal', async () => {
    const controller = new AbortController()
    const texts = Array.from({ length: 50 }, (_, index) => String(index + 1))

    const embeddings = await runAiSdkEmbeddings(
      createTextRuntimeContext({ provider: { id: 'new-api' } }),
      'dashscope/text-embedding-v4',
      texts,
      controller.signal
    )

    expect(mockWrapEmbeddingModel).toHaveBeenCalledTimes(1)
    expect(mockEmbedMany).toHaveBeenCalledWith(
      expect.objectContaining({
        values: texts,
        maxParallelCalls: 2,
        abortSignal: controller.signal,
        model: expect.objectContaining({ maxEmbeddingsPerCall: 10 })
      })
    )
    expect(embeddings).toHaveLength(50)
  })

  it('learns a parsed batch limit and retries the full input only once', async () => {
    mockEmbedMany
      .mockRejectedValueOnce(createBatchError('batch size should not be larger than 10'))
      .mockImplementationOnce(async ({ values }: { values: string[] }) => ({
        embeddings: values.map((value) => [Number(value)])
      }))
    const texts = Array.from({ length: 50 }, (_, index) => String(index + 1))

    const embeddings = await runAiSdkEmbeddings(
      createTextRuntimeContext({ provider: { id: 'new-api' } }),
      'custom-embedding-model',
      texts
    )

    expect(mockEmbedMany).toHaveBeenCalledTimes(2)
    expect(mockEmbedMany.mock.calls[1]?.[0]).toMatchObject({
      values: texts,
      maxParallelCalls: 2,
      model: { maxEmbeddingsPerCall: 10 }
    })
    expect(embeddings[49]).toEqual([50])
  })

  it('halves serial probes and reuses the successful first slice in order', async () => {
    const batchError = createBatchError('batch size exceeds the allowed input count')
    mockEmbedMany
      .mockRejectedValueOnce(batchError)
      .mockRejectedValueOnce(batchError)
      .mockRejectedValueOnce(batchError)
      .mockImplementationOnce(async ({ values }: { values: string[] }) => ({
        embeddings: values.map((value) => [Number(value)])
      }))
      .mockImplementationOnce(async ({ values }: { values: string[] }) => ({
        embeddings: values.map((value) => [Number(value)])
      }))
    const texts = Array.from({ length: 50 }, (_, index) => String(index + 1))

    const embeddings = await runAiSdkEmbeddings(
      createTextRuntimeContext({ provider: { id: 'new-api' } }),
      'custom-embedding-model',
      texts
    )

    expect(mockEmbedMany.mock.calls.map(([request]) => request.values.length)).toEqual([
      50, 25, 12, 6, 44
    ])
    expect(mockEmbedMany.mock.calls.slice(1).map(([request]) => request.maxParallelCalls)).toEqual([
      2, 2, 2, 2
    ])
    expect(embeddings).toEqual(texts.map((value) => [Number(value)]))
  })

  it('does not restart probing after the successful first slice is reused', async () => {
    const initialError = createBatchError('batch size exceeds the allowed input count')
    const remainingError = createBatchError('batch size still exceeds the allowed input count')
    mockEmbedMany
      .mockRejectedValueOnce(initialError)
      .mockImplementationOnce(async ({ values }: { values: string[] }) => ({
        embeddings: values.map((value) => [Number(value)])
      }))
      .mockRejectedValueOnce(remainingError)
    const texts = Array.from({ length: 50 }, (_, index) => String(index + 1))

    await expect(
      runAiSdkEmbeddings(
        createTextRuntimeContext({ provider: { id: 'new-api' } }),
        'custom-embedding-model',
        texts
      )
    ).rejects.toBe(remainingError)
    expect(mockEmbedMany.mock.calls.map(([request]) => request.values.length)).toEqual([50, 25, 25])
  })

  it('does not split token errors that mention batch size', async () => {
    const error = createBatchError('batch size is invalid because the token context length exceeds')
    mockEmbedMany.mockRejectedValueOnce(error)

    await expect(
      runAiSdkEmbeddings(
        createTextRuntimeContext({ provider: { id: 'new-api' } }),
        'custom-embedding-model',
        ['one', 'two']
      )
    ).rejects.toBe(error)
    expect(mockEmbedMany).toHaveBeenCalledTimes(1)
  })

  it('does not split per-input content length errors', async () => {
    const error = createBatchError(
      'inputs[0] content size exceeds the maximum allowed length of 8192 characters'
    )
    mockEmbedMany.mockRejectedValueOnce(error)

    await expect(
      runAiSdkEmbeddings(
        createTextRuntimeContext({ provider: { id: 'new-api' } }),
        'custom-embedding-model',
        ['one', 'two']
      )
    ).rejects.toBe(error)
    expect(mockEmbedMany).toHaveBeenCalledTimes(1)
  })

  it('does not parse a batch limit from a max-prefixed model name', async () => {
    const error = createBatchError('batch size exceeds the maximum for model embedding-max10-v4')
    mockEmbedMany
      .mockRejectedValueOnce(error)
      .mockImplementationOnce(async ({ values }: { values: string[] }) => ({
        embeddings: values.map((value) => [Number(value)])
      }))
      .mockImplementationOnce(async ({ values }: { values: string[] }) => ({
        embeddings: values.map((value) => [Number(value)])
      }))
    const texts = Array.from({ length: 50 }, (_, index) => String(index + 1))

    await expect(
      runAiSdkEmbeddings(
        createTextRuntimeContext({ provider: { id: 'new-api' } }),
        'custom-embedding-model',
        texts
      )
    ).resolves.toEqual(texts.map((value) => [Number(value)]))
    expect(mockEmbedMany.mock.calls.map(([request]) => request.values.length)).toEqual([50, 25, 25])
  })

  it('does not retry a parsed batch limit more than once', async () => {
    const initialError = createBatchError('batch size should not be larger than 10')
    const retryError = createBatchError('batch size should not be larger than 10')
    mockEmbedMany.mockRejectedValueOnce(initialError).mockRejectedValueOnce(retryError)

    await expect(
      runAiSdkEmbeddings(
        createTextRuntimeContext({ provider: { id: 'new-api' } }),
        'custom-embedding-model',
        Array.from({ length: 50 }, (_, index) => String(index + 1))
      )
    ).rejects.toBe(retryError)
    expect(mockEmbedMany).toHaveBeenCalledTimes(2)
  })

  it('stops retries and learning when the signal is aborted', async () => {
    const controller = new AbortController()
    mockEmbedMany.mockImplementationOnce(async () => {
      controller.abort(new Error('cancelled'))
      throw createBatchError('batch size exceeds the allowed input count')
    })

    await expect(
      runAiSdkEmbeddings(
        createTextRuntimeContext({ provider: { id: 'new-api' } }),
        'custom-embedding-model',
        ['one', 'two'],
        controller.signal
      )
    ).rejects.toThrow('cancelled')
    expect(mockEmbedMany).toHaveBeenCalledTimes(1)
  })

  it('forwards the abort signal through dimension probing', async () => {
    const controller = new AbortController()

    await runAiSdkDimensions(
      createTextRuntimeContext({ provider: { id: 'new-api' } }),
      'custom-embedding-model',
      controller.signal
    )

    expect(mockEmbedMany).toHaveBeenCalledWith(
      expect.objectContaining({ abortSignal: controller.signal, maxParallelCalls: 2 })
    )
  })

  it('passes the exact caller signal to generateText when no model timeout is configured', async () => {
    const controller = new AbortController()

    await runAiSdkGenerateText(
      createTextRuntimeContext(),
      [{ role: 'user', content: 'Hello' }],
      'gpt-4',
      { apiEndpoint: 'chat' } as any,
      undefined,
      undefined,
      controller.signal
    )

    expect(mockGenerateText).toHaveBeenCalledWith(
      expect.objectContaining({ abortSignal: controller.signal })
    )
  })

  it('combines caller cancellation with the configured model timeout', async () => {
    const controller = new AbortController()
    const reason = new DOMException('Memory request aborted', 'AbortError')

    await runAiSdkGenerateText(
      createTextRuntimeContext(),
      [{ role: 'user', content: 'Hello' }],
      'gpt-4',
      { apiEndpoint: 'chat', timeout: 60_000 } as any,
      undefined,
      undefined,
      controller.signal
    )

    const request = mockGenerateText.mock.calls[0]?.[0] as { abortSignal?: AbortSignal }
    expect(request.abortSignal).not.toBe(controller.signal)
    expect(request.abortSignal?.aborted).toBe(false)

    controller.abort(reason)

    expect(request.abortSignal?.aborted).toBe(true)
    expect(request.abortSignal?.reason).toBe(reason)
  })

  it('rejects a pre-aborted text request before invoking the AI SDK', async () => {
    const controller = new AbortController()
    const reason = new DOMException('Memory request aborted', 'AbortError')
    controller.abort(reason)

    await expect(
      runAiSdkGenerateText(
        createTextRuntimeContext(),
        [{ role: 'user', content: 'Hello' }],
        'gpt-4',
        { apiEndpoint: 'chat' } as any,
        undefined,
        undefined,
        controller.signal
      )
    ).rejects.toBe(reason)
    expect(mockGenerateText).not.toHaveBeenCalled()
  })

  it('promotes leading system messages to the top-level instructions option for generateText', async () => {
    await runAiSdkGenerateText(
      createTextRuntimeContext(),
      [
        { role: 'system', content: 'Be precise' },
        { role: 'user', content: 'Hello' }
      ],
      'gpt-4',
      {
        apiEndpoint: 'chat'
      } as any,
      0.7,
      1024
    )

    const request = mockGenerateText.mock.calls[0]?.[0] as Record<string, unknown>
    expect(request).toMatchObject({
      instructions: 'Be precise',
      allowSystemInMessages: false,
      messages: [
        {
          role: 'user',
          content: [{ type: 'text', text: 'Hello' }]
        }
      ]
    })
  })

  it('promotes multiple leading system messages in order for streamText', async () => {
    const events = []
    for await (const event of runAiSdkCoreStream(
      createTextRuntimeContext(),
      [
        { role: 'system', content: 'First instruction' },
        { role: 'system', content: 'Second instruction' },
        { role: 'user', content: 'Go' }
      ],
      'gpt-4',
      {
        apiEndpoint: 'chat',
        functionCall: false
      } as any,
      0.7,
      1024,
      []
    )) {
      events.push(event)
    }

    const request = mockStreamText.mock.calls[0]?.[0] as Record<string, unknown>
    expect(request).toMatchObject({
      instructions: 'First instruction\n\nSecond instruction',
      allowSystemInMessages: false,
      messages: [
        {
          role: 'user',
          content: [{ type: 'text', text: 'Go' }]
        }
      ]
    })
    expect(events).toEqual([])
  })

  it('drops blank leading system messages without sending an empty instructions option', async () => {
    await runAiSdkGenerateText(
      createTextRuntimeContext(),
      [
        { role: 'system', content: '  \n\t  ' },
        { role: 'user', content: 'Hello' }
      ],
      'gpt-4',
      {
        apiEndpoint: 'chat'
      } as any,
      0.7,
      1024
    )

    const request = mockGenerateText.mock.calls[0]?.[0] as Record<string, unknown>
    expect(request).not.toHaveProperty('instructions')
    expect(request).toMatchObject({
      allowSystemInMessages: false,
      messages: [
        {
          role: 'user',
          content: [{ type: 'text', text: 'Hello' }]
        }
      ]
    })
  })

  it('leaves non-leading system messages in messages for fail-fast AI SDK validation', async () => {
    await runAiSdkGenerateText(
      createTextRuntimeContext(),
      [
        { role: 'user', content: 'Hello' },
        { role: 'system', content: 'Late instruction' }
      ],
      'gpt-4',
      {
        apiEndpoint: 'chat'
      } as any,
      0.7,
      1024
    )

    const request = mockGenerateText.mock.calls[0]?.[0] as Record<string, unknown>
    expect(request).toMatchObject({
      allowSystemInMessages: false,
      messages: [
        {
          role: 'user',
          content: [{ type: 'text', text: 'Hello' }]
        },
        {
          role: 'system',
          content: 'Late instruction'
        }
      ]
    })
    expect(request).not.toHaveProperty('instructions')
  })

  it('maps generateText reasoningText and usage onto the response without dropping them', async () => {
    mockGenerateText.mockResolvedValueOnce({
      text: 'final answer',
      usage: {
        inputTokens: 3,
        outputTokens: 5,
        totalTokens: 8
      },
      finalStep: {
        reasoningText: 'thinking'
      }
    })

    const response = await runAiSdkGenerateText(
      createTextRuntimeContext(),
      [{ role: 'user', content: 'Hello' }],
      'gpt-4',
      {
        apiEndpoint: 'chat'
      } as any,
      0.7,
      1024
    )

    expect(response).toMatchObject({
      content: 'final answer',
      reasoning_content: 'thinking',
      totalUsage: {
        prompt_tokens: 3,
        completion_tokens: 5,
        total_tokens: 8
      }
    })
  })

  it('builds image prompts from text-like content instead of object stringification', async () => {
    const context = {
      providerKind: 'openai-compatible',
      provider: {
        id: 'openai',
        apiType: 'openai-compatible'
      },
      providerSettings: createProviderSettings(),
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
      'gpt-image-2',
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

  it('forwards caller cancellation to the image generation transport', async () => {
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
    const signal = new AbortController().signal

    for await (const _event of runAiSdkCoreStream(
      context,
      [{ role: 'user', content: 'draw a cat' }],
      'gpt-image-2',
      { apiEndpoint: 'image' } as any,
      0.7,
      1024,
      [],
      signal
    )) {
      // Drain stream.
    }

    expect(mockGenerateImage).toHaveBeenCalledWith(expect.objectContaining({ abortSignal: signal }))
  })

  it('does not forward gpt-image-2 image options when the config is empty', async () => {
    const context = {
      providerKind: 'openai-responses',
      provider: {
        id: 'openai',
        apiType: 'openai'
      },
      providerSettings: createProviderSettings(),
      defaultHeaders: {},
      shouldUseImageGeneration: () => true
    } as any

    for await (const _event of runAiSdkCoreStream(
      context,
      [{ role: 'user', content: 'draw a cat' }],
      'gpt-image-2',
      {
        apiEndpoint: 'image'
      } as any,
      0.7,
      1024,
      []
    )) {
      // Drain stream.
    }

    const request = mockGenerateImage.mock.calls[0]?.[0] as Record<string, unknown>
    expect(request).not.toHaveProperty('size')
    expect(request).not.toHaveProperty('providerOptions')
  })

  it('forwards gpt-image-2 image options to the OpenAI image model', async () => {
    const context = {
      providerKind: 'openai-responses',
      provider: {
        id: 'openai',
        apiType: 'openai'
      },
      providerSettings: createProviderSettings(),
      defaultHeaders: {},
      shouldUseImageGeneration: () => true
    } as any

    for await (const _event of runAiSdkCoreStream(
      context,
      [{ role: 'user', content: 'draw a cat' }],
      'gpt-image-2',
      {
        apiEndpoint: 'image',
        imageGeneration: {
          size: '3840x2160',
          quality: 'high',
          outputFormat: 'webp',
          outputCompression: 80,
          background: 'opaque',
          moderation: 'low'
        }
      } as any,
      0.7,
      1024,
      []
    )) {
      // Drain stream.
    }

    expect(mockGenerateImage).toHaveBeenCalledWith(
      expect.objectContaining({
        size: '3840x2160',
        providerOptions: {
          openai: {
            quality: 'high',
            outputFormat: 'webp',
            outputCompression: 80,
            background: 'opaque',
            moderation: 'low'
          }
        }
      })
    )
  })

  it('uses wire-shaped gpt-image-2 options for OpenAI-compatible image providers', async () => {
    mockCreateAiSdkProviderContext.mockReturnValueOnce({
      providerOptionsKey: 'new-api',
      apiType: 'openai_chat',
      model: {},
      imageModel: {},
      endpoint: 'https://image.example.com'
    })
    const context = {
      providerKind: 'openai-compatible',
      provider: {
        id: 'new-api',
        apiType: 'new-api'
      },
      providerSettings: createProviderSettings(),
      defaultHeaders: {},
      shouldUseImageGeneration: () => true
    } as any

    for await (const _event of runAiSdkCoreStream(
      context,
      [{ role: 'user', content: 'draw a cat' }],
      'gpt-image-2',
      {
        apiEndpoint: 'image',
        imageGeneration: {
          outputFormat: 'jpeg',
          outputCompression: 70
        }
      } as any,
      0.7,
      1024,
      []
    )) {
      // Drain stream.
    }

    expect(mockGenerateImage).toHaveBeenCalledWith(
      expect.objectContaining({
        providerOptions: {
          'new-api': {
            output_format: 'jpeg',
            output_compression: 70
          }
        }
      })
    )
  })

  it('uses wire-shaped gpt-image-2 options for generic OpenAI-compatible image providers', async () => {
    mockCreateAiSdkProviderContext.mockReturnValueOnce({
      providerOptionsKey: 'aihubmix',
      apiType: 'openai_chat',
      model: {},
      imageModel: {},
      endpoint: 'https://image.example.com'
    })
    const context = {
      providerKind: 'openai-compatible',
      provider: {
        id: 'aihubmix',
        apiType: 'openai-compatible'
      },
      providerSettings: createProviderSettings(),
      defaultHeaders: {},
      shouldUseImageGeneration: () => true
    } as any

    for await (const _event of runAiSdkCoreStream(
      context,
      [{ role: 'user', content: 'draw a cat' }],
      'gpt-image-2',
      {
        apiEndpoint: 'image',
        imageGeneration: {
          outputFormat: 'webp',
          outputCompression: 80
        }
      } as any,
      0.7,
      1024,
      []
    )) {
      // Drain stream.
    }

    expect(mockGenerateImage).toHaveBeenCalledWith(
      expect.objectContaining({
        providerOptions: {
          aihubmix: {
            output_format: 'webp',
            output_compression: 80
          }
        }
      })
    )
  })

  it('does not forward OpenAI image options for ordinary chat models', async () => {
    const context = {
      providerKind: 'openai-responses',
      provider: {
        id: 'openai',
        apiType: 'openai'
      },
      providerSettings: createProviderSettings(),
      defaultHeaders: {},
      shouldUseImageGeneration: () => true
    } as any

    for await (const _event of runAiSdkCoreStream(
      context,
      [{ role: 'user', content: 'draw a cat' }],
      'gpt-5',
      {
        imageGeneration: {
          outputFormat: 'jpeg',
          outputCompression: 70
        }
      } as any,
      0.7,
      1024,
      []
    )) {
      // Drain stream.
    }

    const request = mockGenerateImage.mock.calls[0]?.[0] as Record<string, unknown>
    expect(request).not.toHaveProperty('size')
    expect(request).not.toHaveProperty('providerOptions')
  })

  it.each([
    {
      route: 'OpenAI speech',
      provider: {
        id: 'openai',
        apiType: 'openai-compatible',
        baseUrl: 'https://example.com/v1',
        apiKey: 'test-key'
      },
      modelId: 'tts-1',
      modelConfig: { apiEndpoint: 'audio-speech' }
    },
    {
      route: 'chat audio',
      provider: {
        id: 'xiaomimimo',
        apiType: 'openai-compatible',
        baseUrl: 'https://example.com/v1',
        apiKey: 'test-key'
      },
      modelId: 'mimo-v2.5-tts',
      modelConfig: { apiEndpoint: 'chat', tts: { responseFormat: 'wav' } }
    },
    {
      route: 'Gemini generateContent',
      provider: {
        id: 'aihubmix',
        apiType: 'openai-compatible',
        baseUrl: 'https://aihubmix.com/v1',
        apiKey: 'test-key'
      },
      modelId: 'gemini-2.5-flash-preview-tts',
      modelConfig: { apiEndpoint: 'audio-speech' }
    }
  ])('aborts the $route TTS transport and removes its caller listener', async (scenario) => {
    const fetchMock = vi.fn().mockImplementation((_url: string, options?: RequestInit) => {
      return new Promise((_resolve, reject) => {
        const requestSignal = options?.signal as AbortSignal
        if (requestSignal.aborted) {
          reject(requestSignal.reason)
          return
        }
        requestSignal.addEventListener('abort', () => reject(requestSignal.reason), { once: true })
      })
    })
    vi.stubGlobal('fetch', fetchMock)
    const caller = new AbortController()
    const reason = new DOMException('Memory request aborted', 'AbortError')
    const removeEventListener = vi.spyOn(caller.signal, 'removeEventListener')
    const context = {
      providerKind: 'openai-compatible',
      provider: scenario.provider,
      configPresenter: {},
      defaultHeaders: {},
      shouldUseTts: () => true
    } as any

    const stream = (async () => {
      for await (const _event of runAiSdkCoreStream(
        context,
        [{ role: 'user', content: 'hello' }],
        scenario.modelId,
        scenario.modelConfig as any,
        0.7,
        1024,
        [],
        caller.signal
      )) {
        // Drain stream.
      }
    })()
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledOnce())
    caller.abort(reason)

    await expect(stream).rejects.toBe(reason)
    const transportSignal = (fetchMock.mock.calls[0]?.[1] as RequestInit).signal
    expect(transportSignal).not.toBe(caller.signal)
    expect(transportSignal?.reason).toBe(reason)
    expect(removeEventListener).toHaveBeenCalledWith('abort', expect.any(Function))
  })

  it('uses normal chat streaming for non-TTS MiMo Pro models', async () => {
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)

    const context = {
      providerKind: 'openai-compatible',
      provider: {
        id: 'xiaomimimo',
        apiType: 'openai-compatible',
        baseUrl: 'https://example.com/v1',
        apiKey: 'test-key'
      },
      providerSettings: createProviderSettings(),
      defaultHeaders: {}
    } as any

    const events = []
    for await (const event of runAiSdkCoreStream(
      context,
      [{ role: 'user', content: 'hello mimo' }],
      'mimo-v2.5-pro',
      {
        apiEndpoint: 'chat',
        functionCall: false
      } as any,
      0.7,
      1024,
      []
    )) {
      events.push(event)
    }

    expect(fetchMock).not.toHaveBeenCalled()
    expect(mockStreamText).toHaveBeenCalledTimes(1)
    expect(events).toEqual([])
  })

  it('includes an assistant role message for chat-audio TTS requests', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          choices: [
            {
              message: {
                audio: {
                  data: 'ZmFrZS1hdWRpby1iYXNlNjQ='
                }
              }
            }
          ]
        }),
        {
          status: 200,
          headers: {
            'Content-Type': 'application/json'
          }
        }
      )
    )
    vi.stubGlobal('fetch', fetchMock)

    const context = {
      providerKind: 'openai-compatible',
      provider: {
        id: 'xiaomimimo',
        apiType: 'openai-compatible',
        baseUrl: 'https://example.com/v1',
        apiKey: 'test-key'
      },
      providerSettings: createProviderSettings(),
      defaultHeaders: {},
      shouldUseTts: () => true
    } as any

    const events = []
    for await (const event of runAiSdkCoreStream(
      context,
      [{ role: 'user', content: 'hello tts' }],
      'mimo-v2.5-tts',
      {
        apiEndpoint: 'chat',
        tts: {
          responseFormat: 'wav',
          voice: 'alloy'
        }
      } as any,
      0.7,
      1024,
      []
    )) {
      events.push(event)
    }

    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(fetchMock.mock.calls[0]?.[0]).toBe('https://example.com/v1/chat/completions')

    const requestInit = fetchMock.mock.calls[0]?.[1] as RequestInit
    const payload = JSON.parse(String(requestInit.body)) as {
      messages?: Array<{ role?: string; content?: string }>
    }
    expect(payload.messages).toEqual([
      { role: 'user', content: 'hello tts' },
      { role: 'assistant', content: 'hello tts' }
    ])

    expect(events).toEqual([
      {
        type: 'image_data',
        image_data: {
          data: 'cached://image',
          mimeType: 'audio/wav'
        }
      },
      {
        type: 'stop',
        stop_reason: 'complete'
      }
    ])
  })

  it('extracts chat-audio TTS data from content audio parts', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          choices: [
            {
              message: {
                content: [
                  { type: 'text', text: 'ok' },
                  {
                    type: 'audio',
                    audio: {
                      data: 'ZmFrZS1hdWRpby1wYXJ0'
                    }
                  }
                ]
              }
            }
          ]
        }),
        {
          status: 200,
          headers: {
            'Content-Type': 'application/json'
          }
        }
      )
    )
    vi.stubGlobal('fetch', fetchMock)

    const context = {
      providerKind: 'openai-compatible',
      provider: {
        id: 'xiaomimimo',
        apiType: 'openai-compatible',
        baseUrl: 'https://example.com/v1',
        apiKey: 'test-key'
      },
      providerSettings: createProviderSettings(),
      defaultHeaders: {},
      shouldUseTts: () => true
    } as any

    const events = []
    for await (const event of runAiSdkCoreStream(
      context,
      [{ role: 'user', content: 'hello tts' }],
      'mimo-v2.5-tts',
      {
        apiEndpoint: 'chat',
        tts: {
          responseFormat: 'wav'
        }
      } as any,
      0.7,
      1024,
      []
    )) {
      events.push(event)
    }

    expect(events).toEqual([
      {
        type: 'image_data',
        image_data: {
          data: 'cached://image',
          mimeType: 'audio/wav'
        }
      },
      {
        type: 'stop',
        stop_reason: 'complete'
      }
    ])
  })

  it('fails cleanly when chat-audio TTS content is text without audio data', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          choices: [
            {
              message: {
                content: 'plain text response without audio'
              }
            }
          ]
        }),
        {
          status: 200,
          headers: {
            'Content-Type': 'application/json'
          }
        }
      )
    )
    vi.stubGlobal('fetch', fetchMock)

    const context = {
      providerKind: 'openai-compatible',
      provider: {
        id: 'xiaomimimo',
        apiType: 'openai-compatible',
        baseUrl: 'https://example.com/v1',
        apiKey: 'test-key'
      },
      providerSettings: createProviderSettings(),
      defaultHeaders: {},
      shouldUseTts: () => true
    } as any

    const drainStream = async () => {
      for await (const _event of runAiSdkCoreStream(
        context,
        [{ role: 'user', content: 'hello tts' }],
        'mimo-v2.5-tts',
        {
          apiEndpoint: 'chat',
          tts: {
            responseFormat: 'wav'
          }
        } as any,
        0.7,
        1024,
        []
      )) {
        // Drain stream.
      }
    }

    await expect(drainStream()).rejects.toThrow(
      'TTS response missing audio data in choices[0].message.audio.data'
    )
  })

  it('uses Gemini generateContent compatibility mode for AIHubMix Gemini TTS models', async () => {
    const pcmBase64 = Buffer.from([0, 0, 255, 127]).toString('base64')
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          candidates: [
            {
              content: {
                parts: [
                  {
                    inlineData: {
                      mimeType: 'audio/L16;rate=24000',
                      data: pcmBase64
                    }
                  }
                ]
              }
            }
          ]
        }),
        {
          status: 200,
          headers: {
            'Content-Type': 'application/json'
          }
        }
      )
    )
    vi.stubGlobal('fetch', fetchMock)

    const context = {
      providerKind: 'openai-compatible',
      provider: {
        id: 'aihubmix',
        apiType: 'openai-compatible',
        baseUrl: 'https://aihubmix.com/v1',
        apiKey: 'test-key'
      },
      providerSettings: createProviderSettings(),
      defaultHeaders: {
        'APP-Code': 'SMUE7630'
      },
      shouldUseTts: () => true
    } as any

    const events = []
    for await (const event of runAiSdkCoreStream(
      context,
      [{ role: 'user', content: 'Have a wonderful day!' }],
      'gemini-2.5-flash-preview-tts',
      {
        apiEndpoint: 'audio-speech',
        tts: {
          voice: 'Kore',
          instructions: 'Say cheerfully:'
        }
      } as any,
      0.7,
      1024,
      []
    )) {
      events.push(event)
    }

    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(fetchMock.mock.calls[0]?.[0]).toBe(
      'https://aihubmix.com/gemini/v1beta/models/gemini-2.5-flash-preview-tts:generateContent'
    )

    const requestInit = fetchMock.mock.calls[0]?.[1] as RequestInit
    const headers = new Headers(requestInit.headers)
    expect(headers.get('x-goog-api-key')).toBe('test-key')
    expect(headers.get('Authorization')).toBeNull()

    const payload = JSON.parse(String(requestInit.body)) as {
      contents?: Array<{ parts?: Array<{ text?: string }> }>
      generationConfig?: {
        responseModalities?: string[]
        speechConfig?: {
          voiceConfig?: {
            prebuiltVoiceConfig?: {
              voiceName?: string
            }
          }
        }
      }
    }
    expect(payload.contents?.[0]?.parts?.[0]?.text).toBe('Say cheerfully:\n\nHave a wonderful day!')
    expect(payload.generationConfig?.responseModalities).toEqual(['AUDIO'])
    expect(
      payload.generationConfig?.speechConfig?.voiceConfig?.prebuiltVoiceConfig?.voiceName
    ).toBe('Kore')

    expect(events).toEqual([
      {
        type: 'image_data',
        image_data: {
          data: 'cached://image',
          mimeType: 'audio/wav'
        }
      },
      {
        type: 'stop',
        stop_reason: 'complete'
      }
    ])
  })

  it('aborts the active video creation request and disposes request resources', async () => {
    vi.useFakeTimers()
    const fetchMock = vi.fn().mockImplementation((_url: string, options?: RequestInit) => {
      return new Promise((_resolve, reject) => {
        const requestSignal = options?.signal as AbortSignal
        if (requestSignal.aborted) {
          reject(requestSignal.reason)
          return
        }
        requestSignal.addEventListener('abort', () => reject(requestSignal.reason), { once: true })
      })
    })
    vi.stubGlobal('fetch', fetchMock)
    const caller = new AbortController()
    const reason = new DOMException('Memory request aborted', 'AbortError')
    const removeEventListener = vi.spyOn(caller.signal, 'removeEventListener')
    const context = {
      providerKind: 'openai-compatible',
      provider: {
        id: 'aihubmix',
        apiType: 'openai-compatible',
        baseUrl: 'https://aihubmix.com/v1',
        apiKey: 'test-key'
      },
      configPresenter: {},
      defaultHeaders: {},
      shouldUseVideoGeneration: () => true
    } as any

    const stream = (async () => {
      for await (const _event of runAiSdkCoreStream(
        context,
        [{ role: 'user', content: 'make a video' }],
        'video-model',
        { apiEndpoint: 'video', timeout: 60_000 } as any,
        0.7,
        1024,
        [],
        caller.signal
      )) {
        // Drain stream.
      }
    })()
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledOnce())
    caller.abort(reason)

    await expect(stream).rejects.toBe(reason)
    const creationSignal = (fetchMock.mock.calls[0]?.[1] as RequestInit).signal
    expect(creationSignal?.reason).toBe(reason)
    expect(removeEventListener).toHaveBeenCalledWith('abort', expect.any(Function))
    expect(vi.getTimerCount()).toBe(0)
  })

  it('aborts video generation while waiting to poll without starting another request', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ id: 'task-poll', status: 'submitted' }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' }
      })
    )
    vi.stubGlobal('fetch', fetchMock)
    const caller = new AbortController()
    const reason = { source: 'memory-caller' }
    const context = {
      providerKind: 'openai-compatible',
      provider: {
        id: 'aihubmix',
        apiType: 'openai-compatible',
        baseUrl: 'https://aihubmix.com/v1',
        apiKey: 'test-key'
      },
      configPresenter: {},
      defaultHeaders: {},
      shouldUseVideoGeneration: () => true
    } as any

    const stream = (async () => {
      for await (const _event of runAiSdkCoreStream(
        context,
        [{ role: 'user', content: 'make a video' }],
        'video-model',
        { apiEndpoint: 'video' } as any,
        0.7,
        1024,
        [],
        caller.signal
      )) {
        // Drain stream.
      }
    })()
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledOnce())
    caller.abort(reason)

    await expect(stream).rejects.toBe(reason)
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('aborts the video content download with the original caller reason', async () => {
    vi.useFakeTimers()
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ id: 'task-download', status: 'submitted' }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' }
        })
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            id: 'task-download',
            status: 'completed',
            url: 'https://cdn.example.com/video.mp4'
          }),
          {
            status: 200,
            headers: { 'Content-Type': 'application/json' }
          }
        )
      )
      .mockImplementationOnce((_url: string, options?: RequestInit) => {
        return new Promise((_resolve, reject) => {
          const requestSignal = options?.signal as AbortSignal
          requestSignal.addEventListener('abort', () => reject(requestSignal.reason), {
            once: true
          })
        })
      })
    vi.stubGlobal('fetch', fetchMock)
    const caller = new AbortController()
    const reason = new DOMException('Memory request aborted', 'AbortError')
    const context = {
      providerKind: 'openai-compatible',
      provider: {
        id: 'aihubmix',
        apiType: 'openai-compatible',
        baseUrl: 'https://aihubmix.com/v1',
        apiKey: 'test-key'
      },
      configPresenter: {},
      defaultHeaders: {},
      shouldUseVideoGeneration: () => true
    } as any

    const stream = (async () => {
      for await (const _event of runAiSdkCoreStream(
        context,
        [{ role: 'user', content: 'make a video' }],
        'video-model',
        { apiEndpoint: 'video' } as any,
        0.7,
        1024,
        [],
        caller.signal
      )) {
        // Drain stream.
      }
    })()
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledOnce())
    await vi.advanceTimersByTimeAsync(3_000)
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(3))
    caller.abort(reason)

    await expect(stream).rejects.toBe(reason)
    const downloadSignal = (fetchMock.mock.calls[2]?.[1] as RequestInit).signal
    expect(downloadSignal?.reason).toBe(reason)
    expect(vi.getTimerCount()).toBe(0)
  })

  it('does not inject unsupported Seedance duration from prompt text', async () => {
    vi.useFakeTimers()
    const videoBytes = Uint8Array.from([0, 1, 2, 3])
    const expectedBase64 = Buffer.from(videoBytes).toString('base64')
    const tracePayloads: Array<{ body?: Record<string, unknown> }> = []
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            id: 'task-video-1',
            status: 'submitted'
          }),
          {
            status: 200,
            headers: {
              'Content-Type': 'application/json'
            }
          }
        )
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            id: 'task-video-1',
            status: 'completed',
            url: 'https://cdn.example.com/video.mp4'
          }),
          {
            status: 200,
            headers: {
              'Content-Type': 'application/json'
            }
          }
        )
      )
      .mockResolvedValueOnce(
        new Response(videoBytes, {
          status: 200,
          headers: {
            'Content-Type': 'video/mp4'
          }
        })
      )
    vi.stubGlobal('fetch', fetchMock)

    const context = {
      providerKind: 'openai-compatible',
      provider: {
        id: 'aihubmix',
        apiType: 'openai-compatible',
        baseUrl: 'https://aihubmix.com/v1',
        apiKey: 'test-key'
      },
      providerSettings: createProviderSettings(),
      defaultHeaders: {
        'APP-Code': 'SMUE7630'
      },
      shouldUseVideoGeneration: () => true,
      emitRequestTrace: vi.fn(async (_modelConfig, payload) => {
        tracePayloads.push(payload)
      })
    } as any

    const eventsPromise = (async () => {
      const events = []
      for await (const event of runAiSdkCoreStream(
        context,
        [{ role: 'user', content: '生成 马斯克 喝酒的视频 2s' }],
        'doubao-seedance-2-0-fast-260128',
        {
          apiEndpoint: 'video'
        } as any,
        0.7,
        1024,
        []
      )) {
        events.push(event)
      }
      return events
    })()
    await vi.advanceTimersByTimeAsync(3_000)
    const events = await eventsPromise

    expect(fetchMock.mock.calls[0]?.[0]).toBe('https://aihubmix.com/v1/videos')

    const requestInit = fetchMock.mock.calls[0]?.[1] as RequestInit
    const payload = JSON.parse(String(requestInit.body)) as Record<string, unknown>
    expect(payload).toMatchObject({
      model: 'doubao-seedance-2-0-fast-260128',
      prompt: '生成 马斯克 喝酒的视频 2s'
    })
    expect(payload).not.toHaveProperty('duration')
    expect(tracePayloads[0]?.body).not.toHaveProperty('duration')

    expect(events).toEqual([
      {
        type: 'image_data',
        image_data: {
          data: `data:video/mp4;base64,${expectedBase64}`,
          mimeType: 'video/mp4'
        }
      },
      {
        type: 'stop',
        stop_reason: 'complete'
      }
    ])
  })

  it('derives supported Seedance duration from prompt text', async () => {
    vi.useFakeTimers()
    const videoBytes = Uint8Array.from([0, 1, 2, 3])
    const expectedBase64 = Buffer.from(videoBytes).toString('base64')
    const tracePayloads: Array<{ body?: Record<string, unknown> }> = []
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            id: 'task-video-2',
            status: 'submitted'
          }),
          {
            status: 200,
            headers: {
              'Content-Type': 'application/json'
            }
          }
        )
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            id: 'task-video-2',
            status: 'completed',
            url: 'https://cdn.example.com/video-supported.mp4'
          }),
          {
            status: 200,
            headers: {
              'Content-Type': 'application/json'
            }
          }
        )
      )
      .mockResolvedValueOnce(
        new Response(videoBytes, {
          status: 200,
          headers: {
            'Content-Type': 'video/mp4'
          }
        })
      )
    vi.stubGlobal('fetch', fetchMock)

    const context = {
      providerKind: 'openai-compatible',
      provider: {
        id: 'aihubmix',
        apiType: 'openai-compatible',
        baseUrl: 'https://aihubmix.com/v1',
        apiKey: 'test-key'
      },
      providerSettings: createProviderSettings(),
      defaultHeaders: {
        'APP-Code': 'SMUE7630'
      },
      shouldUseVideoGeneration: () => true,
      emitRequestTrace: vi.fn(async (_modelConfig, payload) => {
        tracePayloads.push(payload)
      })
    } as any

    const eventsPromise = (async () => {
      const events = []
      for await (const event of runAiSdkCoreStream(
        context,
        [{ role: 'user', content: '生成 马斯克 喝酒的视频 5s' }],
        'doubao-seedance-2-0-fast-260128',
        {
          apiEndpoint: 'video'
        } as any,
        0.7,
        1024,
        []
      )) {
        events.push(event)
      }
      return events
    })()
    await vi.advanceTimersByTimeAsync(3_000)
    const events = await eventsPromise

    const requestInit = fetchMock.mock.calls[0]?.[1] as RequestInit
    const payload = JSON.parse(String(requestInit.body)) as Record<string, unknown>
    expect(payload).toMatchObject({
      model: 'doubao-seedance-2-0-fast-260128',
      prompt: '生成 马斯克 喝酒的视频 5s',
      duration: 5
    })
    expect(tracePayloads[0]?.body).toMatchObject({
      duration: 5
    })

    expect(events).toEqual([
      {
        type: 'image_data',
        image_data: {
          data: `data:video/mp4;base64,${expectedBase64}`,
          mimeType: 'video/mp4'
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
      providerSettings: {
        ...createProviderSettings(),
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

  it.each(['anthropic/claude-opus-4-7', 'claude-opus-4-7-think'])(
    'omits temperature when mapped capability routing disables temperature control for %s',
    async (modelId) => {
      const tracePayloads: Array<{ body?: Record<string, unknown> }> = []
      const context = {
        providerKind: 'openai-compatible',
        provider: {
          id: 'aihubmix',
          apiType: 'openai-compatible'
        },
        providerSettings: {
          ...createProviderSettings(),
          getCapabilityProviderId: vi.fn().mockReturnValue('anthropic'),
          supportsTemperatureControl: vi.fn().mockReturnValue(false)
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
        modelId,
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
      expect(context.providerSettings.getCapabilityProviderId).toHaveBeenCalledWith(
        'aihubmix',
        modelId
      )
      expect(context.providerSettings.supportsTemperatureControl).toHaveBeenCalledWith(
        'anthropic',
        modelId
      )
      expect(request).not.toHaveProperty('temperature')
      expect(tracePayloads[0]?.body).not.toHaveProperty('temperature')
      expect(events).toEqual([])
    }
  )

  it('omits temperature and topP for new-api anthropic routes that disable sampling controls', async () => {
    const tracePayloads: Array<{ body?: Record<string, unknown> }> = []
    const context = {
      providerKind: 'anthropic',
      provider: {
        id: 'new-api',
        apiType: 'anthropic',
        capabilityProviderId: 'anthropic'
      },
      providerSettings: {
        ...createProviderSettings(),
        getCapabilityProviderId: vi.fn().mockReturnValue('anthropic'),
        supportsTemperatureControl: vi.fn().mockReturnValue(false)
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
      'claude-opus-4-8',
      {
        apiEndpoint: 'chat',
        functionCall: false,
        topP: 0.5
      } as any,
      0.5,
      2048,
      []
    )) {
      events.push(event)
    }

    const request = mockStreamText.mock.calls[0]?.[0] as Record<string, unknown>
    expect(context.providerSettings.supportsTemperatureControl).toHaveBeenCalledWith(
      'anthropic',
      'claude-opus-4-8'
    )
    expect(request).not.toHaveProperty('temperature')
    expect(request).not.toHaveProperty('topP')
    expect(tracePayloads[0]?.body).not.toHaveProperty('temperature')
    expect(tracePayloads[0]?.body).not.toHaveProperty('topP')
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
      providerSettings: {
        ...createProviderSettings(),
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

  it('forces Moonshot Kimi temperature to 1.0 when reasoning is enabled', async () => {
    const tracePayloads: Array<{ body?: Record<string, unknown> }> = []
    const context = {
      providerKind: 'openai-compatible',
      provider: {
        id: 'moonshot',
        apiType: 'openai-compatible'
      },
      providerSettings: createProviderSettings(),
      defaultHeaders: {},
      emitRequestTrace: vi.fn(async (_modelConfig, payload) => {
        tracePayloads.push(payload)
      })
    } as any

    await runAiSdkGenerateText(
      context,
      [],
      'moonshotai/kimi-k2.6',
      {
        apiEndpoint: 'chat',
        reasoning: true
      } as any,
      0.6,
      1024
    )

    const request = mockGenerateText.mock.calls[0]?.[0] as Record<string, unknown>
    expect(request).toHaveProperty('temperature', 1)
    expect(tracePayloads[0]?.body).toHaveProperty('temperature', 1)
  })

  it('forces Moonshot Kimi temperature to 0.6 when reasoning is disabled', async () => {
    const tracePayloads: Array<{ body?: Record<string, unknown> }> = []
    const context = {
      providerKind: 'openai-compatible',
      provider: {
        id: 'moonshot',
        apiType: 'openai-compatible'
      },
      providerSettings: createProviderSettings(),
      defaultHeaders: {},
      emitRequestTrace: vi.fn(async (_modelConfig, payload) => {
        tracePayloads.push(payload)
      })
    } as any

    const events = []
    for await (const event of runAiSdkCoreStream(
      context,
      [],
      'moonshotai/kimi-k2.6',
      {
        apiEndpoint: 'chat',
        reasoning: false,
        functionCall: false
      } as any,
      1,
      2048,
      []
    )) {
      events.push(event)
    }

    const request = mockStreamText.mock.calls[0]?.[0] as Record<string, unknown>
    expect(request).toHaveProperty('temperature', 0.6)
    expect(tracePayloads[0]?.body).toHaveProperty('temperature', 0.6)
    expect(events).toEqual([])
  })

  it('passes anthropic adaptive reasoning options through runtime context for zenmux routes', async () => {
    mockCreateAiSdkProviderContext.mockReturnValue({
      providerOptionsKey: 'anthropic',
      apiType: 'anthropic',
      model: {}
    })
    const portraitSpy = vi.spyOn(modelCapabilities, 'getReasoningPortrait').mockReturnValue({
      supported: true,
      defaultEnabled: false,
      mode: 'effort',
      effort: 'high',
      effortOptions: ['low', 'medium', 'high', 'xhigh', 'max'],
      visibility: 'omitted'
    })
    const context = {
      providerKind: 'anthropic',
      provider: {
        id: 'zenmux',
        apiType: 'anthropic',
        capabilityProviderId: 'anthropic'
      },
      supportsOfficialAnthropicReasoning: true,
      providerSettings: {
        ...createProviderSettings(),
        getCapabilityProviderId: vi.fn().mockReturnValue('anthropic'),
        supportsTemperatureControl: vi.fn().mockReturnValue(true)
      },
      defaultHeaders: {}
    } as any

    await runAiSdkGenerateText(
      context,
      [],
      'anthropic/claude-opus-4-7',
      {
        apiEndpoint: 'chat',
        reasoning: true,
        reasoningEffort: 'max',
        reasoningVisibility: 'summarized'
      } as any,
      0.6,
      1024
    )

    const request = mockGenerateText.mock.calls[0]?.[0] as Record<string, unknown>

    expect(portraitSpy).toHaveBeenCalledWith('anthropic', 'anthropic/claude-opus-4-7')
    expect(request.providerOptions).toMatchObject({
      anthropic: {
        toolStreaming: true,
        sendReasoning: true,
        effort: 'max',
        thinking: {
          type: 'adaptive',
          display: 'summarized'
        }
      }
    })

    portraitSpy.mockRestore()
  })
})
