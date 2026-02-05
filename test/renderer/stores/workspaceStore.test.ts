import { describe, it, expect, vi } from 'vitest'
import { reactive, ref } from 'vue'
import type { WorkspaceAdapter } from '@/composables/workspace/useWorkspaceAdapter'
import { createWorkspaceStore } from '@/stores/workspace'

vi.mock('@/stores/chat', () => ({
  useChatStore: () => ({
    activeSessionId: null,
    activeThread: null
  })
}))

describe('createWorkspaceStore', () => {
  it('binds workspace listeners and cleans up', () => {
    const chatStore = reactive({
      activeSessionId: 'thread-a',
      activeThread: {
        settings: {
          agentWorkspacePath: '/tmp/workspace'
        }
      }
    })
    const planCleanup = vi.fn()
    const terminalCleanup = vi.fn()
    const filesCleanup = vi.fn()

    const workspaceAdapter: WorkspaceAdapter = {
      readDirectory: vi.fn(),
      registerWorkspace: vi.fn(),
      registerWorkdir: vi.fn(),
      expandDirectory: vi.fn(),
      getPlanEntries: vi.fn(),
      terminateCommand: vi.fn(),
      searchFiles: vi.fn(),
      onPlanUpdated: vi.fn().mockReturnValue(planCleanup),
      onTerminalOutput: vi.fn().mockReturnValue(terminalCleanup),
      onFilesChanged: vi.fn().mockReturnValue(filesCleanup)
    }

    const store = createWorkspaceStore({
      chatStore,
      workspaceAdapter,
      enableWatchers: false
    })

    const cleanup = store.bindEventListeners()
    expect(workspaceAdapter.onPlanUpdated).toHaveBeenCalledWith(expect.any(Function))
    expect(workspaceAdapter.onTerminalOutput).toHaveBeenCalledWith(expect.any(Function))
    expect(workspaceAdapter.onFilesChanged).toHaveBeenCalledWith(expect.any(Function))

    cleanup()
    expect(planCleanup).toHaveBeenCalled()
    expect(terminalCleanup).toHaveBeenCalled()
    expect(filesCleanup).toHaveBeenCalled()
  })

  it('ignores stale file tree refreshes after conversation switch', async () => {
    const chatStore = reactive({
      activeSessionId: 'thread-a',
      activeThread: {
        settings: {
          agentWorkspacePath: '/tmp/workspace'
        }
      }
    })
    let resolveRead: ((value: Array<{ path: string; isDirectory: boolean }>) => void) | null = null
    const readDirectory = vi.fn(
      () =>
        new Promise<Array<{ path: string; isDirectory: boolean }>>((resolve) => {
          resolveRead = resolve
        })
    )
    const workspaceAdapter: WorkspaceAdapter = {
      readDirectory,
      registerWorkspace: vi.fn().mockResolvedValue(undefined),
      registerWorkdir: vi.fn().mockResolvedValue(undefined),
      expandDirectory: vi.fn(),
      getPlanEntries: vi.fn(),
      terminateCommand: vi.fn(),
      searchFiles: vi.fn(),
      onPlanUpdated: vi.fn().mockReturnValue(() => undefined),
      onTerminalOutput: vi.fn().mockReturnValue(() => undefined),
      onFilesChanged: vi.fn().mockReturnValue(() => undefined)
    }

    const store = createWorkspaceStore({
      chatStore,
      workspaceAdapter,
      enableWatchers: false
    })

    const refreshPromise = store.refreshFileTree()
    await new Promise((resolve) => setTimeout(resolve, 0))
    if (!resolveRead) {
      throw new Error('readDirectory was not called')
    }
    chatStore.activeSessionId = 'thread-b'
    resolveRead([{ path: '/tmp/workspace/file.txt', isDirectory: false }])
    await refreshPromise

    expect(store.fileTree.value).toEqual([])
    expect(readDirectory).toHaveBeenCalledWith('/tmp/workspace')
  })
})
