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
const cronExpressionServiceModule = await import('@/presenter/cronJobs/cronExpressionService')
const internalSessionEventsModule =
  await import('@/presenter/agentRuntimePresenter/internalSessionEvents')

const Database = sqliteModule?.default
const CronJobsTable = cronJobsTableModule?.CronJobsTable
const CronJobRunsTable = cronJobRunsTableModule?.CronJobRunsTable
const CronJobsRepository = repositoryModule?.CronJobsRepository
const CronJobsService = serviceModule?.CronJobsService
const SchedulerProcessManager = schedulerManagerModule?.SchedulerProcessManager
const CronJobsSchedulerUtilityHost = schedulerUtilityHostModule?.CronJobsSchedulerUtilityHost
const CronExpressionService = cronExpressionServiceModule.CronExpressionService
const DatabaseCtor = Database!
const CronJobsTableCtor = CronJobsTable!
const CronJobRunsTableCtor = CronJobRunsTable!
const CronJobsRepositoryCtor = CronJobsRepository!
const CronJobsServiceCtor = CronJobsService!
const SchedulerProcessManagerCtor = SchedulerProcessManager!
const CronJobsSchedulerUtilityHostCtor = CronJobsSchedulerUtilityHost!
const emitDeepChatInternalSessionUpdate =
  internalSessionEventsModule.emitDeepChatInternalSessionUpdate

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

