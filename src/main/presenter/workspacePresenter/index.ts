import path from 'path'
import fs from 'fs'
import { execFile } from 'child_process'
import { promisify } from 'util'
import { shell } from 'electron'
import { readDirectoryShallow } from './directoryReader'
import { searchWorkspaceFiles } from './workspaceFileSearch'
import type {
  IFilePresenter,
  IWorkspacePresenter,
  WorkspaceFileNode,
  WorkspaceFilePreview,
  WorkspaceFilePreviewKind,
  WorkspaceGitChangeType,
  WorkspaceGitDiff,
  WorkspaceGitState
} from '@shared/presenter'

const execFileAsync = promisify(execFile)

const TEXT_LIKE_MIME_TYPES = new Set([
  'application/json',
  'application/ld+json',
  'application/javascript',
  'application/typescript',
  'application/xml',
  'application/x-yaml',
  'application/yaml',
  'application/x-sh',
  'application/x-httpd-php'
])

export class WorkspacePresenter implements IWorkspacePresenter {
  // Allowed workspace paths (registered by Agent and ACP sessions)
  private readonly allowedPaths = new Set<string>()
  private readonly filePresenter: IFilePresenter

  constructor(filePresenter: IFilePresenter) {
    this.filePresenter = filePresenter
  }

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
   * Uses realpathSync when possible and falls back to resolved paths for deleted files.
   */
  private isPathAllowed(targetPath: string): boolean {
    const normalizedTarget = this.normalizePathForAccess(targetPath)
    const targetWithSep = normalizedTarget.endsWith(path.sep)
      ? normalizedTarget
      : `${normalizedTarget}${path.sep}`

    for (const workspace of this.allowedPaths) {
      const normalizedWorkspace = this.normalizePathForAccess(workspace)
      const workspaceWithSep = normalizedWorkspace.endsWith(path.sep)
        ? normalizedWorkspace
        : `${normalizedWorkspace}${path.sep}`

      if (normalizedTarget === normalizedWorkspace || targetWithSep.startsWith(workspaceWithSep)) {
        return true
      }
    }

    return false
  }

  private normalizePathForAccess(targetPath: string): string {
    try {
      return path.normalize(fs.realpathSync(targetPath))
    } catch {
      return path.normalize(path.resolve(targetPath))
    }
  }

  private getWorkspaceRootForPath(targetPath: string): string | null {
    const normalizedTarget = this.normalizePathForAccess(targetPath)

    for (const workspace of this.allowedPaths) {
      const normalizedWorkspace = this.normalizePathForAccess(workspace)
      const relativePath = path.relative(normalizedWorkspace, normalizedTarget)
      if (
        normalizedTarget === normalizedWorkspace ||
        (relativePath && !relativePath.startsWith('..') && !path.isAbsolute(relativePath))
      ) {
        return normalizedWorkspace
      }
    }

    return null
  }

  private toRelativeWorkspacePath(workspaceRoot: string, targetPath: string): string {
    const normalizedTarget = path.resolve(targetPath)
    const relativePath = path.relative(workspaceRoot, normalizedTarget)
    return relativePath.split(path.sep).join('/')
  }

  private resolvePreviewKind(mimeType: string, filePath: string): WorkspaceFilePreviewKind {
    const extension = path.extname(filePath).toLowerCase()

    if (mimeType === 'text/markdown' || ['.md', '.markdown', '.mdx'].includes(extension)) {
      return 'markdown'
    }

    if (mimeType === 'text/html' || mimeType === 'application/xhtml+xml') {
      return 'html'
    }

    if (mimeType === 'image/svg+xml') {
      return 'svg'
    }

    if (mimeType.startsWith('image/')) {
      return 'image'
    }

    if (
      mimeType === 'text/code' ||
      mimeType.startsWith('text/') ||
      TEXT_LIKE_MIME_TYPES.has(mimeType) ||
      mimeType.endsWith('+json') ||
      mimeType.endsWith('+xml')
    ) {
      return 'text'
    }

    return 'binary'
  }

  private inferLanguage(filePath: string, kind: WorkspaceFilePreviewKind): string | null {
    if (kind === 'markdown') return 'markdown'
    if (kind === 'html') return 'html'
    if (kind === 'svg') return 'svg'
    if (kind !== 'text') return null

    const extension = path.extname(filePath).slice(1).toLowerCase()
    return extension || null
  }

  private async runGitCommand(workspacePath: string, args: string[]): Promise<string | null> {
    try {
      const result = await execFileAsync('git', args, {
        cwd: workspacePath,
        windowsHide: true,
        maxBuffer: 8 * 1024 * 1024
      })
      return result.stdout.trimEnd()
    } catch (error) {
      if (
        typeof error === 'object' &&
        error !== null &&
        'code' in error &&
        (error as { code?: string }).code === 'ENOENT'
      ) {
        return null
      }

      throw error
    }
  }

  private async resolveGitWorkspace(workspacePath: string): Promise<string | null> {
    try {
      const repoRoot = await this.runGitCommand(workspacePath, ['rev-parse', '--show-toplevel'])
      return repoRoot?.split(/\r?\n/)[0]?.trim() || null
    } catch {
      return null
    }
  }

  private normalizeGitPath(value: string): string {
    const trimmed = value.trim()
    if (trimmed.startsWith('"') && trimmed.endsWith('"')) {
      try {
        return JSON.parse(trimmed) as string
      } catch {
        return trimmed.slice(1, -1)
      }
    }
    return trimmed
  }

