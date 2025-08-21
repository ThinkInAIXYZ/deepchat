import fs from 'node:fs'
import path from 'node:path'

import {
  IConfigPresenter,
  IKnowledgePresenter,
  BuiltinKnowledgeConfig,
  MCPServerConfig,
  KnowledgeFileMessage,
  QueryResult,
  KnowledgeFileResult
} from '@shared/presenter'
import { FileValidationResult } from '../filePresenter/FileValidationService'
import { eventBus } from '@/eventbus'
import { MCP_EVENTS } from '@/events'
import { DuckDBPresenter } from './database/duckdbPresenter'
import { KnowledgeStorePresenter } from './knowledgeStorePresenter'
import { KnowledgeTaskPresenter } from './knowledgeTaskPresenter'
import { getMetric } from '@/utils/vector'
import { presenter } from '..'
import { IFilePresenter } from '@shared/presenter'
import { DIALOG_WARN } from '@shared/dialog'
import {
  RecursiveCharacterTextSplitter,
  SupportedTextSplitterLanguages,
  type SupportedTextSplitterLanguage
} from '@/lib/textsplitters'

export class KnowledgePresenter implements IKnowledgePresenter {
  /**
   * 知识库存储目录
   */
  private readonly storageDir

  private readonly configP: IConfigPresenter

  /**
   * File presenter for validation operations
   */
  private readonly filePresenter: IFilePresenter

  /**
   * 全局任务调度器
   */
  private readonly taskP: KnowledgeTaskPresenter

  /**
   * 缓存 RAG 应用实例
   */
  private readonly storePresenterCache: Map<string, KnowledgeStorePresenter>

  constructor(configP: IConfigPresenter, dbDir: string, filePresenter: IFilePresenter) {
    console.log('[RAG] Initializing Built-in Knowledge Presenter')
    this.configP = configP
    this.filePresenter = filePresenter
    this.storageDir = path.join(dbDir, 'KnowledgeBase')
    this.taskP = new KnowledgeTaskPresenter()
    this.storePresenterCache = new Map()

    this.initStorageDir()
    this.setupEventBus()
  }

  /**
   * 初始化知识库存储目录
   */
  private initStorageDir = (): void => {
    if (!fs.existsSync(this.storageDir)) {
      fs.mkdirSync(this.storageDir, { recursive: true })
    }
  }

  private setupEventBus = (): void => {
    // 监听知识库相关事件
    eventBus.on(MCP_EVENTS.CONFIG_CHANGED, async (payload) => {
      try {
        if (
          !payload ||
          typeof payload !== 'object' ||
          !payload.mcpServers ||
          typeof payload.mcpServers !== 'object'
        ) {
          console.warn('[RAG] Invalid payload for CONFIG_CHANGED event:', payload)
          return
        }
        const mcpServers = payload.mcpServers
        const builtinConfig = mcpServers['builtinKnowledge'] as MCPServerConfig
        if (builtinConfig?.env && Array.isArray(builtinConfig.env.configs)) {
          const configs = builtinConfig.env.configs as BuiltinKnowledgeConfig[]
          console.log('[RAG] Received builtinKnowledge config update:', configs)
          const diffs = this.configP.diffKnowledgeConfigs(configs)
          this.configP.setKnowledgeConfigs(configs)
          // 处理新增、删除和更新的配置
          if (diffs.deleted.length > 0) {
            diffs.deleted.forEach((config) => this.delete(config.id))
          }
          if (diffs.added.length > 0) {
            diffs.added.forEach((config) => {
              console.log(`[RAG] New knowledge config added: ${config.id}`)
              this.create(config)
            })
          }
          if (diffs.updated.length > 0) {
            diffs.updated.forEach((config) => {
              console.log(`[RAG] Knowledge config updated: ${config.id}`)
              this.update(config)
            })
          }
          console.log('[RAG] Updated knowledge configs:', configs)
        } else {
          console.warn('[RAG] builtinKnowledge config missing or invalid:', builtinConfig)
        }
      } catch (err) {
        console.error('[RAG] Error handling CONFIG_CHANGED event:', err)
      }
    })
  }

  /**
   * Supported operating systems
   */
  private static readonly SUPPORTED_OS = [
    'win32-x64',
    'linux-x64',
    'linux-arm64',
    'darwin-arm64',
    'darwin-x64'
  ]

  isSupported = async (): Promise<boolean> => {
    const os = `${process.platform}-${process.arch}`
    return KnowledgePresenter.SUPPORTED_OS.includes(os)
  }

  /**
   * Create a knowledge base (initialize RAG application)
   * @param config Knowledge base configuration
   */
  create = async (config: BuiltinKnowledgeConfig): Promise<void> => {
    await this.createStorePresenter(config)
  }

