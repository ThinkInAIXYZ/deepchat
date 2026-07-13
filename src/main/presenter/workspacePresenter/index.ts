import path from 'path'
import fs from 'fs'
import { execFile } from 'child_process'
import { fileURLToPath } from 'url'
import { promisify } from 'util'
import { shell } from 'electron'
import { publishDeepchatEvent } from '@/routes/publishDeepchatEvent'
import {
  createWatcherRequestId,
  getFileWatcherService,
  type IFileWatcherService,
  type WatcherEventBatch,
  type WatcherStatus,
  type WatchHandle
} from '@/lib/fileWatcher'
import { readDirectoryShallow } from './directoryReader'
import { searchWorkspaceFiles } from './workspaceFileSearch'
import {
  createWorkspacePreviewFileUrl,
  createWorkspacePreviewUrl,
  registerWorkspacePreviewFile,
  registerWorkspacePreviewRoot,
  unregisterWorkspacePreviewFile,
  unregisterWorkspacePreviewRoot
} from './workspacePreviewProtocol'
import type {
  IFilePresenter,
  IWorkspacePresenter,
  ResolveMarkdownLinkedFileInput,
  WorkspaceFileNode,
  WorkspaceFilePreview,
  WorkspaceFilePreviewKind,
  WorkspaceGitChangeType,
  WorkspaceGitDiff,
  WorkspaceGitState,
  WorkspaceInvalidationEvent,
  WorkspaceInvalidationKind,
  WorkspaceInvalidationSource,
  WorkspaceWatchStatusEvent,
  WorkspaceLinkedFileResolution
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

type WorkspaceWatchRuntime = {
  workspacePath: string
  refCount: number
  contentWatcher: WatchHandle | null
  gitWatcher: WatchHandle | null
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
  private readonly allowedExactPaths = new Set<string>()
  private readonly filePresenter: IFilePresenter
  private readonly watcherService: IFileWatcherService
  private readonly watchRuntimes = new Map<string, WorkspaceWatchRuntime>()

  constructor(
    filePresenter: IFilePresenter,
    watcherService: IFileWatcherService = getFileWatcherService()
  ) {
    this.filePresenter = filePresenter
    this.watcherService = watcherService
  }

  async registerWorkspace(workspacePath: string): Promise<void> {
    const normalized = path.resolve(workspacePath)
    this.allowedPaths.add(normalized)
    registerWorkspacePreviewRoot(normalized)
  }

  async registerWorkdir(workdir: string): Promise<void> {
    await this.registerWorkspace(workdir)
  }

  async unregisterWorkspace(workspacePath: string): Promise<void> {
    const normalized = path.resolve(workspacePath)
    this.allowedPaths.delete(normalized)
    unregisterWorkspacePreviewRoot(normalized)
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
      contentWatcher: null,
      gitWatcher: null,
      gitWatchKey: null,
      debounceTimer: null,
      pendingKind: null,
      pendingSource: null,
      disposed: false
    }

    this.watchRuntimes.set(normalized, runtime)
    try {
      runtime.contentWatcher = await this.createContentWatcher(normalized)
      if (runtime.disposed || this.watchRuntimes.get(normalized) !== runtime) {
        await runtime.contentWatcher.close()
        runtime.contentWatcher = null
        return
      }
      await this.refreshGitWatcher(runtime)
    } catch (error) {
      this.watchRuntimes.delete(normalized)
      await this.disposeRuntime(runtime)
      throw error
    }
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

  async destroy(): Promise<void> {
    const runtimes = Array.from(this.watchRuntimes.values())
    this.watchRuntimes.clear()
    await Promise.allSettled(runtimes.map((runtime) => this.disposeRuntime(runtime)))

    for (const exactPath of this.allowedExactPaths) {
      unregisterWorkspacePreviewFile(exactPath)
    }
    this.allowedExactPaths.clear()
  }

  private async createContentWatcher(workspacePath: string): Promise<WatchHandle> {
    return await this.watcherService.watch(
      {
        id: createWatcherRequestId('content', 'workspace-content', workspacePath),
        rootPath: workspacePath,
        hostKind: 'content',
        purpose: 'workspace-content',
        recursive: true,
        excludes: this.createContentWatchExcludes(workspacePath),
        fallbackMode: 'snapshot-polling'
      },
      (batch) => this.handleContentWatchBatch(workspacePath, batch),
      (status) => this.emitWatchStatus(workspacePath, status)
    )
  }

  private handleContentWatchBatch(workspacePath: string, batch: WatcherEventBatch): void {
    const runtime = this.watchRuntimes.get(workspacePath)
    if (!runtime || runtime.disposed) {
      return
    }

    const source = this.getInvalidationSourceForBatch(batch)
    let shouldInvalidateFs = false

    for (const event of batch.events) {
      if (event.type === 'overflow' || event.type === 'root-deleted') {
        void this.refreshGitWatcher(runtime).catch((error) => {
          console.warn('[Workspace] Failed to refresh git watcher', {
            workspacePath: runtime.workspacePath,
            error
          })
        })
        this.scheduleInvalidation(runtime, 'full', source)
        return
      }

      if (this.shouldIgnoreContentWatchPath(event.path)) {
        continue
      }

      if (this.isGitDirectoryEvent(event.path)) {
        void this.refreshGitWatcher(runtime).catch((error) => {
          console.warn('[Workspace] Failed to refresh git watcher', {
            workspacePath: runtime.workspacePath,
            error
          })
        })
        this.scheduleInvalidation(runtime, 'full', source)
        return
      }

      shouldInvalidateFs = true
    }

    if (shouldInvalidateFs) {
      this.scheduleInvalidation(runtime, 'fs', source)
    }
  }

  private createContentWatchExcludes(workspacePath: string): string[] {
    const root = workspacePath.split(path.sep).join('/')
    return [
      `${root}/.git/**`,
      ...WATCH_IGNORED_DIRS.flatMap((segment) => [
        `${root}/${segment}/**`,
        `${root}/**/${segment}/**`
      ])
    ]
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
        source: runtime.pendingSource ?? source,
        version: Date.now()
      }
      runtime.pendingKind = null
      runtime.pendingSource = null
      this.emitInvalidation(payload)
    }, WATCH_DEBOUNCE_MS)
  }

  private emitInvalidation(payload: WorkspaceInvalidationEvent): void {
    publishDeepchatEvent('workspace.invalidated', payload)
  }

  private emitWatchStatus(workspacePath: string, status: WatcherStatus): void {
    const payload: WorkspaceWatchStatusEvent = {
      workspacePath,
      health: status.health,
      mode: status.mode,
      reason: status.reason,
      message: status.message,
      version: status.version
    }
    publishDeepchatEvent('workspace.watch.status.changed', payload)
  }

  private getInvalidationSourceForBatch(batch: WatcherEventBatch): WorkspaceInvalidationSource {
    return batch.mode === 'native' ? 'watcher' : 'fallback'
  }

  private async refreshGitWatcher(runtime: WorkspaceWatchRuntime): Promise<void> {
    const metadata = await this.resolveGitWatchMetadata(runtime.workspacePath)

    if (runtime.disposed || this.watchRuntimes.get(runtime.workspacePath) !== runtime) {
      return
    }

    const nextWatchKey = metadata ? `${metadata.watchRoot}\0${metadata.paths.join('\0')}` : null
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

    const gitWatcher = await this.watcherService.watch(
      {
        id: createWatcherRequestId(
          'git',
          'workspace-git',
          `${runtime.workspacePath}:${nextWatchKey}`
        ),
        rootPath: metadata.watchRoot,
        hostKind: 'git',
        purpose: 'workspace-git',
        recursive: true,
        includes: metadata.paths,
        fallbackMode: 'git-metadata-polling'
      },
      (batch) => {
        const currentRuntime = this.watchRuntimes.get(runtime.workspacePath)
        if (!currentRuntime || currentRuntime !== runtime || runtime.disposed) {
          return
        }

        const source = this.getInvalidationSourceForBatch(batch)
        const kind = batch.events.some(
          (event) => event.type === 'overflow' || event.type === 'root-deleted'
        )
          ? 'full'
          : 'git'
        this.scheduleInvalidation(runtime, kind, source)
      },
      (status) => this.emitWatchStatus(runtime.workspacePath, status)
    )

    if (runtime.disposed || this.watchRuntimes.get(runtime.workspacePath) !== runtime) {
      await gitWatcher.close()
      return
    }

    runtime.gitWatcher = gitWatcher
  }

  private async resolveGitWatchMetadata(
    workspacePath: string
  ): Promise<{ repoRoot: string; watchRoot: string; paths: string[] } | null> {
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

    const lockPaths = [headPath, indexPath, packedRefsPath]
      .filter((value): value is string => typeof value === 'string')
      .map((value) => `${value}.lock`)
    const paths = Array.from(
      new Set(
        [headPath, indexPath, packedRefsPath, refsPath, ...lockPaths].filter(
          (value): value is string => typeof value === 'string'
        )
      )
    )
    if (paths.length === 0) {
      return null
    }

    return { repoRoot, watchRoot: repoRoot, paths }
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

    const closures: Array<Promise<void>> = []
    if (runtime.contentWatcher) {
      closures.push(runtime.contentWatcher.close())
      runtime.contentWatcher = null
    }
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

    if (this.allowedExactPaths.has(normalizedTarget)) {
      return true
    }

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

    if (mimeType === 'application/pdf') {
      return 'pdf'
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

  private resolvePreviewUrl(
    workspaceRoot: string | null,
    filePath: string,
    kind: WorkspaceFilePreviewKind
  ): string | undefined {
    if (kind !== 'html' && kind !== 'pdf' && kind !== 'svg') {
      return undefined
    }

    if (workspaceRoot) {
      return createWorkspacePreviewUrl(workspaceRoot, filePath) ?? undefined
    }

    return createWorkspacePreviewFileUrl(filePath)
  }

  private authorizeExactFile(filePath: string): string {
    const normalizedFilePath = this.normalizePathForAccess(filePath)
    this.allowedExactPaths.add(normalizedFilePath)
    registerWorkspacePreviewFile(normalizedFilePath)
    return normalizedFilePath
  }

  private stripMarkdownLinkDecorators(href: string): string {
    const trimmedHref = href.trim()
    const queryIndex = trimmedHref.indexOf('?')
    const hashIndex = trimmedHref.indexOf('#')
    const firstDecoratorIndex = [queryIndex, hashIndex]
      .filter((index) => index >= 0)
      .sort((left, right) => left - right)[0]

    if (firstDecoratorIndex == null) {
      return trimmedHref
    }

    return trimmedHref.slice(0, firstDecoratorIndex)
  }

  private isAbsoluteWindowsPath(value: string): boolean {
    return /^[a-zA-Z]:[\\/]/.test(value)
  }

  private isAbsoluteMarkdownPath(value: string): boolean {
    return value.startsWith('/') || this.isAbsoluteWindowsPath(value)
  }

  private resolveMarkdownLinkedPath(input: ResolveMarkdownLinkedFileInput): string | null {
    const rawHref = this.stripMarkdownLinkDecorators(input.href)
    if (!rawHref) {
      return null
    }

    if (rawHref.startsWith('file://')) {
      try {
        return this.normalizePathForAccess(fileURLToPath(rawHref))
      } catch {
        return null
      }
    }

    if (this.isAbsoluteMarkdownPath(rawHref)) {
      return this.normalizePathForAccess(rawHref)
    }

    const sourceFilePath = input.sourceFilePath?.trim() || null
    const workspacePath = input.workspacePath?.trim() || null
    const baseDir = sourceFilePath
      ? path.dirname(sourceFilePath)
      : workspacePath
        ? workspacePath
        : null

    if (!baseDir) {
      return null
    }

    return this.normalizePathForAccess(path.resolve(baseDir, rawHref))
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

  async resolveMarkdownLinkedFile(
    input: ResolveMarkdownLinkedFileInput
  ): Promise<WorkspaceLinkedFileResolution | null> {
    const resolvedPath = this.resolveMarkdownLinkedPath(input)
    if (!resolvedPath) {
      return null
    }

    let stat: fs.Stats
    try {
      stat = fs.statSync(resolvedPath)
    } catch {
      return null
    }

    if (!stat.isFile()) {
      return null
    }

    const normalizedPath = this.authorizeExactFile(resolvedPath)
    const workspaceRoot = this.getWorkspaceRootForPath(normalizedPath)

    return {
      path: normalizedPath,
      name: path.basename(normalizedPath),
      relativePath: workspaceRoot
        ? this.toRelativeWorkspacePath(workspaceRoot, normalizedPath)
        : normalizedPath,
      workspaceRoot
    }
  }

  async readFilePreview(filePath: string): Promise<WorkspaceFilePreview | null> {
    if (!this.isPathAllowed(filePath)) {
      console.warn(`[Workspace] Blocked preview attempt for unauthorized path: ${filePath}`)
      return null
    }

    try {
      const stats = fs.statSync(filePath)
      if (!stats.isFile()) {
        return null
      }
    } catch {
      return null
    }

    try {
      const preparedFile = await this.filePresenter.prepareFileCompletely(
        filePath,
        undefined,
        'origin'
      )
      const normalizedPreparedPath = this.normalizePathForAccess(preparedFile.path)
      const workspaceRoot = this.getWorkspaceRootForPath(normalizedPreparedPath)
      const kind = this.resolvePreviewKind(preparedFile.mimeType, normalizedPreparedPath)

      return {
        path: normalizedPreparedPath,
        relativePath: workspaceRoot
          ? this.toRelativeWorkspacePath(workspaceRoot, normalizedPreparedPath)
          : normalizedPreparedPath,
        name: preparedFile.name,
        mimeType: preparedFile.mimeType,
        kind,
        content: kind === 'image' ? (preparedFile.thumbnail ?? '') : (preparedFile.content ?? ''),
        previewUrl: this.resolvePreviewUrl(workspaceRoot, normalizedPreparedPath, kind),
        thumbnail: preparedFile.thumbnail,
        language: this.inferLanguage(normalizedPreparedPath, kind),
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
      // `--find-renames` keeps renames as a single rename hunk instead of an
      // unrelated delete + add pair.
      const [staged, unstaged] = await Promise.all([
        this.runGitCommand(workspacePath, ['diff', '--cached', '--find-renames', ...fileArgs]),
        this.runGitCommand(workspacePath, ['diff', '--find-renames', ...fileArgs])
      ])

      let resolvedUnstaged = unstaged ?? ''

      // Untracked (newly added) files produce no output from `git diff`, so the
      // panel would show an empty diff. Synthesize an "added" diff against an
      // empty tree so the new file's contents are visible. Only do this once we
      // confirm the file is actually untracked, otherwise `--no-index` would
      // wrongly render unchanged tracked files as fully added.
      if (relativePath && !staged && !resolvedUnstaged) {
        const untracked = await this.runGitCommand(workspacePath, [
          'ls-files',
          '--others',
          '--exclude-standard',
          '--',
          relativePath
        ])

        if (untracked && untracked.trim()) {
          resolvedUnstaged = await this.runGitDiffNoIndex(workspacePath, relativePath)
        }
      }

      return {
        workspacePath: repoRoot,
        filePath: filePath ? path.resolve(filePath) : null,
        relativePath,
        staged: staged ?? '',
        unstaged: resolvedUnstaged
      }
    } catch (error) {
      console.warn(`[Workspace] Failed to read git diff for ${workspacePath}`, error)
      return null
    }
  }

  // `git diff --no-index` compares an arbitrary file against /dev/null to build
  // a full "added" diff for untracked files. It intentionally exits with code 1
  // when the inputs differ, which is the normal success case here, so tolerate
  // that and return the captured stdout.
  private async runGitDiffNoIndex(workspacePath: string, relativePath: string): Promise<string> {
    try {
      const result = await execFileAsync(
        'git',
        ['diff', '--no-index', '--', '/dev/null', relativePath],
        {
          cwd: workspacePath,
          windowsHide: true,
          maxBuffer: 8 * 1024 * 1024
        }
      )
      return result.stdout.trimEnd()
    } catch (error) {
      if (
        typeof error === 'object' &&
        error !== null &&
        'code' in error &&
        (error as { code?: number }).code === 1 &&
        'stdout' in error &&
        typeof (error as { stdout?: unknown }).stdout === 'string'
      ) {
        return (error as { stdout: string }).stdout.trimEnd()
      }

      console.warn(`[Workspace] Failed to build untracked diff for ${relativePath}`, error)
      return ''
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
