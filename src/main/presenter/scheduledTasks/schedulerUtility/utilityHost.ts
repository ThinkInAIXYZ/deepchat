import fs from 'node:fs'
import path from 'node:path'
import Database from 'better-sqlite3-multiple-ciphers'
import { configureSQLiteConnection } from '../../sqlitePresenter/connectionConfig'
import { ScheduledTaskLocksTable } from '../../sqlitePresenter/tables/scheduledTaskLocks'
import { ScheduledTaskRunsTable } from '../../sqlitePresenter/tables/scheduledTaskRuns'
import { ScheduledTasksTable } from '../../sqlitePresenter/tables/scheduledTasks'
import { SQLiteSchedulerStore } from '../sqliteSchedulerStore'
import type { SchedulerCommand, SchedulerEvent } from '../schedulerProtocol'
import { SchedulerLoop } from '../schedulerCore/schedulerLoop'

const SCHEDULED_TASKS_HOST_ARG = '--deepchat-scheduled-tasks-host'

type ParentPort = {
  postMessage(message: unknown): void
  on(event: 'message', listener: (message: unknown) => void): void
  start?(): void
}

type ParentPortMessageEvent = {
  data?: unknown
}

function getParentPort(): ParentPort | null {
  const maybeProcess = process as NodeJS.Process & {
    parentPort?: ParentPort
  }
  return maybeProcess.parentPort ?? null
}

function isScheduledTasksHostRequest(): boolean {
  return (
    process.env.DEEPCHAT_SCHEDULED_TASKS_HOST === '1' ||
    process.argv.includes(SCHEDULED_TASKS_HOST_ARG)
  )
}

function getParentPortMessagePayload(message: unknown): unknown {
  if (isSchedulerCommand(message)) {
    return message
  }

  if (message && typeof message === 'object' && 'data' in message) {
    return (message as ParentPortMessageEvent).data
  }

  return message
}

function isSchedulerCommand(message: unknown): message is SchedulerCommand {
  return (
    Boolean(message) &&
    typeof message === 'object' &&
    typeof (message as SchedulerCommand).type === 'string'
  )
}

export function runScheduledTasksUtilityHostIfRequested(): boolean {
  if (!isScheduledTasksHostRequest()) {
    return false
  }

  const parentPort = getParentPort()
  if (!parentPort) {
    throw new Error('Scheduled tasks utility host started without a parent port.')
  }

  let db: Database.Database | null = null
  let loop: SchedulerLoop | null = null
  let owner = `scheduler-${process.pid}-${Date.now()}`
  const keepAliveIntervalId = setInterval(() => {}, 2 ** 31 - 1)
  const emit = (event: SchedulerEvent) => parentPort.postMessage(event)

  const close = () => {
    loop?.stop()
    loop = null
    if (db?.open) {
      db.close()
    }
    db = null
  }

  const start = (command: Extract<SchedulerCommand, { type: 'START' }>) => {
    close()
    owner = command.owner
    db = openSchedulerDatabase(command.dbPath, command.dbPassword)
    new ScheduledTasksTable(db).createTable()
    new ScheduledTaskRunsTable(db).createTable()
    new ScheduledTaskLocksTable(db).createTable()
    const store = new SQLiteSchedulerStore(db)
    loop = new SchedulerLoop(store, owner, emit)
    emit({ type: 'READY', pid: process.pid })
    loop.start()
  }

  parentPort.start?.()
  parentPort.on('message', (message) => {
    const command = getParentPortMessagePayload(message)
    if (!isSchedulerCommand(command)) {
      return
    }

    try {
      switch (command.type) {
        case 'START':
          start(command)
          return
        case 'STOP':
          close()
          return
        case 'RECONCILE':
          loop?.reconcile(command.reason)
          return
        case 'TASK_CHANGED':
          loop?.reconcile('task_changed')
          return
        case 'RUN_NOW': {
          if (!db) return
          const store = new SQLiteSchedulerStore(db)
          const run = store.createManualRun(command.taskId, Date.now(), owner)
          emit({ type: 'RUN_DUE', taskId: command.taskId, runId: run.id })
          return
        }
      }
    } catch (error) {
      emit({
        type: 'ERROR',
        error: error instanceof Error ? error.message : String(error),
        stack: error instanceof Error ? error.stack : undefined
      })
    }
  })

  process.once('beforeExit', () => {
    clearInterval(keepAliveIntervalId)
    close()
  })

  return true
}

function openSchedulerDatabase(dbPath: string, password?: string): Database.Database {
  const dbDir = path.dirname(dbPath)
  if (!fs.existsSync(dbDir)) {
    fs.mkdirSync(dbDir, { recursive: true })
  }
  const db = new Database(dbPath)
  configureSQLiteConnection(db, password)
  return db
}
