import { z } from 'zod'
import { toDeepChatJsonSchema } from '@shared/lib/zodJsonSchema'
import type { MCPToolDefinition } from '@shared/presenter'
import { CRON_JOB_AGENT_TOOL_NAME } from '@shared/agentTools'
import {
  CRON_JOBS_DEFAULT_CRON_EXPR,
  CRON_JOBS_DEFAULT_DELIVERY,
  CRON_JOBS_DEFAULT_MISFIRE_POLICY,
  CRON_JOBS_DEFAULT_RUNTIME,
  CRON_JOBS_DEFAULT_TIMEZONE,
  type CronJob,
  type CronJobDelivery,
  type CronJobRuntimeSettings
} from '@shared/cronJobs'
import { createAgentToolSuccessResult } from '@shared/lib/agentToolResultEnvelope'
import type { AgentToolRuntimePort, AgentToolCronJobUpsertInput } from '../runtimePorts'
import type { AgentToolCallResult } from './agentToolManager'

export const CRON_JOB_TOOL_SERVER_NAME = 'scheduled'

const WRITE_ACTIONS = new Set(['create', 'update', 'delete', 'pause', 'resume', 'run_now'])
const MODEL_TEXT_PREVIEW_LIMIT = 500

const runtimePatchSchema = z.strictObject({
  maxDurationMs: z.number().int().positive().optional(),
  maxTurns: z.number().int().positive().optional(),
  concurrencyPolicy: z.enum(['skip', 'queue']).optional()
})

const deliveryTargetSchema = z.strictObject({
  type: z.literal('remote'),
  remoteId: z.string().trim().min(1),
  channelId: z.string().trim().min(1),
  mode: z.enum(['summary', 'full']).optional()
})

const deliverySchema = z.strictObject({
  targets: z.array(deliveryTargetSchema).optional(),
  suppressSuccessNotification: z.boolean().optional(),
  notifyOnFailure: z.boolean().optional()
})

const createJobSchema = z.strictObject({
  name: z.string().trim().min(1).max(200),
  description: z.string().trim().optional(),
  cronExpr: z.string().trim().min(1).optional(),
  timezone: z.string().trim().min(1).optional(),
  agentId: z.string().trim().min(1),
  taskPrompt: z.string().trim().min(1),
  taskSystemInstruction: z.string().trim().optional(),
  enabled: z.boolean().optional(),
  runtime: runtimePatchSchema.optional(),
  delivery: deliverySchema.optional()
})

const updatePatchSchema = createJobSchema
  .omit({ agentId: true, taskPrompt: true })
  .extend({
    agentId: z.string().trim().min(1).nullable().optional(),
    taskPrompt: z.string().trim().min(1).optional()
  })
  .partial()

const cronJobToolSchema = z.strictObject({
  action: z.enum([
    'create',
    'list',
    'show',
    'update',
    'pause',
    'resume',
    'delete',
    'run_now',
    'history',
    'preview_schedule'
  ]),
  jobId: z.string().trim().min(1).optional(),
  job: createJobSchema.optional(),
  patch: updatePatchSchema.optional(),
  limit: z.number().int().min(1).max(20).optional(),
  cronExpr: z.string().trim().min(1).optional(),
  timezone: z.string().trim().min(1).optional(),
  count: z.number().int().min(1).max(20).optional()
})

type CronJobToolInput = z.infer<typeof cronJobToolSchema>
type CronJobDeliveryInput = z.infer<typeof deliverySchema> | Partial<CronJobDelivery>

const requirePort = <T>(port: T | undefined, name: string): T => {
  if (!port) {
    throw new Error(`Cron job tool is unavailable: missing ${name}.`)
  }
  return port
}

const requireJobId = (input: CronJobToolInput): string => {
  if (!input.jobId) {
    throw new Error('jobId is required for this cronjob action.')
  }
  return input.jobId
}

const normalizeRuntime = (runtime?: Partial<CronJobRuntimeSettings>): CronJobRuntimeSettings => ({
  ...CRON_JOBS_DEFAULT_RUNTIME,
  ...runtime
})

const normalizeDelivery = (delivery?: CronJobDeliveryInput): CronJobDelivery => ({
  targets: delivery?.targets?.map((target) => ({
    ...target,
    mode: target.mode ?? 'summary'
  })) ?? [...CRON_JOBS_DEFAULT_DELIVERY.targets],
  suppressSuccessNotification:
    delivery?.suppressSuccessNotification ?? CRON_JOBS_DEFAULT_DELIVERY.suppressSuccessNotification,
  notifyOnFailure: delivery?.notifyOnFailure ?? CRON_JOBS_DEFAULT_DELIVERY.notifyOnFailure
})

