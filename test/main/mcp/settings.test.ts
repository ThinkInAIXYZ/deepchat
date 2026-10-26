import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mockStores = vi.hoisted(() => new Map<string, Record<string, any>>())

const clone = <T>(value: T): T => {
  const cloneFn = (globalThis as typeof globalThis & { structuredClone?: (value: T) => T })
    .structuredClone

  if (typeof cloneFn === 'function') {
    return cloneFn(value)
  }

  return JSON.parse(JSON.stringify(value)) as T
}

vi.mock('electron-store', () => ({
  default: class MockElectronStore {
    private readonly data: Record<string, any>

    constructor(options: { name: string; defaults?: Record<string, any> }) {
      if (!mockStores.has(options.name)) {
        mockStores.set(options.name, clone(options.defaults ?? {}))
      }
      this.data = mockStores.get(options.name)!
    }

    get(key: string) {
      return this.data[key]
    }

    set(key: string | Record<string, any>, value?: any) {
      if (typeof key === 'string') {
        this.data[key] = value
      } else {
        Object.assign(this.data, key)
      }
    }

    delete(key: string) {
      delete this.data[key]
    }

    has(key: string) {
      return key in this.data
    }
  }
}))

const originalPlatform = Object.getOwnPropertyDescriptor(process, 'platform')

const setPlatform = (platform: string) => {
  Object.defineProperty(process, 'platform', {
    configurable: true,
    value: platform
  })
}

const loadHelper = async (platform: string) => {
  vi.resetModules()
  setPlatform(platform)
  return await import('@/mcp/settings')
}

const createKnowledgeConfig = (id: string, description = id) => ({
  id,
  description,
  embedding: {
    providerId: 'openai',
    modelId: 'text-embedding-3-small'
  },
  dimensions: 1536,
  normalized: true,
  fragmentsNumber: 6,
  enabled: true
})

