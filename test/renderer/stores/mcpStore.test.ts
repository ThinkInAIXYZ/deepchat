import { beforeEach, describe, expect, it, vi } from 'vitest'

const setMcpServerEnabledMutate = vi.hoisted(() => vi.fn())
const addMcpServerMutate = vi.hoisted(() => vi.fn())
const updateMcpServerMutate = vi.hoisted(() => vi.fn())
const removeMcpServerMutate = vi.hoisted(() => vi.fn())
const configRefetch = vi.hoisted(() => vi.fn())

const mcpClientMock = vi.hoisted(() => ({
  getMcpServers: vi.fn().mockResolvedValue({}),
  getMcpEnabled: vi.fn().mockResolvedValue(true),
  getAllPrompts: vi.fn().mockResolvedValue([]),
  startServer: vi.fn().mockResolvedValue(undefined),
  stopServer: vi.fn().mockResolvedValue(undefined),
  isServerRunning: vi.fn().mockResolvedValue(false),
  getServerAuthStatus: vi.fn().mockResolvedValue({
    serverName: 'demo',
    state: 'none',
    authenticated: false
  }),
  getAllToolDefinitions: vi.fn().mockResolvedValue([]),
  getMcpClients: vi.fn().mockResolvedValue([]),
  getAllResources: vi.fn().mockResolvedValue([])
}))

