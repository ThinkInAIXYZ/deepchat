import {
  cronJobsDeleteRoute,
  cronJobsGetRunRoute,
  cronJobsGetSchedulerStatusRoute,
  cronJobsListDeliveriesRoute,
  cronJobsListRoute,
  cronJobsListRunsRoute,
  cronJobsPreviewScheduleRoute,
  cronJobsReconcileSchedulerRoute,
  cronJobsRestartSchedulerRoute,
  cronJobsRunNowRoute,
  cronJobsToggleRoute,
  cronJobsUpsertRoute,
  cronJobsValidateScheduleRoute
} from '@shared/contracts/routes'
import { createRouteMap, type DeepchatRouteMap } from '@/routes/routeRegistry'
import type { SchedulerService } from './index'

export function createSchedulerRoutes(scheduler: SchedulerService): DeepchatRouteMap {
  return createRouteMap([
    [
      cronJobsListRoute.name,
      async (rawInput) => {
        cronJobsListRoute.input.parse(rawInput)
        const { jobs, schedulerStatus } = await scheduler.list()
        return cronJobsListRoute.output.parse({ jobs, schedulerStatus })
      }
    ],
    [
      cronJobsUpsertRoute.name,
      async (rawInput) => {
        const input = cronJobsUpsertRoute.input.parse(rawInput)
        const { job, schedulerStatus } = await scheduler.upsert(input)
        return cronJobsUpsertRoute.output.parse({ job, schedulerStatus })
      }
    ],
    [
      cronJobsDeleteRoute.name,
      async (rawInput) => {
        const input = cronJobsDeleteRoute.input.parse(rawInput)
        return cronJobsDeleteRoute.output.parse({
          schedulerStatus: await scheduler.delete(input.id)
        })
      }
    ],
    [
      cronJobsToggleRoute.name,
      async (rawInput) => {
        const input = cronJobsToggleRoute.input.parse(rawInput)
        const { job, schedulerStatus } = await scheduler.toggle(input.id, input.enabled)
        return cronJobsToggleRoute.output.parse({ job, schedulerStatus })
      }
    ],
    [
      cronJobsRunNowRoute.name,
      async (rawInput) => {
        const input = cronJobsRunNowRoute.input.parse(rawInput)
        const { job, run, schedulerStatus } = await scheduler.runNow(input.id)
        return cronJobsRunNowRoute.output.parse({ job, run, schedulerStatus })
      }
    ],
    [
      cronJobsListRunsRoute.name,
      async (rawInput) => {
        const input = cronJobsListRunsRoute.input.parse(rawInput)
        return cronJobsListRunsRoute.output.parse({
          runs: scheduler.listRuns(input.jobId, input.limit)
        })
      }
    ],
    [
      cronJobsGetRunRoute.name,
      async (rawInput) => {
        const input = cronJobsGetRunRoute.input.parse(rawInput)
        return cronJobsGetRunRoute.output.parse({ run: scheduler.getRun(input.runId) })
      }
    ],
    [
      cronJobsListDeliveriesRoute.name,
      async (rawInput) => {
        const input = cronJobsListDeliveriesRoute.input.parse(rawInput)
        return cronJobsListDeliveriesRoute.output.parse({
          deliveries: scheduler.listDeliveries(input.runId)
        })
      }
    ],
    [
      cronJobsGetSchedulerStatusRoute.name,
      async (rawInput) => {
        cronJobsGetSchedulerStatusRoute.input.parse(rawInput)
        return cronJobsGetSchedulerStatusRoute.output.parse({
          schedulerStatus: scheduler.getSchedulerStatus()
        })
      }
    ],
    [
      cronJobsReconcileSchedulerRoute.name,
      async (rawInput) => {
        const input = cronJobsReconcileSchedulerRoute.input.parse(rawInput)
        return cronJobsReconcileSchedulerRoute.output.parse({
          schedulerStatus: await scheduler.reconcileScheduler(input.reason)
        })
      }
    ],
    [
      cronJobsRestartSchedulerRoute.name,
      async (rawInput) => {
        cronJobsRestartSchedulerRoute.input.parse(rawInput)
        return cronJobsRestartSchedulerRoute.output.parse({
          schedulerStatus: await scheduler.restartScheduler()
        })
      }
    ],
    [
      cronJobsValidateScheduleRoute.name,
      async (rawInput) => {
        const input = cronJobsValidateScheduleRoute.input.parse(rawInput)
        return cronJobsValidateScheduleRoute.output.parse(scheduler.validateSchedule(input))
      }
    ],
    [
      cronJobsPreviewScheduleRoute.name,
      async (rawInput) => {
        const input = cronJobsPreviewScheduleRoute.input.parse(rawInput)
        return cronJobsPreviewScheduleRoute.output.parse(scheduler.previewSchedule(input))
      }
    ]
  ])
}
