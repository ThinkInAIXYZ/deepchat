import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mockStores = vi.hoisted(() => new Map<string, Record<string, any>>())
const mockKnowledgeSupported = vi.hoisted(() => vi.fn().mockResolvedValue(true))

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

    set(key: string, value: any) {
      this.data[key] = value
    }

    delete(key: string) {
      delete this.data[key]
    }

    has(key: string) {
      return key in this.data
    }
  }
}))

vi.mock('@/eventbus', () => ({
  eventBus: {
    send: vi.fn(),
    sendToRenderer: vi.fn()
  },
  SendTarget: {
    ALL_WINDOWS: 'ALL_WINDOWS'
  }
}))

vi.mock('@/events', () => ({
  MCP_EVENTS: {
    CONFIG_CHANGED: 'mcp-config-changed'
  }
}))

vi.mock('../../../../src/main/presenter', () => ({
  presenter: {
    knowledgePresenter: {
      isSupported: mockKnowledgeSupported
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
  return await import('../../../../src/main/presenter/configPresenter/mcpConfHelper')
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

describe('McpConfHelper', () => {
  beforeEach(() => {
    mockStores.clear()
    mockKnowledgeSupported.mockResolvedValue(true)
  })

  afterEach(() => {
    vi.clearAllMocks()
    if (originalPlatform) {
      Object.defineProperty(process, 'platform', originalPlatform)
    }
  })

  it('honors an empty legacy enabled set when legacy keys are present', async () => {
    const { McpConfHelper } = await loadHelper('darwin')
    const helper = new McpConfHelper()
    const mcpStore = (helper as any).mcpStore
    const artifactsConfig = { ...mcpStore.get('mcpServers').Artifacts }

    delete artifactsConfig.enabled
    mcpStore.set('mcpServers', {
      Artifacts: artifactsConfig
    })
    mcpStore.set('defaultServers', [])

    const servers = await helper.getMcpServers()

    expect(servers.Artifacts.enabled).toBe(false)
    expect(mcpStore.has('defaultServers')).toBe(false)
  })

  it('does not recreate the Apple built-in server after the user removed it', async () => {
    const { McpConfHelper } = await loadHelper('darwin')
    const helper = new McpConfHelper()
    const mcpStore = (helper as any).mcpStore

    mcpStore.set('mcpServers', {})
    mcpStore.set('removedBuiltInServers', ['deepchat/apple-server'])

    helper.onUpgrade(undefined)

    expect(mcpStore.get('mcpServers')['deepchat/apple-server']).toBeUndefined()
  })

  it('removes the Computer Use managed server on unsupported platforms', async () => {
    const { McpConfHelper } = await loadHelper('win32')
    const helper = new McpConfHelper()
    const mcpStore = (helper as any).mcpStore

    mcpStore.set('mcpServers', {
      'deepchat/computer-use': {
        type: 'stdio',
        command: '/helper/cua-driver',
        args: ['mcp'],
        enabled: true,
        source: 'deepchat',
        sourceId: 'computer-use'
      }
    })

    const servers = await helper.getMcpServers()

    expect(servers['deepchat/computer-use']).toBeUndefined()
  })

  it('migrates legacy builtin knowledge configs out of MCP env', async () => {
    const { McpConfHelper } = await loadHelper('win32')
    const helper = new McpConfHelper()
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
    const { McpConfHelper } = await loadHelper('win32')
    const helper = new McpConfHelper()
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
})
