import {
  MEMORY_PERF_COUNTER_NAMES,
  MEMORY_PERF_HIGH_WATER_NAMES,
  type MemoryPerfCounterName,
  type MemoryPerfHighWaterName,
  type MemoryPerfObserver as ProductionMemoryPerfObserver
} from '@/memory/ports'

export { MEMORY_PERF_COUNTER_NAMES, MEMORY_PERF_HIGH_WATER_NAMES }

export interface MemoryPerfSnapshot {
  counters: Record<MemoryPerfCounterName, number>
  highWaterMarks: Record<MemoryPerfHighWaterName, number>
}

export interface MemoryPerfObserver extends ProductionMemoryPerfObserver {
  snapshot(): MemoryPerfSnapshot
  reset(): void
}

function emptySnapshot(): MemoryPerfSnapshot {
  return {
    counters: {
      sqliteStatements: 0,
      repositoryCalls: 0,
      materializedRows: 0,
      providerCalls: 0,
      duckDbStatements: 0
    },
    highWaterMarks: {
      openStores: 0,
      activeLeases: 0,
      queueDepth: 0,
      cacheEntries: 0
    }
  }
}

const NOOP_SNAPSHOT = Object.freeze(emptySnapshot())

export const NOOP_MEMORY_PERF_OBSERVER: MemoryPerfObserver = Object.freeze({
  increment: () => undefined,
  observe: () => undefined,
  snapshot: () => ({
    counters: { ...NOOP_SNAPSHOT.counters },
    highWaterMarks: { ...NOOP_SNAPSHOT.highWaterMarks }
  }),
  reset: () => undefined
})

export function createMemoryPerfObserver(enabled = false): MemoryPerfObserver {
  if (!enabled) return NOOP_MEMORY_PERF_OBSERVER

  let state = emptySnapshot()
  return {
    increment(name, amount = 1) {
      state.counters[name] += amount
    },
    observe(name, value) {
      state.highWaterMarks[name] = Math.max(state.highWaterMarks[name], value)
    },
    snapshot() {
      return {
        counters: { ...state.counters },
        highWaterMarks: { ...state.highWaterMarks }
      }
    },
    reset() {
      state = emptySnapshot()
    }
  }
}

export function summarizeDurations(samples: readonly number[]): { median: number; p95: number } {
  if (samples.length === 0) return { median: 0, p95: 0 }
  const sorted = [...samples].sort((left, right) => left - right)
  return {
    median: sorted[Math.floor((sorted.length - 1) * 0.5)],
    p95: sorted[Math.ceil(0.95 * sorted.length) - 1]
  }
}
