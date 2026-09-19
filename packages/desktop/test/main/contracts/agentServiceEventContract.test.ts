import { describe, expect, it } from 'vitest'
import {
  AGENT_SERVICE_ARTIFACT_KINDS,
  AGENT_SERVICE_EVENT_DATA_MAX_BYTES,
  AGENT_SERVICE_EVENT_DATA_MAX_DEPTH,
  AGENT_SERVICE_EVENT_MAX_ARTIFACTS,
  AGENT_SERVICE_EVENT_MAX_BUFFERED_EVENTS,
  AGENT_SERVICE_EVENT_MAX_REPLAY_EVENTS,
  AGENT_SERVICE_EVENT_RESYNC_REASONS,
  AGENT_SERVICE_EVENT_TYPES,
  AGENT_SERVICE_SNAPSHOT_MAX_MESSAGES,
  AGENT_SERVICE_SNAPSHOT_MAX_PENDING_INTERACTIONS,
  AgentServiceArtifactRefSchema,
  AgentServiceEventCursorSchema,
  AgentServiceEventEnvelopeSchema,
  AgentServiceEventStreamRecordSchema,
  AgentServiceEventSubscriptionRequestSchema,
  AgentServiceEventSubscriptionResponseSchema,
  AgentServiceSnapshotRequestSchema,
  AgentServiceSnapshotSchema
} from '@shared/contracts/agent-service/events'
import {
  AGENT_SERVICE_CANCELLATION_LAYERS,
  AGENT_SERVICE_INTERACTION_DECISIONS,
  AGENT_SERVICE_INTERACTION_KINDS,
  AGENT_SERVICE_INTERACTION_MAX_OPTIONS,
  AGENT_SERVICE_INTERACTION_RESOLUTIONS,
  AgentServiceCancellationReceiptSchema,
  AgentServiceCancellationRequestSchema,
  AgentServiceInteractionRequestSchema,
  AgentServiceInteractionResolutionSchema,
  AgentServiceInteractionResponseSchema,
  AgentServiceMessageIdSchema
} from '@shared/contracts/agent-service/interactions'
import { LocalControlEventCursorSchema } from '@shared/contracts/localControl'
import { JsonValueSchema } from '@shared/contracts/json'

