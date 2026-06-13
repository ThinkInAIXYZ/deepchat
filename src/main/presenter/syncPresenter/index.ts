import { app, shell } from 'electron'
import path from 'path'
import fs from 'fs'
import Database from 'better-sqlite3-multiple-ciphers'
import { zipSync, unzipSync } from 'fflate'
import {
  ISyncPresenter,
  IConfigPresenter,
  ISQLitePresenter,
  SyncBackupInfo,
  CloudSyncResult
} from '@shared/presenter'
import { CloudStorageService } from './cloudStorageService'
import { eventBus } from '@/eventbus'
import { SYNC_EVENTS } from '@/events'
import { publishDeepchatEvent } from '@/routes/publishDeepchatEvent'
import { DataImporter } from '../sqlitePresenter/importData'
import { ImportMode } from '../sqlitePresenter'
import type { SQLitePresenter } from '../sqlitePresenter'
import {
  CURRENT_SYNC_BACKUP_VERSION,
  CURRENT_SYNC_CONFIG_SCHEMA_VERSION,
  SyncConfigImportService,
  type SyncBackupManifest
} from './configImportService'
import { presenter } from '../index'

interface PromptStore {
  prompts: Array<{ id?: string; [key: string]: unknown }>
}

type BackupStatus = 'idle' | 'preparing' | 'collecting' | 'compressing' | 'finalizing' | 'error'

const BACKUP_PREFIX = 'backup-'
const BACKUP_EXTENSION = '.zip'
const BACKUP_FILE_NAME_REGEX = /^backup-\d+\.zip$/
const MIGRATED_APP_SETTINGS_KEYS = new Set([
  'providers',
  'providerOrder',
  'providerTimestamps',
  'remoteControl',
  'mcprouterApiKey',
  'nowledgeMemConfig',
  'hooksNotifications',
  'knowledgeConfigs',
  'customPrompts',
  'systemPrompts'
])
// Cloud sync credentials are machine-local (secret encrypted via safeStorage). They must never
// travel inside a backup: the secret can't be decrypted on another machine, and importing a
// foreign machine's cloud config would clobber the local one. Stripped on backup, preserved on import.
const CLOUD_SYNC_APP_SETTINGS_KEYS = ['cloudSyncConfig', 'cloudSyncSecret'] as const
const KNOWN_IMPORT_ERRORS = new Set([
  'sync.error.noValidBackup',
  'sync.error.unsupportedBackupVersion',
  'sync.error.encryptedBackupPasswordMissing',
  'sync.error.overwriteEncryptionMismatch'
])

const ZIP_PATHS = {
  agentDb: 'database/agent.db',
  chatDb: 'database/chat.db',
  appSettings: 'configs/app-settings.json',
  customPrompts: 'configs/custom_prompts.json',
  systemPrompts: 'configs/system_prompts.json',
  mcpSettings: 'configs/mcp-settings.json',
  manifest: 'manifest.json'
}

type BackupDbSource = {
  type: 'agent' | 'chat'
  path: string
}

export class SyncPresenter implements ISyncPresenter {
  private configPresenter: IConfigPresenter
  private sqlitePresenter: ISQLitePresenter
  private isBackingUp = false
  private currentBackupStatus: BackupStatus = 'idle'
  private backupTimer: NodeJS.Timeout | null = null
  private readonly BACKUP_DELAY = 60 * 1000
  private readonly APP_SETTINGS_PATH = path.join(app.getPath('userData'), 'app-settings.json')
  private readonly CUSTOM_PROMPTS_PATH = path.join(app.getPath('userData'), 'custom_prompts.json')
  private readonly SYSTEM_PROMPTS_PATH = path.join(app.getPath('userData'), 'system_prompts.json')
  private readonly MCP_SETTINGS_PATH = path.join(app.getPath('userData'), 'mcp-settings.json')
  private readonly DB_PATH = path.join(app.getPath('userData'), 'app_db', 'agent.db')

  constructor(configPresenter: IConfigPresenter, sqlitePresenter: ISQLitePresenter) {
    this.configPresenter = configPresenter
    this.sqlitePresenter = sqlitePresenter
    this.init()
  }

  public init(): void {
    this.listenForChanges()
  }

  public destroy(): void {
    if (this.backupTimer) {
      clearTimeout(this.backupTimer)
      this.backupTimer = null
    }
  }

  public async checkSyncFolder(): Promise<{ exists: boolean; path: string }> {
    const syncFolderPath = this.configPresenter.getSyncFolderPath()
    const exists = fs.existsSync(syncFolderPath)
    return { exists, path: syncFolderPath }
  }

  public async openSyncFolder(): Promise<void> {
    const { exists, path: syncFolderPath } = await this.checkSyncFolder()
    if (!exists) {
      fs.mkdirSync(syncFolderPath, { recursive: true })
    }
    shell.openPath(syncFolderPath)
  }

  public async getBackupStatus(): Promise<{ isBackingUp: boolean; lastBackupTime: number }> {
    const lastBackupTime = this.configPresenter.getLastSyncTime()
    return { isBackingUp: this.isBackingUp, lastBackupTime }
  }

