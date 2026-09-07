import logger from '@shared/logger'
import fs from 'node:fs'
import path from 'node:path'

import type {
  BuiltinKnowledgeConfig,
  FileValidationResult,
  KnowledgeFileMessage,
  KnowledgeFileResult,
  KnowledgeServicePort,
  QueryResult
} from '@shared/types/knowledge'
import { KnowledgeDatabase } from './database/knowledgeDatabase'
import { KnowledgeBase } from './knowledgeBase'
import { KnowledgeTaskQueue } from './taskQueue'
import { getMetric } from '@/utils/vector'
import { DIALOG_WARN } from '@shared/dialog'
import {
  RecursiveCharacterTextSplitter,
  SupportedTextSplitterLanguages,
  type SupportedTextSplitterLanguage
} from '@/lib/textsplitters'
import { isBuiltinKnowledgeSupported } from './support'
import type { KnowledgeEventPublisher, KnowledgeServiceDeps } from './ports'

function diffKnowledgeConfigs(
  previous: BuiltinKnowledgeConfig[],
  current: BuiltinKnowledgeConfig[]
) {
  const previousById = new Map(previous.map((config) => [config.id, config]))
  const currentIds = new Set(current.map((config) => config.id))
  return {
    added: current.filter((config) => !previousById.has(config.id)),
    deleted: previous.filter((config) => !currentIds.has(config.id)),
    updated: current.filter((config) => {
      const oldConfig = previousById.get(config.id)
      return oldConfig !== undefined && JSON.stringify(config) !== JSON.stringify(oldConfig)
    })
  }
}

export class KnowledgeService implements KnowledgeServicePort {
  /**
   * 知识库存储目录
   */
  private readonly storageDir

  private readonly configPort: KnowledgeServiceDeps['config']

  /**
   * File presenter for validation operations
   */
  private readonly filePort: KnowledgeServiceDeps['files']
  private readonly dialogPort: KnowledgeServiceDeps['dialog']
  private readonly embeddingPort: KnowledgeServiceDeps['embeddings']
  private readonly events: KnowledgeEventPublisher

  /**
   * 全局任务调度器
   */
  private readonly taskQueue: KnowledgeTaskQueue

  /**
   * 缓存 RAG 应用实例
   */
  private readonly knowledgeBases: Map<string, KnowledgeBase>
  private readonly knowledgeBaseInitializations: Map<string, Promise<KnowledgeBase>>

  private knowledgeConfigSnapshot: BuiltinKnowledgeConfig[]

  constructor(deps: KnowledgeServiceDeps) {
    logger.info('[RAG] Initializing Built-in Knowledge Service')
    this.configPort = deps.config
    this.filePort = deps.files
    this.dialogPort = deps.dialog
    this.embeddingPort = deps.embeddings
    this.events = deps.events
    this.storageDir = path.join(deps.storageRoot, 'KnowledgeBase')
    this.taskQueue = new KnowledgeTaskQueue()
    this.knowledgeBases = new Map()
    this.knowledgeBaseInitializations = new Map()
    this.knowledgeConfigSnapshot = this.configPort.getKnowledgeConfigs() ?? []

    this.initStorageDir()
  }

  /**
   * 初始化知识库存储目录
   */
  private initStorageDir = (): void => {
    if (!fs.existsSync(this.storageDir)) {
      fs.mkdirSync(this.storageDir, { recursive: true })
    }
  }

  async syncConfigChanges(): Promise<void> {
    const configs = this.configPort.getKnowledgeConfigs() ?? []
    const diffs = diffKnowledgeConfigs(this.knowledgeConfigSnapshot, configs)
    this.knowledgeConfigSnapshot = configs

    if (diffs.deleted.length > 0) {
      await Promise.all(diffs.deleted.map((config) => this.delete(config.id)))
    }

    if (diffs.added.length > 0) {
      diffs.added.forEach((config) => {
        logger.info(`[RAG] New knowledge config added: ${config.id}`)
      })
    }

    if (diffs.updated.length > 0) {
      await Promise.all(
        diffs.updated.map((config) => {
          logger.info(`[RAG] Knowledge config updated: ${config.id}`)
          return this.update(config)
        })
      )
    }
  }

  isSupported = async (): Promise<boolean> => {
    return isBuiltinKnowledgeSupported()
  }

