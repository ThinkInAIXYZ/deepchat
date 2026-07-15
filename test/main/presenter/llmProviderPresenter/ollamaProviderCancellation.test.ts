import { describe, expect, it, vi } from 'vitest'

const { mockRunAiSdkGenerateText } = vi.hoisted(() => ({
  mockRunAiSdkGenerateText: vi.fn().mockResolvedValue({ content: 'generated' })
}))

vi.mock('@/presenter/llmProviderPresenter/aiSdk', () => ({
  runAiSdkCoreStream: vi.fn(),
  runAiSdkDimensions: vi.fn(),
  runAiSdkEmbeddings: vi.fn(),
  runAiSdkGenerateText: mockRunAiSdkGenerateText
}))

vi.mock('ollama', () => ({
  Ollama: class MockOllama {}
}))

import { OllamaProvider } from '@/presenter/llmProviderPresenter/providers/ollamaProvider'

describe('OllamaProvider text cancellation', () => {
  it('forwards the caller signal to the shared AI SDK runtime', async () => {
    const provider = Object.create(OllamaProvider.prototype) as any
    provider.provider = { id: 'ollama' }
    provider.configPresenter = {
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
})
