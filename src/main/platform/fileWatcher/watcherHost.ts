import fs from 'fs'
import os from 'os'
import path from 'path'
import parcelWatcher from '@parcel/watcher'
import { coalesceWatcherEvents } from './eventCoalescer'
import type {
  FileWatcherHostEvent,
  WatcherEvent,
  WatcherEventBatch,
  WatchMode,
  WatchRequest,
  WatcherStatus
} from './watcherTypes'

const FILE_CHANGES_HANDLER_DELAY_MS = 75
const MAX_BUFFERED_EVENTS = 30000
const MAX_EVENT_CHUNK_SIZE = 500
const EVENT_CHUNK_DELAY_MS = 200
const SNAPSHOT_POLL_INTERVAL_MS = 5007

type ParcelSubscription = Awaited<ReturnType<typeof parcelWatcher.subscribe>>

type HostTransport = {
  postMessage(message: FileWatcherHostEvent): void
}

type ActiveWatch = {
  request: WatchRequest
  mode: WatchMode
  subscription: ParcelSubscription | null
  buffer: WatcherEvent[]
  flushTimer: NodeJS.Timeout | null
  chunkTimer: NodeJS.Timeout | null
  pollTimer: NodeJS.Timeout | null
  snapshotPath: string | null
  disposed: boolean
}

const serializeErrorMessage = (error: unknown): string => {
  if (error instanceof Error) {
    return error.message
  }
  return String(error)
}

const toWatcherEvents = (events: parcelWatcher.Event[]): WatcherEvent[] =>
  events.map((event) => ({
    path: event.path,
    type: event.type
  }))

export class FileWatcherHost {
  private readonly watches = new Map<string, ActiveWatch>()

  constructor(private readonly transport: HostTransport) {}

  async watch(request: WatchRequest): Promise<void> {
    await this.unwatch(request.id)

    const activeWatch: ActiveWatch = {
      request,
      mode: 'native',
      subscription: null,
      buffer: [],
      flushTimer: null,
      chunkTimer: null,
      pollTimer: null,
      snapshotPath: null,
      disposed: false
    }

    this.watches.set(request.id, activeWatch)

    try {
      const subscription = await parcelWatcher.subscribe(
        request.rootPath,
        (error, events) => {
          if (error) {
            void this.handleNativeError(activeWatch, error)
            return
          }
          this.enqueueEvents(activeWatch, toWatcherEvents(events))
        },
        {
          ignore: request.excludes
        }
      )

      if (activeWatch.disposed) {
        await subscription.unsubscribe()
        return
      }

      activeWatch.subscription = subscription
      this.sendStatus(activeWatch, {
        health: 'healthy',
        mode: 'native',
        reason: 'ready'
      })
    } catch (error) {
      await this.handleNativeError(activeWatch, error)
    }
  }

  async unwatch(watchId: string): Promise<void> {
    const activeWatch = this.watches.get(watchId)
    if (!activeWatch) {
      return
    }

    this.watches.delete(watchId)
    await this.disposeActiveWatch(activeWatch)
  }

  async shutdown(): Promise<void> {
    const activeWatches = Array.from(this.watches.values())
    this.watches.clear()
    await Promise.all(activeWatches.map((activeWatch) => this.disposeActiveWatch(activeWatch)))
  }

  private async handleNativeError(activeWatch: ActiveWatch, error: unknown): Promise<void> {
    if (activeWatch.disposed) {
      return
    }

    const message = serializeErrorMessage(error)
    this.sendStatus(activeWatch, {
      health: 'degraded',
      mode: activeWatch.request.fallbackMode ?? 'snapshot-polling',
      reason: 'native-error',
      message
    })

    await this.startFallback(activeWatch, message)
  }

  private async startFallback(activeWatch: ActiveWatch, message?: string): Promise<void> {
    if (activeWatch.disposed) {
      return
    }

    await this.unsubscribeNative(activeWatch)
    activeWatch.mode = activeWatch.request.fallbackMode ?? 'snapshot-polling'

    if (activeWatch.mode === 'git-metadata-polling') {
      this.startSnapshotPolling(activeWatch, message)
      return
    }

    this.startSnapshotPolling(activeWatch, message)
  }

