import { app, shell } from 'electron'
import path from 'path'
import fs from 'fs'
import Database from 'better-sqlite3-multiple-ciphers'
import { unzip, Zip, AsyncZipDeflate } from 'fflate'
import type { SyncBackupInfo, CloudSyncResult } from '@shared/types/sync'
import { CloudStorageService } from './cloudStorageService'
import type { DeepchatEventPublisher } from '@shared/contracts/events'
import { DataImporter } from './dataImporter'
import {
  CURRENT_SYNC_BACKUP_VERSION,
  CURRENT_SYNC_CONFIG_SCHEMA_VERSION,
  SyncConfigImportService,
  type SyncBackupManifest
} from './configImportService'
import type { SyncSettings } from './settings'
import { withBackupSnapshot, type BackupReadLockOutcome } from '@/data/backupReadLock'
import type { SettingsDatabase } from '@/settings/data/database'
import type { ProviderDatabase } from '@/provider/data/database'

interface PromptStore {
  prompts: Array<{ id?: string; [key: string]: unknown }>
}

type BackupStatus = 'idle' | 'preparing' | 'collecting' | 'compressing' | 'finalizing' | 'error'

export enum ImportMode {
  INCREMENT = 'increment',
  OVERWRITE = 'overwrite'
}

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
// These values are meaningful only on the machine that created them. Cloud secrets cannot be
// decrypted elsewhere, and executable paths must not overwrite another device's local selection.
// Strip them from backups and preserve the receiving machine's values on import.
const MACHINE_LOCAL_APP_SETTINGS_KEYS = [
  'cloudSyncConfig',
  'cloudSyncSecret',
  'agentCommandShell'
] as const
const KNOWN_IMPORT_ERRORS = new Set([
  'sync.error.noValidBackup',
  'sync.error.unsupportedBackupVersion',
  'sync.error.encryptedBackupPasswordMissing',
  'sync.error.overwriteEncryptionMismatch'
])

const ZIP_PATHS = {
  agentDb: 'database/agent.db',
  agentDbWal: 'database/agent.db-wal',
  chatDb: 'database/chat.db',
  appSettings: 'configs/app-settings.json',
  customPrompts: 'configs/custom_prompts.json',
  systemPrompts: 'configs/system_prompts.json',
  mcpSettings: 'configs/mcp-settings.json',
  manifest: 'manifest.json'
}

const toUint8ArrayView = (buffer: Buffer): Uint8Array =>
  new Uint8Array(buffer.buffer, buffer.byteOffset, buffer.byteLength)

const ZIP_LEVEL = 6
const ZIP_SLICE_SIZE = 4 * 1024 * 1024

const unzipAsync = (data: Uint8Array) =>
  new Promise<Record<string, Uint8Array>>((resolve, reject) => {
    unzip(data, (error, extracted) => {
      if (error) {
        reject(error)
        return
      }
      resolve(extracted)
    })
  })

type BackupDbSource = {
  type: 'agent' | 'chat'
  path: string
}

export interface SyncImportDatabasePort {
  close(): void
  reopen(): void
  importLegacyChatDb(
    sourceDbPath: string,
    mode: 'increment' | 'overwrite'
  ): Promise<{
    importedSessions: number
    importedMessages: number
    importedSearchResults: number
  }>
}

interface SyncDatabasePort {
  getDatabasePassword(): string | undefined
  openDatabaseConnection(dbPath: string): Database.Database
  withBackupReadLock<T>(work: () => Promise<T>): Promise<BackupReadLockOutcome<T>>
}

export interface SyncImportResult {
  success: boolean
  message: string
  count?: number
  sourceDbType?: 'agent' | 'chat'
  importedSessions?: number
}

export class SyncService {
  private isBackingUp = false
  private currentBackupStatus: BackupStatus = 'idle'
  private readonly APP_SETTINGS_PATH = path.join(app.getPath('userData'), 'app-settings.json')
  private readonly CUSTOM_PROMPTS_PATH = path.join(app.getPath('userData'), 'custom_prompts.json')
  private readonly SYSTEM_PROMPTS_PATH = path.join(app.getPath('userData'), 'system_prompts.json')
  private readonly MCP_SETTINGS_PATH = path.join(app.getPath('userData'), 'mcp-settings.json')
  private readonly DB_PATH = path.join(app.getPath('userData'), 'app_db', 'agent.db')

