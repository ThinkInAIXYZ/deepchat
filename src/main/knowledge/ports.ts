import type {
  BuiltinKnowledgeConfig,
  FileValidationResult,
  KnowledgeChunkMessage,
  KnowledgeFileMessage,
  KnowledgeIndexOptions,
  KnowledgeQueryOptions,
  KnowledgeTaskQueueStatus,
  KnowledgeTaskStatus,
  KnowledgeVectorInsert,
  QueryResult
} from '@shared/types/knowledge'

export type KnowledgeTask = {
  id: string
  payload: {
    knowledgeBaseId: string
    fileId: string
    [key: string]: unknown
  }
  run: (context: { signal: AbortSignal }) => Promise<void>
  onSuccess?: () => void
  onError?: (error: Error) => void
  onTerminate?: () => void
}

export interface KnowledgeTaskQueuePort {
  addTask(task: KnowledgeTask): void
  cancelTasksByKnowledgeBase(knowledgeBaseId: string): void
  cancelTasksByFile(fileId: string): void
  getStatus(): KnowledgeTaskQueueStatus
  destroy(): void
}

export interface KnowledgeDatabasePort {
  initialize(dimensions: number, opts?: KnowledgeIndexOptions): Promise<void>
  open(): Promise<void>
  close(): Promise<void>
  destroy(): Promise<void>
  insertVector(opts: KnowledgeVectorInsert): Promise<void>
  insertVectors(records: KnowledgeVectorInsert[]): Promise<void>
  similarityQuery(vector: number[], options: KnowledgeQueryOptions): Promise<QueryResult[]>
  deleteVectorsByFile(id: string): Promise<void>
  insertFile(file: KnowledgeFileMessage): Promise<void>
  updateFile(file: KnowledgeFileMessage): Promise<void>
  queryFile(id: string): Promise<KnowledgeFileMessage | null>
  queryFiles(where: Partial<KnowledgeFileMessage>): Promise<KnowledgeFileMessage[]>
  listFiles(): Promise<KnowledgeFileMessage[]>
  deleteFile(id: string): Promise<void>
  insertChunks(chunks: KnowledgeChunkMessage[]): Promise<void>
  updateChunkStatus(chunkId: string, status: KnowledgeTaskStatus, error?: string): Promise<void>
  queryChunks(where: Partial<KnowledgeChunkMessage>): Promise<KnowledgeChunkMessage[]>
  deleteChunksByFile(fileId: string): Promise<void>
  pauseAllRunningTasks(): Promise<void>
  resumeAllPausedTasks(): Promise<void>
}

export interface KnowledgeConfigPort {
  getKnowledgeConfigs(): BuiltinKnowledgeConfig[]
}

export interface KnowledgeFilePort {
  getMimeType(filePath: string): Promise<string>
  prepareFileCompletely(
    filePath: string,
    mimeType?: string,
    contentType?: null | 'origin' | 'llm-friendly'
  ): Promise<{
    name: string
    content?: string
    metadata: { fileSize: number }
  }>
  validateFileForKnowledgeBase(filePath: string): Promise<FileValidationResult>
  getSupportedExtensions(): string[]
}

export interface KnowledgeEmbeddingPort {
  getEmbeddings(
    providerId: string,
    modelId: string,
    texts: string[],
    signal?: AbortSignal
  ): Promise<number[][]>
}

export interface KnowledgeDialogPort {
  showDialog(request: {
    title: string
    description?: string
    i18n?: boolean
    icon?: { icon: string; class: string }
    buttons?: Array<{ key: string; label: string; default?: boolean }>
    timeout?: number
  }): Promise<string>
}

export interface KnowledgeEventPublisher {
  publishFileUpdated(file: KnowledgeFileMessage): void
  publishFileProgress(
    fileId: string,
    progress: { completed: number; error: number; total: number }
  ): void
}

export type KnowledgeServiceDeps = {
  config: KnowledgeConfigPort
  storageRoot: string
  files: KnowledgeFilePort
  dialog: KnowledgeDialogPort
  embeddings: KnowledgeEmbeddingPort
  events: KnowledgeEventPublisher
}
