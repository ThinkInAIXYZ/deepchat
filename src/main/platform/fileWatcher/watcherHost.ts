import { randomUUID } from 'crypto'
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
export const SNAPSHOT_POLL_INTERVAL_MS = 5007

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
  recovering: boolean
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
      recovering: false,
      disposed: false
    }

    this.watches.set(request.id, activeWatch)

    try {
      await this.subscribeNative(activeWatch)
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

  private async subscribeNative(activeWatch: ActiveWatch): Promise<void> {
    const subscription = await parcelWatcher.subscribe(
      activeWatch.request.rootPath,
      (error, events) => {
        if (error) {
          void this.recoverNative(activeWatch)
          return
        }
        this.enqueueEvents(activeWatch, toWatcherEvents(events))
      },
      {
        ignore: activeWatch.request.excludes
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
  }

  // Errors delivered through the subscription callback mean events were lost. FSEvents keeps the
  // stream running after dropping events, while a Windows buffer overflow or an inotify failure
  // tears the subscription down. Resubscribing and requesting a full rescan covers both cases;
  // only a failed resubscribe falls back to snapshot polling.
  private async recoverNative(activeWatch: ActiveWatch): Promise<void> {
    if (activeWatch.disposed || activeWatch.recovering) {
      return
    }

    activeWatch.recovering = true
    try {
      await this.unsubscribeNative(activeWatch).catch(() => undefined)
      await this.subscribeNative(activeWatch)
      this.enqueueEvents(activeWatch, [
        {
          path: activeWatch.request.rootPath,
          type: 'overflow'
        }
      ])
    } catch (error) {
      await this.handleNativeError(activeWatch, error)
    } finally {
      activeWatch.recovering = false
    }
  }

  private async handleNativeError(activeWatch: ActiveWatch, error: unknown): Promise<void> {
    // Several error callbacks can arrive before the native unsubscribe finishes. Only the first
    // one may start a fallback, or each would run its own poll loop on the same snapshot.
    if (activeWatch.disposed || activeWatch.mode !== 'native') {
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

    activeWatch.mode = activeWatch.request.fallbackMode ?? 'snapshot-polling'
    await this.unsubscribeNative(activeWatch)

    if (activeWatch.mode === 'git-metadata-polling') {
      this.startSnapshotPolling(activeWatch, message)
      return
    }

    this.startSnapshotPolling(activeWatch, message)
  }

  private startSnapshotPolling(activeWatch: ActiveWatch, message?: string): void {
    // The random suffix keeps a file left by a crashed process with a reused pid from being taken
    // as this watch's baseline, which would replay events from long ago.
    const snapshotPath = path.join(
      os.tmpdir(),
      `deepchat-watcher-${process.pid}-${activeWatch.request.id}-${randomUUID()}.snapshot`
    )
    activeWatch.snapshotPath = snapshotPath

    // The native write can still be running when dispose removes the snapshot, and would recreate
    // it afterwards. Deleting again once the write settles converges whichever side finishes first.
    const writeSnapshot = async (): Promise<boolean> => {
      await parcelWatcher.writeSnapshot(activeWatch.request.rootPath, snapshotPath, {
        ignore: activeWatch.request.excludes
      })
      if (activeWatch.disposed) {
        fs.rmSync(snapshotPath, { force: true })
        return false
      }
      return true
    }

    const poll = async (): Promise<boolean> => {
      if (activeWatch.disposed) {
        return false
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
          return false
        }

        if (!fs.existsSync(snapshotPath)) {
          if (!(await writeSnapshot())) {
            return false
          }
          this.sendStatus(activeWatch, {
            health: 'degraded',
            mode: activeWatch.mode,
            reason: 'fallback-started',
            message
          })
          return true
        }

        const events = await parcelWatcher.getEventsSince(
          activeWatch.request.rootPath,
          snapshotPath,
          {
            ignore: activeWatch.request.excludes
          }
        )
        if (activeWatch.disposed || !(await writeSnapshot())) {
          return false
        }
        this.enqueueEvents(activeWatch, toWatcherEvents(events))
      } catch (error) {
        this.sendStatus(activeWatch, {
          health: 'failed',
          mode: activeWatch.mode,
          reason: 'native-error',
          message: serializeErrorMessage(error)
        })
      }
      return true
    }

    // Each poll is scheduled only after the previous one settles. Overlapping polls would queue
    // behind the native backend lock and keep replaying events from the same stale snapshot.
    const runPoll = async () => {
      activeWatch.pollTimer = null
      if ((await poll()) && !activeWatch.disposed) {
        activeWatch.pollTimer = setTimeout(() => void runPoll(), SNAPSHOT_POLL_INTERVAL_MS)
      }
    }
    void runPoll()
  }

  private enqueueEvents(activeWatch: ActiveWatch, events: WatcherEvent[]): void {
    if (activeWatch.disposed || events.length === 0) {
      return
    }

    // Check before spreading: spreading a very large batch into push() throws a RangeError.
    if (activeWatch.buffer.length + events.length <= MAX_BUFFERED_EVENTS) {
      activeWatch.buffer.push(...events)
    } else {
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
      clearTimeout(activeWatch.pollTimer)
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
