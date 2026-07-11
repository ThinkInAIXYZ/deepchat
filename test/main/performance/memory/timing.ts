import { performance } from 'node:perf_hooks'

import { summarizeDurations } from './performanceObserver'

export interface PerformanceReport {
  scenario: string
  size: number
  samples: number
  medianMs: number
  p95Ms: number
}

export interface PairedPerformanceReport {
  primary: PerformanceReport
  baseline: PerformanceReport
}

function buildPerformanceReport(
  scenario: string,
  size: number,
  durations: number[]
): PerformanceReport {
  const summary = summarizeDurations(durations)
  return {
    scenario,
    size,
    samples: durations.length,
    medianMs: summary.median,
    p95Ms: summary.p95
  }
}

function measureOperation(operation: () => void, durations: number[]): void {
  const startedAt = performance.now()
  operation()
  durations.push(performance.now() - startedAt)
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
    measureOperation(operation, durations)
  }
  return buildPerformanceReport(scenario, size, durations)
}

export function measurePairedPerformance(
  primaryScenario: string,
  baselineScenario: string,
  size: number,
  primaryOperation: () => void,
  baselineOperation: () => void,
  samples = 11
): PairedPerformanceReport {
  primaryOperation()
  baselineOperation()
  const primaryDurations: number[] = []
  const baselineDurations: number[] = []
  for (let index = 0; index < samples; index += 1) {
    if (index % 2 === 0) {
      measureOperation(primaryOperation, primaryDurations)
      measureOperation(baselineOperation, baselineDurations)
    } else {
      measureOperation(baselineOperation, baselineDurations)
      measureOperation(primaryOperation, primaryDurations)
    }
  }
  return {
    primary: buildPerformanceReport(primaryScenario, size, primaryDurations),
    baseline: buildPerformanceReport(baselineScenario, size, baselineDurations)
  }
}

export function reportPerformance(report: PerformanceReport): void {
  console.info(`[memory-perf] ${JSON.stringify(report)}`)
}