const configServiceMock = vi.hoisted(() => ({
  getCustomPrompts: vi.fn().mockResolvedValue([]),
  getSetting: vi.fn().mockResolvedValue([]),
  setSetting: vi.fn().mockResolvedValue(undefined),
  onCustomPromptsChanged: vi.fn(() => vi.fn())
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

vi.mock('@api/McpClient', () => ({
  createMcpClient: vi.fn(() => mcpClientMock)
}))

vi.mock('../../../src/renderer/api/ConfigClient', () => ({
  createConfigClient: vi.fn(() => configServiceMock)
}))

vi.mock('@/composables/useIpcMutation', () => ({
  useIpcMutation: (options: { mutation?: (...args: any[]) => unknown }) => {
    const source = options.mutation?.toString() ?? ''
    const mutateAsync = source.includes('setMcpServerEnabled')
      ? setMcpServerEnabledMutate
      : source.includes('addMcpServer')
        ? addMcpServerMutate
        : source.includes('updateMcpServer')
          ? updateMcpServerMutate
          : source.includes('removeMcpServer')
            ? removeMcpServerMutate
            : vi.fn().mockResolvedValue(undefined)
    return { mutateAsync }
  }
}))

vi.mock('@/composables/useIpcQuery', () => ({
  useIpcQuery: () => createQueryState()
}))

vi.mock('@pinia/colada', () => ({
  useQuery: () => ({
    ...createQueryState(),
    refetch: configRefetch
  })
}))

vi.mock('vue-i18n', () => ({
  useI18n: () => ({
    t: (key: string) => key
  })
}))

const setupStore = async () => {
  vi.resetModules()
  vi.doUnmock('pinia')
  const { createPinia, setActivePinia } = await vi.importActual<typeof import('pinia')>('pinia')
  setActivePinia(createPinia())
  const { useMcpStore } = await import('@/stores/mcp')
  return useMcpStore()
}

describe('useMcpStore', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    setMcpServerEnabledMutate.mockReset()
    addMcpServerMutate.mockReset()
    updateMcpServerMutate.mockReset()
    removeMcpServerMutate.mockReset()
    configRefetch.mockReset()
    configRefetch.mockResolvedValue({ status: 'success', data: undefined })
    mcpClientMock.startServer.mockClear()
    mcpClientMock.stopServer.mockClear()
    mcpClientMock.getServerAuthStatus.mockReset()
    mcpClientMock.getServerAuthStatus.mockResolvedValue({
      serverName: 'demo',
      state: 'none',
      authenticated: false
    })
  })

  it('restores local state and persisted config when runtime sync fails', async () => {
    const store = await setupStore()

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
    expect(mcpClientMock.startServer).not.toHaveBeenCalled()
    expect(mcpClientMock.stopServer).not.toHaveBeenCalled()
  })

  it('keeps enabled state when startup requires OAuth authentication', async () => {
    const store = await setupStore()

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

    setMcpServerEnabledMutate.mockRejectedValueOnce(new Error('authorization required'))
    mcpClientMock.getServerAuthStatus.mockResolvedValueOnce({
      serverName: 'demo',
      state: 'required',
      authenticated: false
    })

    const result = await store.toggleServer('demo')

    expect(result).toBe(true)
    expect(store.config.mcpServers.demo.enabled).toBe(true)
    expect(store.serverAuthStatuses.demo?.state).toBe('required')
    expect(store.serverStatuses.demo).toBe(false)
    expect(setMcpServerEnabledMutate).toHaveBeenCalledTimes(1)
    expect(setMcpServerEnabledMutate).toHaveBeenCalledWith(['demo', true])
  })

  it('hides enabled servers when MCP is globally disabled', async () => {
    const store = await setupStore()

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
          enabled: true
        },
        'cua-driver': {
          command: '/mock/cua-driver',
          args: ['mcp'],
          env: {},
          descriptions: 'Computer Use',
          icons: 'plugin',
          autoApprove: [],
          disable: false,
          type: 'stdio',
          enabled: true,
          source: 'plugin',
          sourceId: 'com.deepchat.plugins.cua',
          ownerPluginId: 'com.deepchat.plugins.cua'
        }
      },
      mcpEnabled: false,
      ready: true
    }

    expect(store.serverList).toHaveLength(1)
    expect(store.pluginServerList.map((server) => server.name)).toEqual(['cua-driver'])
    expect(store.enabledServers).toEqual([])
    expect(store.enabledPluginServers.map((server) => server.name)).toEqual(['cua-driver'])
    expect(store.enabledServerCount).toBe(0)
  })

  it('hides plugin-owned servers from MCP UI lists', async () => {
    const store = await setupStore()

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
          enabled: true
        },
        'cua-driver': {
          command: '/Applications/DeepChat Computer Use.app/Contents/MacOS/deepchat-cua-driver',
          args: ['mcp', '--embedded'],
          descriptions: 'Computer Use',
          icons: 'plugin',
          autoApprove: [],
          disable: false,
          type: 'stdio',
          enabled: true,
          source: 'plugin',
          sourceId: 'com.deepchat.plugins.cua',
          ownerPluginId: 'com.deepchat.plugins.cua',
          inheritEnv: 'minimal'
        }
      },
      mcpEnabled: true,
      ready: true
    }

    expect(store.serverList.map((server) => server.name)).toEqual(['demo'])
    expect(store.pluginServerList.map((server) => server.name)).toEqual(['cua-driver'])
    expect(store.enabledServers.map((server) => server.name)).toEqual(['demo'])
    expect(store.enabledPluginServers.map((server) => server.name)).toEqual(['cua-driver'])
    expect(store.enabledServerCount).toBe(1)
    expect(store.config.mcpServers['cua-driver']).toBeDefined()
  })

  it('sorts enabled servers before disabled servers', async () => {
    const store = await setupStore()

    store.config = {
      mcpServers: {
        memory: {
          command: 'memory-command',
          args: [],
          env: {},
          descriptions: 'Memory',
          icons: 'M',
          autoApprove: [],
          disable: false,
          type: 'inmemory',
          enabled: false
        },
        tavily: {
          command: 'tavily-command',
          args: [],
          env: {},
          descriptions: 'Tavily',
          icons: 'T',
          autoApprove: [],
          disable: false,
          type: 'stdio',
          enabled: false
        },
        linear: {
          command: 'https://mcp.linear.app/mcp',
          args: [],
          env: {},
          descriptions: 'Linear',
          icons: 'L',
          autoApprove: [],
          disable: false,
          type: 'sse',
          enabled: true
        }
      },
      mcpEnabled: true,
      ready: true
    }

    expect(store.serverList.map((server) => server.name)).toEqual(['linear', 'memory', 'tavily'])
  })

  it('keeps server mutation results truthful when follow-up refreshes fail', async () => {
    const consoleWarn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    const store = await setupStore()
    const serverConfig = {
      command: 'demo-command',
      args: [],
      env: {},
      descriptions: 'Demo server',
      icons: 'D',
      autoApprove: [],
      disable: false,
      type: 'stdio' as const,
      enabled: false
    }
    store.config = {
      mcpServers: {
        demo: serverConfig
      },
      mcpEnabled: true,
      ready: true
    }
    addMcpServerMutate.mockResolvedValueOnce({ status: 'added' })
    updateMcpServerMutate.mockResolvedValueOnce(undefined)
    removeMcpServerMutate.mockResolvedValueOnce(undefined)
    configRefetch.mockRejectedValue(new Error('refresh failed'))

    await expect(store.addServer('added', serverConfig)).resolves.toEqual({ status: 'added' })
    await expect(store.updateServer('demo', { descriptions: 'Updated' })).resolves.toBe(true)
    await expect(store.removeServer('demo')).resolves.toBe(true)
    await vi.waitFor(() => {
      expect(consoleWarn).toHaveBeenCalled()
    })

    expect(store.config.mcpServers.added).toEqual(serverConfig)
    expect(store.config.mcpServers.demo).toBeUndefined()
    consoleWarn.mockRestore()
  })
})
