import { EventEmitter } from 'node:events'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import type { CronJobsSchedulerStatus } from '@shared/cronJobs'

const sqliteModule = await import('better-sqlite3-multiple-ciphers').catch(() => null)
const cronJobsTableModule = sqliteModule
  ? await import('@/presenter/sqlitePresenter/tables/cronJobs').catch(() => null)
  : null
const cronJobRunsTableModule = sqliteModule
  ? await import('@/presenter/sqlitePresenter/tables/cronJobRuns').catch(() => null)
  : null
const repositoryModule =
  sqliteModule && cronJobsTableModule && cronJobRunsTableModule
    ? await import('@/presenter/cronJobs/repository').catch(() => null)
    : null
const serviceModule = repositoryModule
  ? await import('@/presenter/cronJobs').catch(() => null)
  : null
const schedulerManagerModule = repositoryModule
  ? await import('@/presenter/cronJobs/schedulerProcessManager').catch(() => null)
  : null
const schedulerUtilityHostModule = repositoryModule
  ? await import('@/presenter/cronJobs/schedulerUtilityHost').catch(() => null)
  : null

const Database = sqliteModule?.default
const CronJobsTable = cronJobsTableModule?.CronJobsTable
const CronJobRunsTable = cronJobRunsTableModule?.CronJobRunsTable
const CronJobsRepository = repositoryModule?.CronJobsRepository
const CronJobsService = serviceModule?.CronJobsService
const SchedulerProcessManager = schedulerManagerModule?.SchedulerProcessManager
const CronJobsSchedulerUtilityHost = schedulerUtilityHostModule?.CronJobsSchedulerUtilityHost
const DatabaseCtor = Database!
const CronJobsTableCtor = CronJobsTable!
const CronJobRunsTableCtor = CronJobRunsTable!
const CronJobsRepositoryCtor = CronJobsRepository!
const CronJobsServiceCtor = CronJobsService!
const SchedulerProcessManagerCtor = SchedulerProcessManager!
const CronJobsSchedulerUtilityHostCtor = CronJobsSchedulerUtilityHost!

let sqliteAvailable = false
if (Database) {
  try {
    const smokeDb = new Database(':memory:')
    smokeDb.close()
    sqliteAvailable = true
  } catch {
    sqliteAvailable = false
  }
}

const describeIfSqlite =
  sqliteAvailable &&
  CronJobsTable &&
  CronJobRunsTable &&
  CronJobsRepository &&
  CronJobsService &&
  SchedulerProcessManager &&
  CronJobsSchedulerUtilityHost
    ? describe
    : describe.skip

const createHarness = () => {
  const db = new DatabaseCtor(':memory:')
  const cronJobsTable = new CronJobsTableCtor(db)
  const cronJobRunsTable = new CronJobRunsTableCtor(db)
  cronJobsTable.createTable()
  cronJobRunsTable.createTable()

  const sqlitePresenter = {
    cronJobsTable,
    cronJobRunsTable,
    getDatabase: () => db,
    getDatabasePath: () => ':memory:',
    getDatabasePassword: () => undefined
  }

  return { db, sqlitePresenter }
}

const baseStatus = (): CronJobsSchedulerStatus => ({
  state: 'idle',
  pid: null,
  enabledJobCount: 0,
  nextRunAt: null,
  lastHeartbeatAt: null,
  lastError: null,
  restartAttempts: 0,
  updatedAt: 1
})