  // === Cloud sync (S3-compatible) ===

  private buildCloudService(): CloudStorageService {
    const resolved = this.configPresenter.getResolvedCloudSyncConfig()
    if (!resolved) {
      throw new Error('sync.error.cloudNotConfigured')
    }
    return new CloudStorageService(resolved)
  }

  /**
   * S3-compatible auth/permission failures surface as opaque Rust error strings from
   * OpenDAL (the napi binding does not expose a structured error code), so we fall back
   * to substring matching. Keep the list focused on credential/permission signals that
   * map cleanly to a single user-facing key.
   */
  private static readonly CLOUD_UNAUTHORIZED_SIGNALS = [
    'unauthorized',
    'accessdenied',
    'forbidden',
    'invalidaccesskeyid',
    'signaturedoesnotmatch',
    'status: 401',
    'status code: 401',
    'status: 403',
    'status code: 403'
  ]

  private normalizeCloudError(error: unknown): string {
    const message = error instanceof Error ? error.message : String(error)
    if (message.startsWith('sync.error.')) {
      return message
    }
    const normalizedMessage = message.toLowerCase()
    if (
      SyncPresenter.CLOUD_UNAUTHORIZED_SIGNALS.some((signal) => normalizedMessage.includes(signal))
    ) {
      return 'sync.error.cloudUnauthorized'
    }
    return message || 'sync.error.cloudOperationFailed'
  }

  public async testCloudConnection(): Promise<CloudSyncResult> {
    try {
      const service = this.buildCloudService()
      await service.testConnection()
      return { success: true, message: 'sync.success.cloudConnected' }
    } catch (error) {
      console.error('Cloud connection test failed:', error)
      return { success: false, message: this.normalizeCloudError(error) }
    }
  }

  public async uploadLatestBackupToCloud(): Promise<CloudSyncResult> {
    try {
      const service = this.buildCloudService()
      const backups = (await this.listBackups()).filter(({ fileName }) =>
        BACKUP_FILE_NAME_REGEX.test(fileName)
      )
      if (backups.length === 0) {
        return { success: false, message: 'sync.error.noLocalBackup' }
      }
      const { path: syncFolderPath } = await this.checkSyncFolder()
      const backupsDir = this.getBackupsDirectory(syncFolderPath)

      for (const backup of backups) {
        const localPath = path.join(backupsDir, backup.fileName)
        if (!fs.existsSync(localPath)) {
          continue
        }
        try {
          this.validateBackupArchive(localPath)
        } catch (error) {
          console.warn('Skipping invalid local backup during cloud upload:', backup.fileName, error)
          continue
        }
        await service.uploadBackup(localPath, backup.fileName)
        return { success: true, message: 'sync.success.cloudUploaded', fileName: backup.fileName }
      }

      return { success: false, message: 'sync.error.noLocalBackup' }
    } catch (error) {
      console.error('Cloud upload failed:', error)
      return { success: false, message: this.normalizeCloudError(error) }
    }
  }

  public async pullLatestBackupFromCloud(
    importMode: ImportMode = ImportMode.INCREMENT
  ): Promise<CloudSyncResult> {
    try {
      const service = this.buildCloudService()
      const { path: syncFolderPath } = await this.checkSyncFolder()
      const backupsDir = this.getBackupsDirectory(syncFolderPath)
      const fileName = await service.downloadLatest(backupsDir)
      if (!fileName) {
        return { success: false, message: 'sync.error.cloudNoBackup' }
      }
      const result = await this.importFromSync(fileName, importMode)
      return { ...result, fileName }
    } catch (error) {
      console.error('Cloud pull failed:', error)
      return { success: false, message: this.normalizeCloudError(error) }
    }
  }

  public async listBackups(): Promise<SyncBackupInfo[]> {
    const { path: syncFolderPath } = await this.checkSyncFolder()
    const backupsDir = this.getBackupsDirectory(syncFolderPath)
    if (!fs.existsSync(backupsDir)) {
      return []
    }

    const entries = fs
      .readdirSync(backupsDir)
      .filter((file) => file.endsWith(BACKUP_EXTENSION))
      .map((fileName) => {
        const match = fileName.match(/backup-(\d+)\.zip$/)
        const createdAt = match
          ? Number(match[1])
          : fs.statSync(path.join(backupsDir, fileName)).mtimeMs
        const stats = fs.statSync(path.join(backupsDir, fileName))
        return { fileName, createdAt, size: stats.size }
      })
      .sort((a, b) => b.createdAt - a.createdAt)

    return entries
  }

  public async startBackup(): Promise<SyncBackupInfo | null> {
    if (this.isBackingUp) {
      return null
    }

    if (!this.configPresenter.getSyncEnabled()) {
      throw new Error('sync.error.notEnabled')
    }

    try {
      return await this.performBackup()
    } catch (error) {
      console.error('Backup failed:', error)
      publishDeepchatEvent('sync.backup.error', {
        error: (error as Error).message || 'sync.error.unknown',
        version: Date.now()
      })
      throw error
    }
  }

  public async cancelBackup(): Promise<void> {
    if (this.backupTimer) {
      clearTimeout(this.backupTimer)
      this.backupTimer = null
    }
    this.isBackingUp = false
  }

