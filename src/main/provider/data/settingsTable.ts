import Database from 'better-sqlite3-multiple-ciphers'
import { BaseTable } from '@/data/baseTable'
import type { IModelConfig, LLM_PROVIDER, MODEL_META } from '@shared/types/provider'
import { getValidProviderCustomHeaders } from '@shared/providerCustomHeaders'
import { LEGACY_MODEL_CONFIG_META_KEY, normalizeUserModelConfigEntry } from '../userModelConfig'
import {
  hasPersistedDerivedProviderModelFields,
  stripDerivedProviderModelFields
} from '../providerModelFacts'

type ProviderRow = {
  id: string
  name: string
  api_type: string
  api_key: string
  base_url: string
  enabled: number
  custom: number
  capability_provider_id: string | null
  sort_order: number
  last_used_at: number | null
  provider_json: string
  created_at: number
  updated_at: number
}

type ProviderModelRow = {
  provider_id: string
  model_id: string
  source: 'provider' | 'custom'
  name: string
  group_name: string
  sort_order: number
  model_json: string
  created_at: number
  updated_at: number
}

type ModelConfigRow = {
  cache_key: string
  provider_id: string
  model_id: string
  source: string | null
  config_json: string
  created_at: number
  updated_at: number
}

const parseJson = <T>(raw: string | null | undefined, fallback: T): T => {
  if (!raw) return fallback

  try {
    return JSON.parse(raw) as T
  } catch {
    return fallback
  }
}

const stringifyJson = (value: unknown): string => JSON.stringify(value ?? null)
const now = (): number => Date.now()

export class ProviderSettingsTable extends BaseTable {
  constructor(db: Database.Database) {
    super(db, 'providers')
  }

  override createTable(): void {
    this.db.exec(this.getCreateTableSQL())
  }

  getCreateTableSQL(): string {
    return `
      CREATE TABLE IF NOT EXISTS providers (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        api_type TEXT NOT NULL,
        api_key TEXT NOT NULL DEFAULT '',
        base_url TEXT NOT NULL DEFAULT '',
        enabled INTEGER NOT NULL DEFAULT 0,
        custom INTEGER NOT NULL DEFAULT 0,
        capability_provider_id TEXT,
        sort_order INTEGER NOT NULL DEFAULT 0,
        last_used_at INTEGER,
        provider_json TEXT NOT NULL DEFAULT '{}',
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_providers_sort_order ON providers(sort_order);

      CREATE TABLE IF NOT EXISTS provider_models (
        provider_id TEXT NOT NULL,
        model_id TEXT NOT NULL,
        source TEXT NOT NULL,
        name TEXT NOT NULL,
        group_name TEXT NOT NULL DEFAULT 'default',
        sort_order INTEGER NOT NULL DEFAULT 0,
        model_json TEXT NOT NULL DEFAULT '{}',
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        PRIMARY KEY (provider_id, model_id, source)
      );
      CREATE INDEX IF NOT EXISTS idx_provider_models_provider ON provider_models(provider_id);

      CREATE TABLE IF NOT EXISTS model_status (
        status_key TEXT PRIMARY KEY,
        provider_id TEXT NOT NULL,
        model_id TEXT NOT NULL,
        enabled INTEGER NOT NULL DEFAULT 0,
        updated_at INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_model_status_provider ON model_status(provider_id);

      CREATE TABLE IF NOT EXISTS model_configs (
        cache_key TEXT PRIMARY KEY,
        provider_id TEXT NOT NULL DEFAULT '',
        model_id TEXT NOT NULL DEFAULT '',
        source TEXT,
        config_json TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_model_configs_provider ON model_configs(provider_id);
    `
  }

  getMigrationSQL(version: number): string | null {
    return version === 25 ? this.getCreateTableSQL() : null
  }

  getLatestVersion(): number {
    return 25
  }

