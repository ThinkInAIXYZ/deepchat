import { describe, expect, it, vi } from 'vitest'
import type { AssistantMessageBlock, ChatMessageRecord } from '@shared/types/agent-interface'

const sqliteModule = await import('better-sqlite3-multiple-ciphers').catch(() => null)
const mainDatabaseModule = sqliteModule ? await import('@/data/mainDatabase') : null
const sessionDatabaseModule = sqliteModule ? await import('@/session/data/database') : null
const sessionTapeModule = sqliteModule ? await import('@/tape/application/sessionTape') : null
const transcriptModule = sqliteModule ? await import('@/session/data/transcript') : null

const Database = sqliteModule?.default
const MainDatabaseCtor = mainDatabaseModule?.MainDatabase!
const SessionDatabaseCtor = sessionDatabaseModule?.SessionDatabase!
const SessionTapeCtor = sessionTapeModule?.SessionTape!
const SessionTranscriptCtor = transcriptModule?.SessionTranscript!

let sqliteAvailable = false
if (Database) {
  try {
    new Database(':memory:').close()
    sqliteAvailable = true
  } catch {
    sqliteAvailable = false
  }
}

// CI rebuilds the native module for the Node ABI and sets this flag; a silent skip there would
// hide a regression, so an unavailable module must fail the suite instead of skipping it.
const describeIfSqlite =
  sqliteAvailable || process.env.DEEPCHAT_REQUIRE_NATIVE_SQLITE === '1' ? describe : describe.skip

const userContent = { text: 'hello', files: [], links: [], search: false, think: false }
const blocks: AssistantMessageBlock[] = [
  { type: 'content', content: 'done', status: 'success', timestamp: 1 }
]

/**
 * The transcript is a projection of the Session's message facts: terminal writes append the fact
 * and derive the tables from it, readiness only replays what reached the Tape past the cursor,
 * and a Session that predates the cursor is backfilled from its transcript exactly once.
 */
