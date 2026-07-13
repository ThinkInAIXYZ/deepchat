import { expect } from 'vitest'

import { DeepChatMessagesTable } from '@/presenter/sqlitePresenter/tables/deepchatMessages'
import { DeepChatMessageTracesTable } from '@/presenter/sqlitePresenter/tables/deepchatMessageTraces'

import { describeIfNativeSqlite, requireDatabase } from '../../nativeSqliteHarness'
import { measurePerformance, reportPerformance } from './timing'

const TARGET_SESSION_ID = 'target-session'
const TARGET_MESSAGE_COUNT = 1_000
const GLOBAL_TRACE_COUNTS = [0, 10_000, 100_000] as const

describeIfNativeSqlite('Message history trace scale', () => {
  it('keeps runtime history reads independent of unrelated global traces', () => {
    const DatabaseCtor = requireDatabase()
    const db = new DatabaseCtor(':memory:')
    try {
      const messages = new DeepChatMessagesTable(db)
      messages.createTable()
      const traces = new DeepChatMessageTracesTable(db)
      traces.createTable()

      const insertMessage = db.prepare(
        `INSERT INTO deepchat_messages (
           id, session_id, order_seq, role, content, status, is_context_edge, metadata,
           created_at, updated_at
         ) VALUES (?, ?, ?, ?, '{}', 'sent', 0, '{}', ?, ?)`
      )
      db.transaction(() => {
        for (let index = 0; index < TARGET_MESSAGE_COUNT; index += 1) {
          const orderSeq = index + 1
          insertMessage.run(
            `target-message-${orderSeq}`,
            TARGET_SESSION_ID,
            orderSeq,
            index % 2 === 0 ? 'user' : 'assistant',
            orderSeq,
            orderSeq
          )
        }
      })()

      const insertTrace = db.prepare(
        `INSERT INTO deepchat_message_traces (
           id, message_id, session_id, provider_id, model_id, request_seq, endpoint,
           headers_json, body_json, truncated, created_at
         ) VALUES (?, ?, ?, 'openai', 'gpt-4o', 1, 'https://api.openai.test/v1/responses',
                   '{}', '{}', 0, ?)`
      )
      let insertedTraceCount = 0
      const reports: Array<{ traceCount: number; medianMs: number }> = []

      for (const traceCount of GLOBAL_TRACE_COUNTS) {
        db.transaction(() => {
          while (insertedTraceCount < traceCount) {
            const traceIndex = insertedTraceCount + 1
            insertTrace.run(
              `global-trace-${traceIndex}`,
              `global-message-${traceIndex}`,
              `unrelated-session-${Math.floor(insertedTraceCount / 1_000)}`,
              traceIndex
            )
            insertedTraceCount = traceIndex
          }
        })()

        const rows = messages.getBySession(TARGET_SESSION_ID)
        expect(rows).toHaveLength(TARGET_MESSAGE_COUNT)
        expect(rows.every((row) => row.trace_count === undefined)).toBe(true)

        const report = measurePerformance(
          `message-history-global-traces-${traceCount}`,
          traceCount,
          () => {
            messages.getBySession(TARGET_SESSION_ID)
          },
          9
        )
        reportPerformance(report)
        reports.push({ traceCount, medianMs: report.medianMs })
      }

      const baselineMedianMs = reports[0]!.medianMs
      console.info(
        `[message-history-trace-scale] ${JSON.stringify(
          reports.map((report) => ({
            ...report,
            ratioToZeroTraces: baselineMedianMs === 0 ? 0 : report.medianMs / baselineMedianMs
          }))
        )}`
      )
      expect(reports.map((report) => report.traceCount)).toEqual([...GLOBAL_TRACE_COUNTS])
    } finally {
      db.close()
    }
  })
})