  listProviders(): LLM_PROVIDER[] {
    const rows = this.db
      .prepare('SELECT * FROM providers ORDER BY sort_order ASC, created_at ASC')
      .all() as ProviderRow[]
    return rows.map((row) => this.toProvider(row))
  }

  replaceProviders(
    providers: LLM_PROVIDER[],
    order: string[] = [],
    timestamps: Record<string, number> = {}
  ): void {
    this.db.transaction(() => {
      this.db.exec('DELETE FROM providers')
      providers.forEach((provider, index) => {
        this.upsertProvider(provider, {
          sortOrder: this.resolveProviderSortOrder(provider.id, index, order),
          lastUsedAt: timestamps[provider.id] ?? null
        })
      })
    })()
  }

  upsertProvider(
    provider: LLM_PROVIDER,
    options: { sortOrder?: number; lastUsedAt?: number | null } = {}
  ): void {
    const timestamp = now()
    const existing = this.getProvider(provider.id)
    const sortOrder = options.sortOrder ?? existing?.sort_order ?? this.getNextProviderSortOrder()
    const lastUsedAt = options.lastUsedAt ?? existing?.last_used_at ?? null
    const providerJson = this.serializeProvider(provider)

    this.db
      .prepare(
        `INSERT INTO providers (
          id, name, api_type, api_key, base_url, enabled, custom, capability_provider_id,
          sort_order, last_used_at, provider_json, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET
          name = excluded.name,
          api_type = excluded.api_type,
          api_key = excluded.api_key,
          base_url = excluded.base_url,
          enabled = excluded.enabled,
          custom = excluded.custom,
          capability_provider_id = excluded.capability_provider_id,
          sort_order = excluded.sort_order,
          last_used_at = excluded.last_used_at,
          provider_json = excluded.provider_json,
          updated_at = excluded.updated_at`
      )
      .run(
        provider.id,
        provider.name,
        provider.apiType,
        provider.apiKey ?? '',
        provider.baseUrl ?? '',
        provider.enable ? 1 : 0,
        provider.custom ? 1 : 0,
        provider.capabilityProviderId ?? null,
        sortOrder,
        lastUsedAt,
        providerJson,
        existing?.created_at ?? timestamp,
        timestamp
      )
  }

  deleteProvider(providerId: string): void {
    this.db.transaction(() => {
      this.db.prepare('DELETE FROM providers WHERE id = ?').run(providerId)
      this.db.prepare('DELETE FROM provider_models WHERE provider_id = ?').run(providerId)
      this.db.prepare('DELETE FROM model_status WHERE provider_id = ?').run(providerId)
      this.db.prepare('DELETE FROM model_configs WHERE provider_id = ?').run(providerId)
    })()
  }

  getProviderOrder(): string[] {
    return this.listProviders().map((provider) => provider.id)
  }

  setProviderOrder(order: string[]): void {
    const uniqueOrder = Array.from(new Set(order.filter(Boolean)))
    this.db.transaction(() => {
      uniqueOrder.forEach((providerId, index) => {
        this.db
          .prepare('UPDATE providers SET sort_order = ?, updated_at = ? WHERE id = ?')
          .run(index, now(), providerId)
      })
    })()
  }

  getProviderTimestamps(): Record<string, number> {
    const rows = this.db
      .prepare('SELECT id, last_used_at FROM providers WHERE last_used_at IS NOT NULL')
      .all() as Array<{ id: string; last_used_at: number }>
    return Object.fromEntries(rows.map((row) => [row.id, row.last_used_at]))
  }

  setProviderTimestamps(timestamps: Record<string, number>): void {
    this.db.transaction(() => {
      for (const [providerId, timestamp] of Object.entries(timestamps)) {
        this.db
          .prepare('UPDATE providers SET last_used_at = ?, updated_at = ? WHERE id = ?')
          .run(timestamp, now(), providerId)
      }
    })()
  }

