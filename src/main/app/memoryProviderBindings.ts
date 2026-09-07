import type { ProviderRuntimePort } from '@shared/types/provider'
import type { MemoryServiceDeps } from '@/memory/types'

type MemoryProviderBindings = Pick<
  MemoryServiceDeps,
  'executeWithRateLimit' | 'getEmbeddings' | 'getDimensions' | 'generateText'
>

type MemoryLlmProviderPort = Pick<
  ProviderRuntimePort,
  'executeWithRateLimit' | 'getEmbeddings' | 'getDimensions' | 'generateText'
>

export function createMemoryProviderBindings(
  providerRuntime: MemoryLlmProviderPort
): MemoryProviderBindings {
  return {
    executeWithRateLimit: (providerId, options) =>
      providerRuntime.executeWithRateLimit(providerId, { signal: options.signal }),
    getEmbeddings: (providerId, modelId, texts, signal) =>
      providerRuntime.getEmbeddings(providerId, modelId, texts, signal),
    getDimensions: (providerId, modelId, signal) =>
      providerRuntime.getDimensions(providerId, modelId, signal),
    generateText: async (providerId, modelId, prompt, signal) =>
      (
        await providerRuntime.generateText(providerId, prompt, modelId, 0.2, undefined, {
          signal
        })
      ).content ?? ''
  }
}
