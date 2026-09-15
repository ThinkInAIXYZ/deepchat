import { z } from 'zod'
import { EntityIdSchema, TimestampMsSchema } from '../common'
import {
  AgentServiceInstanceIdSchema,
  AgentServiceRequestIdSchema,
  AgentServiceRunIdSchema,
  AgentServiceSessionIdSchema,
  AgentServiceSubmissionIdSchema
} from './common'

// Stage 1B client-facing DTOs for interactions, approvals, and cancellation.
//
// This file holds the messages a client sends to resolve something that is already in flight: an
// interaction the service is waiting on, and the three cancellation layers. They share one rule
// that shapes every schema below — a resolution always names the exact thing it resolves, and the
// responder's identity is never part of the message. A transport authenticates the caller and the
// service decides whether that caller may answer; nothing here can claim `principal`, `approver`,
// `renderer`, or a remembered approval scope. A CLI therefore cannot express self-approval,
// because there is no field in which to claim it, and no shape in which a decision defaults to
// approved.
//
// These are serializable DTOs only. No runtime object, callback, `AbortSignal`, database handle, or
// absolute service path appears here, and nothing in this file is wired to a handler.

export const AGENT_SERVICE_INTERACTION_KINDS = ['permission', 'question'] as const

export const AgentServiceInteractionKindSchema = z.enum(AGENT_SERVICE_INTERACTION_KINDS)

// Identity of one pending interaction. It is a service-issued identifier, not a transport request
// id: two clients observing the same interaction resolve the same identity.
export const AgentServiceInteractionIdSchema = EntityIdSchema.max(128)

// The assistant message and tool call an interaction belongs to. A decision must name the same
// pair; a response that names a different message or tool call is a typed error, never an approval
// of whatever happens to be pending.
export const AgentServiceMessageIdSchema = EntityIdSchema.max(128)
export const AgentServiceToolCallIdSchema = EntityIdSchema.max(128)

export const AgentServiceInteractionOptionIdSchema = EntityIdSchema.max(64)

export const AGENT_SERVICE_INTERACTION_MAX_OPTIONS = 16
export const AGENT_SERVICE_INTERACTION_PROMPT_MAX_LENGTH = 4096
export const AGENT_SERVICE_INTERACTION_SUMMARY_MAX_LENGTH = 4096
export const AGENT_SERVICE_INTERACTION_ANSWER_MAX_LENGTH = 4096
export const AGENT_SERVICE_INTERACTION_OPTION_LABEL_MAX_LENGTH = 256
export const AGENT_SERVICE_INTERACTION_TOOL_NAME_MAX_LENGTH = 128

// `approved` and `denied` are both explicit answers. Neither is a default: a permission response
// that omits `decision` is invalid rather than approved, and there is no `always`, `session`,
// `applyToAll`, or `--yes` equivalent, because a remembered or broadened approval is an
// authorization decision the message must not be able to make on the user's behalf.
export const AGENT_SERVICE_INTERACTION_DECISIONS = ['approved', 'denied'] as const

export const AgentServiceInteractionDecisionSchema = z.enum(AGENT_SERVICE_INTERACTION_DECISIONS)

// Service-side settlement of a submitted response. `accepted` means the decision was recorded and
// applied to the interaction named by the response; a response that does not match the pending
// interaction is a structured error, not a resolution, so it cannot be reported as accepted.
// `expired` means the interaction was already gone when the response arrived, so the response was
// not applied.
//
// `resumed` says whether this resolution is what let the paused run continue. That is why `expired`
// and `resumed: true` cannot both hold: nothing was resumed on the strength of a response that was
// not applied. Whether an expiry ends, fails, or otherwise settles the run is a service decision
// this DTO does not report; what it must not do is claim the run resumed because of the response.
export const AGENT_SERVICE_INTERACTION_RESOLUTIONS = ['accepted', 'expired'] as const

