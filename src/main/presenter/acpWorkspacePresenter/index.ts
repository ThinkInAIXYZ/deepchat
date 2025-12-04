import path from 'path'
import { eventBus, SendTarget } from '@/eventbus'
import { ACP_WORKSPACE_EVENTS } from '@/events'
import { readDirectoryTree } from './directoryReader'
import { PlanStateManager } from './planStateManager'
import type {
  IAcpWorkspacePresenter,
  ACP_FILE_NODE,
  ACP_PLAN_ENTRY,
  ACP_TERMINAL_SNIPPET,
  ACP_RAW_PLAN_ENTRY
} from '@shared/presenter'

export class AcpWorkspacePresenter implements IAcpWorkspacePresenter {
  private readonly planManager = new PlanStateManager()
  // Allowed workdir paths (registered by ACP sessions)
  private readonly allowedWorkdirs = new Set<string>()

  /**
   * Register a workdir as allowed for reading
   */
  registerWorkdir(workdir: string): void {
    const normalized = path.resolve(workdir)
    this.allowedWorkdirs.add(normalized)
  }

  /**
   * Unregister a workdir
   */
  unregisterWorkdir(workdir: string): void {
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
   * Read directory tree
   */
  async readDirectory(dirPath: string, maxDepth: number = 3): Promise<ACP_FILE_NODE[]> {
    // Security check: only allow reading within registered workdirs
    if (!this.isPathAllowed(dirPath)) {
      console.warn(`[AcpWorkspace] Blocked read attempt for unauthorized path: ${dirPath}`)
      return []
    }
    return readDirectoryTree(dirPath, 0, maxDepth)
  }

  /**
   * Get plan entries
   */
  async getPlanEntries(conversationId: string): Promise<ACP_PLAN_ENTRY[]> {
    return this.planManager.getEntries(conversationId)
  }

  /**
   * Update plan entries (called by acpContentMapper)
   */
  async updatePlanEntries(conversationId: string, entries: ACP_RAW_PLAN_ENTRY[]): Promise<void> {
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
  async emitTerminalSnippet(conversationId: string, snippet: ACP_TERMINAL_SNIPPET): Promise<void> {
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
