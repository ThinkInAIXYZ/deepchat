import path from 'path'
import fs from 'fs'
import { execFile } from 'child_process'
import { promisify } from 'util'
import { shell } from 'electron'
import { FSWatcher, watch } from 'chokidar'
import { eventBus, SendTarget } from '@/eventbus'
import { WORKSPACE_EVENTS } from '@/events'
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
  WorkspaceGitState,
  WorkspaceInvalidationEvent,
  WorkspaceInvalidationKind,
  WorkspaceInvalidationSource
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

const WATCH_IGNORED_DIRS = [
  'node_modules',
  'dist',
  'build',
  '__pycache__',
  '.venv',
  'venv',
  '.idea',
  '.vscode',
  '.cache',
  'coverage',
  '.next',
  '.nuxt',
  'out',
  '.turbo'
] as const

const WATCH_DEBOUNCE_MS = 120
const WATCH_STABILITY_THRESHOLD_MS = 250
const WATCH_POLL_INTERVAL_MS = 100

type WorkspaceWatchRuntime = {
  workspacePath: string
  refCount: number
  contentWatcher: FSWatcher
  gitWatcher: FSWatcher | null
  gitWatchKey: string | null
  debounceTimer: NodeJS.Timeout | null
  pendingKind: WorkspaceInvalidationKind | null
  pendingSource: WorkspaceInvalidationSource | null
  disposed: boolean
}

const getInvalidationPriority = (kind: WorkspaceInvalidationKind): number => {
  switch (kind) {
    case 'full':
      return 3
    case 'fs':
      return 2
    case 'git':
      return 1
    default:
      return 0
  }
}

/**
 * Workspace lifecycle contract:
 * - Main process owns workspace invalidation production.
 * - Content watcher emits `fs`, git metadata watcher emits `git`.
 * - Renderer consumes invalidation events and decides whether to run a full or git-only refresh.
 * - `registerWorkspace` remains a pure security boundary; `watchWorkspace` controls watcher lifetime.
 */
export class WorkspacePresenter implements IWorkspacePresenter {
  private readonly allowedPaths = new Set<string>()
  private readonly filePresenter: IFilePresenter
  private readonly watchRuntimes = new Map<string, WorkspaceWatchRuntime>()

  constructor(filePresenter: IFilePresenter) {
    this.filePresenter = filePresenter
  }

  async registerWorkspace(workspacePath: string): Promise<void> {
    const normalized = path.resolve(workspacePath)
    this.allowedPaths.add(normalized)
  }

  async registerWorkdir(workdir: string): Promise<void> {
    await this.registerWorkspace(workdir)
  }

  async unregisterWorkspace(workspacePath: string): Promise<void> {
    const normalized = path.resolve(workspacePath)
    this.allowedPaths.delete(normalized)
  }

  async unregisterWorkdir(workdir: string): Promise<void> {
    await this.unregisterWorkspace(workdir)
  }

  async watchWorkspace(workspacePath: string): Promise<void> {
    const normalized = path.resolve(workspacePath)
    if (!this.isPathAllowed(normalized)) {
      console.warn(`[Workspace] Blocked watch attempt for unauthorized path: ${workspacePath}`)
      return
    }

    const existing = this.watchRuntimes.get(normalized)
    if (existing) {
      existing.refCount += 1
      return
    }

    const runtime: WorkspaceWatchRuntime = {
      workspacePath: normalized,
      refCount: 1,
      contentWatcher: this.createContentWatcher(normalized),
      gitWatcher: null,
      gitWatchKey: null,
      debounceTimer: null,
      pendingKind: null,
      pendingSource: null,
      disposed: false
    }

    this.watchRuntimes.set(normalized, runtime)
    await this.refreshGitWatcher(runtime)
  }

  async unwatchWorkspace(workspacePath: string): Promise<void> {
    const normalized = path.resolve(workspacePath)
    const runtime = this.watchRuntimes.get(normalized)
    if (!runtime) {
      return
    }

    runtime.refCount -= 1
    if (runtime.refCount > 0) {
      return
    }

    this.watchRuntimes.delete(normalized)
    await this.disposeRuntime(runtime)
  }

