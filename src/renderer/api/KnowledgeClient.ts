import type { DeepchatBridge } from '@shared/contracts/bridge'
import { knowledgeFileProgressEvent, knowledgeFileUpdatedEvent } from '@shared/contracts/events'
import {
  knowledgeAddFileRoute,
  knowledgeDeleteFileRoute,
  knowledgeGetSeparatorsForLanguageRoute,
  knowledgeGetSupportedFileExtensionsRoute,
  knowledgeGetSupportedLanguagesRoute,
  knowledgeIsSupportedRoute,
  knowledgeListFilesRoute,
  knowledgePauseAllRunningTasksRoute,
  knowledgeReAddFileRoute,
  knowledgeResumeAllPausedTasksRoute,
  knowledgeSimilarityQueryRoute,
  knowledgeValidateFileRoute
} from '@shared/contracts/routes'
import type {
  FileValidationResult,
  KnowledgeFileMessage,
  KnowledgeFileResult,
  QueryResult
} from '@shared/presenter'
import { getDeepchatBridge } from './core'

export function createKnowledgeClient(bridge: DeepchatBridge = getDeepchatBridge()) {
  async function isSupported(): Promise<boolean> {
    const result = await bridge.invoke(knowledgeIsSupportedRoute.name, {})
    return result.supported
  }

  async function getSupportedLanguages(): Promise<string[]> {
    const result = await bridge.invoke(knowledgeGetSupportedLanguagesRoute.name, {})
    return result.languages
  }

  async function getSeparatorsForLanguage(language: string): Promise<string[]> {
    const result = await bridge.invoke(knowledgeGetSeparatorsForLanguageRoute.name, { language })
    return result.separators
  }

  async function getSupportedFileExtensions(): Promise<string[]> {
    const result = await bridge.invoke(knowledgeGetSupportedFileExtensionsRoute.name, {})
    return result.extensions
  }

  async function listFiles(knowledgeBaseId: string): Promise<KnowledgeFileMessage[]> {
    const result = await bridge.invoke(knowledgeListFilesRoute.name, { knowledgeBaseId })
    return result.files as KnowledgeFileMessage[]
  }

  async function similarityQuery(knowledgeBaseId: string, query: string): Promise<QueryResult[]> {
    const result = await bridge.invoke(knowledgeSimilarityQueryRoute.name, {
      knowledgeBaseId,
      query
    })
    return result.results as QueryResult[]
  }

  async function validateFile(filePath: string): Promise<FileValidationResult> {
    const result = await bridge.invoke(knowledgeValidateFileRoute.name, { filePath })
    return result.result as FileValidationResult
  }

  async function addFile(knowledgeBaseId: string, filePath: string): Promise<KnowledgeFileResult> {
    const result = await bridge.invoke(knowledgeAddFileRoute.name, { knowledgeBaseId, filePath })
    return result.result as KnowledgeFileResult
  }

  async function deleteFile(knowledgeBaseId: string, fileId: string): Promise<boolean> {
    const result = await bridge.invoke(knowledgeDeleteFileRoute.name, { knowledgeBaseId, fileId })
    return result.deleted
  }

  async function reAddFile(knowledgeBaseId: string, fileId: string): Promise<KnowledgeFileResult> {
    const result = await bridge.invoke(knowledgeReAddFileRoute.name, { knowledgeBaseId, fileId })
    return result.result as KnowledgeFileResult
  }

  async function pauseAllRunningTasks(knowledgeBaseId: string): Promise<boolean> {
    const result = await bridge.invoke(knowledgePauseAllRunningTasksRoute.name, { knowledgeBaseId })
    return result.paused
  }

  async function resumeAllPausedTasks(knowledgeBaseId: string): Promise<boolean> {
    const result = await bridge.invoke(knowledgeResumeAllPausedTasksRoute.name, { knowledgeBaseId })
    return result.resumed
  }

  function onFileUpdated(listener: (file: KnowledgeFileMessage) => void): () => void {
    return bridge.on(knowledgeFileUpdatedEvent.name, (payload) => {
      listener(payload as KnowledgeFileMessage)
    })
  }

  function onFileProgress(
    listener: (progress: {
      fileId: string
      completed: number
      error: number
      total: number
    }) => void
  ): () => void {
    return bridge.on(knowledgeFileProgressEvent.name, listener)
  }

  return {
    isSupported,
    getSupportedLanguages,
    getSeparatorsForLanguage,
    getSupportedFileExtensions,
    listFiles,
    similarityQuery,
    validateFile,
    addFile,
    deleteFile,
    reAddFile,
    pauseAllRunningTasks,
    resumeAllPausedTasks,
    onFileUpdated,
    onFileProgress
  }
}

export type KnowledgeClient = ReturnType<typeof createKnowledgeClient>
