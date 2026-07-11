import { expect, it } from 'vitest'
import { Database, nativeSqliteDescribeIf } from '../nativeSqliteHarness'

const tableModule = Database
  ? await import('@/presenter/sqlitePresenter/tables/agentMemoryAudit').catch(() => null)
  : null

const AgentMemoryAuditTable = tableModule?.AgentMemoryAuditTable
const DatabaseCtor = Database!
const AgentMemoryAuditTableCtor = AgentMemoryAuditTable!
const describeIfSqlite = nativeSqliteDescribeIf(
  Boolean(AgentMemoryAuditTable),
  'AgentMemoryAuditTable is unavailable'
)

describeIfSqlite('AgentMemoryAuditTable operational retention', () => {
  it('retains the newest operational rows across event types and deletes at most the batch limit', () => {
    const db = new DatabaseCtor(':memory:')
    try {
      const table = new AgentMemoryAuditTableCtor(db)
      table.createTable()
      const queryPlan = db
        .prepare(
          `EXPLAIN QUERY PLAN
           SELECT id
           FROM agent_memory_audit
           WHERE agent_id = ?
             AND event_type IN (
               'memory/maintenance_llm',
               'memory/reflect',
               'memory/repair',
               'memory/conflict_repair',
               'memory/extract'
             )
           ORDER BY created_at DESC, id DESC
           LIMIT ? OFFSET ?`
        )
        .all('a', 500, 10_000) as Array<{ detail: string }>
      expect(queryPlan.map((row) => row.detail).join('\n')).toContain(
        'idx_agent_memory_audit_operational_retention_v2'
      )
      const eventTypes = [
        'memory/maintenance_llm',
        'memory/reflect',
        'memory/repair',
        'memory/conflict_repair',
        'memory/extract'
      ]
      for (let index = 0; index < 8; index += 1) {
        table.insert({
          id: `operational-${index}`,
          agentId: 'a',
          eventType: eventTypes[index % eventTypes.length],
          actorType: 'scheduler',
          status: 'completed',
          createdAt: index
        })
      }

      expect(table.pruneOperationalEvents('a', 3, 2)).toBe(2)
      expect(table.pruneOperationalEvents('a', 3, 500)).toBe(3)
      expect(
        table
          .listByAgent('a', { limit: 100 })
          .filter((row) => row.event_type.startsWith('memory/'))
          .map((row) => row.id)
      ).toEqual(['operational-7', 'operational-6', 'operational-5'])
    } finally {
      db.close()
    }
  })

  it('preserves causal, persona, unknown, malformed, and other-agent rows', () => {
    const db = new DatabaseCtor(':memory:')
    try {
      const table = new AgentMemoryAuditTableCtor(db)
      table.createTable()
      const preserved = [
        ['forget', 'memory/forget'],
        ['add', 'memory/add'],
        ['archive', 'memory/archive'],
        ['restore', 'memory/restore'],
        ['edit', 'memory/manual_edit'],
        ['challenge', 'memory/challenge_resolved'],
        ['persona', 'persona/evolve'],
        ['unknown', 'memory/future_event']
      ] as const
      for (const [id, eventType] of preserved) {
        table.insert({
          id,
          agentId: 'a',
          eventType,
          actorType: 'runtime',
          status: 'completed',
          inputRefs: eventType === 'memory/forget' ? { memoryId: 'm1' } : {},
          outputRefs: eventType === 'memory/forget' ? { memoryId: 'm1' } : {},
          createdAt: 100
        })
      }
      table.insert({
        id: 'malformed-causal',
        agentId: 'a',
        eventType: 'memory/forget',
        actorType: 'runtime',
        status: 'completed',
        createdAt: 50
      })
      db.prepare(
        `UPDATE agent_memory_audit
         SET memory_ref_id = NULL,
             input_refs_json = 'not-json',
             output_refs_json = 'also-not-json'
         WHERE id = 'malformed-causal'`
      ).run()
      db.prepare(
        "UPDATE agent_memory_audit SET input_refs_json = 'not-json' WHERE id = 'unknown'"
      ).run()
      table.insert({
        id: 'other-agent-operational',
        agentId: 'b',
        eventType: 'memory/extract',
        actorType: 'runtime',
        status: 'completed',
        createdAt: 1
      })

      const beforeForget = table.hasForgetEvent('a', 'm1')
      expect(table.pruneOperationalEvents('a', 0, 500)).toBe(0)
      expect(table.hasForgetEvent('a', 'm1')).toBe(beforeForget)
      expect(
        table
          .listByAgent('a', { limit: 100 })
          .map((row) => row.id)
          .sort()
      ).toEqual([...preserved.map(([id]) => id), 'malformed-causal'].sort())
      expect(table.listByAgent('b', { limit: 100 }).map((row) => row.id)).toEqual([
        'other-agent-operational'
      ])
    } finally {
      db.close()
    }
  })
})