  destroy(): void {
    const runtimes = Array.from(this.watchRuntimes.values())
    this.watchRuntimes.clear()
    for (const runtime of runtimes) {
      void this.disposeRuntime(runtime)
    }
  }

  private createContentWatcher(workspacePath: string): FSWatcher {
    const watcher = watch(workspacePath, {
      ignoreInitial: true,
      atomic: true,
      followSymlinks: false,
      ignored: (watchPath) => this.shouldIgnoreContentWatchPath(watchPath),
      awaitWriteFinish: {
        stabilityThreshold: WATCH_STABILITY_THRESHOLD_MS,
        pollInterval: WATCH_POLL_INTERVAL_MS
      }
    })

    watcher.on('all', (_eventName, targetPath) => {
      const runtime = this.watchRuntimes.get(workspacePath)
      if (!runtime || runtime.disposed) {
        return
      }

      if (this.isGitDirectoryEvent(targetPath)) {
        void this.refreshGitWatcher(runtime)
        this.scheduleInvalidation(runtime, 'full', 'watcher')
        return
      }

      this.scheduleInvalidation(runtime, 'fs', 'watcher')
    })

    watcher.on('error', (error) => {
      console.error(`[Workspace] Content watcher error for ${workspacePath}:`, error)
    })

    return watcher
  }

  private shouldIgnoreContentWatchPath(watchPath: string): boolean {
    const normalizedPath = path.normalize(watchPath)
    if (normalizedPath.includes(`${path.sep}.git${path.sep}`)) {
      return true
    }

    const baseName = path.basename(normalizedPath)
    if (WATCH_IGNORED_DIRS.includes(baseName as (typeof WATCH_IGNORED_DIRS)[number])) {
      return true
    }

    return WATCH_IGNORED_DIRS.some((segment) =>
      normalizedPath.includes(`${path.sep}${segment}${path.sep}`)
    )
  }

  private isGitDirectoryEvent(targetPath: string): boolean {
    return path.basename(path.normalize(targetPath)) === '.git'
  }

  private scheduleInvalidation(
    runtime: WorkspaceWatchRuntime,
    kind: WorkspaceInvalidationKind,
    source: WorkspaceInvalidationSource
  ): void {
    if (runtime.disposed) {
      return
    }

    if (
      !runtime.pendingKind ||
      getInvalidationPriority(kind) >= getInvalidationPriority(runtime.pendingKind)
    ) {
      runtime.pendingKind = kind
      runtime.pendingSource = source
    }

    if (runtime.debounceTimer) {
      clearTimeout(runtime.debounceTimer)
    }

    runtime.debounceTimer = setTimeout(() => {
      runtime.debounceTimer = null

      const currentRuntime = this.watchRuntimes.get(runtime.workspacePath)
      if (!currentRuntime || currentRuntime !== runtime || runtime.disposed) {
        return
      }

      const payload: WorkspaceInvalidationEvent = {
        workspacePath: runtime.workspacePath,
        kind: runtime.pendingKind ?? kind,
        source: runtime.pendingSource ?? source
      }
      runtime.pendingKind = null
      runtime.pendingSource = null
      this.emitInvalidation(payload)
    }, WATCH_DEBOUNCE_MS)
  }

  private emitInvalidation(payload: WorkspaceInvalidationEvent): void {
    eventBus.sendToRenderer(WORKSPACE_EVENTS.INVALIDATED, SendTarget.ALL_WINDOWS, payload)
  }

