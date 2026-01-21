import { usePresenter } from '@/composables/usePresenter'
import { WORKSPACE_EVENTS } from '@/events'
import type {
  WorkspaceFileNode,
  WorkspacePlanEntry,
  WorkspaceTerminalSnippet
} from '@shared/presenter'

type Unsubscribe = () => void

const noopUnsubscribe: Unsubscribe = () => undefined

export type WorkspacePlanUpdatedPayload = {
  conversationId: string
  entries: WorkspacePlanEntry[]
}

export type WorkspaceTerminalOutputPayload = {
  conversationId: string
  snippet: WorkspaceTerminalSnippet
}

export type WorkspaceFilesChangedPayload = {
  conversationId: string
}

export type WorkspaceAdapter = {
  registerWorkspace: (workspacePath: string) => Promise<void>
  registerWorkdir: (workdir: string) => Promise<void>
  searchFiles: (workspacePath: string, query: string) => Promise<WorkspaceFileNode[]>
  readDirectory: (dirPath: string) => Promise<WorkspaceFileNode[]>
  expandDirectory: (dirPath: string) => Promise<WorkspaceFileNode[]>
  getPlanEntries: (conversationId: string) => Promise<WorkspacePlanEntry[]>
  terminateCommand: (conversationId: string, snippetId: string) => Promise<void>
  onPlanUpdated: (handler: (payload: WorkspacePlanUpdatedPayload) => void) => Unsubscribe
  onTerminalOutput: (handler: (payload: WorkspaceTerminalOutputPayload) => void) => Unsubscribe
  onFilesChanged: (handler: (payload: WorkspaceFilesChangedPayload) => void) => Unsubscribe
}

export function useWorkspaceAdapter(): WorkspaceAdapter {
  const workspacePresenter = usePresenter('workspacePresenter')

  const subscribe = <T>(event: string, handler: (payload: T) => void): Unsubscribe => {
    if (!window?.electron?.ipcRenderer) return noopUnsubscribe

    const listener = (_event: unknown, payload: T) => {
      handler(payload)
    }

    window.electron.ipcRenderer.on(event, listener)

    return () => {
      window.electron.ipcRenderer.removeListener(event, listener)
    }
  }

  return {
    registerWorkspace: workspacePresenter.registerWorkspace,
    registerWorkdir: workspacePresenter.registerWorkdir,
    searchFiles: workspacePresenter.searchFiles,
    readDirectory: workspacePresenter.readDirectory,
    expandDirectory: workspacePresenter.expandDirectory,
    getPlanEntries: workspacePresenter.getPlanEntries,
    terminateCommand: workspacePresenter.terminateCommand,
    onPlanUpdated: (handler) =>
      subscribe<WorkspacePlanUpdatedPayload>(WORKSPACE_EVENTS.PLAN_UPDATED, handler),
    onTerminalOutput: (handler) =>
      subscribe<WorkspaceTerminalOutputPayload>(WORKSPACE_EVENTS.TERMINAL_OUTPUT, handler),
    onFilesChanged: (handler) =>
      subscribe<WorkspaceFilesChangedPayload>(WORKSPACE_EVENTS.FILES_CHANGED, handler)
  }
}
