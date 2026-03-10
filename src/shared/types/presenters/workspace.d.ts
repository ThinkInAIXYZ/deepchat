/**
 * Workspace Types
 * Types for the unified right sidepanel workspace experience.
 */

export type SidePanelTab = 'workspace' | 'browser'

export type WorkspaceNavSection = 'artifacts' | 'files' | 'git'

export type WorkspaceViewMode = 'preview' | 'code'

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

export type WorkspaceFilePreviewKind = 'text' | 'markdown' | 'html' | 'svg' | 'image' | 'binary'

export type WorkspaceFileMetadata = {
  fileName: string
  fileSize: number
  fileDescription?: string
  fileCreated: Date
  fileModified: Date
}

export type WorkspaceFilePreview = {
  path: string
  relativePath: string
  name: string
  mimeType: string
  kind: WorkspaceFilePreviewKind
  content: string
  thumbnail?: string
  language?: string | null
  metadata: WorkspaceFileMetadata
}

export type WorkspaceGitChangeType =
  | 'modified'
  | 'added'
  | 'deleted'
  | 'renamed'
  | 'copied'
  | 'untracked'
  | 'ignored'
  | 'unmerged'

export type WorkspaceGitFileChange = {
  path: string
  relativePath: string
  previousPath?: string | null
  stagedStatus: string | null
  unstagedStatus: string | null
  type: WorkspaceGitChangeType
}

export type WorkspaceGitState = {
  workspacePath: string
  branch: string | null
  ahead: number
  behind: number
  changes: WorkspaceGitFileChange[]
}

export type WorkspaceGitDiff = {
  workspacePath: string
  filePath: string | null
  relativePath: string | null
  staged: string
  unstaged: string
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
   * Register a workdir path as allowed for reading (ACP alias)
   * @param workdir Workspace directory path
   */
  registerWorkdir(workdir: string): Promise<void>

  /**
   * Unregister a workspace path
   * @param workspacePath Workspace directory path
   */
  unregisterWorkspace(workspacePath: string): Promise<void>

  /**
   * Unregister a workdir path (ACP alias)
   * @param workdir Workspace directory path
   */
  unregisterWorkdir(workdir: string): Promise<void>

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
   * Read a workspace file and normalize it to a preview-friendly payload.
   * @param filePath Absolute file path
   */
  readFilePreview(filePath: string): Promise<WorkspaceFilePreview | null>

  /**
   * Read git status for the provided workspace path.
   * Returns null when git is unavailable or the workspace is not a git repo.
   * @param workspacePath Workspace directory path
   */
  getGitStatus(workspacePath: string): Promise<WorkspaceGitState | null>

  /**
   * Read git diff for the provided workspace path and optional file path.
   * Returns null when git is unavailable or the workspace is not a git repo.
   * @param workspacePath Workspace directory path
   * @param filePath Optional absolute file path within the workspace
   */
  getGitDiff(workspacePath: string, filePath?: string): Promise<WorkspaceGitDiff | null>

  /**
   * Search workspace files by query (query does not include @)
   * @param workspacePath Workspace directory path
   * @param query Search query (plain string)
   */
  searchFiles(workspacePath: string, query: string): Promise<WorkspaceFileNode[]>
}
