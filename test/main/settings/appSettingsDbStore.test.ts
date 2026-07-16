import { describe, expect, it, vi } from 'vitest'
import { AppSettingsDbBackedStore } from '../../../src/main/settings/appSettingsDbStore'
import { AcpDbStore } from '@/agent/acp/catalog/settingsDbStore'
import { McpDbStore } from '@/mcp/settingsDbStore'
import { ProviderDbStore } from '@/provider/settingsDbStores'
import type { AppSettingsTable } from '@/settings/data/tables/appSettingsTable'
import type { ProviderSettingsTable } from '@/provider/data/settingsTable'
import type { McpSettingsTable } from '@/mcp/data/settingsTable'
import type { AgentCatalogSettingsTable } from '@/agent/acp/catalog/data/settingsTable'
import type { StoreLike } from '../../../src/main/config/storeLike'
import type { LLM_PROVIDER } from '@shared/types/provider'
import type { MCPServerConfig } from '@shared/types/mcp'

describe('settings DB-backed stores', () => {
  it('does not read migrated provider settings from legacy storage', () => {
    const legacyProvider = provider('legacy')
    const legacy = createLegacyStore({
      providers: [legacyProvider],
      providerOrder: ['legacy'],
      providerTimestamps: { legacy: 123 },
      'model_status_legacy_gpt-4': true
    })
    const tables = createAppSettingsTable()
    const store = new ProviderDbStore(legacy, () => tables)

    expect(store.store.providers).toEqual([])
    expect(store.store.providerOrder).toEqual([])
    expect(store.store.providerTimestamps).toEqual({})
    expect(store.store['model_status_legacy_gpt-4']).toBeUndefined()
    expect(store.get('providers', [])).toEqual([])
    expect(store.get('model_status_legacy_gpt-4', false)).toBe(false)
    expect(store.has('providers')).toBe(false)
    expect(store.has('model_status_legacy_gpt-4')).toBe(false)
  })

  it('uses sqlite provider settings when sqlite rows exist', () => {
    const sqliteProvider = provider('sqlite')
    const legacy = createLegacyStore({
      providers: [provider('legacy')],
      providerOrder: ['legacy'],
      providerTimestamps: { legacy: 123 },
      'model_status_sqlite_gpt-4': false
    })
    const tables = createAppSettingsTable({
      providers: [sqliteProvider],
      providerOrder: ['sqlite'],
      providerTimestamps: { sqlite: 456 },
      modelStatuses: { 'model_status_sqlite_gpt-4': true }
    })
    const store = new ProviderDbStore(legacy, () => tables)

    expect(store.store.providers).toEqual([sqliteProvider])
    expect(store.store.providerOrder).toEqual(['sqlite'])
    expect(store.store.providerTimestamps).toEqual({ sqlite: 456 })
    expect(store.store['model_status_sqlite_gpt-4']).toBe(true)
    expect(store.get('providers')).toEqual([sqliteProvider])
    expect(store.get('providerOrder')).toEqual(['sqlite'])
    expect(store.get('providerTimestamps')).toEqual({ sqlite: 456 })
    expect(store.get('model_status_sqlite_gpt-4')).toBe(true)
  })

  it('reads MCP settings only from sqlite', () => {
    const sqliteServers = { sqlite: mcpServer('sqlite-command') }
    const tables = createAppSettingsTable({
      mcpServers: sqliteServers,
      mcpSettings: { mcpEnabled: true }
    })
    const store = new McpDbStore(() => tables)

    expect(store.store.mcpServers).toEqual(sqliteServers)
    expect(store.store.mcpEnabled).toBe(true)
    expect(store.get('mcpServers')).toEqual(sqliteServers)
    expect(store.has('mcpServers')).toBe(true)
  })

  it('reads migrated ACP fields from sqlite and keeps agent-owned legacy fields', () => {
    const legacy = createLegacyStore({
      enabled: true,
      sharedMcpSelections: ['legacy-server'],
      manualAgents: [{ id: 'legacy-agent' }]
    })
    const tables = createAppSettingsTable({
      agentSettings: { enabled: false, version: '4' },
      agentSelections: ['sqlite-server']
    })
    const store = new AcpDbStore(legacy, () => tables)

    expect(store.store.enabled).toBe(false)
    expect(store.store.sharedMcpSelections).toEqual(['sqlite-server'])
    expect(store.store.manualAgents).toEqual([{ id: 'legacy-agent' }])
    expect(store.get('enabled', false)).toBe(false)
    expect(store.get('sharedMcpSelections', [])).toEqual(['sqlite-server'])
  })

  it('keeps provider keys opaque in the app settings store', () => {
    const legacy = createLegacyStore({ providers: ['legacy-provider'] })
    const tables = createAppSettingsTable({ appSettings: { customPrompts: [{ id: 'prompt' }] } })
    const store = new AppSettingsDbBackedStore(legacy, () => tables)

    expect(store.get('providers')).toEqual(['legacy-provider'])
    expect(store.get('customPrompts')).toEqual([{ id: 'prompt' }])
    expect(store.store).toEqual({
      providers: ['legacy-provider'],
      customPrompts: [{ id: 'prompt' }]
    })
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

function createAppSettingsTable(
  overrides: {
    providers?: LLM_PROVIDER[]
    providerOrder?: string[]
    providerTimestamps?: Record<string, number>
    modelStatuses?: Record<string, boolean>
    mcpServers?: Record<string, MCPServerConfig>
    mcpSettings?: Record<string, unknown>
    agentSettings?: Record<string, unknown>
    agentSelections?: string[]
    appSettings?: Record<string, unknown>
  } = {}
): AppSettingsTable & ProviderSettingsTable & McpSettingsTable & AgentCatalogSettingsTable {
  const modelStatuses = overrides.modelStatuses ?? {}
  const mcpSettings = overrides.mcpSettings ?? {}
  const agentSettings = overrides.agentSettings ?? {}
  const appSettings = overrides.appSettings ?? {}
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
    listAppSettings: vi.fn(() => appSettings),
    getAppSetting: vi.fn((key: string) => appSettings[key])
  } as unknown as AppSettingsTable &
    ProviderSettingsTable &
    McpSettingsTable &
    AgentCatalogSettingsTable
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
