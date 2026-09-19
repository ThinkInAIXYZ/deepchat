import type { DeepchatBridge } from '@shared/contracts/bridge'
import {
  fileCopyImageRoute,
  fileGetMimeTypeRoute,
  fileIsDirectoryRoute,
  filePrepareDirectoryRoute,
  filePrepareFileRoute,
  fileReadFileRoute,
  fileSaveImageRoute,
  fileWriteImageBase64Route
} from '@shared/contracts/routes'
import { getDeepchatBridge } from './core'
import { formatRuntimePathForInput, getRuntimePathForFile, toRuntimeRelativePath } from './runtime'

export function createFileClient(bridge: DeepchatBridge = getDeepchatBridge()) {
  async function getMimeType(path: string) {
    const result = await bridge.invoke(fileGetMimeTypeRoute.name, { path })
    return result.mimeType
  }

  async function prepareFile(path: string, mimeType?: string) {
    const result = await bridge.invoke(filePrepareFileRoute.name, { path, mimeType })
    return result.file
  }

  async function prepareDirectory(path: string) {
    const result = await bridge.invoke(filePrepareDirectoryRoute.name, { path })
    return result.file
  }

  async function readFile(path: string) {
    const result = await bridge.invoke(fileReadFileRoute.name, { path })
    return result.content
  }

  async function isDirectory(path: string) {
    const result = await bridge.invoke(fileIsDirectoryRoute.name, { path })
    return result.isDirectory
  }

  async function writeImageBase64(file: { name: string; content: string }) {
    const result = await bridge.invoke(fileWriteImageBase64Route.name, file)
    return result.path
  }

  async function saveImage(file: { source: string; mimeType?: string; suggestedName?: string }) {
    return await bridge.invoke(fileSaveImageRoute.name, file)
  }

  async function copyImage(file: { source: string; mimeType?: string; suggestedName?: string }) {
    return await bridge.invoke(fileCopyImageRoute.name, file)
  }

  function getPathForFile(file: File): string {
    return getRuntimePathForFile(file)
  }

  function toRelativePath(filePath: string, baseDir?: string): string {
    return toRuntimeRelativePath(filePath, baseDir)
  }

  function formatPathForInput(filePath: string): string {
    return formatRuntimePathForInput(filePath)
  }

  return {
    getMimeType,
    prepareFile,
    prepareDirectory,
    readFile,
    isDirectory,
    writeImageBase64,
    saveImage,
    copyImage,
    getPathForFile,
    toRelativePath,
    formatPathForInput
  }
}

export type FileClient = ReturnType<typeof createFileClient>
