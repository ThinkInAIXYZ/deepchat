import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { SettingsDatabase } from '@/settings/data/database'
import type { AppSettingsTable } from '@/settings/data/tables/appSettingsTable'
import type { ProviderDatabase } from '@/provider/data/database'
import type { ProviderSettingsTable } from '@/provider/data/settingsTable'
import type { McpDatabase } from '@/mcp/data/database'
import type { McpSettingsTable } from '@/mcp/data/settingsTable'
import type { AgentDatabase } from '@/agent/data/database'
import type { AgentCatalogSettingsTable } from '@/agent/acp/catalog/data/settingsTable'
import { SettingsStore } from '@/config/settingsStore'
import type { StoreLike } from '@/config/storeLike'
import { migrateConfigStorage } from '@/config/migration'

const electronStores = vi.hoisted(() => new Map<string, Record<string, unknown>>())

vi.mock('electron-store', () => ({
  default: class MockElectronStore {
    private readonly key: string

    constructor(options: { name: string; cwd?: string; defaults?: Record<string, unknown> }) {
      this.key = `${options.cwd ?? ''}/${options.name}`
      if (!electronStores.has(this.key)) {
        electronStores.set(this.key, { ...(options.defaults ?? {}) })
      }
    }

    get store(): Record<string, unknown> {
      return electronStores.get(this.key)!
    }

    get(key: string, defaultValue?: unknown): unknown {
      return this.store[key] ?? defaultValue
    }

    set(key: string, value: unknown): void {
      this.store[key] = value
    }
  }
}))

describe('config storage migration', () => {
  beforeEach(() => electronStores.clear())

  it('moves legacy storage before modules connect to sqlite', () => {
    const legacyStore = createStore({
      appVersion: '0.9.0',
      providers: [provider('openai')],
      providerOrder: ['openai'],
      providerTimestamps: { openai: 123 },
      'model_status_openai_gpt-4': true,
      hooksNotifications: { enabled: true }
    })
    const settings = new SettingsStore(legacyStore)
    electronStores.set('/user-data/provider_models/models_openai', {
      models: [{ id: 'gpt-4', providerId: 'openai' }],
      custom_models: [{ id: 'custom', providerId: 'openai' }]
    })
    electronStores.set('/model-config', {
      'openai_-_gpt-4': { source: 'user', config: { isUserDefined: true } }
    })
    electronStores.set('/custom_prompts', { prompts: [{ id: 'custom' }] })
    electronStores.set('/system_prompts', { prompts: [{ id: 'system' }] })
    electronStores.set('/knowledge-configs', { knowledgeConfigs: [{ id: 'knowledge' }] })
    const tables = createAppSettingsTable()
    const providerTables = createProviderSettingsTable()
    const mcpTables = createMcpSettingsTable()
    const agentTables = createAgentSettingsTable({
      'sqlite-mainline-normalization-v1': { status: 'completed' }
    })

    const result = migrateConfigStorage({
      database: { appSettingsTable: tables } as SettingsDatabase,
      providerDatabase: { settingsTable: providerTables } as ProviderDatabase,
      mcpDatabase: { settingsTable: mcpTables } as McpDatabase,
      agentDatabase: { catalogSettingsTable: agentTables } as AgentDatabase,
      settings,
      mcpSettings: {
        mcpServers: { server: { command: 'command' } },
        mcpEnabled: true
      },
      acpCatalog: { enabled: true, sharedMcpSelections: ['server'] },
      userDataPath: '/user-data',
      currentAppVersion: '1.0.0'
    })

    expect(result).toEqual({ previousAppVersion: '0.9.0', appVersionChanged: true })
    expect(providerTables.replaceProviders).toHaveBeenCalledWith([provider('openai')], ['openai'], {
      openai: 123
    })
    expect(providerTables.replaceProviderModels).toHaveBeenCalledWith('openai', 'provider', [
      { id: 'gpt-4', providerId: 'openai' }
    ])
    expect(providerTables.replaceProviderModels).toHaveBeenCalledWith('openai', 'custom', [
      { id: 'custom', providerId: 'openai' }
    ])
    expect(providerTables.setModelStatus).toHaveBeenCalledWith(
      'model_status_openai_gpt-4',
      'openai',
      'gpt-4',
      true
    )
    expect(mcpTables.setMcpSetting).toHaveBeenCalledWith('mcpEnabled', true)
    expect(agentTables.setAgentSetting).toHaveBeenCalledWith('enabled', true)
    expect(agentTables.setAgentMcpSelections).toHaveBeenCalledWith(['server'])
    expect(tables.setAppSetting).toHaveBeenCalledWith('hooksNotifications', { enabled: true }, true)
    expect(tables.setAppSetting).toHaveBeenCalledWith(
      'sqlite-mainline-normalization-v1',
      { status: 'completed' },
      false
    )
    expect(agentTables.deleteAgentSetting).toHaveBeenCalledWith('sqlite-mainline-normalization-v1')
    expect(legacyStore.get('hooksNotifications')).toBeUndefined()
    expect(legacyStore.get('appVersion')).toBe('1.0.0')
    expect(electronStores.get('/custom_prompts')?.prompts).toEqual([])
    expect(electronStores.get('/system_prompts')?.prompts).toEqual([])
    expect(electronStores.get('/knowledge-configs')?.knowledgeConfigs).toEqual([])
  })
})

function createStore(initial: Record<string, unknown>): StoreLike<Record<string, unknown>> {
  const state = { ...initial }
  return {
    store: state,
    get: ((key: string, defaultValue?: unknown) => state[key] ?? defaultValue) as StoreLike<
      Record<string, unknown>
    >['get'],
    set: ((keyOrValues: string | Record<string, unknown>, value?: unknown) => {
      if (typeof keyOrValues === 'string') state[keyOrValues] = value
      else Object.assign(state, keyOrValues)
    }) as StoreLike<Record<string, unknown>>['set'],
    delete: (key: string) => {
      delete state[key]
    }
  }
}

function createAppSettingsTable(): AppSettingsTable {
  return {
    hasConfigMigration: vi.fn(() => false),
    setAppSetting: vi.fn(),
    markConfigMigrationApplied: vi.fn()
  } as unknown as AppSettingsTable
}

function createAgentSettingsTable(
  settings: Record<string, unknown> = {}
): AgentCatalogSettingsTable {
  return {
    getAgentSetting: vi.fn((key: string) => settings[key]),
    setAgentSetting: vi.fn(),
    deleteAgentSetting: vi.fn(),
    setAgentMcpSelections: vi.fn()
  } as unknown as AgentCatalogSettingsTable
}

function createMcpSettingsTable(): McpSettingsTable {
  return {
    replaceMcpServers: vi.fn(),
    setMcpSetting: vi.fn()
  } as unknown as McpSettingsTable
}

function createProviderSettingsTable(): ProviderSettingsTable {
  return {
    replaceProviders: vi.fn(),
    replaceProviderModels: vi.fn(),
    setModelStatus: vi.fn(),
    setModelConfigStoreEntry: vi.fn()
  } as unknown as ProviderSettingsTable
}

function provider(id: string) {
  return {
    id,
    name: id,
    apiType: 'openai',
    apiKey: '',
    baseUrl: '',
    enable: true
  }
}
