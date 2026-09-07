export interface NumberDistribution {
  samples: number
  p50: number | null
  p95: number | null
  max: number | null
}

export const MAX_DIAGNOSTIC_DISTRIBUTION_SAMPLES = 256

export class BoundedNumberRing {
  private readonly values: number[]
  private nextIndex = 0
  private size = 0

  constructor(private readonly capacity: number) {
    if (!Number.isSafeInteger(capacity) || capacity < 1) {
      throw new Error('Bounded number ring capacity must be a positive safe integer.')
    }
    this.values = Array<number>(capacity)
  }

  push(value: number): void {
    if (!Number.isFinite(value) || value < 0) return
    this.values[this.nextIndex] = value
    this.nextIndex = (this.nextIndex + 1) % this.capacity
    this.size = Math.min(this.size + 1, this.capacity)
  }

  snapshot(): number[] {
    if (this.size < this.capacity) return this.values.slice(0, this.size)
    return [...this.values.slice(this.nextIndex), ...this.values.slice(0, this.nextIndex)]
  }
}

export function summarizeNumberDistribution(values: readonly number[]): NumberDistribution {
  if (values.length === 0) return { samples: 0, p50: null, p95: null, max: null }
  const sorted = [...values].sort((left, right) => left - right)
  const nearestRank = (percentile: number) =>
    sorted[Math.max(0, Math.ceil(percentile * sorted.length) - 1)]
  return {
    samples: sorted.length,
    p50: nearestRank(0.5),
    p95: nearestRank(0.95),
    max: sorted.at(-1) ?? null
  }
}
