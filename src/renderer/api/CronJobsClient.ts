import type { DeepchatBridge } from '@shared/contracts/bridge'
import {
  cronJobRunSchema,
  cronJobSchema,
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
  cronJobsSchedulerStatusSchema,
  cronJobsToggleRoute,
  cronJobsValidateScheduleRoute,
  cronJobsUpsertRoute,
  type cronJobsUpsertInputSchema
} from '@shared/contracts/routes/cronJobs.routes'
import type { z } from 'zod'
import { getDeepchatBridge } from './core'

export type CronJobsUpsertInput = z.input<typeof cronJobsUpsertInputSchema>

const toPlainIpcValue = <T>(value: T): T => {
  if (value === null || typeof value !== 'object') {
    return value
  }
  if (value instanceof Date) {
    return new Date(value.getTime()) as T
  }
  if (Array.isArray(value)) {
    return value.map((item) => toPlainIpcValue(item)) as T
  }

  const plain: Record<string, unknown> = {}
  for (const [key, nestedValue] of Object.entries(value as Record<string, unknown>)) {
    plain[key] = toPlainIpcValue(nestedValue)
  }
  return plain as T
}

const parseJobResponse = (routeName: string, result: unknown) => {
  if (typeof result !== 'object' || result === null) {
    throw new Error(`[CronJobsClient] Invalid response shape from ${routeName}`)
  }
  const parsed = cronJobSchema.safeParse((result as { job?: unknown }).job)
  if (!parsed.success) {
    throw new Error(`[CronJobsClient] Invalid job response from ${routeName}`)
  }
  return parsed.data
}

const parseRunResponse = (routeName: string, result: unknown) => {
  if (typeof result !== 'object' || result === null) {
    throw new Error(`[CronJobsClient] Invalid response shape from ${routeName}`)
  }
  const parsed = cronJobRunSchema.safeParse((result as { run?: unknown }).run)
  if (!parsed.success) {
    throw new Error(`[CronJobsClient] Invalid run response from ${routeName}`)
  }
  return parsed.data
}

const parseSchedulerStatusResponse = (routeName: string, result: unknown) => {
  if (typeof result !== 'object' || result === null) {
    throw new Error(`[CronJobsClient] Invalid response shape from ${routeName}`)
  }
  const parsed = cronJobsSchedulerStatusSchema.safeParse(
    (result as { schedulerStatus?: unknown }).schedulerStatus
  )
  if (!parsed.success) {
    throw new Error(`[CronJobsClient] Invalid scheduler status response from ${routeName}`)
  }
  return parsed.data
}

export function createCronJobsClient(bridge: DeepchatBridge = getDeepchatBridge()) {
  async function list() {
    const result = await bridge.invoke(cronJobsListRoute.name, {})
    if (typeof result !== 'object' || result === null) {
      throw new Error('[CronJobsClient] Invalid response shape from cronJobs.list')
    }
    const jobs = cronJobSchema.array().parse((result as { jobs?: unknown }).jobs)
    return {
      jobs,
      schedulerStatus: parseSchedulerStatusResponse(cronJobsListRoute.name, result)
    }
  }

  async function upsert(input: CronJobsUpsertInput) {
    const result = await bridge.invoke(cronJobsUpsertRoute.name, toPlainIpcValue(input))
    return {
      job: parseJobResponse(cronJobsUpsertRoute.name, result),
      schedulerStatus: parseSchedulerStatusResponse(cronJobsUpsertRoute.name, result)
    }
  }

  async function remove(id: string) {
    const result = await bridge.invoke(cronJobsDeleteRoute.name, { id })
    return parseSchedulerStatusResponse(cronJobsDeleteRoute.name, result)
  }

  async function toggle(id: string, enabled: boolean) {
    const result = await bridge.invoke(cronJobsToggleRoute.name, { id, enabled })
    return {
      job: parseJobResponse(cronJobsToggleRoute.name, result),
      schedulerStatus: parseSchedulerStatusResponse(cronJobsToggleRoute.name, result)
    }
  }

  async function runNow(id: string) {
    const result = await bridge.invoke(cronJobsRunNowRoute.name, { id })
    return {
      job: parseJobResponse(cronJobsRunNowRoute.name, result),
      run: parseRunResponse(cronJobsRunNowRoute.name, result),
      schedulerStatus: parseSchedulerStatusResponse(cronJobsRunNowRoute.name, result)
    }
  }

  async function listRuns(jobId: string, limit?: number) {
    const result = await bridge.invoke(cronJobsListRunsRoute.name, { jobId, limit })
    return cronJobsListRunsRoute.output.parse(result).runs
  }

  async function getRun(runId: string) {
    const result = await bridge.invoke(cronJobsGetRunRoute.name, { runId })
    return parseRunResponse(cronJobsGetRunRoute.name, result)
  }

  async function listDeliveries(runId: string) {
    return cronJobsListDeliveriesRoute.output.parse(
      await bridge.invoke(cronJobsListDeliveriesRoute.name, { runId })
    ).deliveries
  }

  async function getSchedulerStatus() {
    const result = await bridge.invoke(cronJobsGetSchedulerStatusRoute.name, {})
    return parseSchedulerStatusResponse(cronJobsGetSchedulerStatusRoute.name, result)
  }

  async function reconcileScheduler(reason?: string) {
    const result = await bridge.invoke(cronJobsReconcileSchedulerRoute.name, { reason })
    return parseSchedulerStatusResponse(cronJobsReconcileSchedulerRoute.name, result)
  }

  async function restartScheduler() {
    const result = await bridge.invoke(cronJobsRestartSchedulerRoute.name, {})
    return parseSchedulerStatusResponse(cronJobsRestartSchedulerRoute.name, result)
  }

  async function validateSchedule(input: { cronExpr: string; timezone: string; from?: number }) {
    return cronJobsValidateScheduleRoute.output.parse(
      await bridge.invoke(cronJobsValidateScheduleRoute.name, input)
    )
  }

  async function previewSchedule(input: {
    cronExpr: string
    timezone: string
    count?: number
    from?: number
  }) {
    return cronJobsPreviewScheduleRoute.output.parse(
      await bridge.invoke(cronJobsPreviewScheduleRoute.name, input)
    )
  }

  return {
    list,
    upsert,
    remove,
    toggle,
    runNow,
    listRuns,
    getRun,
    listDeliveries,
    getSchedulerStatus,
    reconcileScheduler,
    restartScheduler,
    validateSchedule,
    previewSchedule
  }
}

export type CronJobsClient = ReturnType<typeof createCronJobsClient>
