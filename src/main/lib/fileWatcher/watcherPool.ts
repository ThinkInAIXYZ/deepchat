import path from 'path'
import { WatcherHostClient } from './watcherHostClient'
import type {
  WatchBatchListener,
  WatcherEvent,
  WatcherEventBatch,
  WatchHandle,
  WatchRequest,
  WatcherStatus,
  WatchStatusListener
} from './watcherTypes'

type WatcherPoolEntry = {
  key: string
  request: WatchRequest
  listeners: Set<WatchBatchListener>
  statusListeners: Set<WatchStatusListener>
  ready: Promise<void>
}

const normalizePathKey = (targetPath: string): string => {
  const comparablePath =
    process.platform === 'darwin' && targetPath.startsWith('/private/')
      ? targetPath.slice('/private'.length)
      : targetPath
  const normalized = path.normalize(comparablePath)
  return process.platform === 'win32' ? normalized.toLowerCase() : normalized
}

const normalizeList = (values: string[] | undefined): string[] =>
  [...(values ?? [])].map(normalizePathKey).sort()

const isEqualOrDescendant = (targetPath: string, basePath: string): boolean => {
  const normalizedTarget = normalizePathKey(targetPath)
  const normalizedBase = normalizePathKey(basePath)
  if (normalizedTarget === normalizedBase) {
    return true
  }

  const relative = path.relative(normalizedBase, normalizedTarget)
  return Boolean(relative) && !relative.startsWith('..') && !path.isAbsolute(relative)
}

const shouldPassIncludes = (event: WatcherEvent, includes: string[] | undefined): boolean => {
  if (event.type === 'overflow' || event.type === 'root-deleted') {
    return true
  }

  if (!includes?.length) {
    return true
  }

  return includes.some((includePath) => isEqualOrDescendant(event.path, includePath))
}

const shouldPassExcludes = (event: WatcherEvent, excludes: string[] | undefined): boolean => {
  if (event.type === 'overflow' || event.type === 'root-deleted') {
    return true
  }

  if (!excludes?.length) {
    return true
  }

  return !excludes.some((excludePath) => isEqualOrDescendant(event.path, excludePath))
}

function filterBatch(batch: WatcherEventBatch, request: WatchRequest): WatcherEventBatch | null {
  const events = batch.events.filter(
    (event) =>
      shouldPassIncludes(event, request.includes) && shouldPassExcludes(event, request.excludes)
  )

  if (events.length === 0) {
    return null
  }

  return {
    ...batch,
    events
  }
}

export class WatcherPool {
  private sequence = 0
  private readonly entriesByKey = new Map<string, WatcherPoolEntry>()
  private readonly entriesByWatchId = new Map<string, WatcherPoolEntry>()
  private readonly contentClient: WatcherHostClient
  private readonly gitClient: WatcherHostClient

  constructor(clients?: { content?: WatcherHostClient; git?: WatcherHostClient }) {
    this.contentClient = clients?.content ?? new WatcherHostClient('content')
    this.gitClient = clients?.git ?? new WatcherHostClient('git')
    this.contentClient.onBatch((batch) => this.handleBatch(batch))
    this.gitClient.onBatch((batch) => this.handleBatch(batch))
    this.contentClient.onStatus((status) => this.handleStatus(status))
    this.gitClient.onStatus((status) => this.handleStatus(status))
  }

  async watch(
    request: WatchRequest,
    onBatch: WatchBatchListener,
    onStatus?: WatchStatusListener
  ): Promise<WatchHandle> {
    const key = this.createPoolKey(request)
    let entry = this.entriesByKey.get(key)

    if (!entry) {
      const pooledRequest = {
        ...request,
        id: `watch_pool_${++this.sequence}`
      }
      entry = {
        key,
        request: pooledRequest,
        listeners: new Set(),
        statusListeners: new Set(),
        ready: this.getClient(pooledRequest).watch(pooledRequest)
      }
      this.entriesByKey.set(key, entry)
      this.entriesByWatchId.set(pooledRequest.id, entry)
    }

    entry.listeners.add(onBatch)
    if (onStatus) {
      entry.statusListeners.add(onStatus)
    }

    try {
      await entry.ready
    } catch (error) {
      entry.listeners.delete(onBatch)
      if (onStatus) {
        entry.statusListeners.delete(onStatus)
      }
      if (this.entriesByKey.get(entry.key) === entry) {
        this.entriesByKey.delete(entry.key)
      }
      if (this.entriesByWatchId.get(entry.request.id) === entry) {
        this.entriesByWatchId.delete(entry.request.id)
      }
      throw error
    }

    return {
      close: async () => {
        await this.unwatch(entry, onBatch, onStatus)
      }
    }
  }

  async destroy(): Promise<void> {
    this.entriesByKey.clear()
    this.entriesByWatchId.clear()
    await Promise.all([this.contentClient.shutdown(), this.gitClient.shutdown()])
  }

  private async unwatch(
    entry: WatcherPoolEntry,
    onBatch: WatchBatchListener,
    onStatus?: WatchStatusListener
  ): Promise<void> {
    entry.listeners.delete(onBatch)
    if (onStatus) {
      entry.statusListeners.delete(onStatus)
    }

    if (entry.listeners.size > 0 || entry.statusListeners.size > 0) {
      return
    }

    this.entriesByKey.delete(entry.key)
    this.entriesByWatchId.delete(entry.request.id)
    await this.getClient(entry.request).unwatch(entry.request.id)
  }

  private handleBatch(batch: WatcherEventBatch): void {
    const entry = this.entriesByWatchId.get(batch.watchId)
    if (!entry) {
      return
    }

    const filteredBatch = filterBatch(batch, entry.request)
    if (!filteredBatch) {
      return
    }

    for (const listener of entry.listeners) {
      listener(filteredBatch)
    }
  }

  private handleStatus(status: WatcherStatus): void {
    const entry = this.entriesByWatchId.get(status.watchId)
    if (!entry) {
      return
    }

    for (const listener of entry.statusListeners) {
      listener(status)
    }
  }

  private getClient(request: WatchRequest): WatcherHostClient {
    return request.hostKind === 'git' ? this.gitClient : this.contentClient
  }

  private createPoolKey(request: WatchRequest): string {
    return JSON.stringify({
      hostKind: request.hostKind,
      purpose: request.purpose,
      rootPath: normalizePathKey(request.rootPath),
      recursive: request.recursive,
      includes: normalizeList(request.includes),
      excludes: normalizeList(request.excludes),
      fallbackMode: request.fallbackMode ?? null
    })
  }
}
