/**
 * Trailing-edge throttle utility.
 *
 * On invoke: if enough time has elapsed since last run, execute immediately;
 * otherwise schedule execution for when the interval expires.
 * `flush()` runs the callback immediately. `cancel()` clears any pending timeout.
 */
export interface ThrottleHandle {
  (): void
  flush(): void
  cancel(): void
  reschedule(): void
}

export function createThrottle(fn: () => void, interval: number): ThrottleHandle {
  let lastRun = 0
  let timer: ReturnType<typeof setTimeout> | null = null

  function invoke(): void {
    const elapsed = Date.now() - lastRun
    if (elapsed >= interval) {
      run()
    } else if (!timer) {
      timer = setTimeout(run, interval - elapsed)
    }
  }

  function run(): void {
    if (timer) {
      clearTimeout(timer)
      timer = null
    }
    lastRun = Date.now()
    fn()
  }

  invoke.flush = run

  invoke.cancel = (): void => {
    if (timer) {
      clearTimeout(timer)
      timer = null
    }
  }

  invoke.reschedule = (): void => {
    if (timer) {
      clearTimeout(timer)
    }

    timer = setTimeout(run, interval)
  }

  return invoke
}
