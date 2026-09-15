import { z } from 'zod'
import { EntityIdSchema, SessionStatusSchema, TimestampMsSchema } from '../common'
import { JsonValueSchema, type JsonValue } from '../json'
import { LocalControlEventCursorSchema } from '../localControl'
import {
  AgentServiceInstanceIdSchema,
  AgentServiceRequestIdSchema,
  AgentServiceRunIdSchema,
  AgentServiceSessionIdSchema,
  AgentServiceSubmissionIdSchema
} from './common'
import {
  AgentServiceInteractionRequestSchema,
  AgentServiceMessageIdSchema,
  AgentServiceToolCallIdSchema
} from './interactions'

// Stage 1B client-facing DTOs for event delivery, authoritative snapshot, artifact references, and
// resync.
//
// The delivery model is bounded and fail-visible: a subscriber either continues from a cursor it
// held, or it is told explicitly that its position is unusable and must resync through an
// authoritative snapshot. There is no silent drop, no silent truncation, and no implicit gap: the
// schemas below verify the replay they accept is contiguous and starts exactly after the requested
// cursor, so a gap has to be reported as `resync_required` instead of looking like a normal stream.
//
// These are serializable DTOs only. No handle, path, runtime object, `AsyncIterable`, or provider
// client appears here, and nothing in this file is wired to a transport or handler.

// The event cursor is the maintained local-control `epoch:sequence` cursor, reused as-is. A second
// cursor definition — a bare sequence, a timestamp, an opaque token — would make "the client is
// caught up" mean two different things. The alias exists so consumers of this contract name the
// cursor without reaching into the local-control module.
export const AgentServiceEventCursorSchema = LocalControlEventCursorSchema

export const AgentServiceEventSequenceSchema = z.number().int().nonnegative()

export const AgentServiceEventIdSchema = EntityIdSchema.max(128)

// The bounded event vocabulary. A stream is a typed sequence a client can dispatch on, not a
// passthrough channel: an event type outside this set is rejected instead of being forwarded as
// unknown data.
export const AGENT_SERVICE_EVENT_TYPES = [
  'run.started',
  'run.status',
  'run.completed',
  'run.failed',
  'run.cancelled',
  'message.delta',
  'message.completed',
  'tool.call',
  'tool.result',
  'interaction.requested',
  'interaction.resolved',
  'queue.updated',
  'session.updated'
] as const

export const AgentServiceEventTypeSchema = z.enum(AGENT_SERVICE_EVENT_TYPES)

// Why a cursor can no longer be continued. `cursor_expired` and `cursor_ahead` keep the
// local-control meanings (the position is older than the retained window, or it is beyond what the
// service has emitted). `service_restarted` corresponds to the hub's `server_restarted`; the
// rename is client-facing vocabulary and belongs to the Stage 1D compatibility mapping.
// `buffer_overflow` is the bounded-backpressure outcome: a subscriber that cannot keep up is told
// to resync instead of having events dropped behind its back. `replay_limit_exceeded` is the
// replay-budget outcome: a catch-up longer than the client's declared budget is refused rather than
// truncated, because a truncated replay is indistinguishable from a complete one.
export const AGENT_SERVICE_EVENT_RESYNC_REASONS = [
  'cursor_expired',
  'cursor_ahead',
  'service_restarted',
  'buffer_overflow',
  'replay_limit_exceeded'
] as const

export const AgentServiceEventResyncReasonSchema = z.enum(AGENT_SERVICE_EVENT_RESYNC_REASONS)

export const AGENT_SERVICE_EVENT_DATA_MAX_DEPTH = 64
export const AGENT_SERVICE_EVENT_DATA_MAX_BYTES = 256 * 1024
export const AGENT_SERVICE_EVENT_MAX_ARTIFACTS = 16

export const AGENT_SERVICE_EVENT_MAX_REPLAY_EVENTS = 256
export const AGENT_SERVICE_EVENT_MAX_BUFFERED_EVENTS = 1024

export const AGENT_SERVICE_ARTIFACT_KINDS = [
  'file',
  'image',
  'log',
  'transcript',
  'export'
] as const

export const AgentServiceArtifactIdSchema = EntityIdSchema.max(128)

