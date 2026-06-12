import { z } from 'zod'
import { defineRouteContract } from '../common'
import {
  SCHEDULED_TASKS_VERSION,
  SCHEDULED_TASK_TRIGGER_KINDS,
  SCHEDULED_TASK_ACTION_KINDS
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
  })
])

export const scheduledTaskSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1).max(200),
  enabled: z.boolean(),
  trigger: scheduledTaskTriggerSchema,
  action: scheduledTaskActionSchema,
  createdAt: z.number().int().nonnegative(),
  lastFiredAt: z.number().int().nonnegative().nullable()
})

export const scheduledTasksSettingsSchema = z.object({
  version: z.literal(SCHEDULED_TASKS_VERSION),
  tasks: z.array(scheduledTaskSchema)
})

export const scheduledTasksListRoute = defineRouteContract({
  name: 'scheduledTasks.list',
  input: z.object({}),
  output: z.object({
    settings: scheduledTasksSettingsSchema
  })
})

export const scheduledTasksUpsertInputSchema = scheduledTaskSchema
  .omit({ id: true, createdAt: true, lastFiredAt: true })
  .extend({
    id: z.string().min(1).optional()
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
