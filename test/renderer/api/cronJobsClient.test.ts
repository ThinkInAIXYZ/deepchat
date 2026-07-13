import type { DeepchatBridge } from '@shared/contracts/bridge'
import { reactive } from 'vue'
import { createCronJobsClient } from '../../../src/renderer/api/CronJobsClient'

const schedulerStatus = {
  state: 'idle' as const,
  pid: null,
  enabledJobCount: 1,
  nextRunAt: null,
  lastHeartbeatAt: null,
  lastError: null,
  restartAttempts: 0,
  updatedAt: 1
}

const job = {
  id: 'cron-1',
  name: 'Cron smoke',
  description: null,
  enabled: true,
  status: 'ready' as const,
  cronExpr: '0 9 * * *',
  timezone: 'UTC',
  agentId: 'agent-1',
  nextRunAt: null,
  misfirePolicy: 'skip' as const,
  maxCatchUpRuns: null,
  scheduleError: null,
  taskPrompt: 'Summarize issues',
  taskSystemInstruction: null,
  taskOutputMode: 'final_message' as const,
  modelPolicy: 'follow_agent' as const,
  toolPolicy: 'follow_agent' as const,
  permissionPolicy: 'follow_agent' as const,
  runtime: {
    maxDurationMs: 3_600_000,
    maxTurns: 20,
    concurrencyPolicy: 'skip' as const
  },
  agentSnapshot: null,
  delivery: {
    targets: [],
    suppressSuccessNotification: false,
    notifyOnFailure: true
  },
  createdAt: 1,
  updatedAt: 2
}

const run = {
  id: 'run-1',
  jobId: 'cron-1',
  sessionId: 'session-1',
  scheduledAt: 3,
  queuedAt: 3,
  startedAt: 4,
  completedAt: 5,
  status: 'completed' as const,
  reason: 'manual' as const,
  outputMessageId: null,
  outputPreview: null,
  error: null,
  claimedAt: 4,
  claimOwner: 'owner-1',
  createdAt: 3,
  updatedAt: 5
}

const delivery = {
  id: 'delivery-1',
  jobId: 'cron-1',
  runId: 'run-1',
  targetType: 'remote' as const,
  target: {
    type: 'remote' as const,
    remoteId: 'telegram',
    channelId: 'telegram:-100:0',
    mode: 'summary' as const
  },
  status: 'success' as const,
  remoteMessageId: null,
  error: null,
  createdAt: 6,
  updatedAt: 6
}

