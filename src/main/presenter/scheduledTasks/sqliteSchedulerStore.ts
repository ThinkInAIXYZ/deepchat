import { randomUUID } from 'node:crypto'
import type Database from 'better-sqlite3-multiple-ciphers'
import {
  SCHEDULED_TASKS_VERSION,
  type ScheduledTask,
  type ScheduledTaskAction,
  type ScheduledTaskRun,
  type ScheduledTaskRunReason,
  type ScheduledTaskRunStatus,
  type ScheduledTaskTrigger,
  createDefaultScheduledTaskContext,
  createDefaultScheduledTaskDelivery,
  createDefaultScheduledTaskExecution
} from '@shared/scheduledTasks'
import type { ScheduledTaskRow } from '../sqlitePresenter/tables/scheduledTasks'
import type { ScheduledTaskRunRow } from '../sqlitePresenter/tables/scheduledTaskRuns'
import { computeNextRunAt } from './schedulerCore/computeNextRunAt'
import type { SchedulerStore } from './schedulerStore'

const MIGRATION_ID = 'scheduled-tasks-sqlite-v2'
const DEFAULT_RUN_LIST_LIMIT = 20

export class SQLiteSchedulerStore implements SchedulerStore {
  constructor(private readonly db: Database.Database) {
    this.ensureMigrationTable()
  }

  hasMigrationApplied(): boolean {
    const row = this.db.prepare('SELECT 1 FROM config_migrations WHERE id = ?').get(MIGRATION_ID)
    return Boolean(row)
  }

  markMigrationApplied(): void {
    this.db
      .prepare(
        `INSERT INTO config_migrations (id, applied_at)
         VALUES (?, ?)
         ON CONFLICT(id) DO UPDATE SET applied_at = excluded.applied_at`
      )
      .run(MIGRATION_ID, Date.now())
  }

  migrateTasks(tasks: ScheduledTask[]): void {
    if (this.hasMigrationApplied()) {
      return
    }

    this.db.transaction(() => {
      for (const task of tasks) {
        this.upsertTask(task)
      }
      this.markMigrationApplied()
    })()
  }

  countEnabledTasks(): number {
    const row = this.db
      .prepare('SELECT COUNT(*) AS count FROM scheduled_tasks WHERE enabled = 1')
      .get() as { count: number } | undefined
    return row?.count ?? 0
  }

  listEnabledTasks(): ScheduledTask[] {
    return this.rowsToTasks(
      this.db
        .prepare('SELECT * FROM scheduled_tasks WHERE enabled = 1 ORDER BY next_run_at ASC, id ASC')
        .all() as ScheduledTaskRow[]
    )
  }

  listTasks(): ScheduledTask[] {
    return this.rowsToTasks(
      this.db
        .prepare('SELECT * FROM scheduled_tasks ORDER BY created_at ASC, id ASC')
        .all() as ScheduledTaskRow[]
    )
  }

  getNearestNextRunAt(): number | null {
    const row = this.db
      .prepare(
        `SELECT next_run_at
         FROM scheduled_tasks
         WHERE enabled = 1 AND next_run_at IS NOT NULL
         ORDER BY next_run_at ASC
         LIMIT 1`
      )
      .get() as { next_run_at: number | null } | undefined
    return row?.next_run_at ?? null
  }

  listDueTasks(now: number): ScheduledTask[] {
    return this.rowsToTasks(
      this.db
        .prepare(
          `SELECT *
           FROM scheduled_tasks
           WHERE enabled = 1
             AND next_run_at IS NOT NULL
             AND next_run_at <= ?
           ORDER BY next_run_at ASC, id ASC`
        )
        .all(now) as ScheduledTaskRow[]
    )
  }

  getTask(taskId: string): ScheduledTask | null {
    const row = this.getTaskRow(taskId)
    return row ? this.rowToTask(row) : null
  }

