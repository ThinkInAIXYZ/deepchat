import { z } from 'zod'
import { OrchestrationEffectEvidenceSchema, OrchestrationEffectStateSchema } from './toolEffect'
import {
  DeepChatEvaluationRefSchema,
  DeepChatStoredTaskEvaluationProjectionSchema,
  DeepChatTaskEvaluationSummarySchema,
  DeepChatTaskContractProjectionSchema,
  DeepChatTaskContractRefSchema
} from '../types/task-contract'

export const LIVE_DELEGATION_SCHEMA_VERSION = 1
export const LIVE_DELEGATION_MAX_TITLE_LENGTH = 160
export const LIVE_DELEGATION_MAX_PROMPT_BYTES = 64 * 1024
export const LIVE_DELEGATION_MAX_MESSAGE_BYTES = 8 * 1024
export const LIVE_DELEGATION_MAX_PENDING_MESSAGE_BYTES = 32 * 1024
export const LIVE_DELEGATION_MAX_HANDOFF_BYTES = 16 * 1024
export const LIVE_DELEGATION_HANDOFF_TOKEN_BUDGET = 2_000
export const LIVE_DELEGATION_MAX_RESULT_REF_BYTES = 4 * 1024
export const LIVE_DELEGATION_RESULT_PAGE_DEFAULT_TOKENS = 2_000
export const LIVE_DELEGATION_RESULT_PAGE_MAX_TOKENS = 4_000
export const LIVE_DELEGATION_RESULT_PAGE_MAX_BYTES = 16 * 1024
export const LIVE_DELEGATION_RESULT_CURSOR_MAX_LENGTH = 512
export const LIVE_DELEGATION_MAX_EFFECT_EVIDENCE_BYTES = 8 * 1024
export const LIVE_DELEGATION_MAX_PREVIEW_CHARACTERS = 2 * 1024
export const LIVE_DELEGATION_MAX_EVENT_PREVIEW_CHARACTERS = 16 * 1024
export const LIVE_DELEGATION_MAX_ACTIVE_PER_PARENT = 5
export const LIVE_DELEGATION_MAX_WAITS_PER_PARENT = 5
export const LIVE_DELEGATION_WAIT_DEFAULT_TIMEOUT_MS = 30_000
export const LIVE_DELEGATION_WAIT_MAX_TIMEOUT_MS = 10 * 60_000

export const LIVE_DELEGATION_OPERATIONS = [
  'spawn',
  'send',
  'follow_up',
  'list',
  'inspect',
  'read_result',
  'wait',
  'interrupt'
] as const

export const LiveDelegationOperationSchema = z.enum(LIVE_DELEGATION_OPERATIONS)

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

export const LiveDelegationResultRefSchema = z
  .object({
    schemaVersion: z.literal(1),
    childSessionId: LiveDelegationIdSchema,
    childMessageId: LiveDelegationIdSchema,
    answerSha256: z.string().regex(/^[0-9a-f]{64}$/u),
    answerBytes: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
    answerEstimatedTokens: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
    handoffSource: z.enum(['handoff_section', 'result_section', 'final_answer']),
    handoffTruncated: z.boolean()
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
    resultRef: LiveDelegationResultRefSchema.nullable().default(null),
    tapeReceipt: LiveDelegationTapeReceiptSchema.nullable(),
    taskContract: DeepChatTaskContractProjectionSchema.nullable().default(null),
    taskContractRef: DeepChatTaskContractRefSchema.nullable().default(null),
    inheritedTaskContractRef: DeepChatTaskContractRefSchema.nullable().default(null),
    evaluation: DeepChatStoredTaskEvaluationProjectionSchema.nullable().default(null),
    evaluationRef: DeepChatEvaluationRefSchema.nullable().default(null),
    effectState: OrchestrationEffectStateSchema,
    effectEvidence: OrchestrationEffectEvidenceSchema.nullable(),
    createdAt: z.number().int().nonnegative(),
    startedAt: z.number().int().nonnegative().nullable(),
    updatedAt: z.number().int().nonnegative(),
    completedAt: z.number().int().nonnegative().nullable()
  })
  .strict()

export const LiveDelegationTurnSchema = LiveDelegationTurnBaseSchema.superRefine(
  validateLiveDelegationTurn
)

const LiveDelegationEventBaseSchema = z
  .object({
    id: z.number().int().positive(),
    delegationId: LiveDelegationIdSchema,
    parentSessionId: LiveDelegationIdSchema,
    direction: LiveDelegationEventDirectionSchema,
    kind: LiveDelegationEventKindSchema,
    content: z.string(),
    relatedTurnId: LiveDelegationIdSchema.nullable(),
    consumedByTurnId: LiveDelegationIdSchema.nullable(),
    evaluation: DeepChatStoredTaskEvaluationProjectionSchema.nullable().default(null),
    evaluationRef: DeepChatEvaluationRefSchema.nullable().default(null),
    createdAt: z.number().int().nonnegative()
  })
  .strict()

export const LiveDelegationEventSchema = LiveDelegationEventBaseSchema.superRefine(
  validateLiveDelegationEvent
)

