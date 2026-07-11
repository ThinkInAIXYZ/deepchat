import { expect } from 'vitest'

import { AgentMemoryTable } from '@/presenter/sqlitePresenter/tables/agentMemory'

import { buildMemoryFixture } from './fixtures'
import { createMemoryPerfObserver } from './performanceObserver'
import { describeIfNativeSqlite, requireDatabase } from '../../nativeSqliteHarness'
import { measurePerformance, reportPerformance } from './timing'

type AgentMemorySearchInternals = {
  searchLike(agentId: string, terms: string[], limit: number, matchMode: 'all' | 'any'): unknown[]
}

describeIfNativeSqlite('Agent Memory #28 recall scale', () => {
  it('keeps safe-trigram recall indexed through 1k, 10k and 50k rows', () => {
    const DatabaseCtor = requireDatabase()
    const observer = createMemoryPerfObserver(true)
    const db = new DatabaseCtor(':memory:', {
      verbose: () => observer.increment('sqliteStatements')
    })
    try {
      const table = new AgentMemoryTable(db, observer)
      table.createTable()
      const ftsMeta = db
        .prepare(
          `SELECT schema_version, policy_version, tokenizer
           FROM agent_memory_fts_meta WHERE key = 'agent_memory_fts'`
        )
        .get() as { schema_version: number; policy_version: number; tokenizer: string } | undefined
      expect(ftsMeta).toEqual({ schema_version: 4, policy_version: 2, tokenizer: 'trigram' })

      const insert = db.prepare(
        `INSERT INTO agent_memory (
           id, agent_id, kind, content, status, created_at, importance
         ) VALUES (?, ?, 'semantic', ?, 'embedded', ?, ?)`
      )
      const sizes = [1_000, 10_000, 50_000] as const
      const realisticPayload = ' bounded durable memory context'.repeat(64)
      const insertAll = db.transaction(() => {
        for (const size of sizes) {
          const agentId = `recall-${size}`
          for (const row of buildMemoryFixture(size, agentId)) {
            const content =
              row.createdAt > size - 100
                ? `redis project tail fact ${row.createdAt}${realisticPayload}`
                : `${row.content.replace('redis project fact', 'synthetic memory')}${realisticPayload}`
            insert.run(
              `${agentId}-${row.id}`,
              agentId,
              content,
              row.createdAt,
              (row.createdAt % 10) / 10
            )
          }
        }
      })
      insertAll()
      db.prepare(
        `UPDATE agent_memory_fts_meta
         SET mutation_generation = mutation_generation + 1
         WHERE key = 'agent_memory_fts'`
      ).run()
      const searchTable = new AgentMemoryTable(db, observer)
      searchTable.createTable()

      const reports = new Map<number, { indexed: number; legacy: number }>()
      for (const size of sizes) {
        const agentId = `recall-${size}`
        observer.reset()
        const indexedRows = searchTable.search(agentId, 'redis project', 20, { matchMode: 'all' })
        const indexedSnapshot = observer.snapshot()
        expect(indexedRows.length).toBeGreaterThanOrEqual(20)
        expect(indexedRows.length).toBeLessThanOrEqual(40)
        expect(indexedSnapshot.counters.sqliteStatements).toBeLessThanOrEqual(2)
        expect(indexedSnapshot.counters.materializedRows).toBeLessThanOrEqual(40)

        const indexed = measurePerformance(`recall-fts-${size}`, size, () => {
          searchTable.search(agentId, 'redis project', 20, { matchMode: 'all' })
        })
        const legacy = measurePerformance(`recall-like-${size}`, size, () => {
          ;(searchTable as unknown as AgentMemorySearchInternals).searchLike(
            agentId,
            ['redis', 'project'],
            20,
            'all'
          )
        })
        reportPerformance(indexed)
        reportPerformance(legacy)
        reports.set(size, { indexed: indexed.medianMs, legacy: legacy.medianMs })
      }

      const largest = reports.get(50_000)
      expect(largest).toBeDefined()
      expect(largest!.indexed).toBeLessThanOrEqual(largest!.legacy * 0.5)
    } finally {
      db.close()
    }
  }, 120_000)

  it('keeps common-term recall agent-scoped across 100 agents', () => {
    const DatabaseCtor = requireDatabase()
    const observer = createMemoryPerfObserver(true)
    const db = new DatabaseCtor(':memory:', {
      verbose: () => observer.increment('sqliteStatements')
    })
    try {
      const table = new AgentMemoryTable(db, observer)
      table.createTable()
      const insert = db.prepare(
        `INSERT INTO agent_memory (id, agent_id, kind, content, status, created_at)
         VALUES (?, ?, 'semantic', ?, 'embedded', ?)`
      )
      db.transaction(() => {
        for (let agentIndex = 0; agentIndex < 100; agentIndex += 1) {
          const agentId = `scope-${agentIndex.toString().padStart(3, '0')}`
          for (let rowIndex = 0; rowIndex < 100; rowIndex += 1) {
            insert.run(
              `${agentId}-${rowIndex}`,
              agentId,
              `shared common durable fact ${rowIndex}`,
              rowIndex
            )
          }
        }
      })()
      db.prepare(
        `UPDATE agent_memory_fts_meta
         SET mutation_generation = mutation_generation + 1
         WHERE key = 'agent_memory_fts'`
      ).run()
      const searchTable = new AgentMemoryTable(db, observer)
      searchTable.createTable()

      observer.reset()
      for (let agentIndex = 0; agentIndex < 100; agentIndex += 1) {
        const agentId = `scope-${agentIndex.toString().padStart(3, '0')}`
        const rows = searchTable.search(agentId, 'shared common', 5, { matchMode: 'all' })
        expect(rows).toHaveLength(10)
        expect(rows.every((row) => row.agent_id === agentId)).toBe(true)
      }
      expect(observer.snapshot()).toMatchObject({
        counters: {
          sqliteStatements: 100,
          repositoryCalls: 100,
          materializedRows: 1_000
        }
      })
    } finally {
      db.close()
    }
  }, 30_000)
})
