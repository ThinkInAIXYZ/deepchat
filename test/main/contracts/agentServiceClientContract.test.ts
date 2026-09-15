import { describe, expect, expectTypeOf, it } from 'vitest'
import { z } from 'zod'
import {
  AGENT_SERVICE_CAPABILITIES,
  AGENT_SERVICE_PROTOCOL_VERSION,
  AGENT_SERVICE_UNAVAILABLE_REASONS,
  AgentServiceCapabilitiesSchema,
  AgentServiceErrorSchema,
  AgentServiceSubmissionReceiptSchema,
  defineAgentServiceResultSchema,
  type AgentServiceCapability,
  type AgentServiceCapabilityId,
  type AgentServiceError,
  type AgentServiceIdentity,
  type AgentServiceResult,
  type AgentServiceSubmissionReceipt
} from '@shared/contracts/agent-service/common'
import {
  AGENT_SERVICE_CLIENT_OPERATIONS,
  AGENT_SERVICE_CLIENT_OPERATION_REQUIRED_CAPABILITY,
  AgentServiceClientOperationSchema,
  AgentServiceHandshakeRequestSchema,
  AgentServiceHandshakeResultSchema,
  AgentServiceSubmissionQueryRequestSchema,
  AgentServiceSubmissionRequestSchema,
  resolveCapabilityRefusal,
  resolveClientOperationRefusal,
  type AgentServiceClientAdapter,
  type AgentServiceHandshakeRequest,
  type AgentServiceSubmissionQueryRequest,
  type AgentServiceSubmissionRequest
} from '@shared/contracts/agent-service/client'
import {
  AGENT_SERVICE_MESSAGE_TEXT_MAX_BYTES,
  AgentServiceEventSubscriptionResponseSchema,
  AgentServiceSnapshotSchema,
  type AgentServiceEventEnvelope,
  type AgentServiceEventResyncReason,
  type AgentServiceEventSubscriptionResponse,
  type AgentServiceEventType,
  type AgentServiceSnapshot
} from '@shared/contracts/agent-service/events'
import {
  AgentServiceCancellationReceiptSchema,
  AgentServiceInteractionResolutionSchema,
  type AgentServiceCancellationReceipt,
  type AgentServiceInteractionRequest
} from '@shared/contracts/agent-service/interactions'
import { LocalControlEventCursorSchema } from '@shared/contracts/localControl'
import type { JsonValue } from '@shared/contracts/json'

// Fixed literals on purpose: this is the client-facing operation vocabulary, so a silent addition,
// removal, or rename must fail this suite instead of agreeing with whatever the module exports.
const EXPECTED_OPERATIONS = [
  'handshake',
  'submit',
  'querySubmission',
  'readSnapshot',
  'subscribe',
  'cancel',
  'respond'
] as const

// The gate each operation depends on. `null` is protocol core: no advertised capability decides it.
const EXPECTED_OPERATION_CAPABILITY = {
  handshake: null,
  submit: 'agent.loop',
  querySubmission: 'session.persistence',
  readSnapshot: 'session.persistence',
  subscribe: 'session.events',
  cancel: 'agent.loop',
  respond: 'agent.loop'
} as const

type UnavailableReason = (typeof AGENT_SERVICE_UNAVAILABLE_REASONS)[number]

const available = (id: AgentServiceCapabilityId): AgentServiceCapability => ({
  id,
  availability: 'available'
})

const unavailable = (
  id: AgentServiceCapabilityId,
  reason: UnavailableReason,
  requiredClient: 'desktop' | null
): AgentServiceCapability => ({ id, availability: 'unavailable', reason, requiredClient })

const capabilitySet = (
  overrides: Partial<Record<AgentServiceCapabilityId, AgentServiceCapability>> = {}
): AgentServiceCapability[] =>
  AGENT_SERVICE_CAPABILITIES.map((id) => overrides[id] ?? available(id))

// The built-in headless service: the loop, provider, session, and host-safe tool classes work, the
// headless-optional classes are not enabled in the first version, and the Desktop classes wait for a
// Desktop client that may never connect.
const BUILTIN_HEADLESS_CAPABILITIES = capabilitySet({
  'tools.mcp': unavailable('tools.mcp', 'not_configured', null),
  skills: unavailable('skills', 'not_configured', null),
  memory: unavailable('memory', 'not_configured', null),
  'media.ocr': unavailable('media.ocr', 'not_configured', null),
  'media.voice': unavailable('media.voice', 'not_configured', null),
  'desktop.cua': unavailable('desktop.cua', 'requires_desktop_client', 'desktop'),
  'desktop.browser_preview': unavailable(
    'desktop.browser_preview',
    'requires_desktop_client',
    'desktop'
  ),
  'desktop.native_window': unavailable(
    'desktop.native_window',
    'requires_desktop_client',
    'desktop'
  )
})

// A direct ACP binding: the peer owns the agent loop and the model requests, so those are available.
// The DeepChat tool-class and plugin capability ids describe the built-in service's own ownership,
// which an external agent's tools are not, so the binding reports them unsupported rather than
// claiming them for a peer that never registered them. Its Desktop ids require `null` rather than
// `'desktop'`: attaching a Desktop client does not give an external agent DeepChat's desktop
// plugins, and telling a caller otherwise would be a lease the binding cannot honour.
const ACP_CAPABILITIES = capabilitySet({
  'tools.builtin': unavailable('tools.builtin', 'not_supported', null),
  'tools.mcp': unavailable('tools.mcp', 'not_supported', null),
  'tools.process': unavailable('tools.process', 'not_supported', null),
  'tools.file': unavailable('tools.file', 'not_supported', null),
  skills: unavailable('skills', 'not_supported', null),
  memory: unavailable('memory', 'not_supported', null),
  'media.ocr': unavailable('media.ocr', 'not_supported', null),
  'media.voice': unavailable('media.voice', 'not_supported', null),
  'desktop.cua': unavailable('desktop.cua', 'not_supported', null),
  'desktop.browser_preview': unavailable('desktop.browser_preview', 'not_supported', null),
  'desktop.native_window': unavailable('desktop.native_window', 'not_supported', null)
})

const identityFor = (name: string): AgentServiceIdentity => ({
  serviceInstanceId: `${name}-instance`,
  protocolVersion: AGENT_SERVICE_PROTOCOL_VERSION,
  implementation: { name, version: '0.1.0' }
})

const validSubmission = {
  serviceInstanceId: 'service-1',
  sessionId: 'session-1',
  submissionId: 'submission-1',
  text: 'hello'
}

const parseOrThrow = <Value extends z.ZodTypeAny>(
  schema: Value,
  value: unknown
): z.infer<Value> => {
  const parsed = schema.safeParse(value)
  if (!parsed.success) {
    throw new Error(
      `DTO did not validate: ${parsed.error.issues
        .map((issue) => `${issue.path.join('.')} ${issue.message}`)
        .join('; ')}`
    )
  }
  return parsed.data
}

// The result envelope is validated as a whole, and its verdict is read through the shared result type
// rather than through the schema's inferred mapped type, so the two branches stay narrowable.
const parseResult = <Value extends z.ZodTypeAny>(
  schema: Value,
  result: unknown
): AgentServiceResult<z.infer<Value>> => {
  const parsed = defineAgentServiceResultSchema(schema).safeParse(result)
  if (!parsed.success) {
    throw new Error(
      `result did not validate: ${parsed.error.issues
        .map((issue) => `${issue.path.join('.')} ${issue.message}`)
        .join('; ')}`
    )
  }
  return parsed.data as AgentServiceResult<z.infer<Value>>
}