describe('McpSettings', () => {
  beforeEach(() => {
    mockStores.clear()
  })

  afterEach(() => {
    vi.clearAllMocks()
    if (originalPlatform) {
      Object.defineProperty(process, 'platform', originalPlatform)
    }
  })

  it('honors an empty legacy enabled set when legacy keys are present', async () => {
    const { McpSettings } = await loadHelper('darwin')
    const helper = new McpSettings()
    const mcpStore = (helper as any).mcpStore
    const searchConfig = { ...mcpStore.get('mcpServers').bochaSearch }

    delete searchConfig.enabled
    mcpStore.set('mcpServers', {
      bochaSearch: searchConfig
    })
    mcpStore.set('defaultServers', [])

    const servers = await helper.getMcpServers()

    expect(servers.bochaSearch.enabled).toBe(false)
    expect(mcpStore.has('defaultServers')).toBe(false)
  })

  it('retires persisted in-memory artifacts without removing external servers', async () => {
    const { McpSettings } = await loadHelper('darwin')
    const helper = new McpSettings()
    const store = (helper as any).mcpStore
    expect(store.get('mcpServers').Artifacts).toBeUndefined()
    store.set('mcpServers', {
      Artifacts: { type: 'inmemory', command: 'artifacts', enabled: true, args: [], env: {} },
      renamed: { type: 'inmemory', command: 'artifacts', enabled: true, args: [], env: {} },
      external: { type: 'stdio', command: 'artifacts', enabled: true, args: [], env: {} }
    })
    store.set('defaultServers', ['Artifacts'])
    const servers = await helper.getMcpServers()
    expect(servers.Artifacts).toBeUndefined()
    expect(servers.renamed).toBeUndefined()
    expect(servers.external.command).toBe('artifacts')
    expect(store.get('mcpServers').Artifacts).toBeUndefined()
    expect((await helper.getMcpServers()).Artifacts).toBeUndefined()
  })

  it('updates Router credentials through one fallback store write', async () => {
    const { McpSettings } = await loadHelper('darwin')
    const helper = new McpSettings()
    const servers = {
      router: {
        command: '',
        args: [],
        env: {},
        type: 'http' as const,
        descriptions: '',
        icons: '',
        enabled: true,
        customHeaders: {
          Authorization: 'Bearer router-key'
        }
      }
    }

    helper.setRouterApiKeyAndServers('router-key', servers)

    expect(helper.getRouterApiKey()).toBe('router-key')
    await expect(helper.getMcpServers()).resolves.toEqual(
      expect.objectContaining({
        router: expect.objectContaining({
          customHeaders: {
            Authorization: 'Bearer router-key'
          }
        })
      })
    )
  })

  it("adds the disabled McDonald's MCP server with a token placeholder for existing users", async () => {
    const { McpSettings } = await loadHelper('darwin')
    const helper = new McpSettings()
    const mcpStore = (helper as any).mcpStore

    mcpStore.set('mcpServers', {})

    const servers = await helper.getMcpServers()

    expect(servers['mcd-mcp']).toMatchObject({
      type: 'http',
      baseUrl: 'https://mcp.mcd.cn',
      customHeaders: {
        Authorization: 'Bearer YOUR_MCP_TOKEN'
      },
      enabled: false
    })
  })

  it('adds the disabled You.com search MCP server (keyless free profile) for existing users', async () => {
    const { McpSettings } = await loadHelper('darwin')
    const helper = new McpSettings()
    const mcpStore = (helper as any).mcpStore

    mcpStore.set('mcpServers', {})

    const servers = await helper.getMcpServers()

    expect(servers['youcom-search']).toMatchObject({
      type: 'http',
      baseUrl: 'https://api.you.com/mcp?profile=free',
      enabled: false
    })
  })

  it('adds the disabled Serply search MCP server with a key placeholder for existing users', async () => {
    const { McpSettings } = await loadHelper('darwin')
    const helper = new McpSettings()
    const mcpStore = (helper as any).mcpStore

    mcpStore.set('mcpServers', {})

    const servers = await helper.getMcpServers()

    expect(servers['serply-search']).toMatchObject({
      type: 'http',
      baseUrl: 'https://api.serply.io/mcp',
      customHeaders: {
        'X-Api-Key': 'YOUR_SERPLY_API_KEY'
      },
      enabled: false
    })
  })

  it('adds the disabled Webz.io news search MCP server with a token placeholder for existing users', async () => {
    const { McpSettings } = await loadHelper('darwin')
    const helper = new McpSettings()
    const mcpStore = (helper as any).mcpStore

    mcpStore.set('mcpServers', {})

    const servers = await helper.getMcpServers()

    expect(servers['webz-news-search']).toMatchObject({
      type: 'http',
      baseUrl: 'https://news-search-mcp.webz.io/mcp',
      customHeaders: {
        Authorization: 'Bearer YOUR_WEBZ_API_TOKEN'
      },
      enabled: false
    })
  })

  it('adds the disabled SkyAccess empty leg MCP server (keyless) for existing users', async () => {
    const { McpSettings } = await loadHelper('darwin')
    const helper = new McpSettings()
    const mcpStore = (helper as any).mcpStore

    mcpStore.set('mcpServers', {})

    const servers = await helper.getMcpServers()

    expect(servers['skyaccess-empty-legs']).toMatchObject({
      type: 'http',
      baseUrl: 'https://mcp.skyaccess.com/mcp',
      enabled: false
    })
  })

  it('adds the disabled Cohesivity backend infrastructure MCP server (keyless) for existing users', async () => {
    const { McpSettings } = await loadHelper('darwin')
    const helper = new McpSettings()
    const mcpStore = (helper as any).mcpStore

    mcpStore.set('mcpServers', {})

    const servers = await helper.getMcpServers()

    expect(servers['cohesivity']).toMatchObject({
      type: 'http',
      baseUrl: 'https://cohesivity.ai/mcp',
      enabled: false
    })
  })

  it('adds the disabled Keenable search MCP server (keyless) for existing users', async () => {
    const { McpSettings } = await loadHelper('darwin')
    const helper = new McpSettings()
    const mcpStore = (helper as any).mcpStore

    mcpStore.set('mcpServers', {})

    const servers = await helper.getMcpServers()

    expect(servers['keenable-search']).toMatchObject({
      type: 'http',
      baseUrl: 'https://api.keenable.ai/mcp',
      customHeaders: {
        'X-Keenable-Title': 'DeepChat'
      },
      enabled: false
    })
  })

  it('adds the disabled EvoLink MCP server (OAuth sign-in) for existing users', async () => {
    const { McpSettings } = await loadHelper('darwin')
    const helper = new McpSettings()
    const mcpStore = (helper as any).mcpStore

    mcpStore.set('mcpServers', {})

    const servers = await helper.getMcpServers()

    expect(servers.evolink).toMatchObject({
      type: 'http',
      baseUrl: 'https://mcp.evolink.ai/mcp',
      enabled: false
    })
    expect(servers.evolink.customHeaders).toBeUndefined()
  })

  it('adds the disabled deed.page static hosting MCP server (keyless) for existing users', async () => {
    const { McpSettings } = await loadHelper('darwin')
    const helper = new McpSettings()
    const mcpStore = (helper as any).mcpStore

    mcpStore.set('mcpServers', {})

    const servers = await helper.getMcpServers()

    expect(servers['deed-page']).toMatchObject({
      type: 'http',
      baseUrl: 'https://deed.page/mcp',
      enabled: false
    })
    expect(servers['deed-page'].customHeaders).toBeUndefined()
  })

  it('does not recreate the Apple built-in server after the user removed it', async () => {
    const { McpSettings } = await loadHelper('darwin')
    const helper = new McpSettings()
    const mcpStore = (helper as any).mcpStore

    mcpStore.set('mcpServers', {})
    mcpStore.set('removedBuiltInServers', ['deepchat/apple-server'])

    helper.onUpgrade(undefined)

    expect(mcpStore.get('mcpServers')['deepchat/apple-server']).toBeUndefined()
  })

  it('removes the unpublished Computer Use demo MCP server config', async () => {
    const { McpSettings } = await loadHelper('darwin')
    const helper = new McpSettings()
    const mcpStore = (helper as any).mcpStore
    const legacyServer = {
      command: '/Applications/DeepChat Computer Use.app/Contents/MacOS/cua-driver',
      args: ['mcp'],
      env: {},
      descriptions: 'Computer Use',
      icons: 'computer-use',
      autoApprove: [],
      disable: false,
      type: 'stdio',
      enabled: true
    }

    mcpStore.set('mcpServers', {
      'deepchat/computer-use': legacyServer,
      demo: {
        command: 'demo',
        args: [],
        env: {},
        descriptions: 'Demo',
        icons: 'D',
        autoApprove: [],
        disable: false,
        type: 'stdio',
        enabled: true
      }
    })
    mcpStore.set('removedBuiltInServers', ['deepchat/computer-use', 'demo'])

    const servers = await helper.getMcpServers()

    expect(servers['deepchat/computer-use']).toBeUndefined()
    expect(servers.demo).toBeDefined()
    expect(servers.demo).not.toHaveProperty('autoApprove')
    expect(mcpStore.get('removedBuiltInServers')).toEqual(['demo'])
  })

  it('migrates legacy builtin knowledge configs out of MCP env', async () => {
    const { McpSettings } = await loadHelper('win32')
    const helper = new McpSettings()
    const mcpStore = (helper as any).mcpStore
    const legacyConfig = createKnowledgeConfig('legacy-knowledge', 'Legacy config')
    const realConfig = createKnowledgeConfig('real-knowledge', 'Real config')

    mcpStore.set('mcpServers', {
      builtinKnowledge: {
        ...(mcpStore.get('mcpServers').builtinKnowledge ?? {}),
        env: {
          configs: [legacyConfig]
        }
      }
    })

    const configs = helper.migrateBuiltinKnowledgeConfigsFromEnv([realConfig])

    expect(configs).toEqual([realConfig, legacyConfig])
    expect(mcpStore.get('mcpServers').builtinKnowledge.env).toEqual({})
  })

  it('keeps existing knowledge configs when legacy env has the same id', async () => {
    const { McpSettings } = await loadHelper('win32')
    const helper = new McpSettings()
    const mcpStore = (helper as any).mcpStore
    const realConfig = createKnowledgeConfig('same-id', 'Real config')
    const legacyConfig = createKnowledgeConfig('same-id', 'Legacy config')

    mcpStore.set('mcpServers', {
      builtinKnowledge: {
        ...(mcpStore.get('mcpServers').builtinKnowledge ?? {}),
        env: {
          configs: [legacyConfig]
        }
      }
    })

    const configs = helper.migrateBuiltinKnowledgeConfigsFromEnv([realConfig])

    expect(configs).toEqual([realConfig])
    expect(mcpStore.get('mcpServers').builtinKnowledge.env).toEqual({})
  })

  it('persists batch imported MCP servers', async () => {
    const { McpSettings } = await loadHelper('darwin')
    const helper = new McpSettings()

    const result = await helper.batchImportMcpServers([
      {
        name: 'Demo Server',
        description: 'Demo server',
        package: '@demo/server',
        args: ['--demo'],
        env: { DEMO: '1' },
        source: 'modelscope'
      }
    ])

    expect(result).toEqual({
      imported: 1,
      skipped: 0,
      errors: []
    })
    const mcpServers = await helper.getMcpServers()
    expect(Object.values(mcpServers)).toContainEqual(
      expect.objectContaining({
        package: '@demo/server'
      })
    )
  })

  it('finalizes OAuth against the current binding while retaining unrelated settings', async () => {
    const { McpSettings } = await loadHelper('darwin')
    const helper = new McpSettings()
    await helper.addMcpServer('oauth', {
      type: 'http',
      baseUrl: 'https://mcp.example/mcp',
      command: '',
      args: [],
      env: {},
      descriptions: '',
      icons: '',
      enabled: false
    })
    const initial = (await helper.getMcpServers()).oauth
    const expected = {
      serverId: initial.serverId!,
      configGeneration: initial.configGeneration!,
      bindingHash: initial.bindingHash!,
      endpoint: initial.baseUrl!
    }
    await helper.updateMcpServer('oauth', { descriptions: 'Current description' })
    const authorization = {
      mode: 'interactive' as const,
      authorizationServerIssuer: 'https://auth.example/',
      protectedResourceUrl: expected.endpoint,
      clientId: 'client'
    }
    const finalized = helper.finalizeOAuthBinding(expected, authorization)
    expect(finalized).toMatchObject({
      descriptions: 'Current description',
      authorization,
      configGeneration: expected.configGeneration + 1
    })
    expect((await helper.getMcpServers()).oauth).toEqual(finalized)
    const set = vi.spyOn((helper as any).mcpStore, 'set')
    expect(
      helper.finalizeOAuthBinding(
        {
          ...expected,
          configGeneration: finalized.configGeneration!,
          bindingHash: finalized.bindingHash!
        },
        authorization
      )
    ).toEqual(finalized)
    expect(set).not.toHaveBeenCalled()
  })

  it.each(['replace', 'remove', 'write failure'] as const)(
    'preserves owner state when OAuth finalization encounters %s',
    async (change) => {
      const { McpSettings } = await loadHelper('darwin')
      const helper = new McpSettings()
      await helper.addMcpServer('oauth', {
        type: 'http',
        baseUrl: 'https://mcp.example/mcp',
        command: '',
        args: [],
        env: {},
        descriptions: '',
        icons: '',
        enabled: false
      })
      const initial = (await helper.getMcpServers()).oauth
      const expected = {
        serverId: initial.serverId!,
        configGeneration: initial.configGeneration!,
        bindingHash: initial.bindingHash!,
        endpoint: initial.baseUrl!
      }
      if (change === 'replace')
        await helper.updateMcpServer('oauth', { baseUrl: 'https://replacement.example/mcp' })
      if (change === 'remove') await helper.removeMcpServer('oauth')
      const store = (helper as any).mcpStore
      const before = clone(store.get('mcpServers'))
      if (change === 'write failure')
        vi.spyOn(store, 'set').mockImplementationOnce(() => {
          throw new Error('write failure')
        })
      expect(() =>
        helper.finalizeOAuthBinding(expected, { mode: 'interactive', clientId: 'discovered' })
      ).toThrow(
        change === 'replace' ? 'binding changed' : change === 'remove' ? 'removed' : 'write failure'
      )
      expect(store.get('mcpServers')).toEqual(before)
    }
  )
})
