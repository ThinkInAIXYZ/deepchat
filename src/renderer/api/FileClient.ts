import type { DeepchatBridge } from '@shared/contracts/bridge'
import {
  fileGetMimeTypeRoute,
  fileIsDirectoryRoute,
  filePrepareDirectoryRoute,
  filePrepareFileRoute,
  fileReadFileRoute,
  fileWriteImageBase64Route
} from '@shared/contracts/routes'
import { getDeepchatBridge } from './core'
import { formatRuntimePathForInput, getRuntimePathForFile, toRuntimeRelativePath } from './runtime'

export class FileClient {
  constructor(private readonly bridge: DeepchatBridge = getDeepchatBridge()) {}

  async getMimeType(path: string) {
    const result = await this.bridge.invoke(fileGetMimeTypeRoute.name, { path })
    return result.mimeType
  }

  async prepareFile(path: string, mimeType?: string) {
    const result = await this.bridge.invoke(filePrepareFileRoute.name, { path, mimeType })
    return result.file
  }

  async prepareDirectory(path: string) {
    const result = await this.bridge.invoke(filePrepareDirectoryRoute.name, { path })
    return result.file
  }

  async readFile(path: string) {
    const result = await this.bridge.invoke(fileReadFileRoute.name, { path })
    return result.content
  }

  async isDirectory(path: string) {
    const result = await this.bridge.invoke(fileIsDirectoryRoute.name, { path })
    return result.isDirectory
  }

  async writeImageBase64(file: { name: string; content: string }) {
    const result = await this.bridge.invoke(fileWriteImageBase64Route.name, file)
    return result.path
  }

  getPathForFile(file: File): string {
    return getRuntimePathForFile(file)
  }

  toRelativePath(filePath: string, baseDir?: string): string {
    return toRuntimeRelativePath(filePath, baseDir)
  }

  formatPathForInput(filePath: string): string {
    return formatRuntimePathForInput(filePath)
  }
}
