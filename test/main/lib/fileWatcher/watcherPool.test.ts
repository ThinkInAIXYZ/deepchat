import path from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { WatcherPool } from '../../../../src/main/lib/fileWatcher/watcherPool'
import type {
  WatchBatchListener,
  WatcherEventBatch,
  WatchRequest,
  WatchStatus,
  WatchStatusListener
} from '../../../../src/main/lib/fileWatcher'

class FakeWatcherHostClient {
  readonly requests: WatchRequest[] = []
  readonly batchListeners = new Set<WatchBatchListener>()
  readonly statusListeners = new Set<WatchStatusListener>()
  watchError: Error | null = null
  readonly watch = vi.fn(async (request: WatchRequest) => {
    if (this.watchError) {
      throw this.watchError
    }
    this.requests.push(request)
  })
  readonly unwatch = vi.fn(async (_watchId: string) => {})
  readonly shutdown = vi.fn(async () => {})

  onBatch(listener: WatchBatchListener): () => void {
    this.batchListeners.add(listener)
    return () => this.batchListeners.delete(listener)
  }

  onStatus(listener: WatchStatusListener): () => void {
    this.statusListeners.add(listener)
    return () => this.statusListeners.delete(listener)
  }

  emitBatch(batch: WatcherEventBatch): void {
    for (const listener of this.batchListeners) {
      listener(batch)
    }
  }

  emitStatus(status: WatcherStatus): void {
    for (const listener of this.statusListeners) {
      listener(status)
    }
  }
}

function createPoolWithClients() {
  const content = new FakeWatcherHostClient()
  const git = new FakeWatcherHostClient()
  return {
    pool: new WatcherPool({
      content: content as never,
      git: git as never
    }),
    content,
    git
  }
}

function createRequest(overrides: Partial<WatchRequest> = {}): WatchRequest {
  return {
    id: 'logical-request',
    rootPath: '/tmp/work',
    hostKind: 'content',
    purpose: 'workspace-content',
    recursive: true,
    fallbackMode: 'snapshot-polling',
    ...overrides
  }
}

describe('WatcherPool', () => {
  it('deduplicates identical requests and keeps the backend alive until the last handle closes', async () => {
    const { pool, content } = createPoolWithClients()
    const firstListener = vi.fn()
    const secondListener = vi.fn()

    const first = await pool.watch(createRequest(), firstListener)
    const second = await pool.watch(createRequest(), secondListener)

    expect(content.watch).toHaveBeenCalledTimes(1)

    await first.close()
    expect(content.unwatch).not.toHaveBeenCalled()

    await second.close()
    expect(content.unwatch).toHaveBeenCalledTimes(1)
    expect(content.unwatch).toHaveBeenCalledWith(content.requests[0].id)
  })

  it('filters batches by include paths before fan-out', async () => {
    const { pool, git } = createPoolWithClients()
    const listener = vi.fn()
    const rootPath = process.platform === 'darwin' ? '/var/tmp/work' : '/tmp/work'
    const includedPath = path.join(rootPath, '.git', 'index')
    const eventPath =
      process.platform === 'darwin' ? path.join('/private', includedPath) : includedPath

    await pool.watch(
      createRequest({
        hostKind: 'git',
        purpose: 'workspace-git',
        rootPath,
        includes: [includedPath],
        fallbackMode: 'git-metadata-polling'
      }),
      listener
    )

    const request = git.requests[0]
    git.emitBatch({
      watchId: request.id,
      rootPath: request.rootPath,
      purpose: request.purpose,
      hostKind: request.hostKind,
      mode: 'native',
      events: [
        { type: 'update', path: eventPath },
        { type: 'update', path: path.join(rootPath, 'src', 'main.ts') }
      ],
      version: 1
    })

    expect(listener).toHaveBeenCalledTimes(1)
    expect(listener.mock.calls[0][0].events).toEqual([{ type: 'update', path: eventPath }])
  })

  it('routes status events to listeners for the matching pooled watch', async () => {
    const { pool, content } = createPoolWithClients()
    const statusListener = vi.fn()

    await pool.watch(createRequest(), vi.fn(), statusListener)
    const request = content.requests[0]

    content.emitStatus({
      watchId: request.id,
      rootPath: request.rootPath,
      purpose: request.purpose,
      hostKind: request.hostKind,
      health: 'degraded',
      mode: 'snapshot-polling',
      reason: 'fallback-started',
      version: 2
    })

    expect(statusListener).toHaveBeenCalledWith(
      expect.objectContaining({
        health: 'degraded',
        mode: 'snapshot-polling',
        reason: 'fallback-started'
      })
    )
  })

  it('removes failed pooled watches so later callers can retry', async () => {
    const { pool, content } = createPoolWithClients()
    const request = createRequest()
    const firstListener = vi.fn()
    const secondListener = vi.fn()

    content.watchError = new Error('native watcher failed')
    await expect(pool.watch(request, firstListener)).rejects.toThrow('native watcher failed')

    content.watchError = null
    const handle = await pool.watch(request, secondListener)

    expect(content.watch).toHaveBeenCalledTimes(2)
    expect(content.requests).toHaveLength(1)

    await handle.close()
    expect(content.unwatch).toHaveBeenCalledWith(content.requests[0].id)
  })
})
