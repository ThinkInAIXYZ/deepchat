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

const EVENT_DATA_NOT_PLAIN_JSON = 'Event data must be plain JSON data'

type EventDataRead = { ok: true; value: JsonValue } | { ok: false; message: string }

// Where a copied value is attached. The root value has no parent, so its slot is `null`.
type EventDataSlot = {
  parent: JsonValue[] | Record<string, JsonValue>
  key: string | number
}

type EventDataFrame =
  | { kind: 'value'; source: unknown; depth: number; slot: EventDataSlot | null }
  | { kind: 'leave'; source: object }

// Event payloads are read before they are validated. `JsonValueSchema` is recursive, and a recursive
// schema is not fail-closed for an in-process value: a payload deep enough to exhaust the stack makes
// `safeParse` throw `RangeError` instead of returning issues, which is the one outcome this contract
// must not have. The walk below is iterative, so its own stack use is bounded by the depth budget
// rather than by the input, and only the bounded plain copy it builds is handed to `JsonValueSchema`.
//
// The accepted surface is plain JSON data and nothing else: `null`, strings, booleans, finite
// numbers, dense arrays, and objects with a plain prototype and enumerable own data properties.
// Rejected as issues: cycles, array holes and non-index array properties, accessors, enumerable
// symbol keys, `undefined`, functions, symbols, bigints, non-finite numbers, `Date`/`Map`/class
// instances (any non-plain prototype), payloads deeper than `AGENT_SERVICE_EVENT_DATA_MAX_DEPTH`,
// and payloads whose encoded copy exceeds `AGENT_SERVICE_EVENT_DATA_MAX_BYTES`.
//
// No value from the input is invoked: nested values are taken from property descriptors, so an
// accessor is refused instead of called. The measured value is the copy built here, and it is that
// copy which is returned and handed to `JsonValueSchema`, so the byte budget is spent on the bytes
// the accepted value encodes to and no input value is read twice. A `Proxy` is not reliably
// distinguishable from a plain object, so proxies are not detected as such: one is copied like any
// other input, and a proxy whose own reads throw is rejected by the `try` around this read rather
// than by an exception out of `safeParse`.
const readEventData = (input: unknown): EventDataRead => {
  const ancestors = new Set<object>()
  const stack: EventDataFrame[] = [{ kind: 'value', source: input, depth: 1, slot: null }]
  // Assigned by the root frame before the walk ends; every other exit returns a rejection.
  const root: { value: JsonValue } = { value: null }
  let nodes = 0

  const attach = (slot: EventDataSlot | null, value: JsonValue): void => {
    if (slot === null) {
      root.value = value
      return
    }
    const { parent, key } = slot
    if (Array.isArray(parent)) {
      parent[key as number] = value
      return
    }
    // A `__proto__` key stays an own property: assigning it would run the setter on
    // `Object.prototype` and silently replace the copy's prototype instead of copying the key.
    Object.defineProperty(parent, String(key), {
      value,
      enumerable: true,
      writable: true,
      configurable: true
    })
  }

  while (stack.length > 0) {
    const frame = stack.pop()
    if (frame === undefined) break

    if (frame.kind === 'leave') {
      ancestors.delete(frame.source)
      continue
    }

    const { source, depth, slot } = frame
    if (depth > AGENT_SERVICE_EVENT_DATA_MAX_DEPTH) {
      return {
        ok: false,
        message: `Event data depth exceeds ${AGENT_SERVICE_EVENT_DATA_MAX_DEPTH}`
      }
    }
    nodes += 1
    // Work bound: a node always costs at least one encoded byte plus the delimiter that joins it to
    // its parent, so a payload with more nodes than the byte budget can only be one the byte check
    // below rejects as well. It stops an oversized payload from being copied in full first.
    if (nodes > AGENT_SERVICE_EVENT_DATA_MAX_BYTES) {
      return {
        ok: false,
        message: `Event data exceeds ${AGENT_SERVICE_EVENT_DATA_MAX_BYTES} bytes`
      }
    }

    if (source === null || typeof source === 'string' || typeof source === 'boolean') {
      attach(slot, source)
      continue
    }

    if (typeof source === 'number') {
      // JSON has no encoding for `NaN` or `Infinity`; both stringify to `null`, which would make the
      // accepted value differ from the one a client reads back.
      if (!Number.isFinite(source)) {
        return { ok: false, message: 'Event data is not JSON-encodable' }
      }
      attach(slot, source)
      continue
    }

    if (typeof source !== 'object') {
      // `undefined`, functions, symbols, and bigints have no JSON encoding at all.
      return { ok: false, message: 'Event data is not JSON-encodable' }
    }

    if (ancestors.has(source)) {
      return { ok: false, message: `${EVENT_DATA_NOT_PLAIN_JSON}: a cycle is not JSON` }
    }

    if (Array.isArray(source)) {
      // A hole, or an enumerable non-index property, makes `Object.keys` disagree with `length`.
      // Neither is representable in a JSON array, and a hole would otherwise be copied as `null`.
      const keys = Object.keys(source)
      if (keys.length !== source.length) {
        return {
          ok: false,
          message: `${EVENT_DATA_NOT_PLAIN_JSON}: array holes and non-index array properties are not allowed`
        }
      }
      const copy: JsonValue[] = []
      attach(slot, copy)
      ancestors.add(source)
      stack.push({ kind: 'leave', source })
      for (let index = source.length - 1; index >= 0; index -= 1) {
        const descriptor = Object.getOwnPropertyDescriptor(source, String(index))
        if (descriptor === undefined || !('value' in descriptor)) {
          return {
            ok: false,
            message: `${EVENT_DATA_NOT_PLAIN_JSON}: array holes and accessors are not allowed`
          }
        }
        stack.push({
          kind: 'value',
          source: descriptor.value,
          depth: depth + 1,
          slot: { parent: copy, key: index }
        })
      }
      continue
    }

    const prototype = Object.getPrototypeOf(source)
    if (prototype !== Object.prototype && prototype !== null) {
      return {
        ok: false,
        message: `${EVENT_DATA_NOT_PLAIN_JSON}: object must have a plain prototype`
      }
    }

    // An enumerable symbol key is a member JSON has no way to encode. Refusing it here keeps this
    // read the single place that decides what event data may contain.
    if (
      Object.getOwnPropertySymbols(source).some(
        (key) => Object.getOwnPropertyDescriptor(source, key)?.enumerable
      )
    ) {
      return { ok: false, message: `${EVENT_DATA_NOT_PLAIN_JSON}: symbol keys are not allowed` }
    }

    const copy: Record<string, JsonValue> = {}
    attach(slot, copy)
    ancestors.add(source)
    stack.push({ kind: 'leave', source })
    const keys = Object.keys(source)
    for (let index = keys.length - 1; index >= 0; index -= 1) {
      const key = keys[index]
      if (key === undefined) continue
      const descriptor = Object.getOwnPropertyDescriptor(source, key)
      if (descriptor === undefined || !('value' in descriptor)) {
        return {
          ok: false,
          message: `${EVENT_DATA_NOT_PLAIN_JSON}: accessor properties are not allowed`
        }
      }
      stack.push({
        kind: 'value',
        source: descriptor.value,
        depth: depth + 1,
        slot: { parent: copy, key }
      })
    }
  }

  // The copy is plain, bounded in depth, and acyclic, so encoding it here cannot fail. The bound is
  // stated on the value a client receives: an event too large to be a bounded stream record is
  // rejected by the contract, not accepted and then dropped by the transport.
  if (utf8Encoder.encode(JSON.stringify(root.value)).length > AGENT_SERVICE_EVENT_DATA_MAX_BYTES) {
    return { ok: false, message: `Event data exceeds ${AGENT_SERVICE_EVENT_DATA_MAX_BYTES} bytes` }
  }
  return { ok: true, value: root.value }
}

