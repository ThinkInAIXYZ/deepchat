import { describe, expect, it } from 'vitest'
import type { LLM_PROVIDER, MODEL_META } from '@shared/types/provider'

const sqliteModule = await import('better-sqlite3-multiple-ciphers').catch(() => null)
const tableModule = sqliteModule ? await import('@/provider/data/settingsTable') : null

const Database = sqliteModule?.default
const ProviderSettingsTable = tableModule?.ProviderSettingsTable
const DatabaseCtor = Database!
const ProviderSettingsTableCtor = ProviderSettingsTable!

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

describeIfSqlite('ProviderSettingsTable', () => {
  const createTable = () => {
    const db = new DatabaseCtor(':memory:')
    const table = new ProviderSettingsTableCtor(db)
    table.createTable()
    return { db, table }
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
    const { db, table } = createTable()

    table.replaceProviders([provider('a'), provider('b')], ['b', 'a'], { a: 100, b: 200 })

    expect(table.listProviders().map((item) => item.id)).toEqual(['b', 'a'])
    expect(table.getProviderOrder()).toEqual(['b', 'a'])
    expect(table.getProviderTimestamps()).toEqual({ a: 100, b: 200 })

    table.upsertProvider({ ...provider('a'), name: 'Provider A', enable: false })
    expect(table.listProviders().find((item) => item.id === 'a')).toMatchObject({
      id: 'a',
      name: 'Provider A',
      enable: false
    })

    db.close()
  })

  it('stores provider models, statuses, and configs', () => {
    const { db, table } = createTable()

    table.replaceProviders([provider('openai')])
    table.replaceProviderModels('openai', 'provider', [
      {
        id: 'gpt-4',
        name: 'GPT-4',
        providerId: 'openai',
        group: 'chat',
        isCustom: false
      } as MODEL_META
    ])
    table.replaceProviderModels('openai', 'custom', [
      {
        id: 'custom-model',
        name: 'Custom Model',
        providerId: 'openai',
        isCustom: true
      } as MODEL_META
    ])

    expect(table.listProviderModels('openai', 'provider')).toHaveLength(1)
    expect(table.listProviderModels('openai', 'custom')[0]).toMatchObject({
      id: 'custom-model',
      isCustom: true
    })

    table.setModelStatus('model_status_openai_gpt-4', 'openai', 'gpt-4', true)
    expect(table.getModelStatus('model_status_openai_gpt-4')).toBe(true)
    expect(table.listModelStatusEntries()).toEqual({ 'model_status_openai_gpt-4': true })

    table.setModelConfigStoreEntry('openai-_-gpt-4', {
      id: 'gpt-4',
      providerId: 'openai',
      source: 'user',
      config: { temperature: 0.2 }
    })
    expect(table.getModelConfigStoreEntry('openai-_-gpt-4')).toMatchObject({
      id: 'gpt-4',
      providerId: 'openai'
    })

    db.close()
  })
})