  upsertTask(task: ScheduledTask): void {
    this.db
      .prepare(
        `INSERT INTO scheduled_tasks (
          id,
          version,
          name,
          enabled,
          trigger_json,
          action_json,
          context_json,
          execution_json,
          delivery_json,
          timezone,
          next_run_at,
          last_run_id,
          last_fired_at,
          created_at,
          updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET
          version = excluded.version,
          name = excluded.name,
          enabled = excluded.enabled,
          trigger_json = excluded.trigger_json,
          action_json = excluded.action_json,
          context_json = excluded.context_json,
          execution_json = excluded.execution_json,
          delivery_json = excluded.delivery_json,
          timezone = excluded.timezone,
          next_run_at = excluded.next_run_at,
          last_run_id = excluded.last_run_id,
          last_fired_at = excluded.last_fired_at,
          updated_at = excluded.updated_at`
      )
      .run(
        task.id,
        task.version,
        task.name,
        task.enabled ? 1 : 0,
        JSON.stringify(task.trigger),
        JSON.stringify(task.action),
        JSON.stringify(task.context),
        JSON.stringify(task.execution),
        JSON.stringify(task.delivery),
        task.timezone,
        task.nextRunAt,
        task.lastRunId,
        task.lastFiredAt,
        task.createdAt,
        task.updatedAt
      )
  }

  deleteTask(taskId: string): void {
    this.db.transaction(() => {
      this.db.prepare('DELETE FROM scheduled_task_locks WHERE task_id = ?').run(taskId)
      this.db.prepare('DELETE FROM scheduled_tasks WHERE id = ?').run(taskId)
    })()
  }

  createManualRun(taskId: string, now: number, owner: string): ScheduledTaskRun {
    return this.db.transaction(() => {
      const task = this.getTask(taskId)
      if (!task) {
        throw new Error(`Unknown scheduled task: ${taskId}`)
      }

      const run = this.insertRun({
        taskId,
        scheduledAt: now,
        queuedAt: now,
        status: 'queued',
        reason: 'run_now',
        owner
      })
      const nextTask = this.taskAfterRun(task, now, run.id)
      this.upsertTask(nextTask)
      return run
    })()
  }

  createQueuedRunWithLock(input: {
    task: ScheduledTask
    scheduledAt: number
    reason: ScheduledTaskRunReason
    owner: string
    now: number
  }): ScheduledTaskRun | null {
    return this.db.transaction(() => {
      const task = this.getTask(input.task.id)
      if (!task?.enabled || task.nextRunAt === null || task.nextRunAt > input.now) {
        return null
      }

      const runId = randomUUID()
      const lockResult = this.db
        .prepare(
          `INSERT OR IGNORE INTO scheduled_task_locks (task_id, run_id, locked_at, owner)
           VALUES (?, ?, ?, ?)`
        )
        .run(task.id, runId, input.now, input.owner)
      if (lockResult.changes === 0) {
        return null
      }

      if (task.execution.concurrencyPolicy === 'skip' && this.hasActiveRun(task.id)) {
        const run = this.insertRun({
          id: runId,
          taskId: task.id,
          scheduledAt: task.nextRunAt,
          queuedAt: input.now,
          status: 'queued',
          reason: input.reason,
          owner: input.owner
        })
        this.markRunSkipped(run.id, input.now, 'Skipped because a previous run is still active.')
        this.upsertTask(this.taskAfterRun(task, input.now, run.id))
        this.db
          .prepare('DELETE FROM scheduled_task_locks WHERE task_id = ? AND run_id = ?')
          .run(task.id, run.id)
        return null
      }

      const run = this.insertRun({
        id: runId,
        taskId: task.id,
        scheduledAt: task.nextRunAt,
        queuedAt: input.now,
        status: 'queued',
        reason: input.reason,
        owner: input.owner
      })
      this.upsertTask(this.taskAfterRun(task, input.now, run.id))
      this.db
        .prepare('DELETE FROM scheduled_task_locks WHERE task_id = ? AND run_id = ?')
        .run(task.id, run.id)
      return run
    })()
  }

  markRunRunning(runId: string, startedAt: number): boolean {
    const result = this.db
      .prepare(
        `UPDATE scheduled_task_runs
         SET status = 'running',
             started_at = ?,
             updated_at = ?
         WHERE id = ? AND status = 'queued'`
      )
      .run(startedAt, startedAt, runId)
    return result.changes > 0
  }

