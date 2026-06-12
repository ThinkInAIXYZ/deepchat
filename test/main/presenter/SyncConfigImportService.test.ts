import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import * as fsMock from 'fs'
import os from 'os'
import type {
  IModelConfig,
  LLM_PROVIDER,
  MCPServerConfig,
  MODEL_META
} from '../../../src/shared/types/presenters'

const realFs = await vi.importActual<typeof import('fs')>('fs')
Object.assign(fsMock, realFs)
;(fsMock as any).promises = realFs.promises
const fs = realFs
const path = await vi.importActual<typeof import('path')>('path')

type MockProvider = LLM_PROVIDER & { sortOrder: number; lastUsedAt: number | null }
type MockState = {
  providers: MockProvider[]
  providerModels: Map<string, MODEL_META[]>
  modelStatuses: Record<string, boolean>
  modelConfigs: Record<string, IModelConfig | Record<string, unknown>>
  mcpServers: Record<string, MCPServerConfig>
  mcpSettings: Record<string, unknown>
  agentSettings: Record<string, unknown>
  appSettings: Record<string, unknown>
  agentMcpSelections: string[]
  migrations: Set<string>
}

const mockConfigStates = new Map<string, MockState>()

const createMockState = (): MockState => ({
  providers: [],
  providerModels: new Map(),
  modelStatuses: {},
  modelConfigs: {},
  mcpServers: {},
  mcpSettings: {},
  agentSettings: {},
  appSettings: {},
  agentMcpSelections: [],
  migrations: new Set()
})

const getMockState = (dbPath: string): MockState => {
  let state = mockConfigStates.get(dbPath)
  if (!state) {
    state = createMockState()
    mockConfigStates.set(dbPath, state)
  }
  return state
}

class MockDatabase {
  readonly open = true

  constructor(readonly dbPath: string) {}
  pragma() {
    return this
  }

  close() {}
}

class MockConfigTables {
  private readonly state: MockState

  constructor(db: MockDatabase) {
    this.state = getMockState(db.dbPath)
  }

  createTable() {}

  hasConfigMigration(id = 'config-sqlite-v1'): boolean {
    return this.state.migrations.has(id)
  }

  markConfigMigrationApplied(id = 'config-sqlite-v1'): void {
    this.state.migrations.add(id)
  }

  listProviders(): LLM_PROVIDER[] {
    return [...this.state.providers]
      .sort((left, right) => left.sortOrder - right.sortOrder)
      .map(({ sortOrder: _sortOrder, lastUsedAt: _lastUsedAt, ...provider }) => ({ ...provider }))
  }

  replaceProviders(
    providers: LLM_PROVIDER[],
    order: string[] = [],
    timestamps: Record<string, number> = {}
  ): void {
    this.state.providers = providers.map((item, index) => ({
      ...item,
      sortOrder: this.resolveSortOrder(item.id, index, order),
      lastUsedAt: timestamps[item.id] ?? null
    }))
  }

  upsertProvider(
    provider: LLM_PROVIDER,
    options: { sortOrder?: number; lastUsedAt?: number | null } = {}
  ): void {
    const existingIndex = this.state.providers.findIndex((item) => item.id === provider.id)
    const existing = existingIndex >= 0 ? this.state.providers[existingIndex] : undefined
    const row: MockProvider = {
      ...provider,
      sortOrder: options.sortOrder ?? existing?.sortOrder ?? this.state.providers.length,
      lastUsedAt: options.lastUsedAt ?? existing?.lastUsedAt ?? null
    }

    if (existingIndex >= 0) {
      this.state.providers[existingIndex] = row
    } else {
      this.state.providers.push(row)
    }
  }

  getProviderOrder(): string[] {
    return this.listProviders().map((provider) => provider.id)
  }

  setProviderOrder(order: string[]): void {
    const orderMap = new Map(order.map((providerId, index) => [providerId, index]))
    this.state.providers = this.state.providers.map((provider) => ({
      ...provider,
      sortOrder: orderMap.get(provider.id) ?? provider.sortOrder
    }))
  }

