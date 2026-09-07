import { describe, it, vi } from 'vitest'
import Database from 'better-sqlite3-multiple-ciphers'
import {
  ExecutionJournalService,
  type ExecutionJournalCommitFailpoint
} from '@/tape/application/executionJournalService'
import { DeepChatExecutionJournalStore } from '@/tape/infrastructure/sqlite/tapeEntryStore'

const { closeSync, fsyncSync, openSync, writeSync } =
  await vi.importActual<typeof import('node:fs')>('node:fs')
const crashPoint = process.env.DEEPCHAT_EXECUTION_JOURNAL_CRASH_POINT
const databasePath = process.env.DEEPCHAT_EXECUTION_JOURNAL_CRASH_DB
const markerPath = process.env.DEEPCHAT_EXECUTION_JOURNAL_CRASH_MARKERS
const workerEnabled = Boolean(crashPoint && databasePath && markerPath)
const workerIt = workerEnabled ? it : it.skip

const SESSION_ID = 'crash-session'
const MESSAGE_ID = 'crash-message'
const RUN_ID = '11111111-1111-4111-8111-111111111111'
const OPERATION = { runId: RUN_ID, requestSeq: 1, providerToolCallId: 'call-1' }

function appendDurableMarker(marker: string): void {
  if (!markerPath) throw new Error('Missing crash marker path.')
  const descriptor = openSync(markerPath, 'a')
  try {
    writeSync(descriptor, `${marker}\n`)
    fsyncSync(descriptor)
  } finally {
    closeSync(descriptor)
  }
}

function holdAtCrashPoint(point: string): never {
  writeSync(1, `EXECUTION_JOURNAL_FAILPOINT:${point}\n`)
  const barrier = new Int32Array(new SharedArrayBuffer(4))
  Atomics.wait(barrier, 0, 0)
  throw new Error('Execution Journal crash failpoint unexpectedly resumed.')
}

describe('Execution Journal crash worker', () => {
  workerIt(
    'holds a native SQLite writer at the requested commit boundary',
    () => {
      if (!crashPoint || !databasePath) {
        throw new Error('Execution Journal crash worker configuration is incomplete.')
      }
      const database = new Database(databasePath)
      database.pragma('journal_mode = WAL')
      database.pragma('synchronous = FULL')
      const table = new DeepChatExecutionJournalStore(database)
      table.createTable()
      const failpoint: ExecutionJournalCommitFailpoint = {
        reach: ({ eventName, phase }) => {
          const point = `${eventName}:${phase}`
          if (point === crashPoint) holdAtCrashPoint(point)
        }
      }
      const journal = new ExecutionJournalService(() => table, failpoint)

      journal.commitRunStarted({
        sessionId: SESSION_ID,
        runId: RUN_ID,
        messageId: MESSAGE_ID,
        runKind: 'loop'
      })
      journal.commitDispatch({
        sessionId: SESSION_ID,
        messageId: MESSAGE_ID,
        operation: OPERATION,
        toolName: 'write_file',
        toolSource: 'agent',
        normalizedArguments: { path: 'a.txt' },
        target: { serverName: 'agent-filesystem', originalName: 'write_file' }
      })
      appendDurableMarker('target')
      journal.commitToolOutcome({
        sessionId: SESSION_ID,
        messageId: MESSAGE_ID,
        operation: OPERATION,
        responseText: 'done',
        isError: false
      })
      appendDurableMarker('outcome_projection')
      journal.commitRunTerminal({
        sessionId: SESSION_ID,
        runId: RUN_ID,
        messageId: MESSAGE_ID,
        outcome: 'completed',
        stopReason: 'complete'
      })
      appendDurableMarker('terminal_projection')

      throw new Error(`Crash point was not reached: ${crashPoint}`)
    },
    60_000
  )
})
