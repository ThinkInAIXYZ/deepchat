import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'
import os from 'node:os'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { DeepChatExecutionJournalStore } from '@/tape/infrastructure/sqlite/tapeEntryStore'
import {
  EXECUTION_JOURNAL_EVENT_NAMES,
  classifyExecutionJournalRows
} from '@/tape/domain/executionJournal'
import { nativeSqliteItIf, requireDatabase } from '../nativeSqliteHarness'

const fs = await vi.importActual<typeof import('node:fs')>('node:fs')
const path = await vi.importActual<typeof import('node:path')>('node:path')
const PROJECT_ROOT = path.resolve(import.meta.dirname, '../../..')
const VITEST_ENTRY = path.join(PROJECT_ROOT, 'node_modules/vitest/vitest.mjs')
const CRASH_WORKER = path.join(
  PROJECT_ROOT,
  'test/main/tape/fixtures/executionJournalCrashWorker.test.ts'
)
const temporaryRoots = new Set<string>()
const itWithSigkill = process.platform === 'win32' ? it.skip : nativeSqliteItIf()

type ChildExit = { code: number | null; signal: NodeJS.Signals | null }

type CrashExpectation = {
  point: string
  classification: 'not_dispatched' | 'completed' | 'indeterminate'
  dispatchCount: number
  outcomeCount: number
  terminalOutcome: 'completed' | null
  markers: string[]
}

const CRASH_EXPECTATIONS: CrashExpectation[] = [
  {
    point: 'execution/dispatch_committed:before',
    classification: 'not_dispatched',
    dispatchCount: 0,
    outcomeCount: 0,
    terminalOutcome: null,
    markers: []
  },
  {
    point: 'execution/dispatch_committed:after',
    classification: 'indeterminate',
    dispatchCount: 1,
    outcomeCount: 0,
    terminalOutcome: null,
    markers: []
  },
  {
    point: 'execution/tool_outcome:before',
    classification: 'indeterminate',
    dispatchCount: 1,
    outcomeCount: 0,
    terminalOutcome: null,
    markers: ['target']
  },
  {
    point: 'execution/tool_outcome:after',
    classification: 'completed',
    dispatchCount: 1,
    outcomeCount: 1,
    terminalOutcome: null,
    markers: ['target']
  },
  {
    point: 'execution/run_terminal:before',
    classification: 'completed',
    dispatchCount: 1,
    outcomeCount: 1,
    terminalOutcome: null,
    markers: ['target', 'outcome_projection']
  },
  {
    point: 'execution/run_terminal:after',
    classification: 'completed',
    dispatchCount: 1,
    outcomeCount: 1,
    terminalOutcome: 'completed',
    markers: ['target', 'outcome_projection']
  }
]

function createCrashPaths(): { root: string; databasePath: string; markerPath: string } {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'deepchat-execution-journal-crash-'))
  temporaryRoots.add(root)
  return {
    root,
    databasePath: path.join(root, 'journal.db'),
    markerPath: path.join(root, 'markers.log')
  }
}

async function waitForFailpoint(
  child: ChildProcessWithoutNullStreams,
  point: string
): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    let stdout = ''
    let stderr = ''
    const timeout = setTimeout(() => {
      reject(new Error(`Timed out waiting for ${point}. stdout=${stdout} stderr=${stderr}`))
    }, 15_000)
    const cleanup = () => {
      clearTimeout(timeout)
      child.stdout.off('data', onStdout)
      child.stderr.off('data', onStderr)
      child.off('error', onError)
      child.off('exit', onExit)
    }
    const onStdout = (chunk: Buffer | string) => {
      stdout += String(chunk)
      if (!stdout.includes(`EXECUTION_JOURNAL_FAILPOINT:${point}\n`)) return
      cleanup()
      resolve()
    }
    const onStderr = (chunk: Buffer | string) => {
      stderr += String(chunk)
    }
    const onError = (error: Error) => {
      cleanup()
      reject(error)
    }
    const onExit = (code: number | null, signal: NodeJS.Signals | null) => {
      cleanup()
      reject(
        new Error(
          `Crash worker exited before ${point}: code=${String(code)} signal=${String(signal)} stderr=${stderr}`
        )
      )
    }
    child.stdout.on('data', onStdout)
    child.stderr.on('data', onStderr)
    child.once('error', onError)
    child.once('exit', onExit)
  })
}

async function killAndWait(child: ChildProcessWithoutNullStreams): Promise<ChildExit | null> {
  if (child.pid === undefined) return null
  if (child.exitCode !== null || child.signalCode !== null) {
    return { code: child.exitCode, signal: child.signalCode }
  }
  const exited = new Promise<ChildExit>((resolve) =>
    child.once('exit', (code, signal) => resolve({ code, signal }))
  )
  if (!child.kill('SIGKILL')) {
    if (child.exitCode !== null || child.signalCode !== null) {
      return { code: child.exitCode, signal: child.signalCode }
    }
    throw new Error('Failed to terminate the Execution Journal crash worker.')
  }
  return exited
}

function readMarkers(markerPath: string): string[] {
  if (!fs.existsSync(markerPath)) return []
  return fs.readFileSync(markerPath, 'utf8').split('\n').filter(Boolean)
}

function classify(databasePath: string) {
  const Database = requireDatabase()
  const database = new Database(databasePath)
  try {
    const table = new DeepChatExecutionJournalStore(database)
    table.createTable()
    return classifyExecutionJournalRows(
      table
        .getBySession('crash-session')
        .filter((row) => EXECUTION_JOURNAL_EVENT_NAMES.some((name) => row.name === name))
    )
  } finally {
    database.close()
  }
}

afterEach(() => {
  for (const root of temporaryRoots) {
    fs.rmSync(root, { recursive: true, force: true })
  }
  temporaryRoots.clear()
})

describe('Execution Journal native crash recovery', () => {
  itWithSigkill.each(CRASH_EXPECTATIONS)(
    'preserves evidence at $point across a real SIGKILL',
    async (expected) => {
      const paths = createCrashPaths()
      const child = spawn(
        process.execPath,
        [
          VITEST_ENTRY,
          'run',
          CRASH_WORKER,
          '--project=main',
          '--pool=threads',
          '--maxWorkers=1',
          '--minWorkers=1',
          '--reporter=basic'
        ],
        {
          cwd: PROJECT_ROOT,
          env: {
            ...process.env,
            DEEPCHAT_EXECUTION_JOURNAL_CRASH_POINT: expected.point,
            DEEPCHAT_EXECUTION_JOURNAL_CRASH_DB: paths.databasePath,
            DEEPCHAT_EXECUTION_JOURNAL_CRASH_MARKERS: paths.markerPath
          },
          stdio: ['ignore', 'pipe', 'pipe']
        }
      )
      let reachedFailpoint = false
      try {
        await waitForFailpoint(child, expected.point)
        reachedFailpoint = true
      } finally {
        const exit = await killAndWait(child)
        if (reachedFailpoint) {
          expect(exit).toEqual({ code: null, signal: 'SIGKILL' })
        }
      }

      expect(classify(paths.databasePath)).toEqual([
        expect.objectContaining({
          sessionId: 'crash-session',
          runId: '11111111-1111-4111-8111-111111111111',
          messageId: 'crash-message',
          classification: expected.classification,
          dispatchCount: expected.dispatchCount,
          outcomeCount: expected.outcomeCount,
          terminalOutcome: expected.terminalOutcome,
          reasons: []
        })
      ])
      expect(readMarkers(paths.markerPath)).toEqual(expected.markers)
    },
    30_000
  )
})
