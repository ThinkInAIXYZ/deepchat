import type { ILlmProviderPresenter } from '@shared/presenter'

import type { MemoryPresenterDeps } from './memoryPresenter/types'

type MemoryProviderBindings = Pick<
  MemoryPresenterDeps,
  'executeWithRateLimit' | 'getEmbeddings' | 'getDimensions' | 'generateText'
>

type MemoryLlmProviderPort = Pick<
  ILlmProviderPresenter,
  'executeWithRateLimit' | 'getEmbeddings' | 'getDimensions' | 'generateText'
>

export function createMemoryProviderBindings(
  llmProviderPresenter: MemoryLlmProviderPort
): MemoryProviderBindings {
  return {
    executeWithRateLimit: (providerId, options) =>
      llmProviderPresenter.executeWithRateLimit(providerId, { signal: options.signal }),
    getEmbeddings: (providerId, modelId, texts, signal) =>
      llmProviderPresenter.getEmbeddings(providerId, modelId, texts, signal),
    getDimensions: (providerId, modelId, signal) =>
      llmProviderPresenter.getDimensions(providerId, modelId, signal),
    generateText: async (providerId, modelId, prompt, signal) =>
      (
        await llmProviderPresenter.generateText(providerId, prompt, modelId, 0.2, undefined, {
          signal
        })
      ).content ?? ''
  }
}
