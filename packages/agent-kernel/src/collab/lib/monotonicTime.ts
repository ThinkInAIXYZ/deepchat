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

export function elapsedMonotonicBetween(
  startedAt: number | undefined,
  completedAt: number | undefined
): number | undefined {
  if (
    startedAt === undefined ||
    !Number.isFinite(startedAt) ||
    startedAt < 0 ||
    completedAt === undefined ||
    !Number.isFinite(completedAt) ||
    completedAt < startedAt
  ) {
    return undefined
  }
  return completedAt - startedAt
}

export function elapsedMonotonicMs(
  startedAt: number | undefined,
  now: MonotonicClock = defaultMonotonicClock
): number | undefined {
  if (startedAt === undefined || !Number.isFinite(startedAt) || startedAt < 0) return undefined
  return elapsedMonotonicBetween(startedAt, readMonotonicNow(now))
}
