import type { LLM_EMBEDDING_ATTRS } from '@shared/types/provider'
import { EMBEDDING_TEST_KEY, isNormalized } from '@/utils/vector'
import type { DimModelCatalog } from './modelCatalog'
import type { DimModelBridge } from './modelBridge'

/** Bounded transport pages only; dim resolves connections, batches and executes inference. */
export class DimEmbeddingModels {
  constructor(
    private readonly options: {
      models: Pick<DimModelCatalog, 'admit'>
      bridge: Pick<DimModelBridge, 'embed'>
    }
  ) {}

  async getEmbeddings(
    providerId: string,
    modelId: string,
    texts: string[],
    signal?: AbortSignal
  ): Promise<number[][]> {
    signal?.throwIfAborted()
    if (!texts.length) return []
    const model = await this.options.models.admit(providerId, modelId)
    signal?.throwIfAborted()
    const vectors: number[][] = []
    let dimensions: number | undefined
    for (let offset = 0; offset < texts.length; offset += 32) {
      signal?.throwIfAborted()
      const values = texts.slice(offset, offset + 32)
      const reply = await this.options.bridge.embed(model, values, signal)
      signal?.throwIfAborted()
      if (reply.vectors.length !== values.length)
        throw new Error('Missing native embedding vectors')
      for (const vector of reply.vectors) {
        dimensions ??= vector.length
        if (
          !dimensions ||
          vector.length !== dimensions ||
          vector.some((value) => !Number.isFinite(value))
        )
          throw new Error('Invalid native embedding dimensions')
        vectors.push(vector)
      }
    }
    return vectors
  }

  async getDimensions(
    providerId: string,
    modelId: string,
    signal?: AbortSignal
  ): Promise<{ data: LLM_EMBEDDING_ATTRS; errorMsg?: string }> {
    try {
      const [vector] = await this.getEmbeddings(providerId, modelId, [EMBEDDING_TEST_KEY], signal)
      return { data: { dimensions: vector.length, normalized: isNormalized(vector) } }
    } catch (error) {
      signal?.throwIfAborted()
      return {
        data: { dimensions: 0, normalized: false },
        errorMsg: error instanceof Error ? error.message : String(error)
      }
    }
  }
}
