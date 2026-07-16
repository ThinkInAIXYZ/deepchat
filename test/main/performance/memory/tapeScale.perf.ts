import { expect } from 'vitest'

import { buildEffectiveTapeView } from '@/session/data/tapeEffectiveView'
import { DeepChatMemoryIngestionProjectionTable } from '@/memory/data/tables/deepchatMemoryIngestionProjection'
import { DeepChatTapeEntriesTable } from '@/session/data/tables/deepchatTapeEntries'

import { createMemoryPerfObserver } from './performanceObserver'
import { describeIfNativeSqlite, requireDatabase } from '../../nativeSqliteHarness'
import { measurePerformance, reportPerformance } from './timing'

function messagePayload(sessionId: string, index: number): string {
  const id = `message-${index.toString().padStart(6, '0')}`
  return JSON.stringify({
    record: {
      id,
      sessionId,
      orderSeq: index + 1,
      role: index % 2 === 0 ? 'user' : 'assistant',
      content: `synthetic tape entry ${index}`,
      status: 'sent',
      isContextEdge: 0,
      metadata: '{}',
      traceCount: 0,
      createdAt: index + 1,
      updatedAt: index + 1
    }
  })
}

describeIfNativeSqlite('Agent Memory #28 Tape scale', () => {
  it('keeps tail reads range-bound at 10k and 100k entries', () => {
    const DatabaseCtor = requireDatabase()
    const observer = createMemoryPerfObserver(true)
    const db = new DatabaseCtor(':memory:', {
      verbose: () => observer.increment('sqliteStatements')
    })
    try {
      const projection = new DeepChatMemoryIngestionProjectionTable(db, observer)
      projection.createTable()
      const tape = new DeepChatTapeEntriesTable(db, projection)
      tape.createTable()
      const insertTape = db.prepare(
        `INSERT INTO deepchat_tape_entries (
           session_id, entry_id, kind, name, source_type, source_id, source_seq,
           provenance_key, payload_json, meta_json, created_at
         ) VALUES (?, ?, 'message', ?, 'message', ?, 0, NULL, ?, '{"status":"sent"}', ?)`
      )
      const insertProjection = db.prepare(
        `INSERT INTO deepchat_memory_ingestion_projection (
           session_id, message_id, order_seq, entry_id, role, content, status, had_tool_use
         ) VALUES (?, ?, ?, ?, ?, ?, 'sent', 0)`
      )
      const insertMeta = db.prepare(
        `INSERT INTO deepchat_memory_ingestion_projection_meta (
           session_id, projection_version, max_entry_id, updated_at
         ) VALUES (?, 1, ?, ?)`
      )
      const sizes = [10_000, 100_000] as const
      const seed = db.transaction(() => {
        for (const size of sizes) {
          const sessionId = `tape-${size}`
          for (let index = 0; index < size; index += 1) {
            const messageId = `message-${index.toString().padStart(6, '0')}`
            const role = index % 2 === 0 ? 'user' : 'assistant'
            insertTape.run(
              sessionId,
              index + 1,
              `message/${role}`,
              messageId,
              messagePayload(sessionId, index),
              index + 1
            )
            insertProjection.run(
              sessionId,
              messageId,
              index + 1,
              index + 1,
              role,
              `synthetic tape entry ${index}`
            )
          }
          insertMeta.run(sessionId, size, size)
        }
      })
      seed()

      const reports = new Map<number, { range: number; full: number }>()
      for (const size of sizes) {
        const sessionId = `tape-${size}`
        const from = size - 20
        observer.reset()
        const tail = projection.readCurrentRange(sessionId, from, size)
        expect(tail.current).toBe(true)
        expect(tail.rows).toHaveLength(20)
        expect(observer.snapshot()).toMatchObject({
          counters: {
            sqliteStatements: 1,
            repositoryCalls: 1,
            materializedRows: 20
          }
        })

        const range = measurePerformance(
          `tape-range-${size}`,
          size,
          () => {
            projection.readCurrentRange(sessionId, from, size)
          },
          5
        )
        const full = measurePerformance(
          `tape-full-view-${size}`,
          size,
          () => {
            const view = buildEffectiveTapeView(tape.getBySession(sessionId))
            view.messageEntries.filter((entry) => entry.record.orderSeq > from)
          },
          5
        )
        reportPerformance(range)
        reportPerformance(full)
        reports.set(size, { range: range.medianMs, full: full.medianMs })
      }

      const largest = reports.get(100_000)
      expect(largest).toBeDefined()
      expect(largest!.range).toBeLessThanOrEqual(largest!.full * 0.2)
    } finally {
      db.close()
    }
  }, 120_000)
})
