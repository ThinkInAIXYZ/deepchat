import Database from 'better-sqlite3-multiple-ciphers'
import { nanoid } from 'nanoid'
import type { SettingsActivityInput, SettingsActivityRecord } from '@shared/contracts/routes'
import { BaseTable } from './baseTable'

const SETTINGS_ACTIVITY_RETENTION_LIMIT = 2000
const SETTINGS_ACTIVITY_LIST_LIMIT = 200

type SettingsActivityRow = {
  id: string
  category: SettingsActivityRecord['category']
  action: SettingsActivityRecord['action']
  target_type: string
  target_id: string | null
  target_label: string
  route_name: string | null
  route_params_json: string
  summary_key: string
  summary_params_json: string
  created_at: number
}

export class SettingsActivityTable extends BaseTable {
  constructor(db: Database.Database) {
    super(db, 'settings_activity')
  }

  getCreateTableSQL(): string {
    return `
      CREATE TABLE IF NOT EXISTS settings_activity (
        id TEXT PRIMARY KEY,
        category TEXT NOT NULL,
        action TEXT NOT NULL,
        target_type TEXT NOT NULL,
        target_id TEXT,
        target_label TEXT NOT NULL DEFAULT '',
        route_name TEXT,
        route_params_json TEXT NOT NULL DEFAULT '{}',
        summary_key TEXT NOT NULL,
        summary_params_json TEXT NOT NULL DEFAULT '{}',
        created_at INTEGER NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_settings_activity_created_at
        ON settings_activity(created_at DESC, id DESC);
    `
  }

  getLatestVersion(): number {
    return 0
  }

  getMigrationSQL(): string | null {
    return null
  }

  record(input: SettingsActivityInput): SettingsActivityRecord {
    const record: SettingsActivityRecord = {
      id: nanoid(),
      category: input.category,
      action: input.action,
      targetType: input.targetType,
      targetId: input.targetId ?? null,
      targetLabel: input.targetLabel ?? '',
      routeName: input.routeName ?? null,
      routeParams: input.routeParams ?? {},
      summaryKey: input.summaryKey,
      summaryParams: input.summaryParams ?? {},
      createdAt: Date.now()
    }

    this.db
      .prepare(
        `
        INSERT INTO settings_activity (
          id,
          category,
          action,
          target_type,
          target_id,
          target_label,
          route_name,
          route_params_json,
          summary_key,
          summary_params_json,
          created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `
      )
      .run(
        record.id,
        record.category,
        record.action,
        record.targetType,
        record.targetId,
        record.targetLabel,
        record.routeName,
        JSON.stringify(record.routeParams),
        record.summaryKey,
        JSON.stringify(record.summaryParams),
        record.createdAt
      )

    this.prune()
    return record
  }

  list(limit = SETTINGS_ACTIVITY_LIST_LIMIT): SettingsActivityRecord[] {
    const safeLimit = Math.min(Math.max(Math.trunc(limit), 1), SETTINGS_ACTIVITY_LIST_LIMIT)
    const rows = this.db
      .prepare(
        `
        SELECT *
        FROM settings_activity
        ORDER BY created_at DESC, id DESC
        LIMIT ?
      `
      )
      .all(safeLimit) as SettingsActivityRow[]

    return rows.map((row) => this.toRecord(row))
  }

  private prune(): void {
    this.db
      .prepare(
        `
        DELETE FROM settings_activity
        WHERE id NOT IN (
          SELECT id
          FROM settings_activity
          ORDER BY created_at DESC, id DESC
          LIMIT ?
        )
      `
      )
      .run(SETTINGS_ACTIVITY_RETENTION_LIMIT)
  }

  private toRecord(row: SettingsActivityRow): SettingsActivityRecord {
    return {
      id: row.id,
      category: row.category,
      action: row.action,
      targetType: row.target_type,
      targetId: row.target_id,
      targetLabel: row.target_label,
      routeName: row.route_name,
      routeParams: parseStringRecord(row.route_params_json),
      summaryKey: row.summary_key,
      summaryParams: parseJsonObject(row.summary_params_json),
      createdAt: row.created_at
    }
  }
}

function parseStringRecord(value: string): Record<string, string> {
  try {
    const parsed = JSON.parse(value)
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return {}
    }

    return Object.entries(parsed).reduce<Record<string, string>>((acc, [key, item]) => {
      if (typeof item === 'string') {
        acc[key] = item
      }
      return acc
    }, {})
  } catch {
    return {}
  }
}

function parseJsonObject(value: string): Record<string, string | number | boolean> {
  try {
    const parsed = JSON.parse(value)
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {}
  } catch {
    return {}
  }
}
