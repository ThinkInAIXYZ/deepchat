import type { DeepchatBridge } from '@shared/contracts/bridge'
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
  enabled: true,
  cronExpr: '0 9 * * *',
  timezone: 'UTC',
  agentId: null,
  nextRunAt: null,
  misfirePolicy: 'skip' as const,
  maxCatchUpRuns: null,
  scheduleError: null,
  createdAt: 1,
  updatedAt: 2
}

const run = {
  id: 'run-1',
  jobId: 'cron-1',
  scheduledAt: 3,
  queuedAt: 3,
  startedAt: 4,
  completedAt: 5,
  status: 'completed' as const,
  reason: 'manual' as const,
  error: null,
  createdAt: 3,
  updatedAt: 5
}

describe('CronJobsClient', () => {
  it('invokes Cron Jobs routes and parses typed responses', async () => {
    const bridge: DeepchatBridge = {
      invoke: vi.fn(async (routeName: string) => {
        switch (routeName) {
          case 'cronJobs.list':
            return { jobs: [job], schedulerStatus }
          case 'cronJobs.upsert':
          case 'cronJobs.toggle':
            return { job, schedulerStatus }
          case 'cronJobs.runNow':
            return { job, run, schedulerStatus }
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

    expect(await client.list()).toEqual({ jobs: [job], schedulerStatus })
    expect(
      await client.upsert({
        name: job.name,
        enabled: job.enabled,
        cronExpr: job.cronExpr,
        timezone: job.timezone,
        agentId: null,
        nextRunAt: null,
        misfirePolicy: 'skip',
        maxCatchUpRuns: null,
        scheduleError: null
      })
    ).toEqual({ job, schedulerStatus })
    expect(await client.toggle(job.id, false)).toEqual({ job, schedulerStatus })
    expect(await client.runNow(job.id)).toEqual({ job, run, schedulerStatus })
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
      agentId: null,
      nextRunAt: null,
      misfirePolicy: 'skip',
      maxCatchUpRuns: null,
      scheduleError: null
    })
    expect(bridge.invoke).toHaveBeenNthCalledWith(3, 'cronJobs.toggle', {
      id: job.id,
      enabled: false
    })
    expect(bridge.invoke).toHaveBeenNthCalledWith(4, 'cronJobs.runNow', {
      id: job.id
    })
    expect(bridge.invoke).toHaveBeenNthCalledWith(5, 'cronJobs.delete', {
      id: job.id
    })
    expect(bridge.invoke).toHaveBeenNthCalledWith(6, 'cronJobs.getSchedulerStatus', {})
    expect(bridge.invoke).toHaveBeenNthCalledWith(7, 'cronJobs.reconcileScheduler', {
      reason: 'test'
    })
    expect(bridge.invoke).toHaveBeenNthCalledWith(8, 'cronJobs.restartScheduler', {})
    expect(bridge.invoke).toHaveBeenNthCalledWith(9, 'cronJobs.validateSchedule', {
      cronExpr: '0 9 * * *',
      timezone: 'UTC'
    })
    expect(bridge.invoke).toHaveBeenNthCalledWith(10, 'cronJobs.previewSchedule', {
      cronExpr: '0 9 * * *',
      timezone: 'UTC',
      count: 3
    })
  })
})
