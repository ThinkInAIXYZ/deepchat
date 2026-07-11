import { performance } from 'node:perf_hooks'

import { summarizeDurations } from './performanceObserver'

export interface PerformanceReport {
  scenario: string
  size: number
  samples: number
  medianMs: number
  p95Ms: number
}

export function measurePerformance(
  scenario: string,
  size: number,
  operation: () => void,
  samples = 7
): PerformanceReport {
  operation()
  const durations: number[] = []
  for (let index = 0; index < samples; index += 1) {
    const startedAt = performance.now()
    operation()
    durations.push(performance.now() - startedAt)
  }
  const summary = summarizeDurations(durations)
  return {
    scenario,
    size,
    samples,
    medianMs: summary.median,
    p95Ms: summary.p95
  }
}

export function reportPerformance(report: PerformanceReport): void {
  console.info(`[memory-perf] ${JSON.stringify(report)}`)
}
