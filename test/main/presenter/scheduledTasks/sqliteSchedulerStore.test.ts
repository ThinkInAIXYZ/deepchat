import Database from 'better-sqlite3-multiple-ciphers'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  SCHEDULED_TASKS_VERSION,
  type ScheduledTask,
  type ScheduledTaskAction,
  type ScheduledTaskTrigger
} from '@shared/scheduledTasks'
import { ScheduledTaskLocksTable } from '@/presenter/sqlitePresenter/tables/scheduledTaskLocks'
import { ScheduledTaskRunsTable } from '@/presenter/sqlitePresenter/tables/scheduledTaskRuns'
import { ScheduledTasksTable } from '@/presenter/sqlitePresenter/tables/scheduledTasks'
import { SQLiteSchedulerStore } from '@/presenter/scheduledTasks/sqliteSchedulerStore'

let sqliteAvailable = false
try {
  const smokeDb = new Database(':memory:')
  smokeDb.close()
  sqliteAvailable = true
} catch {
  sqliteAvailable = false
}
const describeIfSqlite = sqliteAvailable ? describe : describe.skip

const createTask = (
  overrides: Partial<ScheduledTask> & {
    trigger?: ScheduledTaskTrigger
    action?: ScheduledTaskAction
  } = {}
): ScheduledTask => ({
  id: 'task-1',
  version: SCHEDULED_TASKS_VERSION,
  name: 'Task',
  enabled: true,
  trigger: { kind: 'daily', hour: 9, minute: 0 },
  action: { kind: 'notify', title: 'Title', body: 'Body' },
  timezone: 'UTC',
  nextRunAt: 1000,
  lastRunId: null,
  lastFiredAt: null,
  createdAt: 1,
  updatedAt: 1,
  ...overrides
})

describeIfSqlite('SQLiteSchedulerStore', () => {
  let db: Database.Database | null
  let store: SQLiteSchedulerStore

  beforeEach(() => {
    db = new Database(':memory:')
    new ScheduledTasksTable(db).createTable()
    new ScheduledTaskRunsTable(db).createTable()
    new ScheduledTaskLocksTable(db).createTable()
    store = new SQLiteSchedulerStore(db)
  })

  afterEach(() => {
    db?.close()
    db = null
  })

  it('creates one queued run and advances nextRunAt atomically', () => {
    const task = createTask({ nextRunAt: 1000 })
    store.upsertTask(task)

    const first = store.createQueuedRunWithLock({
      task,
      scheduledAt: 1000,
      reason: 'tick',
      owner: 'test',
      now: 1500
    })
    const second = store.createQueuedRunWithLock({
      task,
      scheduledAt: 1000,
      reason: 'tick',
      owner: 'test',
      now: 1500
    })

    expect(first?.status).toBe('queued')
    expect(second).toBeNull()
    expect(store.listRuns(task.id, 10)).toHaveLength(1)
    expect(store.getTask(task.id)?.lastRunId).toBe(first?.id)
    expect(store.getTask(task.id)?.nextRunAt).toBeGreaterThan(1500)
  })

  it('does not queue disabled or future tasks', () => {
    const disabled = createTask({ id: 'disabled', enabled: false, nextRunAt: null })
    const future = createTask({ id: 'future', nextRunAt: 5000 })
    store.upsertTask(disabled)
    store.upsertTask(future)

    expect(
      store.createQueuedRunWithLock({
        task: disabled,
        scheduledAt: 1000,
        reason: 'tick',
        owner: 'test',
        now: 1500
      })
    ).toBeNull()
    expect(
      store.createQueuedRunWithLock({
        task: future,
        scheduledAt: 5000,
        reason: 'tick',
        owner: 'test',
        now: 1500
      })
    ).toBeNull()
  })

  it('requeues stale queued one-shot runs after restart', () => {
    const task = createTask({
      trigger: { kind: 'once', firesAt: 1000 },
      nextRunAt: 1000
    })
    store.upsertTask(task)
    const stale = store.createQueuedRunWithLock({
      task,
      scheduledAt: 1000,
      reason: 'startup',
      owner: 'test',
      now: 1500
    })

    expect(store.getTask(task.id)?.enabled).toBe(false)
    store.recoverStaleRuns({
      now: 10_000,
      staleQueuedMs: 1000,
      staleRunningMs: 1000
    })

    const recoveredTask = store.getTask(task.id)
    expect(recoveredTask?.enabled).toBe(true)
    expect(recoveredTask?.nextRunAt).toBe(1000)
    expect(store.listRuns(task.id, 10)[0]?.id).toBe(stale?.id)
    expect(store.listRuns(task.id, 10)[0]?.status).toBe('skipped')
  })
})
