import { describe, expect, it, vi } from 'vitest'
import type { AssistantMessageBlock } from '@shared/types/agent-interface'
import { SessionTranscriptMutations } from '@/session/transcriptMutations'

const sqliteModule = await import('better-sqlite3-multiple-ciphers').catch(() => null)
const mainDatabaseModule = sqliteModule ? await import('@/data/mainDatabase') : null
const sessionDatabaseModule = sqliteModule ? await import('@/session/data/database') : null
const sessionTapeModule = sqliteModule ? await import('@/tape/application/sessionTape') : null
const transcriptModule = sqliteModule ? await import('@/session/data/transcript') : null
const sessionDataModule = sqliteModule ? await import('@/session/data') : null
const memoryDatabaseModule = sqliteModule ? await import('@/memory/data/database') : null

const Database = sqliteModule?.default
const MainDatabaseCtor = mainDatabaseModule?.MainDatabase!
const SessionDatabaseCtor = sessionDatabaseModule?.SessionDatabase!
const SessionTapeCtor = sessionTapeModule?.SessionTape!
const SessionTranscriptCtor = transcriptModule?.SessionTranscript!
const createSessionData = sessionDataModule?.createSessionData!
const MemoryDatabaseCtor = memoryDatabaseModule?.MemoryDatabase!

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
 * `tape-system.md` promises transcript message mutations and their Tape facts commit in one
 * transaction. These tests make the Tape writer fail on demand and assert the transcript rows
 * roll back with it instead of committing a message the Tape never saw.
 */
