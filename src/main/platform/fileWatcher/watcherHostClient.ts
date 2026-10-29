import type {
  FileWatcherHostEvent,
  FileWatcherRpcMethod,
  FileWatcherRpcRequest,
  FileWatcherRpcResponse,
  WatchBatchListener,
  WatcherHostKind,
  WatchRequest,
  WatchStatusListener
} from './watcherTypes'

export interface FileWatcherHost {
  postMessage(message: FileWatcherRpcRequest): void
  onMessage(listener: (message: unknown) => void): void
  onExit(listener: (code: number) => void): void
  onError(listener: (type: string, location: string) => void): void
  terminate(): Promise<void>
}

export type SpawnFileWatcherHost = (
  kind: WatcherHostKind,
  signal: AbortSignal
) => Promise<FileWatcherHost>

type PendingRequest = {
  resolve(value: unknown): void
  reject(error: Error): void
}

const MAX_RESTART_ATTEMPTS = 3
const RESTART_DELAY_MS = 800
const RPC_TIMEOUT_MS = 15000

export class WatcherHostClient {
  private host: FileWatcherHost | null = null
  private hostReady: Promise<FileWatcherHost> | null = null
  private pendingSpawn: AbortController | undefined
  private stopping: Promise<void> | undefined
  private requestId = 0
  private restartAttempts = 0
  private restartTimer: NodeJS.Timeout | null = null
  private shuttingDown = false
  private readonly pendingRequests = new Map<string, PendingRequest>()
  private readonly activeRequests = new Map<string, WatchRequest>()
  private readonly batchListeners = new Set<WatchBatchListener>()
  private readonly statusListeners = new Set<WatchStatusListener>()

  constructor(
    private readonly hostKind: WatcherHostKind,
    private readonly spawnHost: SpawnFileWatcherHost
  ) {}

  onBatch(listener: WatchBatchListener): () => void {
    this.batchListeners.add(listener)
    return () => {
      this.batchListeners.delete(listener)
    }
  }

  onStatus(listener: WatchStatusListener): () => void {
    this.statusListeners.add(listener)
    return () => {
      this.statusListeners.delete(listener)
    }
  }

  async watch(request: WatchRequest): Promise<void> {
    this.activeRequests.set(request.id, request)
    try {
      await this.request('watch', [request])
      if (this.shuttingDown) throw new Error('File watcher is stopped.')
    } catch (error) {
      this.activeRequests.delete(request.id)
      throw error
    }
  }

  async unwatch(watchId: string): Promise<void> {
    this.activeRequests.delete(watchId)
    if (!this.host && !this.hostReady) {
      return
    }
    await this.request('unwatch', [watchId]).catch(() => {})
  }

  shutdown(): Promise<void> {
    if (this.stopping) return this.stopping
    this.shuttingDown = true
    this.pendingSpawn?.abort(new Error('File watcher startup canceled by shutdown.'))
    if (this.restartTimer) {
      clearTimeout(this.restartTimer)
      this.restartTimer = null
    }
    this.stopping = (async () => {
      await this.hostReady?.catch(() => undefined)
      const host = this.host
      try {
        if (host) await this.request('shutdown', [])
      } finally {
        await host?.terminate()
        this.host = null
        this.activeRequests.clear()
        this.rejectPendingRequests(new Error('File watcher process shut down.'))
      }
    })()
    return this.stopping
  }

