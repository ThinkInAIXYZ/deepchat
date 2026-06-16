import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { DEEPCHAT_EVENT_CHANNEL } from '../../../src/shared/contracts/channels'

const { sendToAllWindowsMock, execFileMock } = vi.hoisted(() => ({
  sendToAllWindowsMock: vi.fn(),
  execFileMock: vi.fn()
}))

vi.mock('electron', () => ({
  shell: {
    showItemInFolder: vi.fn(),
    openPath: vi.fn().mockResolvedValue('')
  },
  protocol: {
    registerSchemesAsPrivileged: vi.fn()
  }
}))

vi.mock('fs', async () => {
  const actual = await vi.importActual<typeof import('node:fs')>('node:fs')
  return {
    __esModule: true,
    default: actual,
    ...actual
  }
})

vi.mock('path', async () => {
  const actual = await vi.importActual<typeof import('node:path')>('node:path')
  return {
    __esModule: true,
    default: actual,
    ...actual
  }
})

vi.mock('child_process', () => ({
  execFile: execFileMock
}))

import { setDeepchatEventWindowPresenter } from '../../../src/main/routes/publishDeepchatEvent'
import { WorkspacePresenter } from '../../../src/main/presenter/workspacePresenter'
import type {
  IFileWatcherService,
  WatchBatchListener,
  WatcherEvent,
  WatchMode,
  WatchRequest,
  WatcherStatus,
  WatchStatusListener
} from '../../../src/main/lib/fileWatcher'
import {
  createWorkspacePreviewFileUrl,
  createWorkspacePreviewUrl,
  registerWorkspacePreviewFile,
  registerWorkspacePreviewRoot,
  resetWorkspacePreviewProtocolState,
  resolveWorkspacePreviewRequest,
  unregisterWorkspacePreviewFile,
  unregisterWorkspacePreviewRoot,
  WORKSPACE_PREVIEW_PROTOCOL
} from '../../../src/main/presenter/workspacePresenter/workspacePreviewProtocol'

function normalizeForAccess(value: string): string {
  try {
    return path.normalize(fs.realpathSync(value))
  } catch {
    return path.normalize(path.resolve(value))
  }
}

type FakeWatcher = {
  request: WatchRequest
  close: ReturnType<typeof vi.fn>
  emit(events: WatcherEvent[], mode?: WatchMode): void
  emitStatus(status: Partial<WatcherStatus>): void
}

function createFakeWatcherService() {
  const watchers: FakeWatcher[] = []
  const service: IFileWatcherService = {
    watch: vi.fn(async (request, onBatch: WatchBatchListener, onStatus?: WatchStatusListener) => {
      const watcher: FakeWatcher = {
        request,
        close: vi.fn().mockResolvedValue(undefined),
        emit(events, mode = 'native') {
          onBatch({
            watchId: request.id,
            rootPath: request.rootPath,
            purpose: request.purpose,
            hostKind: request.hostKind,
            mode,
            events,
            version: Date.now()
          })
        },
        emitStatus(status) {
          onStatus?.({
            watchId: request.id,
            rootPath: request.rootPath,
            purpose: request.purpose,
            hostKind: request.hostKind,
            health: status.health ?? 'healthy',
            mode: status.mode ?? 'native',
            reason: status.reason ?? 'ready',
            message: status.message,
            version: status.version ?? Date.now()
          })
        }
      }
      watchers.push(watcher)
      return {
        close: watcher.close
      }
    }),
    destroy: vi.fn().mockResolvedValue(undefined)
  }

  return {
    service,
    watchers
  }
}

beforeEach(() => {
  resetWorkspacePreviewProtocolState()
})

afterEach(() => {
  resetWorkspacePreviewProtocolState()
})