  public async importFromSync(
    backupFileName: string,
    importMode: ImportMode = ImportMode.INCREMENT
  ): Promise<{
    success: boolean
    message: string
    count?: number
    sourceDbType?: 'agent' | 'chat'
    importedSessions?: number
  }> {
    if (this.backupTimer) {
      clearTimeout(this.backupTimer)
      this.backupTimer = null
    }

    const { exists, path: syncFolderPath } = await this.checkSyncFolder()
    if (!exists) {
      return { success: false, message: 'sync.error.folderNotExists' }
    }

    const backupsDir = this.getBackupsDirectory(syncFolderPath)
    let backupZipPath: string
    try {
      const safeFileName = this.ensureSafeBackupFileName(backupFileName)
      backupZipPath = path.join(backupsDir, safeFileName)
    } catch (error) {
      console.warn('Failed to validate backup file name', error)
      return { success: false, message: 'sync.error.noValidBackup' }
    }
    if (!fs.existsSync(backupZipPath)) {
      return { success: false, message: 'sync.error.noValidBackup' }
    }

    publishDeepchatEvent('sync.import.started', {
      version: Date.now()
    })

    const extractionDir = path.join(app.getPath('temp'), `deepchat-backup-${Date.now()}`)
    fs.mkdirSync(extractionDir, { recursive: true })

    const tempCurrentFiles: Record<string, string | null> = {
      db: null,
      appSettings: null,
      customPrompts: null,
      systemPrompts: null,
      mcpSettings: null
    }

    let sqliteClosed = false
    let sqliteReopenedForLegacyImport = false

    try {
      this.extractBackupArchive(backupZipPath, extractionDir)
      const configImportService = this.createConfigImportService()
      const manifest = configImportService.readManifest(extractionDir)
      const backupVersion = this.resolveBackupVersion(manifest)
      const usesSqliteConfigStorage = backupVersion >= 2 && manifest?.configStorage === 'sqlite'
      const activeDatabasePassword = this.getActiveDatabasePassword()
      const backupDatabasePassword = this.resolveBackupDatabasePassword(
        manifest,
        activeDatabasePassword
      )

      const backupDbSource = this.resolveBackupDbSource(extractionDir)
      const backupAppSettingsPath = path.join(extractionDir, ZIP_PATHS.appSettings)
      const backupCustomPromptsPath = path.join(extractionDir, ZIP_PATHS.customPrompts)
      const backupSystemPromptsPath = path.join(extractionDir, ZIP_PATHS.systemPrompts)

      if (!backupDbSource || !fs.existsSync(backupAppSettingsPath)) {
        throw new Error('sync.error.noValidBackup')
      }
      if (usesSqliteConfigStorage && backupDbSource.type !== 'agent') {
        throw new Error('sync.error.noValidBackup')
      }
      this.assertOverwriteEncryptionCompatible(
        backupDbSource.type,
        importMode,
        manifest,
        activeDatabasePassword
      )

      this.sqlitePresenter.close()
      sqliteClosed = true

      tempCurrentFiles.db = this.createTempBackup(this.DB_PATH, 'agent.db')
      tempCurrentFiles.appSettings = this.createTempBackup(
        this.APP_SETTINGS_PATH,
        'app-settings.json'
      )
      tempCurrentFiles.customPrompts = this.createTempBackup(
        this.CUSTOM_PROMPTS_PATH,
        'custom_prompts.json'
      )
      tempCurrentFiles.systemPrompts = this.createTempBackup(
        this.SYSTEM_PROMPTS_PATH,
        'system_prompts.json'
      )
      tempCurrentFiles.mcpSettings = this.createTempBackup(
        this.MCP_SETTINGS_PATH,
        'mcp-settings.json'
      )

      if (backupDbSource.type === 'chat') {
        this.sqlitePresenter.reopen()
        this.reattachConfigPresenterStorage()
        sqliteClosed = false
        sqliteReopenedForLegacyImport = true
      }

      let importedConversationCount = 0

      if (backupDbSource.type === 'agent') {
        if (importMode === ImportMode.OVERWRITE) {
          const backupDb = this.openBackupDatabase(backupDbSource.path, backupDatabasePassword)
          importedConversationCount =
            this.countTableRows(backupDb, 'new_sessions') ||
            this.countTableRows(backupDb, 'conversations')
          backupDb.close()

          this.copyFile(backupDbSource.path, this.DB_PATH)
          this.cleanupDatabaseSidecarFiles(this.DB_PATH)
          if (usesSqliteConfigStorage) {
            configImportService.ensureConfigMigrationMarker()
          } else {
            configImportService.importLegacyConfig(extractionDir, 'overwrite')
          }
          this.mergeAppSettingsPreservingSync(backupAppSettingsPath, this.APP_SETTINGS_PATH)

          if (fs.existsSync(backupCustomPromptsPath)) {
            this.copyFile(backupCustomPromptsPath, this.CUSTOM_PROMPTS_PATH)
          }

          if (fs.existsSync(backupSystemPromptsPath)) {
            this.copyFile(backupSystemPromptsPath, this.SYSTEM_PROMPTS_PATH)
          }
        } else {
          const importer = new DataImporter(
            backupDbSource.path,
            this.DB_PATH,
            backupDatabasePassword,
            activeDatabasePassword
          )
          const summary = await importer.importData()
          importer.close()
          importedConversationCount =
            summary.tableCounts.new_sessions || summary.tableCounts.conversations || 0

          if (usesSqliteConfigStorage) {
            configImportService.ensureConfigMigrationMarker()
          } else {
            configImportService.importLegacyConfig(extractionDir, 'increment')
          }
          this.mergeAppSettingsPreservingSync(backupAppSettingsPath, this.APP_SETTINGS_PATH)
          if (fs.existsSync(backupCustomPromptsPath)) {
            this.mergePromptStore(backupCustomPromptsPath, this.CUSTOM_PROMPTS_PATH)
          }
          if (fs.existsSync(backupSystemPromptsPath)) {
            this.mergePromptStore(backupSystemPromptsPath, this.SYSTEM_PROMPTS_PATH)
          }
        }
      } else {
        const summary = await this.sqlitePresenter.importLegacyChatDb(
          backupDbSource.path,
          importMode === ImportMode.OVERWRITE ? 'overwrite' : 'increment'
        )
        importedConversationCount = summary.importedSessions

        this.sqlitePresenter.close()
        sqliteClosed = true
        sqliteReopenedForLegacyImport = false
        configImportService.importLegacyConfig(
          extractionDir,
          importMode === ImportMode.OVERWRITE ? 'overwrite' : 'increment'
        )
        this.mergeAppSettingsPreservingSync(backupAppSettingsPath, this.APP_SETTINGS_PATH)
        if (fs.existsSync(backupCustomPromptsPath)) {
          this.mergePromptStore(backupCustomPromptsPath, this.CUSTOM_PROMPTS_PATH)
        }
        if (fs.existsSync(backupSystemPromptsPath)) {
          this.mergePromptStore(backupSystemPromptsPath, this.SYSTEM_PROMPTS_PATH)
        }
      }

      if (sqliteClosed) {
        this.sqlitePresenter.reopen()
        this.reattachConfigPresenterStorage()
      }
      await this.broadcastThreadListUpdateAfterImport()
      if (importMode === ImportMode.OVERWRITE) {
        await this.resetShellWindowsToSingleNewChatTab()
      }
      publishDeepchatEvent('sync.import.completed', {
        version: Date.now()
      })
      return {
        success: true,
        message: 'sync.success.importComplete',
        count: importedConversationCount,
        sourceDbType: backupDbSource.type,
        importedSessions: importedConversationCount
      }
    } catch (error) {
      console.error('import failed,reverting:', error)
      const errorMessage = (error as Error).message || 'sync.error.unknown'
      if (sqliteReopenedForLegacyImport && !sqliteClosed) {
        try {
          this.sqlitePresenter.close()
          sqliteClosed = true
        } catch (closeError) {
          console.error('Failed to close sqlite before restore after import failure:', closeError)
        }
      }
      this.restoreFromTempBackup(tempCurrentFiles)
      if (sqliteClosed) {
        try {
          this.sqlitePresenter.reopen()
          this.reattachConfigPresenterStorage()
          await this.broadcastThreadListUpdateAfterImport()
        } catch (reopenError) {
          console.error('Failed to reopen sqlite after import failure:', reopenError)
        }
      }
      publishDeepchatEvent('sync.import.error', {
        error: errorMessage,
        version: Date.now()
      })
      return {
        success: false,
        message: KNOWN_IMPORT_ERRORS.has(errorMessage) ? errorMessage : 'sync.error.importFailed'
      }
    } finally {
      this.cleanupTempFiles(Object.values(tempCurrentFiles))
      this.removeDirectory(extractionDir)
    }
  }

