import { afterEach, describe, expect, it, vi } from 'vitest'

import { VoiceAIProvider } from '@/provider/providers/voiceAIProvider'

describe('VoiceAIProvider text cancellation', () => {
  afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllGlobals()
  })

  it('forwards caller cancellation to the speech fetch request', async () => {
    const fetchMock = vi.fn().mockImplementation((_url: string, options?: RequestInit) => {
      return new Promise((_, reject) => {
        const signal = options?.signal as AbortSignal | undefined
        signal?.addEventListener('abort', () => reject(signal.reason), { once: true })
      })
    })
    vi.stubGlobal('fetch', fetchMock)

    const provider = Object.create(VoiceAIProvider.prototype) as VoiceAIProvider & {
      provider: { id: string; name: string; apiKey: string; baseUrl: string }
      providerSettings: {
        getModelConfig: ReturnType<typeof vi.fn>
        getVoiceAiConfig: ReturnType<typeof vi.fn>
      }
      defaultHeaders: Record<string, string>
    }
    provider.provider = {
      id: 'voiceai',
      name: 'VoiceAI',
      apiKey: 'test-key',
      baseUrl: 'https://voice.example.com'
    }
    provider.providerSettings = {
      getModelConfig: vi.fn().mockReturnValue({}),
      getVoiceAiConfig: vi.fn().mockReturnValue({})
    }
    provider.defaultHeaders = {}
    const controller = new AbortController()
    const reason = new DOMException('Memory request aborted', 'AbortError')

    const generating = provider.generateText('hello', 'default', undefined, undefined, {
      signal: controller.signal
    })
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledOnce())
    controller.abort(reason)

    await expect(generating).rejects.toBe(reason)
    expect(fetchMock).toHaveBeenCalledWith(
      'https://voice.example.com/api/v1/tts/speech',
      expect.objectContaining({ signal: controller.signal })
    )
  })

  it.each([
    {
      name: 'invalid language',
      apiKey: 'test-key',
      language: 'invalid-language',
      expectedError: 'Unsupported language code'
    },
    {
      name: 'missing API key',
      apiKey: '',
      language: undefined,
      expectedError: 'API key is required'
    }
  ])('disposes timeout and caller listeners after $name validation', async (scenario) => {
    vi.useFakeTimers()
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    const provider = Object.create(VoiceAIProvider.prototype) as any
    provider.provider = {
      id: 'voiceai',
      name: 'VoiceAI',
      apiKey: scenario.apiKey,
      baseUrl: 'https://voice.example.com'
    }
    provider.providerSettings = {
      getModelConfig: vi.fn().mockReturnValue({ timeout: 25 }),
      getVoiceAiConfig: vi.fn().mockReturnValue({ language: scenario.language })
    }
    provider.defaultHeaders = {}
    const controller = new AbortController()
    const addEventListener = vi.spyOn(controller.signal, 'addEventListener')
    const removeEventListener = vi.spyOn(controller.signal, 'removeEventListener')

    await expect(
      provider.generateText('hello', 'default', undefined, undefined, {
        signal: controller.signal
      })
    ).rejects.toThrow(scenario.expectedError)

    expect(fetchMock).not.toHaveBeenCalled()
    expect(addEventListener).toHaveBeenCalledWith('abort', expect.any(Function), { once: true })
    expect(removeEventListener).toHaveBeenCalledWith('abort', expect.any(Function))
    expect(vi.getTimerCount()).toBe(0)
  })

  it('rethrows caller cancellation from a speech stream', async () => {
    const fetchMock = vi.fn().mockImplementation((_url: string, options?: RequestInit) => {
      return new Promise((_, reject) => {
        const signal = options?.signal as AbortSignal | undefined
        signal?.addEventListener('abort', () => reject(signal.reason), { once: true })
      })
    })
    vi.stubGlobal('fetch', fetchMock)

    const provider = Object.create(VoiceAIProvider.prototype) as any
    provider.provider = {
      id: 'voiceai',
      name: 'VoiceAI',
      apiKey: 'test-key',
      baseUrl: 'https://voice.example.com'
    }
    provider.providerSettings = {
      getVoiceAiConfig: vi.fn().mockReturnValue({})
    }
    provider.defaultHeaders = {}
    const controller = new AbortController()
    const reason = new DOMException('Run aborted', 'AbortError')

    const next = provider
      .coreStream([{ role: 'user', content: 'hello' }], 'default', {}, 1, 1024, [], {
        signal: controller.signal
      })
      .next()
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledOnce())
    controller.abort(reason)

    await expect(next).rejects.toBe(reason)
  })

  it('prioritizes a pre-aborted Run over input validation', async () => {
    const provider = Object.create(VoiceAIProvider.prototype) as any
    const controller = new AbortController()
    const reason = new DOMException('Run already aborted', 'AbortError')
    controller.abort(reason)

    await expect(
      provider.coreStream([], 'default', {}, 1, 1024, [], { signal: controller.signal }).next()
    ).rejects.toBe(reason)
  })

  it('aborts a hung voice list after the model fetch timeout', async () => {
    vi.useFakeTimers()
    const fetchMock = vi.fn().mockImplementation((_url: string, options?: RequestInit) => {
      return new Promise((_, reject) => {
        const signal = options?.signal as AbortSignal | undefined
        signal?.addEventListener('abort', () => reject(signal.reason), { once: true })
      })
    })
    vi.stubGlobal('fetch', fetchMock)

    const provider = Object.create(VoiceAIProvider.prototype) as VoiceAIProvider & {
      provider: { id: string; name: string; apiKey: string; baseUrl: string }
      defaultHeaders: Record<string, string>
      getModelFetchTimeout: () => number
    }
    provider.provider = {
      id: 'voiceai',
      name: 'VoiceAI',
      apiKey: 'test-key',
      baseUrl: 'https://voice.example.com'
    }
    provider.defaultHeaders = {}
    provider.getModelFetchTimeout = () => 25

    const checking = provider.check()
    await Promise.resolve()
    expect(fetchMock).toHaveBeenCalledWith(
      'https://voice.example.com/api/v1/tts/voices',
      expect.objectContaining({ signal: expect.any(AbortSignal) })
    )
    await vi.advanceTimersByTimeAsync(25)
    await expect(checking).resolves.toEqual({
      isOk: false,
      errorMsg: 'Request timed out after 25ms'
    })
  })

  it('emits allowlisted HTTP failure metadata without the response body', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response('{"secret":"response-body"}', {
          status: 429,
          statusText: 'Too Many Requests',
          headers: {
            'retry-after-ms': '750',
            'x-secret': 'hidden'
          }
        })
      )
    )
    const provider = Object.create(VoiceAIProvider.prototype) as any
    provider.provider = {
      id: 'voiceai',
      name: 'VoiceAI',
      apiKey: 'test-key',
      baseUrl: 'https://voice.example.com'
    }
    provider.providerSettings = {
      getVoiceAiConfig: vi.fn().mockReturnValue({})
    }
    provider.defaultHeaders = {}

    const events = []
    for await (const event of provider.coreStream(
      [{ role: 'user', content: 'hello' }],
      'default',
      {},
      1,
      1024,
      []
    )) {
      events.push(event)
    }

    expect(events).toEqual([
      {
        type: 'error',
        error_message: 'Voice.ai generate speech failed: 429 Too Many Requests',
        failure: {
          statusCode: 429,
          code: 'voiceai_speech_http_error',
          retryHeaders: { 'retry-after-ms': '750' }
        }
      },
      { type: 'stop', stop_reason: 'error' }
    ])
    expect(JSON.stringify(events)).not.toContain('response-body')
  })
})