export const AgentServiceInteractionResolutionSchema = z
  .object({
    interactionId: AgentServiceInteractionIdSchema,
    sessionId: AgentServiceSessionIdSchema,
    resolution: z.enum(AGENT_SERVICE_INTERACTION_RESOLUTIONS),
    resumed: z.boolean(),
    resolvedAt: TimestampMsSchema
  })
  .strict()
  .superRefine((resolution, context) => {
    if (resolution.resolution === 'expired' && resolution.resumed) {
      context.addIssue({
        code: 'custom',
        message: 'an expired interaction cannot be the resolution that resumed the run',
        path: ['resumed']
      })
    }
  })

// A pending interaction as published by the service. `runId` and `requestId` are required rather
// than nullable: an interaction always belongs to one running run and one model request, and a
// client that cannot correlate the decision with both must not be able to answer it.
const interactionRequestFields = {
  interactionId: AgentServiceInteractionIdSchema,
  sessionId: AgentServiceSessionIdSchema,
  runId: AgentServiceRunIdSchema,
  requestId: AgentServiceRequestIdSchema,
  messageId: AgentServiceMessageIdSchema,
  toolCallId: AgentServiceToolCallIdSchema,
  expiresAt: TimestampMsSchema
} as const

export const AgentServiceInteractionOptionSchema = z
  .object({
    optionId: AgentServiceInteractionOptionIdSchema,
    label: z.string().trim().min(1).max(AGENT_SERVICE_INTERACTION_OPTION_LABEL_MAX_LENGTH)
  })
  .strict()

export const AgentServiceInteractionRequestSchema = z.discriminatedUnion('kind', [
  z
    .object({
      ...interactionRequestFields,
      kind: z.literal('permission'),
      toolName: z.string().trim().min(1).max(AGENT_SERVICE_INTERACTION_TOOL_NAME_MAX_LENGTH),
      // A bounded human-readable description of what is being authorized. It is display material:
      // the machine-readable meaning is the interaction identity plus the tool name, so a client
      // never has to parse this text to decide, and a producer that must not disclose a value keeps
      // it out of here instead of relying on a filter.
      summary: z.string().trim().min(1).max(AGENT_SERVICE_INTERACTION_SUMMARY_MAX_LENGTH).nullable()
    })
    .strict(),
  z
    .object({
      ...interactionRequestFields,
      kind: z.literal('question'),
      prompt: z.string().trim().min(1).max(AGENT_SERVICE_INTERACTION_PROMPT_MAX_LENGTH),
      options: z
        .array(AgentServiceInteractionOptionSchema)
        .min(1)
        .max(AGENT_SERVICE_INTERACTION_MAX_OPTIONS)
        .superRefine((options, context) => {
          const seen = new Set<string>()
          options.forEach((option, index) => {
            if (seen.has(option.optionId)) {
              context.addIssue({
                code: 'custom',
                message: `Duplicate option: ${option.optionId}`,
                path: [index]
              })
            }
            seen.add(option.optionId)
          })
        })
    })
    .strict()
])

// The client's answer. The identity fields are required so a decision can never be applied to
// "the pending interaction"; they must match the interaction the service published. The response
// variant follows the interaction kind, so a permission answer always carries an explicit
// `decision` and a question answer always carries the chosen option or text.
const interactionResponseFields = {
  interactionId: AgentServiceInteractionIdSchema,
  sessionId: AgentServiceSessionIdSchema,
  messageId: AgentServiceMessageIdSchema,
  toolCallId: AgentServiceToolCallIdSchema,
  respondedAt: TimestampMsSchema
} as const

export const AgentServiceInteractionResponseSchema = z.discriminatedUnion('kind', [
  z
    .object({
      ...interactionResponseFields,
      kind: z.literal('permission'),
      decision: AgentServiceInteractionDecisionSchema
    })
    .strict(),
  z
    .object({
      ...interactionResponseFields,
      kind: z.literal('question_option'),
      optionId: AgentServiceInteractionOptionIdSchema
    })
    .strict(),
  z
    .object({
      ...interactionResponseFields,
      kind: z.literal('question_text'),
      text: z.string().trim().min(1).max(AGENT_SERVICE_INTERACTION_ANSWER_MAX_LENGTH)
    })
    .strict()
])