  private async performBackup(): Promise<SyncBackupInfo> {
    this.isBackingUp = true
    this.emitBackupStatus('preparing')
    publishDeepchatEvent('sync.backup.started', {
      version: Date.now()
    })

    const syncFolderPath = this.configPresenter.getSyncFolderPath()
    if (!fs.existsSync(syncFolderPath)) {
      fs.mkdirSync(syncFolderPath, { recursive: true })
    }
    const backupsDir = this.getBackupsDirectory(syncFolderPath)
    fs.mkdirSync(backupsDir, { recursive: true })

    const timestamp = Date.now()
    const backupFileName = `${BACKUP_PREFIX}${timestamp}${BACKUP_EXTENSION}`
    const tempZipPath = path.join(backupsDir, `${backupFileName}.tmp`)
    const finalZipPath = path.join(backupsDir, backupFileName)

    let completedTimestamp: number | null = null
    let encounteredError = false

    try {
      if (!fs.existsSync(this.DB_PATH)) {
        throw new Error('sync.error.dbNotExists')
      }

      if (!fs.existsSync(this.APP_SETTINGS_PATH)) {
        throw new Error('sync.error.configNotExists')
      }

      this.emitBackupStatus('collecting')
      this.ensureSqliteConfigStorageReady()
      this.checkpointDatabaseForBackup()
      const files: Record<string, Uint8Array> = {}
      files[ZIP_PATHS.agentDb] = new Uint8Array(fs.readFileSync(this.DB_PATH))
      files[ZIP_PATHS.appSettings] = this.readSanitizedAppSettingsBackup()
      this.addOptionalFile(files, ZIP_PATHS.customPrompts, this.CUSTOM_PROMPTS_PATH)
      this.addOptionalFile(files, ZIP_PATHS.systemPrompts, this.SYSTEM_PROMPTS_PATH)

      const manifest = {
        version: CURRENT_SYNC_BACKUP_VERSION,
        createdAt: timestamp,
        configStorage: 'sqlite',
        configSchemaVersion: CURRENT_SYNC_CONFIG_SCHEMA_VERSION,
        databaseEncrypted: Boolean(this.getActiveDatabasePassword()),
        databaseCipher: this.getActiveDatabasePassword() ? 'sqlcipher' : undefined,
        files: Object.keys(files)
      }
      files[ZIP_PATHS.manifest] = new Uint8Array(
        Buffer.from(JSON.stringify(manifest, null, 2), 'utf-8')
      )

      this.emitBackupStatus('compressing')
      const zipData = zipSync(files, { level: 6 })
      fs.writeFileSync(tempZipPath, Buffer.from(zipData))

      if (fs.existsSync(finalZipPath)) {
        fs.unlinkSync(finalZipPath)
      }
      this.emitBackupStatus('finalizing')
      fs.renameSync(tempZipPath, finalZipPath)

      const backupStats = fs.statSync(finalZipPath)
      this.configPresenter.setLastSyncTime(timestamp)
      publishDeepchatEvent('sync.backup.completed', {
        timestamp,
        version: Date.now()
      })
      completedTimestamp = timestamp

      return { fileName: backupFileName, createdAt: timestamp, size: backupStats.size }
    } catch (error) {
      if (fs.existsSync(tempZipPath)) {
        fs.unlinkSync(tempZipPath)
      }
      encounteredError = true
      this.emitBackupStatus('error', {
        message: (error as Error)?.message || 'sync.error.unknown'
      })
      throw error
    } finally {
      this.isBackingUp = false
      const extra: Record<string, unknown> = {}
      if (completedTimestamp) {
        extra.lastSuccessfulBackupTime = completedTimestamp
      }
      if (encounteredError) {
        extra.failed = true
      }
      this.emitBackupStatus('idle', extra)
    }
  }

