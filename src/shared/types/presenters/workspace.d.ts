/**
 * Workspace Types
 * Types for the generic workspace panel functionality (supports all Agent modes)
 */

/**
 * Plan entry status
 */
export type WorkspacePlanStatus = 'pending' | 'in_progress' | 'completed' | 'failed' | 'skipped'

/**
 * Plan entry - task from Agent
 */
export type WorkspacePlanEntry = {
  /** Unique identifier (system generated) */
  id: string
  /** Task content description */
  content: string
  /** Task status */
  status: WorkspacePlanStatus
  /** Priority (optional, from agent) */
  priority?: string | null
  /** Update timestamp */
  updatedAt: number
}

/**
 * File tree node
 */
export type WorkspaceFileNode = {
  /** File/directory name */
  name: string
  /** Full path */
  path: string
  /** Whether it's a directory */
  isDirectory: boolean
  /** Child nodes (directories only) */
  children?: WorkspaceFileNode[]
  /** Whether expanded (frontend state) */
  expanded?: boolean
}

/**
 * Terminal output snippet - from Agent tool_call terminal output
 */
export type WorkspaceTerminalSnippet = {
  /** Unique identifier */
  id: string
  /** Executed command */
  command: string
  /** Working directory */
  cwd?: string
  /** Output content (truncated) */
  output: string
  /** Whether truncated */
  truncated: boolean
  /** Exit code (after command completion) */
  exitCode?: number | null
  /** Timestamp */
  timestamp: number
}

/**
 * Raw plan entry from agent content mapper
 */
export type WorkspaceRawPlanEntry = {
  content: string
  status?: string | null
  priority?: string | null
}

/**
 * Workspace Presenter interface
 */
export interface IWorkspacePresenter {
  /**
   * Register a workspace path as allowed for reading (security boundary)
   * @param workspacePath Workspace directory path
   */
  registerWorkspace(workspacePath: string): Promise<void>

  /**
   * Unregister a workspace path
   * @param workspacePath Workspace directory path
   */
  unregisterWorkspace(workspacePath: string): Promise<void>

  /**
   * Read directory (shallow, only first level)
   * Use expandDirectory to load subdirectory contents
   * @param dirPath Directory path
   * @returns Array of file tree nodes (directories have children = undefined)
   */
  readDirectory(dirPath: string): Promise<WorkspaceFileNode[]>

  /**
   * Expand a directory to load its children (lazy loading)
   * @param dirPath Directory path to expand
   * @returns Array of child file tree nodes
   */
  expandDirectory(dirPath: string): Promise<WorkspaceFileNode[]>

  /**
   * Reveal a file or directory in the system file manager
   * @param filePath Path to reveal
   */
  revealFileInFolder(filePath: string): Promise<void>

  /**
   * Open a file or directory using the system default application
   * @param filePath Path to open
   */
  openFile(filePath: string): Promise<void>

  /**
   * Get plan entries for a conversation
   * @param conversationId Conversation ID
   */
  getPlanEntries(conversationId: string): Promise<WorkspacePlanEntry[]>

  /**
   * Update plan entries for a conversation (called internally by Agent events)
   * @param conversationId Conversation ID
   * @param entries Raw plan entries from agent
   */
  updatePlanEntries(conversationId: string, entries: WorkspaceRawPlanEntry[]): Promise<void>

  /**
   * Emit terminal snippet (called internally by Agent events)
   * @param conversationId Conversation ID
   * @param snippet Terminal snippet
   */
  emitTerminalSnippet(conversationId: string, snippet: WorkspaceTerminalSnippet): Promise<void>

  /**
   * Clear workspace data for a conversation
   * @param conversationId Conversation ID
   */
  clearWorkspaceData(conversationId: string): Promise<void>
}