// Every result an adapter produces is checked as the full shared envelope, not just as a bare value:
// that is what makes "the same result vocabulary" a proof instead of a claim.
const okValue = <Value extends z.ZodTypeAny>(schema: Value, result: unknown): z.infer<Value> => {
  const parsed = parseResult(schema, result)
  if (!parsed.ok) {
    throw new Error(`expected an ok result, got ${parsed.error.code}: ${parsed.error.message}`)
  }
  return parsed.value
}

const failureOf = <Value extends z.ZodTypeAny>(
  schema: Value,
  result: unknown
): AgentServiceError => {
  const parsed = parseResult(schema, result)
  if (parsed.ok) throw new Error('expected a failure result')
  return parsed.error
}

const expectJsonRoundTrip = (value: unknown): void => {
  expect(JSON.parse(JSON.stringify(value))).toEqual(value)
}

const parseCursor = (cursor: string): { epoch: string; sequence: number } => {
  const separator = cursor.lastIndexOf(':')
  return {
    epoch: cursor.slice(0, separator),
    sequence: Number(cursor.slice(separator + 1))
  }
}

type FakeBindingOptions = {
  name: string
  capabilities: AgentServiceCapability[]
  // The binding keeps a durable submission identity, so a repeated submission is receipted as a
  // duplicate instead of starting a second run. A binding without one cannot tell a repeat from a
  // new submission, which is exactly why a client queries and reads state instead of retrying.
  durableSubmissionIdentity: boolean
  // The service publishes and resolves `question` interactions as well as permissions. A binding that
  // only publishes permissions never has a question to answer, so a question response names an
  // interaction that was never pending.
  questionInteractions: boolean
  // How many events the binding retains for cursor replay. A client older than the retained window
  // must resync rather than receive a spliced replay.
  retainedEvents?: number
}

type FakeBinding = {
  adapter: AgentServiceClientAdapter
  sessionId: string
  serviceInstanceId: string
  // Loses the event log without losing the session, which is what makes a held cursor unusable.
  restart: () => void
  publishPermission: () => AgentServiceInteractionRequest
  publishQuestion: () => AgentServiceInteractionRequest
}

