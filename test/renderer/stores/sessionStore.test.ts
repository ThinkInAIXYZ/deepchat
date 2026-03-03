import { describe, expect, it, vi } from 'vitest'

const setupStore = async () => {
  vi.resetModules()

  const newAgentPresenter = {
    getSessionList: vi.fn().mockResolvedValue([]),
    createSession: vi.fn(),
    activateSession: vi.fn(),
    deactivateSession: vi.fn(),
    sendMessage: vi.fn(),
    deleteSession: vi.fn()
  }

  vi.doMock('pinia', () => ({
    defineStore: (_id: string, setup: () => unknown) => setup
  }))

  vi.doMock('@/composables/usePresenter', () => ({
    usePresenter: () => newAgentPresenter
  }))

  vi.doMock('@/stores/ui/pageRouter', () => ({
    usePageRouterStore: () => ({
      goToChat: vi.fn(),
      goToNewThread: vi.fn()
    })
  }))
  ;(window as any).electron = {
    ipcRenderer: {
      on: vi.fn(),
      removeListener: vi.fn()
    }
  }
  ;(window as any).api = {
    getWebContentsId: vi.fn(() => 1)
  }

  const { useSessionStore } = await import('@/stores/ui/session')
  const store = useSessionStore()
  return { store }
}

describe('sessionStore.getFilteredGroups', () => {
  it('hides draft sessions from grouped sidebar lists', async () => {
    const { store } = await setupStore()
    const now = Date.now()

    store.sessions.value = [
      {
        id: 'draft-1',
        title: 'Draft',
        agentId: 'acp-agent',
        status: 'none',
        projectDir: '/tmp/workspace',
        providerId: 'acp',
        modelId: 'acp-agent',
        isDraft: true,
        createdAt: now,
        updatedAt: now
      },
      {
        id: 'real-1',
        title: 'Real Chat',
        agentId: 'acp-agent',
        status: 'none',
        projectDir: '/tmp/workspace',
        providerId: 'acp',
        modelId: 'acp-agent',
        isDraft: false,
        createdAt: now,
        updatedAt: now
      }
    ]

    const groups = store.getFilteredGroups(null)
    const ids = groups.flatMap((group) => group.sessions.map((session) => session.id))

    expect(ids).toEqual(['real-1'])
  })
})
