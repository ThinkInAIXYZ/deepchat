import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const { chokidarState, sendToRendererMock, execFileMock } = vi.hoisted(() => {
  const watchers: Array<{
    paths: unknown
    options: unknown
    on: ReturnType<typeof vi.fn>
    close: ReturnType<typeof vi.fn>
    emit: (eventName: string, ...args: unknown[]) => Promise<void>
  }> = []

  return {
    chokidarState: {
      watchers,
      reset() {
        watchers.length = 0
      },
      createWatcher(paths: unknown, options: unknown) {
        const handlers = new Map<string, Array<(...args: unknown[]) => unknown>>()
        const watcher = {
          paths,
          options,
          on: vi.fn((eventName: string, handler: (...args: unknown[]) => unknown) => {
            handlers.set(eventName, [...(handlers.get(eventName) ?? []), handler])
            return watcher
          }),
          close: vi.fn().mockResolvedValue(undefined),
          async emit(eventName: string, ...args: unknown[]) {
            for (const handler of handlers.get(eventName) ?? []) {
              await handler(...args)
            }
          }
        }
        watchers.push(watcher)
        return watcher
      }
    },
    sendToRendererMock: vi.fn(),
    execFileMock: vi.fn()
  }
})

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

vi.mock('chokidar', () => ({
  FSWatcher: class {},
  watch: vi.fn((paths: unknown, options: unknown) => chokidarState.createWatcher(paths, options))
}))

vi.mock('child_process', () => ({
  execFile: execFileMock
}))

vi.mock('../../../src/main/eventbus', () => ({
  eventBus: {
    sendToRenderer: sendToRendererMock
  },
  SendTarget: {
    ALL_WINDOWS: 'all_windows'
  }
}))

vi.mock('../../../src/main/events', () => ({
  WORKSPACE_EVENTS: {
    INVALIDATED: 'workspace:files-changed',
    FILES_CHANGED: 'workspace:files-changed'
  }
}))

import { WorkspacePresenter } from '../../../src/main/presenter/workspacePresenter'
import { WORKSPACE_EVENTS } from '../../../src/main/events'
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

beforeEach(() => {
  resetWorkspacePreviewProtocolState()
})

afterEach(() => {
  resetWorkspacePreviewProtocolState()
})

describe('WorkspacePresenter watchers', () => {
  let workspacePath: string
  let presenter: WorkspacePresenter

  beforeEach(() => {
    vi.useFakeTimers()
    chokidarState.reset()
    sendToRendererMock.mockReset()
    execFileMock.mockReset()

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

    presenter = new WorkspacePresenter({
      prepareFileCompletely: vi.fn()
    } as any)
  })

  afterEach(async () => {
    presenter?.destroy()
    await vi.runAllTimersAsync()
    vi.useRealTimers()
    fs.rmSync(workspacePath, { recursive: true, force: true })
  })

  it('shares watcher runtimes by workspace and disposes them after the last unwatch', async () => {
    await presenter.registerWorkspace(workspacePath)

    await presenter.watchWorkspace(workspacePath)
    await presenter.watchWorkspace(workspacePath)

    expect(chokidarState.watchers).toHaveLength(2)

    const [contentWatcher, gitWatcher] = chokidarState.watchers

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

    const [contentWatcher] = chokidarState.watchers

    await contentWatcher.emit('all', 'add', path.join(workspacePath, 'a.ts'))
    await contentWatcher.emit('all', 'change', path.join(workspacePath, 'b.ts'))

    expect(sendToRendererMock).not.toHaveBeenCalled()

    await vi.advanceTimersByTimeAsync(120)

    expect(sendToRendererMock).toHaveBeenCalledTimes(1)
    expect(sendToRendererMock).toHaveBeenCalledWith(WORKSPACE_EVENTS.INVALIDATED, 'all_windows', {
      workspacePath,
      kind: 'fs',
      source: 'watcher'
    })
  })

  it('emits git invalidations from git metadata watcher changes', async () => {
    await presenter.registerWorkspace(workspacePath)
    await presenter.watchWorkspace(workspacePath)

    const [, gitWatcher] = chokidarState.watchers
    await gitWatcher.emit('all', 'change', path.join(workspacePath, '.git', 'index'))
    await vi.advanceTimersByTimeAsync(120)

    expect(sendToRendererMock).toHaveBeenCalledWith(WORKSPACE_EVENTS.INVALIDATED, 'all_windows', {
      workspacePath,
      kind: 'git',
      source: 'watcher'
    })
  })

  it('closes remaining watchers during destroy', async () => {
    await presenter.registerWorkspace(workspacePath)
    await presenter.watchWorkspace(workspacePath)

    const [contentWatcher, gitWatcher] = chokidarState.watchers

    presenter.destroy()
    await Promise.resolve()

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