describeIfSqlite('SessionTranscript keeps transcript and Tape writes atomic', () => {
  it.each([false, true])(
    'clears transcript, queue and projections together or preserves all data (%s)',
    async (failReset) => {
      const connection = new MainDatabaseCtor(':memory:')
      try {
        const projection = new MemoryDatabaseCtor(connection).ingestionProjectionTable
        const data = createSessionData(connection, () => projection, {
          publishPendingInputsChanged: vi.fn(),
          publishMessagesChanged: vi.fn()
        })
        data.transcript.createUserMessage('s1', 1, userContent)
        data.pendingInputs.queuePendingInput('s1', { text: 'queued' })
        const messages = data.transcript.getMessages('s1')
        const incarnation = data.tapeStore.getTapeIncarnationId('s1')
        const head = data.tapeStore.getProjectionHead('s1')
        const runtime = {
          prepareClearMessages: vi.fn().mockResolvedValue(undefined),
          finishClearMessages: vi.fn()
        }
        const mutations = new SessionTranscriptMutations({
          transcript: data.transcript,
          clearTranscript: data.clearTranscript,
          runtime: runtime as never
        })
        if (failReset) {
          connection.getDatabase().exec(`
            CREATE TRIGGER reject_tape_reset BEFORE DELETE ON deepchat_tape_entries
            BEGIN SELECT RAISE(ABORT, 'Tape reset rejected'); END;
          `)
          await expect(mutations.clearMessages('s1')).rejects.toThrow('Tape reset rejected')
          expect(data.transcript.getMessages('s1')).toEqual(messages)
          expect(data.pendingInputs.listPendingInputs('s1')).toHaveLength(1)
          expect(data.tapeStore.getTapeIncarnationId('s1')).toBe(incarnation)
          expect(data.tapeStore.getProjectionHead('s1')).toEqual(head)
          expect(runtime.finishClearMessages).not.toHaveBeenCalled()
        } else {
          await mutations.clearMessages('s1')
          expect(data.transcript.getMessages('s1')).toEqual([])
          expect(data.pendingInputs.listPendingInputs('s1')).toEqual([])
          expect(data.tapeStore.getTapeIncarnationId('s1')).not.toBe(incarnation)
          expect(runtime.finishClearMessages).toHaveBeenCalledOnce()
        }
        expect(
          connection
            .getDatabase()
            .prepare('SELECT count(*) AS count FROM deepchat_memory_ingestion_projection')
            .get()
        ).toEqual({ count: failReset ? 1 : 0 })
      } finally {
        connection.close()
      }
    }
  )

  function createTranscript() {
    const connection = new MainDatabaseCtor(':memory:')
    const database = new SessionDatabaseCtor(connection)
    const tape = new SessionTapeCtor(database)
    let failTape = false
    const failing = <T extends (...args: never[]) => unknown>(method: T) =>
      ((...args: Parameters<T>) => {
        if (failTape) throw new Error('tape unavailable')
        return method(...args)
      }) as T
    const tapeFacts = {
      appendMessageRecord: failing(tape.appendMessageRecord.bind(tape)),
      appendMessageReplacement: failing(tape.appendMessageReplacement.bind(tape)),
      appendMessageRetraction: failing(tape.appendMessageRetraction.bind(tape)),
      appendCompactionModelCall: failing(tape.appendCompactionModelCall.bind(tape)),
      getProjectionHead: tape.getProjectionHead.bind(tape)
    }
    const transcript = new SessionTranscriptCtor(database, tapeFacts)
    return {
      connection,
      database,
      transcript,
      tapeFacts,
      setTapeFailing: (value: boolean) => {
        failTape = value
      }
    }
  }

  it('does not commit a user message whose Tape fact failed to append', () => {
    const { connection, database, transcript, setTapeFailing } = createTranscript()
    try {
      setTapeFailing(true)

      expect(() => transcript.createUserMessage('s1', 1, userContent)).toThrow('tape unavailable')

      expect(database.deepchatMessagesTable.getBySession('s1')).toEqual([])
      expect(
        database.getDatabase().prepare('SELECT count(*) AS c FROM deepchat_user_messages').get()
      ).toEqual({ c: 0 })
      expect(database.deepchatTapeEntriesTable.getBySession('s1')).toEqual([])
    } finally {
      connection.close()
    }
  })

  it('rolls retry truncation back when a later Tape retraction fails', () => {
    const { connection, database, transcript, tapeFacts } = createTranscript()
    try {
      const keptId = transcript.createUserMessage('s1', 1, userContent)
      transcript.createUserMessage('s1', 2, { ...userContent, text: 'second' })
      transcript.createUserMessage('s1', 3, { ...userContent, text: 'third' })
      const messages = transcript.getMessages('s1')
      const facts = database.deepchatTapeEntriesTable.getBySession('s1')
      const appendRetraction = tapeFacts.appendMessageRetraction
      let retractions = 0
      const fail = vi.spyOn(tapeFacts, 'appendMessageRetraction').mockImplementation((...args) => {
        if (++retractions === 2) throw new Error('Later retraction failed')
        return appendRetraction(...args)
      })
      const runtime = { invalidateTranscriptFrom: vi.fn() }
      const mutations = new SessionTranscriptMutations({
        transcript,
        runtime: runtime as never,
        clearTranscript: vi.fn()
      })
      expect(() => mutations.commitRetryMessage('s1', 2)).toThrow('Later retraction failed')
      expect(transcript.getMessages('s1')).toEqual(messages)
      expect(database.deepchatTapeEntriesTable.getBySession('s1')).toEqual(facts)
      expect(runtime.invalidateTranscriptFrom).not.toHaveBeenCalled()
      fail.mockRestore()
      mutations.commitRetryMessage('s1', 2)
      expect(transcript.getMessages('s1').map((message) => message.id)).toEqual([keptId])
      expect(runtime.invalidateTranscriptFrom).toHaveBeenCalledWith('s1', 2)
    } finally {
      connection.close()
    }
  })

  it('keeps the assistant message pending when its terminal Tape fact fails', () => {
    const { connection, database, transcript, setTapeFailing } = createTranscript()
    try {
      transcript.createUserMessage('s1', 1, userContent)
      const assistantId = transcript.createAssistantMessage('s1', 2)
      setTapeFailing(true)

      expect(() => transcript.finalizeAssistantMessage(assistantId, blocks, '{}')).toThrow(
        'tape unavailable'
      )
      expect(() => transcript.setMessageError(assistantId, blocks)).toThrow('tape unavailable')

      const row = database.deepchatMessagesTable.get(assistantId)
      expect(row).toMatchObject({ status: 'pending', content: '[]' })
      expect(database.deepchatAssistantBlocksTable.listByMessageIds([assistantId])).toEqual([])
      expect(
        database.deepchatTapeEntriesTable.getBySession('s1').filter((r) => r.kind === 'message')
      ).toHaveLength(1)

      setTapeFailing(false)
      transcript.finalizeAssistantMessage(assistantId, blocks, '{}')

      expect(database.deepchatMessagesTable.get(assistantId)?.status).toBe('sent')
      expect(
        database.deepchatTapeEntriesTable.getBySession('s1').filter((r) => r.kind === 'message')
      ).toHaveLength(2)
    } finally {
      connection.close()
    }
  })

  it('keeps the previous content when an edit cannot record its Tape replacement', () => {
    const { connection, database, transcript, setTapeFailing } = createTranscript()
    try {
      const userId = transcript.createUserMessage('s1', 1, userContent)
      const before = database.deepchatMessagesTable.get(userId)!
      setTapeFailing(true)

      expect(() =>
        transcript.updateMessageContent(userId, JSON.stringify({ ...userContent, text: 'edited' }))
      ).toThrow('tape unavailable')

      expect(database.deepchatMessagesTable.get(userId)).toEqual(before)
      expect(transcript.getMessage(userId)?.content).toContain('hello')
    } finally {
      connection.close()
    }
  })
})
