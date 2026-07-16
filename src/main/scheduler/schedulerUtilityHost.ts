import { randomUUID } from 'node:crypto'
import type Database from 'better-sqlite3-multiple-ciphers'
import { openSQLiteDatabase } from '@/data/databaseConnection'
import type {
  CronJobMisfirePolicy,
  CronJobRunReason,
  SchedulerCommand,
  SchedulerEvent
} from '@shared/cronJobs'
import { CronExpressionService } from './cronExpressionService'

const SCHEDULER_HOST_ARG = '--deepchat-cron-scheduler-host'
const HEARTBEAT_INTERVAL_MS = 5_000
const MAX_SCAN_DELAY_MS = 30_000
const DUE_SCAN_LIMIT = 100

type ParentPort = {
  postMessage(message: unknown): void
  on(event: 'message', listener: (message: unknown) => void): void
  start?(): void
}

type ParentPortMessageEvent = {
  data?: unknown
}

interface DueCronJobRow {
  id: string
  cron_expr: string
  timezone: string
  next_run_at: number
  misfire_policy: CronJobMisfirePolicy
  max_catch_up_runs: number | null
}

interface SchedulerSnapshot {
  enabledJobCount: number
  nextRunAt: number | null
}

function getParentPort(): ParentPort | null {
  const maybeProcess = process as NodeJS.Process & {
    parentPort?: ParentPort
  }
  return maybeProcess.parentPort ?? null
}