  getProviderTimestamps(): Record<string, number> {
    return Object.fromEntries(
      this.state.providers
        .filter((provider) => typeof provider.lastUsedAt === 'number')
        .map((provider) => [provider.id, provider.lastUsedAt as number])
    )
  }

  listProviderModels(providerId: string, source: 'provider' | 'custom'): MODEL_META[] {
    return [...(this.state.providerModels.get(this.modelKey(providerId, source)) ?? [])]
  }

  replaceProviderModels(
    providerId: string,
    source: 'provider' | 'custom',
    models: MODEL_META[]
  ): void {
    this.state.providerModels.set(
      this.modelKey(providerId, source),
      models.map((model) => ({
        ...model,
        providerId,
        isCustom: source === 'custom' || model.isCustom
      }))
    )
  }

  clearAllProviderModels(): void {
    this.state.providerModels.clear()
  }

  hasModelStatus(statusKey: string): boolean {
    return Object.hasOwn(this.state.modelStatuses, statusKey)
  }

  setModelStatus(statusKey: string, _providerId: string, _modelId: string, enabled: boolean): void {
    this.state.modelStatuses[statusKey] = enabled
  }

  clearModelStatuses(): void {
    this.state.modelStatuses = {}
  }

  listModelStatusEntries(): Record<string, boolean> {
    return { ...this.state.modelStatuses }
  }

  hasModelConfigStoreEntry(cacheKey: string): boolean {
    return Object.hasOwn(this.state.modelConfigs, cacheKey)
  }

  setModelConfigStoreEntry(cacheKey: string, value: IModelConfig | Record<string, unknown>): void {
    this.state.modelConfigs[cacheKey] = value
  }

  getModelConfigStoreEntry(cacheKey: string): IModelConfig | Record<string, unknown> | undefined {
    return this.state.modelConfigs[cacheKey]
  }

  clearModelConfigStore(): void {
    this.state.modelConfigs = {}
  }

  listMcpServers(): Record<string, MCPServerConfig> {
    return { ...this.state.mcpServers }
  }

  replaceMcpServers(servers: Record<string, MCPServerConfig>): void {
    this.state.mcpServers = { ...servers }
  }

  getMcpSetting(key: string): unknown {
    return this.state.mcpSettings[key]
  }

  setMcpSetting(key: string, value: unknown): void {
    this.state.mcpSettings[key] = value
  }

  clearMcpSettings(): void {
    this.state.mcpSettings = {}
  }

  listMcpSettings(): Record<string, unknown> {
    return { ...this.state.mcpSettings }
  }

  getAgentSetting(key: string): unknown {
    return this.state.agentSettings[key]
  }

  setAgentSetting(key: string, value: unknown): void {
    this.state.agentSettings[key] = value
  }

  clearAgentSettings(): void {
    this.state.agentSettings = {}
  }

  listAgentSettings(): Record<string, unknown> {
    return { ...this.state.agentSettings }
  }

  getAppSetting(key: string): unknown {
    return this.state.appSettings[key]
  }

  setAppSetting(key: string, value: unknown): void {
    this.state.appSettings[key] = value
  }

  deleteAppSetting(key: string): void {
    delete this.state.appSettings[key]
  }

  hasAppSetting(key: string): boolean {
    return Object.hasOwn(this.state.appSettings, key)
  }

  listAppSettings(): Record<string, unknown> {
    return { ...this.state.appSettings }
  }

  getAgentMcpSelections(): string[] {
    return [...this.state.agentMcpSelections]
  }

  setAgentMcpSelections(selections: string[]): void {
    this.state.agentMcpSelections = [...selections]
  }

  clearAgentMcpSelections(): void {
    this.state.agentMcpSelections = []
  }

  private resolveSortOrder(providerId: string, fallback: number, order: string[]): number {
    const index = order.indexOf(providerId)
    return index === -1 ? fallback : index
  }

  private modelKey(providerId: string, source: 'provider' | 'custom'): string {
    return `${providerId}:${source}`
  }
}

vi.doMock('better-sqlite3-multiple-ciphers', () => ({
  default: MockDatabase,
  Database: MockDatabase
}))

vi.doMock('../../../src/main/presenter/sqlitePresenter/tables/configTables', () => ({
  ConfigTables: MockConfigTables
}))

