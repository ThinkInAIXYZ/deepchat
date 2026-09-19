import type { TapeInspectorHead, TapeInspectorHeadPulse } from '@shared/types/tape-inspector'

const DEFAULT_POLL_INTERVAL_MS = 500
const MAX_READ_RETRY_DELAY_MS = 30_000
const MAX_SUBSCRIPTIONS_PER_RENDERER = 16

export interface TapeInspectorHeadWatcherScheduler {
  setInterval(callback: () => void, intervalMs: number): unknown
  clearInterval(handle: unknown): void
}

export interface TapeInspectorHeadWatcherOptions {
  readHead(sessionId: string): TapeInspectorHead | null
  emit(webContentsId: number, pulse: TapeInspectorHeadPulse): void
  watchRendererDestroyed(webContentsId: number, listener: () => void): () => void
  scheduler?: TapeInspectorHeadWatcherScheduler
  pollIntervalMs?: number
  onError?: (error: unknown, sessionId: string) => void
}

interface WatchedSession {
  subscriptions: Map<string, number>
  lastHead: TapeInspectorHead
  timer: unknown
  consecutiveReadFailures: number
  pollsUntilReadRetry: number
  readFailureReported: boolean
}

interface WatchedRenderer {
  subscriptionKeys: Set<string>
  stopWatching: () => void
}

function sameHead(left: TapeInspectorHead, right: TapeInspectorHead): boolean {
  return left.tapeIncarnationId === right.tapeIncarnationId && left.maxEntryId === right.maxEntryId
}

function defaultScheduler(): TapeInspectorHeadWatcherScheduler {
  return {
    setInterval(callback, intervalMs) {
      const timer = setInterval(callback, intervalMs)
      timer.unref()
      return timer
    },
    clearInterval(handle) {
      clearInterval(handle as NodeJS.Timeout)
    }
  }
}

export class TapeInspectorHeadWatcher {
  private readonly sessions = new Map<string, WatchedSession>()
  private readonly renderers = new Map<number, WatchedRenderer>()
  private readonly subscriptions = new Map<string, { sessionId: string; webContentsId: number }>()
  private readonly scheduler: TapeInspectorHeadWatcherScheduler
  private readonly pollIntervalMs: number

  constructor(private readonly options: TapeInspectorHeadWatcherOptions) {
    this.scheduler = options.scheduler ?? defaultScheduler()
    this.pollIntervalMs = Math.max(
      100,
      Math.floor(options.pollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS)
    )
  }

  subscribe(input: {
    sessionId: string
    subscriptionId: string
    webContentsId: number
  }): TapeInspectorHead {
    const subscriptionKey = this.subscriptionKey(input.webContentsId, input.subscriptionId)
    const existingSessionId = this.subscriptions.get(subscriptionKey)?.sessionId
    const watchedRenderer = this.renderers.get(input.webContentsId)
    if (
      !existingSessionId &&
      watchedRenderer &&
      watchedRenderer.subscriptionKeys.size >= MAX_SUBSCRIPTIONS_PER_RENDERER
    ) {
      throw new RangeError('Tape Inspector live subscription limit exceeded.')
    }
    if (existingSessionId && existingSessionId !== input.sessionId) {
      this.unsubscribeByKey(subscriptionKey)
    }

    const head = this.options.readHead(input.sessionId)
    if (!head) throw new Error('Session Tape bootstrap is missing or invalid.')

    let watchedSession = this.sessions.get(input.sessionId)
    if (!watchedSession) {
      watchedSession = {
        subscriptions: new Map(),
        lastHead: head,
        timer: this.scheduler.setInterval(() => this.poll(input.sessionId), this.pollIntervalMs),
        consecutiveReadFailures: 0,
        pollsUntilReadRetry: 0,
        readFailureReported: false
      }
      this.sessions.set(input.sessionId, watchedSession)
    } else {
      watchedSession.consecutiveReadFailures = 0
      watchedSession.pollsUntilReadRetry = 0
      watchedSession.readFailureReported = false
      if (!sameHead(watchedSession.lastHead, head)) {
        watchedSession.lastHead = head
        this.emitHead(input.sessionId, watchedSession)
      }
    }

    watchedSession.subscriptions.set(subscriptionKey, input.webContentsId)
    this.subscriptions.set(subscriptionKey, {
      sessionId: input.sessionId,
      webContentsId: input.webContentsId
    })
    try {
      this.trackRenderer(input.webContentsId, subscriptionKey)
    } catch (error) {
      this.unsubscribeByKey(subscriptionKey)
      throw error
    }
    return head
  }

  unsubscribe(input: { subscriptionId: string; webContentsId: number }): void {
    this.unsubscribeByKey(this.subscriptionKey(input.webContentsId, input.subscriptionId))
  }