// An artifact reference is an owned identifier plus bounded metadata. There is deliberately no
// path, handle, url, or provider locator field: a client addresses an artifact through the service
// that owns it, and strictness makes adding a locator a reviewable contract change rather than an
// ad hoc extension. `expiresAt` is nullable because retention is the service's decision, not a
// promise this DTO can make.
export const AgentServiceArtifactRefSchema = z
  .object({
    artifactId: AgentServiceArtifactIdSchema,
    kind: z.enum(AGENT_SERVICE_ARTIFACT_KINDS),
    mediaType: z.string().trim().min(1).max(128),
    sizeBytes: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER).nullable(),
    sha256: z
      .string()
      .regex(/^[a-f0-9]{64}$/)
      .nullable(),
    label: z.string().trim().min(1).max(200).nullable(),
    expiresAt: TimestampMsSchema.nullable()
  })
  .strict()

const utf8Encoder = new TextEncoder()

// Iterative on purpose: the walk is itself bounded in stack usage, so a deep payload is rejected
// as an issue rather than throwing out of `safeParse`.
const exceedsEventDataDepth = (value: JsonValue, maxDepth: number): boolean => {
  const pending: Array<{ value: JsonValue; depth: number }> = [{ value, depth: 1 }]
  while (pending.length > 0) {
    const current = pending.pop()
    if (current === undefined) break
    if (current.depth > maxDepth) return true
    const item = current.value
    if (Array.isArray(item)) {
      for (const child of item) pending.push({ value: child, depth: current.depth + 1 })
      continue
    }
    if (item !== null && typeof item === 'object') {
      for (const child of Object.values(item)) {
        pending.push({ value: child, depth: current.depth + 1 })
      }
    }
  }
  return false
}

const readCursorParts = (cursor: string): { epoch: string; sequence: number } | null => {
  const separator = cursor.lastIndexOf(':')
  if (separator <= 0) return null
  const rawSequence = cursor.slice(separator + 1)
  if (!/^(?:0|[1-9][0-9]*)$/.test(rawSequence)) return null
  return { epoch: cursor.slice(0, separator), sequence: Number(rawSequence) }
}

// One typed event. `cursor` and `sequence` are redundant by construction and the schema proves it:
// the sequence must equal the cursor's sequence, so a producer cannot hand out a position that does
// not match the durable ordering a client will resume from. `data` is the event's JSON payload,
// bounded in depth and encoded size; `artifacts` is the typed side channel, so artifact references
// travel as validated references instead of being buried in opaque data.
//
// Correlation ids are present-and-nullable rather than optional, so "no run" and "field omitted"
// cannot be confused by a client or by a producer that forgets one.
export const AgentServiceEventEnvelopeSchema = z
  .object({
    serviceInstanceId: AgentServiceInstanceIdSchema,
    sessionId: AgentServiceSessionIdSchema,
    eventId: AgentServiceEventIdSchema,
    type: AgentServiceEventTypeSchema,
    cursor: AgentServiceEventCursorSchema,
    sequence: AgentServiceEventSequenceSchema,
    timestamp: TimestampMsSchema,
    runId: AgentServiceRunIdSchema.nullable(),
    requestId: AgentServiceRequestIdSchema.nullable(),
    messageId: AgentServiceMessageIdSchema.nullable(),
    toolCallId: AgentServiceToolCallIdSchema.nullable(),
    artifacts: z
      .array(AgentServiceArtifactRefSchema)
      .max(AGENT_SERVICE_EVENT_MAX_ARTIFACTS)
      .optional(),
    interaction: AgentServiceInteractionRequestSchema.optional(),
    data: JsonValueSchema
  })
  .strict()
  .superRefine((event, context) => {
    const cursorParts = readCursorParts(event.cursor)
    if (cursorParts !== null && cursorParts.sequence !== event.sequence) {
      context.addIssue({
        code: 'custom',
        message: 'sequence must match the cursor sequence',
        path: ['sequence']
      })
    }

    // The typed interaction payload is tied to its event type in both directions: an
    // `interaction.requested` event must carry one, and no other event type may. When it is present,
    // the envelope's own correlation ids must agree with it, so one request cannot be described by
    // two conflicting message/tool-call identities.
    if (event.type === 'interaction.requested') {
      if (event.interaction === undefined) {
        context.addIssue({
          code: 'custom',
          message: 'interaction is required when type is interaction.requested',
          path: ['interaction']
        })
      } else {
        if (event.interaction.sessionId !== event.sessionId) {
          context.addIssue({
            code: 'custom',
            message: 'interaction sessionId must match the event sessionId',
            path: ['interaction', 'sessionId']
          })
        }
        if (event.interaction.messageId !== event.messageId) {
          context.addIssue({
            code: 'custom',
            message: 'interaction messageId must match the event messageId',
            path: ['messageId']
          })
        }
        if (event.interaction.toolCallId !== event.toolCallId) {
          context.addIssue({
            code: 'custom',
            message: 'interaction toolCallId must match the event toolCallId',
            path: ['toolCallId']
          })
        }
      }
    } else if (event.interaction !== undefined) {
      context.addIssue({
        code: 'custom',
        message: 'interaction is only valid when type is interaction.requested',
        path: ['interaction']
      })
    }

    if (exceedsEventDataDepth(event.data, AGENT_SERVICE_EVENT_DATA_MAX_DEPTH)) {
      context.addIssue({
        code: 'custom',
        message: `Event data depth exceeds ${AGENT_SERVICE_EVENT_DATA_MAX_DEPTH}`,
        path: ['data']
      })
      return
    }

    // Measured on the parsed value, which is plain JSON by construction, so encoding cannot fail.
    // The bound is stated here rather than left to the transport: an event that is too large to be
    // a bounded stream record is rejected by the contract, not accepted and then dropped.
    if (
      utf8Encoder.encode(JSON.stringify(event.data)).length > AGENT_SERVICE_EVENT_DATA_MAX_BYTES
    ) {
      context.addIssue({
        code: 'custom',
        message: `Event data exceeds ${AGENT_SERVICE_EVENT_DATA_MAX_BYTES} bytes`,
        path: ['data']
      })
    }
  })

