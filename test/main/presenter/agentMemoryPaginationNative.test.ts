import { expect, it } from 'vitest'
import { Database, nativeSqliteDescribeIf } from '../nativeSqliteHarness'

const tableModule = Database
  ? await import('@/presenter/sqlitePresenter/tables/agentMemory').catch(() => null)
  : null

const AgentMemoryTable = tableModule?.AgentMemoryTable
const DatabaseCtor = Database!
const AgentMemoryTableCtor = AgentMemoryTable!
const describeIfSqlite = nativeSqliteDescribeIf(
  Boolean(AgentMemoryTable),
  'AgentMemoryTable is unavailable'
)

describeIfSqlite('AgentMemoryTable management pagination', () => {
  it('uses the management-page index and stable created-at/id keyset ordering', () => {
    const db = new DatabaseCtor(':memory:')
    try {
      const table = new AgentMemoryTableCtor(db)
      table.createTable()
      const queryPlan = db
        .prepare(
          `EXPLAIN QUERY PLAN
           SELECT *
           FROM agent_memory
           WHERE agent_id = ?
             AND superseded_by IS NULL
             AND status != 'conflicted'
             AND kind NOT IN ('persona', 'working')
             AND (created_at < ? OR (created_at = ? AND id < ?))
           ORDER BY created_at DESC, id DESC
           LIMIT ?`
        )
        .all('a', 1000, 1000, 'y', 100) as Array<{ detail: string }>
      expect(queryPlan.map((row) => row.detail).join('\n')).toContain(
        'idx_agent_memory_management_page_v2'
      )
      expect(queryPlan.some((row) => row.detail.includes('TEMP B-TREE FOR ORDER BY'))).toBe(false)

      for (const id of ['x', 'y', 'z']) {
        table.insert({
          id,
          agentId: 'a',
          kind: 'semantic',
          content: id,
          status: id === 'x' ? 'archived' : 'embedded',
          createdAt: 1000
        })
      }
      table.insert({
        id: 'older',
        agentId: 'a',
        kind: 'episodic',
        content: 'older',
        status: 'embedded',
        createdAt: 900
      })

      expect(table.listManagementPage('a', null, 2).map((row) => row.id)).toEqual(['z', 'y'])
      expect(
        table.listManagementPage('a', { createdAt: 1000, id: 'y' }, 10).map((row) => row.id)
      ).toEqual(['x', 'older'])
    } finally {
      db.close()
    }
  })

  it('caps direct repository reads at one bounded page plus the lookahead row', () => {
    const db = new DatabaseCtor(':memory:')
    try {
      const table = new AgentMemoryTableCtor(db)
      table.createTable()
      const insert = db.prepare(
        `INSERT INTO agent_memory (id, agent_id, kind, content, status, created_at)
         VALUES (?, 'a', 'semantic', 'memory', 'embedded', ?)`
      )
      db.transaction(() => {
        for (let index = 0; index < 150; index += 1) {
          insert.run(`memory-${index}`, index)
        }
      })()

      expect(table.listManagementPage('a', null, 10_000)).toHaveLength(101)
    } finally {
      db.close()
    }
  })
})
