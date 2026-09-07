import { beforeEach, describe, expect, it } from 'vitest'
import { embedMany, wrapEmbeddingModel } from 'ai'
import {
  clearLearnedEmbeddingBatchLimits,
  EMBEDDING_BATCH_LIMIT_TTL_MS,
  learnEmbeddingBatchLimit,
  refreshLearnedEmbeddingBatchLimit,
  resolveEmbeddingBatchLimit
} from '@/provider/aiSdk/embeddingBatchLimits'

describe('embedding batch limits', () => {
  beforeEach(() => {
    clearLearnedEmbeddingBatchLimits()
  })

  it('matches canonical text-embedding-v4 model IDs exactly', () => {
    expect(resolveEmbeddingBatchLimit('new-api', 'text-embedding-v4')).toBe(10)
    expect(resolveEmbeddingBatchLimit('new-api', 'alibaba/text-embedding-v4')).toBe(10)
    expect(resolveEmbeddingBatchLimit('new-api', 'dashscope.text-embedding-v4')).toBe(10)
    expect(resolveEmbeddingBatchLimit('new-api', 'text-embedding-v4-large')).toBeUndefined()
  })

  it('isolates learned limits by provider and canonical model ID', () => {
    learnEmbeddingBatchLimit('provider-a', 'vendor/embedding-model-a', 8, 50, 0)

    expect(resolveEmbeddingBatchLimit('provider-a', 'embedding-model-a', 1)).toBe(8)
    expect(resolveEmbeddingBatchLimit('provider-b', 'embedding-model-a', 1)).toBeUndefined()
    expect(resolveEmbeddingBatchLimit('provider-a', 'embedding-model-b', 1)).toBeUndefined()
  })

  it('takes the minimum static and learned limit and never learns a larger limit', () => {
    expect(learnEmbeddingBatchLimit('new-api', 'text-embedding-v4', 8, 10, 0)).toBe(8)
    expect(resolveEmbeddingBatchLimit('new-api', 'text-embedding-v4', 1)).toBe(8)

    expect(learnEmbeddingBatchLimit('new-api', 'text-embedding-v4', 9, 50, 2)).toBe(8)
    expect(resolveEmbeddingBatchLimit('new-api', 'text-embedding-v4', 3)).toBe(8)
  })

  it('uses a one-hour sliding TTL refreshed only after successful use', () => {
    learnEmbeddingBatchLimit('new-api', 'custom-embedding-model', 10, 50, 0)
    refreshLearnedEmbeddingBatchLimit(
      'new-api',
      'custom-embedding-model',
      EMBEDDING_BATCH_LIMIT_TTL_MS - 1
    )

    expect(
      resolveEmbeddingBatchLimit(
        'new-api',
        'custom-embedding-model',
        EMBEDDING_BATCH_LIMIT_TTL_MS * 2 - 2
      )
    ).toBe(10)
    expect(
      resolveEmbeddingBatchLimit(
        'new-api',
        'custom-embedding-model',
        EMBEDDING_BATCH_LIMIT_TTL_MS * 2 - 1
      )
    ).toBeUndefined()
  })

  it('splits fifty values into ordered batches of ten with at most two active calls', async () => {
    let activeCalls = 0
    let maxActiveCalls = 0
    const batchSizes: number[] = []
    const baseModel = {
      specificationVersion: 'v4',
      provider: 'test',
      modelId: 'text-embedding-v4',
      maxEmbeddingsPerCall: 2048,
      supportsParallelCalls: true,
      async doEmbed({ values }: { values: string[] }) {
        activeCalls += 1
        maxActiveCalls = Math.max(maxActiveCalls, activeCalls)
        batchSizes.push(values.length)
        await new Promise<void>((resolve) => setTimeout(resolve, 0))
        activeCalls -= 1
        return { embeddings: values.map((value) => [Number(value)]) }
      }
    }
    const limit = resolveEmbeddingBatchLimit('new-api', 'text-embedding-v4')
    const model = wrapEmbeddingModel({
      model: baseModel as any,
      middleware: { overrideMaxEmbeddingsPerCall: () => limit }
    })
    const values = Array.from({ length: 50 }, (_, index) => String(index + 1))

    const result = await embedMany({ model, values, maxParallelCalls: 2 })

    expect(batchSizes).toEqual([10, 10, 10, 10, 10])
    expect(maxActiveCalls).toBe(2)
    expect(result.embeddings).toEqual(values.map((value) => [Number(value)]))
  })
})
