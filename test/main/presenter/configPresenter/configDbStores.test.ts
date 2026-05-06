import { describe, expect, it, vi } from 'vitest'
import {
  AcpDbStore,
  AppSettingsDbBackedStore,
  McpDbStore
} from '../../../../src/main/presenter/configPresenter/configDbStores'
import type { ConfigTables } from '../../../../src/main/presenter/sqlitePresenter/tables/configTables'
import type { StoreLike } from '../../../../src/main/presenter/configPresenter/storeLike'
import type { LLM_PROVIDER, MCPServerConfig } from '../../../../src/shared/presenter'

describe('config DB-backed stores', () => {
  it('keeps legacy provider settings until sqlite rows exist', () => {
    const legacyProvider = provider('legacy')
    const legacy = createLegacyStore({
      providers: [legacyProvider],
      providerOrder: ['legacy'],
      providerTimestamps: { legacy: 123 },
      'model_status_legacy_gpt-4': true
    })
    const tables = createConfigTables()
    const store = new AppSettingsDbBackedStore(legacy, tables)

    expect(store.store.providers).toEqual([legacyProvider])
    expect(store.store.providerOrder).toEqual(['legacy'])
    expect(store.store.providerTimestamps).toEqual({ legacy: 123 })
    expect(store.store['model_status_legacy_gpt-4']).toBe(true)
    expect(store.get('providers')).toEqual([legacyProvider])
    expect(store.get('providerOrder')).toEqual(['legacy'])
    expect(store.get('providerTimestamps')).toEqual({ legacy: 123 })
    expect(store.get('model_status_legacy_gpt-4')).toBe(true)
    expect(store.has('providers')).toBe(true)
    expect(store.has('model_status_legacy_gpt-4')).toBe(true)
  })

  it('uses sqlite provider settings when sqlite rows exist', () => {
    const sqliteProvider = provider('sqlite')
    const legacy = createLegacyStore({
      providers: [provider('legacy')],
      providerOrder: ['legacy'],
      providerTimestamps: { legacy: 123 },
      'model_status_sqlite_gpt-4': false
    })
    const tables = createConfigTables({
      providers: [sqliteProvider],
      providerOrder: ['sqlite'],
      providerTimestamps: { sqlite: 456 },
      modelStatuses: { 'model_status_sqlite_gpt-4': true }
    })
    const store = new AppSettingsDbBackedStore(legacy, tables)

    expect(store.store.providers).toEqual([sqliteProvider])
    expect(store.store.providerOrder).toEqual(['sqlite'])
    expect(store.store.providerTimestamps).toEqual({ sqlite: 456 })
    expect(store.store['model_status_sqlite_gpt-4']).toBe(true)
    expect(store.get('providers')).toEqual([sqliteProvider])
    expect(store.get('providerOrder')).toEqual(['sqlite'])
    expect(store.get('providerTimestamps')).toEqual({ sqlite: 456 })
    expect(store.get('model_status_sqlite_gpt-4')).toBe(true)
  })

  it('does not restore cleared legacy provider settings after migration', () => {
    const legacyProvider = provider('legacy')
    const legacy = createLegacyStore({
      providers: [legacyProvider],
      providerOrder: ['legacy'],
      providerTimestamps: { legacy: 123 },
      'model_status_legacy_gpt-4': true
    })
    const tables = createConfigTables({ hasMigration: true })
    const store = new AppSettingsDbBackedStore(legacy, tables)

    expect(store.store.providers).toEqual([])
    expect(store.store.providerOrder).toEqual([])
    expect(store.store.providerTimestamps).toEqual({})
    expect(store.store['model_status_legacy_gpt-4']).toBeUndefined()
    expect(store.get('providers', [])).toEqual([])
    expect(store.get('providerOrder', [])).toEqual([])
    expect(store.get('providerTimestamps', {})).toEqual({})
    expect(store.get('model_status_legacy_gpt-4', false)).toBe(false)
    expect(store.has('providers')).toBe(false)
    expect(store.has('model_status_legacy_gpt-4')).toBe(false)
  })

  it('keeps legacy MCP servers until sqlite rows exist', () => {
    const legacyServers = { legacy: mcpServer('legacy-command') }
    const legacy = createLegacyStore({ mcpServers: legacyServers })
    const tables = createConfigTables()
    const store = new McpDbStore(legacy, tables)

    expect(store.store.mcpServers).toEqual(legacyServers)
    expect(store.get('mcpServers')).toEqual(legacyServers)
    expect(store.has('mcpServers')).toBe(true)
  })

  it('does not restore cleared legacy MCP servers after migration', () => {
    const legacyServers = { legacy: mcpServer('legacy-command') }
    const legacy = createLegacyStore({ mcpServers: legacyServers, mcpEnabled: true })
    const tables = createConfigTables({ hasMigration: true })
    const store = new McpDbStore(legacy, tables)

    expect(store.store.mcpServers).toEqual({})
    expect(store.store.mcpEnabled).toBeUndefined()
    expect(store.get('mcpServers', {})).toEqual({})
    expect(store.get('mcpEnabled', false)).toBe(false)
    expect(store.has('mcpServers')).toBe(false)
    expect(store.has('mcpEnabled')).toBe(false)
  })

  it('keeps legacy ACP shared selections until sqlite rows exist', () => {
    const legacy = createLegacyStore({
      enabled: true,
      sharedMcpSelections: ['legacy-server']
    })
    const tables = createConfigTables()
    const store = new AcpDbStore(legacy, tables)

    expect(store.store.enabled).toBe(true)
    expect(store.store.sharedMcpSelections).toEqual(['legacy-server'])
    expect(store.get('sharedMcpSelections')).toEqual(['legacy-server'])
  })

  it('does not restore cleared legacy ACP shared selections after migration', () => {
    const legacy = createLegacyStore({
      enabled: true,
      sharedMcpSelections: ['legacy-server']
    })
    const tables = createConfigTables({ hasMigration: true })
    const store = new AcpDbStore(legacy, tables)

    expect(store.store.enabled).toBeUndefined()
    expect(store.store.sharedMcpSelections).toEqual([])
    expect(store.get('enabled', false)).toBe(false)
    expect(store.get('sharedMcpSelections', [])).toEqual([])
  })
})

