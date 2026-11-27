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
      getJob: vi.fn(() => job),
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
      getJob: vi.fn(() => job),
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
      getJob: vi.fn(() => job),
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
      getJob: vi.fn(() => job),
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
      getJob: vi.fn(() => job),
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

  it('tracks only its own turn on a reused session and passes eventId on timeout', async () => {
    vi.useFakeTimers()
    const now = Date.parse('2026-07-04T00:00:00.000Z')
    const job = {
      id: 'job-reuse',
      name: 'Shared daily report',
      agentId: 'agent-1',
      sessionMode: 'reuse_session',
      reuseSessionId: 'shared-session-1',
      runtime: {
        maxDurationMs: 20,
        maxTurns: 20,
        concurrencyPolicy: 'skip'
      }
    } as CronJob
    let storedRun: CronJobRun = {
      id: 'run-reuse-1',
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
    const repository = {
      claimRun: vi.fn(() => storedRun),
      getJob: vi.fn(() => job),
      getRun: vi.fn(() => storedRun),
      countActiveRunsByJob: vi.fn(() => 0),
      countActiveRunsBySession: vi.fn(() => 0),
      updateRunSession: vi.fn((_id: string, sessionId: string) => {
        storedRun = { ...storedRun, sessionId }
        return storedRun
      }),
      updateRunOutput: vi.fn(
        (
          _id: string,
          input: { outputMessageId?: string | null; outputPreview?: string | null }
        ) => {
          storedRun = {
            ...storedRun,
            outputMessageId: input.outputMessageId ?? storedRun.outputMessageId,
            outputPreview: input.outputPreview ?? storedRun.outputPreview
          }
          return storedRun
        }
      ),
      markRunCompleted: vi.fn(() => {
        storedRun = { ...storedRun, status: 'completed' }
        return storedRun
      }),
      markRunFailed: vi.fn((_id: string, error: string) => {
        storedRun = { ...storedRun, status: 'failed', error }
        return storedRun
      })
    }
    const sessionEvents = new SessionRuntimeEvents()
    const sessionStarter = {
      createSessionForRun: vi.fn(async () => ({
        sessionId: 'shared-session-1',
        reused: true,
        createdReuseSession: false
      })),
      startSessionRun: vi.fn(
        async ({
          onBeforeSubmit
        }: {
          onBeforeSubmit?: (meta?: { submissionId?: string }) => void
        }) => {
          onBeforeSubmit?.({ submissionId: 'cron:run-reuse-1:sub' })
          // Pre-existing user turn arriving after submission must not bind or be captured.
          sessionEvents.publish({
            sessionId: 'shared-session-1',
            kind: 'blocks',
            messageId: 'user-turn-msg',
            requestId: 'user-turn-req',
            responseMarkdown: 'User turn reply',
            updatedAt: now + 1
          })
          sessionEvents.publish({
            sessionId: 'shared-session-1',
            kind: 'status',
            status: 'idle',
            messageId: 'user-turn-msg',
            requestId: 'user-turn-req',
            updatedAt: now + 1
          })
          sessionEvents.publish({
            sessionId: 'shared-session-1',
            kind: 'status',
            status: 'generating',
            messageId: 'cron-turn-msg',
            requestId: 'cron-turn-req',
            submissionId: 'cron:run-reuse-1:sub',
            updatedAt: now + 2
          })
          return { expectedSubmissionId: 'cron:run-reuse-1:sub' }
        }
      ),
      cancelSessionRun: vi.fn(async () => undefined)
    }
    const deliveryRouter = { deliver: vi.fn(async () => []) }
    const executor = new CronJobRunExecutor(
      repository as never,
      sessionStarter as never,
      deliveryRouter as never,
      sessionEvents
    )

    try {
      await executor.execute({ runId: storedRun.id, job })
      // Unrelated turn blocks/status on the same session are ignored.
      sessionEvents.publish({
        sessionId: 'shared-session-1',
        kind: 'blocks',
        messageId: 'other-turn-msg',
        requestId: 'other-turn-req',
        responseMarkdown: 'Other turn output',
        updatedAt: now + 3
      })
      sessionEvents.publish({
        sessionId: 'shared-session-1',
        kind: 'status',
        status: 'idle',
        messageId: 'other-turn-msg',
        requestId: 'other-turn-req',
        updatedAt: now + 4
      })
      expect(storedRun.status).toBe('running')
      expect(storedRun.outputPreview).toBeNull()

      sessionEvents.publish({
        sessionId: 'shared-session-1',
        kind: 'blocks',
        messageId: 'cron-turn-msg',
        requestId: 'cron-turn-req',
        responseMarkdown: 'Cron turn output',
        updatedAt: now + 5
      })
      expect(storedRun.outputPreview).toBe('Cron turn output')

      await vi.advanceTimersByTimeAsync(20)
      expect(sessionStarter.cancelSessionRun).toHaveBeenCalledWith({
        job,
        run: expect.objectContaining({ id: storedRun.id }),
        sessionId: 'shared-session-1',
        reason: 'Cron job exceeded max duration (20 ms).',
        eventId: 'cron-turn-req',
        submissionId: 'cron:run-reuse-1:sub',
        allowSessionWideCancel: false
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
      const agentSettings = {
        listAgents: vi.fn(async () => agents),
        resolveDeepChatAgentConfig: vi.fn(async () => ({ systemPrompt: 'system' }))
      }
      const service = new SchedulerServiceCtor({
        ...createRequiredSchedulerDeps(),
        database: sqlitePresenter as never,
        schedulerManager: schedulerManager as never,
        agentSettings: agentSettings as never
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
      expect(agentSettings.resolveDeepChatAgentConfig).toHaveBeenCalledWith('agent-1')

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
        kind: 'status',
        status: 'idle',
        updatedAt: Date.now()
      })
      expect(service.getRun(result.run.id).status).toBe('running')
      sessionEvents.publish({
        sessionId: `session-${result.run.id}`,
        kind: 'status',
        status: 'generating',
        updatedAt: Date.now()
      })
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
        status: 'generating',
        updatedAt: Date.now()
      })
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

  it('migrates legacy cron_jobs schema to session reuse columns and persists first-run session binding', async () => {
    const db = new DatabaseCtor(':memory:')
    db.exec(`
      CREATE TABLE cron_jobs (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        description TEXT,
        enabled INTEGER NOT NULL DEFAULT 0,
        status TEXT NOT NULL DEFAULT 'disabled',
        cron_expr TEXT NOT NULL,
        timezone TEXT NOT NULL,
        agent_id TEXT,
        next_run_at INTEGER,
        misfire_policy TEXT NOT NULL DEFAULT 'skip',
        max_catch_up_runs INTEGER,
        schedule_error TEXT,
        task_prompt TEXT NOT NULL DEFAULT '',
        task_system_instruction TEXT,
        task_output_mode TEXT NOT NULL DEFAULT 'final_message',
        model_policy TEXT NOT NULL DEFAULT 'follow_agent',
        tool_policy TEXT NOT NULL DEFAULT 'follow_agent',
        permission_policy TEXT NOT NULL DEFAULT 'follow_agent',
        runtime_json TEXT NOT NULL DEFAULT '{}',
        agent_snapshot_json TEXT,
        delivery_json TEXT NOT NULL DEFAULT '{}',
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      );
      INSERT INTO cron_jobs (id, name, enabled, status, cron_expr, timezone, agent_id, task_prompt, created_at, updated_at)
      VALUES ('legacy-job', 'Legacy', 1, 'ready', '0 9 * * *', 'UTC', 'agent-1', 'Ping', 1, 1);
    `)
    const cronJobsTable = new CronJobsTableCtor(db)
    const cronJobRunsTable = new CronJobRunsTableCtor(db)
    const cronJobDeliveriesTable = new CronJobDeliveriesTableCtor(db)
    cronJobRunsTable.createTable()
    cronJobDeliveriesTable.createTable()
    const migrationSql = cronJobsTable.getMigrationSQL(70)
    expect(migrationSql).toBeTruthy()
    db.exec(migrationSql!)

    const repo = new CronJobsRepositoryCtor({
      cronJobsTable,
      cronJobRunsTable,
      cronJobDeliveriesTable,
      getDatabase: () => db,
      getDatabasePath: () => ':memory:',
      getDatabasePassword: () => undefined
    })
    expect(repo.getJob('legacy-job')).toEqual(
      expect.objectContaining({
        sessionMode: 'new_session',
        reuseSessionId: null
      })
    )

    const sessionEvents = new SessionRuntimeEvents()
    const createdSessions: string[] = []
    const sentSessions: string[] = []
    const sessionsMap = new Map<
      string,
      { id: string; agentId: string; isDraft: boolean; sessionKind: 'regular' | 'subagent' }
    >()
    const deps = createRequiredSchedulerDeps(sessionEvents)
    const starter = serviceModule!.createCronJobRunSessionStarter({
      lifecycle: {
        createDetachedSession: vi.fn(async ({ agentId }) => {
          const id = `created-session-${createdSessions.length + 1}`
          createdSessions.push(id)
          sessionsMap.set(id, {
            id,
            agentId: agentId ?? 'agent-1',
            isDraft: false,
            sessionKind: 'regular'
          })
          return { id }
        })
      },
      turn: {
        sendMessage: vi.fn(async (sessionId, _content, options) => {
          sentSessions.push(sessionId)
          options?.onBeforeSubmit?.()
          sessionEvents.publish({
            sessionId,
            kind: 'status',
            status: 'generating',
            messageId: `msg-${sentSessions.length}`,
            requestId: `req-${sentSessions.length}`,
            ...(options?.submissionId ? { submissionId: options.submissionId } : {}),
            updatedAt: Date.now()
          })
          sessionEvents.publish({
            sessionId,
            kind: 'status',
            status: 'idle',
            messageId: `msg-${sentSessions.length}`,
            requestId: `req-${sentSessions.length}`,
            updatedAt: Date.now()
          })
          return {
            requestId: `req-${sentSessions.length}`,
            messageId: `msg-${sentSessions.length}`
          }
        }),
        cancelGeneration: vi.fn(async () => undefined),
        cancelGenerationByEventId: vi.fn(async () => true)
      },
      agentCatalog: { getAgentType: vi.fn(async () => 'deepchat' as const) },
      sessions: { get: (id) => (sessionsMap.get(id) as never) ?? null }
    })

    const service = new SchedulerServiceCtor({
      ...deps,
      database: {
        cronJobsTable,
        cronJobRunsTable,
        cronJobDeliveriesTable,
        getDatabase: () => db,
        getDatabasePath: () => ':memory:',
        getDatabasePassword: () => undefined
      },
      sessions: { get: (id) => (sessionsMap.get(id) as never) ?? null },
      runSessionStarter: starter,
      schedulerManager: {
        getStatus: () => ({
          state: 'idle',
          pid: null,
          enabledJobCount: 0,
          nextRunAt: null,
          lastHeartbeatAt: null,
          lastError: null,
          restartAttempts: 0,
          updatedAt: 0
        }),
        reconcile: vi.fn(async () => ({
          state: 'idle',
          pid: null,
          enabledJobCount: 0,
          nextRunAt: null,
          lastHeartbeatAt: null,
          lastError: null,
          restartAttempts: 0,
          updatedAt: 0
        })),
        restart: vi.fn(),
        stop: vi.fn(async () => undefined)
      } as never
    })

    try {
      const { job } = await service.upsert({
        name: 'Reusable job',
        enabled: true,
        cronExpr: '0 9 * * *',
        timezone: 'UTC',
        agentId: 'agent-1',
        taskPrompt: 'Daily summary',
        sessionMode: 'reuse_session',
        reuseSessionId: null
      })
      const first = await service.runNow(job.id)
      expect(first.job.reuseSessionId).toBe('created-session-1')
      expect(first.run.sessionId).toBe('created-session-1')

      const second = await service.runNow(job.id)
      expect(second.run.sessionId).toBe('created-session-1')
      expect(createdSessions).toEqual(['created-session-1'])
      expect(sentSessions).toEqual(['created-session-1', 'created-session-1'])

      // Deleting the reused session causes subsequent runs to fail explicitly rather than creating a fresh session.
      sessionsMap.delete('created-session-1')
      const third = await service.runNow(job.id)
      expect(third.run.status).toBe('failed')
      expect(third.run.error).toContain('no longer exists')
      expect(createdSessions).toEqual(['created-session-1'])
    } finally {
      await service.destroy()
      db.close()
    }
  })

  it('queues a reused-session run when the session is busy and drains it once idle', async () => {
    const { SessionBusyError } = await import('@/session/turn')
    const harness = createHarness()
    const sessionEvents = new SessionRuntimeEvents()
    let sessionBusy = true
    const sentPrompts: string[] = []
    const sharedSession = {
      id: 'shared-1',
      agentId: 'agent-1',
      isDraft: false,
      sessionKind: 'regular' as const
    }
    const starter = serviceModule!.createCronJobRunSessionStarter({
      lifecycle: { createDetachedSession: vi.fn() },
      turn: {
        sendMessage: vi.fn(async (sessionId, content, options) => {
          if (options?.rejectIfBusy && sessionBusy) {
            throw new SessionBusyError(sessionId)
          }
          sentPrompts.push(content)
          options?.onBeforeSubmit?.()
          sessionEvents.publish({
            sessionId,
            kind: 'status',
            status: 'generating',
            messageId: 'cron-msg-1',
            requestId: 'cron-req-1',
            submissionId: options?.submissionId,
            updatedAt: Date.now()
          })
          sessionEvents.publish({
            sessionId,
            kind: 'status',
            status: 'idle',
            messageId: 'cron-msg-1',
            requestId: 'cron-req-1',
            updatedAt: Date.now()
          })
          return { requestId: 'cron-req-1', messageId: 'cron-msg-1' }
        }),
        cancelGeneration: vi.fn(async () => undefined),
        cancelGenerationByEventId: vi.fn(async () => true)
      },
      agentCatalog: { getAgentType: vi.fn(async () => 'deepchat' as const) },
      sessions: { get: (id) => (id === sharedSession.id ? (sharedSession as never) : null) }
    })

    const deps = createRequiredSchedulerDeps(sessionEvents)
    const service = new SchedulerServiceCtor({
      ...deps,
      database: harness.sqlitePresenter,
      sessions: { get: (id) => (id === sharedSession.id ? (sharedSession as never) : null) },
      runSessionStarter: starter,
      schedulerManager: {
        getStatus: () => ({
          state: 'idle',
          pid: null,
          enabledJobCount: 0,
          nextRunAt: null,
          lastHeartbeatAt: null,
          lastError: null,
          restartAttempts: 0,
          updatedAt: 0
        }),
        reconcile: vi.fn(async () => ({
          state: 'idle',
          pid: null,
          enabledJobCount: 0,
          nextRunAt: null,
          lastHeartbeatAt: null,
          lastError: null,
          restartAttempts: 0,
          updatedAt: 0
        })),
        restart: vi.fn(),
        stop: vi.fn(async () => undefined)
      } as never
    })

    try {
      const { job } = await service.upsert({
        name: 'Queue on busy',
        enabled: true,
        cronExpr: '0 9 * * *',
        timezone: 'UTC',
        agentId: 'agent-1',
        taskPrompt: 'Queued report',
        sessionMode: 'reuse_session',
        reuseSessionId: sharedSession.id,
        runtime: {
          maxDurationMs: 60_000,
          maxTurns: 20,
          concurrencyPolicy: 'queue'
        }
      })

      const firstAttempt = await service.runNow(job.id)
      expect(firstAttempt.run.status).toBe('queued')
      expect(sentPrompts).toEqual([])

      // User finishes chatting in the shared session -> queued cron run drains automatically.
      sessionBusy = false
      sessionEvents.publish({
        sessionId: sharedSession.id,
        kind: 'status',
        status: 'idle',
        messageId: 'user-msg-done',
        requestId: 'user-req-done',
        updatedAt: Date.now()
      })
      await vi.waitFor(() => {
        expect(service.getRun(firstAttempt.run.id).status).toBe('completed')
      })
      expect(sentPrompts).toEqual(['Queued report'])
    } finally {
      await service.destroy()
      harness.db.close()
    }
  })

  it('drains persisted queued runs when the scheduler starts', async () => {
    const harness = createHarness()
    const sessionEvents = new SessionRuntimeEvents()
    const repository = new CronJobsRepositoryCtor(harness.sqlitePresenter as never)
    const job = repository.upsertJob({
      name: 'Startup queued job',
      enabled: true,
      cronExpr: '0 9 * * *',
      timezone: 'UTC',
      agentId: 'agent-1',
      taskPrompt: 'Resume after restart'
    })
    const queuedRun = repository.queueRun({
      jobId: job.id,
      scheduledAt: Date.now(),
      reason: 'scheduled'
    })
    const starter = {
      createSessionForRun: vi.fn(async () => ({ sessionId: 'session-startup-1' })),
      startSessionRun: vi.fn(async () => {
        sessionEvents.publish({
          sessionId: 'session-startup-1',
          kind: 'status',
          status: 'generating',
          messageId: 'msg-1',
          requestId: 'req-1',
          updatedAt: Date.now()
        })
        sessionEvents.publish({
          sessionId: 'session-startup-1',
          kind: 'status',
          status: 'idle',
          messageId: 'msg-1',
          requestId: 'req-1',
          updatedAt: Date.now()
        })
        return { outputMessageId: 'msg-1', outputRequestId: 'req-1' }
      }),
      cancelSessionRun: vi.fn(async () => undefined)
    }
    const status = baseStatus()
    const service = new SchedulerServiceCtor({
      ...createRequiredSchedulerDeps(sessionEvents),
      database: harness.sqlitePresenter as never,
      runSessionStarter: starter as never,
      schedulerManager: {
        reconcile: vi.fn().mockResolvedValue(status),
        restart: vi.fn().mockResolvedValue(status),
        stop: vi.fn().mockResolvedValue(status),
        getStatus: vi.fn(() => status)
      } as never
    })

    try {
      service.start()
      await vi.waitFor(() => {
        expect(service.getRun(queuedRun.id).status).toBe('completed')
      })
      expect(starter.startSessionRun).toHaveBeenCalledTimes(1)
    } finally {
      await service.destroy()
      harness.db.close()
    }
  })

  it('drains more than 50 persisted queued runs on startup across cursor batches', async () => {
    const harness = createHarness()
    const sessionEvents = new SessionRuntimeEvents()
    const repository = new CronJobsRepositoryCtor(harness.sqlitePresenter as never)
    const runIds: string[] = []
    for (let i = 0; i < 55; i += 1) {
      const job = repository.upsertJob({
        name: `Batch job ${i}`,
        enabled: true,
        cronExpr: '0 9 * * *',
        timezone: 'UTC',
        agentId: 'agent-1',
        taskPrompt: `Run ${i}`
      })
      const run = repository.queueRun({
        jobId: job.id,
        scheduledAt: 1_000 + i,
        reason: 'scheduled',
        now: 1_000 + i
      })
      runIds.push(run.id)
    }
    const starter = {
      createSessionForRun: vi.fn(async ({ run }: { run: { id: string } }) => ({
        sessionId: `session-${run.id}`
      })),
      startSessionRun: vi.fn(async ({ sessionId }: { sessionId: string }) => {
        sessionEvents.publish({
          sessionId,
          kind: 'status',
          status: 'generating',
          messageId: `msg-${sessionId}`,
          requestId: `req-${sessionId}`,
          updatedAt: Date.now()
        })
        sessionEvents.publish({
          sessionId,
          kind: 'status',
          status: 'idle',
          messageId: `msg-${sessionId}`,
          requestId: `req-${sessionId}`,
          updatedAt: Date.now()
        })
        return { outputMessageId: `msg-${sessionId}`, outputRequestId: `req-${sessionId}` }
      }),
      cancelSessionRun: vi.fn(async () => undefined)
    }
    const status = baseStatus()
    const service = new SchedulerServiceCtor({
      ...createRequiredSchedulerDeps(sessionEvents),
      database: harness.sqlitePresenter as never,
      runSessionStarter: starter as never,
      schedulerManager: {
        reconcile: vi.fn().mockResolvedValue(status),
        restart: vi.fn().mockResolvedValue(status),
        stop: vi.fn().mockResolvedValue(status),
        getStatus: vi.fn(() => status)
      } as never
    })

    try {
      service.start()
      await vi.waitFor(() => {
        expect(repository.listQueuedRuns()).toEqual([])
      })
      expect(starter.startSessionRun).toHaveBeenCalledTimes(55)
      expect(service.getRun(runIds[54]!).status).toBe('completed')
    } finally {
      await service.destroy()
      harness.db.close()
    }
  })

  it('preserves concurrent first-run reuseSessionId across upsert, toggle, and reconcile, and rejects stale agent bind', async () => {
    const harness = createHarness()
    const sessionEvents = new SessionRuntimeEvents()
    const repository = new CronJobsRepositoryCtor(harness.sqlitePresenter as never)
    let resolveAgentList!: () => void
    const listGate = new Promise<void>((resolve) => {
      resolveAgentList = resolve
    })
    let gateEnabled = false
    const agentSettings = {
      listAgents: vi.fn(async () => {
        if (gateEnabled) {
          await listGate
        }
        return [
          { id: 'agent-1', name: 'Agent 1', type: 'deepchat' as const, enabled: true },
          { id: 'agent-2', name: 'Agent 2', type: 'deepchat' as const, enabled: true }
        ]
      }),
      resolveDeepChatAgentConfig: vi.fn(async () => null)
    }
    const status = baseStatus()
    const service = new SchedulerServiceCtor({
      ...createRequiredSchedulerDeps(sessionEvents),
      database: harness.sqlitePresenter as never,
      agentSettings: agentSettings as never,
      schedulerManager: {
        reconcile: vi.fn().mockResolvedValue(status),
        restart: vi.fn().mockResolvedValue(status),
        stop: vi.fn().mockResolvedValue(status),
        getStatus: vi.fn(() => status)
      } as never
    })

    try {
      const { job } = await service.upsert({
        name: 'Concurrent bind job',
        enabled: true,
        cronExpr: '0 9 * * *',
        timezone: 'UTC',
        agentId: 'agent-1',
        taskPrompt: 'Daily report',
        sessionMode: 'reuse_session',
        reuseSessionId: null
      })

      gateEnabled = true
      const pendingUpsert = service.upsert({
        id: job.id,
        name: 'Renamed concurrently',
        enabled: true,
        cronExpr: '0 9 * * *',
        timezone: 'UTC',
        agentId: 'agent-1',
        taskPrompt: 'Daily report',
        sessionMode: 'reuse_session'
      })
      // Background first run binds reuseSessionId while upsert is awaiting computeJobState.
      expect(repository.bindJobReuseSessionId(job.id, 'bound-session-1', 'agent-1')).not.toBeNull()
      resolveAgentList()
      const updated = await pendingUpsert
      expect(updated.job.name).toBe('Renamed concurrently')
      expect(updated.job.reuseSessionId).toBe('bound-session-1')

      // Toggle preserves reuseSessionId even when updating enabled/state.
      gateEnabled = false
      const toggled = await service.toggle(job.id, false)
      expect(toggled.job.reuseSessionId).toBe('bound-session-1')

      // Binding with a mismatched agentId fails closed.
      const { job: secondJob } = await service.upsert({
        name: 'Agent switched job',
        enabled: true,
        cronExpr: '0 9 * * *',
        timezone: 'UTC',
        agentId: 'agent-2',
        taskPrompt: 'Switch test',
        sessionMode: 'reuse_session',
        reuseSessionId: null
      })
      expect(
        repository.bindJobReuseSessionId(secondJob.id, 'old-agent-session', 'agent-1')
      ).toBeNull()
      expect(repository.getJob(secondJob.id)?.reuseSessionId).toBeNull()
    } finally {
      await service.destroy()
      harness.db.close()
    }
  })

  it('drains a requeued run when the user turn finishes while the busy response is in flight', async () => {
    const { SessionBusyError } = await import('@/session/turn')
    const harness = createHarness()
    const sessionEvents = new SessionRuntimeEvents()
    let busy = true
    let attempt = 0
    const sharedSession = {
      id: 'shared-race-1',
      agentId: 'agent-1',
      isDraft: false,
      sessionKind: 'regular' as const
    }
    const starter = serviceModule!.createCronJobRunSessionStarter({
      lifecycle: { createDetachedSession: vi.fn() },
      turn: {
        sendMessage: vi.fn(async (sessionId, _content, options) => {
          attempt += 1
          options?.onBeforeSubmit?.()
          if (attempt === 1) {
            // User turn completes while the busy rejection is still in flight.
            busy = false
            sessionEvents.publish({
              sessionId,
              kind: 'status',
              status: 'idle',
              messageId: 'user-msg-1',
              requestId: 'user-req-1',
              updatedAt: Date.now()
            })
            throw new SessionBusyError(sessionId)
          }
          sessionEvents.publish({
            sessionId,
            kind: 'status',
            status: 'generating',
            messageId: 'cron-msg-2',
            requestId: 'cron-req-2',
            submissionId: options?.submissionId,
            updatedAt: Date.now()
          })
          sessionEvents.publish({
            sessionId,
            kind: 'status',
            status: 'idle',
            messageId: 'cron-msg-2',
            requestId: 'cron-req-2',
            updatedAt: Date.now()
          })
          return { requestId: 'cron-req-2', messageId: 'cron-msg-2' }
        }),
        cancelGeneration: vi.fn(async () => undefined),
        isSessionBusy: vi.fn(async () => busy)
      },
      agentCatalog: { getAgentType: vi.fn(async () => 'deepchat' as const) },
      sessions: { get: (id) => (id === sharedSession.id ? (sharedSession as never) : null) }
    })
    const status = baseStatus()
    const service = new SchedulerServiceCtor({
      ...createRequiredSchedulerDeps(sessionEvents),
      database: harness.sqlitePresenter as never,
      sessions: { get: (id) => (id === sharedSession.id ? (sharedSession as never) : null) },
      runSessionStarter: starter,
      schedulerManager: {
        reconcile: vi.fn().mockResolvedValue(status),
        restart: vi.fn().mockResolvedValue(status),
        stop: vi.fn().mockResolvedValue(status),
        getStatus: vi.fn(() => status)
      } as never
    })

    try {
      const { job } = await service.upsert({
        name: 'Race drain job',
        enabled: true,
        cronExpr: '0 9 * * *',
        timezone: 'UTC',
        agentId: 'agent-1',
        taskPrompt: 'Drain after in-flight idle',
        sessionMode: 'reuse_session',
        reuseSessionId: sharedSession.id,
        runtime: {
          maxDurationMs: 60_000,
          maxTurns: 20,
          concurrencyPolicy: 'queue'
        }
      })

      const result = await service.runNow(job.id)
      await vi.waitFor(() => {
        expect(service.getRun(result.run.id).status).toBe('completed')
      })
      expect(attempt).toBe(2)
    } finally {
      await service.destroy()
      harness.db.close()
    }
  })

  it('does not spin on isSessionBusy when a second job waits on another cron run reservation and wakes when it releases', async () => {
    const harness = createHarness()
    const sessionEvents = new SessionRuntimeEvents()
    const sharedSession = {
      id: 'shared-reserved-1',
      agentId: 'agent-1',
      isDraft: false,
      sessionKind: 'regular' as const
    }
    let releaseFirstStart!: () => void
    const firstStartGate = new Promise<void>((resolve) => {
      releaseFirstStart = resolve
    })
    let firstStartEntered = false
    const isSessionBusy = vi.fn(async () => false)
    const startedJobIds: string[] = []

    const starter = {
      createSessionForRun: vi.fn(async () => ({
        sessionId: sharedSession.id,
        reused: true
      })),
      startSessionRun: vi.fn(async ({ job, onBeforeSubmit }) => {
        startedJobIds.push(job.id)
        const subId = `cron:${job.id}`
        onBeforeSubmit?.({ submissionId: subId })
        if (startedJobIds.length === 1) {
          firstStartEntered = true
          await firstStartGate
        }
        sessionEvents.publish({
          sessionId: sharedSession.id,
          kind: 'status',
          status: 'generating',
          messageId: `msg-${startedJobIds.length}`,
          requestId: `req-${startedJobIds.length}`,
          submissionId: subId,
          updatedAt: Date.now()
        })
        sessionEvents.publish({
          sessionId: sharedSession.id,
          kind: 'status',
          status: 'idle',
          messageId: `msg-${startedJobIds.length}`,
          requestId: `req-${startedJobIds.length}`,
          updatedAt: Date.now()
        })
        return {
          outputMessageId: `msg-${startedJobIds.length}`,
          outputRequestId: `req-${startedJobIds.length}`,
          expectedSubmissionId: subId
        }
      }),
      cancelSessionRun: vi.fn(async () => undefined),
      isSessionBusy
    }
    const status = baseStatus()
    const service = new SchedulerServiceCtor({
      ...createRequiredSchedulerDeps(sessionEvents),
      database: harness.sqlitePresenter as never,
      sessions: { get: (id) => (id === sharedSession.id ? (sharedSession as never) : null) },
      runSessionStarter: starter as never,
      schedulerManager: {
        reconcile: vi.fn().mockResolvedValue(status),
        restart: vi.fn().mockResolvedValue(status),
        stop: vi.fn().mockResolvedValue(status),
        getStatus: vi.fn(() => status)
      } as never
    })

    try {
      const { job: jobA } = await service.upsert({
        name: 'Reserved job A',
        enabled: true,
        cronExpr: '0 9 * * *',
        timezone: 'UTC',
        agentId: 'agent-1',
        taskPrompt: 'Job A',
        sessionMode: 'reuse_session',
        reuseSessionId: sharedSession.id,
        runtime: { maxDurationMs: 60_000, maxTurns: 20, concurrencyPolicy: 'queue' }
      })
      const { job: jobB } = await service.upsert({
        name: 'Reserved job B',
        enabled: true,
        cronExpr: '0 9 * * *',
        timezone: 'UTC',
        agentId: 'agent-1',
        taskPrompt: 'Job B',
        sessionMode: 'reuse_session',
        reuseSessionId: sharedSession.id,
        runtime: { maxDurationMs: 60_000, maxTurns: 20, concurrencyPolicy: 'queue' }
      })

      const runAPromise = service.runNow(jobA.id)
      await vi.waitFor(() => expect(firstStartEntered).toBe(true))

      const runBResult = await service.runNow(jobB.id)
      expect(runBResult.run.status).toBe('queued')
      expect(isSessionBusy).not.toHaveBeenCalled()

      releaseFirstStart()
      const runAResult = await runAPromise
      expect(runAResult.run.status).toBe('completed')

      await vi.waitFor(() => {
        expect(service.getRun(runBResult.run.id).status).toBe('completed')
      })
      expect(startedJobIds).toEqual([jobA.id, jobB.id])
    } finally {
      await service.destroy()
      harness.db.close()
    }
  })

  it('aborts an in-flight startSessionRun signal on pre-admission timeout and scopes first auto-bound reuse runs', async () => {
    vi.useFakeTimers()
    const now = Date.parse('2026-07-04T00:00:00.000Z')
    const job = {
      id: 'job-first-reuse',
      name: 'First reuse job',
      agentId: 'agent-1',
      sessionMode: 'reuse_session',
      reuseSessionId: null,
      runtime: {
        maxDurationMs: 15,
        maxTurns: 20,
        concurrencyPolicy: 'skip'
      }
    } as CronJob
    let storedRun: CronJobRun = {
      id: 'run-first-1',
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
    const repository = {
      claimRun: vi.fn(() => storedRun),
      getJob: vi.fn(() => job),
      getRun: vi.fn(() => storedRun),
      bindJobReuseSessionId: vi.fn((_id: string, sessionId: string) => ({
        ...job,
        reuseSessionId: sessionId
      })),
      countActiveRunsByJob: vi.fn(() => 0),
      countActiveRunsBySession: vi.fn(() => 0),
      updateRunSession: vi.fn((_id: string, sessionId: string) => {
        storedRun = { ...storedRun, sessionId }
        return storedRun
      }),
      updateRunOutput: vi.fn(),
      markRunFailed: vi.fn((_id: string, error: string) => {
        storedRun = { ...storedRun, status: 'failed', error }
        return storedRun
      })
    }
    let receivedSignal: AbortSignal | undefined
    let receivedReused: boolean | undefined
    let resolveStart!: () => void
    const startGate = new Promise<void>((resolve) => {
      resolveStart = resolve
    })
    const sessionStarter = {
      createSessionForRun: vi.fn(async () => ({
        sessionId: 'first-reuse-session',
        createdReuseSession: true
      })),
      startSessionRun: vi.fn(async ({ reused, signal, onBeforeSubmit }) => {
        receivedReused = reused
        receivedSignal = signal
        onBeforeSubmit?.({ submissionId: 'cron:first-1:sub' })
        await startGate
        return { expectedSubmissionId: 'cron:first-1:sub' }
      }),
      cancelSessionRun: vi.fn(async () => undefined)
    }
    const deliveryRouter = { deliver: vi.fn(async () => []) }
    const executor = new CronJobRunExecutor(
      repository as never,
      sessionStarter as never,
      deliveryRouter as never,
      new SessionRuntimeEvents()
    )

    try {
      const execPromise = executor.execute({ runId: storedRun.id, job })
      await vi.advanceTimersByTimeAsync(15)
      expect(receivedReused).toBe(true)
      expect(receivedSignal?.aborted).toBe(true)
      expect(sessionStarter.cancelSessionRun).toHaveBeenCalledWith(
        expect.objectContaining({
          sessionId: 'first-reuse-session',
          submissionId: 'cron:first-1:sub',
          allowSessionWideCancel: false
        })
      )
      resolveStart()
      await execPromise
    } finally {
      executor.dispose()
      vi.useRealTimers()
    }
  })

  it('keeps timed-out failed status when a late SessionBusyError arrives and wakes waiting jobs when a skip run releases', async () => {
    const { SessionBusyError } = await import('@/session/turn')
    vi.useFakeTimers()
    const now = Date.parse('2026-07-04T00:00:00.000Z')
    const job = {
      id: 'job-skip-timeout',
      name: 'Skip timeout job',
      agentId: 'agent-1',
      sessionMode: 'reuse_session',
      reuseSessionId: 'shared-1',
      runtime: {
        maxDurationMs: 10,
        maxTurns: 20,
        concurrencyPolicy: 'skip'
      }
    } as CronJob
    let storedRun: CronJobRun = {
      id: 'run-timeout-busy',
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
    const repository = {
      claimRun: vi.fn(() => storedRun),
      getJob: vi.fn(() => job),
      getRun: vi.fn(() => storedRun),
      countActiveRunsByJob: vi.fn(() => 0),
      countActiveRunsBySession: vi.fn(() => 0),
      updateRunSession: vi.fn((_id: string, sessionId: string) => {
        storedRun = { ...storedRun, sessionId }
        return storedRun
      }),
      updateRunOutput: vi.fn(),
      markRunFailed: vi.fn((_id: string, error: string) => {
        storedRun = { ...storedRun, status: 'failed', error }
        return storedRun
      }),
      markRunCancelled: vi.fn((_id: string, error: string) => {
        storedRun = { ...storedRun, status: 'cancelled', error }
        return storedRun
      }),
      releaseRunQueued: vi.fn()
    }
    let rejectStart!: (error: unknown) => void
    const startGate = new Promise<never>((_resolve, reject) => {
      rejectStart = reject
    })
    const sessionStarter = {
      createSessionForRun: vi.fn(async () => ({ sessionId: 'shared-1', reused: true })),
      startSessionRun: vi.fn(async ({ onBeforeSubmit }) => {
        onBeforeSubmit?.({ submissionId: 'cron:timeout-busy:1' })
        return await startGate
      }),
      cancelSessionRun: vi.fn(async () => undefined),
      isSessionBusy: vi.fn(async () => false)
    }
    const deliveryRouter = { deliver: vi.fn(async () => []) }
    const executor = new CronJobRunExecutor(
      repository as never,
      sessionStarter as never,
      deliveryRouter as never,
      new SessionRuntimeEvents()
    )

    try {
      const execPromise = executor.execute({ runId: storedRun.id, job })
      await vi.advanceTimersByTimeAsync(10)
      expect(storedRun.status).toBe('failed')

      rejectStart(new SessionBusyError('shared-1'))
      const finalRun = await execPromise
      expect(finalRun?.status).toBe('failed')
      expect(repository.markRunCancelled).not.toHaveBeenCalled()
      expect(repository.releaseRunQueued).not.toHaveBeenCalled()
    } finally {
      executor.dispose()
      vi.useRealTimers()
    }
  })
})
