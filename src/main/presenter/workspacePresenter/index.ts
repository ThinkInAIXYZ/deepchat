import path from 'path'
import fs from 'fs'
import { shell } from 'electron'
import { eventBus, SendTarget } from '@/eventbus'
import { WORKSPACE_EVENTS } from '@/events'
import { readDirectoryShallow } from './directoryReader'
import { PlanStateManager } from './planStateManager'
import { searchWorkspaceFiles } from './workspaceFileSearch'
import { terminateCommandProcess } from '@/presenter/llmProviderPresenter/agent/commandProcessTracker'
import type {
  IWorkspacePresenter,
  WorkspaceFileNode,
  WorkspacePlanEntry,
  WorkspaceTerminalSnippet,
  WorkspaceRawPlanEntry
} from '@shared/presenter'

export class WorkspacePresenter implements IWorkspacePresenter {
  private readonly planManager = new PlanStateManager()
  // Allowed workspace paths (registered by Agent and ACP sessions)
  private readonly allowedPaths = new Set<string>()

  /**
   * Register a workspace path as allowed for reading
   * Returns Promise to ensure IPC call completion
   */
  async registerWorkspace(workspacePath: string): Promise<void> {
    const normalized = path.resolve(workspacePath)
    this.allowedPaths.add(normalized)
  }

  /**
   * Register a workdir path as allowed for reading (ACP alias)
   */
  async registerWorkdir(workdir: string): Promise<void> {
    await this.registerWorkspace(workdir)
  }

  /**
   * Unregister a workspace path
   */
  async unregisterWorkspace(workspacePath: string): Promise<void> {
    const normalized = path.resolve(workspacePath)
    this.allowedPaths.delete(normalized)
  }

  /**
   * Unregister a workdir path (ACP alias)
   */
  async unregisterWorkdir(workdir: string): Promise<void> {
    await this.unregisterWorkspace(workdir)
  }

  /**
   * Check if a path is within allowed workspaces
   * Uses realpathSync to resolve symlinks and prevent bypass attacks
   */
  private isPathAllowed(targetPath: string): boolean {
    try {
      // Resolve symlinks for target path
      const realTargetPath = fs.realpathSync(targetPath)
      const normalizedTarget = path.normalize(realTargetPath)
      const targetWithSep = normalizedTarget.endsWith(path.sep)
        ? normalizedTarget
        : `${normalizedTarget}${path.sep}`

      for (const workspace of this.allowedPaths) {
        try {
          // Resolve symlinks for each allowed workspace
          const realWorkspace = fs.realpathSync(workspace)
          const normalizedWorkspace = path.normalize(realWorkspace)
          const workspaceWithSep = normalizedWorkspace.endsWith(path.sep)
            ? normalizedWorkspace
            : `${normalizedWorkspace}${path.sep}`

          // Check if targetPath is equal to or under the workspace
          if (
            normalizedTarget === normalizedWorkspace ||
            targetWithSep.startsWith(workspaceWithSep)
          ) {
            return true
          }
        } catch {
          // If workspace path resolution fails, skip this workspace
          continue
        }
      }
      return false
    } catch {
      // If target path resolution fails, treat as not allowed
      return false
    }
  }

  /**
   * Read directory (shallow, only first level)
   * Use expandDirectory to load subdirectory contents
   */
  async readDirectory(dirPath: string): Promise<WorkspaceFileNode[]> {
    // Security check: only allow reading within registered workspaces
    if (!this.isPathAllowed(dirPath)) {
      console.warn(`[Workspace] Blocked read attempt for unauthorized path: ${dirPath}`)
      return []
    }
    return readDirectoryShallow(dirPath)
  }

  /**
   * Expand a directory to load its children (lazy loading)
   * @param dirPath Directory path to expand
   */
  async expandDirectory(dirPath: string): Promise<WorkspaceFileNode[]> {
    // Security check: only allow reading within registered workspaces
    if (!this.isPathAllowed(dirPath)) {
      console.warn(`[Workspace] Blocked expand attempt for unauthorized path: ${dirPath}`)
      return []
    }
    return readDirectoryShallow(dirPath)
  }

  /**
   * Reveal a file or directory in the system file manager
   */
  async revealFileInFolder(filePath: string): Promise<void> {
    // Security check: only allow revealing within registered workspaces
    if (!this.isPathAllowed(filePath)) {
      console.warn(`[Workspace] Blocked reveal attempt for unauthorized path: ${filePath}`)
      return
    }

    const normalizedPath = path.resolve(filePath)

    try {
      shell.showItemInFolder(normalizedPath)
    } catch (error) {
      console.error(`[Workspace] Failed to reveal path: ${normalizedPath}`, error)
    }
  }

  /**
   * Open a file or directory with the system default application
   */
  async openFile(filePath: string): Promise<void> {
    if (!this.isPathAllowed(filePath)) {
      console.warn(`[Workspace] Blocked open attempt for unauthorized path: ${filePath}`)
      return
    }

    const normalizedPath = path.resolve(filePath)

    try {
      const errorMessage = await shell.openPath(normalizedPath)
      if (errorMessage) {
        console.error(`[Workspace] Failed to open path: ${normalizedPath}`, errorMessage)
      }
    } catch (error) {
      console.error(`[Workspace] Failed to open path: ${normalizedPath}`, error)
    }
  }

  /**
   * Get plan entries
   */
  async getPlanEntries(conversationId: string): Promise<WorkspacePlanEntry[]> {
    return this.planManager.getEntries(conversationId)
  }

  /**
   * Update plan entries (called by agent content mapper)
   */
  async updatePlanEntries(conversationId: string, entries: WorkspaceRawPlanEntry[]): Promise<void> {
    const updated = this.planManager.updateEntries(conversationId, entries)

    // Send event to renderer
    eventBus.sendToRenderer(WORKSPACE_EVENTS.PLAN_UPDATED, SendTarget.ALL_WINDOWS, {
      conversationId,
      entries: updated
    })
  }

  /**
   * Emit terminal output snippet (called by agent content mapper)
   */
  async emitTerminalSnippet(
    conversationId: string,
    snippet: WorkspaceTerminalSnippet
  ): Promise<void> {
    eventBus.sendToRenderer(WORKSPACE_EVENTS.TERMINAL_OUTPUT, SendTarget.ALL_WINDOWS, {
      conversationId,
      snippet
    })
  }

  /**
   * Terminate a running command
   */
  async terminateCommand(conversationId: string, snippetId: string): Promise<void> {
    await terminateCommandProcess(conversationId, snippetId)
  }

  /**
   * Clear workspace data for a conversation
   */
  async clearWorkspaceData(conversationId: string): Promise<void> {
    this.planManager.clear(conversationId)
  }

  /**
   * Search workspace files by query (query does not include @)
   */
  async searchFiles(workspacePath: string, query: string): Promise<WorkspaceFileNode[]> {
    if (!this.isPathAllowed(workspacePath)) {
      console.warn(`[Workspace] Blocked search attempt for unauthorized path: ${workspacePath}`)
      return []
    }
    const results = await searchWorkspaceFiles(workspacePath, query)
    return results
  }
}
