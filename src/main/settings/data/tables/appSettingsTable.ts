import Database from 'better-sqlite3-multiple-ciphers'
import { BaseTable } from '@/data/baseTable'

type AppSettingRow = {
  key: string
  value_json: string
}

const CONFIG_STORAGE_MIGRATION_ID = 'config-presenter-sqlite-v1'

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

export class AppSettingsTable extends BaseTable {
  constructor(db: Database.Database) {
    super(db, 'app_settings')
  }

  override createTable(): void {
    this.db.exec(this.getCreateTableSQL())
  }

  getCreateTableSQL(): string {
    return `
      CREATE TABLE IF NOT EXISTS app_settings (
        key TEXT PRIMARY KEY,
        value_json TEXT NOT NULL,
        sensitive INTEGER NOT NULL DEFAULT 0,
        updated_at INTEGER NOT NULL
      );

      CREATE TABLE IF NOT EXISTS config_migrations (
        id TEXT PRIMARY KEY,
        applied_at INTEGER NOT NULL
      );
    `
  }

  getMigrationSQL(version: number): string | null {
    if (version === 25) return this.getCreateTableSQL()
    if (version === 26) {
      return `
        CREATE TABLE IF NOT EXISTS app_settings (
          key TEXT PRIMARY KEY,
          value_json TEXT NOT NULL,
          sensitive INTEGER NOT NULL DEFAULT 0,
          updated_at INTEGER NOT NULL
        );
      `
    }
    return null
  }

  getLatestVersion(): number {
    return 26
  }

  hasConfigMigration(id = CONFIG_STORAGE_MIGRATION_ID): boolean {
    return Boolean(this.db.prepare('SELECT 1 FROM config_migrations WHERE id = ?').get(id))
  }

  markConfigMigrationApplied(id = CONFIG_STORAGE_MIGRATION_ID): void {
    this.db
      .prepare(
        `INSERT INTO config_migrations (id, applied_at)
         VALUES (?, ?)
         ON CONFLICT(id) DO UPDATE SET applied_at = excluded.applied_at`
      )
      .run(id, now())
  }

  getAppSetting<TValue = unknown>(key: string): TValue | undefined {
    const row = this.db.prepare('SELECT value_json FROM app_settings WHERE key = ?').get(key) as
      | AppSettingRow
      | undefined
    return row ? parseJson<TValue | undefined>(row.value_json, undefined) : undefined
  }

  setAppSetting(key: string, value: unknown, sensitive = true): void {
    this.db
      .prepare(
        `INSERT INTO app_settings (key, value_json, sensitive, updated_at)
         VALUES (?, ?, ?, ?)
         ON CONFLICT(key) DO UPDATE SET
           value_json = excluded.value_json,
           sensitive = excluded.sensitive,
           updated_at = excluded.updated_at`
      )
      .run(key, stringifyJson(value), sensitive ? 1 : 0, now())
  }

  deleteAppSetting(key: string): void {
    this.db.prepare('DELETE FROM app_settings WHERE key = ?').run(key)
  }

  hasAppSetting(key: string): boolean {
    return Boolean(this.db.prepare('SELECT 1 FROM app_settings WHERE key = ?').get(key))
  }

  listAppSettings(): Record<string, unknown> {
    const rows = this.db
      .prepare('SELECT key, value_json FROM app_settings')
      .all() as AppSettingRow[]
    return Object.fromEntries(rows.map((row) => [row.key, parseJson(row.value_json, null)]))
  }
}

export { CONFIG_STORAGE_MIGRATION_ID }