  private listenForChanges(): void {
    const scheduleBackup = () => {
      if (!this.configPresenter.getSyncEnabled()) {
        return
      }
      if (this.backupTimer) {
        clearTimeout(this.backupTimer)
      }
      this.backupTimer = setTimeout(async () => {
        if (!this.isBackingUp) {
          try {
            await this.performBackup()
          } catch (error) {
            console.error('auto backup failed:', error)
          }
        }
      }, this.BACKUP_DELAY)
    }

    eventBus.on(SYNC_EVENTS.DATA_CHANGED, scheduleBackup)
  }

  private getBackupsDirectory(syncFolderPath: string): string {
    return syncFolderPath
  }

  private emitBackupStatus(status: BackupStatus, extra: Record<string, unknown> = {}): void {
    publishDeepchatEvent('sync.backup.status.changed', {
      status,
      previousStatus: this.currentBackupStatus,
      lastSuccessfulBackupTime:
        typeof extra.lastSuccessfulBackupTime === 'number'
          ? extra.lastSuccessfulBackupTime
          : undefined,
      failed: typeof extra.failed === 'boolean' ? extra.failed : undefined,
      message: typeof extra.message === 'string' ? extra.message : undefined,
      version: Date.now()
    })
    this.currentBackupStatus = status
  }

  private reattachConfigPresenterStorage(): void {
    ;(
      this.configPresenter as IConfigPresenter & {
        setSQLitePresenter?: (sqlitePresenter: SQLitePresenter) => void
      }
    ).setSQLitePresenter?.(this.sqlitePresenter as unknown as SQLitePresenter)
  }

  private createConfigImportService(): SyncConfigImportService {
    const sqlitePresenter = this.sqlitePresenter as unknown as SQLitePresenter
    return new SyncConfigImportService(this.DB_PATH, (dbPath) =>
      sqlitePresenter.openDatabaseConnection(dbPath)
    )
  }

  private openBackupDatabase(dbPath: string, password: string | undefined): Database.Database {
    const db = new Database(dbPath, { readonly: true })
    if (password) {
      db.pragma("cipher='sqlcipher'")
      db.key(Buffer.from(password, 'utf8'))
    }
    return db
  }

  private getActiveDatabasePassword(): string | undefined {
    return (this.sqlitePresenter as unknown as Partial<SQLitePresenter>).getDatabasePassword?.()
  }

  private resolveBackupDatabasePassword(
    manifest: SyncBackupManifest | null,
    activeDatabasePassword: string | undefined
  ): string | undefined {
    if (!manifest?.databaseEncrypted) {
      return undefined
    }
    if (!activeDatabasePassword) {
      throw new Error('sync.error.encryptedBackupPasswordMissing')
    }
    return activeDatabasePassword
  }

