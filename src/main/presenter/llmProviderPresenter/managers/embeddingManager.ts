import { LLM_EMBEDDING_ATTRS } from '@shared/presenter'
import { BaseLLMProvider } from '../baseProvider'

interface EmbeddingManagerOptions {
  getProviderInstance: (providerId: string) => BaseLLMProvider
}

export class EmbeddingManager {
  constructor(private readonly options: EmbeddingManagerOptions) {}

  async getEmbeddings(providerId: string, modelId: string, texts: string[]): Promise<number[][]> {
    try {
      const provider = this.options.getProviderInstance(providerId)
      return await provider.getEmbeddings(modelId, texts)
    } catch (error) {
      console.error(`Embedding failed for providerId: ${providerId}, modelId: ${modelId}:`, error)

      // Re-throw the original error to preserve the real failure reason
      if (error instanceof Error) {
        throw error
      } else {
        throw new Error(
          `Embedding failed for provider ${providerId}, model ${modelId}: ${String(error)}`
        )
      }
    }
  }

  async getDimensions(
    providerId: string,
    modelId: string
  ): Promise<{ data: LLM_EMBEDDING_ATTRS; errorMsg?: string }> {
    try {
      const provider = this.options.getProviderInstance(providerId)
      return { data: await provider.getDimensions(modelId) }
    } catch (error) {
      console.error(`Failed to get embedding dimensions for model ${modelId}:`, error)
      return {
        data: {
          dimensions: 0,
          normalized: false
        },
        errorMsg: error instanceof Error ? error.message : String(error)
      }
    }
  }
}
