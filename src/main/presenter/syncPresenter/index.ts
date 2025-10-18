import { app, shell } from 'electron'
import path from 'path'
import fs from 'fs'
import Database from 'better-sqlite3-multiple-ciphers'
import { ISyncPresenter, IConfigPresenter, ISQLitePresenter } from '@shared/presenter'
import { eventBus, SendTarget } from '@/eventbus'
import { SYNC_EVENTS } from '@/events'
import { DataImporter } from '../sqlitePresenter/importData'
import { ImportMode } from '../sqlitePresenter/index'

// 为配置文件定义接口
interface AppSettings {
  syncEnabled?: boolean
  syncFolderPath?: string
  lastSyncTime?: number
  [key: string]: unknown
}

export class SyncPresenter implements ISyncPresenter {
  private configPresenter: IConfigPresenter
  private sqlitePresenter: ISQLitePresenter
  private isBackingUp: boolean = false
  private backupTimer: NodeJS.Timeout | null = null
  private readonly BACKUP_DELAY = 60 * 1000 // 60秒无变更后触发备份
  private readonly APP_SETTINGS_PATH = path.join(app.getPath('userData'), 'app-settings.json')
  private readonly MCP_SETTINGS_PATH = path.join(app.getPath('userData'), 'mcp-settings.json')
  private readonly PROVIDER_MODELS_DIR_PATH = path.join(app.getPath('userData'), 'provider_models')
  private readonly DB_PATH = path.join(app.getPath('userData'), 'app_db', 'chat.db')
  private readonly MODEL_CONFIG_PATH = path.join(app.getPath('userData'), 'model-config.json')

  constructor(configPresenter: IConfigPresenter, sqlitePresenter: ISQLitePresenter) {
    this.configPresenter = configPresenter
    this.sqlitePresenter = sqlitePresenter
    this.init()
  }

  public init(): void {
    // 监听数据变更事件，触发备份计划
    this.listenForChanges()
  }

  public destroy(): void {
    // 清理定时器
    if (this.backupTimer) {
      clearTimeout(this.backupTimer)
      this.backupTimer = null
    }
  }

  /**
   * 检查同步文件夹状态
   */
  public async checkSyncFolder(): Promise<{ exists: boolean; path: string }> {
    const syncFolderPath = this.configPresenter.getSyncFolderPath()
    const exists = fs.existsSync(syncFolderPath)

    return { exists, path: syncFolderPath }
  }

  /**
   * 打开同步文件夹
   */
  public async openSyncFolder(): Promise<void> {
    const { exists, path: syncFolderPath } = await this.checkSyncFolder()

    // 如果文件夹不存在，先创建它
    if (!exists) {
      fs.mkdirSync(syncFolderPath, { recursive: true })
    }

    // 打开文件夹
    shell.openPath(syncFolderPath)
  }

  /**
   * 获取备份状态
   */
  public async getBackupStatus(): Promise<{ isBackingUp: boolean; lastBackupTime: number }> {
    const lastBackupTime = this.configPresenter.getLastSyncTime()
    return { isBackingUp: this.isBackingUp, lastBackupTime }
  }

  /**
   * 手动触发备份
   */
  public async startBackup(): Promise<void> {
    if (this.isBackingUp) {
      return
    }

    // 检查同步功能是否启用
    if (!this.configPresenter.getSyncEnabled()) {
      throw new Error('sync.error.notEnabled')
    }

    try {
      await this.performBackup()
    } catch (error: unknown) {
      console.error('备份失败:', error)
      eventBus.send(
        SYNC_EVENTS.BACKUP_ERROR,
        SendTarget.ALL_WINDOWS,
        (error as Error).message || 'sync.error.unknown'
      )
      throw error
    }
  }

  /**
   * 取消备份操作
   */
  public async cancelBackup(): Promise<void> {
    if (this.backupTimer) {
      clearTimeout(this.backupTimer)
      this.backupTimer = null
    }
    this.isBackingUp = false
  }

