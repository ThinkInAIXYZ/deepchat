import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  FileWatcherHost,
  SNAPSHOT_POLL_INTERVAL_MS as POLL_INTERVAL_MS
} from '../../../../src/main/platform/fileWatcher/watcherHost'
import type {
  FileWatcherHostEvent,
  WatchRequest
} from '../../../../src/main/platform/fileWatcher/watcherTypes'

const parcel = vi.hoisted(() => ({
  subscribe: vi.fn(),
  writeSnapshot: vi.fn(),
  getEventsSince: vi.fn()
}))

vi.mock('@parcel/watcher', () => ({ default: parcel }))

vi.mock('fs', async () => {
  const actual = await vi.importActual<typeof import('node:fs')>('node:fs')
  return { default: actual, ...actual }
})

vi.mock('path', async () => {
  const actual = await vi.importActual<typeof import('node:path')>('node:path')
  return { default: actual, ...actual }
})

type NativeCallback = (error: Error | null, events: unknown[]) => void

describe('FileWatcherHost', () => {
  let rootPath: string
  let messages: FileWatcherHostEvent[]
  let host: FileWatcherHost
  let request: WatchRequest

  beforeEach(() => {
    vi.useFakeTimers()
    Object.values(parcel).forEach((mock) => mock.mockReset())
    rootPath = fs.mkdtempSync(path.join(os.tmpdir(), 'deepchat-watcher-host-'))
    messages = []
    host = new FileWatcherHost({ postMessage: (message) => messages.push(message) })
    request = {
      id: `watch_${path.basename(rootPath)}`,
      rootPath,
      hostKind: 'content',
      purpose: 'workspace-content',
      recursive: true,
      fallbackMode: 'snapshot-polling'
    }
    parcel.writeSnapshot.mockImplementation(async (_root: string, snapshotPath: string) => {
      fs.writeFileSync(snapshotPath, '')
    })
  })

  const eventBatches = () =>
    messages.flatMap((message) =>
      message.type === 'file-watcher:event-batch' ? [message.batch.events] : []
    )

  afterEach(async () => {
    await host.shutdown()
    vi.useRealTimers()
    fs.rmSync(rootPath, { recursive: true, force: true })
  })

  it('waits for the previous snapshot poll before starting the next one', async () => {
    parcel.subscribe.mockRejectedValue(new Error('subscribe failed'))
    let resolveEvents: (events: unknown[]) => void = () => {}
    parcel.getEventsSince.mockImplementation(
      () => new Promise((resolve) => (resolveEvents = resolve))
    )

    await host.watch(request)
    await vi.advanceTimersByTimeAsync(POLL_INTERVAL_MS)
    expect(parcel.getEventsSince).toHaveBeenCalledTimes(1)

    await vi.advanceTimersByTimeAsync(POLL_INTERVAL_MS * 3)
    expect(parcel.getEventsSince).toHaveBeenCalledTimes(1)

    resolveEvents([])
    await vi.advanceTimersByTimeAsync(POLL_INTERVAL_MS)
    expect(parcel.getEventsSince).toHaveBeenCalledTimes(2)
  })

  it('recovers once for repeated errors from the same subscription', async () => {
    let emit: NativeCallback = () => {}
    const unsubscribe = vi.fn()
    parcel.subscribe.mockImplementation(async (_root: string, callback: NativeCallback) => {
      emit = callback
      return { unsubscribe }
    })

    await host.watch(request)
    const failing = emit
    failing(new Error('Events were dropped by the FSEvents client.'), [])
    failing(new Error('Events were dropped by the FSEvents client.'), [])
    await vi.advanceTimersByTimeAsync(100)

    expect(parcel.subscribe).toHaveBeenCalledTimes(2)
    expect(unsubscribe).toHaveBeenCalledTimes(1)
    expect(eventBatches()).toEqual([[{ path: rootPath, type: 'overflow' }]])
  })

  it('removes a snapshot that finishes writing after the watch is disposed', async () => {
    parcel.subscribe.mockRejectedValue(new Error('subscribe failed'))
    let snapshotPath = ''
    let finishWrite = () => {}
    parcel.writeSnapshot.mockImplementation(
      (_root: string, targetPath: string) =>
        new Promise<void>((resolve) => {
          snapshotPath = targetPath
          finishWrite = () => {
            fs.writeFileSync(targetPath, '')
            resolve()
          }
        })
    )

    await host.watch(request)
    await host.unwatch(request.id)
    finishWrite()
    await vi.advanceTimersByTimeAsync(0)

    expect(snapshotPath).not.toBe('')
    expect(fs.existsSync(snapshotPath)).toBe(false)
  })

  it('emits overflow for a batch too large to buffer', async () => {
    let emit: NativeCallback = () => {}
    parcel.subscribe.mockImplementation(async (_root: string, callback: NativeCallback) => {
      emit = callback
      return { unsubscribe: vi.fn() }
    })

    await host.watch(request)
    const events = Array.from({ length: 200_000 }, (_, index) => ({
      path: path.join(rootPath, `file-${index}`),
      type: 'create'
    }))
    expect(() => emit(null, events)).not.toThrow()
    await vi.advanceTimersByTimeAsync(100)

    expect(eventBatches()).toEqual([[{ path: rootPath, type: 'overflow' }]])
  })

  it('resubscribes and requests a rescan after a native callback error', async () => {
    const callbacks: NativeCallback[] = []
    const unsubscribe = vi.fn()
    parcel.subscribe.mockImplementation(async (_root: string, callback: NativeCallback) => {
      callbacks.push(callback)
      return { unsubscribe }
    })

    await host.watch(request)
    callbacks[0](new Error('Events were dropped by the FSEvents client.'), [])
    await vi.advanceTimersByTimeAsync(100)

    expect(unsubscribe).toHaveBeenCalledTimes(1)
    expect(parcel.subscribe).toHaveBeenCalledTimes(2)
    expect(parcel.writeSnapshot).not.toHaveBeenCalled()
    expect(eventBatches()).toEqual([[{ path: rootPath, type: 'overflow' }]])
  })

  it('falls back to snapshot polling when resubscribing fails', async () => {
    let emit: NativeCallback = () => {}
    parcel.subscribe
      .mockImplementationOnce(async (_root: string, callback: NativeCallback) => {
        emit = callback
        return { unsubscribe: vi.fn() }
      })
      .mockRejectedValueOnce(new Error('subscribe failed'))

    await host.watch(request)
    emit(new Error('Buffer overflow. Some events may have been lost.'), [])
    await vi.advanceTimersByTimeAsync(0)

    expect(parcel.writeSnapshot).toHaveBeenCalledTimes(1)
    expect(
      messages.some(
        (message) =>
          message.type === 'file-watcher:status' &&
          message.status.reason === 'native-error' &&
          message.status.mode === 'snapshot-polling'
      )
    ).toBe(true)
  })

  it('falls back when the replacement subscription fails before subscribe resolves', async () => {
    let emit: NativeCallback = () => {}
    parcel.subscribe
      .mockImplementationOnce(async (_root: string, callback: NativeCallback) => {
        emit = callback
        return { unsubscribe: vi.fn() }
      })
      .mockImplementationOnce(async (_root: string, callback: NativeCallback) => {
        callback(new Error('Buffer overflow. Some events may have been lost.'), [])
        return { unsubscribe: vi.fn() }
      })

    await host.watch(request)
    messages.length = 0
    emit(new Error('Events were dropped by the FSEvents client.'), [])
    await vi.advanceTimersByTimeAsync(0)

    const statuses = messages.flatMap((message) =>
      message.type === 'file-watcher:status' ? [message.status] : []
    )
    expect(statuses.some((status) => status.health === 'healthy')).toBe(false)
    expect(statuses.at(-1)?.mode).toBe('snapshot-polling')
    expect(parcel.writeSnapshot).toHaveBeenCalledTimes(1)
  })

  it('polls git metadata paths without snapshots when git subscribe fails', async () => {
    const gitDir = path.join(rootPath, '.git')
    const headsDir = path.join(gitDir, 'refs', 'heads')
    fs.mkdirSync(headsDir, { recursive: true })
    fs.writeFileSync(path.join(gitDir, 'HEAD'), 'ref: refs/heads/main\n')
    parcel.subscribe.mockRejectedValue(new Error('subscribe failed'))

    await host.watch({
      ...request,
      rootPath: gitDir,
      hostKind: 'git',
      purpose: 'workspace-git',
      includes: [path.join(gitDir, 'HEAD'), path.join(gitDir, 'refs')],
      fallbackMode: 'git-metadata-polling'
    })
    await vi.advanceTimersByTimeAsync(POLL_INTERVAL_MS + 100)
    expect(eventBatches()).toEqual([])

    fs.writeFileSync(path.join(headsDir, 'main'), 'abc\n')
    await vi.advanceTimersByTimeAsync(POLL_INTERVAL_MS + 100)

    expect(eventBatches()).toEqual([[{ path: headsDir, type: 'update' }]])
    expect(parcel.writeSnapshot).not.toHaveBeenCalled()
    expect(parcel.getEventsSince).not.toHaveBeenCalled()
  })
})
