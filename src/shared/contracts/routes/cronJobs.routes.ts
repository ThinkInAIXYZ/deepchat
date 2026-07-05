import { z } from 'zod'
import { defineRouteContract } from '../common'
import {
  CRON_JOB_CONCURRENCY_POLICIES,
  CRON_JOB_DELIVERY_STATUSES,
  CRON_JOB_DELIVERY_TARGET_TYPES,
  CRON_JOB_MISFIRE_POLICIES,
  CRON_JOB_MODEL_POLICIES,
  CRON_JOB_OUTPUT_MODES,
  CRON_JOB_RUNTIME_POLICIES,
  CRON_JOB_RUN_REASONS,
  CRON_JOB_RUN_STATUSES,
  CRON_JOB_STATUSES,
  CRON_JOBS_SCHEDULER_STATES
} from '../../cronJobs'

const timestampMsSchema = z.number().int().nonnegative()

export const cronJobRunStatusSchema = z.enum(CRON_JOB_RUN_STATUSES)
export const cronJobRunReasonSchema = z.enum(CRON_JOB_RUN_REASONS)
export const cronJobMisfirePolicySchema = z.enum(CRON_JOB_MISFIRE_POLICIES)
export const cronJobStatusSchema = z.enum(CRON_JOB_STATUSES)
export const cronJobOutputModeSchema = z.enum(CRON_JOB_OUTPUT_MODES)
export const cronJobModelPolicySchema = z.enum(CRON_JOB_MODEL_POLICIES)
export const cronJobRuntimePolicySchema = z.enum(CRON_JOB_RUNTIME_POLICIES)
export const cronJobConcurrencyPolicySchema = z.enum(CRON_JOB_CONCURRENCY_POLICIES)
export const cronJobDeliveryTargetTypeSchema = z.enum(CRON_JOB_DELIVERY_TARGET_TYPES)
export const cronJobDeliveryStatusSchema = z.enum(CRON_JOB_DELIVERY_STATUSES)
export const cronJobsSchedulerStateSchema = z.enum(CRON_JOBS_SCHEDULER_STATES)

export const cronJobRuntimeSchema = z.object({
  maxDurationMs: z.number().int().positive(),
  maxTurns: z.number().int().positive(),
  concurrencyPolicy: cronJobConcurrencyPolicySchema
})

export const cronJobAgentSnapshotSchema = z.object({
  version: z.literal(1),
  capturedAt: timestampMsSchema,
  agent: z.object({
    id: z.string().min(1),
    name: z.string().min(1),
    type: z.enum(['deepchat', 'acp'])
  }),
  config: z.unknown().nullable()
})

export const cronJobDeliveryTargetSchema = z.object({
  type: z.literal('remote'),
  remoteId: z.string().min(1),
  channelId: z.string().min(1),
  mode: z.enum(['summary', 'full'])
})

export const cronJobDeliverySchema = z.object({
  targets: z.array(cronJobDeliveryTargetSchema),
  suppressSuccessNotification: z.boolean(),
  notifyOnFailure: z.boolean()
})

export const cronJobSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1).max(200),
  description: z.string().nullable(),
  enabled: z.boolean(),
  status: cronJobStatusSchema,
  cronExpr: z.string().min(1).max(200),
  timezone: z.string().min(1).max(128),
  agentId: z.string().min(1).nullable(),
  nextRunAt: timestampMsSchema.nullable(),
  misfirePolicy: cronJobMisfirePolicySchema,
  maxCatchUpRuns: z.number().int().positive().nullable(),
  scheduleError: z.string().nullable(),
  taskPrompt: z.string(),
  taskSystemInstruction: z.string().nullable(),
  taskOutputMode: cronJobOutputModeSchema,
  modelPolicy: cronJobModelPolicySchema,
  toolPolicy: cronJobRuntimePolicySchema,
  permissionPolicy: cronJobRuntimePolicySchema,
  runtime: cronJobRuntimeSchema,
  agentSnapshot: cronJobAgentSnapshotSchema.nullable(),
  delivery: cronJobDeliverySchema,
  createdAt: timestampMsSchema,
  updatedAt: timestampMsSchema
})

export const cronJobRunSchema = z.object({
  id: z.string().min(1),
  jobId: z.string().min(1),
  sessionId: z.string().min(1).nullable(),
  scheduledAt: timestampMsSchema,
  queuedAt: timestampMsSchema,
  startedAt: timestampMsSchema.nullable(),
  completedAt: timestampMsSchema.nullable(),
  status: cronJobRunStatusSchema,
  reason: cronJobRunReasonSchema,
  outputMessageId: z.string().min(1).nullable(),
  outputPreview: z.string().nullable(),
  error: z.string().nullable(),
  claimedAt: timestampMsSchema.nullable(),
  claimOwner: z.string().min(1).nullable(),
  createdAt: timestampMsSchema,
  updatedAt: timestampMsSchema
})

export const cronJobDeliveryReceiptSchema = z.object({
  id: z.string().min(1),
  jobId: z.string().min(1),
  runId: z.string().min(1),
  targetType: cronJobDeliveryTargetTypeSchema,
  target: cronJobDeliveryTargetSchema,
  status: cronJobDeliveryStatusSchema,
  remoteMessageId: z.string().min(1).nullable(),
  error: z.string().nullable(),
  createdAt: timestampMsSchema,
  updatedAt: timestampMsSchema
})