describe('WorkspacePresenter watchers', () => {
  let workspacePath: string
  let presenter: WorkspacePresenter
  let fakeWatcherService: ReturnType<typeof createFakeWatcherService>

  beforeEach(() => {
    vi.useFakeTimers()
    fakeWatcherService = createFakeWatcherService()
    sendToAllWindowsMock.mockReset()
    execFileMock.mockReset()
    setDeepchatEventWindowPresenter({
      sendToAllWindows: sendToAllWindowsMock,
      sendToWebContents: vi.fn()
    })

    workspacePath = fs.mkdtempSync(path.join(os.tmpdir(), 'deepchat-workspace-'))
    fs.mkdirSync(path.join(workspacePath, '.git', 'refs'), { recursive: true })

    execFileMock.mockImplementation(
      (
        _command: string,
        args: string[],
        _options: unknown,
        callback: (error: Error | null, result?: { stdout: string; stderr: string }) => void
      ) => {
        if (args[1] === '--show-toplevel') {
          callback(null, { stdout: `${workspacePath}\n`, stderr: '' })
          return
        }

        if (args[1] === '--git-path') {
          const key = args[2]
          callback(null, { stdout: `.git/${key}\n`, stderr: '' })
          return
        }

        callback(null, { stdout: '', stderr: '' })
      }
    )

    presenter = new WorkspacePresenter(
      {
        prepareFileCompletely: vi.fn()
      } as any,
      fakeWatcherService.service
    )
  })

  afterEach(async () => {
    await presenter?.destroy()
    setDeepchatEventWindowPresenter(null)
    await vi.runAllTimersAsync()
    vi.useRealTimers()
    fs.rmSync(workspacePath, { recursive: true, force: true })
  })

  it('shares watcher runtimes by workspace and disposes them after the last unwatch', async () => {
    await presenter.registerWorkspace(workspacePath)

    await presenter.watchWorkspace(workspacePath)
    await presenter.watchWorkspace(workspacePath)

    expect(fakeWatcherService.watchers).toHaveLength(2)

    const [contentWatcher, gitWatcher] = fakeWatcherService.watchers

    await presenter.unwatchWorkspace(workspacePath)
    expect(contentWatcher.close).not.toHaveBeenCalled()
    expect(gitWatcher.close).not.toHaveBeenCalled()

    await presenter.unwatchWorkspace(workspacePath)
    expect(contentWatcher.close).toHaveBeenCalledTimes(1)
    expect(gitWatcher.close).toHaveBeenCalledTimes(1)
  })

  it('debounces file-system invalidations into a single fs refresh event', async () => {
    await presenter.registerWorkspace(workspacePath)
    await presenter.watchWorkspace(workspacePath)

    const [contentWatcher] = fakeWatcherService.watchers

    contentWatcher.emit([
      { type: 'create', path: path.join(workspacePath, 'a.ts') },
      { type: 'update', path: path.join(workspacePath, 'b.ts') }
    ])

    expect(sendToAllWindowsMock).not.toHaveBeenCalled()

    await vi.advanceTimersByTimeAsync(120)

    const typedCalls = sendToAllWindowsMock.mock.calls.filter(
      ([channel]) => channel === DEEPCHAT_EVENT_CHANNEL
    )

    expect(typedCalls).toHaveLength(1)
    expect(typedCalls[0]).toEqual([
      DEEPCHAT_EVENT_CHANNEL,
      {
        name: 'workspace.invalidated',
        payload: {
          workspacePath,
          kind: 'fs',
          source: 'watcher',
          version: expect.any(Number)
        }
      }
    ])
  })

  it('emits git invalidations from git metadata watcher changes', async () => {
    await presenter.registerWorkspace(workspacePath)
    await presenter.watchWorkspace(workspacePath)

    const [, gitWatcher] = fakeWatcherService.watchers
    gitWatcher.emit([{ type: 'update', path: path.join(workspacePath, '.git', 'index') }])
    await vi.advanceTimersByTimeAsync(120)

    expect(sendToAllWindowsMock).toHaveBeenCalledTimes(1)
    expect(sendToAllWindowsMock).toHaveBeenCalledWith(DEEPCHAT_EVENT_CHANNEL, {
      name: 'workspace.invalidated',
      payload: {
        workspacePath,
        kind: 'git',
        source: 'watcher',
        version: expect.any(Number)
      }
    })
  })

  it('emits watcher status updates for the active workspace', async () => {
    await presenter.registerWorkspace(workspacePath)
    await presenter.watchWorkspace(workspacePath)

    const [contentWatcher] = fakeWatcherService.watchers
    contentWatcher.emitStatus({
      health: 'degraded',
      mode: 'snapshot-polling',
      reason: 'fallback-started',
      message: 'native watcher unavailable',
      version: 123
    })

    expect(sendToAllWindowsMock).toHaveBeenCalledWith(DEEPCHAT_EVENT_CHANNEL, {
      name: 'workspace.watch.status.changed',
      payload: {
        workspacePath,
        health: 'degraded',
        mode: 'snapshot-polling',
        reason: 'fallback-started',
        message: 'native watcher unavailable',
        version: 123
      }
    })
  })

  it('removes failed watcher startup state so later calls can retry', async () => {
    await presenter.registerWorkspace(workspacePath)
    vi.mocked(fakeWatcherService.service.watch).mockRejectedValueOnce(new Error('watch failed'))

    await expect(presenter.watchWorkspace(workspacePath)).rejects.toThrow('watch failed')
    expect(fakeWatcherService.watchers).toHaveLength(0)

    await presenter.watchWorkspace(workspacePath)

    expect(fakeWatcherService.watchers).toHaveLength(2)
  })

  it('closes remaining watchers during destroy', async () => {
    await presenter.registerWorkspace(workspacePath)
    await presenter.watchWorkspace(workspacePath)

    const [contentWatcher, gitWatcher] = fakeWatcherService.watchers

    await presenter.destroy()

    expect(contentWatcher.close).toHaveBeenCalledTimes(1)
    expect(gitWatcher.close).toHaveBeenCalledTimes(1)
  })
})

