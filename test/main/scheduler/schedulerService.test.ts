import { EventEmitter } from 'node:events'
import os from 'node:os'
import path from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import type { CronJob, CronJobRun, CronJobsSchedulerStatus } from '@shared/cronJobs'
import { SessionRuntimeEvents } from '@/session/runtimeEvents'

const actualFs = await vi.importActual<typeof import('node:fs')>('node:fs')
const sqliteModule = await import('better-sqlite3-multiple-ciphers').catch(() => null)
const cronJobsTableModule = sqliteModule
  ? await import('@/scheduler/data/tables/cronJobs').catch(() => null)
  : null
const cronJobRunsTableModule = sqliteModule
  ? await import('@/scheduler/data/tables/cronJobRuns').catch(() => null)
  : null
const cronJobDeliveriesTableModule = sqliteModule
  ? await import('@/scheduler/data/tables/cronJobDeliveries').catch(() => null)
  : null
const repositoryModule =
  sqliteModule && cronJobsTableModule && cronJobRunsTableModule && cronJobDeliveriesTableModule
    ? await import('@/scheduler/repository').catch(() => null)
    : null
const serviceModule = repositoryModule ? await import('@/scheduler').catch(() => null) : null
const deliveryRouterModule = repositoryModule
  ? await import('@/scheduler/deliveryRouter').catch(() => null)
  : null
const schedulerManagerModule = repositoryModule
  ? await import('@/scheduler/schedulerProcessManager').catch(() => null)
  : null
const schedulerUtilityHostModule = repositoryModule
  ? await import('@/scheduler/schedulerUtilityHost').catch(() => null)
  : null
const cronExpressionServiceModule = await import('@/scheduler/cronExpressionService')
const runExecutorModule = await import('@/scheduler/runExecutor')

const Database = sqliteModule?.default
const CronJobsTable = cronJobsTableModule?.CronJobsTable
const CronJobRunsTable = cronJobRunsTableModule?.CronJobRunsTable
const CronJobDeliveriesTable = cronJobDeliveriesTableModule?.CronJobDeliveriesTable
const CronJobsRepository = repositoryModule?.CronJobsRepository
const SchedulerService = serviceModule?.SchedulerService
const CronJobDeliveryRouter = deliveryRouterModule?.CronJobDeliveryRouter
const SchedulerProcessManager = schedulerManagerModule?.SchedulerProcessManager
const CronJobsSchedulerUtilityHost = schedulerUtilityHostModule?.CronJobsSchedulerUtilityHost
const CronExpressionService = cronExpressionServiceModule.CronExpressionService
const DatabaseCtor = Database!
const CronJobsTableCtor = CronJobsTable!
const CronJobRunsTableCtor = CronJobRunsTable!
const CronJobDeliveriesTableCtor = CronJobDeliveriesTable!
const CronJobsRepositoryCtor = CronJobsRepository!
const SchedulerServiceCtor = SchedulerService!
const CronJobDeliveryRouterCtor = CronJobDeliveryRouter!
const SchedulerProcessManagerCtor = SchedulerProcessManager!
const CronJobsSchedulerUtilityHostCtor = CronJobsSchedulerUtilityHost!
const CronJobRunExecutor = runExecutorModule.CronJobRunExecutor

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
  CronJobDeliveriesTable &&
  CronJobsRepository &&
  SchedulerService &&
  CronJobDeliveryRouter &&
  SchedulerProcessManager &&
  CronJobsSchedulerUtilityHost
    ? describe
    : describe.skip

const createRequiredSchedulerDeps = (sessionEvents = new SessionRuntimeEvents()) => ({
  sessionEvents,
  agentSettings: {
    listAgents: vi.fn(async () => [
      {
        id: 'agent-1',
        name: 'Test agent',
        type: 'deepchat' as const,
        enabled: true
      }
    ]),
    resolveDeepChatAgentConfig: vi.fn(async () => ({}))
  },
  runSessionStarter: {
    createSessionForRun: vi.fn(async () => {
      throw new Error('Unexpected scheduler run in this test.')
    }),
    startSessionRun: vi.fn(async () => ({})),
    cancelSessionRun: vi.fn(async () => undefined)
  },
  remoteDeliveryPort: {
    deliverCronJobResult: vi.fn(async () => ({ remoteMessageId: null }))
  }
})

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

