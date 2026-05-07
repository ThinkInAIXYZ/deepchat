import Database from 'better-sqlite3-multiple-ciphers'
import { BaseTable } from './baseTable'

export interface NewSessionActiveSkillRow {
  session_id: string
  ordinal: number
  skill_name: string
}

const NORMALIZATION_SCHEMA_VERSION = 26

export class NewSessionActiveSkillsTable extends BaseTable {
  constructor(db: Database.Database) {
    super(db, 'new_session_active_skills')
  }

  getCreateTableSQL(): string {
    return `
      CREATE TABLE IF NOT EXISTS new_session_active_skills (
        session_id TEXT NOT NULL,
        ordinal INTEGER NOT NULL,
        skill_name TEXT NOT NULL,
        PRIMARY KEY (session_id, ordinal)
      );
      CREATE INDEX IF NOT EXISTS idx_new_session_active_skills_session
        ON new_session_active_skills(session_id, ordinal);
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

  replaceForSession(sessionId: string, skills: string[]): void {
    const insert = this.db.prepare(
      `INSERT INTO new_session_active_skills (
        session_id,
        ordinal,
        skill_name
      ) VALUES (?, ?, ?)`
    )

    this.db.transaction(() => {
      this.deleteBySession(sessionId)
      skills.forEach((skillName, index) => {
        insert.run(sessionId, index, skillName)
      })
    })()
  }

  listBySession(sessionId: string): NewSessionActiveSkillRow[] {
    return this.db
      .prepare(
        `SELECT * FROM new_session_active_skills
         WHERE session_id = ?
         ORDER BY ordinal`
      )
      .all(sessionId) as NewSessionActiveSkillRow[]
  }

  deleteBySession(sessionId: string): void {
    this.db.prepare('DELETE FROM new_session_active_skills WHERE session_id = ?').run(sessionId)
  }
}