// Fixed literals on purpose: these sets are the wire vocabulary, so a silent addition, removal, or
// rename must fail this suite instead of agreeing with whatever the module exports.
const EXPECTED_EVENT_TYPES = [
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

const EXPECTED_RESYNC_REASONS = [
  'cursor_expired',
  'cursor_ahead',
  'service_restarted',
  'buffer_overflow',
  'replay_limit_exceeded'
] as const

const EXPECTED_CANCELLATION_LAYERS = ['queued_submission', 'running_run', 'active_turn'] as const

const EXPECTED_INTERACTION_KINDS = ['permission', 'question'] as const

const EXPECTED_INTERACTION_DECISIONS = ['approved', 'denied'] as const

const EXPECTED_INTERACTION_RESOLUTIONS = ['accepted', 'expired'] as const

const serviceInstanceId = 'service-1'
const sessionId = 'session-1'
const cursorEpoch = 'epoch-1'

const cursorFor = (sequence: number): string => `${cursorEpoch}:${sequence}`

const eventEnvelope = (overrides: Record<string, unknown> = {}): unknown => ({
  serviceInstanceId,
  sessionId,
  eventId: 'event-1',
  type: 'run.status',
  cursor: cursorFor(3),
  sequence: 3,
  timestamp: 1_000,
  runId: 'run-1',
  requestId: null,
  messageId: null,
  toolCallId: null,
  data: { status: 'running' },
  ...overrides
})

const permissionInteraction = (
  overrides: Record<string, unknown> = {}
): Record<string, unknown> => ({
  interactionId: 'interaction-1',
  sessionId,
  runId: 'run-1',
  requestId: 'request-1',
  messageId: 'message-1',
  toolCallId: 'tool-call-1',
  expiresAt: 60_000,
  kind: 'permission',
  toolName: 'bash',
  summary: 'Run a command',
  ...overrides
})

const questionInteraction = (overrides: Record<string, unknown> = {}): Record<string, unknown> => ({
  interactionId: 'interaction-2',
  sessionId,
  runId: 'run-1',
  requestId: 'request-1',
  messageId: 'message-1',
  toolCallId: 'tool-call-2',
  expiresAt: 60_000,
  kind: 'question',
  prompt: 'Which environment?',
  options: [{ optionId: 'staging', label: 'Staging' }],
  ...overrides
})

const interactionResponse = (overrides: Record<string, unknown> = {}): unknown => ({
  interactionId: 'interaction-1',
  sessionId,
  messageId: 'message-1',
  toolCallId: 'tool-call-1',
  respondedAt: 2_000,
  kind: 'permission',
  decision: 'denied',
  ...overrides
})

const replay = (startSequence: number, count: number): unknown[] =>
  Array.from({ length: count }, (_unused, index) =>
    eventEnvelope({
      eventId: `event-${startSequence + index}`,
      sequence: startSequence + index,
      cursor: cursorFor(startSequence + index)
    })
  )

const streamingSubscription = (
  overrides: Record<string, unknown> = {}
): Record<string, unknown> => ({
  status: 'streaming',
  serviceInstanceId,
  sessionId,
  requestedCursor: cursorFor(0),
  initialCursor: cursorFor(0),
  acceptedMaxReplayEvents: 4,
  acceptedMaxBufferedEvents: 8,
  replayedEvents: [],
  ...overrides
})

const replayingSubscription = (
  startSequence: number,
  count: number,
  overrides: Record<string, unknown> = {}
): Record<string, unknown> =>
  streamingSubscription({
    requestedCursor: cursorFor(startSequence - 1),
    initialCursor: cursorFor(startSequence + count - 1),
    replayedEvents: replay(startSequence, count),
    ...overrides
  })

const resyncRequired = (overrides: Record<string, unknown> = {}): Record<string, unknown> => ({
  serviceInstanceId,
  sessionId,
  reason: 'cursor_expired',
  authoritativeCursor: cursorFor(12),
  ...overrides
})

const snapshot = (overrides: Record<string, unknown> = {}): unknown => ({
  serviceInstanceId,
  sessionId,
  capturedAt: 5_000,
  cursor: cursorFor(12),
  status: 'generating',
  activeRun: { runId: 'run-1', requestId: 'request-1' },
  queuedSubmissions: [{ submissionId: 'submission-2', receivedAt: 4_000 }],
  pendingInteractions: [permissionInteraction()],
  messages: [
    {
      messageId: 'message-1',
      role: 'assistant',
      status: 'pending',
      text: 'working',
      textTruncated: false,
      createdAt: 3_000,
      updatedAt: 3_500
    }
  ],
  messagesTruncated: true,
  artifacts: [
    {
      artifactId: 'artifact-1',
      kind: 'log',
      mediaType: 'text/plain',
      sizeBytes: 2_048,
      sha256: null,
      label: null,
      expiresAt: null
    }
  ],
  ...overrides
})

const cancellationRequest = (overrides: Record<string, unknown> = {}): unknown => ({
  serviceInstanceId,
  layer: 'running_run',
  sessionId,
  runId: 'run-1',
  ...overrides
})

const cancellationReceipt = (overrides: Record<string, unknown> = {}): unknown => ({
  serviceInstanceId,
  layer: 'running_run',
  sessionId,
  runId: 'run-1',
  outcome: 'cancelled',
  settledAt: 6_000,
  ...overrides
})

const accept = (schema: { safeParse: (value: unknown) => { success: boolean } }, value: unknown) =>
  schema.safeParse(value).success

const nestedData = (levels: number): unknown =>
  levels <= 1 ? 'leaf' : { child: nestedData(levels - 1) }

// `accept` turns a thrown parse error into a test failure without saying which one, so the fail-closed
// cases use this instead: it returns why the value was not rejected — "accepted" or the thrown error
// — and `null` only when `safeParse` returned a rejection.
const rejectionFailure = (
  schema: { safeParse: (value: unknown) => { success: boolean } },
  value: unknown
): string | null => {
  try {
    return schema.safeParse(value).success ? 'accepted' : null
  } catch (error) {
    return `threw ${error instanceof Error ? `${error.name}: ${error.message}` : String(error)}`
  }
}

describe('agent service event contract', () => {
  it('reuses the local-control epoch:sequence cursor instead of defining another one', () => {
    expect(AgentServiceEventCursorSchema).toBe(LocalControlEventCursorSchema)

    expect(accept(AgentServiceEventEnvelopeSchema, eventEnvelope())).toBe(true)
    // A bare sequence would be a second cursor vocabulary, so it is rejected even though it is a
    // plain non-empty string.
    for (const cursor of [
      '3',
      cursorEpoch,
      `${cursorEpoch}:`,
      `${cursorEpoch}:01`,
      `${cursorEpoch}:-1`
    ]) {
      expect(
        accept(AgentServiceEventEnvelopeSchema, eventEnvelope({ cursor, sequence: 3 })),
        cursor
      ).toBe(false)
    }
  })

  it('pins the client-visible event, resync, interaction, and cancellation vocabularies', () => {
    expect(AGENT_SERVICE_EVENT_TYPES).toEqual(EXPECTED_EVENT_TYPES)
    expect(AGENT_SERVICE_EVENT_RESYNC_REASONS).toEqual(EXPECTED_RESYNC_REASONS)
    expect(AGENT_SERVICE_CANCELLATION_LAYERS).toEqual(EXPECTED_CANCELLATION_LAYERS)
    expect(AGENT_SERVICE_INTERACTION_KINDS).toEqual(EXPECTED_INTERACTION_KINDS)
    expect(AGENT_SERVICE_INTERACTION_DECISIONS).toEqual(EXPECTED_INTERACTION_DECISIONS)
    expect(AGENT_SERVICE_INTERACTION_RESOLUTIONS).toEqual(EXPECTED_INTERACTION_RESOLUTIONS)
    expect(AGENT_SERVICE_ARTIFACT_KINDS).toEqual(['file', 'image', 'log', 'transcript', 'export'])
  })

  it('accepts a typed event envelope and rejects unknown fields, types, and cursor mismatches', () => {
    expect(accept(AgentServiceEventEnvelopeSchema, eventEnvelope())).toBe(true)

    const invalid: Array<[string, Record<string, unknown>]> = [
      ['unknown event type', { type: 'message.telepathy' }],
      ['cursor that does not match the sequence', { sequence: 4 }],
      ['missing cursor', { cursor: undefined }],
      ['missing sequence', { sequence: undefined }],
      ['missing timestamp', { timestamp: undefined }],
      ['missing event id', { eventId: undefined }],
      ['submission id smuggled into the envelope', { submissionId: 'submission-1' }],
      ['absolute service path', { absolutePath: '/tmp/deepchat/session.db' }],
      ['runtime handle', { abortSignal: {}, callback: () => undefined }],
      ['negative sequence', { sequence: -1, cursor: cursorFor(0) }]
    ]

    for (const [label, overrides] of invalid) {
      expect(accept(AgentServiceEventEnvelopeSchema, eventEnvelope(overrides)), label).toBe(false)
    }
  })

  it('bounds event data by depth, encoded size, and artifact count', () => {
    expect(
      accept(
        AgentServiceEventEnvelopeSchema,
        eventEnvelope({ data: nestedData(AGENT_SERVICE_EVENT_DATA_MAX_DEPTH) })
      )
    ).toBe(true)
    expect(
      accept(
        AgentServiceEventEnvelopeSchema,
        eventEnvelope({ data: nestedData(AGENT_SERVICE_EVENT_DATA_MAX_DEPTH + 1) })
      )
    ).toBe(false)
    expect(
      accept(
        AgentServiceEventEnvelopeSchema,
        eventEnvelope({ data: { text: 'x'.repeat(AGENT_SERVICE_EVENT_DATA_MAX_BYTES + 1) } })
      )
    ).toBe(false)

    const artifact = {
      artifactId: 'artifact-1',
      kind: 'file',
      mediaType: 'text/plain',
      sizeBytes: 12,
      sha256: null,
      label: 'patch.diff',
      expiresAt: 9_000
    }
    expect(
      accept(
        AgentServiceEventEnvelopeSchema,
        eventEnvelope({
          artifacts: Array.from({ length: AGENT_SERVICE_EVENT_MAX_ARTIFACTS }, () => artifact)
        })
      )
    ).toBe(true)
    expect(
      accept(
        AgentServiceEventEnvelopeSchema,
        eventEnvelope({
          artifacts: Array.from({ length: AGENT_SERVICE_EVENT_MAX_ARTIFACTS + 1 }, () => artifact)
        })
      )
    ).toBe(false)
  })

  it('refuses event data that is not plain JSON without throwing', () => {
    // The reader must refuse an accessor without calling it, so the getter counts its own reads.
    let accessorReads = 0
    const accessor: Record<string, unknown> = {}
    Object.defineProperty(accessor, 'value', {
      get: () => {
        accessorReads += 1
        return 'x'
      },
      enumerable: true
    })

    const sparse: unknown[] = []
    sparse[2] = 'x'

    const nonIndex = ['x'] as unknown[] & { extra?: string }
    nonIndex.extra = 'y'

    class SessionState {
      readonly status = 'running'
    }

    const symbolKeyed: Record<string | symbol, unknown> = { ok: true }
    symbolKeyed[Symbol('tag')] = 'x'

    const cyclic: Record<string, unknown> = {}
    cyclic.self = cyclic

    const throwingProxy = new Proxy(
      {},
      {
        get: () => {
          throw new Error('unreadable')
        },
        getOwnPropertyDescriptor: () => {
          throw new Error('unreadable')
        },
        ownKeys: () => {
          throw new Error('unreadable')
        }
      }
    )

    const notPlainJson: Array<[string, unknown]> = [
      ['accessor property', accessor],
      ['array hole', sparse],
      ['array with a non-index property', nonIndex],
      ['class instance', new SessionState()],
      ['date', new Date(0)],
      ['map', new Map([['a', 1]])],
      ['enumerable symbol key', symbolKeyed],
      ['undefined', undefined],
      ['function', () => undefined],
      ['symbol', Symbol('event')],
      ['bigint', BigInt(1)],
      ['NaN', Number.NaN],
      ['Infinity', Number.POSITIVE_INFINITY],
      ['cycle', cyclic],
      ['proxy whose own reads throw', throwingProxy],
      ['undefined nested in an array', ['x', undefined]],
      ['undefined-valued key that JSON.stringify would drop', { text: undefined }],
      ['date nested in an object', { at: new Date(0) }],
      ['accessor nested in an array', [accessor]]
    ]

    for (const [label, data] of notPlainJson) {
      expect(
        rejectionFailure(AgentServiceEventEnvelopeSchema, eventEnvelope({ data })),
        label
      ).toBeNull()
    }

    // A refused accessor is refused, not read: the check is the descriptor, never the getter.
    expect(accessorReads).toBe(0)
  })

  it('rejects JSON-parsed event data that is deeper than the depth budget without throwing', () => {
    // A recursive JSON schema answers a payload this deep with `RangeError` instead of issues, so
    // these are the shapes that prove the read is bounded before the recursive schema sees anything.
    const deepObject = JSON.parse(`${'{"a":'.repeat(4_000)}1${'}'.repeat(4_000)}`) as unknown
    const deeperObject = JSON.parse(`${'{"a":'.repeat(40_000)}1${'}'.repeat(40_000)}`) as unknown
    const deepArray = JSON.parse(`${'['.repeat(4_000)}1${']'.repeat(4_000)}`) as unknown
    const deeperArray = JSON.parse(`${'['.repeat(40_000)}1${']'.repeat(40_000)}`) as unknown

    for (const [label, data] of [
      ['deep object', deepObject],
      ['deeper object', deeperObject],
      ['deep array', deepArray],
      ['deeper array', deeperArray],
      ['deep array nested in an accepted field', { payload: deepArray }]
    ] as Array<[string, unknown]>) {
      expect(
        rejectionFailure(AgentServiceEventEnvelopeSchema, eventEnvelope({ data })),
        label
      ).toBeNull()
    }
  })

  it('accepts plain event data as a bounded plain JSON copy', () => {
    const data = {
      status: 'running',
      nested: { items: [1, 'x', null, true], empty: {} },
      empty: [],
      flag: false,
      count: 0,
      maybe: null
    }

    const parsed = AgentServiceEventEnvelopeSchema.parse(eventEnvelope({ data }))
    expect(parsed.data).toEqual(data)
    // The accepted value has no hidden members: nothing the input carries is dropped, reordered, or
    // added on the way through, and it survives a JSON round-trip unchanged.
    expect(JSON.stringify(parsed.data)).toBe(JSON.stringify(data))
    expect(JSON.parse(JSON.stringify(parsed.data))).toEqual(parsed.data)

    expect(
      accept(
        AgentServiceEventEnvelopeSchema,
        eventEnvelope({ data: nestedData(AGENT_SERVICE_EVENT_DATA_MAX_DEPTH) })
      )
    ).toBe(true)
    expect(
      rejectionFailure(
        AgentServiceEventEnvelopeSchema,
        eventEnvelope({ data: nestedData(AGENT_SERVICE_EVENT_DATA_MAX_DEPTH + 1) })
      )
    ).toBeNull()

    // A prototype-less object is plain data: it carries no inherited member and no class identity.
    const nullPrototype = Object.assign(Object.create(null) as Record<string, unknown>, {
      status: 'running'
    })
    expect(accept(AgentServiceEventEnvelopeSchema, eventEnvelope({ data: nullPrototype }))).toBe(
      true
    )
  })

  it('refuses a container that cannot fit the remaining node budget before expanding it', () => {
    // The verdict has to come from the container's width, not from the expansion: five million
    // elements are more nodes than the byte budget can ever hold, so expanding first would let the
    // input decide how much this read materializes. Counting own-key and descriptor reads is the
    // observable form of that: an expansion would read every element, a width-based refusal reads
    // none of them.
    const width = 5_000_000
    const wide = new Array<number>(width).fill(0)
    let elementReads = 0
    const counted = new Proxy(wide, {
      ownKeys: (target) => {
        elementReads += 1
        return Reflect.ownKeys(target)
      },
      getOwnPropertyDescriptor: (target, key) => {
        elementReads += 1
        return Reflect.getOwnPropertyDescriptor(target, key)
      }
    })

    for (const [label, data] of [
      ['wide array', wide],
      ['wide array behind a proxy', counted]
    ] as Array<[string, unknown]>) {
      expect(
        rejectionFailure(AgentServiceEventEnvelopeSchema, eventEnvelope({ data })),
        label
      ).toBeNull()
    }
    expect(elementReads).toBe(0)

    // The budget is what is left after the nodes already counted, so a width that fits it at the root
    // can be too wide once a parent is counted too: `MAX_BYTES - 1` keys fit on their own, and nested
    // one level down they do not. The children must not have been read to reach that verdict.
    let childVisits = 0
    const countedChild = new Proxy(
      { leaf: true },
      {
        getPrototypeOf: (target) => {
          childVisits += 1
          return Reflect.getPrototypeOf(target)
        }
      }
    )
    const wideNested = Object.fromEntries(
      Array.from({ length: AGENT_SERVICE_EVENT_DATA_MAX_BYTES - 1 }, (_unused, index) => [
        `key-${index}`,
        countedChild
      ])
    )
    expect(
      rejectionFailure(
        AgentServiceEventEnvelopeSchema,
        eventEnvelope({ data: { payload: wideNested } })
      )
    ).toBeNull()
    expect(childVisits).toBe(0)

    // The bound is a work bound, not a second acceptance rule: a payload that fits the byte budget is
    // accepted even when it is wide, and a shared subtree (a DAG, not a cycle) is accepted once per
    // reference, exactly as it is counted.
    const shared = { a: 1 }
    expect(
      accept(
        AgentServiceEventEnvelopeSchema,
        eventEnvelope({ data: Array.from({ length: 100_000 }, () => 0) })
      )
    ).toBe(true)
    expect(accept(AgentServiceEventEnvelopeSchema, eventEnvelope({ data: [shared, shared] }))).toBe(
      true
    )
  })

  it('refuses a `__proto__` key rather than returning a DTO without it', () => {
    // `JSON.parse` makes `__proto__` an own property, and the copy this read builds can hold it — but
    // the record stage the copy is piped into writes keys by assignment, where `__proto__` is the one
    // key that sets a prototype instead of creating an own property. Accepting it would mean the
    // value a client receives is not the value that was measured, so it is refused at any depth.
    const ownedProto: Record<string, unknown> = {}
    Object.defineProperty(ownedProto, '__proto__', { value: 1, enumerable: true })
    const reread = JsonValueSchema.safeParse(ownedProto)
    expect(reread.success).toBe(true)
    if (reread.success) {
      expect(Object.keys(reread.data as Record<string, unknown>)).toEqual([])
    }

    for (const [label, data] of [
      ['JSON-parsed top level key', JSON.parse('{"__proto__": 1, "status": "running"}')],
      ['JSON-parsed nested key', JSON.parse('{"nested": {"__proto__": {"x": 1}}}')],
      ['top level key in an array element', [JSON.parse('{"__proto__": {"x": 1}}')]],
      ['computed-key literal', { ['__proto__']: 1, status: 'running' }]
    ] as Array<[string, unknown]>) {
      expect(
        rejectionFailure(AgentServiceEventEnvelopeSchema, eventEnvelope({ data })),
        label
      ).toBeNull()
    }

    // The key is refused, not the shape: the same payload without it is accepted.
    expect(
      accept(
        AgentServiceEventEnvelopeSchema,
        eventEnvelope({ data: JSON.parse('{"status": "running"}') })
      )
    ).toBe(true)
  })

  it('refuses `-0`, the one finite number JSON does not preserve', () => {
    // `JSON.stringify(-0)` is `'0'`, so a copy holding `-0` would not be the value a client reads back
    // from the encoded payload. Numbers are otherwise unchanged: every other finite double encodes to
    // itself.
    const negativeZero = JSON.parse('-0') as unknown
    expect(Object.is(negativeZero, -0)).toBe(true)

    for (const [label, data] of [
      ['top level', negativeZero],
      ['object member', { delta: -0 }],
      ['array element', [0, -0]],
      ['nested member', { usage: { delta: JSON.parse('-0') } }]
    ] as Array<[string, unknown]>) {
      expect(
        rejectionFailure(AgentServiceEventEnvelopeSchema, eventEnvelope({ data })),
        label
      ).toBeNull()
    }

    for (const [label, data] of [
      ['zero', { delta: 0 }],
      ['negative integer', { delta: -1 }],
      ['fraction', { delta: 0.5 }],
      ['small exponent', { delta: 1e-7 }],
      ['largest finite double', { delta: Number.MAX_VALUE }],
      ['token count', { tokenCount: 12 }]
    ] as Array<[string, unknown]>) {
      expect(accept(AgentServiceEventEnvelopeSchema, eventEnvelope({ data })), label).toBe(true)
    }
  })

  it('keeps artifact references owned identifiers without a service path', () => {
    const artifact = {
      artifactId: 'artifact-1',
      kind: 'file',
      mediaType: 'text/plain',
      sizeBytes: 12,
      sha256: null,
      label: null,
      expiresAt: null
    }
    expect(accept(AgentServiceArtifactRefSchema, artifact)).toBe(true)

    for (const [label, override] of [
      ['absolute path', { path: '/tmp/deepchat/out.log' }],
      ['absolute path field', { absolutePath: '/tmp/deepchat/out.log' }],
      ['provider handle', { handle: 'file://x' }],
      ['url locator', { url: 'file:///tmp/deepchat/out.log' }]
    ] as Array<[string, Record<string, unknown>]>) {
      expect(accept(AgentServiceArtifactRefSchema, { ...artifact, ...override }), label).toBe(false)
    }

    expect(accept(AgentServiceArtifactRefSchema, { ...artifact, artifactId: undefined })).toBe(
      false
    )
    expect(accept(AgentServiceArtifactRefSchema, { ...artifact, expiresAt: undefined })).toBe(false)
  })

  it('ties the typed interaction payload to interaction.requested', () => {
    const requested = eventEnvelope({
      type: 'interaction.requested',
      messageId: 'message-1',
      toolCallId: 'tool-call-1',
      interaction: permissionInteraction()
    })
    expect(accept(AgentServiceEventEnvelopeSchema, requested)).toBe(true)

    const withoutPayload = eventEnvelope({ type: 'interaction.requested' })
    expect(accept(AgentServiceEventEnvelopeSchema, withoutPayload)).toBe(false)

    const payloadOnOtherType = eventEnvelope({ interaction: permissionInteraction() })
    expect(accept(AgentServiceEventEnvelopeSchema, payloadOnOtherType)).toBe(false)

    for (const [label, override] of [
      ['message id', { messageId: 'message-2' }],
      ['tool call id', { toolCallId: 'tool-call-9' }],
      ['session id', { sessionId: 'other-session' }]
    ] as Array<[string, Record<string, unknown>]>) {
      expect(
        accept(
          AgentServiceEventEnvelopeSchema,
          eventEnvelope({
            type: 'interaction.requested',
            messageId: 'message-1',
            toolCallId: 'tool-call-1',
            interaction: permissionInteraction(),
            ...override
          })
        ),
        label
      ).toBe(false)
    }
  })

  it('requires an explicit cursor and bounded replay and buffer budgets to subscribe', () => {
    const request = {
      serviceInstanceId,
      sessionId,
      cursor: null,
      maxReplayEvents: 16,
      maxBufferedEvents: 32
    }

    expect(accept(AgentServiceEventSubscriptionRequestSchema, request)).toBe(true)
    expect(
      accept(AgentServiceEventSubscriptionRequestSchema, { ...request, cursor: cursorFor(7) })
    ).toBe(true)
    expect(
      accept(AgentServiceEventSubscriptionRequestSchema, {
        ...request,
        maxReplayEvents: AGENT_SERVICE_EVENT_MAX_REPLAY_EVENTS,
        maxBufferedEvents: AGENT_SERVICE_EVENT_MAX_BUFFERED_EVENTS
      })
    ).toBe(true)

    const invalid: Array<[string, Record<string, unknown>]> = [
      ['omitted cursor', { cursor: undefined }],
      ['empty cursor', { cursor: '' }],
      ['bare sequence cursor', { cursor: '17' }],
      ['zero replay budget', { maxReplayEvents: 0 }],
      ['unbounded replay budget', { maxReplayEvents: AGENT_SERVICE_EVENT_MAX_REPLAY_EVENTS + 1 }],
      ['omitted replay budget', { maxReplayEvents: undefined }],
      ['zero buffer budget', { maxBufferedEvents: 0 }],
      [
        'unbounded buffer budget',
        { maxBufferedEvents: AGENT_SERVICE_EVENT_MAX_BUFFERED_EVENTS + 1 }
      ],
      ['omitted buffer budget', { maxBufferedEvents: undefined }],
      ['unknown field', { overflowPolicy: 'drop_oldest' }]
    ]

    for (const [label, override] of invalid) {
      expect(
        accept(AgentServiceEventSubscriptionRequestSchema, { ...request, ...override }),
        label
      ).toBe(false)
    }
  })

  it('verifies a replay is contiguous, in-epoch, budgeted, and ends at initialCursor', () => {
    expect(accept(AgentServiceEventSubscriptionResponseSchema, streamingSubscription())).toBe(true)
    expect(accept(AgentServiceEventSubscriptionResponseSchema, replayingSubscription(1, 3))).toBe(
      true
    )

    const gapped = replay(1, 3)
    gapped[1] = eventEnvelope({ eventId: 'event-9', sequence: 9, cursor: cursorFor(9) })
    expect(
      accept(
        AgentServiceEventSubscriptionResponseSchema,
        replayingSubscription(1, 3, { replayedEvents: gapped })
      )
    ).toBe(false)

    const otherEpoch = replay(1, 2)
    otherEpoch[1] = eventEnvelope({ cursor: `epoch-2:2`, sequence: 2 })
    expect(
      accept(
        AgentServiceEventSubscriptionResponseSchema,
        replayingSubscription(1, 2, { replayedEvents: otherEpoch })
      )
    ).toBe(false)

    // Every replayed event must stay in the requested epoch, not only the first. Below the sequences
    // are contiguous, the replayed events belong to the subscribed session and instance, and the last
    // cursor equals `initialCursor` — an epoch switch in the middle would otherwise pass as one
    // gap-free catch-up, splicing two orderings that share a sequence number.
    const midEpochSwitch = replay(1, 3)
    midEpochSwitch[1] = eventEnvelope({ eventId: 'event-2', cursor: `epoch-2:2`, sequence: 2 })
    expect(
      accept(
        AgentServiceEventSubscriptionResponseSchema,
        replayingSubscription(1, 3, { replayedEvents: midEpochSwitch })
      )
    ).toBe(false)

    // The same switch, with `initialCursor` moved into the switched epoch so that it matches the last
    // replayed cursor, is still refused: a matching end position does not make the middle event's
    // epoch the requested one.
    expect(
      accept(
        AgentServiceEventSubscriptionResponseSchema,
        replayingSubscription(1, 3, {
          replayedEvents: midEpochSwitch,
          initialCursor: `epoch-2:3`
        })
      )
    ).toBe(false)

    // A replay where every event is in the other epoch is refused as well, wherever `initialCursor`
    // sits.
    const allOtherEpoch = replay(1, 2).map((_unused, index) =>
      eventEnvelope({
        eventId: `event-${index + 1}`,
        cursor: `epoch-2:${index + 1}`,
        sequence: index + 1
      })
    )
    expect(
      accept(
        AgentServiceEventSubscriptionResponseSchema,
        replayingSubscription(1, 2, {
          replayedEvents: allOtherEpoch,
          initialCursor: `epoch-2:2`
        })
      )
    ).toBe(false)

    expect(
      accept(
        AgentServiceEventSubscriptionResponseSchema,
        replayingSubscription(1, 3, { acceptedMaxReplayEvents: 2 })
      )
    ).toBe(false)

    expect(
      accept(
        AgentServiceEventSubscriptionResponseSchema,
        streamingSubscription({ replayedEvents: replay(1, 1) })
      )
    ).toBe(false)

    expect(
      accept(
        AgentServiceEventSubscriptionResponseSchema,
        replayingSubscription(1, 3, { initialCursor: cursorFor(4) })
      )
    ).toBe(false)

    const foreignSession = replay(1, 2)
    foreignSession[1] = eventEnvelope({
      sessionId: 'other-session',
      sequence: 2,
      cursor: cursorFor(2)
    })
    expect(
      accept(
        AgentServiceEventSubscriptionResponseSchema,
        replayingSubscription(1, 2, { replayedEvents: foreignSession })
      )
    ).toBe(false)

    // A replay that starts later than the requested cursor is a silent gap.
    expect(
      accept(
        AgentServiceEventSubscriptionResponseSchema,
        replayingSubscription(2, 2, { requestedCursor: cursorFor(0) })
      )
    ).toBe(false)
  })

  it('expresses cursor expiry and overflow only through explicit resync', () => {
    const resyncResponse = (overrides: Record<string, unknown> = {}): Record<string, unknown> => ({
      status: 'resync_required',
      ...resyncRequired(overrides)
    })

    expect(accept(AgentServiceEventSubscriptionResponseSchema, resyncResponse())).toBe(true)
    expect(
      accept(
        AgentServiceEventSubscriptionResponseSchema,
        resyncResponse({ reason: 'buffer_overflow' })
      )
    ).toBe(true)
    expect(
      accept(
        AgentServiceEventSubscriptionResponseSchema,
        resyncResponse({ reason: 'replay_limit_exceeded' })
      )
    ).toBe(true)

    for (const [label, override] of [
      ['unknown reason', { reason: 'probably_fine' }],
      ['missing reason', { reason: undefined }],
      ['missing authoritative cursor', { authoritativeCursor: undefined }],
      ['bare sequence cursor', { authoritativeCursor: '12' }],
      ['mixed with a replay', { replayedEvents: [] }],
      ['unexpected status', { status: 'streaming' }]
    ] as Array<[string, Record<string, unknown>]>) {
      expect(
        accept(AgentServiceEventSubscriptionResponseSchema, resyncResponse(override)),
        label
      ).toBe(false)
    }

    expect(
      accept(AgentServiceEventStreamRecordSchema, { kind: 'event', event: eventEnvelope() })
    ).toBe(true)
    expect(
      accept(AgentServiceEventStreamRecordSchema, {
        kind: 'resync_required',
        ...resyncRequired()
      })
    ).toBe(true)

    for (const [label, record] of [
      ['missing kind', { event: eventEnvelope() }],
      ['unknown kind', { kind: 'gap', event: eventEnvelope() }],
      ['dropped-event record', { kind: 'dropped', count: 3 }],
      [
        'resync without a reason',
        { kind: 'resync_required', ...resyncRequired({ reason: undefined }) }
      ],
      ['event record with extra field', { kind: 'event', event: eventEnvelope(), sequence: 3 }]
    ] as Array<[string, Record<string, unknown>]>) {
      expect(accept(AgentServiceEventStreamRecordSchema, record), label).toBe(false)
    }
  })

  it('carries an authoritative bounded snapshot without runtime objects', () => {
    expect(accept(AgentServiceSnapshotRequestSchema, { serviceInstanceId, sessionId })).toBe(true)
    expect(
      accept(AgentServiceSnapshotRequestSchema, { serviceInstanceId, sessionId, runId: 'run-1' })
    ).toBe(false)

    expect(accept(AgentServiceSnapshotSchema, snapshot())).toBe(true)
    expect(accept(AgentServiceSnapshotSchema, snapshot({ activeRun: null }))).toBe(true)

    const invalid: Array<[string, Record<string, unknown>]> = [
      ['absolute path', { absolutePath: '/tmp/deepchat/session.db' }],
      ['database handle', { sessionDatabase: { close: () => undefined } }],
      ['abort signal', { abortSignal: new AbortController().signal }],
      ['missing truncation flag', { messagesTruncated: undefined }],
      ['bare sequence cursor', { cursor: '12' }],
      ['unknown session status', { status: 'compacting' }],
      ['interaction ids without requests', { pendingInteractions: ['interaction-1'] }],
      ['interaction id only', { pendingInteractions: [{ interactionId: 'interaction-1' }] }]
    ]

    for (const [label, override] of invalid) {
      expect(accept(AgentServiceSnapshotSchema, snapshot(override)), label).toBe(false)
    }

    // The authoritative snapshot belongs to one session, so an interaction that is pending in another
    // session is not pending here: answering it would resolve something this snapshot never published.
    expect(
      accept(
        AgentServiceSnapshotSchema,
        snapshot({
          pendingInteractions: [permissionInteraction({ sessionId: 'other-session' })]
        })
      )
    ).toBe(false)
    expect(
      accept(
        AgentServiceSnapshotSchema,
        snapshot({ pendingInteractions: [questionInteraction({ sessionId: 'other-session' })] })
      )
    ).toBe(false)
    // One interaction from another session is enough to reject the snapshot, even next to valid ones.
    expect(
      accept(
        AgentServiceSnapshotSchema,
        snapshot({
          pendingInteractions: [permissionInteraction(), questionInteraction({ sessionId: 'x' })]
        })
      )
    ).toBe(false)
    expect(
      accept(
        AgentServiceSnapshotSchema,
        snapshot({ pendingInteractions: [permissionInteraction(), questionInteraction()] })
      )
    ).toBe(true)

    expect(
      accept(
        AgentServiceSnapshotSchema,
        snapshot({
          pendingInteractions: Array.from(
            { length: AGENT_SERVICE_SNAPSHOT_MAX_PENDING_INTERACTIONS + 1 },
            () => permissionInteraction()
          )
        })
      )
    ).toBe(false)

    expect(
      accept(
        AgentServiceSnapshotSchema,
        snapshot({
          messages: Array.from({ length: AGENT_SERVICE_SNAPSHOT_MAX_MESSAGES + 1 }, () => ({
            messageId: 'message-1',
            role: 'user',
            status: 'sent',
            text: 'hi',
            textTruncated: false,
            createdAt: 1,
            updatedAt: 1
          }))
        })
      )
    ).toBe(false)
  })

  it('keeps cancellation layered instead of one cancel(id)', () => {
    const layers: unknown[] = [
      { serviceInstanceId, layer: 'queued_submission', sessionId, submissionId: 'submission-1' },
      { serviceInstanceId, layer: 'running_run', sessionId, runId: 'run-1' },
      { serviceInstanceId, layer: 'active_turn', sessionId, runId: 'run-1', requestId: 'request-1' }
    ]

    for (const layer of layers) {
      expect(accept(AgentServiceCancellationRequestSchema, layer)).toBe(true)
    }

    const invalid: Array<[string, unknown]> = [
      ['no layer', { serviceInstanceId, sessionId, runId: 'run-1' }],
      ['unknown layer', { serviceInstanceId, layer: 'everything', sessionId }],
      ['opaque single id', { serviceInstanceId, layer: 'running_run', sessionId, id: 'run-1' }],
      ['missing layer target', { serviceInstanceId, layer: 'running_run', sessionId }],
      [
        'submission cancel carrying a run id',
        {
          serviceInstanceId,
          layer: 'queued_submission',
          sessionId,
          submissionId: 'submission-1',
          runId: 'run-1'
        }
      ],
      [
        'run cancel carrying a request id',
        {
          serviceInstanceId,
          layer: 'running_run',
          sessionId,
          runId: 'run-1',
          requestId: 'request-1'
        }
      ],
      [
        'turn stop without a request id',
        { serviceInstanceId, layer: 'active_turn', sessionId, runId: 'run-1' }
      ],
      ['missing session id', { serviceInstanceId, layer: 'running_run', runId: 'run-1' }]
    ]

    for (const [label, value] of invalid) {
      expect(accept(AgentServiceCancellationRequestSchema, value), label).toBe(false)
    }

    expect(accept(AgentServiceCancellationReceiptSchema, cancellationReceipt())).toBe(true)
    expect(
      accept(
        AgentServiceCancellationReceiptSchema,
        cancellationReceipt({ layer: 'active_turn', requestId: 'request-1' })
      )
    ).toBe(true)

    for (const [label, override] of [
      ['unknown outcome', { outcome: 'maybe' }],
      ['missing outcome', { outcome: undefined }],
      ['missing settled timestamp', { settledAt: undefined }],
      ['receipt that does not name its target', { runId: undefined }],
      ['receipt for another layer', { layer: 'queued_submission', submissionId: 'submission-1' }]
    ] as Array<[string, Record<string, unknown>]>) {
      expect(
        accept(AgentServiceCancellationReceiptSchema, cancellationReceipt(override)),
        label
      ).toBe(false)
    }
  })

  it('requires an explicit, bound decision and cannot express self-approval', () => {
    expect(accept(AgentServiceInteractionRequestSchema, permissionInteraction())).toBe(true)
    expect(accept(AgentServiceInteractionRequestSchema, questionInteraction())).toBe(true)

    for (const [label, override] of [
      ['unknown kind', { kind: 'consent' }],
      ['missing message id', { messageId: undefined }],
      ['missing tool call id', { toolCallId: undefined }],
      ['missing run id', { runId: undefined }],
      ['missing request id', { requestId: undefined }],
      ['missing expiry', { expiresAt: undefined }],
      ['question without options', { kind: 'question', options: [] }],
      [
        'duplicate question options',
        {
          kind: 'question',
          options: [
            { optionId: 'staging', label: 'Staging' },
            { optionId: 'staging', label: 'Staging again' }
          ]
        }
      ],
      [
        'more options than the contract allows',
        {
          kind: 'question',
          options: Array.from(
            { length: AGENT_SERVICE_INTERACTION_MAX_OPTIONS + 1 },
            (_unused, index) => ({
              optionId: `option-${index}`,
              label: `Option ${index}`
            })
          )
        }
      ],
      [
        'over-long prompt',
        { kind: 'question', prompt: 'x'.repeat(4_097), options: [{ optionId: 'a', label: 'A' }] }
      ]
    ] as Array<[string, Record<string, unknown>]>) {
      const base = override.kind === 'question' ? questionInteraction() : permissionInteraction()
      expect(accept(AgentServiceInteractionRequestSchema, { ...base, ...override }), label).toBe(
        false
      )
    }

    expect(accept(AgentServiceInteractionResponseSchema, interactionResponse())).toBe(true)
    expect(
      accept(AgentServiceInteractionResponseSchema, interactionResponse({ decision: 'approved' }))
    ).toBe(true)
    expect(
      accept(AgentServiceInteractionResponseSchema, {
        interactionId: 'interaction-2',
        sessionId,
        messageId: 'message-1',
        toolCallId: 'tool-call-2',
        respondedAt: 2_000,
        kind: 'question_option',
        optionId: 'staging'
      })
    ).toBe(true)
    expect(
      accept(AgentServiceInteractionResponseSchema, {
        interactionId: 'interaction-2',
        sessionId,
        messageId: 'message-1',
        toolCallId: 'tool-call-2',
        respondedAt: 2_000,
        kind: 'question_text',
        text: 'staging'
      })
    ).toBe(true)

    const invalid: Array<[string, Record<string, unknown>]> = [
      ['missing decision', { decision: undefined }],
      ['unknown decision', { decision: 'maybe' }],
      ['boolean granted instead of a decision', { decision: undefined, granted: true }],
      ['missing interaction id', { interactionId: undefined }],
      ['missing expected message id', { messageId: undefined }],
      ['missing tool call id', { toolCallId: undefined }],
      ['missing responded timestamp', { respondedAt: undefined }],
      ['claimed principal', { principal: 'human' }],
      ['claimed approver', { approver: 'cli' }],
      ['claimed renderer identity', { renderer: 'deepchat-desktop' }],
      ['self approval flag', { selfApproved: true }],
      ['automatic approval flag', { autoApprove: true }],
      ['broadened scope', { scope: 'always' }],
      ['apply to every call', { applyToAll: true }],
      ['remembered decision', { rememberForSession: true }],
      ['question answer without a choice', { kind: 'question_option' }],
      ['permission answer carrying an option', { optionId: 'staging' }]
    ]

    for (const [label, override] of invalid) {
      expect(
        accept(AgentServiceInteractionResponseSchema, interactionResponse(override)),
        label
      ).toBe(false)
    }

    expect(
      accept(AgentServiceInteractionResolutionSchema, {
        interactionId: 'interaction-1',
        sessionId,
        resolution: 'accepted',
        resumed: true,
        resolvedAt: 7_000
      })
    ).toBe(true)

    for (const [label, override] of [
      ['unknown resolution', { resolution: 'mismatched' }],
      ['missing resumed flag', { resumed: undefined }],
      ['missing resolved timestamp', { resolvedAt: undefined }],
      ['resolution without an interaction id', { interactionId: undefined }],
      // `expired` records a response that was not applied, so it cannot be the resolution that
      // resumed the run.
      ['expired resolution that claims to resume the run', { resolution: 'expired', resumed: true }]
    ] as Array<[string, Record<string, unknown>]>) {
      expect(
        accept(AgentServiceInteractionResolutionSchema, {
          interactionId: 'interaction-1',
          sessionId,
          resolution: 'accepted',
          resumed: true,
          resolvedAt: 7_000,
          ...override
        }),
        label
      ).toBe(false)
    }

    // An accepted answer that settled without resuming the run is a real state, and so is an expiry
    // that resumed nothing; only the combination of the two claims is refused.
    for (const resolution of [
      { resolution: 'accepted', resumed: false },
      { resolution: 'expired', resumed: false }
    ]) {
      expect(
        accept(AgentServiceInteractionResolutionSchema, {
          interactionId: 'interaction-1',
          sessionId,
          resolvedAt: 7_000,
          ...resolution
        })
      ).toBe(true)
    }
  })

  it('keeps every Stage 1B DTO cloneable and JSON round-trippable', () => {
    const parsed = [
      AgentServiceEventEnvelopeSchema.parse(
        eventEnvelope({
          type: 'interaction.requested',
          messageId: 'message-1',
          toolCallId: 'tool-call-1',
          interaction: permissionInteraction(),
          artifacts: [
            {
              artifactId: 'artifact-1',
              kind: 'file',
              mediaType: 'text/plain',
              sizeBytes: 12,
              sha256: null,
              label: null,
              expiresAt: 9_000
            }
          ]
        })
      ),
      AgentServiceEventSubscriptionRequestSchema.parse({
        serviceInstanceId,
        sessionId,
        cursor: cursorFor(4),
        maxReplayEvents: 8,
        maxBufferedEvents: 16
      }),
      AgentServiceEventSubscriptionResponseSchema.parse(replayingSubscription(1, 2)),
      AgentServiceEventSubscriptionResponseSchema.parse({
        status: 'resync_required',
        ...resyncRequired({ reason: 'buffer_overflow' })
      }),
      AgentServiceEventStreamRecordSchema.parse({ kind: 'event', event: eventEnvelope() }),
      AgentServiceEventStreamRecordSchema.parse({
        kind: 'resync_required',
        ...resyncRequired()
      }),
      AgentServiceSnapshotRequestSchema.parse({ serviceInstanceId, sessionId }),
      AgentServiceSnapshotSchema.parse(snapshot()),
      AgentServiceInteractionRequestSchema.parse(permissionInteraction()),
      AgentServiceInteractionRequestSchema.parse(questionInteraction()),
      AgentServiceInteractionResponseSchema.parse(interactionResponse({ decision: 'approved' })),
      AgentServiceInteractionResolutionSchema.parse({
        interactionId: 'interaction-1',
        sessionId,
        resolution: 'expired',
        resumed: false,
        resolvedAt: 7_000
      }),
      AgentServiceCancellationRequestSchema.parse(cancellationRequest()),
      AgentServiceCancellationReceiptSchema.parse(cancellationReceipt())
    ]

    for (const value of parsed) {
      expect(structuredClone(value)).toEqual(value)
      expect(JSON.parse(JSON.stringify(value))).toEqual(value)
    }
  })

  it('reports invalid input as issues rather than throwing', () => {
    const deep = eventEnvelope({ data: nestedData(AGENT_SERVICE_EVENT_DATA_MAX_DEPTH + 8) })
    expect(accept(AgentServiceEventEnvelopeSchema, deep)).toBe(false)

    const oversized = eventEnvelope({
      data: { text: 'x'.repeat(AGENT_SERVICE_EVENT_DATA_MAX_BYTES + 1) }
    })
    expect(accept(AgentServiceEventEnvelopeSchema, oversized)).toBe(false)

    for (const value of [null, undefined, 7, 'event', [], { type: 'run.status' }]) {
      expect(accept(AgentServiceEventEnvelopeSchema, value)).toBe(false)
    }

    // The message id schema is shared with the interaction DTOs, so a smuggled absolute path is
    // rejected there as well.
    expect(accept(AgentServiceMessageIdSchema, 'message-1')).toBe(true)
    expect(accept(AgentServiceMessageIdSchema, '')).toBe(false)
  })
})
