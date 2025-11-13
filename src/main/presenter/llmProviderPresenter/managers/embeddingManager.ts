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
      console.error(`${modelId} embedding failed:`, error)
      throw new Error('Current LLM provider does not implement embedding capability')
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