  listProviderModels(providerId: string, source: 'provider' | 'custom'): MODEL_META[] {
    const rows = this.db
      .prepare(
        `SELECT * FROM provider_models
         WHERE provider_id = ? AND source = ?
         ORDER BY sort_order ASC, created_at ASC`
      )
      .all(providerId, source) as ProviderModelRow[]
    return rows.map((row) => this.toProviderModel(row))
  }

  getProviderModel(
    providerId: string,
    modelId: string,
    source: 'provider' | 'custom'
  ): MODEL_META | undefined {
    const row = this.db
      .prepare(
        `SELECT * FROM provider_models
         WHERE provider_id = ? AND model_id = ? AND source = ?`
      )
      .get(providerId, modelId, source) as ProviderModelRow | undefined
    return row ? this.toProviderModel(row) : undefined
  }

  replaceProviderModels(
    providerId: string,
    source: 'provider' | 'custom',
    models: MODEL_META[]
  ): void {
    this.db.transaction(() => {
      this.db
        .prepare('DELETE FROM provider_models WHERE provider_id = ? AND source = ?')
        .run(providerId, source)
      models.forEach((model, index) => {
        const storedModel =
          source === 'provider' ? stripDerivedProviderModelFields(model, providerId) : model
        this.upsertProviderModel(providerId, source, storedModel, index)
      })
    })()
  }

  clearProviderModels(providerId: string): void {
    this.db.prepare('DELETE FROM provider_models WHERE provider_id = ?').run(providerId)
  }

  clearAllProviderModels(): void {
    this.db.exec('DELETE FROM provider_models')
  }

  getModelStatus(statusKey: string): boolean | undefined {
    const row = this.db
      .prepare('SELECT enabled FROM model_status WHERE status_key = ?')
      .get(statusKey) as { enabled: number } | undefined
    return row ? row.enabled === 1 : undefined
  }

  hasModelStatus(statusKey: string): boolean {
    return Boolean(
      this.db.prepare('SELECT 1 FROM model_status WHERE status_key = ?').get(statusKey)
    )
  }

  listModelStatusEntries(): Record<string, boolean> {
    const rows = this.db.prepare('SELECT status_key, enabled FROM model_status').all() as Array<{
      status_key: string
      enabled: number
    }>
    return Object.fromEntries(rows.map((row) => [row.status_key, row.enabled === 1]))
  }

  setModelStatus(statusKey: string, providerId: string, modelId: string, enabled: boolean): void {
    this.db
      .prepare(
        `INSERT INTO model_status (status_key, provider_id, model_id, enabled, updated_at)
         VALUES (?, ?, ?, ?, ?)
         ON CONFLICT(status_key) DO UPDATE SET
           provider_id = excluded.provider_id,
           model_id = excluded.model_id,
           enabled = excluded.enabled,
           updated_at = excluded.updated_at`
      )
      .run(statusKey, providerId, modelId, enabled ? 1 : 0, now())
  }

  deleteModelStatus(statusKey: string): void {
    this.db.prepare('DELETE FROM model_status WHERE status_key = ?').run(statusKey)
  }

  deleteProviderModelStatuses(providerId: string): void {
    this.db.prepare('DELETE FROM model_status WHERE provider_id = ?').run(providerId)
  }

  clearModelStatuses(): void {
    this.db.exec('DELETE FROM model_status')
  }

  listModelConfigStore(): Record<string, IModelConfig | Record<string, unknown>> {
    const rows = this.db.prepare('SELECT * FROM model_configs').all() as ModelConfigRow[]
    return Object.fromEntries(rows.map((row) => [row.cache_key, parseJson(row.config_json, {})]))
  }

  getModelConfigStoreEntry<TValue = unknown>(cacheKey: string): TValue | undefined {
    const row = this.db
      .prepare('SELECT config_json FROM model_configs WHERE cache_key = ?')
      .get(cacheKey) as { config_json: string } | undefined
    return row ? parseJson<TValue | undefined>(row.config_json, undefined) : undefined
  }