  markRunSuccess(input: {
    runId: string
    completedAt: number
    sessionId?: string
    tapeId?: string
    outputMessageId?: string
    outputPreview?: string
  }): void {
    this.db
      .prepare(
        `UPDATE scheduled_task_runs
         SET status = 'success',
             completed_at = ?,
             session_id = ?,
             tape_id = ?,
             output_message_id = ?,
             output_preview = ?,
             error = NULL,
             updated_at = ?
         WHERE id = ?`
      )
      .run(
        input.completedAt,
        input.sessionId ?? null,
        input.tapeId ?? null,
        input.outputMessageId ?? null,
        input.outputPreview ?? null,
        input.completedAt,
        input.runId
      )
  }

  markRunFailed(input: { runId: string; completedAt: number; error: string }): void {
    this.db
      .prepare(
        `UPDATE scheduled_task_runs
         SET status = 'failed',
             completed_at = ?,
             error = ?,
             updated_at = ?
         WHERE id = ?`
      )
      .run(input.completedAt, input.error, input.completedAt, input.runId)
  }

  markRunCancelled(runId: string, completedAt: number): void {
    this.db
      .prepare(
        `UPDATE scheduled_task_runs
         SET status = 'cancelled',
             completed_at = ?,
             updated_at = ?
         WHERE id = ?`
      )
      .run(completedAt, completedAt, runId)
  }

  markRunSkipped(runId: string, completedAt: number, error?: string): void {
    this.db
      .prepare(
        `UPDATE scheduled_task_runs
         SET status = 'skipped',
             completed_at = ?,
             error = ?,
             updated_at = ?
         WHERE id = ?`
      )
      .run(completedAt, error ?? null, completedAt, runId)
  }

  recoverStaleRuns(input: { now: number; staleQueuedMs: number; staleRunningMs: number }): void {
    this.db.transaction(() => {
      const staleQueued = this.db
        .prepare(
          `SELECT *
           FROM scheduled_task_runs
           WHERE status = 'queued' AND queued_at <= ?`
        )
        .all(input.now - input.staleQueuedMs) as ScheduledTaskRunRow[]

      for (const row of staleQueued) {
        this.db
          .prepare(
            `UPDATE scheduled_task_runs
             SET status = 'skipped',
                 completed_at = ?,
                 error = ?,
                 updated_at = ?
             WHERE id = ? AND status = 'queued'`
          )
          .run(
            input.now,
            'Recovered stale queued run; requeued scheduled occurrence.',
            input.now,
            row.id
          )
        this.requeueTaskForStaleQueuedRun(row, input.now)
      }

      this.db
        .prepare(
          `UPDATE scheduled_task_runs
           SET status = 'failed',
               completed_at = ?,
               error = ?,
               updated_at = ?
           WHERE status = 'running' AND started_at IS NOT NULL AND started_at <= ?`
        )
        .run(
          input.now,
          'Recovered stale running run after scheduler restart.',
          input.now,
          input.now - input.staleRunningMs
        )
    })()
  }

  listRuns(taskId: string, limit = DEFAULT_RUN_LIST_LIMIT): ScheduledTaskRun[] {
    const safeLimit = Math.min(Math.max(Math.trunc(limit), 1), 100)
    return (
      this.db
        .prepare(
          `SELECT *
         FROM scheduled_task_runs
         WHERE task_id = ?
         ORDER BY created_at DESC, id DESC
         LIMIT ?`
        )
        .all(taskId, safeLimit) as ScheduledTaskRunRow[]
    ).map((row) => this.rowToRun(row))
  }

