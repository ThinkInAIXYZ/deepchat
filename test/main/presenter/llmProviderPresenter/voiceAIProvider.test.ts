import { afterEach, expect, it, vi } from 'vitest'
import { VoiceAIProvider } from '../../../../src/main/presenter/llmProviderPresenter/providers/voiceAIProvider'

afterEach(() => {
  vi.unstubAllGlobals()
})

it('rejects Voice.ai model probes before starting billable speech generation', async () => {
  const fetchMock = vi.fn()
  vi.stubGlobal('fetch', fetchMock)
  const provider = Object.create(VoiceAIProvider.prototype) as VoiceAIProvider & {
    provider: { id: string; name: string; apiKey: string }
  }
  provider.provider = {
    id: 'voiceai',
    name: 'Voice.ai',
    apiKey: 'test-key'
  }

  await expect(provider.check({ modelId: 'voice-1' })).resolves.toEqual({
    isOk: false,
    errorMsg:
      'Connection testing is not supported for Voice.ai models because it would generate billable audio',
    code: 'unsupported'
  })
  expect(fetchMock).not.toHaveBeenCalled()
})

it('propagates owner cancellation through the Voice.ai voice-list request', async () => {
  const fetchMock = vi.fn((_url: string, init?: RequestInit) => {
    return new Promise<Response>((_, reject) => {
      const signal = init?.signal as AbortSignal | undefined
      signal?.addEventListener('abort', () => reject(signal.reason), { once: true })
    })
  })
  vi.stubGlobal('fetch', fetchMock)
  const provider = Object.create(VoiceAIProvider.prototype) as VoiceAIProvider & {
    provider: { id: string; name: string; apiKey: string; baseUrl: string }
  }
  provider.provider = {
    id: 'voiceai',
    name: 'Voice.ai',
    apiKey: 'test-key',
    baseUrl: 'https://dev.voice.ai'
  }
  const controller = new AbortController()

  const checking = provider.check({ signal: controller.signal })
  controller.abort(new Error('owner cancelled'))

  await expect(checking).resolves.toEqual({ isOk: false, errorMsg: 'owner cancelled' })
  expect(fetchMock).toHaveBeenCalledWith(
    'https://dev.voice.ai/api/v1/tts/voices',
    expect.objectContaining({ signal: controller.signal })
  )
})
