import { randomUUID } from 'node:crypto'
import log from 'electron-log'
import { z } from 'zod'
import {
  SCHEDULED_TASK_DEFAULT_TIMEZONE,
  SCHEDULED_TASK_PERMISSION_PROFILES,
  SCHEDULED_TASK_CONCURRENCY_POLICIES,
  SCHEDULED_TASK_DELIVERY_TARGETS,
  SCHEDULED_TASKS_VERSION,
  type ScheduledTask,
  type ScheduledTaskAction,
  type ScheduledTaskContext,
  type ScheduledTaskDeliveryPolicy,
  type ScheduledTaskExecutionPolicy,
  type ScheduledTaskTrigger,
  type ScheduledTasksSettings,
  createDefaultScheduledTaskContext,
  createDefaultScheduledTaskDelivery,
  createDefaultScheduledTaskExecution,
  createDefaultScheduledTasksSettings
} from '@shared/scheduledTasks'
import { computeNextRunAt } from './schedulerCore/computeNextRunAt'

const TriggerSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('once'), firesAt: z.number().int().nonnegative() }),
  z.object({
    kind: z.literal('daily'),
    hour: z.number().int().min(0).max(23),
    minute: z.number().int().min(0).max(59)
  }),
  z.object({
    kind: z.literal('weekly'),
    dayOfWeek: z.number().int().min(0).max(6),
    hour: z.number().int().min(0).max(23),
    minute: z.number().int().min(0).max(59)
  })
])

const ActionSchema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('notify'),
    title: z.string().max(200),
    body: z.string().max(2000)
  }),
  z.object({
    kind: z.literal('prompt'),
    title: z.string().max(200),
    message: z.string().max(20000),
    autoSend: z.boolean(),
    agentId: z.string().optional(),
    providerId: z.string().optional(),
    modelId: z.string().optional(),
    systemPrompt: z.string().max(20000).optional()
  }),
  z.object({
    kind: z.literal('agent_run'),
    title: z.string().max(200),
    prompt: z.string().max(20000),
    outputFormat: z.enum(['message', 'markdown', 'json']).optional()
  })
])

const ContextSchema = z.object({
  sessionMode: z.literal('fresh'),
  workdir: z.string().max(2000).optional(),
  skillIds: z.array(z.string().min(1).max(200)).max(100)
})

const ExecutionSchema = z.object({
  agentId: z.string().optional(),
  providerId: z.string().optional(),
  modelId: z.string().optional(),
  systemPrompt: z.string().max(20000).optional(),
  permissionProfile: z.enum(SCHEDULED_TASK_PERMISSION_PROFILES),
  concurrencyPolicy: z.enum(SCHEDULED_TASK_CONCURRENCY_POLICIES)
})

const DeliverySchema = z.object({
  targets: z.array(z.enum(SCHEDULED_TASK_DELIVERY_TARGETS)).max(10),
  continuable: z.boolean(),
  suppressSuccess: z.boolean(),
  notifyOnFailure: z.boolean()
})

const ScheduledTaskSchema = z.object({
  id: z.string().min(1),
  version: z.literal(SCHEDULED_TASKS_VERSION),
  name: z.string().min(1).max(200),
  enabled: z.boolean(),
  trigger: TriggerSchema,
  action: ActionSchema,
  context: ContextSchema,
  execution: ExecutionSchema,
  delivery: DeliverySchema,
  timezone: z.string().min(1),
  nextRunAt: z.number().int().nonnegative().nullable(),
  lastRunId: z.string().min(1).nullable(),
  createdAt: z.number().int().nonnegative(),
  updatedAt: z.number().int().nonnegative(),
  lastFiredAt: z.number().int().nonnegative().nullable()
})

const LooseSchedulerSettingsSchema = z.object({
  version: z.unknown().optional(),
  tasks: z.array(z.unknown()).optional()
})

const sanitizeTrigger = (input: unknown): ScheduledTaskTrigger | null => {
  const parsed = TriggerSchema.safeParse(input)
  return parsed.success ? parsed.data : null
}

const sanitizeAction = (input: unknown): ScheduledTaskAction | null => {
  const parsed = ActionSchema.safeParse(input)
  return parsed.success ? parsed.data : null
}

const sanitizeContext = (input: unknown): ScheduledTaskContext => {
  const parsed = ContextSchema.safeParse(input)
  return parsed.success ? parsed.data : createDefaultScheduledTaskContext()
}

const sanitizeExecution = (input: unknown): ScheduledTaskExecutionPolicy => {
  const parsed = ExecutionSchema.safeParse(input)
  return parsed.success ? parsed.data : createDefaultScheduledTaskExecution()
}

const sanitizeDelivery = (input: unknown): ScheduledTaskDeliveryPolicy => {
  const parsed = DeliverySchema.safeParse(input)
  return parsed.success ? parsed.data : createDefaultScheduledTaskDelivery()
}

