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
  syncStartBackupRoute,
  syncGetCloudConfigRoute,
  syncSetCloudConfigRoute,
  syncTestCloudRoute,
  syncUploadToCloudRoute,
  syncPullFromCloudRoute
} from '@shared/contracts/routes'
import type { CloudSyncConfigInput } from '@shared/presenter'
import { getDeepchatBridge } from './core'

export function createSyncClient(bridge: DeepchatBridge = getDeepchatBridge()) {
  async function getBackupStatus() {
    const result = await bridge.invoke(syncGetBackupStatusRoute.name, {})
    return result.status
  }

  async function listBackups() {
    const result = await bridge.invoke(syncListBackupsRoute.name, {})
    return result.backups
  }

  async function startBackup() {
    const result = await bridge.invoke(syncStartBackupRoute.name, {})
    return result.backup
  }

  async function importFromSync(backupFile: string, mode?: 'increment' | 'overwrite') {
    const result = await bridge.invoke(syncImportRoute.name, {
      backupFile,
      mode
    })
    return result.result
  }

  async function openSyncFolder() {
    await bridge.invoke(syncOpenFolderRoute.name, {})
  }

  async function getCloudConfig() {
    const result = await bridge.invoke(syncGetCloudConfigRoute.name, {})
    return result.config
  }

  async function setCloudConfig(config: CloudSyncConfigInput) {
    const result = await bridge.invoke(syncSetCloudConfigRoute.name, { config })
    return result.config
  }

  async function testCloudConnection() {
    const result = await bridge.invoke(syncTestCloudRoute.name, {})
    return result.result
  }

  async function uploadToCloud() {
    const result = await bridge.invoke(syncUploadToCloudRoute.name, {})
    return result.result
  }

  async function pullFromCloud(mode?: 'increment' | 'overwrite') {
    const result = await bridge.invoke(syncPullFromCloudRoute.name, { mode })
    return result.result
  }

  function onBackupStarted(listener: (payload: { version: number }) => void) {
    return bridge.on(syncBackupStartedEvent.name, listener)
  }

  function onBackupCompleted(listener: (payload: { timestamp: number; version: number }) => void) {
    return bridge.on(syncBackupCompletedEvent.name, listener)
  }

  function onBackupError(listener: (payload: { error?: string; version: number }) => void) {
    return bridge.on(syncBackupErrorEvent.name, listener)
  }

  function onBackupStatusChanged(
    listener: (payload: {
      status: string
      previousStatus?: string
      lastSuccessfulBackupTime?: number
      failed?: boolean
      message?: string
      version: number
    }) => void
  ) {
    return bridge.on(syncBackupStatusChangedEvent.name, listener)
  }

  function onImportStarted(listener: (payload: { version: number }) => void) {
    return bridge.on(syncImportStartedEvent.name, listener)
  }

  function onImportCompleted(listener: (payload: { version: number }) => void) {
    return bridge.on(syncImportCompletedEvent.name, listener)
  }

  function onImportError(listener: (payload: { error?: string; version: number }) => void) {
    return bridge.on(syncImportErrorEvent.name, listener)
  }

  return {
    getBackupStatus,
    listBackups,
    startBackup,
    importFromSync,
    openSyncFolder,
    getCloudConfig,
    setCloudConfig,
    testCloudConnection,
    uploadToCloud,
    pullFromCloud,
    onBackupStarted,
    onBackupCompleted,
    onBackupError,
    onBackupStatusChanged,
    onImportStarted,
    onImportCompleted,
    onImportError
  }
}

export type SyncClient = ReturnType<typeof createSyncClient>