  private startSnapshotPolling(activeWatch: ActiveWatch, message?: string): void {
    const snapshotPath = path.join(
      os.tmpdir(),
      `deepchat-watcher-${process.pid}-${activeWatch.request.id}.snapshot`
    )
    activeWatch.snapshotPath = snapshotPath

    const poll = async () => {
      if (activeWatch.disposed) {
        return
      }

      try {
        if (!fs.existsSync(activeWatch.request.rootPath)) {
          this.enqueueEvents(activeWatch, [
            {
              path: activeWatch.request.rootPath,
              type: 'root-deleted'
            }
          ])
          this.sendStatus(activeWatch, {
            health: 'failed',
            mode: activeWatch.mode,
            reason: 'root-deleted'
          })
          if (activeWatch.pollTimer) {
            clearInterval(activeWatch.pollTimer)
            activeWatch.pollTimer = null
          }
          return
        }

        if (!fs.existsSync(snapshotPath)) {
          await parcelWatcher.writeSnapshot(activeWatch.request.rootPath, snapshotPath, {
            ignore: activeWatch.request.excludes
          })
          this.sendStatus(activeWatch, {
            health: 'degraded',
            mode: activeWatch.mode,
            reason: 'fallback-started',
            message
          })
          return
        }

        const events = await parcelWatcher.getEventsSince(
          activeWatch.request.rootPath,
          snapshotPath,
          {
            ignore: activeWatch.request.excludes
          }
        )
        await parcelWatcher.writeSnapshot(activeWatch.request.rootPath, snapshotPath, {
          ignore: activeWatch.request.excludes
        })
        this.enqueueEvents(activeWatch, toWatcherEvents(events))
      } catch (error) {
        this.sendStatus(activeWatch, {
          health: 'failed',
          mode: activeWatch.mode,
          reason: 'native-error',
          message: serializeErrorMessage(error)
        })
      }
    }

    activeWatch.pollTimer = setInterval(() => {
      void poll()
    }, SNAPSHOT_POLL_INTERVAL_MS)
    void poll()
  }

  private enqueueEvents(activeWatch: ActiveWatch, events: WatcherEvent[]): void {
    if (activeWatch.disposed || events.length === 0) {
      return
    }

    activeWatch.buffer.push(...events)
    if (activeWatch.buffer.length > MAX_BUFFERED_EVENTS) {
      activeWatch.buffer = [
        {
          path: activeWatch.request.rootPath,
          type: 'overflow'
        }
      ]
      this.sendStatus(activeWatch, {
        health: 'degraded',
        mode: activeWatch.mode,
        reason: 'overflow',
        message: `Buffered watcher events exceeded ${MAX_BUFFERED_EVENTS}.`
      })
    }

    if (activeWatch.flushTimer) {
      return
    }

    activeWatch.flushTimer = setTimeout(() => {
      activeWatch.flushTimer = null
      this.flushEvents(activeWatch)
    }, FILE_CHANGES_HANDLER_DELAY_MS)
  }

  private flushEvents(activeWatch: ActiveWatch): void {
    if (activeWatch.disposed || activeWatch.buffer.length === 0) {
      return
    }

    const events =
      activeWatch.request.purpose === 'workspace-git'
        ? activeWatch.buffer
        : coalesceWatcherEvents(activeWatch.buffer)
    activeWatch.buffer = []
    this.sendChunks(activeWatch, events)
  }

  private sendChunks(activeWatch: ActiveWatch, events: WatcherEvent[]): void {
    if (activeWatch.disposed || events.length === 0) {
      return
    }

    const chunk = events.slice(0, MAX_EVENT_CHUNK_SIZE)
    this.sendBatch(activeWatch, chunk)
    const rest = events.slice(MAX_EVENT_CHUNK_SIZE)
    if (rest.length === 0) {
      return
    }

    activeWatch.chunkTimer = setTimeout(() => {
      activeWatch.chunkTimer = null
      this.sendChunks(activeWatch, rest)
    }, EVENT_CHUNK_DELAY_MS)
  }

  private sendBatch(activeWatch: ActiveWatch, events: WatcherEvent[]): void {
    const batch: WatcherEventBatch = {
      watchId: activeWatch.request.id,
      rootPath: activeWatch.request.rootPath,
      purpose: activeWatch.request.purpose,
      hostKind: activeWatch.request.hostKind,
      mode: activeWatch.mode,
      events,
      version: Date.now()
    }

    this.transport.postMessage({
      type: 'file-watcher:event-batch',
      batch
    })
  }

  private sendStatus(
    activeWatch: ActiveWatch,
    status: Pick<WatcherStatus, 'health' | 'mode' | 'reason' | 'message'>
  ): void {
    this.transport.postMessage({
      type: 'file-watcher:status',
      status: {
        watchId: activeWatch.request.id,
        rootPath: activeWatch.request.rootPath,
        purpose: activeWatch.request.purpose,
        hostKind: activeWatch.request.hostKind,
        health: status.health,
        mode: status.mode,
        reason: status.reason,
        message: status.message,
        version: Date.now()
      }
    })
  }

  private async disposeActiveWatch(activeWatch: ActiveWatch): Promise<void> {
    activeWatch.disposed = true

    if (activeWatch.flushTimer) {
      clearTimeout(activeWatch.flushTimer)
      activeWatch.flushTimer = null
    }

    if (activeWatch.chunkTimer) {
      clearTimeout(activeWatch.chunkTimer)
      activeWatch.chunkTimer = null
    }

    if (activeWatch.pollTimer) {
      clearInterval(activeWatch.pollTimer)
      activeWatch.pollTimer = null
    }

    await this.unsubscribeNative(activeWatch)

    if (activeWatch.snapshotPath) {
      fs.rmSync(activeWatch.snapshotPath, { force: true })
      activeWatch.snapshotPath = null
    }
  }

  private async unsubscribeNative(activeWatch: ActiveWatch): Promise<void> {
    const subscription = activeWatch.subscription
    activeWatch.subscription = null
    if (subscription) {
      await subscription.unsubscribe()
    }
  }
}
