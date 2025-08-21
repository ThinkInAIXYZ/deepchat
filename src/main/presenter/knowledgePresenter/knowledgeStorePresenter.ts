import fs from 'node:fs'
import path from 'node:path'

import {
  BuiltinKnowledgeConfig,
  IVectorDatabasePresenter,
  KnowledgeFileMessage,
  QueryResult,
  IKnowledgeTaskPresenter,
  KnowledgeFileResult,
  KnowledgeChunkMessage
} from '@shared/presenter'
import { presenter } from '@/presenter'
import { nanoid } from 'nanoid'
import { RecursiveCharacterTextSplitter } from '@/lib/textsplitters'
import { sanitizeText } from '@/utils/strings'
import { getMetric, normalizeDistance } from '@/utils/vector'
import { eventBus, SendTarget } from '@/eventbus'
import { RAG_EVENTS } from '@/events'

export class KnowledgeStorePresenter {
  private readonly vectorP: IVectorDatabasePresenter
  private config: BuiltinKnowledgeConfig
  private taskP: IKnowledgeTaskPresenter
  // 文件处理进度跟踪器
  private fileProgressMap = new Map<string, { completed: number; error: number; total: number }>()

  constructor(
    vectorP: IVectorDatabasePresenter,
    config: BuiltinKnowledgeConfig,
    taskScheduler: IKnowledgeTaskPresenter
  ) {
    this.vectorP = vectorP
    this.config = config
    this.taskP = taskScheduler
  }

  /**
   * 获取vector数据库presenter
   */
  getVectorPresenter(): IVectorDatabasePresenter {
    return this.vectorP
  }

  updateConfig(config: BuiltinKnowledgeConfig): void {
    this.config = config
  }

  async addFile(filePath: string, fileId?: string): Promise<KnowledgeFileResult> {
    try {
      if (fs.existsSync(filePath) === false) {
        throw new Error('文件不存在，请检查路径是否正确')
      }
      // 如果文件id为空，但filePath在数据库中已存在，说明是重复添加，跳过
      const existingFile = await this.vectorP.queryFiles({
        path: filePath
      })
      if (!fileId && existingFile[0]) {
        // 直接返回文件信息，前端需要过滤
        return { data: existingFile[0] }
      }

      const mimeType = await presenter.filePresenter.getMimeType(filePath)
      // 先将文件基本信息插入数据库
      const fileMessage = {
        id: fileId ?? nanoid(),
        name: path.basename(filePath) || 'unknown',
        path: filePath,
        mimeType,
        status: 'processing',
        uploadedAt: new Date().getTime(),
        metadata: {
          size: -1, // 初始大小未知
          totalChunks: 0
        }
      } as KnowledgeFileMessage

      fileId
        ? await this.vectorP.updateFile(fileMessage)
        : await this.vectorP.insertFile(fileMessage)

      this.processFileAsync(fileMessage)

      return { data: fileMessage }
    } catch (error) {
      console.error(`[RAG] Error adding file ${filePath}:`, error)
      // 向上抛出错误，以便调用者可以处理
      throw error
    }
  }

