/**
 * ACP Workspace Types
 * Types for the ACP workspace panel functionality
 */

/**
 * Plan entry status
 */
export type AcpPlanStatus = 'pending' | 'in_progress' | 'completed' | 'failed' | 'skipped'

/**
 * Plan entry - task from ACP agent
 */
export type AcpPlanEntry = {
  /** Unique identifier (system generated) */
  id: string
  /** Task content description */
  content: string
  /** Task status */
  status: AcpPlanStatus
  /** Priority (optional, from agent) */
  priority?: string | null
  /** Update timestamp */
  updatedAt: number
}

/**
 * File tree node
 */
export type AcpFileNode = {
  /** File/directory name */
  name: string
  /** Full path */
  path: string
  /** Whether it's a directory */
  isDirectory: boolean
  /** Child nodes (directories only) */
  children?: AcpFileNode[]
  /** Whether expanded (frontend state) */
  expanded?: boolean
}

/**
 * Terminal output snippet - from ACP tool_call terminal output
 */
export type AcpTerminalSnippet = {
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
 * Raw plan entry from acpContentMapper
 */
export type AcpRawPlanEntry = {
  content: string
  status?: string | null
  priority?: string | null
}

/**
 * Workspace Presenter interface
 */
export interface IAcpWorkspacePresenter {
  /**
   * Register a workdir as allowed for reading (security boundary)
   * @param workdir Workspace directory path
   */
  registerWorkdir(workdir: string): Promise<void>

  /**
   * Unregister a workdir
   * @param workdir Workspace directory path
   */
  unregisterWorkdir(workdir: string): Promise<void>

  /**
   * Read directory (shallow, only first level)
   * Use expandDirectory to load subdirectory contents
   * @param dirPath Directory path
   * @returns Array of file tree nodes (directories have children = undefined)
   */
  readDirectory(dirPath: string): Promise<AcpFileNode[]>

  /**
   * Expand a directory to load its children (lazy loading)
   * @param dirPath Directory path to expand
   * @returns Array of child file tree nodes
   */
  expandDirectory(dirPath: string): Promise<AcpFileNode[]>

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
  getPlanEntries(conversationId: string): Promise<AcpPlanEntry[]>

  /**
   * Update plan entries for a conversation (called internally by ACP events)
   * @param conversationId Conversation ID
   * @param entries Raw plan entries from agent
   */
  updatePlanEntries(conversationId: string, entries: AcpRawPlanEntry[]): Promise<void>

  /**
   * Emit terminal snippet (called internally by ACP events)
   * @param conversationId Conversation ID
   * @param snippet Terminal snippet
   */
  emitTerminalSnippet(conversationId: string, snippet: AcpTerminalSnippet): Promise<void>

  /**
   * Clear workspace data for a conversation
   * @param conversationId Conversation ID
   */
  clearWorkspaceData(conversationId: string): Promise<void>
}