const { default: Database } = await import('better-sqlite3-multiple-ciphers')
const { SyncConfigImportService } =
  await import('../../../src/main/presenter/syncPresenter/configImportService')
const { ConfigTables } =
  await import('../../../src/main/presenter/sqlitePresenter/tables/configTables')

describe('SyncConfigImportService', () => {
  let tempDir: string
  let extractionDir: string
  let dbPath: string

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'deepchat-sync-config-'))
    extractionDir = path.join(tempDir, 'backup')
    dbPath = path.join(tempDir, 'agent.db')
    fs.mkdirSync(path.join(extractionDir, 'configs', 'provider_models'), { recursive: true })
  })

  afterEach(() => {
    mockConfigStates.clear()
    removeDir(tempDir)
  })

  it('imports legacy app, model, MCP, and ACP config into sqlite tables', () => {
    writeLegacyConfigFixture(extractionDir)

    const service = new SyncConfigImportService(dbPath)
    service.importLegacyConfig(extractionDir, 'increment')
    service.importLegacyConfig(extractionDir, 'increment')

    const { tables, close } = openConfigTables(dbPath)
    try {
      expect(tables.hasConfigMigration()).toBe(true)
      expect(tables.listProviders().map((provider) => provider.id)).toEqual(['imported', 'local'])
      expect(tables.getProviderTimestamps()).toEqual({
        imported: 22,
        local: 11
      })
      expect(tables.listProviderModels('imported', 'provider').map((model) => model.id)).toEqual([
        'gpt-4',
        'store-model'
      ])
      expect(tables.listProviderModels('imported', 'custom').map((model) => model.id)).toEqual([
        'custom-1',
        'custom-store'
      ])
      expect(tables.listModelStatusEntries()).toEqual({
        'model_status_imported_custom-1': false,
        'model_status_imported_gpt-4': true
      })
      expect(tables.getModelConfigStoreEntry('imported:gpt-4')).toMatchObject({
        id: 'gpt-4',
        providerId: 'imported'
      })
      expect(tables.listMcpServers()['server-a'].enabled).toBe(true)
      expect(tables.listMcpServers()['server-b'].enabled).toBe(false)
      expect(tables.listMcpSettings()).toMatchObject({
        mcpEnabled: true,
        customNpmRegistry: 'https://registry.npmjs.org',
        removedBuiltInServers: ['builtin-old'],
        extraMcpSetting: { nested: true }
      })
      expect(tables.listAgentSettings()).toEqual({
        enabled: true,
        version: '1'
      })
      expect(tables.listAppSettings()).toMatchObject({
        remoteControl: {
          telegram: {
            botToken: 'telegram-token'
          }
        },
        mcprouterApiKey: 'router-key',
        customPrompts: [{ id: 'custom-prompt', title: 'Imported custom prompt' }],
        systemPrompts: [{ id: 'system-prompt', title: 'Imported system prompt' }]
      })
      expect(tables.getAgentMcpSelections()).toEqual(['server-a', 'server-b'])
    } finally {
      close()
    }
  })

  it('preserves local rows in increment mode and replaces them in overwrite mode', () => {
    writeLegacyConfigFixture(extractionDir)

    const { tables, close } = openConfigTables(dbPath)
    try {
      tables.upsertProvider(provider('imported', 'Local Imported'))
      tables.replaceProviderModels('imported', 'provider', [
        { id: 'gpt-4', name: 'Local GPT', group: 'default', providerId: 'imported' }
      ])
      tables.setModelStatus('model_status_imported_gpt-4', 'imported', 'gpt-4', false)
      tables.setModelConfigStoreEntry('imported:gpt-4', {
        id: 'gpt-4',
        providerId: 'imported',
        config: { maxTokens: 1 }
      })
      tables.replaceMcpServers({
        'server-a': mcpServer('local-server-a', false)
      })
      tables.setMcpSetting('mcpEnabled', false)
      tables.setAgentSetting('enabled', false)
      tables.setAgentMcpSelections(['local-server'])
    } finally {
      close()
    }

    const service = new SyncConfigImportService(dbPath)
    service.importLegacyConfig(extractionDir, 'increment')

    const { tables: incrementTables, close: closeIncrementTables } = openConfigTables(dbPath)
    try {
      expect(incrementTables.listProviders().find((item) => item.id === 'imported')?.name).toBe(
        'Local Imported'
      )
      expect(incrementTables.listProviderModels('imported', 'provider')[0].name).toBe('Local GPT')
      expect(incrementTables.listModelStatusEntries()['model_status_imported_gpt-4']).toBe(false)
      expect(incrementTables.getModelConfigStoreEntry('imported:gpt-4')).toMatchObject({
        config: { maxTokens: 1 }
      })
      expect(incrementTables.listMcpServers()['server-a'].command).toBe('local-server-a')
      expect(incrementTables.getMcpSetting('mcpEnabled')).toBe(false)
      expect(incrementTables.getAgentSetting('enabled')).toBe(false)
      expect(incrementTables.getAgentMcpSelections()).toEqual(['local-server'])
    } finally {
      closeIncrementTables()
    }

    service.importLegacyConfig(extractionDir, 'overwrite')

    const { tables: overwriteTables, close: closeOverwriteTables } = openConfigTables(dbPath)
    try {
      expect(overwriteTables.listProviders().find((item) => item.id === 'imported')?.name).toBe(
        'Imported'
      )
      expect(overwriteTables.listProviderModels('imported', 'provider')[0].name).toBe('GPT 4')
      expect(overwriteTables.listModelStatusEntries()['model_status_imported_gpt-4']).toBe(true)
      expect(overwriteTables.getModelConfigStoreEntry('imported:gpt-4')).toMatchObject({
        config: { maxTokens: 123 }
      })
      expect(overwriteTables.listMcpServers()['server-a'].command).toBe('backup-server-a')
      expect(overwriteTables.getMcpSetting('mcpEnabled')).toBe(true)
      expect(overwriteTables.getAgentSetting('enabled')).toBe(true)
      expect(overwriteTables.listAppSettings()).toMatchObject({
        mcprouterApiKey: 'router-key',
        customPrompts: [{ id: 'custom-prompt', title: 'Imported custom prompt' }],
        systemPrompts: [{ id: 'system-prompt', title: 'Imported system prompt' }]
      })
      expect(overwriteTables.getAgentMcpSelections()).toEqual(['server-a', 'server-b'])
    } finally {
      closeOverwriteTables()
    }
  })

  it('clears present-but-empty legacy sections in overwrite mode', () => {
    writeJson(path.join(extractionDir, 'configs', 'app-settings.json'), {
      providers: []
    })
    writeJson(path.join(extractionDir, 'configs', 'model-config.json'), {})
    writeJson(path.join(extractionDir, 'configs', 'mcp-settings.json'), {})
    writeJson(path.join(extractionDir, 'configs', 'acp_agents.json'), {})

    const { tables, close } = openConfigTables(dbPath)
    try {
      tables.upsertProvider(provider('local', 'Local'))
      tables.replaceProviderModels('local', 'provider', [
        { id: 'old-model', name: 'Old Model', group: 'default', providerId: 'local' }
      ])
      tables.setModelStatus('model_status_local_old-model', 'local', 'old-model', true)
      tables.setModelConfigStoreEntry('local:old-model', {
        id: 'old-model',
        providerId: 'local',
        config: { maxTokens: 1 }
      })
      tables.replaceMcpServers({ local: mcpServer('local-server', true) })
      tables.setMcpSetting('mcpEnabled', true)
      tables.setAgentSetting('enabled', true)
      tables.setAgentMcpSelections(['local'])
    } finally {
      close()
    }

    const service = new SyncConfigImportService(dbPath)
    service.importLegacyConfig(extractionDir, 'overwrite')

    const { tables: overwriteTables, close: closeOverwriteTables } = openConfigTables(dbPath)
    try {
      expect(overwriteTables.listProviders()).toEqual([])
      expect(overwriteTables.listProviderModels('local', 'provider')).toEqual([])
      expect(overwriteTables.listModelStatusEntries()).toEqual({})
      expect(overwriteTables.getModelConfigStoreEntry('local:old-model')).toBeUndefined()
      expect(overwriteTables.listMcpServers()).toEqual({})
      expect(overwriteTables.listMcpSettings()).toEqual({})
      expect(overwriteTables.listAgentSettings()).toEqual({})
      expect(overwriteTables.getAgentMcpSelections()).toEqual([])
    } finally {
      closeOverwriteTables()
    }
  })
})