  constructor(
    private readonly settings: SyncSettings,
    private readonly database: SyncDatabasePort,
    private readonly settingsDatabase: SettingsDatabase,
    private readonly providerDatabase: ProviderDatabase,
    private readonly publishEvent: DeepchatEventPublisher
  ) {}

  public async checkSyncFolder(): Promise<{ exists: boolean; path: string }> {
    const syncFolderPath = this.settings.getFolderPath()
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

  public isBackupInProgress(): boolean {
    return this.isBackingUp
  }

  public async getBackupStatus(): Promise<{ isBackingUp: boolean; lastBackupTime: number }> {
    const lastBackupTime = this.settings.getLastSyncTime()
    return { isBackingUp: this.isBackingUp, lastBackupTime }
  }

  // === Cloud sync (S3-compatible) ===

  private buildCloudService(): CloudStorageService {
    const resolved = this.settings.getResolvedCloudConfig()
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
      SyncService.CLOUD_UNAUTHORIZED_SIGNALS.some((signal) => normalizedMessage.includes(signal))
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
          await this.validateBackupArchive(localPath)
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

  public async downloadLatestBackupFromCloud(): Promise<CloudSyncResult> {
    try {
      const service = this.buildCloudService()
      const { path: syncFolderPath } = await this.checkSyncFolder()
      const backupsDir = this.getBackupsDirectory(syncFolderPath)
      const fileName = await service.downloadLatest(backupsDir)
      if (!fileName) {
        return { success: false, message: 'sync.error.cloudNoBackup' }
      }
      return { success: true, message: 'sync.success.cloudPulled', fileName }
    } catch (error) {
      console.error('Cloud pull failed:', error)
      return { success: false, message: this.normalizeCloudError(error) }
    }
  }

  public async listBackups(): Promise<SyncBackupInfo[]> {
    const { path: syncFolderPath } = await this.checkSyncFolder()
    const backupsDir = this.getBackupsDirectory(syncFolderPath)
    try {
      await fs.promises.access(backupsDir)
    } catch {
      return []
    }

    const entries = (await fs.promises.readdir(backupsDir)).filter((file) =>
      file.endsWith(BACKUP_EXTENSION)
    )
    const backups = await Promise.all(
      entries.map(async (fileName) => {
        const match = fileName.match(/backup-(\d+)\.zip$/)
        const stats = await fs.promises.stat(path.join(backupsDir, fileName))
        const createdAt = match ? Number(match[1]) : stats.mtimeMs
        return { fileName, createdAt, size: stats.size }
      })
    )

    return backups.sort((a, b) => b.createdAt - a.createdAt)
  }

  public async startBackup(): Promise<SyncBackupInfo | null> {
    if (this.isBackingUp) {
      return null
    }

    if (!this.settings.getEnabled()) {
      throw new Error('sync.error.notEnabled')
    }

    return this.createHostBackup()
  }

  /** Shared local export pipeline; host publishing does not enable legacy/cloud sync. */
  public async createHostBackup(): Promise<SyncBackupInfo | null> {
    if (this.isBackingUp) return null
    try {
      return await this.performBackup()
    } catch (error) {
      console.error('Backup failed:', error)
      this.publishEvent('sync.backup.error', {
        error: (error as Error).message || 'sync.error.unknown',
        version: Date.now()
      })
      throw error
    }
  }

  public async cancelBackup(): Promise<void> {
    this.isBackingUp = false
  }

  public async importFromSync(
    backupFileName: string,
    importMode: 'increment' | 'overwrite',
    database: SyncImportDatabasePort
  ): Promise<SyncImportResult> {
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

    return this.importBackupFile(backupZipPath, importMode, database)
  }

  /** Internal entry point for a fully downloaded and verified private staging file. */
  public async importBackupFile(
    backupZipPath: string,
    importMode: 'increment' | 'overwrite',
    database: SyncImportDatabasePort
  ): Promise<SyncImportResult> {
    this.publishEvent('sync.import.started', {
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
      await this.extractBackupArchive(backupZipPath, extractionDir)
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

      database.close()
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
        database.reopen()
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
          this.restoreBackupWalSidecar(backupDbSource.path, this.DB_PATH)
          if (usesSqliteConfigStorage) {
            configImportService.finalizeSqliteConfigImport()
          } else {
            configImportService.importLegacyConfig(extractionDir, 'overwrite')
          }
          this.mergeAppSettingsPreservingMachineLocal(backupAppSettingsPath, this.APP_SETTINGS_PATH)

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
          if (
            Object.keys(summary.repairedRowCounts).length > 0 ||
            Object.keys(summary.skippedRowCounts).length > 0
          ) {
            console.warn('[Sync] Incremental import normalized or skipped malformed rows', {
              repairedRowCounts: summary.repairedRowCounts,
              skippedRowCounts: summary.skippedRowCounts
            })
          }
          importedConversationCount =
            summary.tableCounts.new_sessions || summary.tableCounts.conversations || 0

          if (usesSqliteConfigStorage) {
            configImportService.finalizeSqliteConfigImport()
          } else {
            configImportService.importLegacyConfig(extractionDir, 'increment')
          }
          this.mergeAppSettingsPreservingMachineLocal(backupAppSettingsPath, this.APP_SETTINGS_PATH)
          if (fs.existsSync(backupCustomPromptsPath)) {
            this.mergePromptStore(backupCustomPromptsPath, this.CUSTOM_PROMPTS_PATH)
          }
          if (fs.existsSync(backupSystemPromptsPath)) {
            this.mergePromptStore(backupSystemPromptsPath, this.SYSTEM_PROMPTS_PATH)
          }
        }
      } else {
        const summary = await database.importLegacyChatDb(
          backupDbSource.path,
          importMode === ImportMode.OVERWRITE ? 'overwrite' : 'increment'
        )
        importedConversationCount = summary.importedSessions

        database.close()
        sqliteClosed = true
        sqliteReopenedForLegacyImport = false
        configImportService.importLegacyConfig(
          extractionDir,
          importMode === ImportMode.OVERWRITE ? 'overwrite' : 'increment'
        )
        this.mergeAppSettingsPreservingMachineLocal(backupAppSettingsPath, this.APP_SETTINGS_PATH)
        if (fs.existsSync(backupCustomPromptsPath)) {
          this.mergePromptStore(backupCustomPromptsPath, this.CUSTOM_PROMPTS_PATH)
        }
        if (fs.existsSync(backupSystemPromptsPath)) {
          this.mergePromptStore(backupSystemPromptsPath, this.SYSTEM_PROMPTS_PATH)
        }
      }

      if (sqliteClosed) {
        database.reopen()
      }
      if (importMode === ImportMode.OVERWRITE) {
        await this.resetShellWindowsToSingleNewChatTab()
      }
      this.publishEvent('sync.import.completed', {
        version: Date.now(),
        mode: importMode
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
          database.close()
          sqliteClosed = true
        } catch (closeError) {
          console.error('Failed to close sqlite before restore after import failure:', closeError)
        }
      }
      this.restoreFromTempBackup(tempCurrentFiles)
      if (sqliteClosed) {
        try {
          database.reopen()
        } catch (reopenError) {
          console.error('Failed to reopen sqlite after import failure:', reopenError)
        }
      }
      this.publishEvent('sync.import.error', {
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
    this.publishEvent('sync.backup.started', {
      version: Date.now()
    })

    const syncFolderPath = this.settings.getFolderPath()
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
      const files = await this.collectBackupFiles()

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
      await this.writeZipToDisk(files, tempZipPath)

      try {
        await fs.promises.unlink(finalZipPath)
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
          throw error
        }
      }
      this.emitBackupStatus('finalizing')
      await fs.promises.rename(tempZipPath, finalZipPath)

      const backupStats = await fs.promises.stat(finalZipPath)
      this.settings.setLastSyncTime(timestamp)
      this.publishEvent('sync.backup.completed', {
        timestamp,
        version: Date.now()
      })
      completedTimestamp = timestamp

      return { fileName: backupFileName, createdAt: timestamp, size: backupStats.size }
    } catch (error) {
      try {
        await fs.promises.unlink(tempZipPath)
      } catch (cleanupError) {
        if ((cleanupError as NodeJS.ErrnoException).code !== 'ENOENT') {
          console.warn('[Sync] Failed to remove partial backup archive:', cleanupError)
        }
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

  private getBackupsDirectory(syncFolderPath: string): string {
    return syncFolderPath
  }

  private emitBackupStatus(status: BackupStatus, extra: Record<string, unknown> = {}): void {
    this.publishEvent('sync.backup.status.changed', {
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

  private createConfigImportService(): SyncConfigImportService {
    return new SyncConfigImportService(this.DB_PATH, (dbPath) =>
      this.database.openDatabaseConnection(dbPath)
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
    return this.database.getDatabasePassword()
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
    importMode: 'increment' | 'overwrite',
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
    if (!this.settingsDatabase.appSettingsTable.hasConfigMigration()) {
      throw new Error('sync.error.configNotExists')
    }
  }

  private async writeZipToDisk(
    files: Record<string, Uint8Array>,
    targetPath: string
  ): Promise<void> {
    await new Promise<void>((resolve, reject) => {
      const output = fs.createWriteStream(targetPath)
      const archive = new Zip()
      let drain: Promise<void> = Promise.resolve()
      output.on('error', reject)
      archive.ondata = (error, chunk, final) => {
        if (error) {
          output.destroy(error)
          reject(error)
          return
        }
        if (!output.write(Buffer.from(chunk.buffer, chunk.byteOffset, chunk.byteLength))) {
          drain = new Promise<void>((drained) => {
            output.once('drain', () => drained())
            output.once('error', () => drained())
          })
        }
        if (final) {
          output.end(() => resolve())
        }
      }

      void (async () => {
        try {
          for (const [name, data] of Object.entries(files)) {
            const entry = new AsyncZipDeflate(name, { level: ZIP_LEVEL })
            archive.add(entry)
            for (let offset = 0; offset < data.length; offset += ZIP_SLICE_SIZE) {
              await drain
              const end = Math.min(offset + ZIP_SLICE_SIZE, data.length)
              entry.push(new Uint8Array(data.slice(offset, end)), false)
              await new Promise((resume) => setImmediate(resume))
            }
            await drain
            entry.push(new Uint8Array(0), true)
          }
          await drain
          archive.end()
        } catch (error) {
          output.destroy(error as Error)
          reject(error)
        }
      })()
    })
  }

  private async collectBackupFiles(): Promise<Record<string, Uint8Array>> {
    const snapshot = await this.database.withBackupReadLock(async () => {
      const files = await this.readSupportFiles()
      files[ZIP_PATHS.agentDb] = toUint8ArrayView(await fs.promises.readFile(this.DB_PATH))
      return files
    })
    if (!snapshot.acquired) {
      console.warn(
        '[Sync] Backup could not take a fully drained WAL snapshot (blocked checkpoint or a ' +
          'commit landed during the drain window); falling back to a snapshot-pinned copy ' +
          'that ships the WAL sidecar so committed transactions are not silently dropped'
      )
      return this.readBackupFilesFallback()
    }
    return snapshot.result
  }

  private async readBackupFilesFallback(): Promise<Record<string, Uint8Array>> {
    // The drain failed, so a checkpoint can still backfill mid-copy. Pin a read mark for
    // the whole copy: while it is held the WAL cannot be reset, and any backfilled frames
    // are at or below the mark, so the shipped db + WAL pair replays to one generation.
    return withBackupSnapshot(
      () => this.database.openDatabaseConnection(this.DB_PATH),
      async () => {
        const files = await this.readSupportFiles()
        files[ZIP_PATHS.agentDb] = toUint8ArrayView(await fs.promises.readFile(this.DB_PATH))
        const walPath = `${this.DB_PATH}-wal`
        try {
          const walImage = await fs.promises.readFile(walPath)
          if (walImage.length > 0) {
            files[ZIP_PATHS.agentDbWal] = toUint8ArrayView(walImage)
          }
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
            throw error
          }
        }
        return files
      }
    )
  }

  private async readSupportFiles(): Promise<Record<string, Uint8Array>> {
    const files: Record<string, Uint8Array> = {}
    files[ZIP_PATHS.appSettings] = await this.readSanitizedAppSettingsBackup()
    await this.addOptionalFile(files, ZIP_PATHS.customPrompts, this.CUSTOM_PROMPTS_PATH)
    await this.addOptionalFile(files, ZIP_PATHS.systemPrompts, this.SYSTEM_PROMPTS_PATH)
    return files
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

  private async addOptionalFile(
    files: Record<string, Uint8Array>,
    zipPath: string,
    filePath: string
  ): Promise<void> {
    try {
      files[zipPath] = toUint8ArrayView(await fs.promises.readFile(filePath))
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
        throw error
      }
    }
  }

  private async readSanitizedAppSettingsBackup(): Promise<Uint8Array> {
    const raw = await fs.promises.readFile(this.APP_SETTINGS_PATH, 'utf-8')
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
        if ((MACHINE_LOCAL_APP_SETTINGS_KEYS as readonly string[]).includes(key)) {
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
      for (const provider of this.providerDatabase.settingsTable.listProviders()) {
        providerIds.add(provider.id)
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

  private async extractBackupArchive(zipPath: string, targetDir: string): Promise<void> {
    const zipContent = new Uint8Array(await fs.promises.readFile(zipPath))
    const extracted = await unzipAsync(zipContent)
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
        await fs.promises.mkdir(destination, { recursive: true })
        continue
      }

      await fs.promises.mkdir(path.dirname(destination), { recursive: true })
      await fs.promises.writeFile(destination, Buffer.from(fileContent))
    }
  }

  private async validateBackupArchive(backupZipPath: string): Promise<void> {
    const extractionDir = path.join(app.getPath('temp'), `deepchat-backup-validate-${Date.now()}`)
    fs.mkdirSync(extractionDir, { recursive: true })

    try {
      await this.extractBackupArchive(backupZipPath, extractionDir)
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
    try {
      const parsed = JSON.parse(fs.readFileSync(filePath, 'utf-8'))
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
        throw new Error('sync.error.importFailed')
      }
      return parsed as Record<string, unknown>
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        return null
      }
      console.error('Failed to read settings file for machine-local setting preservation:', error)
      throw new Error('sync.error.importFailed')
    }
  }

  private mergeAppSettingsPreservingMachineLocal(backupPath: string, targetPath: string): void {
    let backupSettingsRaw: string
    try {
      backupSettingsRaw = fs.readFileSync(backupPath, 'utf-8')
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        return
      }
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
    preservedSettings.syncEnabled = this.settings.getEnabled()
    preservedSettings.syncFolderPath = this.settings.getFolderPath()
    preservedSettings.lastSyncTime = this.settings.getLastSyncTime()

    // A backup never carries machine-local settings, so restore them from the receiving target.
    const localSettings = this.readSettingsFile(targetPath)
    for (const key of MACHINE_LOCAL_APP_SETTINGS_KEYS) {
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
    const tempPath = path.join(app.getPath('temp'), `${name}.${Date.now()}.bak`)
    try {
      this.copyFile(originalPath, tempPath)
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        return null
      }
      throw error
    }
    return tempPath
  }

  private copyFile(source: string, target: string): void {
    fs.mkdirSync(path.dirname(target), { recursive: true })
    fs.copyFileSync(source, target)
  }

  private async resetShellWindowsToSingleNewChatTab(): Promise<void> {
    // Shell windows no longer manage chat tabs; nothing to reset
  }

  private restoreBackupWalSidecar(sourceDbPath: string, targetDbPath: string): void {
    const sourceWalPath = `${sourceDbPath}-wal`
    // Ships un-checkpointed transactions from a fallback archive; the next
    // read-write open replays them. Placed after cleanupDatabaseSidecarFiles so
    // stale sidecars from the previous database cannot mix with this image.
    try {
      this.copyFile(sourceWalPath, `${targetDbPath}-wal`)
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
        throw error
      }
    }
  }

  private cleanupDatabaseSidecarFiles(dbFilePath: string): void {
    const sidecarFiles = [`${dbFilePath}-wal`, `${dbFilePath}-shm`]
    for (const filePath of sidecarFiles) {
      try {
        fs.unlinkSync(filePath)
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
          console.warn('Failed to remove database sidecar file:', filePath, error)
        }
      }
    }
  }

  private restoreFromTempBackup(tempFiles: Record<string, string | null>): void {
    if (tempFiles.db) {
      this.copyFile(tempFiles.db, this.DB_PATH)
      this.cleanupDatabaseSidecarFiles(this.DB_PATH)
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
      if (!filePath) {
        continue
      }
      try {
        fs.unlinkSync(filePath)
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
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
    try {
      const content = fs.readFileSync(filePath, 'utf-8')
      const parsed = JSON.parse(content)
      if (!parsed || typeof parsed !== 'object' || !Array.isArray(parsed.prompts)) {
        return { prompts: [] }
      }
      return parsed as PromptStore
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        return null
      }
      console.warn('Failed to read prompt store:', filePath, error)
      return { prompts: [] }
    }
  }
}
