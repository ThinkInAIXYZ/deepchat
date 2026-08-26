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

  it('persists valid custom headers and ignores malformed legacy values', () => {
    const { db, table } = createTable()
    const configured = {
      ...provider('gateway'),
      customHeaders: {
        'X-Tenant-ID': 'team-a',
        'CF-Access-Client-Secret': 'secret'
      }
    }

    table.replaceProviders([configured])
    expect(table.listProviders()[0].customHeaders).toEqual(configured.customHeaders)

    const stored = db
      .prepare('SELECT provider_json FROM providers WHERE id = ?')
      .get('gateway') as { provider_json: string }
    db.prepare('UPDATE providers SET provider_json = ? WHERE id = ?').run(
      JSON.stringify({
        ...JSON.parse(stored.provider_json),
        customHeaders: { Authorization: 'Bearer legacy-secret' }
      }),
      'gateway'
    )

    expect(table.listProviders()[0]).not.toHaveProperty('customHeaders')
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
    expect(table.getProviderModel('openai', 'gpt-4', 'provider')).toMatchObject({
      id: 'gpt-4',
      providerId: 'openai',
      isCustom: false
    })
    expect(table.getProviderModel('openai', 'custom-model', 'custom')).toMatchObject({
      id: 'custom-model',
      providerId: 'openai',
      isCustom: true
    })
    expect(table.getProviderModel('openai', 'missing', 'provider')).toBeUndefined()

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
    expect(
      table.setModelConfigStoreEntry('openai-_-provider-cache', {
        id: 'provider-cache',
        providerId: 'openai',
        source: 'provider',
        config: { maxTokens: 4096, isUserDefined: false }
      })
    ).toBe(false)
    expect(table.getModelConfigStoreEntry('openai-_-provider-cache')).toBeUndefined()

    db.close()
  })

  it('migrates legacy rows using explicit user intent without value heuristics', () => {
    const { db, table } = createTable()
    const insert = db.prepare(
      `INSERT INTO model_configs (
        cache_key, provider_id, model_id, source, config_json, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, 1, 1)`
    )
    insert.run(
      '__meta__',
      '',
      '',
      null,
      JSON.stringify({ userConfigKeys: ['legacy-user', 'explicit-provider'] })
    )
    insert.run(
      'legacy-user',
      'openai',
      'legacy',
      null,
      JSON.stringify({
        id: 'legacy',
        providerId: 'openai',
        config: { maxTokens: 1234, isUserDefined: false }
      })
    )
    insert.run(
      'explicit-provider',
      'openai',
      'provider-cache',
      'provider',
      JSON.stringify({
        id: 'provider-cache',
        providerId: 'openai',
        source: 'provider',
        config: { maxTokens: 4096, isUserDefined: false }
      })
    )
    insert.run(
      'unknown-legacy',
      'openai',
      'unknown',
      null,
      JSON.stringify({
        id: 'unknown',
        providerId: 'openai',
        config: { maxTokens: 9999, isUserDefined: false }
      })
    )
    insert.run(
      'explicit-user',
      'openai',
      'custom',
      'user',
      JSON.stringify({
        id: 'custom',
        providerId: 'openai',
        source: 'user',
        config: { maxTokens: 200000, isUserDefined: true }
      })
    )

    expect(table.migrateModelConfigsToUserOnly()).toEqual({ removed: 3, preserved: 2 })
    expect(table.listModelConfigStore()).toEqual({
      'legacy-user': expect.objectContaining({
        source: 'user',
        config: expect.objectContaining({ maxTokens: 1234, isUserDefined: true })
      }),
      'explicit-user': expect.objectContaining({
        source: 'user',
        config: expect.objectContaining({ maxTokens: 200000, isUserDefined: true })
      })
    })
    const timestamps = db
      .prepare(
        `SELECT cache_key, created_at, updated_at
         FROM model_configs
         ORDER BY cache_key`
      )
      .all() as Array<{ cache_key: string; created_at: number; updated_at: number }>
    expect(timestamps).toEqual([
      { cache_key: 'explicit-user', created_at: 1, updated_at: 1 },
      expect.objectContaining({ cache_key: 'legacy-user', created_at: 1 })
    ])
    expect(timestamps.find((row) => row.cache_key === 'legacy-user')?.updated_at).toBeGreaterThan(1)

    db.close()
  })

  it('migrates persisted provider projections without touching remote upstream facts', () => {
    const { db, table } = createTable()
    const catalogProjection = {
      id: 'gpt-5.6-sol',
      name: 'GPT-5.6 Sol',
      group: 'Codex',
      providerId: 'openai-codex',
      isCustom: false,
      contextLength: 16_000,
      maxTokens: 4096,
      vision: false,
      functionCall: true,
      reasoning: false,
      type: 'chat',
      selectableEndpointTypes: ['openai']
    } as MODEL_META
    const remoteFacts = {
      id: 'upstream-model',
      name: 'Upstream Model',
      group: 'remote',
      providerId: 'new-api',
      isCustom: false,
      contextLength: 123_456,
      maxTokens: 12_345,
      selectableEndpointTypes: ['openai']
    } as MODEL_META
    table.replaceProviderModels('openai-codex', 'provider', [catalogProjection])
    table.replaceProviderModels('new-api', 'provider', [remoteFacts])
    const restoreLegacyProjection = db.prepare(
      `UPDATE provider_models
       SET model_json = ?
       WHERE provider_id = ? AND model_id = ? AND source = 'provider'`
    )
    restoreLegacyProjection.run(
      JSON.stringify(catalogProjection),
      'openai-codex',
      catalogProjection.id
    )
    restoreLegacyProjection.run(JSON.stringify(remoteFacts), 'new-api', remoteFacts.id)

    expect(table.migrateProviderModelsToRawFacts()).toEqual({ scanned: 2, updated: 2 })
    expect(table.listProviderModels('openai-codex', 'provider')[0]).not.toHaveProperty(
      'contextLength'
    )
    expect(table.listProviderModels('openai-codex', 'provider')[0]).not.toHaveProperty('maxTokens')
    expect(table.listProviderModels('new-api', 'provider')[0]).toMatchObject({
      contextLength: 123_456,
      maxTokens: 12_345
    })
    expect(table.listProviderModels('new-api', 'provider')[0]).not.toHaveProperty(
      'selectableEndpointTypes'
    )
    expect(table.migrateProviderModelsToRawFacts()).toEqual({ scanned: 2, updated: 0 })

    db.close()
  })
})