describe('CronExpressionService', () => {
  it('previews parser-backed cron expressions from a fixed clock', () => {
    const service = new CronExpressionService()
    const from = Date.parse('2026-07-03T00:00:00.000Z')

    expect(service.preview('*/5 * * * *', 'UTC', 5, from)).toEqual({
      runs: [
        Date.parse('2026-07-03T00:05:00.000Z'),
        Date.parse('2026-07-03T00:10:00.000Z'),
        Date.parse('2026-07-03T00:15:00.000Z'),
        Date.parse('2026-07-03T00:20:00.000Z'),
        Date.parse('2026-07-03T00:25:00.000Z')
      ],
      error: null
    })

    expect(service.preview('0 9 * * 1-5', 'UTC', 3, from).runs).toEqual([
      Date.parse('2026-07-03T09:00:00.000Z'),
      Date.parse('2026-07-06T09:00:00.000Z'),
      Date.parse('2026-07-07T09:00:00.000Z')
    ])
  })

  it('uses locked parser support for monthly last day, nth weekday, and timezones', () => {
    const service = new CronExpressionService()
    const from = Date.parse('2026-07-03T00:00:00.000Z')

    expect(service.preview('0 0 9 L * *', 'UTC', 2, from).runs).toEqual([
      Date.parse('2026-07-31T09:00:00.000Z'),
      Date.parse('2026-08-31T09:00:00.000Z')
    ])
    expect(service.preview('0 0 9 * * 1#1', 'UTC', 2, from).runs).toEqual([
      Date.parse('2026-07-06T09:00:00.000Z'),
      Date.parse('2026-08-03T09:00:00.000Z')
    ])
    expect(
      service.computeNextRunAt(
        { cronExpr: '0 9 * * *', timezone: 'Asia/Tokyo' },
        Date.parse('2026-07-02T23:59:00.000Z')
      )
    ).toBe(Date.parse('2026-07-03T00:00:00.000Z'))
    expect(
      service.preview('0 9 * * *', 'America/New_York', 3, Date.parse('2026-03-07T00:00:00.000Z'))
        .runs
    ).toEqual([
      Date.parse('2026-03-07T14:00:00.000Z'),
      Date.parse('2026-03-08T13:00:00.000Z'),
      Date.parse('2026-03-09T13:00:00.000Z')
    ])
  })

  it('reports invalid expressions and applies misfire policies', () => {
    const service = new CronExpressionService()
    const scheduledAt = Date.parse('2026-07-01T09:00:00.000Z')
    const now = Date.parse('2026-07-03T10:00:00.000Z')

    expect(service.validate('61 * * * *', 'UTC', now)).toEqual(
      expect.objectContaining({
        valid: false,
        nextRunAt: null
      })
    )
    expect(
      service.reconcileDueRun(
        { cronExpr: '0 9 * * *', timezone: 'UTC', misfirePolicy: 'skip' },
        scheduledAt,
        now
      )
    ).toEqual({
      scheduledAts: [],
      nextRunAt: Date.parse('2026-07-04T09:00:00.000Z'),
      error: null
    })
    expect(
      service.reconcileDueRun(
        {
          cronExpr: '0 9 * * *',
          timezone: 'UTC',
          misfirePolicy: 'run_once',
          maxCatchUpRuns: 2
        },
        scheduledAt,
        now
      )
    ).toEqual({
      scheduledAts: [
        Date.parse('2026-07-01T09:00:00.000Z'),
        Date.parse('2026-07-02T09:00:00.000Z')
      ],
      nextRunAt: Date.parse('2026-07-04T09:00:00.000Z'),
      error: null
    })
  })
})

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
  it('normalizes legacy rows without phase 2 schedule columns', () => {
    expect(
      repositoryModule!.toCronJob({
        id: 'job-1',
        name: 'Legacy job',
        enabled: 0,
        cron_expr: '0 9 * * *',
        timezone: 'UTC',
        agent_id: null,
        next_run_at: null,
        created_at: 1,
        updated_at: 1
      } as never)
    ).toEqual(
      expect.objectContaining({
        status: 'invalid_agent',
        misfirePolicy: 'skip',
        maxCatchUpRuns: null,
        scheduleError: null,
        taskPrompt: '',
        runtime: expect.objectContaining({
          maxTurns: 20,
          concurrencyPolicy: 'skip'
        })
      })
    )
  })

  it('persists jobs, snapshots enabled rows, and cascades run deletion', () => {
    const { db, sqlitePresenter } = createHarness()
    try {
      const repository = new CronJobsRepositoryCtor(sqlitePresenter as never)
      const nextRunAt = 1_800_000_000_000
      const job = repository.upsertJob({
        name: 'Daily sync',
        enabled: true,
        cronExpr: '0 9 * * *',
        timezone: 'UTC',
        agentId: 'agent-1',
        nextRunAt,
        taskPrompt: 'Sync reports'
      })

      expect(repository.listJobs()).toEqual([
        expect.objectContaining({
          id: job.id,
          name: 'Daily sync',
          enabled: true,
          agentId: 'agent-1',
          taskPrompt: 'Sync reports',
          nextRunAt
        })
      ])
      expect(repository.getSchedulerSnapshot()).toEqual({
        enabledJobCount: 1,
        nextRunAt
      })

      const run = repository.queueRun({
        jobId: job.id,
        scheduledAt: nextRunAt,
        reason: 'scheduled'
      })
      expect(run).toEqual(
        expect.objectContaining({
          sessionId: null,
          parentContinuationSessionId: null,
          outputMessageId: null,
          outputPreview: null,
          claimedAt: null,
          claimOwner: null
        })
      )
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

  it('rejects enabled jobs without an agent or task prompt', async () => {
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

      await expect(
        service.upsert({
          name: 'No agent',
          enabled: true,
          cronExpr: '0 9 * * *',
          timezone: 'UTC',
          agentId: null,
          taskPrompt: 'Summarize issues'
        })
      ).rejects.toThrow('Cron job requires an enabled agent.')

      await expect(
        service.upsert({
          name: 'No prompt',
          enabled: true,
          cronExpr: '0 9 * * *',
          timezone: 'UTC',
          agentId: 'agent-1',
          taskPrompt: ''
        })
      ).rejects.toThrow('Cron job task prompt is required.')
    } finally {
      db.close()
    }
  })

  it('captures snapshots and invalidates disabled agents during reconcile', async () => {
    const { db, sqlitePresenter } = createHarness()
    try {
      const status = baseStatus()
      const schedulerManager = {
        reconcile: vi.fn().mockResolvedValue(status),
        restart: vi.fn().mockResolvedValue(status),
        stop: vi.fn().mockResolvedValue(status),
        getStatus: vi.fn(() => status)
      }
      const agents = [
        {
          id: 'agent-1',
          name: 'Issue agent',
          type: 'deepchat' as const,
          enabled: true
        }
      ]
      const configPresenter = {
        listAgents: vi.fn(async () => agents),
        resolveDeepChatAgentConfig: vi.fn(async () => ({ systemPrompt: 'system' }))
      }
      const service = new CronJobsServiceCtor({
        sqlitePresenter: sqlitePresenter as never,
        schedulerManager: schedulerManager as never,
        configPresenter: configPresenter as never
      })

      const follow = await service.upsert({
        name: 'Follow job',
        enabled: true,
        cronExpr: '0 9 * * *',
        timezone: 'UTC',
        agentId: 'agent-1',
        taskPrompt: 'Summarize issues'
      })

      expect(follow.job.agentSnapshot).toBeNull()
      expect(configPresenter.resolveDeepChatAgentConfig).toHaveBeenCalledWith('agent-1')

      const { job } = await service.upsert({
        name: 'Snapshot job',
        enabled: true,
        cronExpr: '0 9 * * *',
        timezone: 'UTC',
        agentId: 'agent-1',
        taskPrompt: 'Summarize issues',
        modelPolicy: 'pin_current',
        toolPolicy: 'snapshot',
        permissionPolicy: 'snapshot'
      })

      expect(job.agentSnapshot).toEqual(
        expect.objectContaining({
          agent: expect.objectContaining({
            id: 'agent-1',
            name: 'Issue agent',
            type: 'deepchat'
          }),
          config: { systemPrompt: 'system' }
        })
      )

      agents[0].enabled = false
      const response = await service.list()

      expect(response.jobs.find((entry) => entry.id === job.id)).toEqual(
        expect.objectContaining({
          enabled: false,
          status: 'invalid_agent',
          nextRunAt: null
        })
      )
      expect(sqlitePresenter.cronJobsTable.countEnabled()).toBe(0)
      expect(schedulerManager.reconcile).toHaveBeenCalledWith('list')
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
        agentId: 'agent-1',
        taskPrompt: 'Summarize issues'
      })
      expect(job.nextRunAt).toEqual(expect.any(Number))
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

  it('creates a fresh session for manual runs when the executor is wired', async () => {
    const { db, sqlitePresenter } = createHarness()
    try {
      const status = baseStatus()
      const schedulerManager = {
        reconcile: vi.fn().mockResolvedValue(status),
        restart: vi.fn().mockResolvedValue(status),
        stop: vi.fn().mockResolvedValue(status),
        getStatus: vi.fn(() => status)
      }
      const runSessionStarter = {
        createSessionForRun: vi.fn(async ({ run }: { run: { id: string } }) => ({
          sessionId: `session-${run.id}`
        })),
        startSessionRun: vi.fn(async () => ({
          outputMessageId: 'message-1',
          outputPreview: 'Started cron session'
        }))
      }
      const service = new CronJobsServiceCtor({
        sqlitePresenter: sqlitePresenter as never,
        schedulerManager: schedulerManager as never,
        runSessionStarter: runSessionStarter as never
      })

      const { job } = await service.upsert({
        name: 'Session run',
        enabled: true,
        cronExpr: '0 9 * * *',
        timezone: 'UTC',
        agentId: 'agent-1',
        taskPrompt: 'Summarize issues'
      })
      const result = await service.runNow(job.id)

      expect(runSessionStarter.createSessionForRun).toHaveBeenCalledTimes(1)
      expect(runSessionStarter.startSessionRun).toHaveBeenCalledTimes(1)
      expect(result.run).toEqual(
        expect.objectContaining({
          status: 'running',
          sessionId: `session-${result.run.id}`,
          outputMessageId: 'message-1',
          outputPreview: 'Started cron session',
          claimedAt: expect.any(Number),
          claimOwner: expect.stringContaining('cron-job-runner:')
        })
      )
      emitDeepChatInternalSessionUpdate({
        sessionId: `session-${result.run.id}`,
        kind: 'blocks',
        messageId: 'message-1',
        previewMarkdown: 'Finished cron session',
        responseMarkdown: 'Finished cron session',
        waitingInteraction: null,
        updatedAt: Date.now()
      })
      emitDeepChatInternalSessionUpdate({
        sessionId: `session-${result.run.id}`,
        kind: 'status',
        status: 'idle',
        updatedAt: Date.now()
      })
      expect(new CronJobsRepositoryCtor(sqlitePresenter as never).getRun(result.run.id)).toEqual(
        expect.objectContaining({
          status: 'completed',
          sessionId: `session-${result.run.id}`,
          outputMessageId: 'message-1',
          outputPreview: 'Finished cron session'
        })
      )
    } finally {
      db.close()
    }
  })

  it('does not start duplicate sessions for the same queued run', async () => {
    const { db, sqlitePresenter } = createHarness()
    try {
      const status = baseStatus()
      const schedulerManager = {
        reconcile: vi.fn().mockResolvedValue(status),
        restart: vi.fn().mockResolvedValue(status),
        stop: vi.fn().mockResolvedValue(status),
        getStatus: vi.fn(() => status)
      }
      const runSessionStarter = {
        createSessionForRun: vi.fn(async ({ run }: { run: { id: string } }) => ({
          sessionId: `session-${run.id}`
        })),
        startSessionRun: vi.fn(async () => ({}))
      }
      const service = new CronJobsServiceCtor({
        sqlitePresenter: sqlitePresenter as never,
        schedulerManager: schedulerManager as never,
        runSessionStarter: runSessionStarter as never
      })

      const { job } = await service.upsert({
        name: 'Deduped run',
        enabled: true,
        cronExpr: '0 9 * * *',
        timezone: 'UTC',
        agentId: 'agent-1',
        taskPrompt: 'Summarize issues'
      })
      const run = new CronJobsRepositoryCtor(sqlitePresenter as never).queueRun({
        jobId: job.id,
        scheduledAt: Date.now(),
        reason: 'scheduled'
      })
      const event = {
        jobId: job.id,
        runId: run.id,
        scheduledAt: run.scheduledAt,
        reason: run.reason
      }

      await (
        service as never as { processDueRun: (value: typeof event) => Promise<void> }
      ).processDueRun(event)
      await (
        service as never as { processDueRun: (value: typeof event) => Promise<void> }
      ).processDueRun(event)

      expect(runSessionStarter.createSessionForRun).toHaveBeenCalledTimes(1)
      expect(runSessionStarter.startSessionRun).toHaveBeenCalledTimes(1)
      expect(sqlitePresenter.cronJobRunsTable.get(run.id)).toEqual(
        expect.objectContaining({
          status: 'running',
          session_id: `session-${run.id}`
        })
      )
      emitDeepChatInternalSessionUpdate({
        sessionId: `session-${run.id}`,
        kind: 'status',
        status: 'idle',
        updatedAt: Date.now()
      })
      expect(sqlitePresenter.cronJobRunsTable.get(run.id)).toEqual(
        expect.objectContaining({
          status: 'completed',
          session_id: `session-${run.id}`
        })
      )
    } finally {
      db.close()
    }
  })

  it('recomputes missing next run indicators when listing jobs', async () => {
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
      const stored = sqlitePresenter.cronJobsTable.upsert({
        name: 'Legacy indicator',
        enabled: true,
        cronExpr: '0 9 * * *',
        timezone: 'UTC',
        agentId: 'agent-1',
        nextRunAt: null,
        taskPrompt: 'Summarize issues'
      })

      const response = await service.list()

      expect(response.jobs.find((job) => job.id === stored.id)?.nextRunAt).toEqual(
        expect.any(Number)
      )
      expect(schedulerManager.reconcile).toHaveBeenCalledWith('list')
    } finally {
      db.close()
    }
  })

  it('queues each due scheduled run once and advances next_run_at in the utility host', () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'deepchat-cron-jobs-'))
    const dbPath = path.join(tempDir, 'agent.db')
    const db = new DatabaseCtor(dbPath)
    const events: unknown[] = []

    try {
      const cronJobsTable = new CronJobsTableCtor(db)
      const cronJobRunsTable = new CronJobRunsTableCtor(db)
      cronJobsTable.createTable()
      cronJobRunsTable.createTable()
      const dueAt = Date.now() - 1_000
      const job = cronJobsTable.upsert({
        name: 'Due job',
        enabled: true,
        cronExpr: '0 9 * * *',
        timezone: 'UTC',
        agentId: 'agent-1',
        nextRunAt: dueAt,
        taskPrompt: 'Summarize issues',
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
          scheduledAt: dueAt,
          reason: 'scheduled'
        })
      ])
      expect(cronJobsTable.get(job.id)?.next_run_at).toEqual(expect.any(Number))
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

  it('does not surface utility exit errors after the last job is disabled', async () => {
    class FakeHost extends EventEmitter {
      pid = 123
      posted: unknown[] = []

      postMessage(message: unknown): void {
        this.posted.push(message)
      }

      kill(): boolean {
        this.emit('exit', 0)
        return true
      }
    }

    let snapshot = {
      enabledJobCount: 1,
      nextRunAt: 100 as number | null
    }
    const host = new FakeHost()
    const manager = new SchedulerProcessManagerCtor({
      dbPath: ':memory:',
      getSnapshot: () => snapshot,
      onRunDue: vi.fn(),
      spawnHost: vi.fn(async () => host) as never
    })

    await manager.reconcile('enabled')
    snapshot = {
      enabledJobCount: 0,
      nextRunAt: null
    }
    await manager.reconcile('disabled')
    host.emit('exit', 1)

    expect(manager.getStatus()).toEqual(
      expect.objectContaining({
        state: 'idle',
        pid: null,
        lastError: null
      })
    )
  })
})