  // 异步处理文件读取和分片（不参与taskPresenter队列）
  private async processFileAsync(fileMessage: KnowledgeFileMessage): Promise<void> {
    try {
      // 1. 读取文件和获取基本信息
      const fileInfo = await presenter.filePresenter.prepareFileCompletely(
        fileMessage.path,
        fileMessage.mimeType,
        'origin'
      )

      // 2. 更新文件基本信息
      fileMessage.name = fileInfo.name
      fileMessage.metadata = {
        size: fileInfo.metadata.fileSize,
        totalChunks: 0
      }

      // 检查文件内容
      if (fileInfo.content === undefined || fileInfo.content.length === 0) {
        fileMessage.status = 'error'
        fileMessage.metadata.errorReason =
          '无法读取文件或文件内容为空，请检查文件是否损坏或格式是否受支持'
        await this.vectorP.updateFile(fileMessage)
        eventBus.sendToRenderer(RAG_EVENTS.FILE_UPDATED, SendTarget.ALL_WINDOWS, fileMessage)
        return
      }

      // 3. 分片
      const chunker = new RecursiveCharacterTextSplitter({
        chunkSize: this.config.chunkSize,
        chunkOverlap: this.config.chunkOverlap,
        separators: this.config.separators
      })
      const chunks = await chunker.splitText(sanitizeText(fileInfo.content))

      // 4. 更新文件信息中的分片数量
      fileMessage.metadata.totalChunks = chunks.length
      await this.vectorP.updateFile(fileMessage)

      // 5. 发送文件更新事件
      eventBus.sendToRenderer(RAG_EVENTS.FILE_UPDATED, SendTarget.ALL_WINDOWS, fileMessage)

      // 6. 创建chunk记录
      const chunkMessages = chunks.map((content, index) => ({
        id: fileMessage.id + '_' + index,
        fileId: fileMessage.id,
        chunkIndex: index,
        content,
        status: 'processing'
      })) as KnowledgeChunkMessage[]

      await this.vectorP.insertChunks(chunkMessages)

      // 7. 初始化文件进度跟踪
      this.fileProgressMap.set(fileMessage.id, { completed: 0, error: 0, total: chunks.length })

      // 8. 为每个chunk创建独立的处理任务，加入taskPresenter队列
      for (const chunkMsg of chunkMessages) {
        const chunkTask = {
          id: `chunk_${chunkMsg.id}`,
          payload: {
            knowledgeBaseId: this.config.id,
            fileId: fileMessage.id,
            chunkId: chunkMsg.id,
            taskType: 'chunk_processing',
            metadata: {
              content: chunkMsg.content,
              chunkIndex: chunkMsg.chunkIndex
            }
          },
          run: async ({ signal }) => this.processChunkTask(chunkMsg, signal),
          onSuccess: () => this.handleChunkCompletion(chunkMsg.id, fileMessage.id),
          onError: (error: Error) =>
            this.handleChunkError(chunkMsg.id, fileMessage.id, error.message),
          onTerminate: () => console.log(`[RAG] Chunk processing terminated for ${chunkMsg.id}`)
        }

        this.taskP.addTask(chunkTask)
      }
    } catch (error) {
      console.error(`[RAG] Error in processFileAsync:`, error)
      await this.handleFileProcessingError(fileMessage.id, (error as Error).message)
    }
  }

  // 新增：处理单个chunk任务
  private async processChunkTask(
    chunkMsg: KnowledgeChunkMessage,
    signal: AbortSignal
  ): Promise<void> {
    try {
      // 生成向量
      const vectors = await presenter.llmproviderPresenter.getEmbeddings(
        this.config.embedding.providerId,
        this.config.embedding.modelId,
        [chunkMsg.content]
      )

      if (!vectors || vectors.length === 0) {
        throw new Error('Failed to generate embeddings')
      }

      if (signal.aborted) {
        throw new DOMException('Aborted', 'AbortError')
      }

      // 事务化更新chunk和向量
      await this.vectorP.updateChunkStatus(chunkMsg.id, 'completed')
      await this.vectorP.insertVector({
        vector: vectors[0],
        fileId: chunkMsg.fileId,
        chunkId: chunkMsg.id
      })
    } catch (error) {
      if (error instanceof DOMException && error.name === 'AbortError') {
        throw error
      }
      console.error(`[RAG] Error processing chunk ${chunkMsg.id}:`, error)
      throw error
    }
  }