  private assertOverwriteEncryptionCompatible(
    backupDbType: BackupDbSource['type'],
    importMode: ImportMode,
    manifest: SyncBackupManifest | null,
    activeDatabasePassword: string | undefined
  ): void {
    if (backupDbType !== 'agent' || importMode !== ImportMode.OVERWRITE) {
      return
    }

    const backupDatabaseEncrypted = manifest?.databaseEncrypted === true
    const activeDatabaseEncrypted = Boolean(activeDatabasePassword)
    if (backupDatabaseEncrypted !== activeDatabaseEncrypted) {
      throw new Error('sync.error.overwriteEncryptionMismatch')
    }
  }

  private ensureSqliteConfigStorageReady(): void {
    const getConfigTables = () =>
      (this.sqlitePresenter as unknown as Partial<SQLitePresenter>).configTables
    let configTables = getConfigTables()
    if (configTables?.hasConfigMigration?.()) {
      return
    }

    this.reattachConfigPresenterStorage()
    configTables = getConfigTables()
    if (!configTables?.hasConfigMigration?.()) {
      throw new Error('sync.error.configNotExists')
    }
  }

  private checkpointDatabaseForBackup(): void {
    const db = this.sqlitePresenter.getDatabase?.()
    if (db?.open) {
      db.pragma('wal_checkpoint(TRUNCATE)')
    }
  }

  private resolveBackupVersion(manifest: SyncBackupManifest | null): number {
    if (!manifest || manifest.version === 1) {
      return 1
    }
    if (manifest.version > CURRENT_SYNC_BACKUP_VERSION) {
      throw new Error('sync.error.unsupportedBackupVersion')
    }
    if (manifest.version === CURRENT_SYNC_BACKUP_VERSION) {
      if (manifest.configStorage !== 'sqlite' || typeof manifest.configSchemaVersion !== 'number') {
        throw new Error('sync.error.noValidBackup')
      }
      if (manifest.configSchemaVersion > CURRENT_SYNC_CONFIG_SCHEMA_VERSION) {
        throw new Error('sync.error.unsupportedBackupVersion')
      }
      return manifest.version
    }
    throw new Error('sync.error.noValidBackup')
  }

  private ensureSafeBackupFileName(fileName: string): string {
    const normalized = fileName.replace(/\\/g, '/').trim()
    if (!normalized) {
      throw new Error('sync.error.noValidBackup')
    }

    const baseName = path.posix.basename(normalized)
    if (baseName !== normalized) {
      throw new Error('sync.error.noValidBackup')
    }

    if (!BACKUP_FILE_NAME_REGEX.test(baseName)) {
      throw new Error('sync.error.noValidBackup')
    }

    return baseName
  }

  private addOptionalFile(
    files: Record<string, Uint8Array>,
    zipPath: string,
    filePath: string
  ): void {
    if (fs.existsSync(filePath)) {
      files[zipPath] = new Uint8Array(fs.readFileSync(filePath))
    }
  }

  private readSanitizedAppSettingsBackup(): Uint8Array {
    const raw = fs.readFileSync(this.APP_SETTINGS_PATH, 'utf-8')
    const parsed = JSON.parse(raw) as Record<string, unknown>
    const sanitized = this.removeMigratedAppSettings(parsed)
    return new Uint8Array(Buffer.from(JSON.stringify(sanitized, null, 2), 'utf-8'))
  }

  private removeMigratedAppSettings(settings: Record<string, unknown>): Record<string, unknown> {
    const providerModelKeys = this.getLegacyProviderModelKeys(settings)
    return Object.fromEntries(
      Object.entries(settings).filter(([key]) => {
        if (MIGRATED_APP_SETTINGS_KEYS.has(key)) {
          return false
        }
        if ((CLOUD_SYNC_APP_SETTINGS_KEYS as readonly string[]).includes(key)) {
          return false
        }
        if (key.startsWith('model_status_') || key.startsWith('custom_models_')) {
          return false
        }
        return !providerModelKeys.has(key)
      })
    )
  }

  private getLegacyProviderModelKeys(settings: Record<string, unknown>): Set<string> {
    const providerIds = new Set<string>()

    if (Array.isArray(settings.providers)) {
      for (const provider of settings.providers) {
        if (
          provider &&
          typeof provider === 'object' &&
          !Array.isArray(provider) &&
          typeof (provider as { id?: unknown }).id === 'string'
        ) {
          providerIds.add((provider as { id: string }).id)
        }
      }
    }

    if (Array.isArray(settings.providerOrder)) {
      for (const providerId of settings.providerOrder) {
        if (typeof providerId === 'string') {
          providerIds.add(providerId)
        }
      }
    }

    try {
      const configTables = (this.sqlitePresenter as unknown as Partial<SQLitePresenter>)
        .configTables
      if (configTables) {
        for (const provider of configTables.listProviders()) {
          providerIds.add(provider.id)
        }
      }
    } catch {
      // During import the main SQLite connection can be closed; settings still carry legacy IDs.
    }

    return new Set(Array.from(providerIds, (providerId) => `${providerId}_models`))
  }