// A fake binding implements the client-facing surface and its own advertisement, and it checks that
// advertisement with the shared resolver before doing any work. It is not a service: it exists so the
// two client-facing bindings can be driven through the same operations and the same result
// vocabulary, and so a capability difference is a typed refusal instead of a silent success.
const createFakeBinding = (options: FakeBindingOptions): FakeBinding => {
  const { capabilities, name } = options
  const retainedEvents = options.retainedEvents ?? 64
  const serviceInstanceId = `${name}-instance`
  const sessionId = `${name}-session`
  const identity = identityFor(name)

  let epoch = 'e1'
  let events: AgentServiceEventEnvelope[] = []
  let sequence = 0
  let clock = 1_000
  let runCounter = 0
  let messageCounter = 0
  let interactionCounter = 0
  let status: 'idle' | 'generating' = 'idle'
  let activeRun: { runId: string; requestId: string | null } | null = null
  const messages: AgentServiceSnapshot['messages'] = []
  const interactions: AgentServiceInteractionRequest[] = []
  const queued: { submissionId: string; receivedAt: number }[] = []
  const receipts = new Map<
    string,
    {
      runId: string | null
      requestId: string | null
      messageId: string | null
      acceptedAt: number
    }
  >()

  const tick = (): number => ++clock
  const lastCursor = (): string => `${epoch}:${sequence}`

  const append = (
    type: AgentServiceEventType,
    fields: {
      runId?: string | null
      requestId?: string | null
      messageId?: string | null
      toolCallId?: string | null
      interaction?: AgentServiceInteractionRequest
      data?: JsonValue
    } = {}
  ): AgentServiceEventEnvelope => {
    sequence += 1
    const event: AgentServiceEventEnvelope = {
      serviceInstanceId,
      sessionId,
      eventId: `event-${sequence}`,
      type,
      cursor: `${epoch}:${sequence}`,
      sequence,
      timestamp: tick(),
      runId: fields.runId ?? null,
      requestId: fields.requestId ?? null,
      messageId: fields.messageId ?? null,
      toolCallId: fields.toolCallId ?? null,
      data: fields.data ?? null
    }
    const withInteraction = fields.interaction
    events.push(withInteraction === undefined ? event : { ...event, interaction: withInteraction })
    if (events.length > retainedEvents) events = events.slice(events.length - retainedEvents)
    return events[events.length - 1] ?? event
  }

  const notFound = (message: string): AgentServiceError => ({
    code: 'not_found',
    message,
    retriable: false
  })

  const invalidRequest = (message: string): AgentServiceError => ({
    code: 'invalid_request',
    message,
    retriable: false
  })

  // A receipt reports one acceptance of one submission, so its timestamp is the time that submission
  // was accepted — a `duplicate` answer reports the original acceptance rather than a new one.
  const receiptFor = (submissionId: string, outcome: 'accepted' | 'duplicate') => {
    const known = receipts.get(submissionId)
    return {
      submissionId,
      outcome,
      sessionId,
      runId: known?.runId ?? null,
      requestId: known?.requestId ?? null,
      messageId: known?.messageId ?? null,
      status,
      acceptedAt: known?.acceptedAt ?? tick()
    }
  }

  // The interaction response DTO carries no service instance id — the interaction id is service-issued
  // — so a response is bound to this service by its session alone, while every other request names
  // both the instance and the session it was addressed to.
  const ownsSession = (request: { sessionId: string }): boolean => request.sessionId === sessionId
  const ownsInstance = (request: { serviceInstanceId: string }): boolean =>
    request.serviceInstanceId === serviceInstanceId
  const wrongService = (): AgentServiceError => notFound('unknown service instance or session')

  const adapter: AgentServiceClientAdapter = {
    async handshake() {
      return { ok: true, value: { identity, capabilities } }
    },

    async submit(request) {
      const refusal = resolveClientOperationRefusal(capabilities, 'submit')
      if (refusal) return { ok: false, error: refusal }
      if (!ownsInstance(request) || !ownsSession(request)) {
        return { ok: false, error: wrongService() }
      }

      const known = receipts.get(request.submissionId)
      if (known !== undefined && options.durableSubmissionIdentity) {
        return { ok: true, value: receiptFor(request.submissionId, 'duplicate') }
      }

      messageCounter += 1
      const messageId = `message-${messageCounter}`
      messages.push({
        messageId,
        role: 'user',
        status: 'sent',
        text: request.text,
        textTruncated: false,
        createdAt: tick(),
        updatedAt: tick()
      })

      // A submission that arrives while a run is generating is queued; the queue is what the
      // `queued_submission` cancellation layer settles. A binding without durable submission identity
      // queues a repeat too, because it has no way to recognise it as one.
      if (status === 'generating') {
        queued.push({ submissionId: request.submissionId, receivedAt: tick() })
        const event = append('queue.updated', { messageId, data: { queued: queued.length } })
        receipts.set(request.submissionId, {
          runId: null,
          requestId: null,
          messageId,
          acceptedAt: event.timestamp
        })
        return {
          ok: true,
          value: {
            submissionId: request.submissionId,
            outcome: 'accepted',
            sessionId,
            runId: null,
            requestId: null,
            messageId,
            status,
            acceptedAt: event.timestamp
          }
        }
      }

      runCounter += 1
      const runId = `run-${runCounter}`
      const requestId = `request-${runCounter}`
      status = 'generating'
      activeRun = { runId, requestId }
      receipts.set(request.submissionId, { runId, requestId, messageId, acceptedAt: tick() })
      append('run.started', { runId, messageId })
      append('run.status', { runId, requestId, data: { status: 'generating' } })
      append('message.completed', { runId, messageId })
      return { ok: true, value: receiptFor(request.submissionId, 'accepted') }
    },

    async querySubmission(request) {
      const refusal = resolveClientOperationRefusal(capabilities, 'querySubmission')
      if (refusal) return { ok: false, error: refusal }
      if (!ownsInstance(request) || !ownsSession(request)) {
        return { ok: false, error: wrongService() }
      }
      if (!options.durableSubmissionIdentity || !receipts.has(request.submissionId)) {
        return { ok: false, error: notFound(`no receipt for submission ${request.submissionId}`) }
      }
      return { ok: true, value: receiptFor(request.submissionId, 'accepted') }
    },

    async readSnapshot(request) {
      const refusal = resolveClientOperationRefusal(capabilities, 'readSnapshot')
      if (refusal) return { ok: false, error: refusal }
      if (!ownsInstance(request) || !ownsSession(request)) {
        return { ok: false, error: wrongService() }
      }
      return {
        ok: true,
        value: {
          serviceInstanceId,
          sessionId,
          capturedAt: tick(),
          cursor: lastCursor(),
          status,
          activeRun,
          queuedSubmissions: [...queued],
          pendingInteractions: [...interactions],
          messages: [...messages],
          messagesTruncated: false,
          artifacts: []
        }
      }
    },

    async subscribe(request) {
      const refusal = resolveClientOperationRefusal(capabilities, 'subscribe')
      if (refusal) return { ok: false, error: refusal }
      if (!ownsInstance(request) || !ownsSession(request)) {
        return { ok: false, error: wrongService() }
      }

      const resync = (
        reason: AgentServiceEventResyncReason
      ): AgentServiceResult<AgentServiceEventSubscriptionResponse> => ({
        ok: true,
        value: {
          status: 'resync_required',
          serviceInstanceId,
          sessionId,
          reason,
          authoritativeCursor: lastCursor()
        }
      })

      const streaming = (
        requestedCursor: string | null,
        replayedEvents: AgentServiceEventEnvelope[]
      ): AgentServiceResult<AgentServiceEventSubscriptionResponse> => ({
        ok: true,
        value: {
          status: 'streaming',
          serviceInstanceId,
          sessionId,
          requestedCursor,
          initialCursor: lastCursor(),
          acceptedMaxReplayEvents: request.maxReplayEvents,
          acceptedMaxBufferedEvents: request.maxBufferedEvents,
          replayedEvents
        }
      })

      if (request.cursor === null) return streaming(null, [])

      const requested = parseCursor(request.cursor)
      // A position from another epoch belongs to an ordering this binding no longer has: the log was
      // replaced, so the client resyncs from the authoritative cursor instead of being handed a
      // replay stitched across the restart.
      if (requested.epoch !== epoch) return resync('service_restarted')
      if (requested.sequence > sequence) return resync('cursor_ahead')
      const oldest = events[0]?.sequence ?? sequence + 1
      if (requested.sequence + 1 < oldest) return resync('cursor_expired')

      const pending = events.filter((event) => event.sequence > requested.sequence)
      if (pending.length > request.maxReplayEvents) return resync('replay_limit_exceeded')
      return streaming(request.cursor, pending)
    },

    async cancel(request) {
      const refusal = resolveClientOperationRefusal(capabilities, 'cancel')
      if (refusal) return { ok: false, error: refusal }
      if (!ownsInstance(request) || !ownsSession(request)) {
        return { ok: false, error: wrongService() }
      }

      const cancelled = (): AgentServiceResult<AgentServiceCancellationReceipt> => ({
        ok: true,
        value: { ...request, outcome: 'cancelled', settledAt: tick() }
      })
      const alreadySettled = (): AgentServiceResult<AgentServiceCancellationReceipt> => ({
        ok: true,
        value: { ...request, outcome: 'already_settled', settledAt: tick() }
      })

      if (request.layer === 'queued_submission') {
        const index = queued.findIndex((entry) => entry.submissionId === request.submissionId)
        if (index >= 0) {
          queued.splice(index, 1)
          append('queue.updated', { data: { queued: queued.length } })
          return cancelled()
        }
        // A submission that already left the queue has started: that is a settled target, not a
        // success for this request. One the binding never saw is not found at all.
        return receipts.has(request.submissionId)
          ? alreadySettled()
          : { ok: false, error: notFound(`unknown submission ${request.submissionId}`) }
      }

      if (request.layer === 'running_run') {
        if (activeRun === null || activeRun.runId !== request.runId) return alreadySettled()
        append('run.cancelled', { runId: request.runId, requestId: activeRun.requestId })
        status = 'idle'
        activeRun = null
        return cancelled()
      }

      const turnIsActive =
        activeRun !== null &&
        activeRun.runId === request.runId &&
        activeRun.requestId === request.requestId
      if (!turnIsActive) return alreadySettled()
      // Stopping the active turn is not settling the run: the run stays active and the queue is
      // untouched, which is what makes it a distinct layer.
      append('run.status', {
        runId: request.runId,
        requestId: request.requestId,
        data: { status: 'idle' }
      })
      return cancelled()
    },

    async respond(request) {
      const refusal = resolveClientOperationRefusal(capabilities, 'respond')
      if (refusal) return { ok: false, error: refusal }
      if (!ownsSession(request)) {
        return { ok: false, error: wrongService() }
      }

      const index = interactions.findIndex(
        (interaction) =>
          interaction.interactionId === request.interactionId &&
          interaction.sessionId === request.sessionId &&
          interaction.messageId === request.messageId &&
          interaction.toolCallId === request.toolCallId
      )
      if (index < 0) {
        return {
          ok: false,
          error: notFound(`interaction ${request.interactionId} is not pending`)
        }
      }

      const interaction = interactions[index]
      const kindMatches =
        interaction !== undefined &&
        ((interaction.kind === 'permission' && request.kind === 'permission') ||
          (interaction.kind === 'question' && request.kind !== 'permission'))
      if (!kindMatches) {
        return {
          ok: false,
          error: invalidRequest(
            `pending interaction ${request.interactionId} is not a ${request.kind} interaction`
          )
        }
      }

      interactions.splice(index, 1)
      append('interaction.resolved', {
        runId: interaction.runId,
        requestId: interaction.requestId,
        messageId: interaction.messageId,
        toolCallId: interaction.toolCallId,
        data: { interactionId: interaction.interactionId }
      })
      return {
        ok: true,
        value: {
          interactionId: interaction.interactionId,
          sessionId,
          resolution: 'accepted',
          // The decision is what lets the paused run continue, so an applied response resumes it.
          resumed: true,
          resolvedAt: tick()
        }
      }
    }
  }

  const publishInteraction = (kind: 'permission' | 'question'): AgentServiceInteractionRequest => {
    if (activeRun === null) {
      throw new Error('a fake interaction belongs to a running run; submit first')
    }
    interactionCounter += 1
    const shared = {
      interactionId: `interaction-${interactionCounter}`,
      sessionId,
      runId: activeRun.runId,
      requestId: activeRun.requestId ?? `request-${runCounter}`,
      messageId: `message-${messageCounter}`,
      toolCallId: `tool-call-${interactionCounter}`,
      expiresAt: tick() + 60_000
    }
    const interaction: AgentServiceInteractionRequest =
      kind === 'permission'
        ? { ...shared, kind: 'permission', toolName: 'bash', summary: 'run a command' }
        : {
            ...shared,
            kind: 'question',
            prompt: 'which target?',
            options: [
              { optionId: 'a', label: 'first' },
              { optionId: 'b', label: 'second' }
            ]
          }
    interactions.push(interaction)
    append('interaction.requested', {
      runId: interaction.runId,
      requestId: interaction.requestId,
      messageId: interaction.messageId,
      toolCallId: interaction.toolCallId,
      interaction,
      data: { interactionId: interaction.interactionId }
    })
    return interaction
  }

  return {
    adapter,
    sessionId,
    serviceInstanceId,
    restart: () => {
      // The binding restarts with a fresh epoch and no retained log: the session state survives, the
      // client's position does not.
      epoch = `e${Number(epoch.slice(1)) + 1}`
      events = []
    },
    publishPermission: () => publishInteraction('permission'),
    publishQuestion: () => {
      // A binding that only ever publishes permissions has no question for a client to answer, so a
      // question response can only name an interaction that was never pending.
      if (!options.questionInteractions) {
        throw new Error(`${name} does not publish question interactions`)
      }
      return publishInteraction('question')
    }
  }
}