describe('WorkspacePresenter readFilePreview', () => {
  let workspacePath: string

  beforeEach(() => {
    workspacePath = fs.mkdtempSync(path.join(os.tmpdir(), 'deepchat-workspace-preview-'))
  })

  afterEach(() => {
    fs.rmSync(workspacePath, { recursive: true, force: true })
  })

  it('classifies html, pdf, and svg files with workspace preview URLs', async () => {
    const prepareFileCompletely = vi
      .fn()
      .mockResolvedValueOnce({
        path: path.join(workspacePath, 'index.html'),
        name: 'index.html',
        mimeType: 'text/html',
        content: '<html></html>',
        thumbnail: '',
        metadata: {
          fileName: 'index.html',
          fileSize: 13,
          fileCreated: new Date('2024-01-01T00:00:00Z'),
          fileModified: new Date('2024-01-02T00:00:00Z')
        }
      })
      .mockResolvedValueOnce({
        path: path.join(workspacePath, 'manual.pdf'),
        name: 'manual.pdf',
        mimeType: 'application/pdf',
        content: 'page 1',
        thumbnail: '',
        metadata: {
          fileName: 'manual.pdf',
          fileSize: 2048,
          fileCreated: new Date('2024-01-01T00:00:00Z'),
          fileModified: new Date('2024-01-02T00:00:00Z')
        }
      })
      .mockResolvedValueOnce({
        path: path.join(workspacePath, 'diagram.svg'),
        name: 'diagram.svg',
        mimeType: 'image/svg+xml',
        content: '<svg></svg>',
        thumbnail: '',
        metadata: {
          fileName: 'diagram.svg',
          fileSize: 128,
          fileCreated: new Date('2024-01-01T00:00:00Z'),
          fileModified: new Date('2024-01-02T00:00:00Z')
        }
      })

    const presenter = new WorkspacePresenter({
      prepareFileCompletely
    } as any)

    const htmlPath = path.join(workspacePath, 'index.html')
    const pdfPath = path.join(workspacePath, 'manual.pdf')
    const svgPath = path.join(workspacePath, 'diagram.svg')
    fs.writeFileSync(htmlPath, '<html></html>')
    fs.writeFileSync(pdfPath, 'pdf')
    fs.writeFileSync(svgPath, '<svg></svg>')

    await presenter.registerWorkspace(workspacePath)

    const htmlPreview = await presenter.readFilePreview(htmlPath)
    const pdfPreview = await presenter.readFilePreview(pdfPath)
    const svgPreview = await presenter.readFilePreview(svgPath)

    expect(htmlPreview?.kind).toBe('html')
    expect(htmlPreview?.previewUrl).toBe(createWorkspacePreviewUrl(workspacePath, htmlPath))
    expect(pdfPreview?.kind).toBe('pdf')
    expect(pdfPreview?.previewUrl).toBe(createWorkspacePreviewUrl(workspacePath, pdfPath))
    expect(pdfPreview?.content).toBe('page 1')
    expect(svgPreview?.kind).toBe('svg')
    expect(svgPreview?.previewUrl).toBe(createWorkspacePreviewUrl(workspacePath, svgPath))
  })

  it('keeps unsupported files as binary without previewUrl', async () => {
    const prepareFileCompletely = vi.fn().mockResolvedValue({
      path: path.join(workspacePath, 'archive.zip'),
      name: 'archive.zip',
      mimeType: 'application/zip',
      content: '',
      thumbnail: '',
      metadata: {
        fileName: 'archive.zip',
        fileSize: 4096,
        fileCreated: new Date('2024-01-01T00:00:00Z'),
        fileModified: new Date('2024-01-02T00:00:00Z')
      }
    })

    const presenter = new WorkspacePresenter({
      prepareFileCompletely
    } as any)

    const zipPath = path.join(workspacePath, 'archive.zip')
    fs.writeFileSync(zipPath, 'zip')

    await presenter.registerWorkspace(workspacePath)

    const preview = await presenter.readFilePreview(zipPath)

    expect(preview?.kind).toBe('binary')
    expect(preview?.previewUrl).toBeUndefined()
  })
})