// Subscription request. `cursor` is required and nullable: `null` means "start from now", and an
// omitted cursor is invalid, so a client that lost its position cannot accidentally be treated as a
// fresh subscriber. The two budgets are the client's declared bounds, capped by the service's own
// constants; the service echoes what it accepted instead of assuming them.
export const AgentServiceEventSubscriptionRequestSchema = z
  .object({
    serviceInstanceId: AgentServiceInstanceIdSchema,
    sessionId: AgentServiceSessionIdSchema,
    cursor: AgentServiceEventCursorSchema.nullable(),
    maxReplayEvents: z.number().int().min(1).max(AGENT_SERVICE_EVENT_MAX_REPLAY_EVENTS),
    maxBufferedEvents: z.number().int().min(1).max(AGENT_SERVICE_EVENT_MAX_BUFFERED_EVENTS)
  })
  .strict()

const resyncRequiredFields = {
  serviceInstanceId: AgentServiceInstanceIdSchema,
  sessionId: AgentServiceSessionIdSchema,
  reason: AgentServiceEventResyncReasonSchema,
  // The cursor an authoritative snapshot must be taken at. A client that resyncs from anything else
  // would be re-reading a position the service has already passed.
  authoritativeCursor: AgentServiceEventCursorSchema
} as const

export const AgentServiceResyncRequiredSchema = z.object(resyncRequiredFields).strict()

const streamingSubscriptionFields = {
  serviceInstanceId: AgentServiceInstanceIdSchema,
  sessionId: AgentServiceSessionIdSchema,
  requestedCursor: AgentServiceEventCursorSchema.nullable(),
  initialCursor: AgentServiceEventCursorSchema,
  acceptedMaxReplayEvents: z.number().int().min(1).max(AGENT_SERVICE_EVENT_MAX_REPLAY_EVENTS),
  acceptedMaxBufferedEvents: z.number().int().min(1).max(AGENT_SERVICE_EVENT_MAX_BUFFERED_EVENTS),
  replayedEvents: z
    .array(AgentServiceEventEnvelopeSchema)
    .max(AGENT_SERVICE_EVENT_MAX_REPLAY_EVENTS)
} as const

