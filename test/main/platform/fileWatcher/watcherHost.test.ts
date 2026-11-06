import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { FileWatcherHost } from '../../../../src/main/platform/fileWatcher/watcherHost'
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

const POLL_INTERVAL_MS = 5007

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

  it('emits overflow for a batch too large to buffer', async () => {
    let emit: (error: Error | null, events: unknown[]) => void = () => {}
    parcel.subscribe.mockImplementation(async (_root: string, callback: typeof emit) => {
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

    const batches = messages.flatMap((message) =>
      message.type === 'file-watcher:event-batch' ? [message.batch] : []
    )
    expect(batches).toHaveLength(1)
    expect(batches[0].events).toEqual([{ path: rootPath, type: 'overflow' }])
  })
})