export const cronJobsSchedulerStatusSchema = z.object({
  state: cronJobsSchedulerStateSchema,
  pid: z.number().int().positive().nullable(),
  enabledJobCount: z.number().int().nonnegative(),
  nextRunAt: timestampMsSchema.nullable(),
  lastHeartbeatAt: timestampMsSchema.nullable(),
  lastError: z.string().nullable(),
  restartAttempts: z.number().int().nonnegative(),
  updatedAt: timestampMsSchema
})

export const cronJobsListRoute = defineRouteContract({
  name: 'cronJobs.list',
  input: z.object({}),
  output: z.object({
    jobs: z.array(cronJobSchema),
    schedulerStatus: cronJobsSchedulerStatusSchema
  })
})

export const cronJobsUpsertInputSchema = cronJobSchema
  .omit({
    id: true,
    createdAt: true,
    updatedAt: true,
    status: true,
    nextRunAt: true,
    scheduleError: true,
    agentSnapshot: true
  })
  .extend({
    id: z.string().min(1).optional(),
    description: z.string().nullable().optional(),
    status: cronJobStatusSchema.optional(),
    nextRunAt: timestampMsSchema.nullable().optional(),
    misfirePolicy: cronJobMisfirePolicySchema.optional(),
    maxCatchUpRuns: z.number().int().positive().nullable().optional(),
    scheduleError: z.string().nullable().optional(),
    taskPrompt: z.string().optional(),
    taskSystemInstruction: z.string().nullable().optional(),
    taskOutputMode: cronJobOutputModeSchema.optional(),
    modelPolicy: cronJobModelPolicySchema.optional(),
    toolPolicy: cronJobRuntimePolicySchema.optional(),
    permissionPolicy: cronJobRuntimePolicySchema.optional(),
    runtime: cronJobRuntimeSchema.optional(),
    agentSnapshot: cronJobAgentSnapshotSchema.nullable().optional(),
    delivery: cronJobDeliverySchema.optional()
  })

export const cronJobsUpsertRoute = defineRouteContract({
  name: 'cronJobs.upsert',
  input: cronJobsUpsertInputSchema,
  output: z.object({
    job: cronJobSchema,
    schedulerStatus: cronJobsSchedulerStatusSchema
  })
})

export const cronJobsDeleteRoute = defineRouteContract({
  name: 'cronJobs.delete',
  input: z.object({
    id: z.string().min(1)
  }),
  output: z.object({
    schedulerStatus: cronJobsSchedulerStatusSchema
  })
})

export const cronJobsToggleRoute = defineRouteContract({
  name: 'cronJobs.toggle',
  input: z.object({
    id: z.string().min(1),
    enabled: z.boolean()
  }),
  output: z.object({
    job: cronJobSchema,
    schedulerStatus: cronJobsSchedulerStatusSchema
  })
})

export const cronJobsRunNowRoute = defineRouteContract({
  name: 'cronJobs.runNow',
  input: z.object({
    id: z.string().min(1)
  }),
  output: z.object({
    job: cronJobSchema,
    run: cronJobRunSchema,
    schedulerStatus: cronJobsSchedulerStatusSchema
  })
})

export const cronJobsListRunsRoute = defineRouteContract({
  name: 'cronJobs.listRuns',
  input: z.object({
    jobId: z.string().min(1),
    limit: z.number().int().min(1).max(20).optional()
  }),
  output: z.object({
    runs: z.array(cronJobRunSchema)
  })
})

export const cronJobsGetRunRoute = defineRouteContract({
  name: 'cronJobs.getRun',
  input: z.object({
    runId: z.string().min(1)
  }),
  output: z.object({
    run: cronJobRunSchema
  })
})

export const cronJobsListDeliveriesRoute = defineRouteContract({
  name: 'cronJobs.listDeliveries',
  input: z.object({
    runId: z.string().min(1)
  }),
  output: z.object({
    deliveries: z.array(cronJobDeliveryReceiptSchema)
  })
})

export const cronJobsGetSchedulerStatusRoute = defineRouteContract({
  name: 'cronJobs.getSchedulerStatus',
  input: z.object({}),
  output: z.object({
    schedulerStatus: cronJobsSchedulerStatusSchema
  })
})

export const cronJobsReconcileSchedulerRoute = defineRouteContract({
  name: 'cronJobs.reconcileScheduler',
  input: z.object({
    reason: z.string().max(100).optional()
  }),
  output: z.object({
    schedulerStatus: cronJobsSchedulerStatusSchema
  })
})

export const cronJobsRestartSchedulerRoute = defineRouteContract({
  name: 'cronJobs.restartScheduler',
  input: z.object({}),
  output: z.object({
    schedulerStatus: cronJobsSchedulerStatusSchema
  })
})

export const cronJobsValidateScheduleRoute = defineRouteContract({
  name: 'cronJobs.validateSchedule',
  input: z.object({
    cronExpr: z.string().min(1).max(200),
    timezone: z.string().min(1).max(128),
    from: timestampMsSchema.optional()
  }),
  output: z.object({
    valid: z.boolean(),
    error: z.string().nullable(),
    nextRunAt: timestampMsSchema.nullable()
  })
})

export const cronJobsPreviewScheduleRoute = defineRouteContract({
  name: 'cronJobs.previewSchedule',
  input: z.object({
    cronExpr: z.string().min(1).max(200),
    timezone: z.string().min(1).max(128),
    count: z.number().int().min(1).max(10).optional(),
    from: timestampMsSchema.optional()
  }),
  output: z.object({
    runs: z.array(timestampMsSchema),
    error: z.string().nullable()
  })
})
