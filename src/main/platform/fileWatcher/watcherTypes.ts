export type WatcherHostKind = 'content' | 'git'

export type WatchPurpose = 'workspace-content' | 'workspace-git' | 'skills'

export type WatchEventType = 'create' | 'update' | 'delete' | 'overflow' | 'root-deleted'

export type WatchMode = 'native' | 'snapshot-polling' | 'git-metadata-polling'

export type WatchHealth = 'healthy' | 'degraded' | 'failed'

export type WatchStatusReason =
  | 'ready'
  | 'native-error'
  | 'utility-exit'
  | 'fallback-started'
  | 'overflow'
  | 'root-deleted'
  | 'shutdown'

export interface WatcherEvent {
  path: string
  type: WatchEventType
}

export interface WatcherEventBatch {
  watchId: string
  rootPath: string
  purpose: WatchPurpose
  hostKind: WatcherHostKind
  mode: WatchMode
  events: WatcherEvent[]
  version: number
}

export interface WatcherStatus {
  watchId: string
  rootPath: string
  purpose: WatchPurpose
  hostKind: WatcherHostKind
  health: WatchHealth
  mode: WatchMode
  reason: WatchStatusReason
  message?: string
  version: number
}

export interface WatchRequest {
  id: string
  rootPath: string
  hostKind: WatcherHostKind
  purpose: WatchPurpose
  recursive: boolean
  includes?: string[]
  excludes?: string[]
  fallbackMode?: Exclude<WatchMode, 'native'>
}

export interface WatchHandle {
  close(): Promise<void>
}

export type WatchBatchListener = (batch: WatcherEventBatch) => void

export type WatchStatusListener = (status: WatcherStatus) => void

export interface IFileWatcherService {
  watch(
    request: WatchRequest,
    onBatch: WatchBatchListener,
    onStatus?: WatchStatusListener
  ): Promise<WatchHandle>
  destroy(): Promise<void>
}

export type FileWatcherRpcMethod = 'watch' | 'unwatch' | 'shutdown'

export interface FileWatcherRpcRequest {
  type: 'file-watcher:request'
  id: string
  method: FileWatcherRpcMethod
  args: unknown[]
}

export type FileWatcherRpcResponse =
  | {
      type: 'file-watcher:response'
      id: string
      ok: true
      data: unknown
    }
  | {
      type: 'file-watcher:response'
      id: string
      ok: false
      error: {
        message: string
        stack?: string
      }
    }

export type FileWatcherHostEvent =
  | {
      type: 'file-watcher:event-batch'
      batch: WatcherEventBatch
    }
  | {
      type: 'file-watcher:status'
      status: WatcherStatus
    }