function writeLegacyConfigFixture(extractionDir: string) {
  writeJson(path.join(extractionDir, 'configs', 'app-settings.json'), {
    providers: [provider('local', 'Local'), provider('imported', 'Imported')],
    providerOrder: ['imported', 'local'],
    providerTimestamps: {
      local: 11,
      imported: 22
    },
    imported_models: [
      { id: 'gpt-4', name: 'GPT 4', group: 'default', providerId: 'imported', enabled: true }
    ],
    custom_models_imported: [
      {
        id: 'custom-1',
        name: 'Custom 1',
        group: 'custom',
        providerId: 'imported',
        enabled: false
      }
    ],
    remoteControl: {
      telegram: {
        botToken: 'telegram-token'
      }
    },
    mcprouterApiKey: 'router-key'
  })

  writeJson(path.join(extractionDir, 'configs', 'custom_prompts.json'), {
    prompts: [{ id: 'custom-prompt', title: 'Imported custom prompt' }]
  })

  writeJson(path.join(extractionDir, 'configs', 'system_prompts.json'), {
    prompts: [{ id: 'system-prompt', title: 'Imported system prompt' }]
  })

  writeJson(path.join(extractionDir, 'configs', 'provider_models', 'models_imported.json'), {
    models: [
      { id: 'gpt-4', name: 'Duplicate GPT 4', group: 'default', providerId: 'imported' },
      { id: 'store-model', name: 'Store Model', group: 'remote', providerId: 'imported' }
    ],
    custom_models: [
      { id: 'custom-store', name: 'Custom Store', group: 'custom', providerId: 'imported' }
    ]
  })

  writeJson(path.join(extractionDir, 'configs', 'model-config.json'), {
    'imported:gpt-4': {
      id: 'gpt-4',
      providerId: 'imported',
      config: { maxTokens: 123 }
    }
  })

  writeJson(path.join(extractionDir, 'configs', 'mcp-settings.json'), {
    mcpEnabled: true,
    customNpmRegistry: 'https://registry.npmjs.org',
    removedBuiltInServers: ['builtin-old'],
    extraMcpSetting: { nested: true },
    defaultServers: ['server-a'],
    mcpServers: {
      'server-a': mcpServer('backup-server-a', false),
      'server-b': mcpServer('backup-server-b', false)
    }
  })

  writeJson(path.join(extractionDir, 'configs', 'acp_agents.json'), {
    enabled: true,
    version: '1',
    sharedMcpSelections: ['server-a', 'server-b']
  })
}

function provider(id: string, name: string): LLM_PROVIDER {
  return {
    id,
    name,
    apiType: 'openai',
    apiKey: `${id}-key`,
    baseUrl: `https://${id}.example.com`,
    enable: true,
    custom: id === 'imported'
  }
}

function mcpServer(command: string, enabled: boolean): MCPServerConfig {
  return {
    command,
    args: [],
    env: {},
    descriptions: '',
    icons: '',
    autoApprove: [],
    enabled,
    type: 'stdio'
  }
}

function openConfigTables(dbPath: string): { tables: ConfigTables; close: () => void } {
  const db = new Database(dbPath)
  const tables = new ConfigTables(db)
  tables.createTable()
  return {
    tables,
    close: () => db.close()
  }
}

function writeJson(filePath: string, data: unknown) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true })
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf-8')
}

function removeDir(dirPath: string) {
  if (!fs.existsSync(dirPath)) {
    return
  }
  for (const entry of fs.readdirSync(dirPath)) {
    const entryPath = path.join(dirPath, entry)
    const stat = fs.lstatSync(entryPath)
    if (stat.isDirectory()) {
      removeDir(entryPath)
    } else {
      fs.unlinkSync(entryPath)
    }
  }
  fs.rmdirSync(dirPath)
}