  private resolveBackupDbSource(extractionDir: string): BackupDbSource | null {
    const agentDbPath = path.join(extractionDir, ZIP_PATHS.agentDb)
    if (fs.existsSync(agentDbPath)) {
      return {
        type: 'agent',
        path: agentDbPath
      }
    }

    const chatDbPath = path.join(extractionDir, ZIP_PATHS.chatDb)
    if (fs.existsSync(chatDbPath)) {
      return {
        type: 'chat',
        path: chatDbPath
      }
    }

    return null
  }

  private extractBackupArchive(zipPath: string, targetDir: string): void {
    const zipContent = new Uint8Array(fs.readFileSync(zipPath))
    const extracted = unzipSync(zipContent)
    const resolvedTargetDir = path.resolve(targetDir)

    for (const entryName of Object.keys(extracted)) {
      const fileContent = extracted[entryName]
      if (!fileContent) {
        continue
      }

      const normalizedEntry = entryName.replace(/\\/g, '/')
      if (!normalizedEntry) {
        continue
      }

      if (/^[A-Za-z]:/.test(normalizedEntry) || normalizedEntry.startsWith('/')) {
        throw new Error('sync.error.noValidBackup')
      }

      const segments = normalizedEntry.split('/')
      const safeSegments: string[] = []
      for (const segment of segments) {
        if (!segment || segment === '.') {
          continue
        }
        if (segment === '..') {
          throw new Error('sync.error.noValidBackup')
        }
        safeSegments.push(segment)
      }

      if (safeSegments.length === 0) {
        continue
      }

      const isDirectoryEntry = normalizedEntry.endsWith('/')
      const destination = path.resolve(resolvedTargetDir, ...safeSegments)
      const relativeToTarget = path.relative(resolvedTargetDir, destination)
      if (relativeToTarget.startsWith('..') || path.isAbsolute(relativeToTarget)) {
        throw new Error('sync.error.noValidBackup')
      }

      if (isDirectoryEntry) {
        fs.mkdirSync(destination, { recursive: true })
        continue
      }

      fs.mkdirSync(path.dirname(destination), { recursive: true })
      fs.writeFileSync(destination, Buffer.from(fileContent))
    }
  }

  private validateBackupArchive(backupZipPath: string): void {
    const extractionDir = path.join(app.getPath('temp'), `deepchat-backup-validate-${Date.now()}`)
    fs.mkdirSync(extractionDir, { recursive: true })

    try {
      this.extractBackupArchive(backupZipPath, extractionDir)
      const configImportService = this.createConfigImportService()
      const manifest = configImportService.readManifest(extractionDir)
      const backupVersion = this.resolveBackupVersion(manifest)
      const usesSqliteConfigStorage = backupVersion >= 2 && manifest?.configStorage === 'sqlite'
      const backupDbSource = this.resolveBackupDbSource(extractionDir)
      const backupAppSettingsPath = path.join(extractionDir, ZIP_PATHS.appSettings)

      if (!backupDbSource || !fs.existsSync(backupAppSettingsPath)) {
        throw new Error('sync.error.noValidBackup')
      }
      if (usesSqliteConfigStorage && backupDbSource.type !== 'agent') {
        throw new Error('sync.error.noValidBackup')
      }
    } finally {
      this.removeDirectory(extractionDir)
    }
  }

