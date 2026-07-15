import { afterEach, describe, expect, it, vi } from 'vitest'

import { VoiceAIProvider } from '@/presenter/llmProviderPresenter/providers/voiceAIProvider'

vi.mock('@/presenter/proxyConfig', () => ({
  proxyConfig: {
    getProxyUrl: vi.fn().mockReturnValue(null)
  }
}))

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
      configPresenter: {
        getModelConfig: ReturnType<typeof vi.fn>
        getSetting: ReturnType<typeof vi.fn>
      }
      defaultHeaders: Record<string, string>
    }
    provider.provider = {
      id: 'voiceai',
      name: 'VoiceAI',
      apiKey: 'test-key',
      baseUrl: 'https://voice.example.com'
    }
    provider.configPresenter = {
      getModelConfig: vi.fn().mockReturnValue({}),
      getSetting: vi.fn().mockReturnValue(undefined)
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
    provider.configPresenter = {
      getModelConfig: vi.fn().mockReturnValue({ timeout: 25 }),
      getSetting: vi.fn((key: string) =>
        key === 'voiceAI_language' ? scenario.language : undefined
      )
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
})
