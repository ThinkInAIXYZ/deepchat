import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'

const setMcpServerEnabledMutate = vi.hoisted(() => vi.fn())

const mcpPresenterMock = vi.hoisted(() => ({
  getMcpServers: vi.fn().mockResolvedValue({}),
  getMcpEnabled: vi.fn().mockResolvedValue(true),
  getAllPrompts: vi.fn().mockResolvedValue([]),
  startServer: vi.fn().mockResolvedValue(undefined),
  stopServer: vi.fn().mockResolvedValue(undefined),
  isServerRunning: vi.fn().mockResolvedValue(false),
  getAllToolDefinitions: vi.fn().mockResolvedValue([]),
  getMcpClients: vi.fn().mockResolvedValue([]),
  getAllResources: vi.fn().mockResolvedValue([])
}))

const configPresenterMock = vi.hoisted(() => ({
  getCustomPrompts: vi.fn().mockResolvedValue([]),
  getSetting: vi.fn().mockResolvedValue([]),
  setSetting: vi.fn().mockResolvedValue(undefined)
}))

const createQueryState = () => ({
  data: { value: undefined },
  error: { value: null },
  isLoading: { value: false },
  isFetching: { value: false },
  isRefreshing: { value: false },
  refresh: vi.fn(async () => ({ status: 'success', data: undefined })),
  refetch: vi.fn(async () => ({ status: 'success', data: undefined }))
})

vi.mock('vue', async () => {
  const actual = await vi.importActual<typeof import('vue')>('vue')
  return {
    ...actual,
    onMounted: vi.fn()
  }
})

vi.mock('@/composables/usePresenter', () => ({
  usePresenter: (name: string) => (name === 'mcpPresenter' ? mcpPresenterMock : configPresenterMock)
}))

vi.mock('@/composables/useIpcMutation', () => ({
  useIpcMutation: (options: { method: string }) => ({
    mutateAsync:
      options.method === 'setMcpServerEnabled'
        ? setMcpServerEnabledMutate
        : vi.fn().mockResolvedValue(undefined)
  })
}))

vi.mock('@/composables/useIpcQuery', () => ({
  useIpcQuery: () => createQueryState()
}))

vi.mock('@pinia/colada', () => ({
  useQuery: () => createQueryState()
}))

vi.mock('vue-i18n', () => ({
  useI18n: () => ({
    t: (key: string) => key
  })
}))

vi.mock('@/events', () => ({
  MCP_EVENTS: {
    SERVER_STARTED: 'server-started',
    SERVER_STOPPED: 'server-stopped',
    CONFIG_CHANGED: 'config-changed',
    SERVER_STATUS_CHANGED: 'server-status-changed',
    TOOL_CALL_RESULT: 'tool-call-result'
  }
}))

import { useMcpStore } from '@/stores/mcp'

describe('useMcpStore toggleServer rollback', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    vi.clearAllMocks()
    setMcpServerEnabledMutate.mockReset()
    mcpPresenterMock.startServer.mockClear()
    mcpPresenterMock.stopServer.mockClear()
  })

  it('restores local state and persisted config when runtime sync fails', async () => {
    const store = useMcpStore()

    store.config = {
      mcpServers: {
        demo: {
          command: 'demo-command',
          args: [],
          env: {},
          descriptions: 'Demo server',
          icons: 'D',
          autoApprove: [],
          disable: false,
          type: 'stdio',
          enabled: false
        }
      },
      mcpEnabled: true,
      ready: true
    }

    setMcpServerEnabledMutate.mockRejectedValueOnce(new Error('runtime failed'))
    setMcpServerEnabledMutate.mockResolvedValueOnce(undefined)

    const result = await store.toggleServer('demo')

    expect(result).toBe(false)
    expect(store.config.mcpServers.demo.enabled).toBe(false)
    expect(store.serverLoadingStates.demo).toBe(false)
    expect(setMcpServerEnabledMutate).toHaveBeenNthCalledWith(1, ['demo', true])
    expect(setMcpServerEnabledMutate).toHaveBeenNthCalledWith(2, ['demo', false])
    expect(mcpPresenterMock.startServer).not.toHaveBeenCalled()
    expect(mcpPresenterMock.stopServer).not.toHaveBeenCalled()
  })
})