  // 处理chunk完成事件（线程安全的进度管理）
  private async handleChunkCompletion(chunkId: string, fileId: string): Promise<void> {
    const progress = this.fileProgressMap.get(fileId)
    if (!progress) {
      console.warn(`[RAG] No progress tracker found for file ${fileId}`)
      return
    }

    await this.vectorP.updateChunkStatus(chunkId, 'completed')
    progress.completed++

    // 更新文件进度
    eventBus.sendToRenderer(RAG_EVENTS.FILE_PROGRESS, SendTarget.ALL_WINDOWS, {
      fileId,
      completed: progress.completed,
      error: progress.error,
      total: progress.total
    })

    // 检查是否所有分片都完成了
    if (progress.completed + progress.error === progress.total) {
      await this.onFileFinish(fileId)
      // 清理进度跟踪器
      this.fileProgressMap.delete(fileId)
    }
  }

  private async handleChunkError(
    chunkId: string,
    fileId: string,
    errorMessage: string
  ): Promise<void> {
    const progress = this.fileProgressMap.get(fileId)
    if (!progress) {
      console.warn(`[RAG] No progress tracker found for file ${fileId}`)
      return
    }

    await this.vectorP.updateChunkStatus(chunkId, 'error', errorMessage)
    progress.error++

    // 更新文件进度
    eventBus.sendToRenderer(RAG_EVENTS.FILE_PROGRESS, SendTarget.ALL_WINDOWS, {
      fileId,
      completed: progress.completed,
      error: progress.error,
      total: progress.total
    })

    // 检查是否所有分片都完成了
    if (progress.completed + progress.error === progress.total) {
      await this.onFileFinish(fileId)
      // 清理进度跟踪器
      this.fileProgressMap.delete(fileId)
    }
  }

  // 文件处理完成回调
  private async onFileFinish(fileId: string): Promise<void> {
    try {
      // TODO 分片错误数量
      const fileMessage = await this.vectorP.queryFile(fileId)
      if (fileMessage) {
        fileMessage.status = 'completed'
        await this.vectorP.updateFile(fileMessage)
        eventBus.sendToRenderer(RAG_EVENTS.FILE_UPDATED, SendTarget.ALL_WINDOWS, fileMessage)
        console.log(`[RAG] File processing completed for ${fileId}`)
      }
    } catch (error) {
      console.error(`[RAG] Error in onFileFinish for ${fileId}:`, error)
    }
  }

  // 处理文件处理错误
  private async handleFileProcessingError(fileId: string, errorMessage: string): Promise<void> {
    try {
      const fileMessage = await this.vectorP.queryFile(fileId)
      if (fileMessage) {
        fileMessage.status = 'error'
        if (fileMessage.metadata) {
          fileMessage.metadata.errorReason = errorMessage
        }
        await this.vectorP.updateFile(fileMessage)
        eventBus.sendToRenderer(RAG_EVENTS.FILE_UPDATED, SendTarget.ALL_WINDOWS, fileMessage)
      }
    } catch (error) {
      console.error(`[RAG] Error handling file processing error for ${fileId}:`, error)
    }
  }

  async deleteFile(fileId: string): Promise<void> {
    try {
      // 1. 取消文件相关的所有待处理任务（使用便捷方法）
      this.taskP.cancelTasksByFile(fileId)

      // 2. 清理进度跟踪器
      this.fileProgressMap.delete(fileId)

      // 3. 删除文件
      await this.vectorP.deleteFile(fileId)
    } catch (err) {
      console.error(
        `[RAG] Failed to delete file ${fileId} in knowledge base ${this.config.id}:`,
        err
      )
      throw err
    }
  }