  hasModelConfigStoreEntry(cacheKey: string): boolean {
    return Boolean(this.db.prepare('SELECT 1 FROM model_configs WHERE cache_key = ?').get(cacheKey))
  }

  setModelConfigStoreEntry(cacheKey: string, value: unknown): boolean {
    const normalizedEntry = normalizeUserModelConfigEntry(value)
    if (!normalizedEntry) {
      return false
    }

    const timestamp = now()
    const existing = this.db
      .prepare('SELECT created_at FROM model_configs WHERE cache_key = ?')
      .get(cacheKey) as { created_at: number } | undefined

    this.db
      .prepare(
        `INSERT INTO model_configs (
          cache_key, provider_id, model_id, source, config_json, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(cache_key) DO UPDATE SET
          provider_id = excluded.provider_id,
          model_id = excluded.model_id,
          source = excluded.source,
          config_json = excluded.config_json,
          updated_at = excluded.updated_at`
      )
      .run(
        cacheKey,
        normalizedEntry.providerId,
        normalizedEntry.id,
        normalizedEntry.source,
        stringifyJson(normalizedEntry),
        existing?.created_at ?? timestamp,
        timestamp
      )
    return true
  }

  migrateProviderModelsToRawFacts(): { scanned: number; updated: number } {
    const rows = this.db
      .prepare("SELECT * FROM provider_models WHERE source = 'provider'")
      .all() as ProviderModelRow[]
    const update = this.db.prepare(
      `UPDATE provider_models
       SET model_json = ?, updated_at = ?
       WHERE provider_id = ? AND model_id = ? AND source = 'provider'`
    )
    let updated = 0

    this.db.transaction(() => {
      for (const row of rows) {
        const stored = parseJson<Partial<MODEL_META>>(row.model_json, {})
        const needsUpdate =
          stored.providerId !== row.provider_id ||
          hasPersistedDerivedProviderModelFields(stored, row.provider_id)
        if (!needsUpdate) {
          continue
        }

        const providerFacts = stripDerivedProviderModelFields(
          this.toProviderModel(row),
          row.provider_id
        )
        update.run(stringifyJson(providerFacts), now(), row.provider_id, row.model_id)
        updated += 1
      }
    })()

    return { scanned: rows.length, updated }
  }

  migrateModelConfigsToUserOnly(): { removed: number; preserved: number } {
    const rows = this.db.prepare('SELECT * FROM model_configs').all() as ModelConfigRow[]
    const parsedRows = rows.map((row) => ({
      row,
      value: parseJson<Record<string, unknown>>(row.config_json, {})
    }))
    const snapshot = Object.fromEntries(parsedRows.map(({ row, value }) => [row.cache_key, value]))
    const legacyMeta = snapshot[LEGACY_MODEL_CONFIG_META_KEY] as
      | { userConfigKeys?: unknown }
      | undefined
    const legacyUserKeys = new Set(
      Array.isArray(legacyMeta?.userConfigKeys)
        ? legacyMeta.userConfigKeys.filter(
            (key): key is string => typeof key === 'string' && key.length > 0
          )
        : []
    )
    const update = this.db.prepare(
      `UPDATE model_configs
       SET provider_id = ?, model_id = ?, source = ?, config_json = ?, updated_at = ?
       WHERE cache_key = ?`
    )
    const remove = this.db.prepare('DELETE FROM model_configs WHERE cache_key = ?')
    let preserved = 0

    this.db.transaction(() => {
      for (const { row, value } of parsedRows) {
        const cacheKey = row.cache_key
        const entry =
          cacheKey === LEGACY_MODEL_CONFIG_META_KEY
            ? undefined
            : normalizeUserModelConfigEntry(value, {
                legacyUserKey: legacyUserKeys.has(cacheKey)
              })
        if (!entry) {
          remove.run(cacheKey)
          continue
        }

        const configJson = stringifyJson(entry)
        const needsUpdate =
          row.provider_id !== entry.providerId ||
          row.model_id !== entry.id ||
          row.source !== entry.source ||
          row.config_json !== configJson
        if (needsUpdate) {
          update.run(entry.providerId, entry.id, entry.source, configJson, now(), cacheKey)
        }
        preserved += 1
      }
    })()

    return {
      removed: rows.length - preserved,
      preserved
    }
  }