function isSchedulerHostRequest(): boolean {
  return (
    process.env.DEEPCHAT_CRON_SCHEDULER_HOST === '1' || process.argv.includes(SCHEDULER_HOST_ARG)
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
  if (!message || typeof message !== 'object') {
    return false
  }

  const type = (message as { type?: unknown }).type
  return type === 'START' || type === 'RECONCILE' || type === 'RUN_NOW' || type === 'STOP'
}

function serializeError(error: unknown): { message: string; stack?: string } {
  if (error instanceof Error) {
    return {
      message: error.message,
      stack: error.stack
    }
  }
  return { message: String(error) }
}

export class CronJobsSchedulerUtilityHost {
  private db: Database.Database | null = null
  private heartbeatTimer: NodeJS.Timeout | null = null
  private scanTimer: NodeJS.Timeout | null = null
  private shuttingDown = false
  private readonly scheduleService = new CronExpressionService()

  constructor(
    private readonly options: {
      dbPath: string
      dbPassword?: string
      postMessage: (message: SchedulerEvent) => void
    }
  ) {}

  start(): void {
    if (this.shuttingDown) {
      return
    }
    try {
      this.openDatabase()
      this.send({
        type: 'READY',
        pid: process.pid || null,
        now: Date.now()
      })
      this.startHeartbeat()
      this.scanDueRuns()
    } catch (error) {
      this.reportError(error)
    }
  }

  reconcile(): void {
    try {
      this.openDatabase()
      this.scanDueRuns()
    } catch (error) {
      this.reportError(error)
    }
  }

  runNow(jobId: string, now = Date.now()): void {
    try {
      this.openDatabase()
      const db = this.requireDatabase()
      const job = db.prepare('SELECT id FROM cron_jobs WHERE id = ?').get(jobId) as
        | { id: string }
        | undefined
      if (!job) {
        return
      }

      const run = this.queueRun(job.id, now, 'manual')
      if (!run) {
        return
      }
      this.send({
        type: 'RUN_DUE',
        jobId: job.id,
        runId: run.runId,
        scheduledAt: now,
        reason: 'manual',
        now: Date.now()
      })
      this.scheduleNextScan()
    } catch (error) {
      this.reportError(error)
    }
  }

  shutdown(): void {
    this.shuttingDown = true
    this.clearHeartbeat()
    this.clearScanTimer()
    if (this.db) {
      try {
        this.db.close()
      } catch {}
      this.db = null
    }
  }

  private openDatabase(): void {
    if (this.db) {
      return
    }
    this.db = openSQLiteDatabase(this.options.dbPath, this.options.dbPassword)
  }

  private requireDatabase(): Database.Database {
    if (!this.db) {
      throw new Error('Cron scheduler database is not open.')
    }
    return this.db
  }

  private startHeartbeat(): void {
    this.clearHeartbeat()
    this.sendHeartbeat()
    this.heartbeatTimer = setInterval(() => {
      this.sendHeartbeat()
    }, HEARTBEAT_INTERVAL_MS)
  }

  private clearHeartbeat(): void {
    if (!this.heartbeatTimer) {
      return
    }
    clearInterval(this.heartbeatTimer)
    this.heartbeatTimer = null
  }

  private scanDueRuns(): void {
    if (this.shuttingDown) {
      return
    }

    try {
      const db = this.requireDatabase()
      const now = Date.now()
      const dueRows = db
        .prepare(
          `SELECT id,
                  cron_expr,
                  timezone,
                  next_run_at,
                  misfire_policy,
                  max_catch_up_runs
           FROM cron_jobs
           WHERE enabled = 1
             AND status = 'ready'
             AND agent_id IS NOT NULL
             AND task_prompt != ''
             AND next_run_at IS NOT NULL
             AND next_run_at <= ?
           ORDER BY next_run_at ASC, id ASC
           LIMIT ?`
        )
        .all(now, DUE_SCAN_LIMIT) as DueCronJobRow[]

      const dueEvents = db.transaction((rows: DueCronJobRow[]) =>
        rows.flatMap((row) => {
          const reconciliation = this.scheduleService.reconcileDueRun(
            {
              cronExpr: row.cron_expr,
              timezone: row.timezone,
              misfirePolicy: row.misfire_policy,
              maxCatchUpRuns: row.max_catch_up_runs
            },
            row.next_run_at,
            now
          )

          if (reconciliation.error) {
            db.prepare(
              `UPDATE cron_jobs
               SET next_run_at = NULL,
                   schedule_error = ?,
                   updated_at = ?
               WHERE id = ?`
            ).run(reconciliation.error, now, row.id)
            return []
          }

          const events = reconciliation.scheduledAts.flatMap((scheduledAt) => {
            const run = this.queueRun(row.id, scheduledAt, 'scheduled', true)
            return run
              ? [
                  {
                    type: 'RUN_DUE' as const,
                    jobId: row.id,
                    runId: run.runId,
                    scheduledAt,
                    reason: 'scheduled' as const,
                    now: Date.now()
                  }
                ]
              : []
          })

          db.prepare(
            `UPDATE cron_jobs
             SET next_run_at = ?,
                 schedule_error = NULL,
                 updated_at = ?
             WHERE id = ?
               AND next_run_at = ?`
          ).run(reconciliation.nextRunAt, now, row.id, row.next_run_at)

          return events
        })
      )(dueRows)

      for (const event of dueEvents) {
        this.send(event)
      }
      this.sendHeartbeat()
    } catch (error) {
      this.reportError(error)
    } finally {
      this.scheduleNextScan()
    }
  }

  private queueRun(
    jobId: string,
    scheduledAt: number,
    reason: CronJobRunReason,
    ignoreDuplicate = false
  ): { runId: string } | null {
    const db = this.requireDatabase()
    const now = Date.now()
    const runId = randomUUID()
    const statement = ignoreDuplicate
      ? `INSERT OR IGNORE INTO cron_job_runs (
           id,
           job_id,
           scheduled_at,
           queued_at,
           started_at,
           completed_at,
           status,
           reason,
           error,
           created_at,
           updated_at
         )
         VALUES (?, ?, ?, ?, NULL, NULL, 'queued', ?, NULL, ?, ?)`
      : `INSERT INTO cron_job_runs (
           id,
           job_id,
           scheduled_at,
           queued_at,
           started_at,
           completed_at,
           status,
           reason,
           error,
           created_at,
           updated_at
         )
         VALUES (?, ?, ?, ?, NULL, NULL, 'queued', ?, NULL, ?, ?)`

    const result = db.prepare(statement).run(runId, jobId, scheduledAt, now, reason, now, now)

    return result.changes > 0 ? { runId } : null
  }

  private scheduleNextScan(): void {
    if (this.shuttingDown) {
      return
    }

    this.clearScanTimer()
    const snapshot = this.readSnapshot()
    if (snapshot.enabledJobCount === 0) {
      this.send({
        type: 'IDLE',
        enabledJobCount: snapshot.enabledJobCount,
        nextRunAt: snapshot.nextRunAt,
        now: Date.now()
      })
      return
    }

    const delay =
      snapshot.nextRunAt === null
        ? MAX_SCAN_DELAY_MS
        : Math.min(Math.max(snapshot.nextRunAt - Date.now(), 0), MAX_SCAN_DELAY_MS)
    this.scanTimer = setTimeout(() => {
      this.scanTimer = null
      this.scanDueRuns()
    }, delay)
  }

  private clearScanTimer(): void {
    if (!this.scanTimer) {
      return
    }
    clearTimeout(this.scanTimer)
    this.scanTimer = null
  }

  private sendHeartbeat(): void {
    try {
      const snapshot = this.readSnapshot()
      this.send({
        type: 'HEARTBEAT',
        enabledJobCount: snapshot.enabledJobCount,
        nextRunAt: snapshot.nextRunAt,
        now: Date.now()
      })
    } catch (error) {
      this.reportError(error)
    }
  }

  private readSnapshot(): SchedulerSnapshot {
    const db = this.requireDatabase()
    const countRow = db
      .prepare('SELECT COUNT(*) AS count FROM cron_jobs WHERE enabled = 1')
      .get() as { count: number } | undefined
    const nextRow = db
      .prepare(
        `SELECT MIN(next_run_at) AS next_run_at
         FROM cron_jobs
         WHERE enabled = 1
           AND next_run_at IS NOT NULL`
      )
      .get() as { next_run_at: number | null } | undefined

    return {
      enabledJobCount: countRow?.count ?? 0,
      nextRunAt: nextRow?.next_run_at ?? null
    }
  }

  private send(message: SchedulerEvent): void {
    this.options.postMessage(message)
  }

  private reportError(error: unknown): void {
    const serialized = serializeError(error)
    this.send({
      type: 'ERROR',
      message: serialized.message,
      stack: serialized.stack,
      now: Date.now()
    })
  }
}

export function runSchedulerUtilityHostIfRequested(): boolean {
  if (!isSchedulerHostRequest()) {
    return false
  }

  const parentPort = getParentPort()
  if (!parentPort) {
    throw new Error('Cron scheduler utility host started without a parent port.')
  }

  const dbPath = process.env.DEEPCHAT_CRON_SCHEDULER_DB_PATH
  if (!dbPath) {
    throw new Error('Cron scheduler utility host started without a database path.')
  }

  const host = new CronJobsSchedulerUtilityHost({
    dbPath,
    dbPassword: process.env.DEEPCHAT_CRON_SCHEDULER_DB_PASSWORD,
    postMessage: (message) => parentPort.postMessage(message)
  })
  const keepAliveIntervalId = setInterval(() => {}, 2 ** 31 - 1)
  parentPort.start?.()

  parentPort.on('message', (message) => {
    const command = getParentPortMessagePayload(message)
    if (!isSchedulerCommand(command)) {
      return
    }

    switch (command.type) {
      case 'START':
        host.start()
        return
      case 'RECONCILE':
        host.reconcile()
        return
      case 'RUN_NOW':
        host.runNow(command.jobId, command.now)
        return
      case 'STOP':
        clearInterval(keepAliveIntervalId)
        host.shutdown()
        process.exit(0)
    }
  })

  process.once('beforeExit', () => {
    clearInterval(keepAliveIntervalId)
    host.shutdown()
  })

  return true
}
