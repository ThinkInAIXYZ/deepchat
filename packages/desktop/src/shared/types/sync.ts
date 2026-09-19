export interface CloudSyncConfigBase {
  enabled: boolean
  endpoint: string
  bucket: string
  region: string
  prefix: string
  accessKeyId: string
}

export interface CloudSyncConfigView extends CloudSyncConfigBase {
  hasSecret: boolean
  safeStorageAvailable: boolean
}

export interface CloudSyncConfigInput extends Partial<CloudSyncConfigBase> {
  secretAccessKey?: string
}

export interface ResolvedCloudSyncConfig {
  endpoint: string
  bucket: string
  region: string
  prefix: string
  accessKeyId: string
  secretAccessKey: string
}

export interface CloudSyncResult {
  success: boolean
  message: string
  fileName?: string
  count?: number
  sourceDbType?: 'agent' | 'chat'
  importedSessions?: number
}

export interface SyncBackupInfo {
  fileName: string
  createdAt: number
  size: number
}
