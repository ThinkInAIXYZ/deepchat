import { describe, it, expect, vi } from 'vitest'
import { reactive, ref } from 'vue'
import { WORKSPACE_EVENTS } from '@/events'
import { createWorkspaceStore } from '@/stores/workspace'

vi.mock('@/stores/chat', () => ({
  useChatStore: () => ({
    activeThreadId: null,
    chatConfig: { agentWorkspacePath: null, acpWorkdirMap: {} }
  })
}))

vi.mock('@/components/chat-input/composables/useChatMode', () => ({
  useChatMode: () => ({ currentMode: { value: 'agent' } })
}))

describe('createWorkspaceStore', () => {
  it('binds workspace listeners and cleans up', () => {
    const chatStore = reactive({
      activeThreadId: 'thread-a',
      chatConfig: { agentWorkspacePath: '/tmp/workspace', acpWorkdirMap: {} }
    })
    const chatMode = { currentMode: ref('agent') }
    const workspacePresenter = {
      readDirectory: vi.fn(),
      registerWorkspace: vi.fn(),
      registerWorkdir: vi.fn(),
      expandDirectory: vi.fn(),
      getPlanEntries: vi.fn(),
      terminateCommand: vi.fn()
    }
    const ipcRenderer = {
      on: vi.fn(),
      removeListener: vi.fn()
    }

    const store = createWorkspaceStore({
      chatStore,
      chatMode,
      workspacePresenter: workspacePresenter as any,
      ipcRenderer,
      enableWatchers: false
    })

    const cleanup = store.bindEventListeners()
    expect(ipcRenderer.on).toHaveBeenCalledWith(WORKSPACE_EVENTS.PLAN_UPDATED, expect.any(Function))
    expect(ipcRenderer.on).toHaveBeenCalledWith(
      WORKSPACE_EVENTS.TERMINAL_OUTPUT,
      expect.any(Function)
    )
    expect(ipcRenderer.on).toHaveBeenCalledWith(
      WORKSPACE_EVENTS.FILES_CHANGED,
      expect.any(Function)
    )

    cleanup()
    expect(ipcRenderer.removeListener).toHaveBeenCalledWith(
      WORKSPACE_EVENTS.PLAN_UPDATED,
      expect.any(Function)
    )
    expect(ipcRenderer.removeListener).toHaveBeenCalledWith(
      WORKSPACE_EVENTS.TERMINAL_OUTPUT,
      expect.any(Function)
    )
    expect(ipcRenderer.removeListener).toHaveBeenCalledWith(
      WORKSPACE_EVENTS.FILES_CHANGED,
      expect.any(Function)
    )
  })

  it('ignores stale file tree refreshes after conversation switch', async () => {
    const chatStore = reactive({
      activeThreadId: 'thread-a',
      chatConfig: { agentWorkspacePath: '/tmp/workspace', acpWorkdirMap: {} }
    })
    const chatMode = { currentMode: ref('agent') }
    let resolveRead: ((value: Array<{ path: string; isDirectory: boolean }>) => void) | null = null
    const readDirectory = vi.fn(
      () =>
        new Promise<Array<{ path: string; isDirectory: boolean }>>((resolve) => {
          resolveRead = resolve
        })
    )
    const workspacePresenter = {
      readDirectory,
      registerWorkspace: vi.fn().mockResolvedValue(undefined),
      registerWorkdir: vi.fn().mockResolvedValue(undefined),
      expandDirectory: vi.fn(),
      getPlanEntries: vi.fn(),
      terminateCommand: vi.fn()
    }

    const store = createWorkspaceStore({
      chatStore,
      chatMode,
      workspacePresenter: workspacePresenter as any,
      ipcRenderer: null,
      enableWatchers: false
    })

    const refreshPromise = store.refreshFileTree()
    await new Promise((resolve) => setTimeout(resolve, 0))
    if (!resolveRead) {
      throw new Error('readDirectory was not called')
    }
    chatStore.activeThreadId = 'thread-b'
    resolveRead([{ path: '/tmp/workspace/file.txt', isDirectory: false }])
    await refreshPromise

    expect(store.fileTree.value).toEqual([])
    expect(readDirectory).toHaveBeenCalledWith('/tmp/workspace')
  })
})
