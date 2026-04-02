import { describe, expect, it, vi } from 'vitest'

vi.mock('../../../src/main/presenter/configPresenter/providerDbLoader', () => ({
  providerDbLoader: {
    getModel: vi.fn((providerId: string, modelId: string) => {
      if (providerId === 'anthropic' && modelId === 'claude-sonnet') {
        return {
          cost: {
            input: 3,
            output: 15,
            cache_read: 0.3,
            cache_write: 3.75
          }
        }
      }
      if (providerId === 'bedrock' && modelId === 'claude-bedrock') {
        return {
          cost: {
            input: 4,
            output: 20,
            cache_read: 0.5
          }
        }
      }
      return undefined
    })
  }
}))

import {
  buildUsageStatsRecord,
  estimateUsageCostUsd,
  normalizeUsageCounts
} from '../../../src/main/presenter/usageStats'

describe('usageStats cache pricing', () => {
  it('charges uncached input, cache read, cache write, and output separately', () => {
    const cost = estimateUsageCostUsd({
      providerId: 'anthropic',
      modelId: 'claude-sonnet',
      inputTokens: 1_000,
      outputTokens: 200,
      cachedInputTokens: 400,
      cacheWriteInputTokens: 100
    })

    expect(cost).toBeCloseTo((500 * 3 + 400 * 0.3 + 100 * 3.75 + 200 * 15) / 1_000_000)
  })

  it('falls back to the input price when cache_write pricing is unavailable', () => {
    const cost = estimateUsageCostUsd({
      providerId: 'bedrock',
      modelId: 'claude-bedrock',
      inputTokens: 900,
      outputTokens: 100,
      cachedInputTokens: 300,
      cacheWriteInputTokens: 200
    })

    expect(cost).toBeCloseTo((400 * 4 + 300 * 0.5 + 200 * 4 + 100 * 20) / 1_000_000)
  })

  it('caps cached and cache-write counts against total input tokens', () => {
    expect(
      normalizeUsageCounts({
        inputTokens: 100,
        outputTokens: 20,
        totalTokens: 120,
        cachedInputTokens: 90,
        cacheWriteInputTokens: 50
      })
    ).toEqual({
      inputTokens: 100,
      outputTokens: 20,
      totalTokens: 120,
      cachedInputTokens: 90,
      cacheWriteInputTokens: 10
    })
  })

  it('stores cache_write_input_tokens in usage records', () => {
    const record = buildUsageStatsRecord({
      messageId: 'message-1',
      sessionId: 'session-1',
      createdAt: Date.UTC(2026, 2, 10, 8, 0, 0),
      updatedAt: Date.UTC(2026, 2, 10, 8, 0, 1),
      providerId: 'anthropic',
      modelId: 'claude-sonnet',
      metadata: {
        inputTokens: 1_000,
        outputTokens: 200,
        totalTokens: 1_200,
        cachedInputTokens: 400,
        cacheWriteInputTokens: 100
      },
      source: 'live'
    })

    expect(record).toMatchObject({
      cachedInputTokens: 400,
      cacheWriteInputTokens: 100
    })
    expect(record?.estimatedCostUsd).toBeCloseTo(
      (500 * 3 + 400 * 0.3 + 100 * 3.75 + 200 * 15) / 1_000_000
    )
  })
})
