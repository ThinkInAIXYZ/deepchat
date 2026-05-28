export function normalizeLifecycleHookDelayMs(value: unknown): number {
  if (value === undefined || value === null || value === '') {
    return 0
  }

  const delayMs = Number(value)
  if (!Number.isFinite(delayMs) || delayMs < 0) {
    return 0
  }

  return delayMs
}