  async similarityQuery(key: string): Promise<QueryResult[]> {
    try {
      const embedding = await presenter.llmproviderPresenter.getEmbeddings(
        this.config.embedding.providerId,
        this.config.embedding.modelId,
        [sanitizeText(key)]
      )

      const queryResults = await this.vectorP.similarityQuery(embedding[0], {
        topK: this.config.fragmentsNumber,
        metric: getMetric(this.config.normalized)
      })
      queryResults.forEach((res) => {
        res.distance = normalizeDistance(res.distance, getMetric(this.config.normalized))
      })
      return queryResults
    } catch (error) {
      console.error(`[RAG] Error during similarity query:`, error)
      throw error
    }
  }
  async reAddFile(fileId: string): Promise<KnowledgeFileResult> {
    const file = await this.queryFile(fileId)
    if (file == null) {
      throw new Error('文件不存在，请重新打开知识库后再试')
    }
    await this.vectorP.deleteChunksByFile(fileId)
    await this.vectorP.deleteVectorsByFile(fileId)
    return this.addFile(file.path, fileId)
  }

  async queryFile(fileId: string): Promise<KnowledgeFileMessage | null> {
    try {
      return await this.vectorP.queryFile(fileId)
    } catch (err) {
      console.error(
        `[RAG] Failed to query file ${fileId} in knowledge base ${this.config.id}:`,
        err
      )
      throw err
    }
  }
  async listFiles(): Promise<KnowledgeFileMessage[]> {
    try {
      return await this.vectorP.listFiles()
    } catch (err) {
      console.error(`[RAG] Failed to list files in knowledge base ${this.config.id}:`, err)
      throw err
    }
  }

  async pauseAllRunningTasks(): Promise<void> {
    this.taskP.cancelTasksByKnowledgeBase(this.config.id)
    this.fileProgressMap.clear()
    await this.vectorP.pauseAllRunningTasks()
  }
  async resumeAllPausedTasks(): Promise<void> {
    // query all paused chunks
    const pausedChunkMessages = await this.vectorP.queryChunks({ status: 'paused' })
    // count by file id
    const fileIdCountMap = new Map<string, number>()
    pausedChunkMessages.forEach((chunk) => {
      const count = fileIdCountMap.get(chunk.fileId) || 0
      fileIdCountMap.set(chunk.fileId, count + 1)
    })
    // resume file progress cache
    fileIdCountMap.forEach((count, fileId) => {
      this.fileProgressMap.set(fileId, {
        completed: 0,
        error: 0,
        total: count
      })
    })
    await this.vectorP.resumeAllPausedTasks()
    for (const chunkMessage of pausedChunkMessages) {
      // re-add each paused chunk to the task queue
      const chunkTask = {
        id: `chunk_${chunkMessage.id}`,
        payload: {
          knowledgeBaseId: this.config.id,
          fileId: chunkMessage.fileId,
          chunkId: chunkMessage.id,
          taskType: 'chunk_processing',
          metadata: {
            content: chunkMessage.content,
            chunkIndex: chunkMessage.chunkIndex
          }
        },
        run: async ({ signal }) => this.processChunkTask(chunkMessage, signal),
        onSuccess: () => this.handleChunkCompletion(chunkMessage.id, chunkMessage.fileId),
        onError: (error: Error) =>
          this.handleChunkError(chunkMessage.id, chunkMessage.fileId, error.message),
        onTerminate: () => console.log(`[RAG] Chunk processing terminated for ${chunkMessage.id}`)
      }
      this.taskP.addTask(chunkTask)
    }
  }

  async destroy(): Promise<void> {
    try {
      // 停止所有任务（使用便捷方法）
      this.taskP.cancelTasksByKnowledgeBase(this.config.id)
      // 清理所有进度跟踪器
      this.fileProgressMap.clear()
      this.vectorP.destroy()
    } catch (err) {
      console.error(`[RAG] Error destroying knowledge base ${this.config.id}:`, err)
    }
  }

  async close(): Promise<void> {
    try {
      // 停止所有任务（使用便捷方法）
      this.taskP.cancelTasksByKnowledgeBase(this.config.id)
      // 清理所有进度跟踪器
      this.fileProgressMap.clear()
      await this.pauseAllRunningTasks()
      this.vectorP.close()
    } catch (err) {
      console.error(`[RAG] Error closing knowledge base ${this.config.id}:`, err)
    }
  }
}