  close(): void {
    for (const watchedSession of this.sessions.values()) {
      this.scheduler.clearInterval(watchedSession.timer)
    }
    for (const watchedRenderer of this.renderers.values()) watchedRenderer.stopWatching()
    this.sessions.clear()
    this.renderers.clear()
    this.subscriptions.clear()
  }

  private poll(sessionId: string): void {
    const watchedSession = this.sessions.get(sessionId)
    if (!watchedSession) return
    if (watchedSession.pollsUntilReadRetry > 0) {
      watchedSession.pollsUntilReadRetry -= 1
      return
    }
    try {
      const head = this.options.readHead(sessionId)
      if (!head) {
        this.releaseSession(sessionId)
        return
      }
      watchedSession.consecutiveReadFailures = 0
      watchedSession.pollsUntilReadRetry = 0
      watchedSession.readFailureReported = false
      if (sameHead(watchedSession.lastHead, head)) return
      watchedSession.lastHead = head
      this.emitHead(sessionId, watchedSession)
    } catch (error) {
      watchedSession.consecutiveReadFailures += 1
      const retryDelayMs = Math.min(
        MAX_READ_RETRY_DELAY_MS,
        this.pollIntervalMs * 2 ** Math.min(watchedSession.consecutiveReadFailures, 16)
      )
      watchedSession.pollsUntilReadRetry = Math.max(
        0,
        Math.ceil(retryDelayMs / this.pollIntervalMs) - 1
      )
      if (!watchedSession.readFailureReported) {
        watchedSession.readFailureReported = true
        this.options.onError?.(error, sessionId)
      }
    }
  }

  private emitHead(sessionId: string, watchedSession: WatchedSession): void {
    const pulse = { sessionId, ...watchedSession.lastHead }
    for (const webContentsId of new Set(watchedSession.subscriptions.values())) {
      try {
        this.options.emit(webContentsId, pulse)
      } catch (error) {
        this.options.onError?.(error, sessionId)
      }
    }
  }

  private trackRenderer(webContentsId: number, subscriptionKey: string): void {
    let watchedRenderer = this.renderers.get(webContentsId)
    if (!watchedRenderer) {
      watchedRenderer = {
        subscriptionKeys: new Set([subscriptionKey]),
        stopWatching: () => {}
      }
      this.renderers.set(webContentsId, watchedRenderer)
      try {
        watchedRenderer.stopWatching = this.options.watchRendererDestroyed(webContentsId, () => {
          this.releaseRenderer(webContentsId)
        })
      } catch (error) {
        if (this.renderers.get(webContentsId) === watchedRenderer) {
          this.renderers.delete(webContentsId)
        }
        throw error
      }
      if (this.renderers.get(webContentsId) !== watchedRenderer) {
        watchedRenderer.stopWatching()
        this.unsubscribeByKey(subscriptionKey)
        return
      }
    } else {
      watchedRenderer.subscriptionKeys.add(subscriptionKey)
    }
  }

  private releaseRenderer(webContentsId: number): void {
    const watchedRenderer = this.renderers.get(webContentsId)
    if (!watchedRenderer) return
    this.renderers.delete(webContentsId)
    for (const subscriptionKey of watchedRenderer.subscriptionKeys) {
      this.unsubscribeByKey(subscriptionKey)
    }
    watchedRenderer.stopWatching()
  }

  private releaseSession(sessionId: string): void {
    const watchedSession = this.sessions.get(sessionId)
    if (!watchedSession) return
    for (const subscriptionKey of watchedSession.subscriptions.keys()) {
      this.unsubscribeByKey(subscriptionKey)
    }
  }

  private unsubscribeByKey(subscriptionKey: string): void {
    const subscription = this.subscriptions.get(subscriptionKey)
    if (!subscription) return
    this.subscriptions.delete(subscriptionKey)

    const watchedSession = this.sessions.get(subscription.sessionId)
    watchedSession?.subscriptions.delete(subscriptionKey)
    if (watchedSession && watchedSession.subscriptions.size === 0) {
      this.scheduler.clearInterval(watchedSession.timer)
      this.sessions.delete(subscription.sessionId)
    }

    const watchedRenderer = this.renderers.get(subscription.webContentsId)
    watchedRenderer?.subscriptionKeys.delete(subscriptionKey)
    if (watchedRenderer && watchedRenderer.subscriptionKeys.size === 0) {
      watchedRenderer.stopWatching()
      this.renderers.delete(subscription.webContentsId)
    }
  }

  private subscriptionKey(webContentsId: number, subscriptionId: string): string {
    return `${webContentsId}:${subscriptionId}`
  }
}
