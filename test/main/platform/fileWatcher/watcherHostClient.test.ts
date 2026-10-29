import { EventEmitter } from 'node:events'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { spawnFileWatcherHost } from '@/app/fileWatcherHost'
import { WatcherHostClient, type FileWatcherHost } from '@/platform/fileWatcher/watcherHostClient'
import type { FileWatcherRpcRequest, WatchRequest } from '@/platform/fileWatcher/watcherTypes'

const mocks = vi.hoisted(() => ({ fork: vi.fn() }))
vi.mock('electron', () => ({ utilityProcess: { fork: mocks.fork } }))

const request: WatchRequest = {
  id: 'workspace',
  rootPath: path.resolve('workspace'),
  hostKind: 'content',
  purpose: 'workspace-content',
  recursive: true
}

function child() {
  const host = Object.assign(new EventEmitter(), {
    postMessage: vi.fn((message: FileWatcherRpcRequest) => {
      queueMicrotask(() =>
        host.emit('message', {
          type: 'file-watcher:response',
          id: message.id,
          ok: true,
          data: undefined
        })
      )
    }),
    kill: vi.fn(() => true)
  })
  return host
}

describe('File watcher helper ownership', () => {
  beforeEach(() => {
    mocks.fork.mockReset()
  })
  afterEach(() => vi.useRealTimers())

  const client = () =>
    new WatcherHostClient('content', (kind, signal) =>
      spawnFileWatcherHost(path.resolve('out/main/fileWatcherUtilityHost.js'), kind, signal)
    )

  it('waits for actual helper exit after shutdown acknowledgement and fences further work', async () => {
    const native = child()
    mocks.fork.mockReturnValue(native)
    const owner = client()
    const batch = vi.fn()
    owner.onBatch(batch)
    const watching = owner.watch(request)
    await Promise.resolve()
    native.emit('spawn')
    await watching
    let stopped = false
    const closing = owner.shutdown().then(() => {
      stopped = true
    })
    await vi.waitFor(() => expect(native.kill).toHaveBeenCalledOnce())
    expect(stopped).toBe(false)
    native.emit('message', { type: 'file-watcher:event-batch', batch: { watchId: request.id } })
    expect(batch).not.toHaveBeenCalled()
    await expect(owner.watch({ ...request, id: 'late' })).rejects.toThrow('stopped')
    native.emit('exit', 0)
    await closing
    await owner.shutdown()
    expect(mocks.fork).toHaveBeenCalledOnce()
  })

  it('keeps canceled startup owned until its native process exits', async () => {
    const native = child()
    mocks.fork.mockReturnValue(native)
    const owner = client()
    const watching = Promise.allSettled([owner.watch(request)])
    await Promise.resolve()
    let stopped = false
    const closing = owner.shutdown().then(() => {
      stopped = true
    })
    expect(native.kill).toHaveBeenCalledOnce()
    await Promise.resolve()
    expect(stopped).toBe(false)
    native.emit('spawn')
    expect(native.postMessage).not.toHaveBeenCalled()
    native.emit('exit', 0)
    expect((await watching)[0].status).toBe('rejected')
    await closing
    await expect(owner.watch(request)).rejects.toThrow('stopped')
    expect(mocks.fork).toHaveBeenCalledOnce()
  })

  it('retains startup ownership when native fork synchronously triggers shutdown', async () => {
    const native = child()
    const owner = client()
    let closing: Promise<void> | undefined
    mocks.fork.mockImplementation(() => {
      closing = owner.shutdown()
      return native
    })
    const watching = Promise.allSettled([owner.watch(request)])
    await Promise.resolve()
    expect(native.kill).toHaveBeenCalledOnce()
    let stopped = false
    void closing!.then(() => {
      stopped = true
    })
    await Promise.resolve()
    expect(stopped).toBe(false)
    native.emit('exit', 0)
    await closing
    expect((await watching)[0].status).toBe('rejected')
    expect(native.postMessage).not.toHaveBeenCalled()
  })

  it('drains a late host even when its launcher ignores cancellation', async () => {
    const opening = Promise.withResolvers<FileWatcherHost>()
    const exit = Promise.withResolvers<void>()
    const host: FileWatcherHost = {
      postMessage: vi.fn(),
      onMessage: vi.fn(),
      onExit: vi.fn(),
      onError: vi.fn(),
      terminate: vi.fn(() => exit.promise)
    }
    const owner = new WatcherHostClient('git', async () => await opening.promise)
    const watching = Promise.allSettled([owner.watch({ ...request, hostKind: 'git' })])
    await Promise.resolve()
    let stopped = false
    const closing = owner.shutdown().then(() => {
      stopped = true
    })
    opening.resolve(host)
    await vi.waitFor(() => expect(host.terminate).toHaveBeenCalledOnce())
    expect(stopped).toBe(false)
    expect(host.postMessage).not.toHaveBeenCalled()
    exit.resolve()
    expect((await watching)[0].status).toBe('rejected')
    await closing
  })

  it('replays active watches after helper loss and ignores retired-host events', async () => {
    vi.useFakeTimers()
    const hosts = [child(), child()]
    mocks.fork.mockImplementation(() => {
      const native = hosts[mocks.fork.mock.calls.length - 1]
      queueMicrotask(() => native.emit('spawn'))
      return native
    })
    const owner = client()
    const batches = vi.fn()
    owner.onBatch(batches)
    const watching = owner.watch(request)
    await vi.advanceTimersByTimeAsync(0)
    await watching
    hosts[0].emit('exit', 1)
    await vi.advanceTimersByTimeAsync(800)
    expect(hosts[1].postMessage).toHaveBeenCalledWith(
      expect.objectContaining({ method: 'watch', args: [request] })
    )
    const batch = { watchId: request.id }
    hosts[0].emit('message', { type: 'file-watcher:event-batch', batch })
    hosts[0].emit('exit', 1)
    expect(batches).not.toHaveBeenCalled()
    hosts[1].emit('message', { type: 'file-watcher:event-batch', batch })
    expect(batches).toHaveBeenCalledWith(batch)
    const closing = owner.shutdown()
    await vi.advanceTimersByTimeAsync(0)
    hosts[1].emit('exit', 0)
    await closing
    await vi.advanceTimersByTimeAsync(1600)
    expect(mocks.fork).toHaveBeenCalledTimes(2)
  })
})
