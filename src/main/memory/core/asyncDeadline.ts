export type SoftDeadlineResult<T> = { timedOut: true } | { timedOut: false; value: T }

export async function withSoftDeadline<T>(
  promise: Promise<T>,
  timeoutMs: number
): Promise<SoftDeadlineResult<T>> {
  let timeoutId: ReturnType<typeof setTimeout> | null = null
  const guarded = promise.then((value): SoftDeadlineResult<T> => ({ timedOut: false, value }))
  void guarded.catch(() => undefined)
  const timeout = new Promise<SoftDeadlineResult<T>>((resolve) => {
    timeoutId = setTimeout(() => resolve({ timedOut: true }), timeoutMs)
    if (typeof timeoutId.unref === 'function') timeoutId.unref()
  })
  try {
    return await Promise.race([guarded, timeout])
  } finally {
    if (timeoutId) clearTimeout(timeoutId)
  }
}
