import { z } from 'zod'
import { JsonValueSchema, type JsonValue } from '../contracts/common'

export const WORKFLOW_RUNTIME_PROTOCOL_VERSION = 1 as const
export const WORKFLOW_RUNTIME_API_VERSION = 1 as const
export const WORKFLOW_RUNTIME_MAX_SCRIPT_BYTES = 1024 * 1024

export const WORKFLOW_RUNTIME_DEFAULT_LIMITS = Object.freeze({
  maxScriptBytes: 256 * 1024,
  maxInputBytes: 1024 * 1024,
  memoryLimitBytes: 64 * 1024 * 1024,
  maxStackSizeBytes: 1024 * 1024,
  maxExecutionBurstMs: 1_000,
  maxPendingJobsPerDrain: 10_000,
  maxInvocations: 128,
  maxPendingInvocations: 64,
  maxPhaseUpdates: 1_000,
  maxLogEntries: 1_000,
  maxLogBytes: 1024 * 1024,
  maxResultBytes: 1024 * 1024
})

const RuntimeIdSchema = z
  .string()
  .min(1)
  .max(160)
  .regex(/^[A-Za-z0-9][A-Za-z0-9._:-]*$/)

const RequestIdSchema = z
  .string()
  .min(1)
  .max(256)
  .regex(/^[A-Za-z0-9][A-Za-z0-9._:-]*$/)

const WorkflowKeySchema = z
  .string()
  .min(1)
  .max(256)
  .refine((value) => !/[\u0000-\u001f\u007f]/u.test(value), 'Control characters are not allowed')

const WorkflowCallPathSchema = z
  .string()
  .min(1)
  .max(2_048)
  .refine((value) => !/[\u0000-\u001f\u007f]/u.test(value), 'Control characters are not allowed')

export const WorkflowRuntimeLimitsSchema = z
  .object({
    maxScriptBytes: z
      .number()
      .int()
      .min(1)
      .max(1024 * 1024),
    maxInputBytes: z
      .number()
      .int()
      .min(1)
      .max(8 * 1024 * 1024),
    memoryLimitBytes: z
      .number()
      .int()
      .min(4 * 1024 * 1024)
      .max(256 * 1024 * 1024),
    maxStackSizeBytes: z
      .number()
      .int()
      .min(64 * 1024)
      .max(8 * 1024 * 1024),
    maxExecutionBurstMs: z.number().int().min(10).max(5_000),
    maxPendingJobsPerDrain: z.number().int().min(1).max(100_000),
    maxInvocations: z.number().int().min(1).max(256),
    maxPendingInvocations: z.number().int().min(1).max(256),
    maxPhaseUpdates: z.number().int().min(0).max(10_000),
    maxLogEntries: z.number().int().min(0).max(10_000),
    maxLogBytes: z
      .number()
      .int()
      .min(0)
      .max(8 * 1024 * 1024),
    maxResultBytes: z
      .number()
      .int()
      .min(1)
      .max(8 * 1024 * 1024)
  })
  .strict()
  .refine(
    (limits) => limits.maxPendingInvocations <= limits.maxInvocations,
    'maxPendingInvocations cannot exceed maxInvocations'
  )

export type WorkflowRuntimeLimits = z.infer<typeof WorkflowRuntimeLimitsSchema>

export const WorkflowGuestAgentOptionsSchema = z
  .object({
    key: WorkflowKeySchema,
    label: z.string().min(1).max(256).optional(),
    phase: WorkflowKeySchema.optional(),
    agentId: z.string().min(1).max(256).optional(),
    schema: JsonValueSchema.optional(),
    timeoutMs: z
      .number()
      .int()
      .min(1_000)
      .max(2 * 60 * 60 * 1_000)
      .optional(),
    maxOutputBytes: z
      .number()
      .int()
      .min(1)
      .max(8 * 1024 * 1024)
      .optional()
  })
  .strict()

export type WorkflowGuestAgentOptions = z.infer<typeof WorkflowGuestAgentOptionsSchema>

