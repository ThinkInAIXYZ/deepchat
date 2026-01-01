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
  MCPServerConfig
} from '@shared/presenter'
import { eventBus, SendTarget } from '@/eventbus'
import { SYNC_EVENTS } from '@/events'
import { DataImporter } from '../sqlitePresenter/importData'
import { ImportMode } from '../sqlitePresenter'

interface PromptStore {
  prompts: Array<{ id?: string; [key: string]: unknown }>
}

interface McpSettings {
  mcpServers?: Record<string, MCPServerConfig>
  defaultServers?: string[]
  [key: string]: unknown
}

type BackupStatus = 'idle' | 'preparing' | 'collecting' | 'compressing' | 'finalizing' | 'error'

const BACKUP_PREFIX = 'backup-'
const BACKUP_EXTENSION = '.zip'
const BACKUP_FILE_NAME_REGEX = /^backup-\d+\.zip$/

const ZIP_PATHS = {
  db: 'database/chat.db',
  appSettings: 'configs/app-settings.json',
  customPrompts: 'configs/custom_prompts.json',
  systemPrompts: 'configs/system_prompts.json',
  mcpSettings: 'configs/mcp-settings.json',
  manifest: 'manifest.json'
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
  private readonly DB_PATH = path.join(app.getPath('userData'), 'app_db', 'chat.db')

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
      eventBus.send(
        SYNC_EVENTS.BACKUP_ERROR,
        SendTarget.ALL_WINDOWS,
        (error as Error).message || 'sync.error.unknown'
      )
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
  ): Promise<{ success: boolean; message: string; count?: number }> {
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

    eventBus.send(SYNC_EVENTS.IMPORT_STARTED, SendTarget.ALL_WINDOWS)

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

    try {
      this.extractBackupArchive(backupZipPath, extractionDir)

      const backupDbPath = path.join(extractionDir, ZIP_PATHS.db)
      const backupAppSettingsPath = path.join(extractionDir, ZIP_PATHS.appSettings)
      const backupCustomPromptsPath = path.join(extractionDir, ZIP_PATHS.customPrompts)
      const backupSystemPromptsPath = path.join(extractionDir, ZIP_PATHS.systemPrompts)
      const backupMcpSettingsPath = path.join(extractionDir, ZIP_PATHS.mcpSettings)

      if (!fs.existsSync(backupDbPath) || !fs.existsSync(backupAppSettingsPath)) {
        throw new Error('sync.error.noValidBackup')
      }

      this.sqlitePresenter.close()
      sqliteClosed = true

      tempCurrentFiles.db = this.createTempBackup(this.DB_PATH, 'chat.db')
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

      let importedConversationCount = 0

      if (importMode === ImportMode.OVERWRITE) {
        const backupDb = new Database(backupDbPath, { readonly: true })
        const result = backupDb.prepare('SELECT COUNT(*) as count FROM conversations').get() as {
          count: number
        }
        importedConversationCount = result?.count || 0
        backupDb.close()

        this.copyFile(backupDbPath, this.DB_PATH)
        this.cleanupDatabaseSidecarFiles(this.DB_PATH)
        this.mergeAppSettingsPreservingSync(backupAppSettingsPath, this.APP_SETTINGS_PATH)

        if (fs.existsSync(backupCustomPromptsPath)) {
          this.copyFile(backupCustomPromptsPath, this.CUSTOM_PROMPTS_PATH)
        }

        if (fs.existsSync(backupSystemPromptsPath)) {
          this.copyFile(backupSystemPromptsPath, this.SYSTEM_PROMPTS_PATH)
        }

        if (fs.existsSync(backupMcpSettingsPath)) {
          this.copyFile(backupMcpSettingsPath, this.MCP_SETTINGS_PATH)
        }
      } else {
        const importer = new DataImporter(backupDbPath, this.DB_PATH)
        const summary = await importer.importData()
        importer.close()
        importedConversationCount = summary.tableCounts.conversations || 0

        this.mergeAppSettingsPreservingSync(backupAppSettingsPath, this.APP_SETTINGS_PATH)
        if (fs.existsSync(backupCustomPromptsPath)) {
          this.mergePromptStore(backupCustomPromptsPath, this.CUSTOM_PROMPTS_PATH)
        }
        if (fs.existsSync(backupSystemPromptsPath)) {
          this.mergePromptStore(backupSystemPromptsPath, this.SYSTEM_PROMPTS_PATH)
        }
        if (fs.existsSync(backupMcpSettingsPath)) {
          this.mergeMcpSettings(backupMcpSettingsPath, this.MCP_SETTINGS_PATH)
        }
      }

      if (sqliteClosed) {
        this.sqlitePresenter.reopen()
      }
      await this.broadcastThreadListUpdateAfterImport()
      if (importMode === ImportMode.OVERWRITE) {
        await this.resetShellWindowsToSingleNewChatTab()
      }
      eventBus.send(SYNC_EVENTS.IMPORT_COMPLETED, SendTarget.ALL_WINDOWS)
      return {
        success: true,
        message: 'sync.success.importComplete',
        count: importedConversationCount
      }
    } catch (error) {
      console.error('import failed,reverting:', error)
      this.restoreFromTempBackup(tempCurrentFiles)
      if (sqliteClosed) {
        try {
          this.sqlitePresenter.reopen()
          await this.broadcastThreadListUpdateAfterImport()
        } catch (reopenError) {
          console.error('Failed to reopen sqlite after import failure:', reopenError)
        }
      }
      eventBus.send(
        SYNC_EVENTS.IMPORT_ERROR,
        SendTarget.ALL_WINDOWS,
        (error as Error).message || 'sync.error.unknown'
      )
      return { success: false, message: 'sync.error.importFailed' }
    } finally {
      this.cleanupTempFiles(Object.values(tempCurrentFiles))
      this.removeDirectory(extractionDir)
    }
  }

  private async performBackup(): Promise<SyncBackupInfo> {
    this.isBackingUp = true
    this.emitBackupStatus('preparing')
    eventBus.send(SYNC_EVENTS.BACKUP_STARTED, SendTarget.ALL_WINDOWS)

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
      const files: Record<string, Uint8Array> = {}
      files[ZIP_PATHS.db] = new Uint8Array(fs.readFileSync(this.DB_PATH))
      files[ZIP_PATHS.appSettings] = new Uint8Array(fs.readFileSync(this.APP_SETTINGS_PATH))
      this.addOptionalFile(files, ZIP_PATHS.customPrompts, this.CUSTOM_PROMPTS_PATH)
      this.addOptionalFile(files, ZIP_PATHS.systemPrompts, this.SYSTEM_PROMPTS_PATH)
      this.addOptionalFile(files, ZIP_PATHS.mcpSettings, this.MCP_SETTINGS_PATH)

      const manifest = {
        version: 1,
        createdAt: timestamp,
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
      eventBus.send(SYNC_EVENTS.BACKUP_COMPLETED, SendTarget.ALL_WINDOWS, timestamp)
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
    eventBus.send(SYNC_EVENTS.BACKUP_STATUS_CHANGED, SendTarget.ALL_WINDOWS, {
      status,
      previousStatus: this.currentBackupStatus,
      ...extra
    })
    this.currentBackupStatus = status
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

    const mergedSettings = {
      ...backupSettings,
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
      const { presenter } = await import('../index')
      await (presenter?.sessionPresenter as any)?.broadcastThreadListUpdate?.()
    } catch (error) {
      console.warn('Failed to broadcast thread list update after import:', error)
    }
  }

  private async resetShellWindowsToSingleNewChatTab(): Promise<void> {
    try {
      const { presenter } = await import('../index')
      const windowPresenter = presenter?.windowPresenter as any
      const tabPresenter = presenter?.tabPresenter as any

      const windows = (windowPresenter?.getAllWindows?.() as Array<{ id: number }>) ?? []
      await Promise.all(
        windows.map(async ({ id: windowId }) => {
          const tabsData =
            (await tabPresenter?.getWindowTabsData?.(windowId)) ??
            ([] as Array<{ id: number; isActive?: boolean }>)

          if (tabsData.length === 0) {
            await tabPresenter?.createTab?.(windowId, 'local://chat', { active: true })
            return
          }

          const tabToKeep = tabsData.find((tab) => tab.isActive) ?? tabsData[0]
          if (!tabToKeep) {
            return
          }

          await tabPresenter?.resetTabToBlank?.(tabToKeep.id)
          await tabPresenter?.switchTab?.(tabToKeep.id)

          const tabsToClose = tabsData.filter((tab) => tab.id !== tabToKeep.id).map((tab) => tab.id)
          for (const tabId of tabsToClose) {
            try {
              await tabPresenter?.closeTab?.(tabId)
            } catch (error) {
              console.warn('Failed to close tab after overwrite import:', tabId, error)
            }
          }
        })
      )
    } catch (error) {
      console.warn('Failed to reset shell windows after overwrite import:', error)
    }
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

  private mergeMcpSettings(backupPath: string, targetPath: string): void {
    const backupSettings = this.readMcpSettings(backupPath)
    if (!backupSettings) {
      return
    }

    const currentSettings = this.readMcpSettings(targetPath) || {}
    const mergedServers: Record<string, MCPServerConfig> = currentSettings.mcpServers
      ? { ...currentSettings.mcpServers }
      : {}

    let addedServers = false
    for (const [name, config] of Object.entries(backupSettings.mcpServers || {})) {
      if (this.isKnowledgeMcp(name, config)) {
        continue
      }
      if (!mergedServers[name]) {
        mergedServers[name] = config
        addedServers = true
      }
    }

    const currentDefaults = new Set(currentSettings.defaultServers || [])
    let defaultsChanged = false
    for (const serverName of backupSettings.defaultServers || []) {
      const serverConfig = backupSettings.mcpServers?.[serverName]
      if (serverConfig && !this.isKnowledgeMcp(serverName, serverConfig)) {
        const beforeSize = currentDefaults.size
        currentDefaults.add(serverName)
        if (currentDefaults.size !== beforeSize) {
          defaultsChanged = true
        }
      }
    }

    const mergedSettings: McpSettings = { ...currentSettings }
    mergedSettings.mcpServers = mergedServers
    mergedSettings.defaultServers = Array.from(currentDefaults)

    let settingsChanged = false
    for (const [key, value] of Object.entries(backupSettings)) {
      if (key === 'mcpServers' || key === 'defaultServers') {
        continue
      }
      if (mergedSettings[key] === undefined) {
        mergedSettings[key] = value
        settingsChanged = true
      }
    }

    if (addedServers || defaultsChanged || settingsChanged) {
      fs.writeFileSync(targetPath, JSON.stringify(mergedSettings, null, 2), 'utf-8')
      return
    }

    if (!fs.existsSync(targetPath)) {
      fs.writeFileSync(targetPath, JSON.stringify(mergedSettings, null, 2), 'utf-8')
    }
  }

  private readMcpSettings(filePath: string): McpSettings | null {
    if (!fs.existsSync(filePath)) {
      return null
    }
    try {
      const content = fs.readFileSync(filePath, 'utf-8')
      return JSON.parse(content) as McpSettings
    } catch (error) {
      console.warn('Failed to read MCP settings:', filePath, error)
      return null
    }
  }

  private isKnowledgeMcp(name: string, config: MCPServerConfig | undefined): boolean {
    const normalizedName = name.toLowerCase()
    if (normalizedName.includes('knowledge')) {
      return true
    }
    const command = typeof config?.command === 'string' ? config.command.toLowerCase() : ''
    return command.includes('knowledge')
  }
}
