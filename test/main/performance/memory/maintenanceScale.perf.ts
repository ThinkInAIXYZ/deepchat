import { expect } from 'vitest'

import { AgentMemoryTable } from '@/presenter/sqlitePresenter/tables/agentMemory'

import { describeIfNativeSqlite, requireDatabase } from '../../nativeSqliteHarness'

describeIfNativeSqlite('Agent Memory #28 maintenance scale', () => {
  it('uses bounded indexes and one sibling transition statement at 50k/1k scale', () => {
    const DatabaseCtor = requireDatabase()
    const statements: string[] = []
    const db = new DatabaseCtor(':memory:', {
      verbose: (statement: string) => statements.push(statement)
    })
    try {
      const table = new AgentMemoryTable(db)
      table.createTable()
      const insert = db.prepare(
        `INSERT INTO agent_memory (
           id, agent_id, kind, content, importance, status, created_at,
           conflict_state, conflict_with
         ) VALUES (?, 'maintenance', 'semantic', ?, ?, ?, ?, ?, ?)`
      )
      db.transaction(() => {
        for (let index = 0; index < 50_000; index += 1) {
          insert.run(
            `row-${index}`,
            'bounded row',
            (index % 10) / 10,
            'embedded',
            index,
            null,
            null
          )
        }
        insert.run('target', 'target', 1, 'embedded', 50_001, 'challenged', null)
        insert.run('winner', 'winner', 1, 'conflicted', 50_002, null, 'target')
        for (let index = 0; index < 1_000; index += 1) {
          insert.run(`sibling-${index}`, 'sibling', 1, 'conflicted', 50_003 + index, null, 'target')
        }
      })()
      db.exec('ANALYZE')

      const plan = db
        .prepare(
          `EXPLAIN QUERY PLAN
           SELECT *
           FROM agent_memory INDEXED BY idx_agent_memory_cognitive_top_v2
           WHERE agent_id = 'maintenance'
             AND superseded_by IS NULL
             AND status NOT IN ('archived', 'conflicted')
             AND kind IN ('episodic', 'semantic', 'reflection')
             AND kind IN ('episodic', 'semantic')
           ORDER BY importance DESC, created_at DESC, id DESC
           LIMIT 20`
        )
        .all() as Array<{ detail: string }>
      expect(plan.some((row) => row.detail.includes('idx_agent_memory_cognitive_top_v2'))).toBe(
        true
      )
      expect(plan.some((row) => row.detail.includes('TEMP B-TREE FOR ORDER BY'))).toBe(false)

      statements.length = 0
      expect(
        table.retireConflictSiblings('maintenance', 'target', 'winner', 'winner', Date.now())
      ).toBe(1_000)
      expect(statements).toHaveLength(1)
    } finally {
      db.close()
    }
  }, 30_000)
})
