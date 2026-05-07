import Database from 'better-sqlite3-multiple-ciphers'
import { BaseTable } from './baseTable'

export interface NewSessionDisabledAgentToolRow {
  session_id: string
  ordinal: number
  tool_name: string
}

const NORMALIZATION_SCHEMA_VERSION = 26

export class NewSessionDisabledAgentToolsTable extends BaseTable {
  constructor(db: Database.Database) {
    super(db, 'new_session_disabled_agent_tools')
  }

  getCreateTableSQL(): string {
    return `
      CREATE TABLE IF NOT EXISTS new_session_disabled_agent_tools (
        session_id TEXT NOT NULL,
        ordinal INTEGER NOT NULL,
        tool_name TEXT NOT NULL,
        PRIMARY KEY (session_id, ordinal)
      );
      CREATE INDEX IF NOT EXISTS idx_new_session_disabled_agent_tools_session
        ON new_session_disabled_agent_tools(session_id, ordinal);
    `
  }

  getMigrationSQL(version: number): string | null {
    if (version === NORMALIZATION_SCHEMA_VERSION) {
      return this.getCreateTableSQL()
    }
    return null
  }

  getLatestVersion(): number {
    return NORMALIZATION_SCHEMA_VERSION
  }

  replaceForSession(sessionId: string, toolNames: string[]): void {
    const insert = this.db.prepare(
      `INSERT INTO new_session_disabled_agent_tools (
        session_id,
        ordinal,
        tool_name
      ) VALUES (?, ?, ?)`
    )

    this.db.transaction(() => {
      this.deleteBySession(sessionId)
      toolNames.forEach((toolName, index) => {
        insert.run(sessionId, index, toolName)
      })
    })()
  }

  listBySession(sessionId: string): NewSessionDisabledAgentToolRow[] {
    return this.db
      .prepare(
        `SELECT * FROM new_session_disabled_agent_tools
         WHERE session_id = ?
         ORDER BY ordinal`
      )
      .all(sessionId) as NewSessionDisabledAgentToolRow[]
  }

  deleteBySession(sessionId: string): void {
    this.db
      .prepare('DELETE FROM new_session_disabled_agent_tools WHERE session_id = ?')
      .run(sessionId)
  }
}
