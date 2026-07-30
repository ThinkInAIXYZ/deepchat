import { describe, expect, it } from 'vitest'
import { buildUsageStatsRecord, normalizeUsageCounts } from '../../../src/main/session/usageStats'

describe('usageStats', () => {
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

  it('stores normalized token counts in usage records', () => {
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
      inputTokens: 1_000,
      outputTokens: 200,
      totalTokens: 1_200,
      cachedInputTokens: 400,
      cacheWriteInputTokens: 100
    })
  })
})