function createLegacyStore(initial: Record<string, unknown>): StoreLike<Record<string, unknown>> {
  const state = { ...initial }
  return {
    store: state,
    get: vi.fn((key: string, defaultValue?: unknown) =>
      state[key] === undefined ? defaultValue : state[key]
    ) as StoreLike<Record<string, unknown>>['get'],
    set: vi.fn((keyOrValues: string | Record<string, unknown>, value?: unknown) => {
      if (typeof keyOrValues === 'string') {
        state[keyOrValues] = value
        return
      }
      Object.assign(state, keyOrValues)
    }) as StoreLike<Record<string, unknown>>['set'],
    delete: vi.fn((key: string) => {
      delete state[key]
    }),
    has: vi.fn((key: string) => state[key] !== undefined)
  }
}

function createConfigTables(
  overrides: {
    providers?: LLM_PROVIDER[]
    providerOrder?: string[]
    providerTimestamps?: Record<string, number>
    modelStatuses?: Record<string, boolean>
    mcpServers?: Record<string, MCPServerConfig>
    mcpSettings?: Record<string, unknown>
    agentSettings?: Record<string, unknown>
    agentSelections?: string[]
    hasMigration?: boolean
  } = {}
): ConfigTables {
  const modelStatuses = overrides.modelStatuses ?? {}
  const mcpSettings = overrides.mcpSettings ?? {}
  const agentSettings = overrides.agentSettings ?? {}
  return {
    listProviders: vi.fn(() => overrides.providers ?? []),
    getProviderOrder: vi.fn(() => overrides.providerOrder ?? []),
    getProviderTimestamps: vi.fn(() => overrides.providerTimestamps ?? {}),
    listModelStatusEntries: vi.fn(() => modelStatuses),
    getModelStatus: vi.fn((key: string) => modelStatuses[key]),
    hasModelStatus: vi.fn((key: string) => Object.hasOwn(modelStatuses, key)),
    listMcpServers: vi.fn(() => overrides.mcpServers ?? {}),
    listMcpSettings: vi.fn(() => mcpSettings),
    getMcpSetting: vi.fn((key: string) => mcpSettings[key]),
    listAgentSettings: vi.fn(() => agentSettings),
    getAgentSetting: vi.fn((key: string) => agentSettings[key]),
    getAgentMcpSelections: vi.fn(() => overrides.agentSelections ?? []),
    hasConfigMigration: vi.fn(() => overrides.hasMigration ?? false)
  } as unknown as ConfigTables
}

function provider(id: string): LLM_PROVIDER {
  return {
    id,
    name: id,
    apiType: 'openai',
    apiKey: '',
    baseUrl: '',
    enable: true
  }
}

function mcpServer(command: string): MCPServerConfig {
  return {
    command,
    args: [],
    env: {},
    descriptions: '',
    icons: '',
    autoApprove: [],
    enabled: true,
    type: 'stdio'
  }
}
