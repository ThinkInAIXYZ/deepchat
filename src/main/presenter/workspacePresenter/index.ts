import path from 'path'
import { shell } from 'electron'
import { eventBus, SendTarget } from '@/eventbus'
import { ACP_WORKSPACE_EVENTS } from '@/events'
import { readDirectoryShallow } from '../acpWorkspacePresenter/directoryReader'
import { PlanStateManager } from '../acpWorkspacePresenter/planStateManager'
import type {
  IWorkspacePresenter,
  WorkspaceFileNode,
  WorkspacePlanEntry,
  WorkspaceTerminalSnippet,
  WorkspaceRawPlanEntry
} from '@shared/presenter'

export class WorkspacePresenter implements IWorkspacePresenter {
  private readonly planManager = new PlanStateManager()
  // Allowed workspace paths (registered by Agent sessions)
  private readonly allowedWorkspaces = new Set<string>()

  /**
   * Register a workspace path as allowed for reading
   * Returns Promise to ensure IPC call completion
   */
  async registerWorkspace(workspacePath: string): Promise<void> {
    const normalized = path.resolve(workspacePath)
    this.allowedWorkspaces.add(normalized)
  }

  /**
   * Unregister a workspace path
   */
  async unregisterWorkspace(workspacePath: string): Promise<void> {
    const normalized = path.resolve(workspacePath)
    this.allowedWorkspaces.delete(normalized)
  }

  /**
   * Check if a path is within allowed workspaces
   */
  private isPathAllowed(targetPath: string): boolean {
    const normalized = path.resolve(targetPath)
    for (const workspace of this.allowedWorkspaces) {
      // Check if targetPath is equal to or under the workspace
      if (normalized === workspace || normalized.startsWith(workspace + path.sep)) {
        return true
      }
    }
    return false
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
    // AcpFileNode and WorkspaceFileNode have the same structure
    const nodes = await readDirectoryShallow(dirPath)
    return nodes as unknown as WorkspaceFileNode[]
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
    // AcpFileNode and WorkspaceFileNode have the same structure
    const nodes = await readDirectoryShallow(dirPath)
    return nodes as unknown as WorkspaceFileNode[]
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
    // WorkspacePlanEntry and AcpPlanEntry have the same structure
    return this.planManager.getEntries(conversationId) as unknown as WorkspacePlanEntry[]
  }

  /**
   * Update plan entries (called by agent content mapper)
   */
  async updatePlanEntries(conversationId: string, entries: WorkspaceRawPlanEntry[]): Promise<void> {
    // WorkspaceRawPlanEntry and AcpRawPlanEntry have the same structure
    const updated = this.planManager.updateEntries(
      conversationId,
      entries as unknown as import('@shared/presenter').AcpRawPlanEntry[]
    ) as unknown as WorkspacePlanEntry[]

    // Send event to renderer
    eventBus.sendToRenderer(ACP_WORKSPACE_EVENTS.PLAN_UPDATED, SendTarget.ALL_WINDOWS, {
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
    eventBus.sendToRenderer(ACP_WORKSPACE_EVENTS.TERMINAL_OUTPUT, SendTarget.ALL_WINDOWS, {
      conversationId,
      snippet
    })
  }

  /**
   * Clear workspace data for a conversation
   */
  async clearWorkspaceData(conversationId: string): Promise<void> {
    this.planManager.clear(conversationId)
  }
}