  /**
   * 从同步文件夹导入数据
   */
  public async importFromSync(
    importMode: ImportMode = ImportMode.INCREMENT
  ): Promise<{ success: boolean; message: string; count?: number }> {
    // Cancel any pending backup to prevent overwriting the backup files during import
    if (this.backupTimer) {
      clearTimeout(this.backupTimer)
      this.backupTimer = null
    }

    // 检查同步文件夹是否存在
    const { exists, path: syncFolderPath } = await this.checkSyncFolder()
    if (!exists) {
      return { success: false, message: 'sync.error.folderNotExists' }
    }

    // 检查是否有备份文件
    const dbBackupPath = path.join(syncFolderPath, 'chat.db')
    const appSettingsBackupPath = path.join(syncFolderPath, 'app-settings.json')
    const providerModelsBackupPath = path.join(syncFolderPath, 'provider_models')
    const modelConfigBackupPath = path.join(syncFolderPath, 'model-config.json')

    if (!fs.existsSync(dbBackupPath) || !fs.existsSync(appSettingsBackupPath)) {
      return { success: false, message: 'sync.error.noValidBackup' }
    }

    // 发出导入开始事件
    eventBus.send(SYNC_EVENTS.IMPORT_STARTED, SendTarget.ALL_WINDOWS)

    try {
      // 关闭数据库连接
      this.sqlitePresenter.close()

      // 备份当前文件
      const tempDbPath = path.join(app.getPath('temp'), `chat_${Date.now()}.db`)
      const tempAppSettingsPath = path.join(app.getPath('temp'), `app_settings_${Date.now()}.json`)
      const tempProviderModelsPath = path.join(app.getPath('temp'), `provider_models_${Date.now()}`)
      const tempMcpSettingsPath = path.join(app.getPath('temp'), `mcp_settings_${Date.now()}.json`)
      const tempModelConfigPath = path.join(app.getPath('temp'), `model_config_${Date.now()}.json`)
      // 创建临时备份
      if (fs.existsSync(this.DB_PATH)) {
        fs.copyFileSync(this.DB_PATH, tempDbPath)
      }

      if (fs.existsSync(this.APP_SETTINGS_PATH)) {
        fs.copyFileSync(this.APP_SETTINGS_PATH, tempAppSettingsPath)
      }

      if (fs.existsSync(this.MCP_SETTINGS_PATH)) {
        fs.copyFileSync(this.MCP_SETTINGS_PATH, tempMcpSettingsPath)
      }

      // 备份模型配置文件
      if (fs.existsSync(this.MODEL_CONFIG_PATH)) {
        fs.copyFileSync(this.MODEL_CONFIG_PATH, tempModelConfigPath)
      }

      // 如果 provider_models 目录存在，备份整个目录
      if (fs.existsSync(this.PROVIDER_MODELS_DIR_PATH)) {
        this.copyDirectory(this.PROVIDER_MODELS_DIR_PATH, tempProviderModelsPath)
      }

      let importedCount = 0
      try {
        if (importMode === ImportMode.OVERWRITE) {
          // For overwrite mode, count conversations from backup db in read-only mode
          const backupDb = new Database(dbBackupPath, { readonly: true })
          const result = backupDb.prepare('SELECT COUNT(*) as count FROM conversations').get() as {
            count: number
          }
          importedCount = result.count
          backupDb.close()

          fs.copyFileSync(dbBackupPath, this.DB_PATH)
        } else {
          // For incremental mode, DataImporter returns the actual imported count
          const importer = new DataImporter(dbBackupPath, this.DB_PATH)
          importedCount = await importer.importData()
          console.log(`成功导入 ${importedCount} 个会话`)
          importer.close()
        }
        // 合并 app-settings.json 文件 (排除同步相关的设置)
        if (fs.existsSync(appSettingsBackupPath)) {
          // 读取当前的 app-settings
          let currentSettings: AppSettings = {}
          if (fs.existsSync(this.APP_SETTINGS_PATH)) {
            const currentContent = fs.readFileSync(this.APP_SETTINGS_PATH, 'utf-8')
            currentSettings = JSON.parse(currentContent)
          }

          // 读取备份的 app-settings
          const backupContent = fs.readFileSync(appSettingsBackupPath, 'utf-8')
          const backupSettings = JSON.parse(backupContent)

          // 保留当前的同步相关设置
          const syncSettings: AppSettings = {
            syncEnabled: currentSettings.syncEnabled,
            syncFolderPath: currentSettings.syncFolderPath,
            lastSyncTime: currentSettings.lastSyncTime
          }

          // 合并设置: 使用备份的设置，但保留同步相关设置
          const mergedSettings = { ...backupSettings, ...syncSettings }

          // 保存合并后的设置
          fs.writeFileSync(this.APP_SETTINGS_PATH, JSON.stringify(mergedSettings, null, 2), 'utf-8')
        }

        // 如果存在 provider_models 备份，复制整个目录（直接覆盖）
        if (fs.existsSync(providerModelsBackupPath)) {
          // 清空当前 provider_models 目录
          if (fs.existsSync(this.PROVIDER_MODELS_DIR_PATH)) {
            this.removeDirectory(this.PROVIDER_MODELS_DIR_PATH)
          }
          // 确保目标目录存在
          fs.mkdirSync(this.PROVIDER_MODELS_DIR_PATH, { recursive: true })
          // 复制备份目录到应用目录
          this.copyDirectory(providerModelsBackupPath, this.PROVIDER_MODELS_DIR_PATH)
        }

        // 导入模型配置文件
        if (fs.existsSync(modelConfigBackupPath)) {
          fs.copyFileSync(modelConfigBackupPath, this.MODEL_CONFIG_PATH)
        }

        eventBus.send(SYNC_EVENTS.IMPORT_COMPLETED, SendTarget.ALL_WINDOWS)
        return { success: true, message: 'sync.success.importComplete', count: importedCount }
      } catch (error: unknown) {
        console.error('导入文件失败，恢复备份:', error)

        // 恢复备份
        if (fs.existsSync(tempDbPath)) {
          fs.copyFileSync(tempDbPath, this.DB_PATH)
        }

        if (fs.existsSync(tempAppSettingsPath)) {
          fs.copyFileSync(tempAppSettingsPath, this.APP_SETTINGS_PATH)
        }

        if (fs.existsSync(tempMcpSettingsPath)) {
          fs.copyFileSync(tempMcpSettingsPath, this.MCP_SETTINGS_PATH)
        }

        if (fs.existsSync(tempProviderModelsPath)) {
          if (fs.existsSync(this.PROVIDER_MODELS_DIR_PATH)) {
            this.removeDirectory(this.PROVIDER_MODELS_DIR_PATH)
          }
          this.copyDirectory(tempProviderModelsPath, this.PROVIDER_MODELS_DIR_PATH)
        }

        // 恢复模型配置文件
        if (fs.existsSync(tempModelConfigPath)) {
          fs.copyFileSync(tempModelConfigPath, this.MODEL_CONFIG_PATH)
        }

        eventBus.send(
          SYNC_EVENTS.IMPORT_ERROR,
          SendTarget.ALL_WINDOWS,
          (error as Error).message || 'sync.error.unknown'
        )
        return { success: false, message: 'sync.error.importFailed' }
      } finally {
        // 清理临时文件
        if (fs.existsSync(tempDbPath)) {
          fs.unlinkSync(tempDbPath)
        }

        if (fs.existsSync(tempAppSettingsPath)) {
          fs.unlinkSync(tempAppSettingsPath)
        }

        if (fs.existsSync(tempMcpSettingsPath)) {
          fs.unlinkSync(tempMcpSettingsPath)
        }

        if (fs.existsSync(tempProviderModelsPath)) {
          this.removeDirectory(tempProviderModelsPath)
        }

        // 清理模型配置临时文件
        if (fs.existsSync(tempModelConfigPath)) {
          fs.unlinkSync(tempModelConfigPath)
        }
      }
    } catch (error: unknown) {
      console.error('导入过程出错:', error)
      eventBus.send(
        SYNC_EVENTS.IMPORT_ERROR,
        SendTarget.ALL_WINDOWS,
        (error as Error).message || 'sync.error.unknown'
      )
      return { success: false, message: 'sync.error.importProcess' }
    }
  }