// Subscription response. `streaming` carries the bounded catch-up replay and the position the live
// stream continues from; `resync_required` refuses the subscription and names why, with the cursor
// a snapshot must be taken at. The two are mutually exclusive by discriminator: a service cannot
// answer "here is a gap-free replay" and "your position is unusable" at once.
export const AgentServiceEventSubscriptionResponseSchema = z
  .discriminatedUnion('status', [
    z
      .object({
        status: z.literal('streaming'),
        ...streamingSubscriptionFields
      })
      .strict(),
    z
      .object({
        status: z.literal('resync_required'),
        ...resyncRequiredFields
      })
      .strict()
  ])
  // The replay is verified, not trusted: it must belong to the subscribed session and instance,
  // stay in the requested epoch, start immediately after the requested cursor, advance by exactly
  // one sequence at a time, end at `initialCursor`, and fit the accepted budget. A replay that
  // fails any of these is a gap in disguise, so it fails closed and the client must resync.
  .superRefine((subscription, context) => {
    if (subscription.status !== 'streaming') return

    const replayed = subscription.replayedEvents
    if (replayed.length > subscription.acceptedMaxReplayEvents) {
      context.addIssue({
        code: 'custom',
        message: 'replayedEvents exceed the accepted replay budget',
        path: ['replayedEvents']
      })
    }

    replayed.forEach((event, index) => {
      if (event.serviceInstanceId !== subscription.serviceInstanceId) {
        context.addIssue({
          code: 'custom',
          message: 'replayed event serviceInstanceId must match the subscription',
          path: ['replayedEvents', index, 'serviceInstanceId']
        })
      }
      if (event.sessionId !== subscription.sessionId) {
        context.addIssue({
          code: 'custom',
          message: 'replayed event sessionId must match the subscription',
          path: ['replayedEvents', index, 'sessionId']
        })
      }
    })

    const initial = readCursorParts(subscription.initialCursor)
    const requested =
      subscription.requestedCursor === null ? null : readCursorParts(subscription.requestedCursor)

    if (initial !== null && requested !== null && initial.epoch !== requested.epoch) {
      context.addIssue({
        code: 'custom',
        message: 'initialCursor must stay in the requested cursor epoch',
        path: ['initialCursor']
      })
    }

    if (subscription.requestedCursor === null) {
      if (replayed.length > 0) {
        context.addIssue({
          code: 'custom',
          message: 'a subscription without a cursor must not replay events',
          path: ['replayedEvents']
        })
      }
      return
    }

    if (replayed.length === 0) {
      if (subscription.initialCursor !== subscription.requestedCursor) {
        context.addIssue({
          code: 'custom',
          message: 'initialCursor must equal the requested cursor when nothing is replayed',
          path: ['initialCursor']
        })
      }
      return
    }

    const first = replayed[0]
    if (first !== undefined && requested !== null) {
      const firstParts = readCursorParts(first.cursor)
      if (firstParts !== null) {
        if (firstParts.epoch !== requested.epoch) {
          context.addIssue({
            code: 'custom',
            message: 'replayed events must stay in the requested cursor epoch',
            path: ['replayedEvents', 0, 'cursor']
          })
        }
        if (firstParts.sequence !== requested.sequence + 1) {
          context.addIssue({
            code: 'custom',
            message: 'replayed events must start immediately after the requested cursor',
            path: ['replayedEvents', 0, 'cursor']
          })
        }
      }
    }

    for (let index = 1; index < replayed.length; index += 1) {
      const previous = replayed[index - 1]
      const current = replayed[index]
      if (previous === undefined || current === undefined) continue
      if (current.sequence !== previous.sequence + 1) {
        context.addIssue({
          code: 'custom',
          message: 'replayed events must be contiguous',
          path: ['replayedEvents', index, 'sequence']
        })
      }
    }

    const last = replayed[replayed.length - 1]
    if (last !== undefined && last.cursor !== subscription.initialCursor) {
      context.addIssue({
        code: 'custom',
        message: 'initialCursor must equal the last replayed event cursor',
        path: ['initialCursor']
      })
    }
  })

// In-band stream record. Events arrive as `event` records; an `resync_required` record terminates
// the stream and tells the client its position is unusable, which is the only way a subscriber that
// fell behind — or a service that restarted — is reported. There is no "gap" or "dropped" record,
// because a gap must not be representable as something a client could ignore.
export const AgentServiceEventStreamRecordSchema = z.discriminatedUnion('kind', [
  z
    .object({
      kind: z.literal('event'),
      event: AgentServiceEventEnvelopeSchema
    })
    .strict(),
  z
    .object({
      kind: z.literal('resync_required'),
      ...resyncRequiredFields
    })
    .strict()
])

// Snapshot request. Resync is a two-step path — refuse the stream, then read the authoritative
// state — so the snapshot response stays bounded instead of being smuggled into the subscription
// response. After applying the snapshot, a client resubscribes with the snapshot's cursor.
export const AgentServiceSnapshotRequestSchema = z
  .object({
    serviceInstanceId: AgentServiceInstanceIdSchema,
    sessionId: AgentServiceSessionIdSchema
  })
  .strict()

