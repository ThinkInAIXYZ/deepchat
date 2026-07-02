import { z } from 'zod'
import { defineRouteContract } from '../common'
import {
  SCHEDULED_TASKS_VERSION,
  SCHEDULED_TASK_TRIGGER_KINDS,
  SCHEDULED_TASK_ACTION_KINDS,
  SCHEDULED_TASK_PERMISSION_PROFILES,
  SCHEDULED_TASK_CONCURRENCY_POLICIES,
  SCHEDULED_TASK_DELIVERY_TARGETS,
  SCHEDULED_TASK_RUN_STATUSES,
  SCHEDULED_TASK_RUN_REASONS,
  SCHEDULER_PROCESS_STATES
} from '../../scheduledTasks'

export const scheduledTaskTriggerKindSchema = z.enum(SCHEDULED_TASK_TRIGGER_KINDS)
export const scheduledTaskActionKindSchema = z.enum(SCHEDULED_TASK_ACTION_KINDS)

const hourSchema = z.number().int().min(0).max(23)
const minuteSchema = z.number().int().min(0).max(59)
const dayOfWeekSchema = z.number().int().min(0).max(6)

export const scheduledTaskTriggerSchema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('once'),
    firesAt: z.number().int().nonnegative()
  }),
  z.object({
    kind: z.literal('daily'),
    hour: hourSchema,
    minute: minuteSchema
  }),
  z.object({
    kind: z.literal('weekly'),
    dayOfWeek: dayOfWeekSchema,
    hour: hourSchema,
    minute: minuteSchema
  })
])

