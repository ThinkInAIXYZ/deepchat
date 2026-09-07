import { describe, expect, it, vi } from 'vitest'

const { mockRunAiSdkCoreStream, mockRunAiSdkGenerateText } = vi.hoisted(() => ({
  mockRunAiSdkCoreStream: vi.fn(async function* () {}),
  mockRunAiSdkGenerateText: vi.fn().mockResolvedValue({ content: 'generated' })
}))

vi.mock('@/provider/aiSdk', () => ({
  runAiSdkCoreStream: mockRunAiSdkCoreStream,
  runAiSdkDimensions: vi.fn(),
  runAiSdkEmbeddings: vi.fn(),
  runAiSdkGenerateText: mockRunAiSdkGenerateText
}))

vi.mock('ollama', () => ({
  Ollama: class MockOllama {}
}))

import { OllamaProvider } from '@/provider/providers/ollamaProvider'

describe('OllamaProvider text cancellation', () => {
  it('forwards the caller signal to the shared AI SDK runtime', async () => {
    const provider = Object.create(OllamaProvider.prototype) as any
    provider.provider = { id: 'ollama' }
    provider.providerSettings = {
      getModelConfig: vi.fn().mockReturnValue({ apiEndpoint: 'chat' })
    }
    provider.getAiSdkRuntimeContext = vi.fn().mockReturnValue({ providerKind: 'openai-compatible' })
    const signal = new AbortController().signal

    await provider.generateText('prompt', 'llama3', 0.2, 128, { signal })

    expect(mockRunAiSdkGenerateText).toHaveBeenCalledWith(
      { providerKind: 'openai-compatible' },
      [{ role: 'user', content: 'prompt' }],
      'llama3',
      { apiEndpoint: 'chat' },
      0.2,
      128,
      signal
    )
  })

  it('forwards stream cancellation to the shared AI SDK runtime', async () => {
    const provider = Object.create(OllamaProvider.prototype) as any
    provider.getAiSdkRuntimeContext = vi.fn().mockReturnValue({ providerKind: 'openai-compatible' })
    const signal = new AbortController().signal

    for await (const _event of provider.coreStream(
      [{ role: 'user', content: 'prompt' }],
      'llama3',
      { apiEndpoint: 'chat' },
      0.2,
      128,
      [],
      { signal }
    )) {
      // The mocked runtime intentionally emits no events.
    }

    expect(mockRunAiSdkCoreStream).toHaveBeenCalledWith(
      { providerKind: 'openai-compatible' },
      [{ role: 'user', content: 'prompt' }],
      'llama3',
      { apiEndpoint: 'chat' },
      0.2,
      128,
      [],
      signal
    )
  })
})
