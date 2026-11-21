import { afterEach, describe, expect, it, vi } from 'vitest'

import { VoiceAIProvider } from '@/provider/providers/voiceAIProvider'

describe('VoiceAIProvider metadata timeouts', () => {
  afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllGlobals()
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
})
