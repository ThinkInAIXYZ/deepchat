import type { MessageFile } from '@shared/chat'
import type { FileValidationResult } from './knowledge'

export interface FileMetaData {
  fileName: string
  fileSize: number
  fileDescription?: string
  fileCreated: Date
  fileModified: Date
}

export interface DirectoryMetaData {
  dirName: string
  dirPath: string
  dirCreated: Date
  dirModified: Date
}

export interface FileItem {
  id: string
  name: string
  type: string
  size: number
  path: string
  description?: string
  content?: string
  createdAt: number
}

export interface FileServicePort {
  readFile(relativePath: string): Promise<string>
  prepareFile(absPath: string, typeInfo?: string): Promise<MessageFile>
  prepareFileCompletely(
    absPath: string,
    typeInfo?: string,
    contentType?: null | 'origin' | 'llm-friendly'
  ): Promise<MessageFile>
  prepareDirectory(absPath: string): Promise<MessageFile>
  isDirectory(absPath: string): Promise<boolean>
  getMimeType(filePath: string): Promise<string>
  writeImageBase64(file: { name: string; content: string }): Promise<string>
  validateFileForKnowledgeBase(filePath: string): Promise<FileValidationResult>
  getSupportedExtensions(): string[]
}
