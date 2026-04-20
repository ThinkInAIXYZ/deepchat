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

export class WorkspaceClient {
  constructor(private readonly bridge: DeepchatBridge = getDeepchatBridge()) {}

  async registerWorkspace(workspacePath: string, mode: WorkspaceRegistrationMode = 'workspace') {
    return await this.bridge.invoke(workspaceRegisterRoute.name, { workspacePath, mode })
  }

  async unregisterWorkspace(workspacePath: string, mode: WorkspaceRegistrationMode = 'workspace') {
    return await this.bridge.invoke(workspaceUnregisterRoute.name, { workspacePath, mode })
  }

  async watchWorkspace(workspacePath: string) {
    return await this.bridge.invoke(workspaceWatchRoute.name, { workspacePath })
  }

  async unwatchWorkspace(workspacePath: string) {
    return await this.bridge.invoke(workspaceUnwatchRoute.name, { workspacePath })
  }

  async readDirectory(path: string) {
    const result = await this.bridge.invoke(workspaceReadDirectoryRoute.name, { path })
    return result.nodes
  }

  async expandDirectory(path: string) {
    const result = await this.bridge.invoke(workspaceExpandDirectoryRoute.name, { path })
    return result.nodes
  }

  async revealFileInFolder(path: string) {
    return await this.bridge.invoke(workspaceRevealFileInFolderRoute.name, { path })
  }

  async openFile(path: string) {
    return await this.bridge.invoke(workspaceOpenFileRoute.name, { path })
  }

  async readFilePreview(path: string) {
    const result = await this.bridge.invoke(workspaceReadFilePreviewRoute.name, { path })
    return result.preview
  }

  async resolveMarkdownLinkedFile(input: {
    workspacePath: string | null
    href: string
    sourceFilePath?: string | null
  }) {
    const result = await this.bridge.invoke(workspaceResolveMarkdownLinkedFileRoute.name, input)
    return result.resolution
  }

  async getGitStatus(workspacePath: string) {
    const result = await this.bridge.invoke(workspaceGetGitStatusRoute.name, { workspacePath })
    return result.state
  }

  async getGitDiff(workspacePath: string, filePath?: string) {
    const result = await this.bridge.invoke(workspaceGetGitDiffRoute.name, {
      workspacePath,
      filePath
    })
    return result.diff
  }

  async searchFiles(workspacePath: string, query: string) {
    const result = await this.bridge.invoke(workspaceSearchFilesRoute.name, {
      workspacePath,
      query
    })
    return result.nodes
  }

  onInvalidated(
    listener: (payload: {
      workspacePath: string
      kind: 'fs' | 'git' | 'full'
      source: 'watcher' | 'fallback' | 'lifecycle'
      version: number
    }) => void
  ) {
    return this.bridge.on(workspaceInvalidatedEvent.name, listener)
  }
}
