import { usePresenter } from '@/composables/usePresenter'
import { CONFIG_EVENTS, SYNC_EVENTS } from '@/events'
import type { IPresenter, SyncBackupInfo } from '@shared/presenter'

type BackupStatus = Awaited<ReturnType<IPresenter['syncPresenter']['getBackupStatus']>>
type ImportResult = Awaited<ReturnType<IPresenter['syncPresenter']['importFromSync']>>
type SelectDirectoryResult = Awaited<ReturnType<IPresenter['devicePresenter']['selectDirectory']>>

type Unsubscribe = () => void

const noopUnsubscribe: Unsubscribe = () => undefined

export type SyncAdapter = {
  getSyncEnabled: () => Promise<boolean>
  setSyncEnabled: (enabled: boolean) => Promise<void>
  getSyncFolderPath: () => Promise<string>
  setSyncFolderPath: (path: string) => Promise<void>
  getBackupStatus: () => Promise<BackupStatus>
  listBackups: () => Promise<SyncBackupInfo[]>
  startBackup: () => Promise<SyncBackupInfo | null>
  importFromSync: (backupFile: string, mode: 'increment' | 'overwrite') => Promise<ImportResult>
  openSyncFolder: () => Promise<void>
  selectDirectory: () => Promise<SelectDirectoryResult>
  restartApp: () => Promise<void>
  onBackupStarted: (handler: () => void) => Unsubscribe
  onBackupCompleted: (handler: (time?: number) => void) => Unsubscribe
  onBackupError: (handler: () => void) => Unsubscribe
  onImportStarted: (handler: () => void) => Unsubscribe
  onImportCompleted: (handler: () => void) => Unsubscribe
  onImportError: (handler: () => void) => Unsubscribe
  onSyncSettingsChanged: (
    handler: (payload: { enabled?: boolean; folderPath?: string }) => void
  ) => Unsubscribe
}

export function useSyncAdapter(): SyncAdapter {
  const configPresenter = usePresenter('configPresenter')
  const syncPresenter = usePresenter('syncPresenter')
  const devicePresenter = usePresenter('devicePresenter')

  const subscribe = <T>(
    event: string,
    handler: (payload: T) => void,
    transform?: (...args: unknown[]) => T
  ): Unsubscribe => {
    if (!window?.electron?.ipcRenderer) return noopUnsubscribe

    const listener = (...args: unknown[]) => {
      const payload = transform ? transform(...args) : (args[1] as T)
      handler(payload)
    }

    window.electron.ipcRenderer.on(event, listener)

    return () => {
      window.electron.ipcRenderer.removeListener(event, listener)
    }
  }

  return {
    getSyncEnabled: () => Promise.resolve(configPresenter.getSyncEnabled()),
    setSyncEnabled: (enabled: boolean) => Promise.resolve(configPresenter.setSyncEnabled(enabled)),
    getSyncFolderPath: () => Promise.resolve(configPresenter.getSyncFolderPath()),
    setSyncFolderPath: (path: string) => Promise.resolve(configPresenter.setSyncFolderPath(path)),
    getBackupStatus: () => Promise.resolve(syncPresenter.getBackupStatus()),
    listBackups: () => Promise.resolve(syncPresenter.listBackups()),
    startBackup: () => Promise.resolve(syncPresenter.startBackup()),
    importFromSync: (backupFile: string, mode: 'increment' | 'overwrite') =>
      Promise.resolve(syncPresenter.importFromSync(backupFile, mode)),
    openSyncFolder: () => Promise.resolve(syncPresenter.openSyncFolder()),
    selectDirectory: () => Promise.resolve(devicePresenter.selectDirectory()),
    restartApp: () => Promise.resolve(devicePresenter.restartApp()),
    onBackupStarted: (handler) => subscribe(SYNC_EVENTS.BACKUP_STARTED, () => handler()),
    onBackupCompleted: (handler) =>
      subscribe<number | undefined>(SYNC_EVENTS.BACKUP_COMPLETED, (payload) => handler(payload)),
    onBackupError: (handler) => subscribe(SYNC_EVENTS.BACKUP_ERROR, () => handler()),
    onImportStarted: (handler) => subscribe(SYNC_EVENTS.IMPORT_STARTED, () => handler()),
    onImportCompleted: (handler) => subscribe(SYNC_EVENTS.IMPORT_COMPLETED, () => handler()),
    onImportError: (handler) => subscribe(SYNC_EVENTS.IMPORT_ERROR, () => handler()),
    onSyncSettingsChanged: (handler) =>
      subscribe<{ enabled?: boolean; folderPath?: string }>(
        CONFIG_EVENTS.SYNC_SETTINGS_CHANGED,
        (payload) => handler(payload)
      )
  }
}
