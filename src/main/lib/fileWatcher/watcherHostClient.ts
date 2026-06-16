import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'
import type { UtilityProcess } from 'electron'
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

type PendingRequest = {
  resolve(value: unknown): void
  reject(error: Error): void
}

const MAX_RESTART_ATTEMPTS = 3
const RESTART_DELAY_MS = 800
const RPC_TIMEOUT_MS = 15000

export class WatcherHostClient {
  private host: UtilityProcess | null = null
  private hostReady: Promise<UtilityProcess> | null = null
  private requestId = 0
  private restartAttempts = 0
  private restartTimer: NodeJS.Timeout | null = null
  private shuttingDown = false
  private readonly pendingRequests = new Map<string, PendingRequest>()
  private readonly activeRequests = new Map<string, WatchRequest>()
  private readonly batchListeners = new Set<WatchBatchListener>()
  private readonly statusListeners = new Set<WatchStatusListener>()

  constructor(private readonly hostKind: WatcherHostKind) {}

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

  async shutdown(): Promise<void> {
    this.shuttingDown = true

    if (this.restartTimer) {
      clearTimeout(this.restartTimer)
      this.restartTimer = null
    }

    try {
      if (this.host) {
        await this.request('shutdown', [])
      }
    } finally {
      this.host?.kill()
      this.host = null
      this.hostReady = null
      this.activeRequests.clear()
      this.rejectPendingRequests(new Error('File watcher utility process shut down.'))
    }
  }

  private async request<T = void>(method: FileWatcherRpcMethod, args: unknown[]): Promise<T> {
    const host = await this.ensureHost()
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

  private async ensureHost(): Promise<UtilityProcess> {
    if (this.host) {
      return this.host
    }

    if (this.hostReady) {
      return await this.hostReady
    }

    this.shuttingDown = false
    this.hostReady = this.startHost()
    try {
      return await this.hostReady
    } finally {
      this.hostReady = null
    }
  }

  private async startHost(): Promise<UtilityProcess> {
    const { app, utilityProcess } = await import('electron')
    const modulePath = this.resolveUtilityHostEntryPoint(app.getAppPath())
    const serviceLabel = this.hostKind === 'git' ? 'Git' : 'Content'
    const host = utilityProcess.fork(modulePath, ['--deepchat-file-watcher-host'], {
      serviceName: `DeepChat ${serviceLabel} File Watcher`,
      stdio: 'ignore',
      env: {
        ...process.env,
        DEEPCHAT_FILE_WATCHER_HOST: '1',
        DEEPCHAT_FILE_WATCHER_HOST_KIND: this.hostKind
      }
    })

    host.on('message', (message) => this.handleHostMessage(message))
    host.on('exit', (code) => this.handleHostExit(code))
    host.on('error', (type, location) => {
      console.error('[FileWatcherClient] Utility process error:', {
        hostKind: this.hostKind,
        type,
        location
      })
    })

    return await new Promise<UtilityProcess>((resolve, reject) => {
      let settled = false
      const settle = (callback: () => void) => {
        if (settled) {
          return
        }
        settled = true
        host.off('spawn', onSpawn)
        host.off('exit', onExit)
        callback()
      }
      const onSpawn = () => {
        settle(() => {
          this.host = host
          this.restartAttempts = 0
          resolve(host)
        })
      }
      const onExit = (code: number) => {
        settle(() => {
          reject(new Error(`File watcher utility process exited before spawn: ${code}`))
        })
      }

      host.once('spawn', onSpawn)
      host.once('exit', onExit)
    })
  }

  private resolveUtilityHostEntryPoint(appPath?: string): string {
    const modulePath = fileURLToPath(import.meta.url)
    const candidates = [
      ...(appPath
        ? [
            path.join(appPath, 'out/main/fileWatcherUtilityHost.js'),
            path.join(appPath, 'fileWatcherUtilityHost.js')
          ]
        : []),
      path.resolve(path.dirname(modulePath), 'fileWatcherUtilityHost.js'),
      path.resolve(path.dirname(modulePath), '../fileWatcherUtilityHost.js'),
      path.resolve(process.cwd(), 'out/main/fileWatcherUtilityHost.js')
    ]

    return candidates.find((candidate) => fs.existsSync(candidate)) ?? candidates[0]
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
    if (this.restartTimer || this.restartAttempts >= MAX_RESTART_ATTEMPTS) {
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