  /**
   * Create a knowledge base (initialize RAG application)
   * @param config Knowledge base configuration
   */
  create = async (config: BuiltinKnowledgeConfig): Promise<void> => {
    await this.createKnowledgeBase(config)
  }

  /**
   * Update a knowledge base configuration
   * @param config Knowledge base configuration
   */
  update = async (config: BuiltinKnowledgeConfig): Promise<void> => {
    if (config.enabled) {
      // 如果启用且缓存中存在，则更新配置
      const rag = this.getKnowledgeBase(config.id)
      if (rag) {
        rag.updateConfig(config)
        return
      }

      const initializingRag = await this.knowledgeBaseInitializations
        .get(config.id)
        ?.catch(() => undefined)
      if (initializingRag) {
        initializingRag.updateConfig(config)
      }
    } else {
      // 如果禁用且缓存中存在，关闭实例
      await this.closeKnowledgeBaseIfExists(config.id)
    }
  }

  /**
   * Delete a knowledge base (remove local storage)
   * @param id Knowledge base ID
   */
  delete = async (id: string): Promise<void> => {
    try {
      const initializingRag = await this.knowledgeBaseInitializations
        .get(id)
        ?.catch(() => undefined)
      this.knowledgeBaseInitializations.delete(id)
      const cachedRag = this.getKnowledgeBase(id)
      const rag = cachedRag ?? initializingRag

      if (rag) {
        await rag.destroy()
        return
      }

      const dbPath = path.join(this.storageDir, id)
      if (fs.existsSync(dbPath)) {
        fs.rmSync(dbPath, { recursive: true })
      }
      if (fs.existsSync(dbPath + '.wal')) {
        fs.rmSync(dbPath + '.wal', { recursive: true })
      }
    } finally {
      this.knowledgeBases.delete(id)
      this.knowledgeBaseInitializations.delete(id)
    }
  }

  /**
   * 创建 RAG 应用实例
   * @param params BuiltinKnowledgeConfig
   * @returns KnowledgeBase
   */
  private createKnowledgeBase = async (config: BuiltinKnowledgeConfig): Promise<KnowledgeBase> => {
    const cachedRag = this.getKnowledgeBase(config.id)
    if (cachedRag) {
      cachedRag.updateConfig(config)
      return cachedRag
    }

    const initializingRag = this.knowledgeBaseInitializations.get(config.id)
    if (initializingRag) {
      const rag = await initializingRag
      rag.updateConfig(config)
      return rag
    }

    const initTask = (async () => {
      const db = await this.openKnowledgeDatabase(config.id, config.dimensions, config.normalized)
      try {
        const rag = new KnowledgeBase(
          db,
          config,
          this.taskQueue,
          this.filePort,
          this.embeddingPort,
          this.events
        )
        this.knowledgeBases.set(config.id, rag)
        return rag
      } catch (e) {
        try {
          await db.close()
        } catch (closeError) {
          console.error(
            '[RAG] Failed to close vector database after knowledge base error:',
            closeError
          )
        }
        throw e
      }
    })()

    this.knowledgeBaseInitializations.set(config.id, initTask)

    try {
      return await initTask
    } finally {
      if (this.knowledgeBaseInitializations.get(config.id) === initTask) {
        this.knowledgeBaseInitializations.delete(config.id)
      }
    }
  }

  /**
   * 获取知识库实例
   * @param id 知识库 ID
   * @returns 知识库实例
   */
  private getKnowledgeBase = (id: string): KnowledgeBase | null => {
    if (this.knowledgeBases.has(id)) {
      return this.knowledgeBases.get(id) as KnowledgeBase
    }
    return null
  }

  /**
   * 获取 RAG 应用实例
   * @param id 知识库 ID
   */
  private getOrCreateKnowledgeBase = async (id: string): Promise<KnowledgeBase> => {
    // 缓存命中直接返回
    if (this.knowledgeBases.has(id)) {
      return this.knowledgeBases.get(id) as KnowledgeBase
    }
    // 获取配置
    const configs = this.configPort.getKnowledgeConfigs()
    const config = configs.find((cfg) => cfg.id === id)
    if (!config) {
      throw new Error(`Knowledge config not found for id: ${id}`)
    }

    return await this.createKnowledgeBase(config)
  }

