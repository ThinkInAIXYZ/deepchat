import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
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