  /**
   * 执行实际的备份操作
   */
  private async performBackup(): Promise<void> {
    // 标记备份开始
    this.isBackingUp = true
    eventBus.send(SYNC_EVENTS.BACKUP_STARTED, SendTarget.ALL_WINDOWS)

    try {
      const syncFolderPath = this.configPresenter.getSyncFolderPath()

      // 确保同步文件夹存在
      if (!fs.existsSync(syncFolderPath)) {
        fs.mkdirSync(syncFolderPath, { recursive: true })
      }

      // 生成临时备份文件路径（防止导入过程中的文件冲突）
      const tempDbBackupPath = path.join(syncFolderPath, `chat_${Date.now()}.db.tmp`)
      const tempAppSettingsBackupPath = path.join(
        syncFolderPath,
        `app_settings_${Date.now()}.json.tmp`
      )
      const tempProviderModelsBackupPath = path.join(
        syncFolderPath,
        `provider_models_${Date.now()}.tmp`
      )
      const tempMcpSettingsBackupPath = path.join(
        syncFolderPath,
        `mcp_settings_${Date.now()}.json.tmp`
      )
      const tempModelConfigBackupPath = path.join(
        syncFolderPath,
        `model_config_${Date.now()}.json.tmp`
      )

      const finalDbBackupPath = path.join(syncFolderPath, 'chat.db')
      const finalAppSettingsBackupPath = path.join(syncFolderPath, 'app-settings.json')
      const finalProviderModelsBackupPath = path.join(syncFolderPath, 'provider_models')
      const finalMcpSettingsBackupPath = path.join(syncFolderPath, 'mcp-settings.json')
      const finalModelConfigBackupPath = path.join(syncFolderPath, 'model-config.json')

      // 确保数据库文件存在
      if (!fs.existsSync(this.DB_PATH)) {
        console.warn('数据库文件不存在:', this.DB_PATH)
        throw new Error('sync.error.dbNotExists')
      }

      // 确保配置文件存在
      if (!fs.existsSync(this.APP_SETTINGS_PATH)) {
        console.warn('配置文件不存在:', this.APP_SETTINGS_PATH)
        throw new Error('sync.error.configNotExists')
      }

      // 备份数据库
      fs.copyFileSync(this.DB_PATH, tempDbBackupPath)

      // 备份配置文件（过滤掉同步相关的设置）
      if (fs.existsSync(this.APP_SETTINGS_PATH)) {
        const appSettingsContent = fs.readFileSync(this.APP_SETTINGS_PATH, 'utf-8')
        const appSettings = JSON.parse(appSettingsContent)

        // 创建配置副本，不包含同步相关的设置
        const filteredSettings = { ...appSettings }
        // 删除同步相关的设置
        delete filteredSettings.syncEnabled
        delete filteredSettings.syncFolderPath
        delete filteredSettings.lastSyncTime

        fs.writeFileSync(
          tempAppSettingsBackupPath,
          JSON.stringify(filteredSettings, null, 2),
          'utf-8'
        )
      }

      // 备份 MCP 设置
      if (fs.existsSync(this.MCP_SETTINGS_PATH)) {
        fs.copyFileSync(this.MCP_SETTINGS_PATH, tempMcpSettingsBackupPath)
      }

      // 备份模型配置文件
      if (fs.existsSync(this.MODEL_CONFIG_PATH)) {
        fs.copyFileSync(this.MODEL_CONFIG_PATH, tempModelConfigBackupPath)
      }

      // 备份 provider_models 目录
      if (fs.existsSync(this.PROVIDER_MODELS_DIR_PATH)) {
        // 确保临时目录存在
        fs.mkdirSync(tempProviderModelsBackupPath, { recursive: true })
        // 复制整个 provider_models 目录
        this.copyDirectory(this.PROVIDER_MODELS_DIR_PATH, tempProviderModelsBackupPath)
      }

      // 检查临时文件是否成功创建
      if (!fs.existsSync(tempDbBackupPath)) {
        throw new Error('sync.error.tempDbFailed')
      }

      if (!fs.existsSync(tempAppSettingsBackupPath)) {
        throw new Error('sync.error.tempConfigFailed')
      }

      if (!fs.existsSync(tempMcpSettingsBackupPath)) {
        throw new Error('sync.error.tempMcpSettingsFailed')
      }

      // 重命名临时文件为最终文件
      if (fs.existsSync(finalDbBackupPath)) {
        fs.unlinkSync(finalDbBackupPath)
      }

      if (fs.existsSync(finalAppSettingsBackupPath)) {
        fs.unlinkSync(finalAppSettingsBackupPath)
      }

      // 如果存在之前的 provider_models 备份目录，删除它
      if (fs.existsSync(finalProviderModelsBackupPath)) {
        this.removeDirectory(finalProviderModelsBackupPath)
      }

      if (fs.existsSync(finalMcpSettingsBackupPath)) {
        fs.unlinkSync(finalMcpSettingsBackupPath)
      }

      // 清理之前的模型配置文件备份
      if (fs.existsSync(finalModelConfigBackupPath)) {
        fs.unlinkSync(finalModelConfigBackupPath)
      }

      // 确保临时文件存在后再执行重命名
      fs.renameSync(tempDbBackupPath, finalDbBackupPath)
      fs.renameSync(tempAppSettingsBackupPath, finalAppSettingsBackupPath)
      fs.renameSync(tempMcpSettingsBackupPath, finalMcpSettingsBackupPath)

      // 重命名模型配置文件
      if (fs.existsSync(tempModelConfigBackupPath)) {
        fs.renameSync(tempModelConfigBackupPath, finalModelConfigBackupPath)
      }

      // 重命名 provider_models 临时目录
      if (fs.existsSync(tempProviderModelsBackupPath)) {
        fs.renameSync(tempProviderModelsBackupPath, finalProviderModelsBackupPath)
      }

      // 更新最后备份时间
      const now = Date.now()
      this.configPresenter.setLastSyncTime(now)

      // 发送备份完成事件
      eventBus.send(SYNC_EVENTS.BACKUP_COMPLETED, SendTarget.ALL_WINDOWS, now)
    } catch (error: unknown) {
      console.error('备份过程出错:', error)
      eventBus.send(
        SYNC_EVENTS.BACKUP_ERROR,
        SendTarget.ALL_WINDOWS,
        (error as Error).message || 'sync.error.unknown'
      )
      throw error
    } finally {
      // 标记备份结束
      this.isBackingUp = false
    }
  }

