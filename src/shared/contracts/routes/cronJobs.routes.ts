import { z } from 'zod'
import { defineRouteContract } from '../common'
import {
  CRON_JOB_MISFIRE_POLICIES,
  CRON_JOB_RUN_REASONS,
  CRON_JOB_RUN_STATUSES,
  CRON_JOBS_SCHEDULER_STATES
} from '../../cronJobs'

const timestampMsSchema = z.number().int().nonnegative()

export const cronJobRunStatusSchema = z.enum(CRON_JOB_RUN_STATUSES)
export const cronJobRunReasonSchema = z.enum(CRON_JOB_RUN_REASONS)
export const cronJobMisfirePolicySchema = z.enum(CRON_JOB_MISFIRE_POLICIES)
export const cronJobsSchedulerStateSchema = z.enum(CRON_JOBS_SCHEDULER_STATES)

export const cronJobSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1).max(200),
  enabled: z.boolean(),
  cronExpr: z.string().min(1).max(200),
  timezone: z.string().min(1).max(128),
  agentId: z.string().min(1).nullable(),
  nextRunAt: timestampMsSchema.nullable(),
  misfirePolicy: cronJobMisfirePolicySchema,
  maxCatchUpRuns: z.number().int().positive().nullable(),
  scheduleError: z.string().nullable(),
  createdAt: timestampMsSchema,
  updatedAt: timestampMsSchema
})

export const cronJobRunSchema = z.object({
  id: z.string().min(1),
  jobId: z.string().min(1),
  scheduledAt: timestampMsSchema,
  queuedAt: timestampMsSchema,
  startedAt: timestampMsSchema.nullable(),
  completedAt: timestampMsSchema.nullable(),
  status: cronJobRunStatusSchema,
  reason: cronJobRunReasonSchema,
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
  .omit({ id: true, createdAt: true, updatedAt: true })
  .extend({
    id: z.string().min(1).optional(),
    nextRunAt: timestampMsSchema.nullable().optional(),
    misfirePolicy: cronJobMisfirePolicySchema.optional(),
    maxCatchUpRuns: z.number().int().positive().nullable().optional(),
    scheduleError: z.string().nullable().optional()
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
