export type MonotonicClock = () => number

function defaultMonotonicClock(): number {
  return performance.now()
}

export function readMonotonicNow(now: MonotonicClock = defaultMonotonicClock): number | undefined {
  try {
    const value = now()
    return Number.isFinite(value) && value >= 0 ? value : undefined
  } catch {
    return undefined
  }
}

export function elapsedMonotonicMs(
  startedAt: number | undefined,
  now: MonotonicClock = defaultMonotonicClock
): number | undefined {
  if (startedAt === undefined || !Number.isFinite(startedAt) || startedAt < 0) return undefined
  const completedAt = readMonotonicNow(now)
  if (completedAt === undefined || completedAt < startedAt) return undefined
  return completedAt - startedAt
}
