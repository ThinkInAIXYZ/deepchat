import { describe, expect, it } from 'vitest'
import type { AssistantMessageBlock } from '@shared/types/agent-interface'

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
 * `tape-system.md` promises transcript message mutations and their Tape facts commit in one
 * transaction. These tests make the Tape writer fail on demand and assert the transcript rows
 * roll back with it instead of committing a message the Tape never saw.
 */
describeIfSqlite('SessionTranscript keeps transcript and Tape writes atomic', () => {
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
      appendCompactionModelCall: failing(tape.appendCompactionModelCall.bind(tape))
    }
    const transcript = new SessionTranscriptCtor(database, tapeFacts)
    return {
      connection,
      database,
      transcript,
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