export const WorkflowGuestAgentRequestSchema = z
  .object({
    callPath: WorkflowCallPathSchema,
    prompt: z
      .string()
      .min(1)
      .max(256 * 1024),
    options: WorkflowGuestAgentOptionsSchema
  })
  .strict()

export type WorkflowGuestAgentRequest = z.infer<typeof WorkflowGuestAgentRequestSchema>

export const WorkflowInvocationErrorSchema = z
  .object({
    code: z.string().min(1).max(128),
    message: z.string().min(1).max(8_192),
    retriable: z.boolean()
  })
  .strict()

export type WorkflowInvocationError = z.infer<typeof WorkflowInvocationErrorSchema>

export const WorkflowInvocationOutcomeSchema = z.discriminatedUnion('status', [
  z
    .object({
      status: z.literal('success'),
      value: JsonValueSchema
    })
    .strict(),
  z
    .object({
      status: z.literal('error'),
      error: WorkflowInvocationErrorSchema
    })
    .strict()
])

export type WorkflowInvocationOutcome = z.infer<typeof WorkflowInvocationOutcomeSchema>

const ProtocolEnvelopeSchema = z.object({
  protocolVersion: z.literal(WORKFLOW_RUNTIME_PROTOCOL_VERSION),
  runId: RuntimeIdSchema
})

export const WorkflowRuntimeCommandSchema = z.discriminatedUnion('type', [
  ProtocolEnvelopeSchema.extend({
    type: z.literal('START'),
    runtimeApiVersion: z.literal(WORKFLOW_RUNTIME_API_VERSION),
    source: z.string().min(1).max(WORKFLOW_RUNTIME_MAX_SCRIPT_BYTES),
    input: JsonValueSchema,
    limits: WorkflowRuntimeLimitsSchema
  }).strict(),
  ProtocolEnvelopeSchema.extend({
    type: z.literal('SETTLE_INVOCATION'),
    requestId: RequestIdSchema,
    outcome: WorkflowInvocationOutcomeSchema
  }).strict(),
  ProtocolEnvelopeSchema.extend({
    type: z.literal('CANCEL'),
    reason: z.string().min(1).max(2_048)
  }).strict(),
  ProtocolEnvelopeSchema.extend({
    type: z.literal('SHUTDOWN')
  }).strict()
])

export type WorkflowRuntimeCommand = z.infer<typeof WorkflowRuntimeCommandSchema>

export const WorkflowRuntimeEventSchema = z.discriminatedUnion('type', [
  ProtocolEnvelopeSchema.extend({
    type: z.literal('READY'),
    pid: z.number().int().positive()
  }).strict(),
  ProtocolEnvelopeSchema.extend({
    type: z.literal('INVOKE_AGENT'),
    requestId: RequestIdSchema,
    request: WorkflowGuestAgentRequestSchema
  }).strict(),
  ProtocolEnvelopeSchema.extend({
    type: z.literal('PHASE'),
    key: WorkflowCallPathSchema,
    label: z.string().min(1).max(256).optional(),
    detail: JsonValueSchema.optional()
  }).strict(),
  ProtocolEnvelopeSchema.extend({
    type: z.literal('LOG'),
    value: JsonValueSchema
  }).strict(),
  ProtocolEnvelopeSchema.extend({
    type: z.literal('COMPLETE'),
    value: JsonValueSchema
  }).strict(),
  ProtocolEnvelopeSchema.extend({
    type: z.literal('FAILED'),
    error: WorkflowInvocationErrorSchema
  }).strict()
])

export type WorkflowRuntimeEvent = z.infer<typeof WorkflowRuntimeEventSchema>

export function createWorkflowRuntimeCommand<T extends WorkflowRuntimeCommand>(command: T): T {
  return WorkflowRuntimeCommandSchema.parse(command) as T
}

export function createWorkflowRuntimeEvent<T extends WorkflowRuntimeEvent>(event: T): T {
  return WorkflowRuntimeEventSchema.parse(event) as T
}

export function isWorkflowJsonValue(value: unknown): value is JsonValue {
  return JsonValueSchema.safeParse(value).success
}
