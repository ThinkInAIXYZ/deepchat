import type { MessageFile } from '@shared/chat'
import type { FileValidationResult } from './knowledge'

export type FileOperation = {
  path: string
  content?: string
}

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
  writeFile(operation: FileOperation): Promise<void>
  deleteFile(relativePath: string): Promise<void>
  createFileAdapter(filePath: string, typeInfo?: string): Promise<unknown>
  prepareFile(absPath: string, typeInfo?: string): Promise<MessageFile>
  prepareFileCompletely(
    absPath: string,
    typeInfo?: string,
    contentType?: null | 'origin' | 'llm-friendly'
  ): Promise<MessageFile>
  prepareDirectory(absPath: string): Promise<MessageFile>
  writeTemp(file: { name: string; content: string | Buffer | ArrayBuffer }): Promise<string>
  isDirectory(absPath: string): Promise<boolean>
  getMimeType(filePath: string): Promise<string>
  writeImageBase64(file: { name: string; content: string }): Promise<string>
  saveImage(file: {
    source: string
    mimeType?: string
    suggestedName?: string
  }): Promise<{ canceled: boolean; path?: string }>
  copyImage(file: {
    source: string
    mimeType?: string
    suggestedName?: string
  }): Promise<{ copied: boolean }>
  validateFileForKnowledgeBase(filePath: string): Promise<FileValidationResult>
  getSupportedExtensions(): string[]
}
