type StartupDeferredTask = () => void | Promise<void>

type StartupDeferredOptions = {
  idleTimeoutMs?: number
}

type ScheduledEntry = {
  cancelled: boolean
  task: StartupDeferredTask
  idleTimeoutMs: number
  timerId: number | null
  idleId: number | null
}

const DEFAULT_IDLE_TIMEOUT_MS = 800

const pendingEntries = new Set<ScheduledEntry>()

let startupInteractiveMarked = false
let startupReleased = false

const clearScheduledHandles = (entry: ScheduledEntry) => {
  if (entry.timerId !== null) {
    window.clearTimeout(entry.timerId)
    entry.timerId = null
  }

  if (entry.idleId !== null && typeof window.cancelIdleCallback === 'function') {
    window.cancelIdleCallback(entry.idleId)
    entry.idleId = null
  }
}

const executeEntry = (entry: ScheduledEntry) => {
  if (entry.cancelled) {
    return
  }

  Promise.resolve()
    .then(() => entry.task())
    .catch((error) => {
      console.warn('[Startup][Renderer] deferred task failed:', error)
    })
}

const runEntry = (entry: ScheduledEntry) => {
  if (entry.cancelled) {
    return
  }

  if (typeof window.requestIdleCallback === 'function') {
    entry.idleId = window.requestIdleCallback(
      () => {
        entry.idleId = null
        executeEntry(entry)
      },
      { timeout: entry.idleTimeoutMs }
    )
    return
  }

  entry.timerId = window.setTimeout(() => {
    entry.timerId = null
    executeEntry(entry)
  }, 0)
}

const flushPendingEntries = () => {
  if (startupReleased) {
    return
  }

  startupReleased = true
  console.info(`[Startup][Renderer] releasing ${pendingEntries.size} deferred startup tasks`)

  for (const entry of Array.from(pendingEntries)) {
    pendingEntries.delete(entry)
    runEntry(entry)
  }
}

export const markStartupInteractive = (): void => {
  if (startupInteractiveMarked) {
    return
  }

  startupInteractiveMarked = true

  if (typeof window.requestAnimationFrame !== 'function') {
    window.setTimeout(() => {
      flushPendingEntries()
    }, 0)
    return
  }

  window.requestAnimationFrame(() => {
    window.requestAnimationFrame(() => {
      window.setTimeout(() => {
        flushPendingEntries()
      }, 0)
    })
  })
}

export const scheduleStartupDeferredTask = (
  task: StartupDeferredTask,
  options: StartupDeferredOptions = {}
): (() => void) => {
  const entry: ScheduledEntry = {
    cancelled: false,
    task,
    idleTimeoutMs: options.idleTimeoutMs ?? DEFAULT_IDLE_TIMEOUT_MS,
    timerId: null,
    idleId: null
  }

  if (startupReleased) {
    runEntry(entry)
  } else {
    pendingEntries.add(entry)
  }

  return () => {
    entry.cancelled = true
    pendingEntries.delete(entry)
    clearScheduledHandles(entry)
  }
}
