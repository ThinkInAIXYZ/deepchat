import { describe, expect, it, vi } from 'vitest'

import { createMemoryProviderBindings } from '@/presenter/memoryProviderBindings'
import type { ILlmProviderPresenter } from '@shared/presenter'

type MemoryLlmProviderPort = Pick<
  ILlmProviderPresenter,
  'executeWithRateLimit' | 'getEmbeddings' | 'getDimensions' | 'generateText'
>

function createLlmProviderPort(): MemoryLlmProviderPort {
  return {
    executeWithRateLimit: vi.fn(async () => undefined),
    getEmbeddings: vi.fn(async () => [[1, 2, 3]]),
    getDimensions: vi.fn(async () => ({ data: { dimensions: 3, normalized: false } })),
    generateText: vi.fn(async () => ({ content: 'generated' }))
  }
}

describe('createMemoryProviderBindings', () => {
  it('forwards the exact caller signal across every provider binding', async () => {
    const llmProviderPresenter = createLlmProviderPort()
    const bindings = createMemoryProviderBindings(llmProviderPresenter)
    const signal = new AbortController().signal

    await bindings.executeWithRateLimit('provider', { signal, purpose: 'decision' })
    await bindings.getEmbeddings('provider', 'embedding-model', ['value'], signal)
    await bindings.getDimensions('provider', 'embedding-model', signal)
    await expect(bindings.generateText('provider', 'text-model', 'prompt', signal)).resolves.toBe(
      'generated'
    )

    expect(llmProviderPresenter.executeWithRateLimit).toHaveBeenCalledWith('provider', { signal })
    expect(llmProviderPresenter.getEmbeddings).toHaveBeenCalledWith(
      'provider',
      'embedding-model',
      ['value'],
      signal
    )
    expect(llmProviderPresenter.getDimensions).toHaveBeenCalledWith(
      'provider',
      'embedding-model',
      signal
    )
    expect(llmProviderPresenter.generateText).toHaveBeenCalledWith(
      'provider',
      'prompt',
      'text-model',
      0.2,
      undefined,
      { signal }
    )
  })
})
