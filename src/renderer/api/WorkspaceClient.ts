import type { DeepchatBridge } from '@shared/contracts/bridge'
import { workspaceInvalidatedEvent } from '@shared/contracts/events'
import {
  workspaceExpandDirectoryRoute,
  workspaceGetGitDiffRoute,
  workspaceGetGitStatusRoute,
  workspaceOpenFileRoute,
  workspaceReadDirectoryRoute,
  workspaceReadFilePreviewRoute,
  workspaceRegisterRoute,
  workspaceResolveMarkdownLinkedFileRoute,
  workspaceRevealFileInFolderRoute,
  workspaceSearchFilesRoute,
  workspaceUnregisterRoute,
  workspaceUnwatchRoute,
  workspaceWatchRoute
} from '@shared/contracts/routes'
import { getDeepchatBridge } from './core'

type WorkspaceRegistrationMode = 'workspace' | 'workdir'

export function createWorkspaceClient(bridge: DeepchatBridge = getDeepchatBridge()) {
  async function registerWorkspace(
    workspacePath: string,
    mode: WorkspaceRegistrationMode = 'workspace'
  ) {
    return await bridge.invoke(workspaceRegisterRoute.name, { workspacePath, mode })
  }

  async function unregisterWorkspace(
    workspacePath: string,
    mode: WorkspaceRegistrationMode = 'workspace'
  ) {
    return await bridge.invoke(workspaceUnregisterRoute.name, { workspacePath, mode })
  }

  async function watchWorkspace(workspacePath: string) {
    return await bridge.invoke(workspaceWatchRoute.name, { workspacePath })
  }

  async function unwatchWorkspace(workspacePath: string) {
    return await bridge.invoke(workspaceUnwatchRoute.name, { workspacePath })
  }

  async function readDirectory(path: string) {
    const result = await bridge.invoke(workspaceReadDirectoryRoute.name, { path })
    return result.nodes
  }

  async function expandDirectory(path: string) {
    const result = await bridge.invoke(workspaceExpandDirectoryRoute.name, { path })
    return result.nodes
  }

  async function revealFileInFolder(path: string) {
    return await bridge.invoke(workspaceRevealFileInFolderRoute.name, { path })
  }

  async function openFile(path: string) {
    return await bridge.invoke(workspaceOpenFileRoute.name, { path })
  }

  async function readFilePreview(path: string) {
    const result = await bridge.invoke(workspaceReadFilePreviewRoute.name, { path })
    return result.preview
  }

  async function resolveMarkdownLinkedFile(input: {
    workspacePath: string | null
    href: string
    sourceFilePath?: string | null
  }) {
    const result = await bridge.invoke(workspaceResolveMarkdownLinkedFileRoute.name, input)
    return result.resolution
  }

  async function getGitStatus(workspacePath: string) {
    const result = await bridge.invoke(workspaceGetGitStatusRoute.name, { workspacePath })
    return result.state
  }

  async function getGitDiff(workspacePath: string, filePath?: string) {
    const result = await bridge.invoke(workspaceGetGitDiffRoute.name, {
      workspacePath,
      filePath
    })
    return result.diff
  }

  async function searchFiles(workspacePath: string, query: string) {
    const result = await bridge.invoke(workspaceSearchFilesRoute.name, {
      workspacePath,
      query
    })
    return result.nodes
  }

  function onInvalidated(
    listener: (payload: {
      workspacePath: string
      kind: 'fs' | 'git' | 'full'
      source: 'watcher' | 'fallback' | 'lifecycle'
      version: number
    }) => void
  ) {
    return bridge.on(workspaceInvalidatedEvent.name, listener)
  }

  return {
    registerWorkspace,
    unregisterWorkspace,
    watchWorkspace,
    unwatchWorkspace,
    readDirectory,
    expandDirectory,
    revealFileInFolder,
    openFile,
    readFilePreview,
    resolveMarkdownLinkedFile,
    getGitStatus,
    getGitDiff,
    searchFiles,
    onInvalidated
  }
}

export type WorkspaceClient = ReturnType<typeof createWorkspaceClient>