describe('WorkspacePresenter resolveMarkdownLinkedFile', () => {
  let workspacePath: string
  let outsideFilePath: string

  beforeEach(() => {
    workspacePath = fs.mkdtempSync(path.join(os.tmpdir(), 'deepchat-workspace-links-'))
    fs.mkdirSync(path.join(workspacePath, 'docs', 'nested'), { recursive: true })
    fs.writeFileSync(path.join(workspacePath, 'docs', 'guide.md'), '# Guide')
    fs.writeFileSync(path.join(workspacePath, 'docs', 'nested', 'child.md'), '# Child')
    fs.writeFileSync(path.join(workspacePath, 'docs', 'root.md'), '# Root')
    outsideFilePath = path.join(path.dirname(workspacePath), 'outside.html')
    fs.writeFileSync(outsideFilePath, '<html></html>')
  })

  afterEach(() => {
    fs.rmSync(workspacePath, { recursive: true, force: true })
    fs.rmSync(outsideFilePath, { force: true })
  })

  it('resolves relative links from the source markdown file directory', async () => {
    const presenter = new WorkspacePresenter({
      prepareFileCompletely: vi.fn()
    } as any)

    await presenter.registerWorkspace(workspacePath)

    const resolution = await presenter.resolveMarkdownLinkedFile({
      workspacePath,
      href: './nested/child.md#details',
      sourceFilePath: path.join(workspacePath, 'docs', 'guide.md')
    })

    expect(resolution).toEqual({
      path: normalizeForAccess(path.join(workspacePath, 'docs', 'nested', 'child.md')),
      name: 'child.md',
      relativePath: 'docs/nested/child.md',
      workspaceRoot: normalizeForAccess(workspacePath)
    })
  })

  it('falls back to the workspace root when no source markdown file is provided', async () => {
    const presenter = new WorkspacePresenter({
      prepareFileCompletely: vi.fn()
    } as any)

    await presenter.registerWorkspace(workspacePath)

    const resolution = await presenter.resolveMarkdownLinkedFile({
      workspacePath,
      href: 'docs/root.md'
    })

    expect(resolution).toEqual({
      path: normalizeForAccess(path.join(workspacePath, 'docs', 'root.md')),
      name: 'root.md',
      relativePath: 'docs/root.md',
      workspaceRoot: normalizeForAccess(workspacePath)
    })
  })

  it('authorizes files resolved outside the workspace for subsequent preview reads', async () => {
    const prepareFileCompletely = vi.fn().mockResolvedValue({
      path: outsideFilePath,
      name: 'outside.html',
      mimeType: 'text/html',
      content: '<html></html>',
      thumbnail: '',
      metadata: {
        fileName: 'outside.html',
        fileSize: 13,
        fileCreated: new Date('2024-01-01T00:00:00Z'),
        fileModified: new Date('2024-01-02T00:00:00Z')
      }
    })

    const presenter = new WorkspacePresenter({
      prepareFileCompletely
    } as any)

    await presenter.registerWorkspace(workspacePath)

    const resolution = await presenter.resolveMarkdownLinkedFile({
      workspacePath,
      href: '../../outside.html',
      sourceFilePath: path.join(workspacePath, 'docs', 'guide.md')
    })
    const preview = await presenter.readFilePreview(outsideFilePath)

    expect(resolution).toEqual({
      path: normalizeForAccess(outsideFilePath),
      name: 'outside.html',
      relativePath: normalizeForAccess(outsideFilePath),
      workspaceRoot: null
    })
    expect(preview?.path).toBe(normalizeForAccess(outsideFilePath))
    expect(preview?.previewUrl).toBe(createWorkspacePreviewFileUrl(outsideFilePath))
    expect(preview?.relativePath).toBe(normalizeForAccess(outsideFilePath))
  })

  it('supports file urls and absolute file paths', async () => {
    const presenter = new WorkspacePresenter({
      prepareFileCompletely: vi.fn()
    } as any)

    await presenter.registerWorkspace(workspacePath)

    const fileUrlResolution = await presenter.resolveMarkdownLinkedFile({
      workspacePath,
      href: pathToFileURL(path.join(workspacePath, 'docs', 'root.md')).href
    })
    const absoluteResolution = await presenter.resolveMarkdownLinkedFile({
      workspacePath,
      href: path.join(workspacePath, 'docs', 'root.md')
    })

    expect(fileUrlResolution?.path).toBe(
      normalizeForAccess(path.join(workspacePath, 'docs', 'root.md'))
    )
    expect(absoluteResolution?.path).toBe(
      normalizeForAccess(path.join(workspacePath, 'docs', 'root.md'))
    )
  })

  it('returns null for missing files without authorizing them', async () => {
    const prepareFileCompletely = vi.fn()
    const presenter = new WorkspacePresenter({
      prepareFileCompletely
    } as any)

    await presenter.registerWorkspace(workspacePath)

    const resolution = await presenter.resolveMarkdownLinkedFile({
      workspacePath,
      href: './missing.md',
      sourceFilePath: path.join(workspacePath, 'docs', 'guide.md')
    })
    const preview = await presenter.readFilePreview(path.join(workspacePath, 'docs', 'missing.md'))

    expect(resolution).toBeNull()
    expect(preview).toBeNull()
    expect(prepareFileCompletely).not.toHaveBeenCalled()
  })
})