describeIfSqlite('Cron Jobs persistence and service', () => {
  it('persists jobs, snapshots enabled rows, and cascades run deletion', () => {
    const { db, sqlitePresenter } = createHarness()
    try {
      const repository = new CronJobsRepositoryCtor(sqlitePresenter as never)
      const nextRunAt = 1_800_000_000_000
      const job = repository.upsertJob({
        name: 'Daily sync',
        enabled: false,
        cronExpr: '0 9 * * *',
        timezone: 'UTC',
        agentId: null,
        nextRunAt
      })

      expect(repository.listJobs()).toEqual([
        expect.objectContaining({
          id: job.id,
          name: 'Daily sync',
          enabled: false,
          nextRunAt
        })
      ])
      expect(repository.getSchedulerSnapshot()).toEqual({
        enabledJobCount: 0,
        nextRunAt: null
      })

      const enabled = repository.setJobEnabled(job.id, true)
      expect(enabled.enabled).toBe(true)
      expect(repository.getSchedulerSnapshot()).toEqual({
        enabledJobCount: 1,
        nextRunAt
      })

      const run = repository.queueRun({
        jobId: job.id,
        scheduledAt: nextRunAt,
        reason: 'scheduled'
      })
      repository.markRunRunning(run.id)
      const completed = repository.markRunCompleted(run.id)
      expect(completed.status).toBe('completed')
      expect(repository.listRunsByJob(job.id)).toHaveLength(1)

      repository.deleteJob(job.id)
      expect(repository.listJobs()).toHaveLength(0)
      expect(db.prepare('SELECT COUNT(*) AS count FROM cron_job_runs').get()).toEqual({
        count: 0
      })
    } finally {
      db.close()
    }
  })

  it('queues and completes manual runs through the service without starting a real process', async () => {
    const { db, sqlitePresenter } = createHarness()
    try {
      const status = baseStatus()
      const schedulerManager = {
        reconcile: vi.fn().mockResolvedValue(status),
        restart: vi.fn().mockResolvedValue(status),
        stop: vi.fn().mockResolvedValue(status),
        getStatus: vi.fn(() => status)
      }
      const service = new CronJobsServiceCtor({
        sqlitePresenter: sqlitePresenter as never,
        schedulerManager: schedulerManager as never
      })

      const { job } = await service.upsert({
        name: 'Manual smoke',
        enabled: true,
        cronExpr: '0 9 * * *',
        timezone: 'UTC',
        agentId: null,
        nextRunAt: null
      })
      const result = await service.runNow(job.id)

      expect(result.run).toEqual(
        expect.objectContaining({
          jobId: job.id,
          status: 'completed',
          reason: 'manual',
          error: null
        })
      )
      expect(schedulerManager.reconcile).toHaveBeenCalledWith('job-upsert')
      expect(schedulerManager.reconcile).toHaveBeenCalledWith('manual-run')
    } finally {
      db.close()
    }
  })

  it('queues each due scheduled run once and clears next_run_at in the utility host', () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'deepchat-cron-jobs-'))
    const dbPath = path.join(tempDir, 'agent.db')
    const db = new DatabaseCtor(dbPath)
    const events: unknown[] = []

    try {
      const cronJobsTable = new CronJobsTableCtor(db)
      const cronJobRunsTable = new CronJobRunsTableCtor(db)
      cronJobsTable.createTable()
      cronJobRunsTable.createTable()
      const job = cronJobsTable.upsert({
        name: 'Due job',
        enabled: true,
        cronExpr: '0 9 * * *',
        timezone: 'UTC',
        agentId: null,
        nextRunAt: 1,
        now: 1
      })

      const host = new CronJobsSchedulerUtilityHostCtor({
        dbPath,
        postMessage: (message) => events.push(message)
      })
      host.start()
      host.reconcile()
      host.shutdown()

      expect(events.filter((event) => (event as { type?: string }).type === 'RUN_DUE')).toEqual([
        expect.objectContaining({
          jobId: job.id,
          scheduledAt: 1,
          reason: 'scheduled'
        })
      ])
      expect(cronJobsTable.get(job.id)?.next_run_at).toBeNull()
      expect(db.prepare('SELECT COUNT(*) AS count FROM cron_job_runs').get()).toEqual({
        count: 1
      })
    } finally {
      db.close()
      fs.rmSync(tempDir, { recursive: true, force: true })
    }
  })

  it('starts the scheduler only for enabled jobs and stops after idle heartbeat', async () => {
    vi.useFakeTimers()
    try {
      class FakeHost extends EventEmitter {
        pid = 123
        killed = false
        posted: unknown[] = []

        postMessage(message: unknown): void {
          this.posted.push(message)
        }

        kill(): boolean {
          this.killed = true
          this.emit('exit', 0)
          return true
        }
      }

      let snapshot = {
        enabledJobCount: 0,
        nextRunAt: null as number | null
      }
      const host = new FakeHost()
      const spawnHost = vi.fn(async () => host)
      const manager = new SchedulerProcessManagerCtor({
        dbPath: ':memory:',
        getSnapshot: () => snapshot,
        onRunDue: vi.fn(),
        idleShutdownMs: 10,
        spawnHost: spawnHost as never
      })

      expect(await manager.reconcile('initial')).toEqual(
        expect.objectContaining({
          state: 'idle',
          enabledJobCount: 0
        })
      )
      expect(spawnHost).not.toHaveBeenCalled()

      snapshot = {
        enabledJobCount: 1,
        nextRunAt: 100
      }
      expect(await manager.reconcile('enabled')).toEqual(
        expect.objectContaining({
          state: 'running',
          pid: 123
        })
      )
      expect(host.posted).toEqual([
        expect.objectContaining({ type: 'START' }),
        expect.objectContaining({ type: 'RECONCILE', reason: 'enabled' })
      ])

      snapshot = {
        enabledJobCount: 0,
        nextRunAt: null
      }
      host.emit('message', {
        type: 'HEARTBEAT',
        enabledJobCount: 0,
        nextRunAt: null,
        now: 200
      })
      await vi.advanceTimersByTimeAsync(10)

      expect(host.killed).toBe(true)
      expect(manager.getStatus()).toEqual(
        expect.objectContaining({
          state: 'stopped',
          pid: null
        })
      )
    } finally {
      vi.useRealTimers()
    }
  })
})
