/**
 * ACP Workspace Types
 * Types for the ACP workspace panel functionality
 */

/**
 * Plan entry status
 */
export type ACP_PLAN_STATUS = 'pending' | 'in_progress' | 'completed' | 'failed' | 'skipped'

/**
 * Plan entry - task from ACP agent
 */
export type ACP_PLAN_ENTRY = {
  /** Unique identifier (system generated) */
  id: string
  /** Task content description */
  content: string
  /** Task status */
  status: ACP_PLAN_STATUS
  /** Priority (optional, from agent) */
  priority?: string | null
  /** Update timestamp */
  updatedAt: number
}

/**
 * File tree node
 */
export type ACP_FILE_NODE = {
  /** File/directory name */
  name: string
  /** Full path */
  path: string
  /** Whether it's a directory */
  isDirectory: boolean
  /** Child nodes (directories only) */
  children?: ACP_FILE_NODE[]
  /** Whether expanded (frontend state) */
  expanded?: boolean
}

/**
 * Terminal output snippet - from ACP tool_call terminal output
 */
export type ACP_TERMINAL_SNIPPET = {
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
export type ACP_RAW_PLAN_ENTRY = {
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
  readDirectory(dirPath: string): Promise<ACP_FILE_NODE[]>

  /**
   * Expand a directory to load its children (lazy loading)
   * @param dirPath Directory path to expand
   * @returns Array of child file tree nodes
   */
  expandDirectory(dirPath: string): Promise<ACP_FILE_NODE[]>

  /**
   * Get plan entries for a conversation
   * @param conversationId Conversation ID
   */
  getPlanEntries(conversationId: string): Promise<ACP_PLAN_ENTRY[]>

  /**
   * Update plan entries for a conversation (called internally by ACP events)
   * @param conversationId Conversation ID
   * @param entries Raw plan entries from agent
   */
  updatePlanEntries(conversationId: string, entries: ACP_RAW_PLAN_ENTRY[]): Promise<void>

  /**
   * Emit terminal snippet (called internally by ACP events)
   * @param conversationId Conversation ID
   * @param snippet Terminal snippet
   */
  emitTerminalSnippet(conversationId: string, snippet: ACP_TERMINAL_SNIPPET): Promise<void>

  /**
   * Clear workspace data for a conversation
   * @param conversationId Conversation ID
   */
  clearWorkspaceData(conversationId: string): Promise<void>
}