const createBuiltinBinding = (options: Partial<FakeBindingOptions> = {}): FakeBinding =>
  createFakeBinding({
    name: 'builtin-service',
    capabilities: BUILTIN_HEADLESS_CAPABILITIES,
    durableSubmissionIdentity: true,
    questionInteractions: true,
    ...options
  })

const createAcpBinding = (options: Partial<FakeBindingOptions> = {}): FakeBinding =>
  createFakeBinding({
    name: 'acp-binding',
    capabilities: ACP_CAPABILITIES,
    durableSubmissionIdentity: false,
    questionInteractions: false,
    ...options
  })

// One scenario through the client-facing surface, run against both bindings. Every answer is checked
// as the shared result envelope, so the scenario proves the two bindings speak one vocabulary rather
// than two lookalike ones.
const runClientScenario = async (binding: FakeBinding) => {
  const { adapter, sessionId, serviceInstanceId, publishPermission } = binding

  const handshake = okValue(
    AgentServiceHandshakeResultSchema,
    await adapter.handshake({ protocolVersion: AGENT_SERVICE_PROTOCOL_VERSION })
  )
  expectJsonRoundTrip(handshake)

  // Subscribe before anything happens: a null cursor means "from now", and the answer states the
  // position a later subscription resumes from.
  const opening = okValue(
    AgentServiceEventSubscriptionResponseSchema,
    await adapter.subscribe({
      serviceInstanceId,
      sessionId,
      cursor: null,
      maxReplayEvents: 32,
      maxBufferedEvents: 64
    })
  )
  expect(opening.status).toBe('streaming')
  const heldCursor = opening.status === 'streaming' ? opening.initialCursor : ''
  expect(LocalControlEventCursorSchema.safeParse(heldCursor).success).toBe(true)

  const submission: AgentServiceSubmissionRequest = {
    serviceInstanceId,
    sessionId,
    submissionId: 'submission-1',
    text: 'summarize the repository'
  }
  const receipt = okValue(AgentServiceSubmissionReceiptSchema, await adapter.submit(submission))
  expectJsonRoundTrip(receipt)
  expect(receipt.outcome).toBe('accepted')

  const replayed = okValue(
    AgentServiceEventSubscriptionResponseSchema,
    await adapter.subscribe({
      serviceInstanceId,
      sessionId,
      cursor: heldCursor,
      maxReplayEvents: 32,
      maxBufferedEvents: 64
    })
  )
  expect(replayed.status).toBe('streaming')
  if (replayed.status === 'streaming') {
    expect(replayed.replayedEvents.length).toBeGreaterThan(0)
    expectJsonRoundTrip(replayed.replayedEvents)
  }

  const queried = parseOrThrow(
    defineAgentServiceResultSchema(AgentServiceSubmissionReceiptSchema),
    await adapter.querySubmission({
      serviceInstanceId,
      sessionId,
      submissionId: submission.submissionId
    })
  )
  if (queried.ok) {
    expectJsonRoundTrip(queried.value)
  } else {
    // A binding without durable submission identity answers `not_found`, which is a vocabulary
    // answer and not a crash: the client's authoritative read is then the snapshot.
    expect(queried.error.code).toBe('not_found')
    expect(queried.error.retriable).toBe(false)
  }

  const interaction = publishPermission()
  const snapshot = okValue(
    AgentServiceSnapshotSchema,
    await adapter.readSnapshot({ serviceInstanceId, sessionId })
  )
  expectJsonRoundTrip(snapshot)
  expect(snapshot.pendingInteractions.map((pending) => pending.interactionId)).toEqual([
    interaction.interactionId
  ])

  const resolution = okValue(
    AgentServiceInteractionResolutionSchema,
    await adapter.respond({
      interactionId: interaction.interactionId,
      sessionId,
      messageId: interaction.messageId,
      toolCallId: interaction.toolCallId,
      kind: 'permission',
      decision: 'approved',
      respondedAt: 1_000_000
    })
  )
  expectJsonRoundTrip(resolution)
  expect(resolution.resumed).toBe(true)

  const activeRun = snapshot.activeRun
  expect(activeRun).not.toBeNull()
  const cancellation = okValue(
    AgentServiceCancellationReceiptSchema,
    await adapter.cancel({
      serviceInstanceId,
      layer: 'running_run',
      sessionId,
      runId: activeRun?.runId ?? ''
    })
  )
  expectJsonRoundTrip(cancellation)
  expect(cancellation.outcome).toBe('cancelled')

  const settled = okValue(
    AgentServiceSnapshotSchema,
    await adapter.readSnapshot({ serviceInstanceId, sessionId })
  )
  expect(settled.status).toBe('idle')
  expect(settled.activeRun).toBeNull()

  return { handshake, receipt, queried, snapshot, settled, resolution, cancellation, heldCursor }
}