describe('CronJobRunExecutor', () => {
  it('does not deliver concurrency skip cancellations', async () => {
    const now = Date.parse('2026-07-04T00:00:00.000Z')
    const job: CronJob = {
      id: 'job-1',
      name: 'Overlap skip',
      description: null,
      enabled: true,
      status: 'ready',
      cronExpr: '* * * * *',
      timezone: 'UTC',
      agentId: 'agent-1',
      nextRunAt: now,
      misfirePolicy: 'skip',
      maxCatchUpRuns: null,
      scheduleError: null,
      taskPrompt: 'Summarize issues',
      taskSystemInstruction: null,
      taskOutputMode: 'final_message',
      modelPolicy: 'follow_agent',
      toolPolicy: 'follow_agent',
      permissionPolicy: 'follow_agent',
      runtime: {
        maxDurationMs: 3_600_000,
        maxTurns: 20,
        concurrencyPolicy: 'skip'
      },
      agentSnapshot: null,
      delivery: {
        targets: [
          {
            type: 'remote',
            remoteId: 'feishu',
            channelId: 'feishu:alerts:root',
            mode: 'summary'
          }
        ],
        suppressSuccessNotification: false,
        notifyOnFailure: true
      },
      createdAt: now,
      updatedAt: now
    }
    const queuedRun: CronJobRun = {
      id: 'run-1',
      jobId: job.id,
      sessionId: null,
      scheduledAt: now,
      queuedAt: now,
      startedAt: null,
      completedAt: null,
      status: 'queued',
      reason: 'scheduled',
      outputMessageId: null,
      outputPreview: null,
      error: null,
      claimedAt: null,
      claimOwner: null,
      createdAt: now,
      updatedAt: now
    }
    const cancelledRun: CronJobRun = {
      ...queuedRun,
      status: 'cancelled',
      error: 'Another cron job run is already active.',
      claimedAt: now,
      claimOwner: 'owner-1',
      updatedAt: now
    }
    const repository = {
      claimRun: vi.fn(() => queuedRun),
      getRun: vi.fn(() => queuedRun),
      countActiveRunsByJob: vi.fn(() => 1),
      releaseRunQueued: vi.fn(),
      markRunCancelled: vi.fn(() => cancelledRun)
    }
    const sessionStarter = {
      createSessionForRun: vi.fn(),
      startSessionRun: vi.fn()
    }
    const deliveryRouter = {
      deliver: vi.fn(async () => [])
    }
    const executor = new CronJobRunExecutor(
      repository as never,
      sessionStarter as never,
      deliveryRouter as never,
      new SessionRuntimeEvents()
    )

    try {
      await expect(executor.execute({ runId: queuedRun.id, job })).resolves.toEqual(cancelledRun)
      expect(repository.markRunCancelled).toHaveBeenCalledWith(
        queuedRun.id,
        'Another cron job run is already active.'
      )
      expect(sessionStarter.createSessionForRun).not.toHaveBeenCalled()
      expect(deliveryRouter.deliver).not.toHaveBeenCalled()
    } finally {
      executor.dispose()
    }
  })

  it('releases concurrency queue runs without creating or delivering a session', async () => {
    const job = {
      id: 'job-queue',
      name: 'Overlap queue',
      agentId: 'agent-1',
      runtime: {
        maxDurationMs: 3_600_000,
        maxTurns: 20,
        concurrencyPolicy: 'queue'
      }
    } as CronJob
    const queuedRun = {
      id: 'run-queue',
      jobId: job.id,
      status: 'queued'
    } as CronJobRun
    const repository = {
      claimRun: vi.fn(() => queuedRun),
      getRun: vi.fn(() => queuedRun),
      countActiveRunsByJob: vi.fn(() => 1),
      releaseRunQueued: vi.fn(() => queuedRun),
      markRunCancelled: vi.fn()
    }
    const sessionStarter = {
      createSessionForRun: vi.fn(),
      startSessionRun: vi.fn()
    }
    const deliveryRouter = {
      deliver: vi.fn()
    }
    const executor = new CronJobRunExecutor(
      repository as never,
      sessionStarter as never,
      deliveryRouter as never,
      new SessionRuntimeEvents()
    )

    try {
      await expect(executor.execute({ runId: queuedRun.id, job })).resolves.toEqual(queuedRun)
      expect(repository.releaseRunQueued).toHaveBeenCalledWith(queuedRun.id)
      expect(repository.markRunCancelled).not.toHaveBeenCalled()
      expect(sessionStarter.createSessionForRun).not.toHaveBeenCalled()
      expect(deliveryRouter.deliver).not.toHaveBeenCalled()
    } finally {
      executor.dispose()
    }
  })

  it('captures remote delivery segments as run output', async () => {
    const now = Date.parse('2026-07-04T00:00:00.000Z')
    const job: CronJob = {
      id: 'job-1',
      name: 'Delivery detail',
      description: null,
      enabled: true,
      status: 'ready',
      cronExpr: '* * * * *',
      timezone: 'UTC',
      agentId: 'agent-1',
      nextRunAt: now,
      misfirePolicy: 'skip',
      maxCatchUpRuns: null,
      scheduleError: null,
      taskPrompt: 'Summarize issues',
      taskSystemInstruction: null,
      taskOutputMode: 'final_message',
      modelPolicy: 'follow_agent',
      toolPolicy: 'follow_agent',
      permissionPolicy: 'follow_agent',
      runtime: {
        maxDurationMs: 3_600_000,
        maxTurns: 20,
        concurrencyPolicy: 'skip'
      },
      agentSnapshot: null,
      delivery: {
        targets: [],
        suppressSuccessNotification: false,
        notifyOnFailure: true
      },
      createdAt: now,
      updatedAt: now
    }
    const runningRun: CronJobRun = {
      id: 'run-1',
      jobId: job.id,
      sessionId: null,
      scheduledAt: now,
      queuedAt: now,
      startedAt: now,
      completedAt: null,
      status: 'running',
      reason: 'scheduled',
      outputMessageId: null,
      outputPreview: null,
      error: null,
      claimedAt: now,
      claimOwner: 'owner-1',
      createdAt: now,
      updatedAt: now
    }
    let storedRun = runningRun
    const repository = {
      claimRun: vi.fn(() => runningRun),
      getRun: vi.fn(() => storedRun),
      countActiveRunsByJob: vi.fn(() => 0),
      updateRunSession: vi.fn((id: string, sessionId: string) => {
        storedRun = { ...storedRun, id, sessionId }
        return storedRun
      }),
      updateRunOutput: vi.fn((id: string, output: Partial<CronJobRun>) => {
        storedRun = { ...storedRun, id, ...output }
        return storedRun
      }),
      markRunFailed: vi.fn((id: string, error: string) => {
        storedRun = { ...storedRun, id, status: 'failed', error }
        return storedRun
      })
    }
    const sessionStarter = {
      createSessionForRun: vi.fn(async () => ({ sessionId: 'session-1' })),
      startSessionRun: vi.fn(async () => ({ outputMessageId: 'message-1' })),
      cancelSessionRun: vi.fn(async () => undefined)
    }
    const deliveryRouter = { deliver: vi.fn(async () => []) }
    const sessionEvents = new SessionRuntimeEvents()
    const executor = new CronJobRunExecutor(
      repository as never,
      sessionStarter as never,
      deliveryRouter as never,
      sessionEvents
    )

    try {
      await executor.execute({ runId: runningRun.id, job })
      sessionEvents.publish({
        sessionId: 'session-1',
        kind: 'blocks',
        messageId: 'message-1',
        previewMarkdown: 'Preview answer',
        responseMarkdown: 'Response answer',
        waitingInteraction: null,
        updatedAt: now
      })
      expect(repository.updateRunOutput).toHaveBeenLastCalledWith(runningRun.id, {
        outputMessageId: 'message-1',
        outputPreview: 'Response answer'
      })

      sessionEvents.publish({
        sessionId: 'session-1',
        kind: 'blocks',
        messageId: 'message-1',
        previewMarkdown: 'Final answer',
        responseMarkdown: 'Fallback answer',
        deliverySegments: [
          {
            key: 'message-1:0:process',
            kind: 'process',
            text: 'read_file: "/tmp/a.md"',
            sourceMessageId: 'message-1'
          },
          {
            key: 'message-1:1:terminal',
            kind: 'terminal',
            text: 'Completed successfully',
            sourceMessageId: 'message-1'
          },
          {
            key: 'message-1:2:answer',
            kind: 'answer',
            text: 'Final answer',
            sourceMessageId: 'message-1'
          }
        ],
        waitingInteraction: null,
        updatedAt: now
      })

      expect(repository.updateRunOutput).toHaveBeenLastCalledWith(runningRun.id, {
        outputMessageId: 'message-1',
        outputPreview:
          'Process\nread_file: "/tmp/a.md"\n\nStatus\nCompleted successfully\n\nAnswer\nFinal answer'
      })
    } finally {
      executor.dispose()
    }
  })

  it('does not overwrite terminal runs when session start fails late', async () => {
    const now = Date.parse('2026-07-04T00:00:00.000Z')
    const job: CronJob = {
      id: 'job-1',
      name: 'Late failure',
      description: null,
      enabled: true,
      status: 'ready',
      cronExpr: '* * * * *',
      timezone: 'UTC',
      agentId: 'agent-1',
      nextRunAt: now,
      misfirePolicy: 'skip',
      maxCatchUpRuns: null,
      scheduleError: null,
      taskPrompt: 'Summarize issues',
      taskSystemInstruction: null,
      taskOutputMode: 'final_message',
      modelPolicy: 'follow_agent',
      toolPolicy: 'follow_agent',
      permissionPolicy: 'follow_agent',
      runtime: {
        maxDurationMs: 3_600_000,
        maxTurns: 20,
        concurrencyPolicy: 'skip'
      },
      agentSnapshot: null,
      delivery: {
        targets: [],
        suppressSuccessNotification: false,
        notifyOnFailure: true
      },
      createdAt: now,
      updatedAt: now
    }
    const runningRun: CronJobRun = {
      id: 'run-1',
      jobId: job.id,
      sessionId: null,
      scheduledAt: now,
      queuedAt: now,
      startedAt: now,
      completedAt: null,
      status: 'running',
      reason: 'scheduled',
      outputMessageId: null,
      outputPreview: null,
      error: null,
      claimedAt: now,
      claimOwner: 'owner-1',
      createdAt: now,
      updatedAt: now
    }
    const completedRun: CronJobRun = {
      ...runningRun,
      completedAt: now + 1,
      status: 'completed',
      updatedAt: now + 1
    }
    let storedRun = runningRun
    const repository = {
      claimRun: vi.fn(() => runningRun),
      getRun: vi.fn(() => storedRun),
      countActiveRunsByJob: vi.fn(() => 0),
      updateRunSession: vi.fn((id: string, sessionId: string) => {
        storedRun = { ...storedRun, id, sessionId }
        return storedRun
      }),
      updateRunOutput: vi.fn(),
      markRunFailed: vi.fn()
    }
    const sessionStarter = {
      createSessionForRun: vi.fn(async () => ({ sessionId: 'session-1' })),
      startSessionRun: vi.fn(async () => {
        storedRun = completedRun
        throw new Error('late failure')
      })
    }
    const deliveryRouter = {
      deliver: vi.fn(async () => [])
    }
    const executor = new CronJobRunExecutor(
      repository as never,
      sessionStarter as never,
      deliveryRouter as never,
      new SessionRuntimeEvents()
    )

    try {
      await expect(executor.execute({ runId: runningRun.id, job })).resolves.toEqual(completedRun)
      expect(repository.markRunFailed).not.toHaveBeenCalled()
      expect(deliveryRouter.deliver).not.toHaveBeenCalled()
    } finally {
      executor.dispose()
    }
  })

  it('fails and cancels runs that exceed max duration', async () => {
    vi.useFakeTimers()
    const now = Date.parse('2026-07-04T00:00:00.000Z')
    const job: CronJob = {
      id: 'job-1',
      name: 'Timeout job',
      description: null,
      enabled: true,
      status: 'ready',
      cronExpr: '* * * * *',
      timezone: 'UTC',
      agentId: 'agent-1',
      nextRunAt: now,
      misfirePolicy: 'skip',
      maxCatchUpRuns: null,
      scheduleError: null,
      taskPrompt: 'Summarize issues',
      taskSystemInstruction: null,
      taskOutputMode: 'final_message',
      modelPolicy: 'follow_agent',
      toolPolicy: 'follow_agent',
      permissionPolicy: 'follow_agent',
      runtime: {
        maxDurationMs: 10,
        maxTurns: 20,
        concurrencyPolicy: 'skip'
      },
      agentSnapshot: null,
      delivery: {
        targets: [],
        suppressSuccessNotification: false,
        notifyOnFailure: true
      },
      createdAt: now,
      updatedAt: now
    }
    const runningRun: CronJobRun = {
      id: 'run-1',
      jobId: job.id,
      sessionId: null,
      scheduledAt: now,
      queuedAt: now,
      startedAt: now,
      completedAt: null,
      status: 'running',
      reason: 'scheduled',
      outputMessageId: null,
      outputPreview: null,
      error: null,
      claimedAt: now,
      claimOwner: 'owner-1',
      createdAt: now,
      updatedAt: now
    }
    let storedRun = runningRun
    const repository = {
      claimRun: vi.fn(() => runningRun),
      getRun: vi.fn(() => storedRun),
      countActiveRunsByJob: vi.fn(() => 0),
      updateRunSession: vi.fn((id: string, sessionId: string) => {
        storedRun = { ...storedRun, id, sessionId }
        return storedRun
      }),
      updateRunOutput: vi.fn(),
      markRunFailed: vi.fn((id: string, error: string) => {
        storedRun = { ...storedRun, id, status: 'failed', error }
        return storedRun
      })
    }
    const sessionStarter = {
      createSessionForRun: vi.fn(async () => ({ sessionId: 'session-1' })),
      startSessionRun: vi.fn(async () => ({})),
      cancelSessionRun: vi.fn(async () => undefined)
    }
    const deliveryRouter = {
      deliver: vi.fn(async () => [])
    }
    const executor = new CronJobRunExecutor(
      repository as never,
      sessionStarter as never,
      deliveryRouter as never,
      new SessionRuntimeEvents()
    )

    try {
      await executor.execute({ runId: runningRun.id, job })
      await vi.advanceTimersByTimeAsync(10)

      expect(repository.markRunFailed).toHaveBeenCalledWith(
        runningRun.id,
        'Cron job exceeded max duration (10 ms).'
      )
      expect(sessionStarter.cancelSessionRun).toHaveBeenCalledWith({
        job,
        run: expect.objectContaining({ id: runningRun.id }),
        sessionId: 'session-1',
        reason: 'Cron job exceeded max duration (10 ms).'
      })
      expect(deliveryRouter.deliver).toHaveBeenCalledWith({
        job,
        run: expect.objectContaining({ id: runningRun.id, status: 'failed' })
      })
    } finally {
      executor.dispose()
      vi.useRealTimers()
    }
  })
})