  private async refreshGitWatcher(runtime: WorkspaceWatchRuntime): Promise<void> {
    const metadata = await this.resolveGitWatchMetadata(runtime.workspacePath)

    if (runtime.disposed || this.watchRuntimes.get(runtime.workspacePath) !== runtime) {
      return
    }

    const nextWatchKey = metadata ? metadata.paths.join('\0') : null
    if (runtime.gitWatchKey === nextWatchKey) {
      return
    }

    const previousWatcher = runtime.gitWatcher
    runtime.gitWatcher = null
    runtime.gitWatchKey = nextWatchKey

    if (previousWatcher) {
      await previousWatcher.close()
    }

    if (!metadata) {
      return
    }

    const gitWatcher = watch(metadata.paths, {
      ignoreInitial: true,
      atomic: true,
      followSymlinks: false,
      awaitWriteFinish: {
        stabilityThreshold: WATCH_STABILITY_THRESHOLD_MS,
        pollInterval: WATCH_POLL_INTERVAL_MS
      }
    })

    gitWatcher.on('all', () => {
      const currentRuntime = this.watchRuntimes.get(runtime.workspacePath)
      if (!currentRuntime || currentRuntime !== runtime || runtime.disposed) {
        return
      }
      this.scheduleInvalidation(runtime, 'git', 'watcher')
    })

    gitWatcher.on('error', (error) => {
      console.error(`[Workspace] Git watcher error for ${runtime.workspacePath}:`, error)
    })

    if (runtime.disposed || this.watchRuntimes.get(runtime.workspacePath) !== runtime) {
      await gitWatcher.close()
      return
    }

    runtime.gitWatcher = gitWatcher
  }

  private async resolveGitWatchMetadata(
    workspacePath: string
  ): Promise<{ repoRoot: string; paths: string[] } | null> {
    const repoRoot = await this.resolveGitWorkspace(workspacePath)
    if (!repoRoot) {
      return null
    }

    const [headPath, indexPath, packedRefsPath, refsPath] = await Promise.all([
      this.resolveGitPath(workspacePath, 'HEAD'),
      this.resolveGitPath(workspacePath, 'index'),
      this.resolveGitPath(workspacePath, 'packed-refs'),
      this.resolveGitPath(workspacePath, 'refs')
    ])

    const paths = Array.from(
      new Set(
        [headPath, indexPath, packedRefsPath, refsPath].filter(
          (value): value is string => typeof value === 'string'
        )
      )
    )
    if (paths.length === 0) {
      return null
    }

    return { repoRoot, paths }
  }

  private async resolveGitPath(workspacePath: string, key: string): Promise<string | null> {
    try {
      const value = await this.runGitCommand(workspacePath, ['rev-parse', '--git-path', key])
      const resolved = value?.split(/\r?\n/)[0]?.trim()
      if (!resolved) {
        return null
      }

      return path.isAbsolute(resolved)
        ? path.normalize(resolved)
        : path.normalize(path.resolve(workspacePath, resolved))
    } catch {
      return null
    }
  }

  private async disposeRuntime(runtime: WorkspaceWatchRuntime): Promise<void> {
    runtime.disposed = true

    if (runtime.debounceTimer) {
      clearTimeout(runtime.debounceTimer)
      runtime.debounceTimer = null
    }

    const closures: Array<Promise<void>> = [runtime.contentWatcher.close()]
    if (runtime.gitWatcher) {
      closures.push(runtime.gitWatcher.close())
      runtime.gitWatcher = null
    }

    await Promise.allSettled(closures)
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

  async readDirectory(dirPath: string): Promise<WorkspaceFileNode[]> {
    if (!this.isPathAllowed(dirPath)) {
      console.warn(`[Workspace] Blocked read attempt for unauthorized path: ${dirPath}`)
      return []
    }
    return readDirectoryShallow(dirPath)
  }

  async expandDirectory(dirPath: string): Promise<WorkspaceFileNode[]> {
    if (!this.isPathAllowed(dirPath)) {
      console.warn(`[Workspace] Blocked expand attempt for unauthorized path: ${dirPath}`)
      return []
    }
    return readDirectoryShallow(dirPath)
  }

  async revealFileInFolder(filePath: string): Promise<void> {
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

  async searchFiles(workspacePath: string, query: string): Promise<WorkspaceFileNode[]> {
    if (!this.isPathAllowed(workspacePath)) {
      console.warn(`[Workspace] Blocked search attempt for unauthorized path: ${workspacePath}`)
      return []
    }
    return await searchWorkspaceFiles(workspacePath, query)
  }
}