  deleteModelConfigStoreEntry(cacheKey: string): void {
    this.db.prepare('DELETE FROM model_configs WHERE cache_key = ?').run(cacheKey)
  }

  clearModelConfigStore(): void {
    this.db.exec('DELETE FROM model_configs')
  }

  private getProvider(providerId: string): ProviderRow | undefined {
    return this.db.prepare('SELECT * FROM providers WHERE id = ?').get(providerId) as
      | ProviderRow
      | undefined
  }

  private getNextProviderSortOrder(): number {
    const row = this.db.prepare('SELECT MAX(sort_order) AS max_order FROM providers').get() as
      | { max_order: number | null }
      | undefined
    return typeof row?.max_order === 'number' ? row.max_order + 1 : 0
  }

  private resolveProviderSortOrder(providerId: string, fallback: number, order: string[]): number {
    const index = order.indexOf(providerId)
    return index === -1 ? fallback : index
  }

  private serializeProvider(provider: LLM_PROVIDER): string {
    const {
      models: _models,
      customModels: _customModels,
      enabledModels: _enabledModels,
      disabledModels: _disabledModels,
      ...stored
    } = provider
    return stringifyJson(stored)
  }

  private toProvider(row: ProviderRow): LLM_PROVIDER {
    const stored = parseJson<Partial<LLM_PROVIDER>>(row.provider_json, {})
    const customHeaders = getValidProviderCustomHeaders(stored.customHeaders)
    if ('customHeaders' in stored && !customHeaders) {
      delete stored.customHeaders
    }
    return {
      ...stored,
      ...(customHeaders ? { customHeaders } : {}),
      id: row.id,
      name: row.name,
      apiType: row.api_type,
      apiKey: row.api_key,
      baseUrl: row.base_url,
      enable: row.enabled === 1,
      custom: row.custom === 1 ? true : stored.custom,
      capabilityProviderId: row.capability_provider_id ?? stored.capabilityProviderId
    } as LLM_PROVIDER
  }

  private upsertProviderModel(
    providerId: string,
    source: 'provider' | 'custom',
    model: MODEL_META,
    sortOrder: number
  ): void {
    const timestamp = now()
    const existing = this.db
      .prepare(
        `SELECT created_at FROM provider_models
         WHERE provider_id = ? AND model_id = ? AND source = ?`
      )
      .get(providerId, model.id, source) as { created_at: number } | undefined
    const normalizedModel: MODEL_META = {
      ...model,
      providerId,
      isCustom: source === 'custom' ? true : model.isCustom
    }

    this.db
      .prepare(
        `INSERT INTO provider_models (
          provider_id, model_id, source, name, group_name, sort_order, model_json, created_at,
          updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(provider_id, model_id, source) DO UPDATE SET
          name = excluded.name,
          group_name = excluded.group_name,
          sort_order = excluded.sort_order,
          model_json = excluded.model_json,
          updated_at = excluded.updated_at`
      )
      .run(
        providerId,
        normalizedModel.id,
        source,
        normalizedModel.name,
        normalizedModel.group || 'default',
        sortOrder,
        stringifyJson(normalizedModel),
        existing?.created_at ?? timestamp,
        timestamp
      )
  }

  private toProviderModel(row: ProviderModelRow): MODEL_META {
    const stored = parseJson<Partial<MODEL_META>>(row.model_json, {})
    return {
      ...stored,
      id: row.model_id,
      name: row.name,
      providerId: row.provider_id,
      group: row.group_name,
      isCustom: row.source === 'custom' ? true : stored.isCustom
    } as MODEL_META
  }
}
