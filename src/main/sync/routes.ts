import type { CloudSyncResult } from '@shared/types/sync'
import {
  configGetSyncSettingsRoute,
  configUpdateSyncSettingsRoute,
  syncGetBackupStatusRoute,
  syncGetCloudConfigRoute,
  syncImportRoute,
  syncListBackupsRoute,
  syncOpenFolderRoute,
  syncPullFromCloudRoute,
  syncSetCloudConfigRoute,
  syncStartBackupRoute,
  syncTestCloudRoute,
  syncUploadToCloudRoute,
  type SettingsActivityInput
} from '@shared/contracts/routes'
import type { SyncImportResult, SyncService } from '@/sync'
import type { SyncSettings } from './settings'
import { createRouteMap, type DeepchatRouteMap } from '@/routes/routeRegistry'

export function createSyncRoutes(deps: {
  sync: Pick<
    SyncService,
    | 'getBackupStatus'
    | 'listBackups'
    | 'startBackup'
    | 'openSyncFolder'
    | 'testCloudConnection'
    | 'uploadLatestBackupToCloud'
  >
  settings: SyncSettings
  importFromSync(
    backupFileName: string,
    importMode?: 'increment' | 'overwrite'
  ): Promise<SyncImportResult>
  pullLatestBackupFromCloud(importMode?: 'increment' | 'overwrite'): Promise<CloudSyncResult>
  recordActivity(input: SettingsActivityInput): void
}): DeepchatRouteMap {
  return createRouteMap([
    [
      configGetSyncSettingsRoute.name,
      async (rawInput) => {
        configGetSyncSettingsRoute.input.parse(rawInput)
        return configGetSyncSettingsRoute.output.parse({
          enabled: deps.settings.getEnabled(),
          folderPath: deps.settings.getFolderPath()
        })
      }
    ],
    [
      configUpdateSyncSettingsRoute.name,
      async (rawInput) => {
        const input = configUpdateSyncSettingsRoute.input.parse(rawInput)
        if (typeof input.enabled === 'boolean') deps.settings.setEnabled(input.enabled)
        if (typeof input.folderPath === 'string') deps.settings.setFolderPath(input.folderPath)
        return configUpdateSyncSettingsRoute.output.parse({
          enabled: deps.settings.getEnabled(),
          folderPath: deps.settings.getFolderPath()
        })
      }
    ],
    [
      syncGetBackupStatusRoute.name,
      async (rawInput) => {
        syncGetBackupStatusRoute.input.parse(rawInput)
        return syncGetBackupStatusRoute.output.parse({ status: await deps.sync.getBackupStatus() })
      }
    ],
    [
      syncListBackupsRoute.name,
      async (rawInput) => {
        syncListBackupsRoute.input.parse(rawInput)
        return syncListBackupsRoute.output.parse({ backups: await deps.sync.listBackups() })
      }
    ],
    [
      syncStartBackupRoute.name,
      async (rawInput) => {
        syncStartBackupRoute.input.parse(rawInput)
        const backup = await deps.sync.startBackup()
        if (backup) {
          deps.recordActivity({
            category: 'data',
            action: 'backup_created',
            targetType: 'backup',
            targetId: backup.fileName,
            targetLabel: backup.fileName,
            routeName: 'settings-database',
            summaryKey: 'settings.controlCenter.activity.backupCreated',
            summaryParams: { name: backup.fileName }
          })
        }
        return syncStartBackupRoute.output.parse({ backup })
      }
    ],
    [
      syncImportRoute.name,
      async (rawInput) => {
        const input = syncImportRoute.input.parse(rawInput)
        const result = await deps.importFromSync(input.backupFile, input.mode)
        if (result?.success) {
          deps.recordActivity({
            category: 'data',
            action: 'imported',
            targetType: 'backup',
            targetId: input.backupFile,
            targetLabel: input.backupFile,
            routeName: 'settings-database',
            summaryKey: 'settings.controlCenter.activity.backupImported',
            summaryParams: { name: input.backupFile }
          })
        }
        return syncImportRoute.output.parse({ result })
      }
    ],
    [
      syncOpenFolderRoute.name,
      async (rawInput) => {
        syncOpenFolderRoute.input.parse(rawInput)
        await deps.sync.openSyncFolder()
        return syncOpenFolderRoute.output.parse({ opened: true })
      }
    ],
    [
      syncGetCloudConfigRoute.name,
      async (rawInput) => {
        syncGetCloudConfigRoute.input.parse(rawInput)
        return syncGetCloudConfigRoute.output.parse({ config: deps.settings.getCloudConfig() })
      }
    ],
    [
      syncSetCloudConfigRoute.name,
      async (rawInput) => {
        const input = syncSetCloudConfigRoute.input.parse(rawInput)
        return syncSetCloudConfigRoute.output.parse({
          config: deps.settings.setCloudConfig(input.config)
        })
      }
    ],
    [
      syncTestCloudRoute.name,
      async (rawInput) => {
        syncTestCloudRoute.input.parse(rawInput)
        return syncTestCloudRoute.output.parse({ result: await deps.sync.testCloudConnection() })
      }
    ],
    [
      syncUploadToCloudRoute.name,
      async (rawInput) => {
        syncUploadToCloudRoute.input.parse(rawInput)
        const result = await deps.sync.uploadLatestBackupToCloud()
        if (result?.success) {
          deps.recordActivity({
            category: 'data',
            action: 'backup_created',
            targetType: 'backup',
            targetId: result.fileName ?? 'cloud',
            targetLabel: result.fileName ?? 'cloud',
            routeName: 'settings-database',
            summaryKey: 'settings.controlCenter.activity.backupCreated',
            summaryParams: { name: result.fileName ?? '' }
          })
        }
        return syncUploadToCloudRoute.output.parse({ result })
      }
    ],
    [
      syncPullFromCloudRoute.name,
      async (rawInput) => {
        const input = syncPullFromCloudRoute.input.parse(rawInput)
        const result = await deps.pullLatestBackupFromCloud(input.mode)
        if (result?.success) {
          deps.recordActivity({
            category: 'data',
            action: 'imported',
            targetType: 'backup',
            targetId: result.fileName ?? 'cloud',
            targetLabel: result.fileName ?? 'cloud',
            routeName: 'settings-database',
            summaryKey: 'settings.controlCenter.activity.backupImported',
            summaryParams: { name: result.fileName ?? '' }
          })
        }
        return syncPullFromCloudRoute.output.parse({ result })
      }
    ]
  ])
}