export type LiveDelegationStatus = z.infer<typeof LiveDelegationStatusSchema>
export type LiveDelegationOperation = z.infer<typeof LiveDelegationOperationSchema>
export type LiveDelegationTurnStatus = z.infer<typeof LiveDelegationTurnStatusSchema>
export type LiveDelegationEventDirection = z.infer<typeof LiveDelegationEventDirectionSchema>
export type LiveDelegationEventKind = z.infer<typeof LiveDelegationEventKindSchema>
export type LiveDelegationSubagentContext = z.infer<typeof LiveDelegationSubagentContextSchema>
export type LiveDelegationTapeReceipt = z.infer<typeof LiveDelegationTapeReceiptSchema>
export type LiveDelegationResultRef = z.infer<typeof LiveDelegationResultRefSchema>
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
  error: true,
  taskContract: true,
  taskContractRef: true,
  inheritedTaskContractRef: true,
  evaluation: true,
  evaluationRef: true
})
  .extend({
    promptPreview: z.string().max(LIVE_DELEGATION_MAX_PREVIEW_CHARACTERS),
    resultPreview: z.string().max(LIVE_DELEGATION_MAX_PREVIEW_CHARACTERS).nullable(),
    errorPreview: z.string().max(LIVE_DELEGATION_MAX_PREVIEW_CHARACTERS).nullable(),
    evaluation: DeepChatTaskEvaluationSummarySchema.nullable().default(null)
  })
  .strict()
  .superRefine(validateLiveDelegationEffect)

export const LiveDelegationEventSummarySchema = LiveDelegationEventBaseSchema.omit({
  content: true,
  evaluation: true,
  evaluationRef: true
})
  .extend({
    contentPreview: z.string().max(LIVE_DELEGATION_MAX_EVENT_PREVIEW_CHARACTERS),
    contentTruncated: z.boolean(),
    evaluation: DeepChatTaskEvaluationSummarySchema.nullable().default(null)
  })
  .strict()

export const LiveDelegationResultPageSchema = z
  .object({
    schemaVersion: z.literal(1),
    delegationId: LiveDelegationIdSchema,
    turnId: LiveDelegationIdSchema,
    turnSeq: z.number().int().positive(),
    childSessionId: LiveDelegationIdSchema,
    childMessageId: LiveDelegationIdSchema,
    answerSha256: z.string().regex(/^[0-9a-f]{64}$/u),
    answerBytes: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
    answerEstimatedTokens: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
    evaluation: DeepChatTaskEvaluationSummarySchema.nullable().default(null),
    text: z.string(),
    nextCursor: z.string().max(LIVE_DELEGATION_RESULT_CURSOR_MAX_LENGTH).nullable(),
    done: z.boolean()
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
export type LiveDelegationResultPage = z.infer<typeof LiveDelegationResultPageSchema>
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

function validateLiveDelegationTurn(
  turn: z.infer<typeof LiveDelegationTurnBaseSchema>,
  context: {
    addIssue(issue: { code: 'custom'; path: PropertyKey[]; message: string }): void
  }
): void {
  validateLiveDelegationEffect(turn, context)
  if ((turn.evaluation === null) !== (turn.evaluationRef === null)) {
    context.addIssue({
      code: 'custom',
      path: ['evaluationRef'],
      message: 'Live delegation evaluation and reference must be projected together'
    })
    return
  }
  if (!turn.evaluation || !turn.evaluationRef) return
  if (
    !turn.taskContract ||
    turn.evaluation.turnId !== turn.id ||
    turn.evaluation.taskContractHash !== turn.taskContract.contractHash ||
    turn.evaluation.executionStatus !== turn.status ||
    turn.evaluationRef.sessionId !== turn.taskContract.taskDescription.parentSessionId ||
    turn.evaluationRef.tapeIdentity !== turn.taskContractRef?.tapeIdentity ||
    turn.evaluationRef.evaluationHash !== turn.evaluation.evaluationHash
  ) {
    context.addIssue({
      code: 'custom',
      path: ['evaluation'],
      message: 'Live delegation evaluation does not match its turn projection'
    })
  }
}

function validateLiveDelegationEvent(
  event: z.infer<typeof LiveDelegationEventBaseSchema>,
  context: {
    addIssue(issue: { code: 'custom'; path: PropertyKey[]; message: string }): void
  }
): void {
  if ((event.evaluation === null) !== (event.evaluationRef === null)) {
    context.addIssue({
      code: 'custom',
      path: ['evaluationRef'],
      message: 'Live delegation event evaluation and reference must be stored together'
    })
    return
  }
  if (!event.evaluation || !event.evaluationRef) return
  const expectedKind =
    event.evaluation.executionStatus === 'completed'
      ? 'turn_completed'
      : event.evaluation.executionStatus === 'failed'
        ? 'turn_failed'
        : event.evaluation.executionStatus === 'cancelled'
          ? 'turn_cancelled'
          : 'turn_interrupted'
  if (
    event.direction !== 'child_to_parent' ||
    event.kind !== expectedKind ||
    event.relatedTurnId !== event.evaluation.turnId ||
    event.evaluationRef.sessionId !== event.parentSessionId ||
    event.evaluationRef.evaluationHash !== event.evaluation.evaluationHash
  ) {
    context.addIssue({
      code: 'custom',
      path: ['evaluation'],
      message: 'Live delegation event evaluation does not match its mailbox identity'
    })
  }
}
