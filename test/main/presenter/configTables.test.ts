import { describe, expect, it } from 'vitest'
import type { LLM_PROVIDER, MCPServerConfig, MODEL_META } from '../../../src/shared/presenter'

const sqliteModule = await import('better-sqlite3-multiple-ciphers').catch(() => null)
const configTablesModule = sqliteModule
  ? await import('../../../src/main/presenter/sqlitePresenter/tables/configTables')
  : null

const Database = sqliteModule?.default
const ConfigTables = configTablesModule?.ConfigTables
const DatabaseCtor = Database!
const ConfigTablesCtor = ConfigTables!

let sqliteAvailable = false
if (Database) {
  try {
    const smokeDb = new Database(':memory:')
    smokeDb.close()
    sqliteAvailable = true
  } catch {
    sqliteAvailable = false
  }
}

const describeIfSqlite = sqliteAvailable ? describe : describe.skip

describeIfSqlite('ConfigTables', () => {
  const createTables = () => {
    const db = new DatabaseCtor(':memory:')
    const tables = new ConfigTablesCtor(db)
    tables.createTable()
    return { db, tables }
  }

  const provider = (id: string, name = id) =>
    ({
      id,
      name,
      apiType: 'openai',
      apiKey: `${id}-key`,
      baseUrl: `https://${id}.example.com`,
      enable: true
    }) as LLM_PROVIDER

  it('persists providers with order and timestamps', () => {
    const { db, tables } = createTables()

    tables.replaceProviders([provider('a'), provider('b')], ['b', 'a'], { a: 100, b: 200 })

    expect(tables.listProviders().map((item) => item.id)).toEqual(['b', 'a'])
    expect(tables.getProviderOrder()).toEqual(['b', 'a'])
    expect(tables.getProviderTimestamps()).toEqual({ a: 100, b: 200 })

    tables.upsertProvider({ ...provider('a'), name: 'Provider A', enable: false })
    expect(tables.listProviders().find((item) => item.id === 'a')).toMatchObject({
      id: 'a',
      name: 'Provider A',
      enable: false
    })

    db.close()
  })

  it('stores provider models, statuses, configs, MCP settings, and shared agent selections', () => {
    const { db, tables } = createTables()

    tables.replaceProviders([provider('openai')])
    tables.replaceProviderModels('openai', 'provider', [
      {
        id: 'gpt-4',
        name: 'GPT-4',
        providerId: 'openai',
        group: 'chat',
        isCustom: false
      } as MODEL_META
    ])
    tables.replaceProviderModels('openai', 'custom', [
      {
        id: 'custom-model',
        name: 'Custom Model',
        providerId: 'openai',
        isCustom: true
      } as MODEL_META
    ])

    expect(tables.listProviderModels('openai', 'provider')).toHaveLength(1)
    expect(tables.listProviderModels('openai', 'custom')[0]).toMatchObject({
      id: 'custom-model',
      isCustom: true
    })

    tables.setModelStatus('model_status_openai_gpt-4', 'openai', 'gpt-4', true)
    expect(tables.getModelStatus('model_status_openai_gpt-4')).toBe(true)
    expect(tables.listModelStatusEntries()).toEqual({ 'model_status_openai_gpt-4': true })

    tables.setModelConfigStoreEntry('openai-_-gpt-4', {
      id: 'gpt-4',
      providerId: 'openai',
      source: 'user',
      config: { temperature: 0.2 }
    })
    expect(tables.getModelConfigStoreEntry('openai-_-gpt-4')).toMatchObject({
      id: 'gpt-4',
      providerId: 'openai'
    })

    tables.replaceMcpServers({
      local: {
        command: 'bunx',
        args: ['server'],
        env: {},
        type: 'stdio',
        enabled: true
      } as MCPServerConfig
    })
    tables.setMcpSetting('mcpEnabled', true)
    expect(tables.listMcpServers().local.enabled).toBe(true)
    expect(tables.getMcpSetting('mcpEnabled')).toBe(true)

    tables.setAgentMcpSelections(['local', 'remote'])
    expect(tables.getAgentMcpSelections()).toEqual(['local', 'remote'])

    db.close()
  })
})