const toCreateInput = (input: CronJobToolInput): AgentToolCronJobUpsertInput => {
  const job = input.job
  if (!job) {
    throw new Error('job is required for create.')
  }
  return {
    name: job.name,
    description: job.description ?? null,
    enabled: job.enabled ?? false,
    cronExpr: job.cronExpr ?? CRON_JOBS_DEFAULT_CRON_EXPR,
    timezone: job.timezone ?? CRON_JOBS_DEFAULT_TIMEZONE,
    agentId: job.agentId,
    misfirePolicy: CRON_JOBS_DEFAULT_MISFIRE_POLICY,
    maxCatchUpRuns: null,
    taskPrompt: job.taskPrompt,
    taskSystemInstruction: job.taskSystemInstruction ?? null,
    taskOutputMode: 'final_message',
    modelPolicy: 'follow_agent',
    toolPolicy: 'follow_agent',
    permissionPolicy: 'follow_agent',
    runtime: normalizeRuntime(job.runtime),
    delivery: normalizeDelivery(job.delivery)
  }
}

const toUpdateInput = (
  existing: CronJob,
  patch: CronJobToolInput['patch']
): AgentToolCronJobUpsertInput => {
  if (!patch) {
    throw new Error('patch is required for update.')
  }
  return {
    id: existing.id,
    name: patch.name ?? existing.name,
    description: patch.description ?? existing.description,
    enabled: patch.enabled ?? existing.enabled,
    cronExpr: patch.cronExpr ?? existing.cronExpr,
    timezone: patch.timezone ?? existing.timezone,
    agentId: patch.agentId === undefined ? existing.agentId : patch.agentId,
    misfirePolicy: existing.misfirePolicy,
    maxCatchUpRuns: existing.maxCatchUpRuns,
    taskPrompt: patch.taskPrompt ?? existing.taskPrompt,
    taskSystemInstruction:
      patch.taskSystemInstruction === undefined
        ? existing.taskSystemInstruction
        : patch.taskSystemInstruction,
    taskOutputMode: existing.taskOutputMode,
    modelPolicy: existing.modelPolicy,
    toolPolicy: existing.toolPolicy,
    permissionPolicy: existing.permissionPolicy,
    runtime: normalizeRuntime({ ...existing.runtime, ...patch.runtime }),
    delivery: normalizeDelivery({ ...existing.delivery, ...patch.delivery })
  }
}

const summarizeJobs = (jobs: CronJob[]): string =>
  jobs.length === 0
    ? 'No scheduled tasks.'
    : `${jobs.length} scheduled task${jobs.length === 1 ? '' : 's'}: ${jobs
        .map((job) => job.name)
        .join(', ')}.`

const previewText = (value: string | null | undefined): string | null => {
  if (!value) {
    return null
  }
  return value.length > MODEL_TEXT_PREVIEW_LIMIT
    ? `${value.slice(0, MODEL_TEXT_PREVIEW_LIMIT).trimEnd()}...`
    : value
}

const toModelJob = (job: CronJob) => ({
  id: job.id,
  name: job.name,
  description: job.description,
  enabled: job.enabled,
  status: job.status,
  cronExpr: job.cronExpr,
  timezone: job.timezone,
  agentId: job.agentId,
  nextRunAt: job.nextRunAt,
  scheduleError: job.scheduleError,
  runtime: job.runtime,
  delivery: {
    targetCount: job.delivery.targets.length,
    suppressSuccessNotification: job.delivery.suppressSuccessNotification,
    notifyOnFailure: job.delivery.notifyOnFailure
  },
  taskPromptPreview: previewText(job.taskPrompt),
  taskSystemInstructionPreview: previewText(job.taskSystemInstruction)
})

const createResult = (
  payload: unknown,
  summary: string,
  isError = false,
  modelPayload = payload
): AgentToolCallResult => {
  const content = JSON.stringify(modelPayload, null, 2)
  return {
    content,
    rawData: {
      content,
      isError,
      toolResult: createAgentToolSuccessResult(CRON_JOB_AGENT_TOOL_NAME, modelPayload, {
        summary,
        data: modelPayload
      })
    }
  }
}

export const cronJobActionNeedsPermission = (args: Record<string, unknown>): boolean =>
  typeof args.action === 'string' && WRITE_ACTIONS.has(args.action)

export class CronJobToolHandler {
  constructor(private readonly runtimePort: AgentToolRuntimePort) {}