  private async request<T = void>(method: FileWatcherRpcMethod, args: unknown[]): Promise<T> {
    if (this.shuttingDown && method !== 'shutdown') throw new Error('File watcher is stopped.')
    const host = this.host ?? (await this.ensureHost())
    if (host !== this.host || (this.shuttingDown && method !== 'shutdown'))
      throw new Error('File watcher generation ended.')
    const id = `watcher_rpc_${this.hostKind}_${++this.requestId}`

    return await new Promise<T>((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.pendingRequests.delete(id)
        reject(new Error(`File watcher RPC timed out: ${method} (${this.hostKind})`))
      }, RPC_TIMEOUT_MS)

      this.pendingRequests.set(id, {
        resolve: (value) => {
          clearTimeout(timeout)
          resolve(value as T)
        },
        reject: (error) => {
          clearTimeout(timeout)
          reject(error)
        }
      })

      const payload: FileWatcherRpcRequest = {
        type: 'file-watcher:request',
        id,
        method,
        args
      }

      try {
        host.postMessage(payload)
      } catch (error) {
        const pending = this.pendingRequests.get(id)
        this.pendingRequests.delete(id)
        pending?.reject(error instanceof Error ? error : new Error(String(error)))
      }
    })
  }

  private async ensureHost(): Promise<FileWatcherHost> {
    if (this.shuttingDown) throw new Error('File watcher is stopped.')
    if (this.host) {
      return this.host
    }

    if (this.hostReady) {
      return await this.hostReady
    }

    const opening = Promise.resolve().then(() => this.startHost())
    this.hostReady = opening
    try {
      return await opening
    } finally {
      if (this.hostReady === opening) this.hostReady = null
    }
  }

  private async startHost(): Promise<FileWatcherHost> {
    if (this.shuttingDown) throw new Error('File watcher is stopped.')
    const startup = new AbortController()
    this.pendingSpawn = startup
    try {
      const host = await this.spawnHost(this.hostKind, startup.signal)
      if (this.shuttingDown || startup.signal.aborted) {
        await host.terminate()
        throw new Error('File watcher startup was superseded by shutdown.')
      }
      this.host = host
      this.restartAttempts = 0
      host.onMessage((message) => {
        if (this.host === host) this.handleHostMessage(message)
      })
      host.onExit((code) => {
        if (this.host === host) this.handleHostExit(code)
      })
      host.onError((type, location) => {
        if (this.host === host && !this.shuttingDown)
          console.error('[FileWatcherClient] Helper process error:', {
            hostKind: this.hostKind,
            type,
            location
          })
      })
      return host
    } finally {
      if (this.pendingSpawn === startup) this.pendingSpawn = undefined
    }
  }

  private handleHostMessage(message: unknown): void {
    if (!message || typeof message !== 'object') {
      return
    }

    const response = message as FileWatcherRpcResponse
    if (response.type === 'file-watcher:response') {
      this.handleRpcResponse(response)
      return
    }
    if (this.shuttingDown) return

    const hostEvent = message as FileWatcherHostEvent
    if (hostEvent.type === 'file-watcher:event-batch') {
      for (const listener of this.batchListeners) {
        listener(hostEvent.batch)
      }
      return
    }

    if (hostEvent.type === 'file-watcher:status') {
      for (const listener of this.statusListeners) {
        listener(hostEvent.status)
      }
    }
  }

  private handleRpcResponse(response: FileWatcherRpcResponse): void {
    const pending = this.pendingRequests.get(response.id)
    if (!pending) {
      return
    }

    this.pendingRequests.delete(response.id)
    if (response.ok) {
      pending.resolve(response.data)
      return
    }

    const error = new Error(response.error.message)
    if (response.error.stack) {
      error.stack = response.error.stack
    }
    pending.reject(error)
  }

  private handleHostExit(code: number): void {
    const error = new Error(`File watcher utility process exited with code ${code}.`)
    this.host = null
    this.hostReady = null
    this.rejectPendingRequests(error)

    if (this.shuttingDown || this.activeRequests.size === 0) {
      return
    }

    for (const request of this.activeRequests.values()) {
      for (const listener of this.statusListeners) {
        listener({
          watchId: request.id,
          rootPath: request.rootPath,
          purpose: request.purpose,
          hostKind: request.hostKind,
          health: 'degraded',
          mode: request.fallbackMode ?? 'snapshot-polling',
          reason: 'utility-exit',
          message: error.message,
          version: Date.now()
        })
      }
    }

    this.scheduleRestart()
  }

  private scheduleRestart(): void {
    if (this.shuttingDown || this.restartTimer || this.restartAttempts >= MAX_RESTART_ATTEMPTS) {
      return
    }

    this.restartAttempts += 1
    this.restartTimer = setTimeout(() => {
      this.restartTimer = null
      void this.replayActiveRequests()
    }, RESTART_DELAY_MS)
  }

  private async replayActiveRequests(): Promise<void> {
    const requests = Array.from(this.activeRequests.values())
    if (requests.length === 0 || this.shuttingDown) {
      return
    }

    try {
      await this.ensureHost()
      await Promise.all(requests.map((request) => this.request('watch', [request])))
    } catch (error) {
      console.error('[FileWatcherClient] Failed to restart utility watcher:', {
        hostKind: this.hostKind,
        error
      })
      this.scheduleRestart()
    }
  }

  private rejectPendingRequests(error: Error): void {
    for (const pending of this.pendingRequests.values()) {
      pending.reject(error)
    }
    this.pendingRequests.clear()
  }
}
