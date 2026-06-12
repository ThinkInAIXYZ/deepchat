import { describe, expect, it } from 'vitest'
import { AcpSessionsTable } from '../../../../src/main/presenter/sqlitePresenter/tables/acpSessions'

const sqliteModule = await import('better-sqlite3-multiple-ciphers').catch(() => null)
const Database = sqliteModule?.default
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
const describeIfSqlite = sqliteAvailable && Database ? describe : describe.skip
const DatabaseCtor = Database!

describe('AcpSessionsTable schema', () => {
  it('scopes remote ACP session ids by agent', () => {
    const table = new AcpSessionsTable({} as any)

    expect(table.getCreateTableSQL()).toContain('UNIQUE(agent_id, session_id)')
    expect(table.getCreateTableSQL()).not.toContain('session_id TEXT UNIQUE')
    expect(table.getLatestVersion()).toBe(30)
    expect(table.getMigrationSQL(30)).toContain('UNIQUE(agent_id, session_id)')
  })
})

describeIfSqlite('AcpSessionsTable storage', () => {
  it('allows the same remote ACP session id across different agents', async () => {
    const db = new DatabaseCtor(':memory:')
    try {
      const table = new AcpSessionsTable(db)
      table.createTable()

      await table.upsert('conv-a', 'agent-a', { sessionId: 'remote-1', status: 'idle' })
      await table.upsert('conv-b', 'agent-b', { sessionId: 'remote-1', status: 'idle' })

      await expect(
        table.upsert('conv-c', 'agent-a', { sessionId: 'remote-1', status: 'idle' })
      ).rejects.toThrow()

      expect(await table.getByAgentAndSessionId('agent-a', 'remote-1')).toMatchObject({
        conversationId: 'conv-a',
        agentId: 'agent-a',
        sessionId: 'remote-1'
      })
      expect(await table.getByAgentAndSessionId('agent-b', 'remote-1')).toMatchObject({
        conversationId: 'conv-b',
        agentId: 'agent-b',
        sessionId: 'remote-1'
      })
    } finally {
      db.close()
    }
  })

  it('keeps the latest duplicate row when migrating legacy ACP session links', async () => {
    const db = new DatabaseCtor(':memory:')
    try {
      const table = new AcpSessionsTable(db)
      db.exec(`
        CREATE TABLE acp_sessions (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          conversation_id TEXT NOT NULL,
          agent_id TEXT NOT NULL,
          session_id TEXT,
          workdir TEXT,
          status TEXT NOT NULL DEFAULT 'idle',
          created_at INTEGER NOT NULL,
          updated_at INTEGER NOT NULL,
          metadata TEXT,
          UNIQUE(conversation_id, agent_id)
        );
        INSERT INTO acp_sessions
          (conversation_id, agent_id, session_id, workdir, status, created_at, updated_at, metadata)
        VALUES
          ('conv-old', 'agent-a', 'remote-1', '/old', 'idle', 1, 10, NULL),
          ('conv-new', 'agent-a', 'remote-1', '/new', 'active', 1, 20, NULL),
          ('conv-b', 'agent-b', 'remote-1', '/other', 'idle', 1, 15, NULL);
      `)

      db.exec(table.getMigrationSQL(30) ?? '')

      expect(await table.getByAgentAndSessionId('agent-a', 'remote-1')).toMatchObject({
        conversationId: 'conv-new',
        agentId: 'agent-a',
        sessionId: 'remote-1',
        workdir: '/new',
        status: 'active'
      })
      expect(await table.getByAgentAndSessionId('agent-b', 'remote-1')).toMatchObject({
        conversationId: 'conv-b',
        agentId: 'agent-b',
        sessionId: 'remote-1',
        workdir: '/other'
      })
    } finally {
      db.close()
    }
  })
})