describe('workspacePreviewProtocol helpers', () => {
  let workspacePath: string

  beforeEach(() => {
    workspacePath = fs.mkdtempSync(path.join(os.tmpdir(), 'deepchat-workspace-protocol-'))
    fs.mkdirSync(path.join(workspacePath, 'docs', 'assets'), { recursive: true })
  })

  afterEach(() => {
    fs.rmSync(workspacePath, { recursive: true, force: true })
  })

  it('resolves registered workspace URLs and preserves relative asset paths', () => {
    const htmlPath = path.join(workspacePath, 'docs', 'index.html')
    const cssPath = path.join(workspacePath, 'docs', 'assets', 'app.css')
    fs.writeFileSync(htmlPath, '<html></html>')
    fs.writeFileSync(cssPath, 'body {}')

    registerWorkspacePreviewRoot(workspacePath)

    const previewUrl = createWorkspacePreviewUrl(workspacePath, htmlPath)
    expect(previewUrl).toMatch(new RegExp(`^${WORKSPACE_PREVIEW_PROTOCOL}://`))
    expect(resolveWorkspacePreviewRequest(previewUrl!)).toBe(normalizeForAccess(htmlPath))

    const assetUrl = new URL('assets/app.css', previewUrl!).href
    expect(resolveWorkspacePreviewRequest(assetUrl)).toBe(normalizeForAccess(cssPath))
  })

  it('rejects unregistered roots and outside-root preview URLs', () => {
    const htmlPath = path.join(workspacePath, 'docs', 'index.html')
    fs.writeFileSync(htmlPath, '<html></html>')

    registerWorkspacePreviewRoot(workspacePath)

    const previewUrl = createWorkspacePreviewUrl(workspacePath, htmlPath)

    unregisterWorkspacePreviewRoot(workspacePath)
    expect(resolveWorkspacePreviewRequest(previewUrl!)).toBeNull()

    registerWorkspacePreviewRoot(workspacePath)
    expect(
      createWorkspacePreviewUrl(workspacePath, path.join(workspacePath, '..', 'outside.txt'))
    ).toBeNull()
  })

  it('resolves exact-file preview URLs without exposing sibling assets', () => {
    const outsideFilePath = path.join(workspacePath, 'docs', 'standalone.html')
    fs.writeFileSync(outsideFilePath, '<html></html>')

    registerWorkspacePreviewFile(outsideFilePath)

    const previewUrl = createWorkspacePreviewFileUrl(outsideFilePath)
    expect(previewUrl).toMatch(new RegExp(`^${WORKSPACE_PREVIEW_PROTOCOL}://file-`))
    expect(resolveWorkspacePreviewRequest(previewUrl)).toBe(normalizeForAccess(outsideFilePath))

    const assetUrl = new URL('assets/app.css', previewUrl).href
    expect(resolveWorkspacePreviewRequest(assetUrl)).toBeNull()

    unregisterWorkspacePreviewFile(outsideFilePath)
    expect(resolveWorkspacePreviewRequest(previewUrl)).toBeNull()
  })
})