  /**
   * 监听数据变更事件，触发备份计划
   */
  private listenForChanges(): void {
    // 监听多种数据变更事件，使用防抖逻辑触发备份
    const scheduleBackup = () => {
      // 如果同步功能未启用，不执行备份
      if (!this.configPresenter.getSyncEnabled()) {
        return
      }

      // 清除现有定时器
      if (this.backupTimer) {
        clearTimeout(this.backupTimer)
      }

      // 设置新的定时器，延迟执行备份
      this.backupTimer = setTimeout(async () => {
        if (!this.isBackingUp) {
          try {
            await this.performBackup()
          } catch (error) {
            console.error('自动备份失败:', error)
          }
        }
      }, this.BACKUP_DELAY)
    }

    // 监听消息相关变更
    eventBus.on(SYNC_EVENTS.DATA_CHANGED, scheduleBackup)
  }

  /**
   * 辅助方法：复制目录
   */
  private copyDirectory(source: string, target: string): void {
    // 确保目标目录存在
    if (!fs.existsSync(target)) {
      fs.mkdirSync(target, { recursive: true })
    }

    // 读取源目录
    const entries = fs.readdirSync(source, { withFileTypes: true })

    // 复制每个文件和子目录
    for (const entry of entries) {
      const srcPath = path.join(source, entry.name)
      const destPath = path.join(target, entry.name)

      if (entry.isDirectory()) {
        // 递归复制子目录
        this.copyDirectory(srcPath, destPath)
      } else {
        // 复制文件
        fs.copyFileSync(srcPath, destPath)
      }
    }
  }

  /**
   * 辅助方法：删除目录及其内容
   */
  private removeDirectory(dirPath: string): void {
    if (fs.existsSync(dirPath)) {
      const entries = fs.readdirSync(dirPath, { withFileTypes: true })

      for (const entry of entries) {
        const fullPath = path.join(dirPath, entry.name)
        if (entry.isDirectory()) {
          this.removeDirectory(fullPath)
        } else {
          fs.unlinkSync(fullPath)
        }
      }

      fs.rmdirSync(dirPath)
    }
  }
}