  private ensureMigrationTable(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS config_migrations (
        id TEXT PRIMARY KEY,
        applied_at INTEGER NOT NULL
      );
    `)
  }

  private getTaskRow(taskId: string): ScheduledTaskRow | null {
    return (
      (this.db.prepare('SELECT * FROM scheduled_tasks WHERE id = ?').get(taskId) as
        | ScheduledTaskRow
        | undefined) ?? null
    )
  }

  private rowsToTasks(rows: ScheduledTaskRow[]): ScheduledTask[] {
    return rows.map((row) => this.rowToTask(row))
  }

  private rowToTask(row: ScheduledTaskRow): ScheduledTask {
    return {
      id: row.id,
      version: SCHEDULED_TASKS_VERSION,
      name: row.name,
      enabled: row.enabled === 1,
      trigger: parseJson<ScheduledTaskTrigger>(row.trigger_json),
      action: parseJson<ScheduledTaskAction>(row.action_json),
      context: parseJson(row.context_json, createDefaultScheduledTaskContext()),
      execution: parseJson(row.execution_json, createDefaultScheduledTaskExecution()),
      delivery: parseJson(row.delivery_json, createDefaultScheduledTaskDelivery()),
      timezone: row.timezone,
      nextRunAt: row.next_run_at,
      lastRunId: row.last_run_id,
      lastFiredAt: row.last_fired_at,
      createdAt: row.created_at,
      updatedAt: row.updated_at
    }
  }

  private insertRun(input: {
    id?: string
    taskId: string
    scheduledAt: number
    queuedAt: number
    status: ScheduledTaskRunStatus
    reason: ScheduledTaskRunReason
    owner: string
  }): ScheduledTaskRun {
    const id = input.id ?? randomUUID()
    this.db
      .prepare(
        `INSERT INTO scheduled_task_runs (
          id,
          task_id,
          scheduled_at,
          queued_at,
          started_at,
          completed_at,
          status,
          reason,
          owner,
          created_at,
          updated_at
        ) VALUES (?, ?, ?, ?, NULL, NULL, ?, ?, ?, ?, ?)`
      )
      .run(
        id,
        input.taskId,
        input.scheduledAt,
        input.queuedAt,
        input.status,
        input.reason,
        input.owner,
        input.queuedAt,
        input.queuedAt
      )

    return {
      id,
      taskId: input.taskId,
      scheduledAt: input.scheduledAt,
      queuedAt: input.queuedAt,
      startedAt: null,
      completedAt: null,
      status: input.status,
      reason: input.reason,
      owner: input.owner,
      createdAt: input.queuedAt,
      updatedAt: input.queuedAt
    }
  }

  private taskAfterRun(task: ScheduledTask, now: number, runId: string): ScheduledTask {
    const isOnce = task.trigger.kind === 'once'
    const nextTask: ScheduledTask = {
      ...task,
      enabled: isOnce ? false : task.enabled,
      nextRunAt: null,
      lastRunId: runId,
      lastFiredAt: now,
      updatedAt: now
    }
    return {
      ...nextTask,
      nextRunAt: computeNextRunAt({
        task: nextTask,
        referenceTime: now,
        afterRun: true
      })
    }
  }

  private requeueTaskForStaleQueuedRun(row: ScheduledTaskRunRow, now: number): void {
    const task = this.getTask(row.task_id)
    if (!task) {
      return
    }
    if (!task.enabled && task.trigger.kind !== 'once') {
      return
    }
    if (task.lastRunId !== row.id) {
      return
    }

    this.upsertTask({
      ...task,
      enabled: true,
      nextRunAt: row.scheduled_at,
      lastRunId: null,
      lastFiredAt: task.trigger.kind === 'once' ? null : task.lastFiredAt,
      updatedAt: now
    })
  }

  private rowToRun(row: ScheduledTaskRunRow): ScheduledTaskRun {
    return {
      id: row.id,
      taskId: row.task_id,
      scheduledAt: row.scheduled_at,
      queuedAt: row.queued_at,
      startedAt: row.started_at,
      completedAt: row.completed_at,
      status: row.status as ScheduledTaskRunStatus,
      reason: row.reason as ScheduledTaskRunReason,
      sessionId: row.session_id ?? undefined,
      tapeId: row.tape_id ?? undefined,
      outputMessageId: row.output_message_id ?? undefined,
      error: row.error ?? undefined,
      outputPreview: row.output_preview ?? undefined,
      owner: row.owner ?? undefined,
      createdAt: row.created_at,
      updatedAt: row.updated_at
    }
  }

  private hasActiveRun(taskId: string): boolean {
    const row = this.db
      .prepare(
        `SELECT 1
         FROM scheduled_task_runs
         WHERE task_id = ? AND status IN ('queued', 'running')
         LIMIT 1`
      )
      .get(taskId)
    return Boolean(row)
  }
}

function parseJson<T>(raw: string | null, fallback?: T): T {
  if (!raw) {
    if (fallback !== undefined) {
      return fallback
    }
    throw new Error('Missing required JSON value')
  }
  try {
    return JSON.parse(raw) as T
  } catch {
    if (fallback !== undefined) {
      return fallback
    }
    throw new Error('Invalid required JSON value')
  }
}