export const AGENT_SERVICE_MESSAGE_TEXT_MAX_BYTES = 128 * 1024
export const AGENT_SERVICE_SNAPSHOT_MAX_MESSAGES = 100
export const AGENT_SERVICE_SNAPSHOT_MAX_QUEUED_SUBMISSIONS = 64
export const AGENT_SERVICE_SNAPSHOT_MAX_PENDING_INTERACTIONS = 32
export const AGENT_SERVICE_SNAPSHOT_MAX_ARTIFACTS = 64

const BoundedMessageTextSchema = z
  .string()
  .refine((value) => utf8Encoder.encode(value).byteLength <= AGENT_SERVICE_MESSAGE_TEXT_MAX_BYTES, {
    message: 'Message text exceeds its UTF-8 byte limit'
  })

export const AgentServiceSnapshotMessageSchema = z
  .object({
    messageId: AgentServiceMessageIdSchema,
    role: z.enum(['user', 'assistant']),
    status: z.enum(['pending', 'sent', 'error']),
    text: BoundedMessageTextSchema,
    textTruncated: z.boolean(),
    createdAt: TimestampMsSchema,
    updatedAt: TimestampMsSchema
  })
  .strict()

export const AgentServiceQueuedSubmissionSchema = z
  .object({
    submissionId: AgentServiceSubmissionIdSchema,
    receivedAt: TimestampMsSchema
  })
  .strict()

// Authoritative session state at one cursor. It is authoritative for `status`, `cursor`, the
// queue, the pending interactions, and the artifact set — the things a client cannot reconstruct
// from a stale projection. `messages` is explicitly a bounded projection: when
// `messagesTruncated` is true the projection omits messages that must be read through a separate
// paged operation, so a client never mistakes a bounded window for the whole transcript.
export const AgentServiceSnapshotSchema = z
  .object({
    serviceInstanceId: AgentServiceInstanceIdSchema,
    sessionId: AgentServiceSessionIdSchema,
    capturedAt: TimestampMsSchema,
    cursor: AgentServiceEventCursorSchema,
    status: SessionStatusSchema,
    // The current run, if any. `requestId` is nullable because a run between model requests has no
    // active one; no run id, status enum, or handle beyond these is promised here.
    activeRun: z
      .object({
        runId: AgentServiceRunIdSchema,
        requestId: AgentServiceRequestIdSchema.nullable()
      })
      .strict()
      .nullable(),
    queuedSubmissions: z
      .array(AgentServiceQueuedSubmissionSchema)
      .max(AGENT_SERVICE_SNAPSHOT_MAX_QUEUED_SUBMISSIONS),
    // Pending interactions travel with the snapshot so a reconnecting client can render and answer
    // them without waiting for a replayed event it may never receive.
    pendingInteractions: z
      .array(AgentServiceInteractionRequestSchema)
      .max(AGENT_SERVICE_SNAPSHOT_MAX_PENDING_INTERACTIONS),
    messages: z.array(AgentServiceSnapshotMessageSchema).max(AGENT_SERVICE_SNAPSHOT_MAX_MESSAGES),
    messagesTruncated: z.boolean(),
    artifacts: z.array(AgentServiceArtifactRefSchema).max(AGENT_SERVICE_SNAPSHOT_MAX_ARTIFACTS)
  })
  .strict()

export type AgentServiceEventType = z.infer<typeof AgentServiceEventTypeSchema>
export type AgentServiceEventResyncReason = z.infer<typeof AgentServiceEventResyncReasonSchema>
export type AgentServiceArtifactRef = z.infer<typeof AgentServiceArtifactRefSchema>
export type AgentServiceEventEnvelope = z.infer<typeof AgentServiceEventEnvelopeSchema>
export type AgentServiceEventSubscriptionRequest = z.infer<
  typeof AgentServiceEventSubscriptionRequestSchema
>
export type AgentServiceEventSubscriptionResponse = z.infer<
  typeof AgentServiceEventSubscriptionResponseSchema
>
export type AgentServiceEventStreamRecord = z.infer<typeof AgentServiceEventStreamRecordSchema>
export type AgentServiceResyncRequired = z.infer<typeof AgentServiceResyncRequiredSchema>
export type AgentServiceSnapshotRequest = z.infer<typeof AgentServiceSnapshotRequestSchema>
export type AgentServiceSnapshot = z.infer<typeof AgentServiceSnapshotSchema>
