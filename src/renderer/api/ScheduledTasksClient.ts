import type { DeepchatBridge } from '@shared/contracts/bridge'
import {
  scheduledTasksDeleteRoute,
  scheduledTasksFireNowRoute,
  scheduledTasksGetSchedulerStatusRoute,
  scheduledTasksListRoute,
  scheduledTasksListRunsRoute,
  scheduledTasksReconcileNowRoute,
  scheduledTasksRestartSchedulerRoute,
  scheduledTasksToggleRoute,
  scheduledTasksUpsertRoute,
  scheduledTaskRunSchema,
  scheduledTasksSettingsSchema,
  scheduledTaskSchema,
  schedulerProcessStatusSchema,
  type scheduledTasksUpsertInputSchema
} from '@shared/contracts/routes/scheduledTasks.routes'
import type { z } from 'zod'
import { getDeepchatBridge } from './core'

export type ScheduledTasksUpsertInput = z.input<typeof scheduledTasksUpsertInputSchema>

const parseSettingsResponse = (routeName: string, result: unknown) => {
  if (typeof result !== 'object' || result === null) {
    throw new Error(`[ScheduledTasksClient] Invalid response shape from ${routeName}`)
  }
  const maybe = (result as { settings?: unknown }).settings
  const parsed = scheduledTasksSettingsSchema.safeParse(maybe)
  if (!parsed.success) {
    throw new Error(`[ScheduledTasksClient] Invalid settings response from ${routeName}`)
  }
  return parsed.data
}

const parseTaskResponse = (routeName: string, result: unknown) => {
  if (typeof result !== 'object' || result === null) {
    throw new Error(`[ScheduledTasksClient] Invalid response shape from ${routeName}`)
  }
  const maybeTask = (result as { task?: unknown }).task
  const parsedTask = scheduledTaskSchema.safeParse(maybeTask)
  if (!parsedTask.success) {
    throw new Error(`[ScheduledTasksClient] Invalid task response from ${routeName}`)
  }
  return parsedTask.data
}

const parseStatusResponse = (routeName: string, result: unknown) => {
  if (typeof result !== 'object' || result === null) {
    throw new Error(`[ScheduledTasksClient] Invalid response shape from ${routeName}`)
  }
  const parsed = schedulerProcessStatusSchema.safeParse((result as { status?: unknown }).status)
  if (!parsed.success) {
    throw new Error(`[ScheduledTasksClient] Invalid status response from ${routeName}`)
  }
  return parsed.data
}

const parseRunsResponse = (routeName: string, result: unknown) => {
  if (typeof result !== 'object' || result === null) {
    throw new Error(`[ScheduledTasksClient] Invalid response shape from ${routeName}`)
  }
  const parsed = scheduledTaskRunSchema.array().safeParse((result as { runs?: unknown }).runs)
  if (!parsed.success) {
    throw new Error(`[ScheduledTasksClient] Invalid runs response from ${routeName}`)
  }
  return parsed.data
}

export function createScheduledTasksClient(bridge: DeepchatBridge = getDeepchatBridge()) {
  async function list() {
    const result = await bridge.invoke(scheduledTasksListRoute.name, {})
    return parseSettingsResponse(scheduledTasksListRoute.name, result)
  }

  async function upsert(input: ScheduledTasksUpsertInput) {
    const result = await bridge.invoke(scheduledTasksUpsertRoute.name, input)
    return {
      task: parseTaskResponse(scheduledTasksUpsertRoute.name, result),
      settings: parseSettingsResponse(scheduledTasksUpsertRoute.name, result)
    }
  }

  async function remove(id: string) {
    const result = await bridge.invoke(scheduledTasksDeleteRoute.name, { id })
    return parseSettingsResponse(scheduledTasksDeleteRoute.name, result)
  }

  async function toggle(id: string, enabled: boolean) {
    const result = await bridge.invoke(scheduledTasksToggleRoute.name, { id, enabled })
    return {
      task: parseTaskResponse(scheduledTasksToggleRoute.name, result),
      settings: parseSettingsResponse(scheduledTasksToggleRoute.name, result)
    }
  }

  async function fireNow(id: string) {
    const result = await bridge.invoke(scheduledTasksFireNowRoute.name, { id })
    return {
      task: parseTaskResponse(scheduledTasksFireNowRoute.name, result),
      settings: parseSettingsResponse(scheduledTasksFireNowRoute.name, result)
    }
  }

  async function getSchedulerStatus() {
    const result = await bridge.invoke(scheduledTasksGetSchedulerStatusRoute.name, {})
    return parseStatusResponse(scheduledTasksGetSchedulerStatusRoute.name, result)
  }

  async function listRuns(taskId: string, limit?: number) {
    const result = await bridge.invoke(scheduledTasksListRunsRoute.name, { taskId, limit })
    return parseRunsResponse(scheduledTasksListRunsRoute.name, result)
  }

  async function reconcileNow() {
    const result = await bridge.invoke(scheduledTasksReconcileNowRoute.name, {})
    return parseStatusResponse(scheduledTasksReconcileNowRoute.name, result)
  }

  async function restartScheduler() {
    const result = await bridge.invoke(scheduledTasksRestartSchedulerRoute.name, {})
    return parseStatusResponse(scheduledTasksRestartSchedulerRoute.name, result)
  }

  return {
    list,
    upsert,
    remove,
    toggle,
    fireNow,
    getSchedulerStatus,
    listRuns,
    reconcileNow,
    restartScheduler
  }
}

export type ScheduledTasksClient = ReturnType<typeof createScheduledTasksClient>
