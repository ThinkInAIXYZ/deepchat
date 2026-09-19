import { performance } from 'node:perf_hooks'

import { expect } from 'vitest'

import { AgentMemoryTable } from '@/memory/data/tables/agentMemory'

import { describeIfNativeSqlite, requireDatabase } from '../../nativeSqliteHarness'

const CLEAR_CORPUS_SIZE = 10_000
const CLEAR_BATCH_SIZE = 256
const CLEAR_MAX_BATCH_MS = 500

describeIfNativeSqlite('Agent Memory clear scale', () => {
  it('keeps every SQLite clear transaction bounded at 10k scale', () => {
    const DatabaseCtor = requireDatabase()
    const db = new DatabaseCtor(':memory:')
    try {
      const setupTable = new AgentMemoryTable(db)
      setupTable.createTable()
      const insert = db.prepare(
        `INSERT INTO agent_memory (
           id, agent_id, kind, content, provenance_key, status, created_at
         ) VALUES (?, 'clear-agent', 'semantic', ?, ?, 'fts_only', ?)`
      )
      db.transaction(() => {
        for (let index = 0; index < CLEAR_CORPUS_SIZE; index += 1) {
          insert.run(
            `clear-${index}`,
            `bounded clear claim ${index}`,
            `bounded-clear-source-${index}`,
            index
          )
        }
      })()
      db.prepare(
        `UPDATE agent_memory_fts_meta
         SET mutation_generation = mutation_generation + 1
         WHERE key = 'agent_memory_fts'`
      ).run()

      const table = new AgentMemoryTable(db)
      table.createTable()
      let job = table.beginMemoryClear('clear-agent', CLEAR_CORPUS_SIZE + 1)
      const batchDurations: number[] = []
      let batchCount = 0
      while (job.phase === 'claims') {
        const startedAt = performance.now()
        const batch = table.processMemoryClearBatch('clear-agent')
        batchDurations.push(performance.now() - startedAt)
        if (!batch) throw new Error('clear job disappeared before vector cleanup')
        expect(batch.removedInBatch).toBeGreaterThan(0)
        expect(batch.removedInBatch).toBeLessThanOrEqual(CLEAR_BATCH_SIZE)
        job = batch.job
        batchCount += 1
      }

      const maxBatchMs = Math.max(...batchDurations)
      console.info(
        `[memory-perf] ${JSON.stringify({
          scenario: 'clear-10k-bounded-transactions',
          size: CLEAR_CORPUS_SIZE,
          batches: batchCount,
          maxBatchMs
        })}`
      )
      expect(batchCount).toBe(Math.ceil(CLEAR_CORPUS_SIZE / CLEAR_BATCH_SIZE))
      expect(maxBatchMs).toBeLessThanOrEqual(CLEAR_MAX_BATCH_MS)
      expect(job.removed).toBe(CLEAR_CORPUS_SIZE)
      expect(table.countByAgent('clear-agent')).toBe(0)
      expect(
        db
          .prepare(
            `SELECT COUNT(*) AS count
             FROM agent_memory_tombstone
             WHERE agent_id = 'clear-agent'`
          )
          .get()
      ).toEqual({ count: CLEAR_CORPUS_SIZE * 2 })
      expect(table.completeMemoryClear('clear-agent')).toBe(true)
    } finally {
      db.close()
    }
  })
})