describeIfSqlite('SessionTranscript follows the Tape through the projection cursor', () => {
  function createSession() {
    const connection = new MainDatabaseCtor(':memory:')
    const database = new SessionDatabaseCtor(connection)
    const tape = new SessionTapeCtor(database)
    const transcript = new SessionTranscriptCtor(database, tape)
    const head = () => tape.getProjectionHead('s1')
    const cursor = () => database.deepchatTranscriptProjectionMetaTable.get('s1')
    return { connection, database, tape, transcript, head, cursor }
  }

  it('establishes the cursor through readiness and moves it with every terminal write', () => {
    const { connection, tape, transcript, head, cursor } = createSession()
    try {
      const getMessages = vi.spyOn(transcript, 'getMessages')
      transcript.createUserMessage('s1', 1, userContent)
      // A write before the first readiness check appends its fact but does not invent a cursor.
      expect(cursor()).toBeNull()

      const first = tape.ensureSessionTapeReady('s1', transcript)
      expect(first.historyRecords.map((record) => record.orderSeq)).toEqual([1])
      expect(cursor()).toEqual(head())
      expect(getMessages).toHaveBeenCalledTimes(1)

      const assistantId = transcript.createAssistantMessage('s1', 2)
      transcript.finalizeAssistantMessage(assistantId, blocks, '{}')
      expect(cursor()).toEqual(head())

      const second = tape.ensureSessionTapeReady('s1', transcript)
      expect(second.appendedFactCount).toBe(0)
      expect(second.historyRecords.map((record) => record.orderSeq)).toEqual([1, 2])
      // Readiness did not have to read the transcript again.
      expect(getMessages).toHaveBeenCalledTimes(1)
    } finally {
      connection.close()
    }
  })

  it('materializes message facts that reached the Tape behind the transcript', () => {
    const { connection, database, tape, transcript, cursor, head } = createSession()
    try {
      const userId = transcript.createUserMessage('s1', 1, userContent)
      tape.ensureSessionTapeReady('s1', transcript)

      const direct: ChatMessageRecord = {
        id: 'direct-1',
        sessionId: 's1',
        orderSeq: 2,
        role: 'assistant',
        content: JSON.stringify(blocks),
        status: 'sent',
        isContextEdge: 0,
        metadata: '{}',
        traceCount: 0,
        createdAt: 500,
        updatedAt: 500
      }
      tape.appendMessageRecord(direct)
      expect(transcript.getMessage('direct-1')).toBeNull()

      tape.ensureSessionTapeReady('s1', transcript)
      expect(transcript.getMessage('direct-1')).toMatchObject({
        id: 'direct-1',
        role: 'assistant',
        orderSeq: 2,
        status: 'sent',
        createdAt: 500,
        updatedAt: 500
      })
      expect(JSON.parse(transcript.getMessage('direct-1')!.content)).toMatchObject([
        { type: 'content', content: 'done', status: 'success', timestamp: 1 }
      ])
      expect(cursor()).toEqual(head())

      tape.appendMessageRetraction(transcript.getMessage(userId)!, 'test_delete')
      tape.ensureSessionTapeReady('s1', transcript)
      expect(transcript.getMessage(userId)).toBeNull()
      expect(transcript.getMessages('s1').map((record) => record.id)).toEqual(['direct-1'])

      // Without a cursor the backfill branch runs; a fact the transcript never held still lands,
      // and a block that carries no timestamp reports the record's time, not the replay's.
      database.deepchatTranscriptProjectionMetaTable.delete('s1')
      tape.appendMessageRecord({
        ...direct,
        id: 'direct-2',
        orderSeq: 3,
        content: JSON.stringify([{ type: 'content', content: 'later', status: 'success' }]),
        createdAt: 600,
        updatedAt: 600
      })
      const ready = tape.ensureSessionTapeReady('s1', transcript)
      expect(ready.historyRecords.map((record) => record.id)).toEqual(['direct-1', 'direct-2'])
      expect(transcript.getMessages('s1').map((record) => record.id)).toEqual([
        'direct-1',
        'direct-2'
      ])
      expect(JSON.parse(transcript.getMessage('direct-2')!.content)[0].timestamp).toBe(600)
      expect(cursor()).toEqual(head())
    } finally {
      connection.close()
    }
  })

  it('backfills a Session written before the projection existed without deleting any row', () => {
    const { connection, database, tape, transcript, cursor } = createSession()
    try {
      // Rows from an earlier version: transcript only, no facts, no cursor.
      for (const [orderSeq, role] of [
        [1, 'user'],
        [2, 'assistant'],
        [3, 'user']
      ] as const) {
        database.deepchatMessagesTable.insert({
          id: `legacy-${orderSeq}`,
          sessionId: 's1',
          orderSeq,
          role,
          content: role === 'user' ? JSON.stringify(userContent) : JSON.stringify(blocks),
          status: 'sent'
        })
      }

      // A deletion before the first readiness check appends its retraction but leaves the cursor
      // unset, so the remaining rows still get their one-time backfill.
      transcript.deleteMessage('legacy-3')
      expect(cursor()).toBeNull()

      const ready = tape.ensureSessionTapeReady('s1', transcript)
      expect(ready.appendedFactCount).toBe(2)
      expect(ready.historyRecords.map((record) => record.id)).toEqual(['legacy-1', 'legacy-2'])
      expect(transcript.getMessages('s1').map((record) => record.id)).toEqual([
        'legacy-1',
        'legacy-2'
      ])
      expect(cursor()).not.toBeNull()

      const again = tape.ensureSessionTapeReady('s1', transcript)
      expect(again.appendedFactCount).toBe(0)
    } finally {
      connection.close()
    }
  })

  it('refuses to move a message row to another Session on an id collision', () => {
    const { connection, database, transcript } = createSession()
    try {
      const id = transcript.createUserMessage('s1', 1, userContent)
      const row = database.deepchatMessagesTable.get(id)!
      expect(() =>
        database.deepchatMessagesTable.upsert({
          id,
          sessionId: 's2',
          orderSeq: 1,
          role: 'user',
          content: row.content,
          status: 'sent',
          isContextEdge: 0,
          metadata: '{}',
          createdAt: row.created_at,
          updatedAt: row.updated_at
        })
      ).toThrow('belongs to another session')
      expect(database.deepchatMessagesTable.get(id)?.session_id).toBe('s1')
    } finally {
      connection.close()
    }
  })

  it('drops the cursor with the Session transcript and rebuilds it after a Tape reset', () => {
    const { connection, database, tape, transcript, cursor, head } = createSession()
    try {
      transcript.createUserMessage('s1', 1, userContent)
      tape.ensureSessionTapeReady('s1', transcript)
      const before = cursor()!

      // clearMessages deletes the transcript rows and the cursor in one transaction.
      database.getDatabase().transaction(() => {
        transcript.deleteBySession('s1')
        tape.resetSessionTape('s1')
      })()
      expect(cursor()).toBeNull()

      transcript.createUserMessage('s1', 1, { ...userContent, text: 'after reset' })
      const ready = tape.ensureSessionTapeReady('s1', transcript)
      expect(ready.historyRecords).toHaveLength(1)
      expect(JSON.parse(ready.historyRecords[0].content).text).toBe('after reset')
      expect(cursor()).toEqual(head())
      expect(cursor()!.tapeIncarnationId).not.toBe(before.tapeIncarnationId)
    } finally {
      connection.close()
    }
  })
})
