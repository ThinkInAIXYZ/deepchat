import type { DeepchatBridge } from '@shared/contracts/bridge'
import {
  syncBackupCompletedEvent,
  syncBackupErrorEvent,
  syncBackupStartedEvent,
  syncBackupStatusChangedEvent,
  syncImportCompletedEvent,
  syncImportErrorEvent,
  syncImportStartedEvent
} from '@shared/contracts/events'
import {
  syncGetBackupStatusRoute,
  syncImportRoute,
  syncListBackupsRoute,
  syncOpenFolderRoute,
  syncStartBackupRoute
} from '@shared/contracts/routes'
import { getDeepchatBridge } from './core'

export class SyncClient {
  constructor(private readonly bridge: DeepchatBridge = getDeepchatBridge()) {}

  async getBackupStatus() {
    const result = await this.bridge.invoke(syncGetBackupStatusRoute.name, {})
    return result.status
  }

  async listBackups() {
    const result = await this.bridge.invoke(syncListBackupsRoute.name, {})
    return result.backups
  }

  async startBackup() {
    const result = await this.bridge.invoke(syncStartBackupRoute.name, {})
    return result.backup
  }

  async importFromSync(backupFile: string, mode?: 'increment' | 'overwrite') {
    const result = await this.bridge.invoke(syncImportRoute.name, {
      backupFile,
      mode
    })
    return result.result
  }

  async openSyncFolder() {
    await this.bridge.invoke(syncOpenFolderRoute.name, {})
  }

  onBackupStarted(listener: (payload: { version: number }) => void) {
    return this.bridge.on(syncBackupStartedEvent.name, listener)
  }

  onBackupCompleted(listener: (payload: { timestamp: number; version: number }) => void) {
    return this.bridge.on(syncBackupCompletedEvent.name, listener)
  }

  onBackupError(listener: (payload: { error?: string; version: number }) => void) {
    return this.bridge.on(syncBackupErrorEvent.name, listener)
  }

  onBackupStatusChanged(
    listener: (payload: {
      status: string
      previousStatus?: string
      lastSuccessfulBackupTime?: number
      failed?: boolean
      message?: string
      version: number
    }) => void
  ) {
    return this.bridge.on(syncBackupStatusChangedEvent.name, listener)
  }

  onImportStarted(listener: (payload: { version: number }) => void) {
    return this.bridge.on(syncImportStartedEvent.name, listener)
  }

  onImportCompleted(listener: (payload: { version: number }) => void) {
    return this.bridge.on(syncImportCompletedEvent.name, listener)
  }

  onImportError(listener: (payload: { error?: string; version: number }) => void) {
    return this.bridge.on(syncImportErrorEvent.name, listener)
  }
}
