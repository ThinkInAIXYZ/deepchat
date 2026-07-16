export type KnowledgeFileMetadata = {
  size: number
  totalChunks: number
  errorReason?: string
}

export type KnowledgeTaskStatus = 'processing' | 'completed' | 'error' | 'paused'

export type KnowledgeFileMessage = {
  id: string
  name: string
  path: string
  mimeType: string
  status: KnowledgeTaskStatus
  uploadedAt: number
  metadata: KnowledgeFileMetadata
}

export type KnowledgeChunkMessage = {
  id: string
  fileId: string
  chunkIndex: number
  content: string
  status: KnowledgeTaskStatus
  error?: string
}

export type KnowledgeTaskQueueStatus = {
  totalTasks: number
  runningTasks: number
  queuedTasks: number
}

export type KnowledgeFileResult = {
  data?: KnowledgeFileMessage
  error?: string
}

export type FileValidationResult = {
  isSupported: boolean
  mimeType?: string
  adapterType?: string
  error?: string
  suggestedExtensions?: string[]
}

type KnowledgeModelRef = {
  modelId: string
  providerId: string
}

export type BuiltinKnowledgeConfig = {
  id: string
  description: string
  embedding: KnowledgeModelRef
  rerank?: KnowledgeModelRef
  dimensions: number
  normalized: boolean
  chunkSize?: number
  chunkOverlap?: number
  fragmentsNumber: number
  separators?: string[]
  enabled: boolean
}

export type MetricType = 'l2' | 'cosine' | 'ip'

export type KnowledgeIndexOptions = {
  metric?: MetricType
  M?: number
  efConstruction?: number
}

export type KnowledgeVectorInsert = {
  vector: number[]
  fileId: string
  chunkId: string
}

export type KnowledgeQueryOptions = {
  topK: number
  efSearch?: number
  threshold?: number
  metric: MetricType
}

export type QueryResult = {
  id: string
  metadata: {
    from: string
    filePath: string
    content: string
  }
  distance: number
}

export interface KnowledgeServicePort {
  syncConfigChanges(): Promise<void>
  isSupported(): Promise<boolean>
  addFile(id: string, path: string): Promise<KnowledgeFileResult>
  deleteFile(id: string, fileId: string): Promise<void>
  reAddFile(id: string, fileId: string): Promise<KnowledgeFileResult>
  listFiles(id: string): Promise<KnowledgeFileMessage[]>
  similarityQuery(id: string, key: string): Promise<QueryResult[]>
  getTaskQueueStatus(): Promise<KnowledgeTaskQueueStatus>
  pauseAllRunningTasks(id: string): Promise<void>
  resumeAllPausedTasks(id: string): Promise<void>
  confirmShutdown(): Promise<boolean>
  destroy(): Promise<void>
  getSupportedLanguages(): Promise<string[]>
  getSeparatorsForLanguage(language: string): Promise<string[]>
  validateFile(filePath: string): Promise<FileValidationResult>
  getSupportedFileExtensions(): Promise<string[]>
}

export type KnowledgeSearchPort = Pick<KnowledgeServicePort, 'similarityQuery'>