  /**
   * Update a knowledge base configuration
   * @param config Knowledge base configuration
   */
  update = async (config: BuiltinKnowledgeConfig): Promise<void> => {
    if (config.enabled) {
      // 如果启用且缓存中存在，则更新配置
      const rag = this.getStorePresenter(config.id)
      if (rag) {
        rag.updateConfig(config)
      } else {
        // 如果缓存中没有，则创建新的 RAG 实例
        await this.createStorePresenter(config)
      }
    } else {
      // 如果禁用且缓存中存在，关闭实例
      this.closeStorePresenterIfExists(config.id)
    }
  }

  /**
   * Delete a knowledge base (remove local storage)
   * @param id Knowledge base ID
   */
  delete = async (id: string): Promise<void> => {
    if (this.storePresenterCache.has(id)) {
      await this.getStorePresenter(id)?.destroy()
      this.storePresenterCache.delete(id)
    } else {
      const dbPath = path.join(this.storageDir, id)
      if (fs.existsSync(dbPath)) {
        fs.rmSync(dbPath, { recursive: true })
      }
      if (fs.existsSync(dbPath + '.wal')) {
        fs.rmSync(dbPath + '.wal', { recursive: true })
      }
    }
  }

  /**
   * 创建 RAG 应用实例
   * @param params BuiltinKnowledgeConfig
   * @returns KnowledgeStorePresenter
   */
  private createStorePresenter = async (
    config: BuiltinKnowledgeConfig
  ): Promise<KnowledgeStorePresenter> => {
    let rag: KnowledgeStorePresenter
    const db = await this.getVectorDatabasePresenter(
      config.id,
      config.dimensions,
      config.normalized
    )
    try {
      rag = new KnowledgeStorePresenter(db, config, this.taskP)
    } catch (e) {
      throw new Error(`Failed to create storePresenter: ${e}`)
    }

    this.storePresenterCache.set(config.id, rag)
    return rag
  }

  /**
   * 获取知识库实例
   * @param id 知识库 ID
   * @returns 知识库实例
   */
  private getStorePresenter = (id: string): KnowledgeStorePresenter | null => {
    if (this.storePresenterCache.has(id)) {
      return this.storePresenterCache.get(id) as KnowledgeStorePresenter
    }
    return null
  }

  /**
   * 获取 RAG 应用实例
   * @param id 知识库 ID
   */
  private getOrCreateStorePresenter = async (id: string): Promise<KnowledgeStorePresenter> => {
    // 缓存命中直接返回
    if (this.storePresenterCache.has(id)) {
      return this.storePresenterCache.get(id) as KnowledgeStorePresenter
    }
    // 获取配置
    const configs = this.configP.getKnowledgeConfigs()
    const config = configs.find((cfg) => cfg.id === id)
    if (!config) {
      throw new Error(`Knowledge config not found for id: ${id}`)
    }
    // DuckDB 存储
    const db = await this.getVectorDatabasePresenter(id, config.dimensions, config.normalized)
    // 创建 RAG 应用实例
    const rag = new KnowledgeStorePresenter(db, config, this.taskP)
    this.storePresenterCache.set(id, rag)
    return rag
  }

  /**
   * 关闭 RAG 应用实例
   * @param id 知识库 ID
   * @returns void
   */
  private closeStorePresenterIfExists = async (id: string): Promise<void> => {
    const rag = this.getStorePresenter(id)
    if (rag) {
      await rag.close()
      this.storePresenterCache.delete(id)
    }
  }

  /**
   * 获取向量数据库实例
   * @param id 知识库 ID
   * @param dimensions 向量维度
   * @returns
   */
  private getVectorDatabasePresenter = async (
    id: string,
    dimensions: number,
    normalized: boolean
  ): Promise<DuckDBPresenter> => {
    const dbPath = path.join(this.storageDir, id)
    if (fs.existsSync(dbPath)) {
      const db = new DuckDBPresenter(dbPath)
      await db.open()
      return db
    }
    // 如果数据库不存在，则初始化
    const db = new DuckDBPresenter(dbPath)
    await db.initialize(dimensions, {
      metric: getMetric(normalized)
    })
    return db
  }

  async addFile(id: string, filePath: string): Promise<KnowledgeFileResult> {
    try {
      const rag = await this.getOrCreateStorePresenter(id)
      return await rag.addFile(filePath)
    } catch (err) {
      return {
        error: `添加文件失败: ${err instanceof Error ? err.message : String(err)}`
      }
    }
  }

  async deleteFile(id: string, fileId: string): Promise<void> {
    const rag = await this.getOrCreateStorePresenter(id)
    await rag.deleteFile(fileId)
  }

  async reAddFile(id: string, fileId: string): Promise<KnowledgeFileResult> {
    try {
      const rag = await this.getOrCreateStorePresenter(id)
      return await rag.reAddFile(fileId)
    } catch (err) {
      return {
        error: `重新添加文件失败: ${err instanceof Error ? err.message : String(err)}`
      }
    }
  }