describe('CronJobsClient', () => {
  it('invokes Cron Jobs routes and parses typed responses', async () => {
    const bridge: DeepchatBridge = {
      invoke: vi.fn(async (routeName: string, input: unknown) => {
        structuredClone(input)
        switch (routeName) {
          case 'cronJobs.list':
            return { jobs: [job], schedulerStatus }
          case 'cronJobs.upsert':
          case 'cronJobs.toggle':
            return { job, schedulerStatus }
          case 'cronJobs.runNow':
            return { job, run, schedulerStatus }
          case 'cronJobs.listRuns':
            return { runs: [run] }
          case 'cronJobs.getRun':
            return { run }
          case 'cronJobs.listDeliveries':
            return { deliveries: [delivery] }
          case 'cronJobs.delete':
          case 'cronJobs.getSchedulerStatus':
          case 'cronJobs.reconcileScheduler':
          case 'cronJobs.restartScheduler':
            return { schedulerStatus }
          case 'cronJobs.validateSchedule':
            return { valid: true, error: null, nextRunAt: 10 }
          case 'cronJobs.previewSchedule':
            return { runs: [10, 20, 30], error: null }
          default:
            throw new Error(`Unexpected route: ${routeName}`)
        }
      }),
      on: vi.fn(() => () => undefined)
    }
    const client = createCronJobsClient(bridge)
    const runtime = reactive({ ...job.runtime })

    expect(await client.list()).toEqual({ jobs: [job], schedulerStatus })
    expect(
      await client.upsert({
        name: job.name,
        enabled: job.enabled,
        cronExpr: job.cronExpr,
        timezone: job.timezone,
        agentId: job.agentId,
        nextRunAt: null,
        misfirePolicy: 'skip',
        maxCatchUpRuns: null,
        scheduleError: null,
        taskPrompt: job.taskPrompt,
        taskSystemInstruction: null,
        taskOutputMode: 'final_message',
        modelPolicy: 'follow_agent',
        toolPolicy: 'follow_agent',
        permissionPolicy: 'follow_agent',
        runtime
      })
    ).toEqual({ job, schedulerStatus })
    expect(await client.toggle(job.id, false)).toEqual({ job, schedulerStatus })
    expect(await client.runNow(job.id)).toEqual({ job, run, schedulerStatus })
    expect(await client.listRuns(job.id, 3)).toEqual([run])
    expect(await client.getRun(run.id)).toEqual(run)
    expect(await client.listDeliveries(run.id)).toEqual([delivery])
    expect(await client.remove(job.id)).toEqual(schedulerStatus)
    expect(await client.getSchedulerStatus()).toEqual(schedulerStatus)
    expect(await client.reconcileScheduler('test')).toEqual(schedulerStatus)
    expect(await client.restartScheduler()).toEqual(schedulerStatus)
    expect(await client.validateSchedule({ cronExpr: '0 9 * * *', timezone: 'UTC' })).toEqual({
      valid: true,
      error: null,
      nextRunAt: 10
    })
    expect(
      await client.previewSchedule({ cronExpr: '0 9 * * *', timezone: 'UTC', count: 3 })
    ).toEqual({
      runs: [10, 20, 30],
      error: null
    })

    expect(bridge.invoke).toHaveBeenNthCalledWith(1, 'cronJobs.list', {})
    expect(bridge.invoke).toHaveBeenNthCalledWith(2, 'cronJobs.upsert', {
      name: job.name,
      enabled: job.enabled,
      cronExpr: job.cronExpr,
      timezone: job.timezone,
      agentId: job.agentId,
      nextRunAt: null,
      misfirePolicy: 'skip',
      maxCatchUpRuns: null,
      scheduleError: null,
      taskPrompt: job.taskPrompt,
      taskSystemInstruction: null,
      taskOutputMode: 'final_message',
      modelPolicy: 'follow_agent',
      toolPolicy: 'follow_agent',
      permissionPolicy: 'follow_agent',
      runtime: job.runtime
    })
    expect(bridge.invoke).toHaveBeenNthCalledWith(3, 'cronJobs.toggle', {
      id: job.id,
      enabled: false
    })
    expect(bridge.invoke).toHaveBeenNthCalledWith(4, 'cronJobs.runNow', {
      id: job.id
    })
    expect(bridge.invoke).toHaveBeenNthCalledWith(5, 'cronJobs.listRuns', {
      jobId: job.id,
      limit: 3
    })
    expect(bridge.invoke).toHaveBeenNthCalledWith(6, 'cronJobs.getRun', {
      runId: run.id
    })
    expect(bridge.invoke).toHaveBeenNthCalledWith(7, 'cronJobs.listDeliveries', {
      runId: run.id
    })
    expect(bridge.invoke).toHaveBeenNthCalledWith(8, 'cronJobs.delete', {
      id: job.id
    })
    expect(bridge.invoke).toHaveBeenNthCalledWith(9, 'cronJobs.getSchedulerStatus', {})
    expect(bridge.invoke).toHaveBeenNthCalledWith(10, 'cronJobs.reconcileScheduler', {
      reason: 'test'
    })
    expect(bridge.invoke).toHaveBeenNthCalledWith(11, 'cronJobs.restartScheduler', {})
    expect(bridge.invoke).toHaveBeenNthCalledWith(12, 'cronJobs.validateSchedule', {
      cronExpr: '0 9 * * *',
      timezone: 'UTC'
    })
    expect(bridge.invoke).toHaveBeenNthCalledWith(13, 'cronJobs.previewSchedule', {
      cronExpr: '0 9 * * *',
      timezone: 'UTC',
      count: 3
    })
  })
})