export const scheduledTaskActionSchema = z.discriminatedUnion('kind', [
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

export const scheduledTaskContextSchema = z.object({
  sessionMode: z.literal('fresh'),
  workdir: z.string().max(2000).optional(),
  skillIds: z.array(z.string().min(1).max(200)).max(100)
})

export const scheduledTaskExecutionPolicySchema = z.object({
  agentId: z.string().optional(),
  providerId: z.string().optional(),
  modelId: z.string().optional(),
  systemPrompt: z.string().max(20000).optional(),
  permissionProfile: z.enum(SCHEDULED_TASK_PERMISSION_PROFILES),
  concurrencyPolicy: z.enum(SCHEDULED_TASK_CONCURRENCY_POLICIES)
})

export const scheduledTaskDeliveryPolicySchema = z.object({
  targets: z.array(z.enum(SCHEDULED_TASK_DELIVERY_TARGETS)).max(10),
  continuable: z.boolean(),
  suppressSuccess: z.boolean(),
  notifyOnFailure: z.boolean()
})

export const scheduledTaskSchema = z.object({
  id: z.string().min(1),
  version: z.literal(SCHEDULED_TASKS_VERSION),
  name: z.string().min(1).max(200),
  enabled: z.boolean(),
  trigger: scheduledTaskTriggerSchema,
  action: scheduledTaskActionSchema,
  context: scheduledTaskContextSchema,
  execution: scheduledTaskExecutionPolicySchema,
  delivery: scheduledTaskDeliveryPolicySchema,
  timezone: z.string().min(1),
  nextRunAt: z.number().int().nonnegative().nullable(),
  lastRunId: z.string().min(1).nullable(),
  createdAt: z.number().int().nonnegative(),
  updatedAt: z.number().int().nonnegative(),
  lastFiredAt: z.number().int().nonnegative().nullable()
})

export const scheduledTasksSettingsSchema = z.object({
  version: z.literal(SCHEDULED_TASKS_VERSION),
  tasks: z.array(scheduledTaskSchema)
})

export const scheduledTaskRunStatusSchema = z.enum(SCHEDULED_TASK_RUN_STATUSES)
export const scheduledTaskRunReasonSchema = z.enum(SCHEDULED_TASK_RUN_REASONS)

export const scheduledTaskRunSchema = z.object({
  id: z.string().min(1),
  taskId: z.string().min(1),
  scheduledAt: z.number().int().nonnegative(),
  queuedAt: z.number().int().nonnegative(),
  startedAt: z.number().int().nonnegative().nullable(),
  completedAt: z.number().int().nonnegative().nullable(),
  status: scheduledTaskRunStatusSchema,
  reason: scheduledTaskRunReasonSchema,
  sessionId: z.string().optional(),
  tapeId: z.string().optional(),
  outputMessageId: z.string().optional(),
  error: z.string().optional(),
  outputPreview: z.string().optional(),
  owner: z.string().optional(),
  createdAt: z.number().int().nonnegative(),
  updatedAt: z.number().int().nonnegative()
})

export const schedulerProcessStatusSchema = z.object({
  state: z.enum(SCHEDULER_PROCESS_STATES),
  pid: z.number().int().positive().optional(),
  startedAt: z.number().int().nonnegative().optional(),
  lastHeartbeatAt: z.number().int().nonnegative().optional(),
  enabledTaskCount: z.number().int().nonnegative(),
  nextRunAt: z.number().int().nonnegative().nullable(),
  lastError: z.string().optional()
})

export const scheduledTasksListRoute = defineRouteContract({
  name: 'scheduledTasks.list',
  input: z.object({}),
  output: z.object({
    settings: scheduledTasksSettingsSchema
  })
})

export const scheduledTasksUpsertInputSchema = z.object({
  id: z.string().min(1).optional(),
  name: z.string().min(1).max(200),
  enabled: z.boolean(),
  trigger: scheduledTaskTriggerSchema,
  action: scheduledTaskActionSchema,
  context: scheduledTaskContextSchema.optional(),
  execution: scheduledTaskExecutionPolicySchema.optional(),
  delivery: scheduledTaskDeliveryPolicySchema.optional()
})

export const scheduledTasksUpsertRoute = defineRouteContract({
  name: 'scheduledTasks.upsert',
  input: scheduledTasksUpsertInputSchema,
  output: z.object({
    task: scheduledTaskSchema,
    settings: scheduledTasksSettingsSchema
  })
})

export const scheduledTasksDeleteRoute = defineRouteContract({
  name: 'scheduledTasks.delete',
  input: z.object({
    id: z.string().min(1)
  }),
  output: z.object({
    settings: scheduledTasksSettingsSchema
  })
})

export const scheduledTasksToggleRoute = defineRouteContract({
  name: 'scheduledTasks.toggle',
  input: z.object({
    id: z.string().min(1),
    enabled: z.boolean()
  }),
  output: z.object({
    task: scheduledTaskSchema,
    settings: scheduledTasksSettingsSchema
  })
})

export const scheduledTasksFireNowRoute = defineRouteContract({
  name: 'scheduledTasks.fireNow',
  input: z.object({
    id: z.string().min(1)
  }),
  output: z.object({
    task: scheduledTaskSchema,
    settings: scheduledTasksSettingsSchema
  })
})

export const scheduledTasksGetSchedulerStatusRoute = defineRouteContract({
  name: 'scheduledTasks.getSchedulerStatus',
  input: z.object({}),
  output: z.object({
    status: schedulerProcessStatusSchema
  })
})

export const scheduledTasksListRunsRoute = defineRouteContract({
  name: 'scheduledTasks.listRuns',
  input: z.object({
    taskId: z.string().min(1),
    limit: z.number().int().positive().max(100).optional()
  }),
  output: z.object({
    runs: z.array(scheduledTaskRunSchema)
  })
})

export const scheduledTasksReconcileNowRoute = defineRouteContract({
  name: 'scheduledTasks.reconcileNow',
  input: z.object({}),
  output: z.object({
    status: schedulerProcessStatusSchema
  })
})

export const scheduledTasksRestartSchedulerRoute = defineRouteContract({
  name: 'scheduledTasks.restartScheduler',
  input: z.object({}),
  output: z.object({
    status: schedulerProcessStatusSchema
  })
})
