import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { SettingsDatabase } from '@/settings/data/database'
import type { SettingsTables } from '@/settings/data/tables/settingsTables'
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
    const tables = createSettingsTables()

    const result = migrateConfigStorage({
      database: { settingsTables: tables } as SettingsDatabase,
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
    expect(tables.replaceProviders).toHaveBeenCalledWith([provider('openai')], ['openai'], {
      openai: 123
    })
    expect(tables.replaceProviderModels).toHaveBeenCalledWith('openai', 'provider', [
      { id: 'gpt-4', providerId: 'openai' }
    ])
    expect(tables.replaceProviderModels).toHaveBeenCalledWith('openai', 'custom', [
      { id: 'custom', providerId: 'openai' }
    ])
    expect(tables.setModelStatus).toHaveBeenCalledWith(
      'model_status_openai_gpt-4',
      'openai',
      'gpt-4',
      true
    )
    expect(tables.setMcpSetting).toHaveBeenCalledWith('mcpEnabled', true)
    expect(tables.setAgentSetting).toHaveBeenCalledWith('enabled', true)
    expect(tables.setAgentMcpSelections).toHaveBeenCalledWith(['server'])
    expect(tables.setAppSetting).toHaveBeenCalledWith('hooksNotifications', { enabled: true }, true)
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

function createSettingsTables(): SettingsTables {
  return {
    hasConfigMigration: vi.fn(() => false),
    replaceProviders: vi.fn(),
    replaceProviderModels: vi.fn(),
    setModelStatus: vi.fn(),
    setModelConfigStoreEntry: vi.fn(),
    replaceMcpServers: vi.fn(),
    setMcpSetting: vi.fn(),
    setAgentSetting: vi.fn(),
    setAgentMcpSelections: vi.fn(),
    setAppSetting: vi.fn(),
    markConfigMigrationApplied: vi.fn()
  } as unknown as SettingsTables
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
