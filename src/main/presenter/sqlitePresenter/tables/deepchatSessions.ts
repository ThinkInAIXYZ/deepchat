import Database from 'better-sqlite3-multiple-ciphers'
import { BaseTable } from './baseTable'

export interface DeepChatSessionRow {
  id: string
  provider_id: string
  model_id: string
}

export class DeepChatSessionsTable extends BaseTable {
  constructor(db: Database.Database) {
    super(db, 'deepchat_sessions')
  }

  getCreateTableSQL(): string {
    return `
      CREATE TABLE IF NOT EXISTS deepchat_sessions (
        id TEXT PRIMARY KEY,
        provider_id TEXT NOT NULL,
        model_id TEXT NOT NULL
      );
    `
  }

  getMigrationSQL(_version: number): string | null {
    return null
  }

  getLatestVersion(): number {
    return 0
  }

  create(id: string, providerId: string, modelId: string): void {
    this.db
      .prepare(
        `INSERT INTO deepchat_sessions (id, provider_id, model_id)
         VALUES (?, ?, ?)`
      )
      .run(id, providerId, modelId)
  }

  get(id: string): DeepChatSessionRow | undefined {
    return this.db.prepare('SELECT * FROM deepchat_sessions WHERE id = ?').get(id) as
      | DeepChatSessionRow
      | undefined
  }

  delete(id: string): void {
    this.db.prepare('DELETE FROM deepchat_sessions WHERE id = ?').run(id)
  }
}