// The read above already rejects everything that is not bounded plain JSON and builds the value that
// is measured and returned, so this stage only turns the read's own rejection into an issue. The
// fail-closed guarantee lives here: an adversarial in-process value is rejected as an issue, never as
// an exception out of `safeParse`. The input type is deliberately `unknown` — a value held in process
// is not JSON until the read above says it is — and the piped `JsonValueSchema` narrows the output
// back to `JsonValue`.
const AgentServiceEventDataSchema: z.ZodType<JsonValue, unknown> = z
  .unknown()
  .transform((value, context): unknown => {
    try {
      const read = readEventData(value)
      if (!read.ok) {
        context.addIssue({ code: 'custom', message: read.message })
        return z.NEVER
      }
      return read.value
    } catch {
      // A `Proxy` cannot be identified reliably, so an input whose own reads throw is rejected here
      // instead of letting the exception out of `safeParse`.
      context.addIssue({ code: 'custom', message: 'Event data could not be read' })
      return z.NEVER
    }
  })
  .pipe(JsonValueSchema)

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
    // `data` is read into a bounded plain copy before it is validated as JSON; see
    // `AgentServiceEventDataSchema` for why the recursive schema alone is not fail-closed here.
    data: AgentServiceEventDataSchema
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

    const requested =
      subscription.requestedCursor === null ? null : readCursorParts(subscription.requestedCursor)
    const requestedEpoch = requested === null ? null : requested.epoch

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
      // Every replayed event, not just the first, must stay in the requested epoch. One event from
      // another epoch in the middle is a replay spliced across a restart boundary: the sequences can
      // still look contiguous while the positions belong to two different orderings.
      if (requestedEpoch !== null) {
        const eventParts = readCursorParts(event.cursor)
        if (eventParts !== null && eventParts.epoch !== requestedEpoch) {
          context.addIssue({
            code: 'custom',
            message: 'replayed events must stay in the requested cursor epoch',
            path: ['replayedEvents', index, 'cursor']
          })
        }
      }
    })

    const initial = readCursorParts(subscription.initialCursor)

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
        // The epoch of every replayed event is checked above; what is left here is that the replay
        // starts exactly at the position after the requested cursor.
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
  // The snapshot is authoritative for exactly one session, so every pending interaction it carries
  // must belong to that session. An interaction from another session would let a client answer
  // something this snapshot never published as pending, which is the confusion the interaction
  // identity exists to prevent. The binding lives here because the interaction DTO cannot know which
  // snapshot carries it.
  .superRefine((snapshot, context) => {
    snapshot.pendingInteractions.forEach((interaction, index) => {
      if (interaction.sessionId !== snapshot.sessionId) {
        context.addIssue({
          code: 'custom',
          message: 'pending interaction sessionId must match the snapshot sessionId',
          path: ['pendingInteractions', index, 'sessionId']
        })
      }
    })
  })

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