describe('agent service client contract', () => {
  describe('operation vocabulary', () => {
    it('publishes the client-facing operations as fixed literals', () => {
      expect([...AGENT_SERVICE_CLIENT_OPERATIONS]).toEqual([...EXPECTED_OPERATIONS])
      for (const operation of EXPECTED_OPERATIONS) {
        expect(AgentServiceClientOperationSchema.safeParse(operation).success).toBe(true)
      }
    })

    it('refuses an operation outside the vocabulary', () => {
      for (const unknown of ['rpc.call', 'handshake.', 'Handshake', 'subscribeAll', '']) {
        expect(AgentServiceClientOperationSchema.safeParse(unknown).success).toBe(false)
      }
    })

    it('maps every operation to a capability or to protocol core', () => {
      expect(AGENT_SERVICE_CLIENT_OPERATION_REQUIRED_CAPABILITY).toEqual(
        EXPECTED_OPERATION_CAPABILITY
      )
      expect(Object.keys(AGENT_SERVICE_CLIENT_OPERATION_REQUIRED_CAPABILITY).sort()).toEqual(
        [...EXPECTED_OPERATIONS].sort()
      )
    })

    it('never gates an operation on a capability outside the vocabulary', () => {
      const declared: readonly string[] = AGENT_SERVICE_CAPABILITIES
      for (const required of Object.values(AGENT_SERVICE_CLIENT_OPERATION_REQUIRED_CAPABILITY)) {
        if (required === null) continue
        expect(declared).toContain(required)
      }
    })
  })

  describe('handshake DTO', () => {
    it('negotiates the version it speaks', () => {
      const request = { protocolVersion: AGENT_SERVICE_PROTOCOL_VERSION }
      expectJsonRoundTrip(parseOrThrow(AgentServiceHandshakeRequestSchema, request))
    })

    it('refuses a protocol version it does not speak instead of downgrading', () => {
      for (const protocolVersion of [0, 2, 3, '1', 'v1', null, undefined]) {
        expect(
          AgentServiceHandshakeRequestSchema.safeParse({ protocolVersion }).success,
          `protocolVersion ${String(protocolVersion)} must not negotiate`
        ).toBe(false)
      }
    })

    it('rejects a claimed client identity in a handshake request', () => {
      for (const claim of [
        { principal: 'human' },
        { renderer: true },
        { clientKind: 'desktop' },
        { asDesktop: true },
        { token: 'secret' }
      ]) {
        expect(
          AgentServiceHandshakeRequestSchema.safeParse({
            protocolVersion: AGENT_SERVICE_PROTOCOL_VERSION,
            ...claim
          }).success
        ).toBe(false)
      }
    })

    it('refuses a partial, empty, or duplicated capability advertisement', () => {
      const full = BUILTIN_HEADLESS_CAPABILITIES
      expect(
        AgentServiceHandshakeResultSchema.safeParse({
          identity: identityFor('builtin-service'),
          capabilities: full
        }).success
      ).toBe(true)

      const partial = full.filter((capability) => capability.id !== 'desktop.cua')
      const duplicated = [...full, available('agent.loop')]
      for (const capabilities of [[], partial, duplicated]) {
        expect(
          AgentServiceHandshakeResultSchema.safeParse({
            identity: identityFor('builtin-service'),
            capabilities
          }).success,
          'a client must not be handed an incomplete capability statement'
        ).toBe(false)
      }
    })

    it('rejects unknown fields in a handshake result', () => {
      for (const extra of [
        { principal: 'human' },
        { desktopCapabilityLease: true },
        { capabilities: 'all' },
        { endpoint: '/tmp/deepchat.sock' }
      ]) {
        expect(
          AgentServiceHandshakeResultSchema.safeParse({
            identity: identityFor('builtin-service'),
            capabilities: BUILTIN_HEADLESS_CAPABILITIES,
            ...extra
          }).success
        ).toBe(false)
      }
    })
  })

  describe('submission DTO', () => {
    it('accepts a bounded submission and round-trips it', () => {
      expectJsonRoundTrip(parseOrThrow(AgentServiceSubmissionRequestSchema, validSubmission))
      expectJsonRoundTrip(
        parseOrThrow(AgentServiceSubmissionQueryRequestSchema, {
          serviceInstanceId: 'service-1',
          sessionId: 'session-1',
          submissionId: 'submission-1'
        })
      )
    })

    it('requires the idempotency identity', () => {
      const withoutId = {
        serviceInstanceId: validSubmission.serviceInstanceId,
        sessionId: validSubmission.sessionId,
        text: validSubmission.text
      }
      for (const request of [withoutId, { ...validSubmission, submissionId: '' }]) {
        expect(AgentServiceSubmissionRequestSchema.safeParse(request).success).toBe(false)
      }
      for (const request of [
        { serviceInstanceId: 'service-1', sessionId: 'session-1' },
        { serviceInstanceId: 'service-1', sessionId: 'session-1', submissionId: '' }
      ]) {
        expect(AgentServiceSubmissionQueryRequestSchema.safeParse(request).success).toBe(false)
      }
    })

    it('rejects a claimed identity, approval, or grant in a submission', () => {
      for (const claim of [
        { principal: 'human' },
        { approver: 'renderer' },
        { renderer: true },
        { clientKind: 'desktop' },
        { asDesktop: true },
        { approved: true },
        { capability: 'desktop.cua' },
        { permissionMode: 'full_access' }
      ]) {
        expect(
          AgentServiceSubmissionRequestSchema.safeParse({ ...validSubmission, ...claim }).success,
          `submission must not be able to claim ${Object.keys(claim)[0]}`
        ).toBe(false)
      }
    })

    it('rejects a host path, handle, callback, or cancellation token in a submission', () => {
      for (const claim of [
        { cwd: '/tmp/work' },
        { attachments: ['/etc/passwd'] },
        { artifactPath: 'file:///tmp/x' },
        { signal: {} },
        { onEvent: () => undefined },
        { stream: { write: () => undefined } }
      ]) {
        expect(
          AgentServiceSubmissionRequestSchema.safeParse({ ...validSubmission, ...claim }).success,
          `submission must not be able to carry ${Object.keys(claim)[0]}`
        ).toBe(false)
      }
    })

    it('bounds the submitted text by its UTF-8 size, not its character count', () => {
      for (const text of ['', '   ', '\n\t']) {
        expect(
          AgentServiceSubmissionRequestSchema.safeParse({ ...validSubmission, text }).success
        ).toBe(false)
      }

      const multiByteCharacter = '🙂'
      const charactersAtLimit = Math.floor(
        AGENT_SERVICE_MESSAGE_TEXT_MAX_BYTES / Buffer.byteLength(multiByteCharacter)
      )
      const atLimit = multiByteCharacter.repeat(charactersAtLimit)
      expect(Buffer.byteLength(atLimit)).toBeLessThanOrEqual(AGENT_SERVICE_MESSAGE_TEXT_MAX_BYTES)
      expect(
        AgentServiceSubmissionRequestSchema.safeParse({ ...validSubmission, text: atLimit }).success
      ).toBe(true)
      expect(
        AgentServiceSubmissionRequestSchema.safeParse({
          ...validSubmission,
          text: `${atLimit}${multiByteCharacter}`
        }).success
      ).toBe(false)
    })
  })

  describe('capability refusal', () => {
    it('reports no refusal for a capability the service advertises as available', () => {
      expect(resolveCapabilityRefusal(BUILTIN_HEADLESS_CAPABILITIES, 'agent.loop')).toBeNull()
      expect(resolveClientOperationRefusal(BUILTIN_HEADLESS_CAPABILITIES, 'submit')).toBeNull()
      expect(resolveClientOperationRefusal(ACP_CAPABILITIES, 'readSnapshot')).toBeNull()
    })

    it('copies requiredClient from the advertisement instead of choosing one', () => {
      const desktopRefusal = resolveCapabilityRefusal(BUILTIN_HEADLESS_CAPABILITIES, 'desktop.cua')
      expect(desktopRefusal).toEqual({
        code: 'capability_unavailable',
        message: 'Capability "desktop.cua" is unavailable (requires_desktop_client)',
        retriable: false,
        capability: 'desktop.cua',
        requiredClient: 'desktop'
      })

      // The same capability on a binding no client can supply it for: reporting `'desktop'` here
      // would point a headless caller at a lease that does not exist.
      const peerRefusal = resolveCapabilityRefusal(ACP_CAPABILITIES, 'desktop.cua')
      expect(peerRefusal?.requiredClient).toBeNull()
      expect(peerRefusal?.capability).toBe('desktop.cua')
    })

    it('refuses a gated operation whose capability is unavailable or absent', () => {
      const eventsUnavailable = capabilitySet({
        'session.events': unavailable('session.events', 'host_unavailable', null)
      })
      const refusal = resolveClientOperationRefusal(eventsUnavailable, 'subscribe')
      expect(refusal?.code).toBe('capability_unavailable')
      expect(refusal?.capability).toBe('session.events')
      expect(refusal?.requiredClient).toBeNull()

      const loopUnavailable = capabilitySet({
        'agent.loop': unavailable('agent.loop', 'not_configured', null)
      })
      expect(resolveClientOperationRefusal(loopUnavailable, 'submit')?.capability).toBe(
        'agent.loop'
      )
      expect(resolveClientOperationRefusal(loopUnavailable, 'cancel')?.capability).toBe(
        'agent.loop'
      )
      expect(resolveClientOperationRefusal(loopUnavailable, 'respond')?.capability).toBe(
        'agent.loop'
      )
    })

    it('never reads an absent or self-contradicting advertisement as support', () => {
      const withoutEvents = capabilitySet().filter(
        (capability) => capability.id !== 'session.events'
      )
      const absent = resolveCapabilityRefusal(withoutEvents, 'session.events')
      expect(absent?.message).toBe('Capability "session.events" was not advertised by the service')
      expect(absent?.requiredClient).toBeNull()

      const contradicting = resolveCapabilityRefusal(
        [...capabilitySet(), unavailable('agent.loop', 'not_supported', null)],
        'agent.loop'
      )
      expect(contradicting?.message).toBe('Capability "agent.loop" is advertised more than once')
      expect(contradicting?.requiredClient).toBeNull()

      // A degenerately empty advertisement still answers the handshake, because refusing the
      // handshake would leave a client unable to learn that the service can do nothing.
      expect(resolveClientOperationRefusal([], 'handshake')).toBeNull()
    })

    it('produces a refusal in the shared error vocabulary', () => {
      const refusal = resolveClientOperationRefusal(
        capabilitySet({
          'session.persistence': unavailable('session.persistence', 'not_configured', null)
        }),
        'readSnapshot'
      )
      expect(AgentServiceErrorSchema.safeParse(refusal).success).toBe(true)
      expect(
        AgentServiceErrorSchema.safeParse({ ...refusal, requiredClient: undefined }).success
      ).toBe(false)
      expectJsonRoundTrip(refusal)
    })
  })

  describe('adapter surface', () => {
    it('exposes exactly the client-facing operations and nothing else', () => {
      expectTypeOf<keyof AgentServiceClientAdapter>().toEqualTypeOf<
        | 'handshake'
        | 'submit'
        | 'querySubmission'
        | 'readSnapshot'
        | 'subscribe'
        | 'cancel'
        | 'respond'
      >()
      expect(Object.keys(createBuiltinBinding().adapter).sort()).toEqual(
        [...EXPECTED_OPERATIONS].sort()
      )
    })

    it('takes DTO requests and shared results, with no options bag or token', () => {
      expectTypeOf<Parameters<AgentServiceClientAdapter['handshake']>>().toEqualTypeOf<
        [AgentServiceHandshakeRequest]
      >()
      expectTypeOf<Parameters<AgentServiceClientAdapter['submit']>>().toEqualTypeOf<
        [AgentServiceSubmissionRequest]
      >()
      expectTypeOf<Parameters<AgentServiceClientAdapter['querySubmission']>>().toEqualTypeOf<
        [AgentServiceSubmissionQueryRequest]
      >()
      expectTypeOf<Awaited<ReturnType<AgentServiceClientAdapter['submit']>>>().toEqualTypeOf<
        AgentServiceResult<AgentServiceSubmissionReceipt>
      >()
    })

    it('has no identity or handle field in its request types', () => {
      expectTypeOf<keyof AgentServiceHandshakeRequest>().toEqualTypeOf<'protocolVersion'>()
      expectTypeOf<keyof AgentServiceSubmissionRequest>().toEqualTypeOf<
        'serviceInstanceId' | 'sessionId' | 'submissionId' | 'text'
      >()
      expectTypeOf<keyof AgentServiceSubmissionQueryRequest>().toEqualTypeOf<
        'serviceInstanceId' | 'sessionId' | 'submissionId'
      >()
    })
  })

  describe('fake built-in service', () => {
    it('answers the shared client scenario', async () => {
      const scenario = await runClientScenario(createBuiltinBinding())
      expect(scenario.queried.ok).toBe(true)
      expect(scenario.queried.ok ? scenario.queried.value.runId : null).toBe(scenario.receipt.runId)
      expect(scenario.settled.cursor).not.toBe(scenario.heldCursor)
    })

    it('receipts a repeated submission instead of starting a second run', async () => {
      const binding = createBuiltinBinding()
      const { adapter, sessionId, serviceInstanceId } = binding
      const submission = { serviceInstanceId, sessionId, submissionId: 'submission-1', text: 'hi' }

      const first = okValue(AgentServiceSubmissionReceiptSchema, await adapter.submit(submission))
      const repeat = okValue(AgentServiceSubmissionReceiptSchema, await adapter.submit(submission))
      expect(first.outcome).toBe('accepted')
      expect(repeat.outcome).toBe('duplicate')
      expect(repeat.runId).toBe(first.runId)
      expect(repeat.submissionId).toBe(first.submissionId)
      // A duplicate receipt reports the original acceptance, not a new one.
      expect(repeat.acceptedAt).toBe(first.acceptedAt)

      const snapshot = okValue(
        AgentServiceSnapshotSchema,
        await adapter.readSnapshot({ serviceInstanceId, sessionId })
      )
      expect(snapshot.messages).toHaveLength(1)
      expect(snapshot.queuedSubmissions).toEqual([])
    })

    it('recovers a lost response by receipt query rather than a blind retry', async () => {
      const binding = createBuiltinBinding()
      const { adapter, sessionId, serviceInstanceId } = binding
      await adapter.submit({
        serviceInstanceId,
        sessionId,
        submissionId: 'submission-1',
        text: 'hi'
      })

      // The response was lost: the identity is queried, and the receipt says the run exists.
      const receipt = okValue(
        AgentServiceSubmissionReceiptSchema,
        await adapter.querySubmission({
          serviceInstanceId,
          sessionId,
          submissionId: 'submission-1'
        })
      )
      expect(receipt.outcome).toBe('accepted')
      expect(receipt.runId).not.toBeNull()

      // A submission the service never saw is `not_found`, which is not a licence to submit again:
      // it is why the client reads the snapshot before deciding.
      const unknown = await adapter.querySubmission({
        serviceInstanceId,
        sessionId,
        submissionId: 'submission-never-sent'
      })
      const error = failureOf(AgentServiceSubmissionReceiptSchema, unknown)
      expect(error.code).toBe('not_found')
      expect(error.retriable).toBe(false)
    })

    it('replays contiguous events from a held cursor', async () => {
      const binding = createBuiltinBinding()
      const { adapter, sessionId, serviceInstanceId } = binding
      const opening = okValue(
        AgentServiceEventSubscriptionResponseSchema,
        await adapter.subscribe({
          serviceInstanceId,
          sessionId,
          cursor: null,
          maxReplayEvents: 32,
          maxBufferedEvents: 64
        })
      )
      const cursor = opening.status === 'streaming' ? opening.initialCursor : ''

      await adapter.submit({
        serviceInstanceId,
        sessionId,
        submissionId: 'submission-1',
        text: 'hi'
      })
      const catchUp = okValue(
        AgentServiceEventSubscriptionResponseSchema,
        await adapter.subscribe({
          serviceInstanceId,
          sessionId,
          cursor,
          maxReplayEvents: 32,
          maxBufferedEvents: 64
        })
      )
      expect(catchUp.status).toBe('streaming')
      if (catchUp.status !== 'streaming') return

      const sequences = catchUp.replayedEvents.map((event) => event.sequence)
      expect(sequences).toEqual(
        sequences.map((_, index) => parseCursor(cursor).sequence + index + 1)
      )
      expect(catchUp.initialCursor).toBe(catchUp.replayedEvents.at(-1)?.cursor)
      for (const event of catchUp.replayedEvents) {
        expect(event.serviceInstanceId).toBe(serviceInstanceId)
        expect(event.sessionId).toBe(sessionId)
      }
    })

    it('refuses an unusable cursor with the reason and the authoritative position', async () => {
      const binding = createBuiltinBinding({ retainedEvents: 2 })
      const { adapter, sessionId, serviceInstanceId } = binding
      await adapter.submit({
        serviceInstanceId,
        sessionId,
        submissionId: 'submission-1',
        text: 'hi'
      })
      const snapshot = okValue(
        AgentServiceSnapshotSchema,
        await adapter.readSnapshot({ serviceInstanceId, sessionId })
      )

      const expired = okValue(
        AgentServiceEventSubscriptionResponseSchema,
        await adapter.subscribe({
          serviceInstanceId,
          sessionId,
          cursor: 'e1:0',
          maxReplayEvents: 32,
          maxBufferedEvents: 64
        })
      )
      expect(expired).toEqual({
        status: 'resync_required',
        serviceInstanceId,
        sessionId,
        reason: 'cursor_expired',
        authoritativeCursor: snapshot.cursor
      })

      const ahead = okValue(
        AgentServiceEventSubscriptionResponseSchema,
        await adapter.subscribe({
          serviceInstanceId,
          sessionId,
          cursor: 'e1:9999',
          maxReplayEvents: 32,
          maxBufferedEvents: 64
        })
      )
      expect(ahead.status === 'resync_required' && ahead.reason).toBe('cursor_ahead')

      // After resync the client resubscribes from the snapshot cursor and is streaming again.
      const resumed = okValue(
        AgentServiceEventSubscriptionResponseSchema,
        await adapter.subscribe({
          serviceInstanceId,
          sessionId,
          cursor: snapshot.cursor,
          maxReplayEvents: 32,
          maxBufferedEvents: 64
        })
      )
      expect(resumed.status).toBe('streaming')
    })

    it('settles a queued submission and reports an already settled target as such', async () => {
      const binding = createBuiltinBinding()
      const { adapter, sessionId, serviceInstanceId } = binding
      await adapter.submit({
        serviceInstanceId,
        sessionId,
        submissionId: 'submission-1',
        text: 'hi'
      })
      const queued = okValue(
        AgentServiceSubmissionReceiptSchema,
        await adapter.submit({
          serviceInstanceId,
          sessionId,
          submissionId: 'submission-2',
          text: 'next'
        })
      )
      expect(queued.runId).toBeNull()

      const cancelled = okValue(
        AgentServiceCancellationReceiptSchema,
        await adapter.cancel({
          serviceInstanceId,
          layer: 'queued_submission',
          sessionId,
          submissionId: 'submission-2'
        })
      )
      expect(cancelled).toEqual({
        serviceInstanceId,
        layer: 'queued_submission',
        sessionId,
        submissionId: 'submission-2',
        outcome: 'cancelled',
        settledAt: expect.any(Number)
      })

      // The first submission already left the queue: cancelling it now settles nothing.
      const settled = okValue(
        AgentServiceCancellationReceiptSchema,
        await adapter.cancel({
          serviceInstanceId,
          layer: 'queued_submission',
          sessionId,
          submissionId: 'submission-1'
        })
      )
      expect(settled.outcome).toBe('already_settled')

      const unknown = await adapter.cancel({
        serviceInstanceId,
        layer: 'queued_submission',
        sessionId,
        submissionId: 'submission-unknown'
      })
      expect(failureOf(AgentServiceCancellationReceiptSchema, unknown).code).toBe('not_found')
    })

    it('stops the active turn without settling the run', async () => {
      const binding = createBuiltinBinding()
      const { adapter, sessionId, serviceInstanceId } = binding
      const receipt = okValue(
        AgentServiceSubmissionReceiptSchema,
        await adapter.submit({
          serviceInstanceId,
          sessionId,
          submissionId: 'submission-1',
          text: 'hi'
        })
      )
      expect(receipt.runId).not.toBeNull()
      expect(receipt.requestId).not.toBeNull()

      const stopped = okValue(
        AgentServiceCancellationReceiptSchema,
        await adapter.cancel({
          serviceInstanceId,
          layer: 'active_turn',
          sessionId,
          runId: receipt.runId ?? '',
          requestId: receipt.requestId ?? ''
        })
      )
      expect(stopped.outcome).toBe('cancelled')

      // A cancel that names a different run must not claim to have cancelled anything, and must not
      // touch the run that is actually active.
      const mismatched = okValue(
        AgentServiceCancellationReceiptSchema,
        await adapter.cancel({
          serviceInstanceId,
          layer: 'running_run',
          sessionId,
          runId: 'run-never-active'
        })
      )
      expect(mismatched.outcome).toBe('already_settled')

      const snapshot = okValue(
        AgentServiceSnapshotSchema,
        await adapter.readSnapshot({ serviceInstanceId, sessionId })
      )
      expect(snapshot.status).toBe('generating')
      expect(snapshot.activeRun?.runId).toBe(receipt.runId)
    })

    it('resolves a published interaction and refuses one that was never pending', async () => {
      const binding = createBuiltinBinding()
      const { adapter, sessionId, serviceInstanceId, publishQuestion } = binding
      await adapter.submit({
        serviceInstanceId,
        sessionId,
        submissionId: 'submission-1',
        text: 'hi'
      })
      const question = publishQuestion()

      const answered = okValue(
        AgentServiceInteractionResolutionSchema,
        await adapter.respond({
          interactionId: question.interactionId,
          sessionId,
          messageId: question.messageId,
          toolCallId: question.toolCallId,
          kind: 'question_option',
          optionId: 'a',
          respondedAt: 1_000_000
        })
      )
      expect(answered.resolution).toBe('accepted')
      expect(answered.resumed).toBe(true)

      const repeated = await adapter.respond({
        interactionId: question.interactionId,
        sessionId,
        messageId: question.messageId,
        toolCallId: question.toolCallId,
        kind: 'question_option',
        optionId: 'a',
        respondedAt: 1_000_001
      })
      expect(failureOf(AgentServiceInteractionResolutionSchema, repeated).code).toBe('not_found')

      // A decision cannot be applied to whatever happens to be pending: the kind has to match too.
      const permission = publishQuestion()
      const wrongKind = await adapter.respond({
        interactionId: permission.interactionId,
        sessionId,
        messageId: permission.messageId,
        toolCallId: permission.toolCallId,
        kind: 'permission',
        decision: 'approved',
        respondedAt: 1_000_002
      })
      expect(failureOf(AgentServiceInteractionResolutionSchema, wrongKind).code).toBe(
        'invalid_request'
      )
    })

    it('fails closed when its own advertisement withholds an operation', async () => {
      const binding = createBuiltinBinding({
        capabilities: capabilitySet({
          'session.events': unavailable('session.events', 'host_unavailable', null)
        })
      })
      const { adapter, sessionId, serviceInstanceId } = binding
      const refused = await adapter.subscribe({
        serviceInstanceId,
        sessionId,
        cursor: null,
        maxReplayEvents: 32,
        maxBufferedEvents: 64
      })
      const error = failureOf(AgentServiceEventSubscriptionResponseSchema, refused)
      expect(error.code).toBe('capability_unavailable')
      expect(error.capability).toBe('session.events')
      expect(error.requiredClient).toBeNull()

      // The rest of the surface still works: an unavailable capability must not take the session
      // away from operations that do not depend on it.
      expect(
        okValue(
          AgentServiceSnapshotSchema,
          await adapter.readSnapshot({ serviceInstanceId, sessionId })
        ).status
      ).toBe('idle')
    })
  })

  describe('fake direct ACP adapter', () => {
    it('answers the same scenario through the same surface', async () => {
      const scenario = await runClientScenario(createAcpBinding())
      expect(scenario.receipt.runId).not.toBeNull()
      expect(scenario.queried.ok).toBe(false)
      expect(scenario.handshake.identity.serviceInstanceId).toBe('acp-binding-instance')
    })

    it('reports the capabilities it cannot state for a peer', async () => {
      const binding = createBuiltinBinding()
      const acp = createAcpBinding()
      const builtinHandshake = okValue(
        AgentServiceHandshakeResultSchema,
        await binding.adapter.handshake({ protocolVersion: AGENT_SERVICE_PROTOCOL_VERSION })
      )
      const acpHandshake = okValue(
        AgentServiceHandshakeResultSchema,
        await acp.adapter.handshake({ protocolVersion: AGENT_SERVICE_PROTOCOL_VERSION })
      )

      // Both state every declared capability: a difference is a stated availability, never an
      // omission a client could read as support.
      expect(builtinHandshake.capabilities.map((capability) => capability.id).sort()).toEqual(
        acpHandshake.capabilities.map((capability) => capability.id).sort()
      )

      const byId = (capabilities: typeof builtinHandshake.capabilities, id: string) =>
        capabilities.find((capability) => capability.id === id)
      expect(byId(builtinHandshake.capabilities, 'desktop.cua')).toEqual(
        unavailable('desktop.cua', 'requires_desktop_client', 'desktop')
      )
      expect(byId(acpHandshake.capabilities, 'desktop.cua')).toEqual(
        unavailable('desktop.cua', 'not_supported', null)
      )
      expect(byId(builtinHandshake.capabilities, 'memory')).toEqual(
        unavailable('memory', 'not_configured', null)
      )
      expect(byId(acpHandshake.capabilities, 'memory')).toEqual(
        unavailable('memory', 'not_supported', null)
      )
      expect(byId(acpHandshake.capabilities, 'agent.loop')).toEqual(available('agent.loop'))
      expect(byId(acpHandshake.capabilities, 'tools.builtin')).toEqual(
        unavailable('tools.builtin', 'not_supported', null)
      )

      // The headline difference for the refusal path: the same missing capability tells a caller
      // with two different answers about who could supply it.
      expect(
        resolveCapabilityRefusal(builtinHandshake.capabilities, 'desktop.cua')?.requiredClient
      ).toBe('desktop')
      expect(
        resolveCapabilityRefusal(acpHandshake.capabilities, 'desktop.cua')?.requiredClient
      ).toBe(null)
    })

    it('keeps no submission receipt, so a blind retry is visible in the snapshot', async () => {
      const binding = createAcpBinding()
      const { adapter, sessionId, serviceInstanceId } = binding
      const submission = { serviceInstanceId, sessionId, submissionId: 'submission-1', text: 'hi' }
      const first = okValue(AgentServiceSubmissionReceiptSchema, await adapter.submit(submission))
      expect(first.outcome).toBe('accepted')

      const repeat = okValue(AgentServiceSubmissionReceiptSchema, await adapter.submit(submission))
      // Nothing in the answer distinguishes this from a new submission: the binding cannot tell.
      expect(repeat.outcome).toBe('accepted')
      expect(repeat.runId).toBeNull()

      const queried = failureOf(
        AgentServiceSubmissionReceiptSchema,
        await adapter.querySubmission({
          serviceInstanceId,
          sessionId,
          submissionId: 'submission-1'
        })
      )
      expect(queried.code).toBe('not_found')

      // The snapshot is the only authoritative read, and it shows the damage a blind retry did.
      const snapshot = okValue(
        AgentServiceSnapshotSchema,
        await adapter.readSnapshot({ serviceInstanceId, sessionId })
      )
      expect(snapshot.messages.filter((message) => message.role === 'user')).toHaveLength(2)
      expect(snapshot.queuedSubmissions.map((entry) => entry.submissionId)).toEqual([
        'submission-1'
      ])
    })

    it('publishes permissions only, so a question answer names nothing pending', async () => {
      const binding = createAcpBinding()
      const { adapter, sessionId, serviceInstanceId, publishPermission } = binding
      await adapter.submit({
        serviceInstanceId,
        sessionId,
        submissionId: 'submission-1',
        text: 'hi'
      })
      const permission = publishPermission()

      const approved = okValue(
        AgentServiceInteractionResolutionSchema,
        await adapter.respond({
          interactionId: permission.interactionId,
          sessionId,
          messageId: permission.messageId,
          toolCallId: permission.toolCallId,
          kind: 'permission',
          decision: 'denied',
          respondedAt: 1_000_000
        })
      )
      expect(approved.resolution).toBe('accepted')

      // The peer has no question interaction to publish, so there is nothing a question answer could
      // resolve — and the binding cannot be made to publish one.
      expect(() => binding.publishQuestion()).toThrow(/does not publish question interactions/)
      const questionAnswer = await adapter.respond({
        interactionId: 'interaction-never-published',
        sessionId,
        messageId: permission.messageId,
        toolCallId: permission.toolCallId,
        kind: 'question_text',
        text: 'the first one',
        respondedAt: 1_000_001
      })
      expect(failureOf(AgentServiceInteractionResolutionSchema, questionAnswer).code).toBe(
        'not_found'
      )
    })

    it('resyncs a held cursor from the authoritative position after it loses its log', async () => {
      const binding = createAcpBinding()
      const { adapter, sessionId, serviceInstanceId } = binding
      await adapter.submit({
        serviceInstanceId,
        sessionId,
        submissionId: 'submission-1',
        text: 'hi'
      })
      const before = okValue(
        AgentServiceSnapshotSchema,
        await adapter.readSnapshot({ serviceInstanceId, sessionId })
      )

      binding.restart()
      const refusedStream = okValue(
        AgentServiceEventSubscriptionResponseSchema,
        await adapter.subscribe({
          serviceInstanceId,
          sessionId,
          cursor: before.cursor,
          maxReplayEvents: 32,
          maxBufferedEvents: 64
        })
      )
      expect(refusedStream.status).toBe('resync_required')
      if (refusedStream.status !== 'resync_required') return
      expect(refusedStream.reason).toBe('service_restarted')

      const after = okValue(
        AgentServiceSnapshotSchema,
        await adapter.readSnapshot({ serviceInstanceId, sessionId })
      )
      expect(after.cursor).toBe(refusedStream.authoritativeCursor)
      // The session survived the restart: state is recovered, position is not.
      expect(after.messages).toHaveLength(1)

      const resubscribed = okValue(
        AgentServiceEventSubscriptionResponseSchema,
        await adapter.subscribe({
          serviceInstanceId,
          sessionId,
          cursor: after.cursor,
          maxReplayEvents: 32,
          maxBufferedEvents: 64
        })
      )
      expect(resubscribed.status).toBe('streaming')
    })
  })

  describe('both bindings together', () => {
    it('answers one operation vocabulary with two different capability statements', async () => {
      const results = await Promise.all(
        [createBuiltinBinding(), createAcpBinding()].map(async (binding) => {
          const handshake = okValue(
            AgentServiceHandshakeResultSchema,
            await binding.adapter.handshake({ protocolVersion: AGENT_SERVICE_PROTOCOL_VERSION })
          )
          return {
            name: handshake.identity.implementation.name,
            capabilities: handshake.capabilities,
            unavailable: handshake.capabilities
              .filter((capability) => capability.availability === 'unavailable')
              .map((capability) => capability.id)
              .sort()
          }
        })
      )

      const [builtin, acp] = results
      expect(builtin?.name).toBe('builtin-service')
      expect(acp?.name).toBe('acp-binding')
      expect(builtin?.unavailable).toEqual([
        'desktop.browser_preview',
        'desktop.cua',
        'desktop.native_window',
        'media.ocr',
        'media.voice',
        'memory',
        'skills',
        'tools.mcp'
      ])
      expect(acp?.unavailable).toEqual([
        'desktop.browser_preview',
        'desktop.cua',
        'desktop.native_window',
        'media.ocr',
        'media.voice',
        'memory',
        'skills',
        'tools.builtin',
        'tools.file',
        'tools.mcp',
        'tools.process'
      ])
      // Neither binding may claim a capability it has not stated, and both must state all of them.
      for (const result of results) {
        expect(result.capabilities).toHaveLength(AGENT_SERVICE_CAPABILITIES.length)
        expect(AgentServiceCapabilitiesSchema.safeParse(result.capabilities).success).toBe(true)
      }
    })
  })
})