  isCronJobTool(toolName: string): boolean {
    return toolName === CRON_JOB_AGENT_TOOL_NAME
  }

  canUse(): boolean {
    return Boolean(this.runtimePort.listCronJobs && this.runtimePort.previewCronSchedule)
  }

  getToolDefinition(): MCPToolDefinition {
    return {
      type: 'function',
      function: {
        name: CRON_JOB_AGENT_TOOL_NAME,
        description:
          'Manage Scheduled tasks. Read actions list, show, history, and preview schedules. Write actions create, update, pause, resume, delete, or run a task after user approval.',
        parameters: toDeepChatJsonSchema(cronJobToolSchema) as {
          type: string
          properties: Record<string, unknown>
          required?: string[]
        }
      },
      server: {
        name: CRON_JOB_TOOL_SERVER_NAME,
        icons: '⏱️',
        description: 'DeepChat Scheduled tasks'
      }
    }
  }

  async call(args: Record<string, unknown>): Promise<AgentToolCallResult> {
    const input = cronJobToolSchema.parse(args)
    const listCronJobs = requirePort(this.runtimePort.listCronJobs, 'listCronJobs')

    if (input.action === 'list') {
      const result = await listCronJobs()
      return createResult(result, summarizeJobs(result.jobs), false, {
        ...result,
        jobs: result.jobs.map(toModelJob)
      })
    }

    if (input.action === 'show') {
      const jobId = requireJobId(input)
      const result = await listCronJobs()
      const job = result.jobs.find((item) => item.id === jobId)
      if (!job) {
        throw new Error(`Cron job not found: ${jobId}`)
      }
      return createResult({ job }, `Scheduled task "${job.name}".`, false, {
        job: toModelJob(job)
      })
    }

    if (input.action === 'preview_schedule') {
      const previewCronSchedule = requirePort(
        this.runtimePort.previewCronSchedule,
        'previewCronSchedule'
      )
      const cronExpr = input.cronExpr ?? CRON_JOBS_DEFAULT_CRON_EXPR
      const timezone = input.timezone ?? CRON_JOBS_DEFAULT_TIMEZONE
      const result = await previewCronSchedule({
        cronExpr,
        timezone,
        count: input.count
      })
      return createResult(result, `Previewed schedule ${cronExpr} in ${timezone}.`)
    }

    if (input.action === 'history') {
      const listCronJobRuns = requirePort(this.runtimePort.listCronJobRuns, 'listCronJobRuns')
      const jobId = requireJobId(input)
      const runs = await listCronJobRuns(jobId, input.limit)
      return createResult({ runs }, `Found ${runs.length} scheduled task runs.`)
    }

    if (input.action === 'create') {
      const upsertCronJob = requirePort(this.runtimePort.upsertCronJob, 'upsertCronJob')
      const job = await upsertCronJob(toCreateInput(input))
      return createResult({ job }, `Created scheduled task "${job.name}".`, false, {
        job: toModelJob(job)
      })
    }

    if (input.action === 'update') {
      const upsertCronJob = requirePort(this.runtimePort.upsertCronJob, 'upsertCronJob')
      const jobId = requireJobId(input)
      const result = await listCronJobs()
      const existing = result.jobs.find((item) => item.id === jobId)
      if (!existing) {
        throw new Error(`Cron job not found: ${jobId}`)
      }
      const job = await upsertCronJob(toUpdateInput(existing, input.patch))
      return createResult({ job }, `Updated scheduled task "${job.name}".`, false, {
        job: toModelJob(job)
      })
    }

    if (input.action === 'pause' || input.action === 'resume') {
      const toggleCronJob = requirePort(this.runtimePort.toggleCronJob, 'toggleCronJob')
      const job = await toggleCronJob(requireJobId(input), input.action === 'resume')
      return createResult(
        { job },
        `${input.action === 'resume' ? 'Resumed' : 'Paused'} scheduled task "${job.name}".`,
        false,
        { job: toModelJob(job) }
      )
    }

    if (input.action === 'delete') {
      const deleteCronJob = requirePort(this.runtimePort.deleteCronJob, 'deleteCronJob')
      await deleteCronJob(requireJobId(input))
      return createResult({ deleted: true, jobId: input.jobId }, 'Deleted scheduled task.')
    }

    const runCronJobNow = requirePort(this.runtimePort.runCronJobNow, 'runCronJobNow')
    const run = await runCronJobNow(requireJobId(input))
    return createResult({ run }, `Started scheduled task run ${run.id}.`)
  }
}
