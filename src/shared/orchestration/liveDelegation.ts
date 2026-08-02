import { z } from 'zod'
import { OrchestrationEffectEvidenceSchema, OrchestrationEffectStateSchema } from './toolEffect'

export const LIVE_DELEGATION_SCHEMA_VERSION = 1
export const LIVE_DELEGATION_MAX_TITLE_LENGTH = 160
export const LIVE_DELEGATION_MAX_PROMPT_BYTES = 64 * 1024
export const LIVE_DELEGATION_MAX_MESSAGE_BYTES = 8 * 1024
export const LIVE_DELEGATION_MAX_SUMMARY_BYTES = 16 * 1024
export const LIVE_DELEGATION_MAX_EFFECT_EVIDENCE_BYTES = 8 * 1024
export const LIVE_DELEGATION_MAX_EVENTS_PER_PARENT = 500
export const LIVE_DELEGATION_MAX_PREVIEW_CHARACTERS = 2 * 1024

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

export const LiveDelegationTapeReceiptSchema = z
  .object({
    linkEntry: z
      .object({
        sessionId: LiveDelegationIdSchema,
        entryId: z.number().int().positive()
      })
      .strict(),
    childSessionId: LiveDelegationIdSchema,
    childHeadEntryId: z.number().int().nonnegative(),
    childEntryCount: z.number().int().nonnegative(),
    outcome: z.enum(['completed', 'error', 'cancelled'])
  })
  .strict()
  .refine((receipt) => receipt.childEntryCount <= receipt.childHeadEntryId, {
    path: ['childEntryCount'],
    message: 'Child Tape entry count cannot exceed its frozen head'
  })

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

const LiveDelegationTurnBaseSchema = z
  .object({
    id: LiveDelegationIdSchema,
    delegationId: LiveDelegationIdSchema,
    seq: z.number().int().positive(),
    kind: z.enum(['initial', 'follow_up']),
    prompt: z.string().min(1),
    status: LiveDelegationTurnStatusSchema,
    resultSummary: z.string().nullable(),
    error: z.string().nullable(),
    tapeReceipt: LiveDelegationTapeReceiptSchema.nullable(),
    effectState: OrchestrationEffectStateSchema,
    effectEvidence: OrchestrationEffectEvidenceSchema.nullable(),
    createdAt: z.number().int().nonnegative(),
    startedAt: z.number().int().nonnegative().nullable(),
    updatedAt: z.number().int().nonnegative(),
    completedAt: z.number().int().nonnegative().nullable()
  })
  .strict()

export const LiveDelegationTurnSchema = LiveDelegationTurnBaseSchema.superRefine(
  validateLiveDelegationEffect
)

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
export type LiveDelegationTapeReceipt = z.infer<typeof LiveDelegationTapeReceiptSchema>
export type LiveDelegation = z.infer<typeof LiveDelegationSchema>
export type LiveDelegationTurn = z.infer<typeof LiveDelegationTurnSchema>
export type LiveDelegationEvent = z.infer<typeof LiveDelegationEventSchema>

export const LiveDelegationSummarySchema = LiveDelegationSchema.omit({
  lastSummary: true,
  lastError: true
})
  .extend({
    summaryPreview: z.string().max(LIVE_DELEGATION_MAX_PREVIEW_CHARACTERS).nullable(),
    errorPreview: z.string().max(LIVE_DELEGATION_MAX_PREVIEW_CHARACTERS).nullable()
  })
  .strict()

export const LiveDelegationTurnSummarySchema = LiveDelegationTurnBaseSchema.omit({
  prompt: true,
  resultSummary: true,
  error: true
})
  .extend({
    promptPreview: z.string().max(LIVE_DELEGATION_MAX_PREVIEW_CHARACTERS),
    resultPreview: z.string().max(LIVE_DELEGATION_MAX_PREVIEW_CHARACTERS).nullable(),
    errorPreview: z.string().max(LIVE_DELEGATION_MAX_PREVIEW_CHARACTERS).nullable()
  })
  .strict()
  .superRefine(validateLiveDelegationEffect)

export const LiveDelegationEventSummarySchema = LiveDelegationEventSchema.omit({ content: true })
  .extend({
    contentPreview: z.string().max(LIVE_DELEGATION_MAX_PREVIEW_CHARACTERS),
    contentTruncated: z.boolean()
  })
  .strict()

export const LiveDelegationDetailSchema = z
  .object({
    delegation: LiveDelegationSummarySchema,
    turns: z.array(LiveDelegationTurnSummarySchema).max(20)
  })
  .strict()

export type LiveDelegationSummary = z.infer<typeof LiveDelegationSummarySchema>
export type LiveDelegationTurnSummary = z.infer<typeof LiveDelegationTurnSummarySchema>
export type LiveDelegationEventSummary = z.infer<typeof LiveDelegationEventSummarySchema>
export type LiveDelegationDetail = z.infer<typeof LiveDelegationDetailSchema>

export function parseLiveDelegationSubagentContext(
  value: unknown
): LiveDelegationSubagentContext | undefined {
  const parsed = LiveDelegationSubagentContextSchema.safeParse(value)
  return parsed.success ? parsed.data : undefined
}

function validateLiveDelegationEffect(
  turn: {
    effectState: z.infer<typeof OrchestrationEffectStateSchema>
    effectEvidence: z.infer<typeof OrchestrationEffectEvidenceSchema> | null
  },
  context: {
    addIssue(issue: { code: 'custom'; path: PropertyKey[]; message: string }): void
  }
): void {
  if ((turn.effectState === 'none') !== (turn.effectEvidence === null)) {
    context.addIssue({
      code: 'custom',
      path: ['effectEvidence'],
      message: 'Live delegation effect evidence must match the persisted effect state'
    })
  }
  if (turn.effectEvidence && turn.effectEvidence.classification !== turn.effectState) {
    context.addIssue({
      code: 'custom',
      path: ['effectEvidence', 'classification'],
      message: 'Live delegation effect evidence classification must match its effect state'
    })
  }
}
