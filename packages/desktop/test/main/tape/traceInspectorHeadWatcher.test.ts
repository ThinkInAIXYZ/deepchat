import { describe, expect, it, vi } from 'vitest'
import {
  TapeInspectorHeadWatcher,
  type TapeInspectorHeadWatcherScheduler
} from '@/tape/application/traceInspectorHeadWatcher'
import type { TapeInspectorHead } from '@shared/types/tape-inspector'

function createScheduler() {
  let nextHandle = 1
  const callbacks = new Map<number, () => void>()
  const scheduler: TapeInspectorHeadWatcherScheduler = {
    setInterval: vi.fn((callback: () => void) => {
      const handle = nextHandle++
      callbacks.set(handle, callback)
      return handle
    }),
    clearInterval: vi.fn((handle: unknown) => {
      callbacks.delete(Number(handle))
    })
  }
  return {
    scheduler,
    callbacks,
    tick() {
      for (const callback of [...callbacks.values()]) callback()
    }
  }
}

describe('TapeInspectorHeadWatcher', () => {
  it('coalesces a session poll and emits only changed committed heads', () => {
    const timer = createScheduler()
    const heads = new Map<string, TapeInspectorHead>([
      ['session-1', { tapeIncarnationId: 'incarnation-1', maxEntryId: 10 }]
    ])
    const emit = vi.fn()
    const watcher = new TapeInspectorHeadWatcher({
      readHead: (sessionId) => heads.get(sessionId) ?? null,
      emit,
      watchRendererDestroyed: vi.fn(() => vi.fn()),
      scheduler: timer.scheduler
    })

    expect(
      watcher.subscribe({ sessionId: 'session-1', subscriptionId: 'shared', webContentsId: 11 })
    ).toEqual({ tapeIncarnationId: 'incarnation-1', maxEntryId: 10 })
    watcher.subscribe({ sessionId: 'session-1', subscriptionId: 'shared', webContentsId: 22 })

    expect(timer.scheduler.setInterval).toHaveBeenCalledOnce()
    timer.tick()
    expect(emit).not.toHaveBeenCalled()

    heads.set('session-1', { tapeIncarnationId: 'incarnation-1', maxEntryId: 12 })
    timer.tick()

    expect(emit).toHaveBeenCalledTimes(2)
    expect(emit).toHaveBeenCalledWith(11, {
      sessionId: 'session-1',
      tapeIncarnationId: 'incarnation-1',
      maxEntryId: 12
    })
    expect(emit).toHaveBeenCalledWith(22, {
      sessionId: 'session-1',
      tapeIncarnationId: 'incarnation-1',
      maxEntryId: 12
    })

    timer.tick()
    expect(emit).toHaveBeenCalledTimes(2)
  })

  it('scopes subscription ids to renderers and releases the last session timer', () => {
    const timer = createScheduler()
    const destroyedListeners = new Map<number, () => void>()
    const stopWatching = new Map<number, ReturnType<typeof vi.fn>>()
    const watcher = new TapeInspectorHeadWatcher({
      readHead: () => ({ tapeIncarnationId: 'incarnation-1', maxEntryId: 1 }),
      emit: vi.fn(),
      watchRendererDestroyed: (webContentsId, listener) => {
        destroyedListeners.set(webContentsId, listener)
        const stop = vi.fn()
        stopWatching.set(webContentsId, stop)
        return stop
      },
      scheduler: timer.scheduler
    })

    watcher.subscribe({ sessionId: 'session-1', subscriptionId: 'same-id', webContentsId: 11 })
    watcher.subscribe({ sessionId: 'session-1', subscriptionId: 'same-id', webContentsId: 22 })
    watcher.unsubscribe({ subscriptionId: 'same-id', webContentsId: 11 })

    expect(timer.callbacks.size).toBe(1)
    expect(stopWatching.get(11)).toHaveBeenCalledOnce()
    expect(stopWatching.get(22)).not.toHaveBeenCalled()

    destroyedListeners.get(22)?.()

    expect(timer.callbacks.size).toBe(0)
    expect(timer.scheduler.clearInterval).toHaveBeenCalledOnce()
    expect(stopWatching.get(22)).toHaveBeenCalledOnce()
  })

  it('backs off read failures and survives synchronous renderer destruction without leaks', () => {
    const timer = createScheduler()
    const emit = vi.fn()
    const onError = vi.fn()
    let readCount = 0
    const stopWatching = vi.fn()
    const watcher = new TapeInspectorHeadWatcher({
      readHead: () => {
        readCount += 1
        if (readCount === 2 || readCount === 3) throw new Error('temporary read failure')
        return {
          tapeIncarnationId: 'incarnation-1',
          maxEntryId: readCount >= 4 ? 2 : 1
        }
      },
      emit,
      watchRendererDestroyed: (_webContentsId, listener) => {
        if (readCount >= 4) listener()
        return stopWatching
      },
      scheduler: timer.scheduler,
      onError
    })

    watcher.subscribe({ sessionId: 'session-1', subscriptionId: 'first', webContentsId: 11 })
    timer.tick()
    expect(onError).toHaveBeenCalledOnce()
    expect(timer.callbacks.size).toBe(1)

    timer.tick()
    expect(readCount).toBe(2)
    expect(onError).toHaveBeenCalledOnce()
    expect(emit).not.toHaveBeenCalled()

    timer.tick()
    expect(readCount).toBe(3)
    expect(onError).toHaveBeenCalledOnce()

    for (let index = 0; index < 4; index += 1) timer.tick()
    expect(readCount).toBe(4)
    expect(emit).toHaveBeenCalledWith(11, {
      sessionId: 'session-1',
      tapeIncarnationId: 'incarnation-1',
      maxEntryId: 2
    })

    watcher.subscribe({ sessionId: 'session-2', subscriptionId: 'gone', webContentsId: 22 })
    expect(stopWatching).toHaveBeenCalledOnce()
    expect(timer.callbacks.size).toBe(1)

    watcher.close()
    expect(timer.callbacks.size).toBe(0)
  })

  it('isolates renderer delivery failures so other subscribers receive the head', () => {
    const timer = createScheduler()
    let maxEntryId = 1
    const emit = vi.fn((webContentsId: number) => {
      if (webContentsId === 11) throw new Error('renderer destroyed')
    })
    const onError = vi.fn()
    const watcher = new TapeInspectorHeadWatcher({
      readHead: () => ({ tapeIncarnationId: 'incarnation-1', maxEntryId }),
      emit,
      watchRendererDestroyed: () => vi.fn(),
      scheduler: timer.scheduler,
      onError
    })
    watcher.subscribe({ sessionId: 'session-1', subscriptionId: 'first', webContentsId: 11 })
    watcher.subscribe({ sessionId: 'session-1', subscriptionId: 'second', webContentsId: 22 })

    maxEntryId = 2
    timer.tick()

    expect(emit).toHaveBeenCalledWith(11, {
      sessionId: 'session-1',
      tapeIncarnationId: 'incarnation-1',
      maxEntryId: 2
    })
    expect(emit).toHaveBeenCalledWith(22, {
      sessionId: 'session-1',
      tapeIncarnationId: 'incarnation-1',
      maxEntryId: 2
    })
    expect(onError).toHaveBeenCalledOnce()
    watcher.close()
  })

  it('bounds renderer ownership and rolls back failed lifecycle registration', () => {
    const failedTimer = createScheduler()
    const failedWatcher = new TapeInspectorHeadWatcher({
      readHead: () => ({ tapeIncarnationId: 'incarnation-1', maxEntryId: 1 }),
      emit: vi.fn(),
      watchRendererDestroyed: () => {
        throw new Error('renderer unavailable')
      },
      scheduler: failedTimer.scheduler
    })

    expect(() =>
      failedWatcher.subscribe({
        sessionId: 'session-1',
        subscriptionId: 'failed',
        webContentsId: 11
      })
    ).toThrow('renderer unavailable')
    expect(failedTimer.callbacks.size).toBe(0)

    const timer = createScheduler()
    const watcher = new TapeInspectorHeadWatcher({
      readHead: () => ({ tapeIncarnationId: 'incarnation-1', maxEntryId: 1 }),
      emit: vi.fn(),
      watchRendererDestroyed: () => vi.fn(),
      scheduler: timer.scheduler
    })
    for (let index = 0; index < 16; index += 1) {
      watcher.subscribe({
        sessionId: 'session-1',
        subscriptionId: `subscription-${index}`,
        webContentsId: 11
      })
    }
    expect(() =>
      watcher.subscribe({
        sessionId: 'session-1',
        subscriptionId: 'subscription-overflow',
        webContentsId: 11
      })
    ).toThrow('subscription limit exceeded')
    expect(timer.callbacks.size).toBe(1)
    watcher.close()
  })

  it('releases subscriptions when the committed session head disappears', () => {
    const timer = createScheduler()
    let head: TapeInspectorHead | null = {
      tapeIncarnationId: 'incarnation-1',
      maxEntryId: 1
    }
    const stopWatching = vi.fn()
    const watcher = new TapeInspectorHeadWatcher({
      readHead: () => head,
      emit: vi.fn(),
      watchRendererDestroyed: () => stopWatching,
      scheduler: timer.scheduler
    })
    watcher.subscribe({ sessionId: 'session-1', subscriptionId: 'active', webContentsId: 11 })

    head = null
    timer.tick()

    expect(timer.callbacks.size).toBe(0)
    expect(stopWatching).toHaveBeenCalledOnce()
  })
})
