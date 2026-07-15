import { describe, expect, vi } from 'vitest'
import { buildEffectiveTapeView } from '@/session/data/tapeEffectiveView'
import { Database, nativeSqliteItIf } from '../nativeSqliteHarness'

const entriesModule = Database ? await import('@/session/data/tables/deepchatTapeEntries') : null
const projectionModule = Database
  ? await import('@/memory/data/tables/deepchatMemoryIngestionProjection')
  : null

const DeepChatTapeEntriesTable = entriesModule?.DeepChatTapeEntriesTable
const DeepChatMemoryIngestionProjectionTable =
  projectionModule?.DeepChatMemoryIngestionProjectionTable
const DatabaseCtor = Database!
const TapeTableCtor = DeepChatTapeEntriesTable!
const ProjectionTableCtor = DeepChatMemoryIngestionProjectionTable!
const itIfSqlite = nativeSqliteItIf(
  Boolean(DeepChatTapeEntriesTable && DeepChatMemoryIngestionProjectionTable),
  'Tape projection native table modules are unavailable'
)

describe('DeepChatMemoryIngestionProjectionTable', () => {
  function createTables() {
    const db = new DatabaseCtor(':memory:')
    const projection = new ProjectionTableCtor(db)
    projection.createTable()
    const tape = new TapeTableCtor(db, projection)
    tape.createTable()
    return { db, projection, tape }
  }

  function appendMessage(
    tape: InstanceType<typeof TapeTableCtor>,
    input: {
      sessionId?: string
      id: string
      orderSeq: number
      status: 'pending' | 'sent' | 'error'
      content: string
      role?: 'user' | 'assistant'
    }
  ) {
    const sessionId = input.sessionId ?? 's1'
    return tape.append({
      sessionId,
      kind: 'message',
      name: `message/${input.role ?? 'user'}`,
      source: { type: 'message', id: input.id, seq: 0 },
      provenanceKey: null,
      payload: {
        record: {
          id: input.id,
          sessionId,
          orderSeq: input.orderSeq,
          role: input.role ?? 'user',
          content: input.content,
          status: input.status,
          isContextEdge: 0,
          metadata: '{}',
          traceCount: 0,
          createdAt: 100 + input.orderSeq,
          updatedAt: 100 + input.orderSeq
        }
      },
      meta: { status: input.status },
      createdAt: 100 + input.orderSeq
    })
  }

  function appendToolCall(
    tape: InstanceType<typeof TapeTableCtor>,
    input: {
      sessionId?: string
      messageId: string
      toolCallId: string
      status: 'pending' | 'success' | 'error'
    }
  ) {
    return tape.append({
      sessionId: input.sessionId ?? 's1',
      kind: 'tool_call',
      name: 'read_file',
      source: { type: 'tool_call', id: input.toolCallId, seq: 0 },
      provenanceKey: null,
      payload: {
        messageId: input.messageId,
        toolCall: { id: input.toolCallId, name: 'read_file' }
      },
      meta: { status: input.status },
      createdAt: 200
    })
  }

  function rebuildFromTape(
    tape: InstanceType<typeof TapeTableCtor>,
    projection: InstanceType<typeof ProjectionTableCtor>,
    sessionId = 's1'
  ) {
    const view = buildEffectiveTapeView(tape.getBySession(sessionId))
    const messageIdsWithToolUse = new Set<string>()
    for (const row of view.rows) {
      if (row.kind !== 'tool_call') continue
      const payload = JSON.parse(row.payload_json) as { messageId?: unknown }
      if (typeof payload.messageId === 'string') {
        messageIdsWithToolUse.add(payload.messageId)
      }
    }
    projection.replaceSession(
      sessionId,
      view.messageEntries.map((entry) => ({
        sessionId,
        messageId: entry.record.id,
        orderSeq: entry.record.orderSeq,
        entryId: entry.entryId,
        role: entry.record.role,
        content: entry.record.content,
        status: entry.record.status as 'sent' | 'error',
        hadToolUse: messageIdsWithToolUse.has(entry.record.id)
      })),
      tape.getMaxEntryId(sessionId)
    )
    return view
  }

  itIfSqlite(
    'incrementally projects final messages, revisions, tool calls and unrelated entries',
    () => {
      const { db, projection, tape } = createTables()
      try {
        tape.ensureBootstrapAnchor('s1')
        appendMessage(tape, {
          id: 'pending',
          orderSeq: 1,
          status: 'pending',
          content: 'not recallable'
        })
        appendMessage(tape, {
          id: 'm2',
          orderSeq: 2,
          status: 'sent',
          content: 'second'
        })
        appendMessage(tape, {
          id: 'm1',
          orderSeq: 1,
          status: 'sent',
          content: 'first'
        })
        tape.append({
          sessionId: 's1',
          kind: 'tool_result',
          name: 'read_file',
          source: { type: 'tool_result', id: 'm2:tool-result-only', seq: 0 },
          provenanceKey: null,
          payload: {
            messageId: 'm2',
            toolCallId: 'tool-result-only',
            response: 'ok'
          },
          meta: { status: 'success' },
          createdAt: 150
        })
        const originalM1EntryId = projection.listRange('s1', 0, 10)[0].entry_id
        appendToolCall(tape, {
          messageId: 'm1',
          toolCallId: 'tool-pending',
          status: 'pending'
        })
        appendToolCall(tape, {
          messageId: 'm1',
          toolCallId: 'tool-final',
          status: 'success'
        })
        const replacement = appendMessage(tape, {
          id: 'm1',
          orderSeq: 1,
          status: 'error',
          content: 'first corrected'
        })
        tape.appendEvent({
          sessionId: 's1',
          name: 'memory/extract',
          data: { count: 1 },
          createdAt: 300
        })

        expect(projection.isCurrent('s1', tape.getMaxEntryId('s1'))).toBe(true)
        const currentRange = projection.readCurrentRange('s1', 0, 10)
        expect(currentRange.current).toBe(true)
        expect(currentRange.rows).toMatchObject([
          {
            message_id: 'm1',
            order_seq: 1,
            entry_id: replacement.entry_id,
            content: 'first corrected',
            status: 'error',
            had_tool_use: 1
          },
          {
            message_id: 'm2',
            order_seq: 2,
            content: 'second',
            status: 'sent',
            had_tool_use: 0
          }
        ])
        expect(replacement.entry_id).toBeGreaterThan(originalM1EntryId)
      } finally {
        db.close()
      }
    }
  )

  itIfSqlite('uses each session previous max instead of a global entry predecessor', () => {
    const { db, projection, tape } = createTables()
    try {
      for (let index = 0; index < 5; index += 1) {
        tape.appendEvent({
          sessionId: 's1',
          name: `event/${index}`,
          data: { index },
          createdAt: index
        })
      }
      appendMessage(tape, {
        sessionId: 's2',
        id: 'other-session-message',
        orderSeq: 1,
        status: 'sent',
        content: 'other'
      })

      expect(tape.getMaxEntryId('s1')).toBe(5)
      expect(tape.getMaxEntryId('s2')).toBe(1)
      expect(projection.isCurrent('s2', 1)).toBe(true)
      expect(projection.listRange('s2', 0, 1)).toMatchObject([
        { message_id: 'other-session-message', entry_id: 1 }
      ])
    } finally {
      db.close()
    }
  })

  itIfSqlite(
    'marks retractions stale and keeps a final tool-before-message sequence current',
    () => {
      const { db, projection, tape } = createTables()
      try {
        appendMessage(tape, {
          id: 'm1',
          orderSeq: 1,
          status: 'sent',
          content: 'first'
        })
        tape.appendEvent({
          sessionId: 's1',
          name: 'message/retracted',
          data: { messageId: 'm1' },
          createdAt: 200
        })
        expect(projection.isCurrent('s1', tape.getMaxEntryId('s1'))).toBe(false)

        projection.deleteBySession('s1')
        tape.deleteBySession('s1')
        appendToolCall(tape, {
          messageId: 'future-message',
          toolCallId: 'tool-before-message',
          status: 'success'
        })
        expect(projection.isCurrent('s1', tape.getMaxEntryId('s1'))).toBe(true)
      } finally {
        db.close()
      }
    }
  )

  itIfSqlite('rebuilds to full effective-view parity after retraction and re-add', () => {
    const { db, projection, tape } = createTables()
    try {
      appendMessage(tape, {
        id: 'm1',
        orderSeq: 1,
        status: 'sent',
        content: 'old'
      })
      appendToolCall(tape, {
        messageId: 'm1',
        toolCallId: 'tool-1',
        status: 'success'
      })
      appendMessage(tape, {
        id: 'z-message',
        orderSeq: 2,
        status: 'sent',
        content: 'z'
      })
      appendMessage(tape, {
        id: 'a-message',
        orderSeq: 2,
        status: 'sent',
        content: 'a'
      })
      tape.appendEvent({
        sessionId: 's1',
        name: 'message/retracted',
        data: { messageId: 'm1' },
        createdAt: 300
      })
      const restored = appendMessage(tape, {
        id: 'm1',
        orderSeq: 3,
        status: 'error',
        content: 'restored'
      })

      expect(projection.isCurrent('s1', tape.getMaxEntryId('s1'))).toBe(false)
      const view = rebuildFromTape(tape, projection)
      const projected = projection.listRange('s1', 0, 10)

      expect(
        projected.map((row) => ({
          messageId: row.message_id,
          orderSeq: row.order_seq,
          entryId: row.entry_id,
          role: row.role,
          content: row.content,
          status: row.status
        }))
      ).toEqual(
        view.messageEntries.map((entry) => ({
          messageId: entry.record.id,
          orderSeq: entry.record.orderSeq,
          entryId: entry.entryId,
          role: entry.record.role,
          content: entry.record.content,
          status: entry.record.status
        }))
      )
      expect(projected.map((row) => row.message_id)).toEqual(['a-message', 'z-message', 'm1'])
      expect(projected.find((row) => row.message_id === 'm1')).toMatchObject({
        entry_id: restored.entry_id,
        had_tool_use: 1
      })
    } finally {
      db.close()
    }
  })

  itIfSqlite('keeps Tape authoritative when reducer failure can invalidate projection', () => {
    const db = new DatabaseCtor(':memory:')
    const projection = {
      applyAppendedEntry: vi.fn(() => {
        throw new Error('projection write failed')
      }),
      invalidateSession: vi.fn(),
      deleteBySession: vi.fn()
    }
    const tape = new TapeTableCtor(db, projection)
    tape.createTable()
    try {
      tape.appendEvent({ sessionId: 's1', name: 'run/start', data: {}, createdAt: 100 })
      expect(tape.countBySession('s1')).toBe(1)
      expect(projection.invalidateSession).toHaveBeenCalledWith('s1')
    } finally {
      db.close()
    }
  })

  itIfSqlite('rolls Tape append back when projection invalidation also fails', () => {
    const db = new DatabaseCtor(':memory:')
    const projection = {
      applyAppendedEntry: vi.fn(() => {
        throw new Error('projection write failed')
      }),
      invalidateSession: vi.fn(() => {
        throw new Error('projection invalidation failed')
      }),
      deleteBySession: vi.fn()
    }
    const tape = new TapeTableCtor(db, projection)
    tape.createTable()
    try {
      expect(() =>
        tape.appendEvent({ sessionId: 's1', name: 'run/start', data: {}, createdAt: 100 })
      ).toThrow('projection invalidation failed')
      expect(tape.countBySession('s1')).toBe(0)
    } finally {
      db.close()
    }
  })

  itIfSqlite(
    'replaces a stale session transactionally and persists current meta across restart',
    () => {
      const { db, projection, tape } = createTables()
      try {
        tape.appendEvent({ sessionId: 's1', name: 'legacy/event', data: {}, createdAt: 100 })
        projection.invalidateSession('s1')
        projection.replaceSession(
          's1',
          [
            {
              sessionId: 's1',
              messageId: 'rebuilt',
              orderSeq: 3,
              entryId: 1,
              role: 'assistant',
              content: 'rebuilt content',
              status: 'sent',
              hadToolUse: true
            }
          ],
          tape.getMaxEntryId('s1')
        )

        const restartedProjection = new ProjectionTableCtor(db)
        restartedProjection.createTable()
        const restartedTape = new TapeTableCtor(db, restartedProjection)
        expect(restartedProjection.isCurrent('s1', restartedTape.getMaxEntryId('s1'))).toBe(true)

        restartedTape.appendEvent({
          sessionId: 's1',
          name: 'after/restart',
          data: {},
          createdAt: 200
        })
        expect(restartedProjection.isCurrent('s1', restartedTape.getMaxEntryId('s1'))).toBe(true)
        expect(restartedProjection.listRange('s1', 0, 10)).toMatchObject([
          { message_id: 'rebuilt', had_tool_use: 1 }
        ])
      } finally {
        db.close()
      }
    }
  )

  itIfSqlite('cleans projection rows and meta with the authoritative session delete', () => {
    const { db, projection, tape } = createTables()
    try {
      appendMessage(tape, {
        id: 'm1',
        orderSeq: 1,
        status: 'sent',
        content: 'first'
      })
      tape.deleteBySession('s1')

      expect(tape.getBySession('s1')).toEqual([])
      expect(projection.listRange('s1', 0, 10)).toEqual([])
      expect(projection.getSessionMeta('s1')).toBeNull()
    } finally {
      db.close()
    }
  })
})