  async queryFile(id: string, fileId: string): Promise<KnowledgeFileMessage | null> {
    const rag = await this.getOrCreateStorePresenter(id)
    return await rag.queryFile(fileId)
  }

  async listFiles(id: string): Promise<KnowledgeFileMessage[]> {
    const rag = await this.getOrCreateStorePresenter(id)
    return await rag.listFiles()
  }

  async closeAll(): Promise<void> {
    this.storePresenterCache.forEach((rag) => {
      rag.close()
    })
    this.storePresenterCache.clear()
  }

  /**
   * @returns return true if user confirmed to destroy knowledge, otherwise false
   */
  async beforeDestroy(): Promise<boolean> {
    const status = this.taskP.getStatus()
    if (status.totalTasks === 0) {
      return true
    }
    const choice = await presenter.dialogPresenter.showDialog({
      title: 'settings.knowledgeBase.dialog.beforequit.title',
      description: 'settings.knowledgeBase.dialog.beforequit.description',
      icon: DIALOG_WARN,
      buttons: [
        { key: 'cancel', label: 'settings.knowledgeBase.dialog.beforequit.cancel' },
        { key: 'confirm', label: 'settings.knowledgeBase.dialog.beforequit.confirm', default: true }
      ],
      timeout: 10000,
      i18n: true
    })
    return choice === 'confirm'
  }

  async destroy(): Promise<void> {
    await this.closeAll()
  }

  async similarityQuery(id: string, key: string): Promise<QueryResult[]> {
    const rag = await this.getOrCreateStorePresenter(id)
    return await rag.similarityQuery(key)
  }

  /**
   * 获取知识库任务队列状态
   */
  async getTaskQueueStatus() {
    return this.taskP.getStatus()
  }

  async pauseAllRunningTasks(id: string): Promise<void> {
    const rag = await this.getOrCreateStorePresenter(id)
    await rag.pauseAllRunningTasks()
  }

  async resumeAllPausedTasks(id: string): Promise<void> {
    const rag = await this.getOrCreateStorePresenter(id)
    await rag.resumeAllPausedTasks()
  }

  async getSupportedLanguages(): Promise<string[]> {
    return [...SupportedTextSplitterLanguages]
  }

  separators: string[] = ['\n\n', '\n', ' ', '']

  async getSeparatorsForLanguage(language: string): Promise<string[]> {
    try {
      return RecursiveCharacterTextSplitter.getSeparatorsForLanguage(
        language as SupportedTextSplitterLanguage
      )
    } catch {
      return this.separators
    }
  }

  /**
   * Validates if a file is supported for knowledge base processing
   * @param filePath Path to the file to validate
   * @returns FileValidationResult with validation details
   */
  async validateFile(filePath: string): Promise<FileValidationResult> {
    try {
      console.log(`[RAG] Validating file for knowledge base: ${filePath}`)
      const result = await this.filePresenter.validateFileForKnowledgeBase(filePath)

      if (!result.isSupported) {
        console.warn(`[RAG] File validation failed for ${filePath}: ${result.error}`)
      } else {
        console.log(
          `[RAG] File validation successful for ${filePath}, MIME type: ${result.mimeType}`
        )
      }

      return result
    } catch (error) {
      const errorMessage = `File validation error: ${error instanceof Error ? error.message : 'Unknown error'}`
      console.error(`[RAG] ${errorMessage}`, error)

      return {
        isSupported: false,
        error: errorMessage,
        suggestedExtensions: await this.getSupportedFileExtensions()
      }
    }
  }

  /**
   * Gets all supported file extensions for knowledge base processing
   * @returns Array of supported file extensions (without dots)
   */
  async getSupportedFileExtensions(): Promise<string[]> {
    try {
      console.log('[RAG] Getting supported file extensions')
      const extensions = this.filePresenter.getSupportedExtensions()
      console.log(`[RAG] Retrieved ${extensions.length} supported extensions`)
      return extensions
    } catch (error) {
      const errorMessage = `Error getting supported extensions: ${error instanceof Error ? error.message : 'Unknown error'}`
      console.error(`[RAG] ${errorMessage}`, error)

      // Return fallback extensions if service fails
      const fallbackExtensions = [
        'txt',
        'md',
        'markdown',
        'pdf',
        'docx',
        'pptx',
        'xlsx',
        'csv',
        'json',
        'yaml',
        'yml',
        'xml',
        'js',
        'ts',
        'py',
        'java',
        'cpp',
        'c',
        'h',
        'css',
        'html'
      ].sort()

      console.warn(`[RAG] Using fallback extensions: ${fallbackExtensions.join(', ')}`)
      return fallbackExtensions
    }
  }
}
