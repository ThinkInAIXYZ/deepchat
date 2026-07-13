import { describe, expect, it } from 'vitest'

import { buildAgentFixture, buildMemoryFixture, buildTapeFixture } from './fixtures'
import { createMemoryPerfObserver, summarizeDurations } from './performanceObserver'

describe('Agent Memory #28 performance baseline harness', () => {
  it('builds the decision-complete deterministic scale fixtures', () => {
    expect([1_000, 10_000, 50_000].map((size) => buildMemoryFixture(size).length)).toEqual([
      1_000, 10_000, 50_000
    ])
    expect([10_000, 100_000].map((size) => buildTapeFixture(size).length)).toEqual([
      10_000, 100_000
    ])
    expect(buildAgentFixture(100)).toHaveLength(100)
    expect(
      new Set(buildAgentFixture(100).map((agent) => JSON.stringify(agent.embedding))).size
    ).toBe(1)
  })

  it('keeps the linear legacy LIKE fixture available only as a relative timing baseline', () => {
    const rows = buildMemoryFixture(50_000)
    const matches = rows.filter((row) => row.content.includes('redis'))

    expect(matches).toHaveLength(5_000)
  })

  it('keeps counters no-op by default and tracks enabled high-water marks', () => {
    const disabled = createMemoryPerfObserver()
    disabled.increment('providerCalls', 8)
    disabled.observe('openStores', 100)
    expect(disabled.snapshot().counters.providerCalls).toBe(0)
    expect(disabled.snapshot().highWaterMarks.openStores).toBe(0)

    const enabled = createMemoryPerfObserver(true)
    enabled.observe('openStores', 4)
    enabled.observe('openStores', 2)
    enabled.observe('openStores', 8)
    expect(enabled.snapshot().highWaterMarks.openStores).toBe(8)
  })

  it('reports deterministic median and p95 samples without enforcing wall-clock thresholds', () => {
    expect(summarizeDurations([5, 1, 4, 2, 3])).toEqual({ median: 3, p95: 5 })
    expect(summarizeDurations([])).toEqual({ median: 0, p95: 0 })
  })
})
