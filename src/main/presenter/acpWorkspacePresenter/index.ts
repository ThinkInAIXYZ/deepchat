import path from 'path'
import { eventBus, SendTarget } from '@/eventbus'
import { ACP_WORKSPACE_EVENTS } from '@/events'
import { readDirectoryShallow } from './directoryReader'
import { PlanStateManager } from './planStateManager'
import type {
  IAcpWorkspacePresenter,
  AcpFileNode,
  AcpPlanEntry,
  AcpTerminalSnippet,
  AcpRawPlanEntry
} from '@shared/presenter'

export class AcpWorkspacePresenter implements IAcpWorkspacePresenter {
  private readonly planManager = new PlanStateManager()
  // Allowed workdir paths (registered by ACP sessions)
  private readonly allowedWorkdirs = new Set<string>()

  /**
   * Register a workdir as allowed for reading
   * Returns Promise to ensure IPC call completion
   */
  async registerWorkdir(workdir: string): Promise<void> {
    const normalized = path.resolve(workdir)
    this.allowedWorkdirs.add(normalized)
  }

  /**
   * Unregister a workdir
   */
  async unregisterWorkdir(workdir: string): Promise<void> {
    const normalized = path.resolve(workdir)
    this.allowedWorkdirs.delete(normalized)
  }

  /**
   * Check if a path is within allowed workdirs
   */
  private isPathAllowed(targetPath: string): boolean {
    const normalized = path.resolve(targetPath)
    for (const workdir of this.allowedWorkdirs) {
      // Check if targetPath is equal to or under the workdir
      if (normalized === workdir || normalized.startsWith(workdir + path.sep)) {
        return true
      }
    }
    return false
  }

  /**
   * Read directory (shallow, only first level)
   * Use expandDirectory to load subdirectory contents
   */
  async readDirectory(dirPath: string): Promise<AcpFileNode[]> {
    // Security check: only allow reading within registered workdirs
    if (!this.isPathAllowed(dirPath)) {
      console.warn(`[AcpWorkspace] Blocked read attempt for unauthorized path: ${dirPath}`)
      return []
    }
    return readDirectoryShallow(dirPath)
  }

  /**
   * Expand a directory to load its children (lazy loading)
   * @param dirPath Directory path to expand
   */
  async expandDirectory(dirPath: string): Promise<AcpFileNode[]> {
    // Security check: only allow reading within registered workdirs
    if (!this.isPathAllowed(dirPath)) {
      console.warn(`[AcpWorkspace] Blocked expand attempt for unauthorized path: ${dirPath}`)
      return []
    }
    return readDirectoryShallow(dirPath)
  }

  /**
   * Get plan entries
   */
  async getPlanEntries(conversationId: string): Promise<AcpPlanEntry[]> {
    return this.planManager.getEntries(conversationId)
  }

  /**
   * Update plan entries (called by acpContentMapper)
   */
  async updatePlanEntries(conversationId: string, entries: AcpRawPlanEntry[]): Promise<void> {
    const updated = this.planManager.updateEntries(conversationId, entries)

    // Send event to renderer
    eventBus.sendToRenderer(ACP_WORKSPACE_EVENTS.PLAN_UPDATED, SendTarget.ALL_WINDOWS, {
      conversationId,
      entries: updated
    })
  }

  /**
   * Emit terminal output snippet (called by acpContentMapper)
   */
  async emitTerminalSnippet(conversationId: string, snippet: AcpTerminalSnippet): Promise<void> {
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