  private readSettingsFile(filePath: string): Record<string, unknown> | null {
    if (!fs.existsSync(filePath)) {
      return null
    }
    try {
      const parsed = JSON.parse(fs.readFileSync(filePath, 'utf-8'))
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
        throw new Error('sync.error.importFailed')
      }
      return parsed as Record<string, unknown>
    } catch (error) {
      console.error('Failed to read settings file for cloud config preservation:', error)
      throw new Error('sync.error.importFailed')
    }
  }

  private mergeAppSettingsPreservingSync(backupPath: string, targetPath: string): void {
    if (!fs.existsSync(backupPath)) {
      return
    }

    let backupSettingsRaw: string
    try {
      backupSettingsRaw = fs.readFileSync(backupPath, 'utf-8')
    } catch (error) {
      console.error('Failed to read backup app settings file:', error)
      throw new Error('sync.error.noValidBackup')
    }

    let backupSettings: Record<string, unknown>
    try {
      const parsed = JSON.parse(backupSettingsRaw)
      if (!parsed || typeof parsed !== 'object') {
        throw new Error('sync.error.noValidBackup')
      }
      backupSettings = parsed as Record<string, unknown>
    } catch (error) {
      console.error('Failed to parse backup app settings JSON:', error)
      throw new Error('sync.error.noValidBackup')
    }

    const preservedSettings: Record<string, unknown> = {}
    preservedSettings.syncEnabled = this.configPresenter.getSyncEnabled()
    preservedSettings.syncFolderPath = this.configPresenter.getSyncFolderPath()
    preservedSettings.lastSyncTime = this.configPresenter.getLastSyncTime()

    // Keep the local machine's cloud credentials — a backup never carries them (see
    // CLOUD_SYNC_APP_SETTINGS_KEYS), so read them back from the current target file before overwrite.
    const localSettings = this.readSettingsFile(targetPath)
    for (const key of CLOUD_SYNC_APP_SETTINGS_KEYS) {
      if (localSettings && key in localSettings) {
        preservedSettings[key] = localSettings[key]
      }
    }

    const sanitizedBackupSettings = this.removeMigratedAppSettings(backupSettings)
    const mergedSettings = {
      ...sanitizedBackupSettings,
      ...Object.fromEntries(
        Object.entries(preservedSettings).filter(
          ([, value]) => value !== undefined && value !== null
        )
      )
    }

    fs.mkdirSync(path.dirname(targetPath), { recursive: true })
    fs.writeFileSync(targetPath, JSON.stringify(mergedSettings, null, 2), 'utf-8')
  }

  private createTempBackup(originalPath: string, name: string): string | null {
    if (!fs.existsSync(originalPath)) {
      return null
    }
    const tempPath = path.join(app.getPath('temp'), `${name}.${Date.now()}.bak`)
    this.copyFile(originalPath, tempPath)
    return tempPath
  }

  private copyFile(source: string, target: string): void {
    fs.mkdirSync(path.dirname(target), { recursive: true })
    fs.copyFileSync(source, target)
  }

  private async broadcastThreadListUpdateAfterImport(): Promise<void> {
    try {
      await presenter?.broadcastConversationThreadListUpdate?.()
    } catch (error) {
      console.warn('Failed to broadcast thread list update after import:', error)
    }
  }

  private async resetShellWindowsToSingleNewChatTab(): Promise<void> {
    // Shell windows no longer manage chat tabs; nothing to reset
  }

  private cleanupDatabaseSidecarFiles(dbFilePath: string): void {
    const sidecarFiles = [`${dbFilePath}-wal`, `${dbFilePath}-shm`]
    for (const filePath of sidecarFiles) {
      if (!fs.existsSync(filePath)) {
        continue
      }
      try {
        fs.unlinkSync(filePath)
      } catch (error) {
        console.warn('Failed to remove database sidecar file:', filePath, error)
      }
    }
  }

  private restoreFromTempBackup(tempFiles: Record<string, string | null>): void {
    if (tempFiles.db) {
      this.copyFile(tempFiles.db, this.DB_PATH)
    }
    if (tempFiles.appSettings) {
      this.copyFile(tempFiles.appSettings, this.APP_SETTINGS_PATH)
    }
    if (tempFiles.customPrompts) {
      this.copyFile(tempFiles.customPrompts, this.CUSTOM_PROMPTS_PATH)
    }
    if (tempFiles.systemPrompts) {
      this.copyFile(tempFiles.systemPrompts, this.SYSTEM_PROMPTS_PATH)
    }
    if (tempFiles.mcpSettings) {
      this.copyFile(tempFiles.mcpSettings, this.MCP_SETTINGS_PATH)
    }
  }

  private cleanupTempFiles(paths: Array<string | null>): void {
    for (const filePath of paths) {
      if (filePath && fs.existsSync(filePath)) {
        try {
          fs.unlinkSync(filePath)
        } catch (error) {
          console.warn('Failed to remove temp file:', filePath, error)
        }
      }
    }
  }

  private removeDirectory(dirPath: string): void {
    if (!fs.existsSync(dirPath)) {
      return
    }
    const entries = fs.readdirSync(dirPath, { withFileTypes: true })
    for (const entry of entries) {
      const entryPath = path.join(dirPath, entry.name)
      if (entry.isDirectory()) {
        this.removeDirectory(entryPath)
      } else {
        fs.unlinkSync(entryPath)
      }
    }
    fs.rmdirSync(dirPath)
  }

  private countTableRows(db: Database.Database, tableName: string): number {
    const exists = db
      .prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?")
      .get(tableName)
    if (!exists) {
      return 0
    }
    const row = db.prepare(`SELECT COUNT(*) as count FROM "${tableName}"`).get() as {
      count: number
    }
    return row.count || 0
  }

  private mergePromptStore(backupPath: string, targetPath: string): number {
    const backupData = this.readPromptStore(backupPath)
    if (!backupData) {
      return 0
    }
    const targetData = this.readPromptStore(targetPath) || { prompts: [] }

    const existingIds = new Set(targetData.prompts.map((prompt) => prompt.id).filter(Boolean))
    let added = 0

    for (const prompt of backupData.prompts) {
      const id = prompt.id
      if (!id || existingIds.has(id)) {
        continue
      }
      targetData.prompts.push(prompt)
      existingIds.add(id)
      added++
    }

    if (added > 0) {
      fs.writeFileSync(targetPath, JSON.stringify(targetData, null, 2), 'utf-8')
    }
    return added
  }

  private readPromptStore(filePath: string): PromptStore | null {
    if (!fs.existsSync(filePath)) {
      return null
    }
    try {
      const content = fs.readFileSync(filePath, 'utf-8')
      const parsed = JSON.parse(content)
      if (!parsed || typeof parsed !== 'object' || !Array.isArray(parsed.prompts)) {
        return { prompts: [] }
      }
      return parsed as PromptStore
    } catch (error) {
      console.warn('Failed to read prompt store:', filePath, error)
      return { prompts: [] }
    }
  }
}
