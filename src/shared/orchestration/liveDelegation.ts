import { z } from 'zod'

export const LIVE_DELEGATION_SCHEMA_VERSION = 1
export const LIVE_DELEGATION_MAX_TITLE_LENGTH = 160
export const LIVE_DELEGATION_MAX_PROMPT_BYTES = 64 * 1024
export const LIVE_DELEGATION_MAX_MESSAGE_BYTES = 8 * 1024
export const LIVE_DELEGATION_MAX_SUMMARY_BYTES = 16 * 1024
export const LIVE_DELEGATION_MAX_EVENTS_PER_PARENT = 500

const LiveDelegationIdSchema = z.string().trim().min(1).max(256)

export const LiveDelegationStatusSchema = z.enum([
  'queued',
  'running',
  'waiting_permission',
  'waiting_question',
  'idle',
  'failed',
  'interrupted'
])

export const LiveDelegationTurnStatusSchema = z.enum([
  'queued',
  'running',
  'waiting_permission',
  'waiting_question',
  'completed',
  'failed',
  'cancelled',
  'interrupted'
])

export const LiveDelegationEventDirectionSchema = z.enum(['parent_to_child', 'child_to_parent'])
export const LiveDelegationEventKindSchema = z.enum([
  'message',
  'turn_completed',
  'turn_failed',
  'turn_cancelled',
  'turn_interrupted'
])

export const LiveDelegationSubagentContextSchema = z
  .object({
    delegationId: LiveDelegationIdSchema
  })
  .strict()

export const LiveDelegationSchema = z
  .object({
    schemaVersion: z.literal(LIVE_DELEGATION_SCHEMA_VERSION),
    id: LiveDelegationIdSchema,
    parentSessionId: LiveDelegationIdSchema,
    childSessionId: LiveDelegationIdSchema.nullable(),
    slotId: LiveDelegationIdSchema,
    targetAgentId: LiveDelegationIdSchema,
    title: z.string().trim().min(1).max(LIVE_DELEGATION_MAX_TITLE_LENGTH),
    status: LiveDelegationStatusSchema,
    lastTurnSeq: z.number().int().nonnegative(),
    lastSummary: z.string().nullable(),
    lastError: z.string().nullable(),
    createdAt: z.number().int().nonnegative(),
    updatedAt: z.number().int().nonnegative(),
    revision: z.number().int().nonnegative()
  })
  .strict()

export const LiveDelegationTurnSchema = z
  .object({
    id: LiveDelegationIdSchema,
    delegationId: LiveDelegationIdSchema,
    seq: z.number().int().positive(),
    kind: z.enum(['initial', 'follow_up']),
    prompt: z.string().min(1),
    status: LiveDelegationTurnStatusSchema,
    resultSummary: z.string().nullable(),
    error: z.string().nullable(),
    tapeReceipt: z.record(z.string(), z.unknown()).nullable(),
    createdAt: z.number().int().nonnegative(),
    startedAt: z.number().int().nonnegative().nullable(),
    updatedAt: z.number().int().nonnegative(),
    completedAt: z.number().int().nonnegative().nullable()
  })
  .strict()

export const LiveDelegationEventSchema = z
  .object({
    id: z.number().int().positive(),
    delegationId: LiveDelegationIdSchema,
    parentSessionId: LiveDelegationIdSchema,
    direction: LiveDelegationEventDirectionSchema,
    kind: LiveDelegationEventKindSchema,
    content: z.string(),
    relatedTurnId: LiveDelegationIdSchema.nullable(),
    consumedByTurnId: LiveDelegationIdSchema.nullable(),
    createdAt: z.number().int().nonnegative()
  })
  .strict()

export type LiveDelegationStatus = z.infer<typeof LiveDelegationStatusSchema>
export type LiveDelegationTurnStatus = z.infer<typeof LiveDelegationTurnStatusSchema>
export type LiveDelegationEventDirection = z.infer<typeof LiveDelegationEventDirectionSchema>
export type LiveDelegationEventKind = z.infer<typeof LiveDelegationEventKindSchema>
export type LiveDelegationSubagentContext = z.infer<typeof LiveDelegationSubagentContextSchema>
export type LiveDelegation = z.infer<typeof LiveDelegationSchema>
export type LiveDelegationTurn = z.infer<typeof LiveDelegationTurnSchema>
export type LiveDelegationEvent = z.infer<typeof LiveDelegationEventSchema>

export type LiveDelegationSummary = Omit<LiveDelegation, 'lastSummary' | 'lastError'> & {
  summaryPreview: string | null
  errorPreview: string | null
}

export type LiveDelegationTurnSummary = Omit<
  LiveDelegationTurn,
  'prompt' | 'resultSummary' | 'error'
> & {
  promptPreview: string
  resultPreview: string | null
  errorPreview: string | null
}

export type LiveDelegationEventSummary = Omit<LiveDelegationEvent, 'content'> & {
  contentPreview: string
  contentTruncated: boolean
}

export interface LiveDelegationDetail {
  delegation: LiveDelegationSummary
  turns: LiveDelegationTurnSummary[]
}

export function parseLiveDelegationSubagentContext(
  value: unknown
): LiveDelegationSubagentContext | undefined {
  const parsed = LiveDelegationSubagentContextSchema.safeParse(value)
  return parsed.success ? parsed.data : undefined
}