// Cancellation is three layers, not one `cancel(id)`. Each layer names its own target, and no layer
// can be widened into another:
//
// - `queued_submission` cancels an accepted submission that has not started. The queued input is
//   discarded; no run exists and none is created.
// - `running_run` cancels the run that is executing. The run settles as cancelled.
// - `active_turn` stops the output of the active turn (the current model request) without settling
//   or negating the run, and without touching the queue.
//
// A client disconnect is never one of these layers: an accepted run survives a disconnect, so
// stopping work is always an explicit request naming the exact layer and target. Because the union
// is discriminated on `layer` and every variant is strict, a message that names only an opaque
// `id`, or that tries to cancel two layers at once, is unrepresentable.
export const AGENT_SERVICE_CANCELLATION_LAYERS = [
  'queued_submission',
  'running_run',
  'active_turn'
] as const

export const AgentServiceCancellationLayerSchema = z.enum(AGENT_SERVICE_CANCELLATION_LAYERS)

// `cancelled` means the named target was cancelled by this request. `already_settled` means the
// target had already finished and nothing was cancelled — reported as an outcome rather than
// silently as success, so a client does not read a late cancel as having stopped a completed run.
export const AGENT_SERVICE_CANCELLATION_OUTCOMES = ['cancelled', 'already_settled'] as const

export const AgentServiceCancellationOutcomeSchema = z.enum(AGENT_SERVICE_CANCELLATION_OUTCOMES)

const queuedSubmissionTargetFields = {
  sessionId: AgentServiceSessionIdSchema,
  submissionId: AgentServiceSubmissionIdSchema
} as const

const runningRunTargetFields = {
  sessionId: AgentServiceSessionIdSchema,
  runId: AgentServiceRunIdSchema
} as const

const activeTurnTargetFields = {
  sessionId: AgentServiceSessionIdSchema,
  runId: AgentServiceRunIdSchema,
  requestId: AgentServiceRequestIdSchema
} as const

export const AgentServiceCancellationRequestSchema = z.discriminatedUnion('layer', [
  z
    .object({
      serviceInstanceId: AgentServiceInstanceIdSchema,
      layer: z.literal('queued_submission'),
      ...queuedSubmissionTargetFields
    })
    .strict(),
  z
    .object({
      serviceInstanceId: AgentServiceInstanceIdSchema,
      layer: z.literal('running_run'),
      ...runningRunTargetFields
    })
    .strict(),
  z
    .object({
      serviceInstanceId: AgentServiceInstanceIdSchema,
      layer: z.literal('active_turn'),
      ...activeTurnTargetFields
    })
    .strict()
])

const cancellationReceiptFields = {
  serviceInstanceId: AgentServiceInstanceIdSchema,
  outcome: AgentServiceCancellationOutcomeSchema,
  settledAt: TimestampMsSchema
} as const

// The receipt echoes the exact layer and target that were acted on, so a client can verify that the
// service cancelled what it asked for instead of treating any success as its own request landing.
export const AgentServiceCancellationReceiptSchema = z.discriminatedUnion('layer', [
  z
    .object({
      ...cancellationReceiptFields,
      layer: z.literal('queued_submission'),
      ...queuedSubmissionTargetFields
    })
    .strict(),
  z
    .object({
      ...cancellationReceiptFields,
      layer: z.literal('running_run'),
      ...runningRunTargetFields
    })
    .strict(),
  z
    .object({
      ...cancellationReceiptFields,
      layer: z.literal('active_turn'),
      ...activeTurnTargetFields
    })
    .strict()
])

export type AgentServiceInteractionKind = z.infer<typeof AgentServiceInteractionKindSchema>
export type AgentServiceInteractionDecision = z.infer<typeof AgentServiceInteractionDecisionSchema>
export type AgentServiceInteractionRequest = z.infer<typeof AgentServiceInteractionRequestSchema>
export type AgentServiceInteractionResponse = z.infer<typeof AgentServiceInteractionResponseSchema>
export type AgentServiceInteractionResolution = z.infer<
  typeof AgentServiceInteractionResolutionSchema
>
export type AgentServiceCancellationLayer = z.infer<typeof AgentServiceCancellationLayerSchema>
export type AgentServiceCancellationRequest = z.infer<typeof AgentServiceCancellationRequestSchema>
export type AgentServiceCancellationReceipt = z.infer<typeof AgentServiceCancellationReceiptSchema>
