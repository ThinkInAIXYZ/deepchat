import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

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
  runAiSdkGenerateText
} from '@/presenter/llmProviderPresenter/aiSdk/runtime'
import { modelCapabilities } from '@/presenter/configPresenter/modelCapabilities'

describe('AI SDK runtime', () => {
  const createTextRuntimeContext = (overrides: Record<string, unknown> = {}) =>
    ({
      providerKind: 'openai-compatible',
      provider: {
        id: 'openai',
        apiType: 'openai-compatible'
      },
      configPresenter: {},
      defaultHeaders: {},
      ...overrides
    }) as any

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
  })

  afterEach(() => {
    vi.unstubAllGlobals()
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

  it('does not forward gpt-image-2 image options when the config is empty', async () => {
    const context = {
      providerKind: 'openai-responses',
      provider: {
        id: 'openai',
        apiType: 'openai'
      },
      configPresenter: {},
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
      configPresenter: {},
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
      configPresenter: {},
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
      configPresenter: {},
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
      configPresenter: {},
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
      configPresenter: {},
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
      configPresenter: {},
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
      configPresenter: {},
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
      configPresenter: {},
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
      configPresenter: {},
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

  it('does not inject unsupported Seedance duration from prompt text', async () => {
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
      configPresenter: {},
      defaultHeaders: {
        'APP-Code': 'SMUE7630'
      },
      shouldUseVideoGeneration: () => true,
      emitRequestTrace: vi.fn(async (_modelConfig, payload) => {
        tracePayloads.push(payload)
      })
    } as any

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
      configPresenter: {},
      defaultHeaders: {
        'APP-Code': 'SMUE7630'
      },
      shouldUseVideoGeneration: () => true,
      emitRequestTrace: vi.fn(async (_modelConfig, payload) => {
        tracePayloads.push(payload)
      })
    } as any

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
        configPresenter: {
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
      expect(context.configPresenter.getCapabilityProviderId).toHaveBeenCalledWith(
        'aihubmix',
        modelId
      )
      expect(context.configPresenter.supportsTemperatureControl).toHaveBeenCalledWith(
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
      configPresenter: {
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
    expect(context.configPresenter.supportsTemperatureControl).toHaveBeenCalledWith(
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

  it('forces Moonshot Kimi temperature to 1.0 when reasoning is enabled', async () => {
    const tracePayloads: Array<{ body?: Record<string, unknown> }> = []
    const context = {
      providerKind: 'openai-compatible',
      provider: {
        id: 'moonshot',
        apiType: 'openai-compatible'
      },
      configPresenter: {},
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
      configPresenter: {},
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
      configPresenter: {
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