  /**
   * 关闭 RAG 应用实例
   * @param id 知识库 ID
   * @returns void
   */
  private closeKnowledgeBaseIfExists = async (id: string): Promise<void> => {
    const initializingRag = await this.knowledgeBaseInitializations.get(id)?.catch(() => undefined)
    const rag = this.getKnowledgeBase(id) ?? initializingRag
    try {
      if (rag) {
        await rag.close()
      }
    } finally {
      this.knowledgeBases.delete(id)
    }
  }

  /**
   * 获取向量数据库实例
   * @param id 知识库 ID
   * @param dimensions 向量维度
   * @returns
   */
  private openKnowledgeDatabase = async (
    id: string,
    dimensions: number,
    normalized: boolean
  ): Promise<KnowledgeDatabase> => {
    const dbPath = path.join(this.storageDir, id)
    if (fs.existsSync(dbPath)) {
      const db = new KnowledgeDatabase(dbPath)
      await db.open()
      return db
    }
    // 如果数据库不存在，则初始化
    const db = new KnowledgeDatabase(dbPath)
    await db.initialize(dimensions, {
      metric: getMetric(normalized)
    })
    return db
  }

  async addFile(id: string, filePath: string): Promise<KnowledgeFileResult> {
    try {
      const rag = await this.getOrCreateKnowledgeBase(id)
      return await rag.addFile(filePath)
    } catch (err) {
      return {
        error: `添加文件失败: ${err instanceof Error ? err.message : String(err)}`
      }
    }
  }

  async deleteFile(id: string, fileId: string): Promise<void> {
    const rag = await this.getOrCreateKnowledgeBase(id)
    await rag.deleteFile(fileId)
  }

  async reAddFile(id: string, fileId: string): Promise<KnowledgeFileResult> {
    try {
      const rag = await this.getOrCreateKnowledgeBase(id)
      return await rag.reAddFile(fileId)
    } catch (err) {
      return {
        error: `重新添加文件失败: ${err instanceof Error ? err.message : String(err)}`
      }
    }
  }

  async queryFile(id: string, fileId: string): Promise<KnowledgeFileMessage | null> {
    const rag = await this.getOrCreateKnowledgeBase(id)
    return await rag.queryFile(fileId)
  }

  async listFiles(id: string): Promise<KnowledgeFileMessage[]> {
    const rag = await this.getOrCreateKnowledgeBase(id)
    return await rag.listFiles()
  }

  async closeAll(): Promise<void> {
    const initializingRags = await Promise.allSettled(this.knowledgeBaseInitializations.values())
    const stores = new Set<KnowledgeBase>(this.knowledgeBases.values())

    for (const result of initializingRags) {
      if (result.status === 'fulfilled') {
        stores.add(result.value)
      }
    }

    await Promise.all(Array.from(stores).map((rag) => rag.close()))
    this.knowledgeBases.clear()
    this.knowledgeBaseInitializations.clear()
  }

  /**
   * @returns return true if user confirmed to destroy knowledge, otherwise false
   */
  async confirmShutdown(): Promise<boolean> {
    const status = this.taskQueue.getStatus()
    if (status.totalTasks === 0) {
      return true
    }
    const choice = await this.dialogPort.showDialog({
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
    this.taskQueue.destroy()
  }

  async similarityQuery(id: string, key: string): Promise<QueryResult[]> {
    const rag = await this.getOrCreateKnowledgeBase(id)
    return await rag.similarityQuery(key)
  }

  /**
   * 获取知识库任务队列状态
   */
  async getTaskQueueStatus() {
    return this.taskQueue.getStatus()
  }

  async pauseAllRunningTasks(id: string): Promise<void> {
    const rag = await this.getOrCreateKnowledgeBase(id)
    await rag.pauseAllRunningTasks()
  }

  async resumeAllPausedTasks(id: string): Promise<void> {
    const rag = await this.getOrCreateKnowledgeBase(id)
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
      logger.info(`[RAG] Validating file for knowledge base: ${filePath}`)
      const result = await this.filePort.validateFileForKnowledgeBase(filePath)

      if (!result.isSupported) {
        console.warn(`[RAG] File validation failed for ${filePath}: ${result.error}`)
      } else {
        logger.info(
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
      logger.info('[RAG] Getting supported file extensions')
      const extensions = this.filePort.getSupportedExtensions()
      logger.info(`[RAG] Retrieved ${extensions.length} supported extensions`)
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