const sanitizeTask = (input: unknown, fallbackIndex: number, now: number): ScheduledTask | null => {
  if (!input || typeof input !== 'object') {
    return null
  }
  const record = input as Record<string, unknown>
  const trigger = sanitizeTrigger(record.trigger)
  const action = sanitizeAction(record.action)
  const context = sanitizeContext(record.context)
  const execution = sanitizeExecution(record.execution)
  const delivery = sanitizeDelivery(record.delivery)
  if (!trigger || !action) {
    return null
  }

  const id =
    typeof record.id === 'string' && record.id.trim().length > 0 ? record.id.trim() : randomUUID()
  const name =
    typeof record.name === 'string' && record.name.trim().length > 0
      ? record.name.trim().slice(0, 200)
      : `Task ${fallbackIndex + 1}`
  const enabled = record.enabled === true
  const createdAt =
    typeof record.createdAt === 'number' &&
    Number.isFinite(record.createdAt) &&
    record.createdAt > 0
      ? record.createdAt
      : now
  const lastFiredAt =
    typeof record.lastFiredAt === 'number' &&
    Number.isFinite(record.lastFiredAt) &&
    record.lastFiredAt > 0
      ? record.lastFiredAt
      : null
  const updatedAt =
    typeof record.updatedAt === 'number' &&
    Number.isFinite(record.updatedAt) &&
    record.updatedAt > 0
      ? record.updatedAt
      : createdAt
  const timezone =
    typeof record.timezone === 'string' && record.timezone.trim().length > 0
      ? record.timezone.trim()
      : getSystemTimezone()
  const lastRunId =
    typeof record.lastRunId === 'string' && record.lastRunId.trim().length > 0
      ? record.lastRunId.trim()
      : null

  const candidateWithoutNextRun = {
    id,
    version: SCHEDULED_TASKS_VERSION,
    name,
    enabled,
    trigger,
    action,
    context,
    execution,
    delivery,
    timezone,
    nextRunAt: null,
    lastRunId,
    createdAt,
    updatedAt,
    lastFiredAt
  }
  const nextRunAt =
    typeof record.nextRunAt === 'number' &&
    Number.isFinite(record.nextRunAt) &&
    record.nextRunAt >= 0
      ? record.nextRunAt
      : computeNextRunAt({ task: candidateWithoutNextRun, referenceTime: now })
  const candidate = { ...candidateWithoutNextRun, nextRunAt: enabled ? nextRunAt : null }
  const parsed = ScheduledTaskSchema.safeParse(candidate)
  return parsed.success ? parsed.data : null
}

const makeUniqueTaskId = (id: string, seenIds: Set<string>): string => {
  if (!seenIds.has(id)) {
    return id
  }

  let suffix = 2
  let nextId = `${id}-${suffix}`
  while (seenIds.has(nextId)) {
    suffix += 1
    nextId = `${id}-${suffix}`
  }
  return nextId
}

export const normalizeScheduledTasksConfig = (
  input: unknown,
  now: number = Date.now()
): ScheduledTasksSettings => {
  const defaults = createDefaultScheduledTasksSettings()
  const parsed = LooseSchedulerSettingsSchema.safeParse(input)
  if (!parsed.success) {
    log.warn('[ScheduledTasks] Invalid config, using defaults:', parsed.error?.message)
    return defaults
  }

  const rawTasks = Array.isArray(parsed.data.tasks) ? parsed.data.tasks : []
  const seenIds = new Set<string>()
  const tasks = rawTasks.reduce<ScheduledTask[]>((acc, candidate, index) => {
    const sanitized = sanitizeTask(candidate, index, now)
    if (sanitized) {
      const id = makeUniqueTaskId(sanitized.id, seenIds)
      seenIds.add(id)
      acc.push(id === sanitized.id ? sanitized : { ...sanitized, id })
    } else {
      log.warn(`[ScheduledTasks] Dropping malformed task at index ${index}`)
    }
    return acc
  }, [])

  return {
    version: SCHEDULED_TASKS_VERSION,
    tasks
  }
}

const startOfMinute = (timestamp: number): number => {
  const date = new Date(timestamp)
  date.setSeconds(0, 0)
  return date.getTime()
}

const getSystemTimezone = (): string => {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || SCHEDULED_TASK_DEFAULT_TIMEZONE
  } catch {
    return SCHEDULED_TASK_DEFAULT_TIMEZONE
  }
}

/**
 * Compute the next absolute timestamp at which `task` should fire, strictly
 * after `after`. Returns `null` if the task can no longer fire (one-shot
 * already fired or one-shot whose `firesAt` is in the past with respect to
 * `after` — backfill handling is up to the caller via `lastFiredAt`).
 */
export const computeNextFireAt = (task: ScheduledTask, after: number): number | null => {
  return computeNextRunAt({ task, referenceTime: after, misfirePolicy: 'skip' })
}

/**
 * Returns true when a one-shot task should be backfilled (fired immediately
 * on startup) because its `firesAt` is in the past and it has never been
 * fired. Recurring tasks are never backfilled.
 */
export const shouldBackfillOneShot = (task: ScheduledTask, now: number): boolean => {
  if (task.trigger.kind !== 'once') {
    return false
  }
  if (task.lastFiredAt) {
    return false
  }
  return task.trigger.firesAt <= now
}

export const startOfMinuteForTests = startOfMinute