  private resolveGitChangeType(
    stagedStatus: string | null,
    unstagedStatus: string | null
  ): WorkspaceGitChangeType {
    const status = stagedStatus || unstagedStatus || '?'

    switch (status) {
      case 'A':
        return 'added'
      case 'D':
        return 'deleted'
      case 'R':
        return 'renamed'
      case 'C':
        return 'copied'
      case '?':
        return 'untracked'
      case '!':
        return 'ignored'
      case 'U':
        return 'unmerged'
      default:
        return 'modified'
    }
  }

  private parseBranchSummary(summary: string): {
    branch: string | null
    ahead: number
    behind: number
  } {
    const trimmed = summary.replace(/^##\s*/, '').trim()
    if (!trimmed) {
      return { branch: null, ahead: 0, behind: 0 }
    }

    const branchToken = trimmed.split(' ')[0] || ''
    const branchName = branchToken.split('...')[0]
    const aheadMatch = trimmed.match(/ahead (\d+)/)
    const behindMatch = trimmed.match(/behind (\d+)/)

    return {
      branch: branchName === 'HEAD' || branchName === '(no' ? null : branchName,
      ahead: aheadMatch ? Number(aheadMatch[1]) : 0,
      behind: behindMatch ? Number(behindMatch[1]) : 0
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
   * Read file preview data for the sidepanel viewer.
   */
  async readFilePreview(filePath: string): Promise<WorkspaceFilePreview | null> {
    if (!this.isPathAllowed(filePath)) {
      console.warn(`[Workspace] Blocked preview attempt for unauthorized path: ${filePath}`)
      return null
    }

    try {
      const preparedFile = await this.filePresenter.prepareFileCompletely(
        filePath,
        undefined,
        'origin'
      )
      const workspaceRoot = this.getWorkspaceRootForPath(filePath)
      const kind = this.resolvePreviewKind(preparedFile.mimeType, filePath)

      return {
        path: preparedFile.path,
        relativePath: workspaceRoot
          ? this.toRelativeWorkspacePath(workspaceRoot, preparedFile.path)
          : path.basename(preparedFile.path),
        name: preparedFile.name,
        mimeType: preparedFile.mimeType,
        kind,
        content: kind === 'image' ? (preparedFile.thumbnail ?? '') : (preparedFile.content ?? ''),
        thumbnail: preparedFile.thumbnail,
        language: this.inferLanguage(filePath, kind),
        metadata: {
          ...preparedFile.metadata
        }
      }
    } catch (error) {
      console.error(`[Workspace] Failed to read file preview: ${filePath}`, error)
      return null
    }
  }

  /**
   * Read git status for the current workspace.
   */
  async getGitStatus(workspacePath: string): Promise<WorkspaceGitState | null> {
    if (!this.isPathAllowed(workspacePath)) {
      console.warn(`[Workspace] Blocked git status attempt for unauthorized path: ${workspacePath}`)
      return null
    }

    const repoRoot = await this.resolveGitWorkspace(workspacePath)
    if (!repoRoot) {
      return null
    }

    try {
      const output = await this.runGitCommand(workspacePath, [
        'status',
        '--porcelain=v1',
        '--branch'
      ])
      if (output == null) {
        return null
      }

      const lines = output.split(/\r?\n/).filter(Boolean)
      const branchLine = lines.find((line) => line.startsWith('##'))
      const branchSummary = this.parseBranchSummary(branchLine ?? '')
      const changes = lines
        .filter((line) => !line.startsWith('##'))
        .map((line) => {
          const stagedStatus = line[0] && line[0] !== ' ' ? line[0] : null
          const unstagedStatus = line[1] && line[1] !== ' ' ? line[1] : null
          const rawPath = line.slice(3)
          const [previousPathPart, currentPathPart] = rawPath.includes(' -> ')
            ? rawPath.split(' -> ')
            : [null, rawPath]
          const currentRelativePath = this.normalizeGitPath(currentPathPart ?? rawPath)
          const previousPath = previousPathPart ? this.normalizeGitPath(previousPathPart) : null

          return {
            path: path.resolve(repoRoot, currentRelativePath),
            relativePath: currentRelativePath,
            previousPath,
            stagedStatus,
            unstagedStatus,
            type: this.resolveGitChangeType(stagedStatus, unstagedStatus)
          }
        })

      return {
        workspacePath: repoRoot,
        branch: branchSummary.branch,
        ahead: branchSummary.ahead,
        behind: branchSummary.behind,
        changes
      }
    } catch (error) {
      console.warn(`[Workspace] Failed to read git status for ${workspacePath}`, error)
      return null
    }
  }

  /**
   * Read git diff for the current workspace and optional file.
   */
  async getGitDiff(workspacePath: string, filePath?: string): Promise<WorkspaceGitDiff | null> {
    if (!this.isPathAllowed(workspacePath)) {
      console.warn(`[Workspace] Blocked git diff attempt for unauthorized path: ${workspacePath}`)
      return null
    }

    if (filePath && !this.isPathAllowed(filePath)) {
      console.warn(`[Workspace] Blocked git diff file attempt for unauthorized path: ${filePath}`)
      return null
    }

    const repoRoot = await this.resolveGitWorkspace(workspacePath)
    if (!repoRoot) {
      return null
    }

    const relativePath = filePath ? this.toRelativeWorkspacePath(repoRoot, filePath) : null
    const fileArgs = relativePath ? ['--', relativePath] : []

    try {
      const [staged, unstaged] = await Promise.all([
        this.runGitCommand(workspacePath, ['diff', '--cached', ...fileArgs]),
        this.runGitCommand(workspacePath, ['diff', ...fileArgs])
      ])

      return {
        workspacePath: repoRoot,
        filePath: filePath ? path.resolve(filePath) : null,
        relativePath,
        staged: staged ?? '',
        unstaged: unstaged ?? ''
      }
    } catch (error) {
      console.warn(`[Workspace] Failed to read git diff for ${workspacePath}`, error)
      return null
    }
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