const createHarness = () => {
  const db = new DatabaseCtor(':memory:')
  const cronJobsTable = new CronJobsTableCtor(db)
  const cronJobRunsTable = new CronJobRunsTableCtor(db)
  const cronJobDeliveriesTable = new CronJobDeliveriesTableCtor(db)
  cronJobsTable.createTable()
  cronJobRunsTable.createTable()
  cronJobDeliveriesTable.createTable()

  const sqlitePresenter = {
    cronJobsTable,
    cronJobRunsTable,
    cronJobDeliveriesTable,
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
      const service = new SchedulerServiceCtor({
        ...createRequiredSchedulerDeps(),
        database: sqlitePresenter as never,
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
      const providerSettings = {
        listAgents: vi.fn(async () => agents),
        resolveDeepChatAgentConfig: vi.fn(async () => ({ systemPrompt: 'system' }))
      }
      const service = new SchedulerServiceCtor({
        ...createRequiredSchedulerDeps(),
        database: sqlitePresenter as never,
        schedulerManager: schedulerManager as never,
        providerSettings: providerSettings as never
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
      expect(providerSettings.resolveDeepChatAgentConfig).toHaveBeenCalledWith('agent-1')

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

  it('records and delivers session starter failures', async () => {
    const { db, sqlitePresenter } = createHarness()
    try {
      const status = baseStatus()
      const schedulerManager = {
        reconcile: vi.fn().mockResolvedValue(status),
        restart: vi.fn().mockResolvedValue(status),
        stop: vi.fn().mockResolvedValue(status),
        getStatus: vi.fn(() => status)
      }
      const deliveryRouter = {
        deliver: vi.fn(async () => [])
      }
      const runSessionStarter = {
        createSessionForRun: vi.fn(async () => {
          throw new Error('Cron session creation failed.')
        }),
        startSessionRun: vi.fn(async () => ({})),
        cancelSessionRun: vi.fn(async () => undefined)
      }
      const service = new SchedulerServiceCtor({
        ...createRequiredSchedulerDeps(),
        database: sqlitePresenter as never,
        schedulerManager: schedulerManager as never,
        deliveryRouter: deliveryRouter as never,
        runSessionStarter: runSessionStarter as never
      })

      const { job } = await service.upsert({
        name: 'Manual smoke',
        enabled: true,
        cronExpr: '0 9 * * *',
        timezone: 'UTC',
        agentId: 'agent-1',
        taskPrompt: 'Summarize issues',
        delivery: {
          targets: [
            {
              type: 'remote',
              remoteId: 'feishu',
              channelId: 'feishu:alerts:root',
              mode: 'summary'
            }
          ],
          suppressSuccessNotification: false,
          notifyOnFailure: true
        }
      })
      expect(job.nextRunAt).toEqual(expect.any(Number))
      const result = await service.runNow(job.id)

      expect(result.run).toEqual(
        expect.objectContaining({
          jobId: job.id,
          status: 'failed',
          reason: 'manual',
          error: 'Cron session creation failed.'
        })
      )
      expect(deliveryRouter.deliver).toHaveBeenCalledWith({
        job: expect.objectContaining({ id: job.id }),
        run: expect.objectContaining({ id: result.run.id, status: 'failed' })
      })
      expect(schedulerManager.reconcile).toHaveBeenCalledWith('job-upsert')
      expect(schedulerManager.reconcile).toHaveBeenCalledWith('manual-run')
    } finally {
      db.close()
    }
  })

  it('fails stale running runs on startup', async () => {
    const { db, sqlitePresenter } = createHarness()
    try {
      const status = baseStatus()
      const schedulerManager = {
        reconcile: vi.fn().mockResolvedValue(status),
        restart: vi.fn().mockResolvedValue(status),
        stop: vi.fn().mockResolvedValue(status),
        getStatus: vi.fn(() => status)
      }
      const repository = new CronJobsRepositoryCtor(sqlitePresenter as never)
      const job = repository.upsertJob({
        name: 'Stale run',
        enabled: false,
        cronExpr: '0 9 * * *',
        timezone: 'UTC',
        agentId: 'agent-1',
        taskPrompt: 'Summarize issues'
      })
      const run = repository.queueRun({
        jobId: job.id,
        scheduledAt: Date.now(),
        reason: 'scheduled'
      })
      repository.markRunRunning(run.id)
      const service = new SchedulerServiceCtor({
        ...createRequiredSchedulerDeps(),
        database: sqlitePresenter as never,
        schedulerManager: schedulerManager as never
      })

      service.start()

      expect(repository.getRun(run.id)).toEqual(
        expect.objectContaining({
          status: 'failed',
          error: 'Cron job runner stopped before completion.'
        })
      )
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
        })),
        cancelSessionRun: vi.fn(async () => undefined)
      }
      const sessionEvents = new SessionRuntimeEvents()
      const service = new SchedulerServiceCtor({
        ...createRequiredSchedulerDeps(sessionEvents),
        database: sqlitePresenter as never,
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
      sessionEvents.publish({
        sessionId: `session-${result.run.id}`,
        kind: 'blocks',
        messageId: 'message-1',
        previewMarkdown: 'Finished cron session',
        responseMarkdown: 'Finished cron session',
        waitingInteraction: null,
        updatedAt: Date.now()
      })
      expect(new CronJobsRepositoryCtor(sqlitePresenter as never).getRun(result.run.id)).toEqual(
        expect.objectContaining({
          status: 'running',
          outputMessageId: 'message-1',
          outputPreview: 'Finished cron session'
        })
      )
      sessionEvents.publish({
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

  it('creates a fresh session for scheduled due runs when the executor is wired', async () => {
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
          outputPreview: 'Started scheduled session'
        }))
      }
      const service = new SchedulerServiceCtor({
        ...createRequiredSchedulerDeps(),
        database: sqlitePresenter as never,
        schedulerManager: schedulerManager as never,
        runSessionStarter: runSessionStarter as never
      })

      const { job } = await service.upsert({
        name: 'Scheduled session run',
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

      expect(runSessionStarter.createSessionForRun).toHaveBeenCalledTimes(1)
      expect(runSessionStarter.startSessionRun).toHaveBeenCalledTimes(1)
      expect(new CronJobsRepositoryCtor(sqlitePresenter as never).getRun(run.id)).toEqual(
        expect.objectContaining({
          status: 'running',
          reason: 'scheduled',
          sessionId: `session-${run.id}`,
          outputMessageId: 'message-1',
          outputPreview: 'Started scheduled session'
        })
      )
    } finally {
      db.close()
    }
  })

  it('persists delivery config and receipts', async () => {
    const { db, sqlitePresenter } = createHarness()
    try {
      const repository = new CronJobsRepositoryCtor(sqlitePresenter as never)
      const job = repository.upsertJob({
        name: 'Delivery job',
        enabled: false,
        cronExpr: '0 9 * * *',
        timezone: 'UTC',
        agentId: 'agent-1',
        taskPrompt: 'Summarize issues',
        delivery: {
          targets: [
            {
              type: 'remote',
              remoteId: 'feishu',
              channelId: 'feishu:alerts:root',
              mode: 'summary'
            },
            {
              type: 'remote',
              remoteId: 'telegram',
              channelId: 'telegram:-100:0',
              mode: 'summary'
            }
          ],
          suppressSuccessNotification: false,
          notifyOnFailure: true
        }
      })
      const run = repository.queueRun({
        jobId: job.id,
        scheduledAt: Date.now(),
        reason: 'scheduled'
      })
      const receipt = repository.recordDelivery({
        jobId: job.id,
        runId: run.id,
        target: {
          type: 'remote',
          remoteId: 'feishu',
          channelId: 'feishu:alerts:root',
          mode: 'summary'
        },
        status: 'success',
        remoteMessageId: 'remote-message-1'
      })

      expect(repository.requireJob(job.id).delivery.targets).toEqual(job.delivery.targets)
      expect(repository.listDeliveriesByRun(run.id)).toEqual([receipt])
      expect(repository.findDeliveryByRemoteMessageId('remote-message-1')).toEqual(receipt)
    } finally {
      db.close()
    }
  })

  it('routes remote deliveries and records failures as receipts', async () => {
    const { db, sqlitePresenter } = createHarness()
    try {
      const repository = new CronJobsRepositoryCtor(sqlitePresenter as never)
      const deliverCronJobResult = vi
        .fn()
        .mockResolvedValueOnce({ remoteMessageId: 'remote-message-1' })
        .mockRejectedValueOnce(new Error('Remote channel is not running: feishu'))
      const router = new CronJobDeliveryRouterCtor(repository, { deliverCronJobResult })
      const job = repository.upsertJob({
        name: 'Delivery route job',
        enabled: false,
        cronExpr: '0 9 * * *',
        timezone: 'UTC',
        agentId: 'agent-1',
        taskPrompt: 'Summarize issues',
        delivery: {
          targets: [
            {
              type: 'remote',
              remoteId: 'feishu',
              channelId: 'feishu:alerts:root',
              mode: 'summary'
            },
            {
              type: 'remote',
              remoteId: 'feishu',
              channelId: 'feishu:ops:root',
              mode: 'summary'
            }
          ],
          suppressSuccessNotification: false,
          notifyOnFailure: true
        }
      })
      const queued = repository.queueRun({
        jobId: job.id,
        scheduledAt: Date.now(),
        reason: 'scheduled'
      })
      repository.markRunRunning(queued.id)
      const completed = repository.markRunCompleted(queued.id)

      await router.deliver({ job, run: completed })

      expect(deliverCronJobResult).toHaveBeenCalledTimes(2)
      const deliveries = repository.listDeliveriesByRun(completed.id)
      expect(deliveries).toHaveLength(2)
      expect(deliveries).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            targetType: 'remote',
            status: 'success',
            remoteMessageId: 'remote-message-1'
          }),
          expect.objectContaining({
            targetType: 'remote',
            status: 'failed',
            error: 'Remote channel is not running: feishu'
          })
        ])
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
        startSessionRun: vi.fn(async () => ({})),
        cancelSessionRun: vi.fn(async () => undefined)
      }
      const sessionEvents = new SessionRuntimeEvents()
      const service = new SchedulerServiceCtor({
        ...createRequiredSchedulerDeps(sessionEvents),
        database: sqlitePresenter as never,
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
      sessionEvents.publish({
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
      const service = new SchedulerServiceCtor({
        ...createRequiredSchedulerDeps(),
        database: sqlitePresenter as never,
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
    const tempDir = actualFs.mkdtempSync(path.join(os.tmpdir(), 'deepchat-cron-jobs-'))
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
      actualFs.rmSync(tempDir, { recursive: true, force: true })
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

  it('ignores a stale utility exit after restarting the scheduler', async () => {
    class FakeHost extends EventEmitter {
      constructor(readonly pid: number) {
        super()
      }

      posted: unknown[] = []

      postMessage(message: unknown): void {
        this.posted.push(message)
      }

      kill(): boolean {
        return true
      }
    }

    const snapshot = {
      enabledJobCount: 1,
      nextRunAt: 100
    }
    const firstHost = new FakeHost(123)
    const secondHost = new FakeHost(456)
    let spawnCount = 0
    const spawnHost = vi.fn(async () => {
      spawnCount += 1
      return spawnCount === 1 ? firstHost : secondHost
    })
    const manager = new SchedulerProcessManagerCtor({
      dbPath: ':memory:',
      getSnapshot: () => snapshot,
      onRunDue: vi.fn(),
      spawnHost: spawnHost as never
    })

    await manager.reconcile('initial')
    await manager.restart()
    firstHost.emit('exit', 0)

    expect(manager.getStatus()).toEqual(
      expect.objectContaining({
        state: 'running',
        pid: 456,
        lastError: null
      })
    )
    await manager.reconcile('after-stale-exit')
    expect(spawnHost).toHaveBeenCalledTimes(2)
  })

  it('records a utility spawn failure in scheduler status', async () => {
    const manager = new SchedulerProcessManagerCtor({
      dbPath: ':memory:',
      getSnapshot: () => ({ enabledJobCount: 1, nextRunAt: 100 }),
      onRunDue: vi.fn(),
      spawnHost: vi.fn(async () => {
        throw new Error('Failed to spawn scheduler host.')
      }) as never
    })

    await expect(manager.reconcile('spawn-failure')).rejects.toThrow(
      'Failed to spawn scheduler host.'
    )
    expect(manager.getStatus()).toEqual(
      expect.objectContaining({
        state: 'error',
        pid: null,
        lastError: 'Failed to spawn scheduler host.'
      })
    )
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
