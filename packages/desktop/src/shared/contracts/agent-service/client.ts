import { z } from 'zod'
import {
  AgentServiceCapabilitiesSchema,
  AgentServiceIdentitySchema,
  AgentServiceInstanceIdSchema,
  AgentServiceProtocolVersionSchema,
  AgentServiceRequestIdSchema,
  AgentServiceRunIdSchema,
  AgentServiceSessionIdSchema,
  AgentServiceSubmissionIdSchema,
  AgentServiceSubmissionReceiptSchema,
  type AgentServiceCapability,
  type AgentServiceCapabilityId,
  type AgentServiceError,
  type AgentServiceResult,
  type AgentServiceSubmissionReceipt
} from './common'
import {
  AGENT_SERVICE_MESSAGE_TEXT_MAX_BYTES,
  type AgentServiceEventSubscriptionRequest,
  type AgentServiceEventSubscriptionResponse,
  type AgentServiceSnapshot,
  type AgentServiceSnapshotRequest
} from './events'
import {
  AgentServiceInteractionResponseSchema,
  type AgentServiceCancellationReceipt,
  type AgentServiceCancellationRequest,
  type AgentServiceInteractionResolution
} from './interactions'

// Stage 1C client-facing adapter boundary.
//
// This file is the seam a DeepChat client (Desktop, CLI, scheduler, another runner) uses to talk to an
// Agent Service, and the seam a binding implements. It is deliberately not an RPC framework, a
// service locator, or a plugin system: there is one adapter value with one operation per client
// intent, every request and result is a Stage 1A/1B DTO, and the only thing added at runtime is which
// operations a service's own advertised capabilities make unusable.
//
// Two rules shape everything below.
//
// 1. The adapter is DTO-facing. Requests are DTOs, results are the shared `AgentServiceResult`
//    envelope, and no parameter or return type is a callback, `AbortSignal`, `AsyncIterable`, class
//    instance, database handle, Electron object, provider client, or absolute service path. A client
//    that stops wanting to wait simply stops waiting; stopping work is the protocol's own
//    cancellation DTO, and a disconnect is not proof that an accepted run ended.
// 2. A request can never carry the caller's identity. There is no `principal`, `approver`,
//    `renderer`, `clientKind`, or `asDesktop` field in any schema here, and every object is strict, so
//    such a field is rejected rather than ignored: the authenticated identity comes from the
//    transport/host, and a capability lease is granted by the host rather than claimed by a DTO. A
//    headless client therefore cannot talk its way into a Desktop capability by asking nicely.
//
// Scope, stated so the next slice can cite it instead of re-deriving it. Stage 1C is the operation
// vocabulary and its refusals; three things a client will eventually need are deliberately not here,
// and the boundaries are properties of this surface rather than an omission:
//
// - **Live delivery is the transport's.** `subscribe` answers the Stage 1B bounded subscription
//   response — a replayed window plus a resync verdict — and nothing on this surface is an
//   `AsyncIterable`, a callback, a listener registration, or a handle for a later delivery. A binding
//   that keeps receiving events for a session is a connection, and connections belong to the local
//   client transport slice (Stage 4), which decides framing, reconnection, and backpressure. Adding a
//   long-connection abstraction here would fix a transport's shape before that slice exists.
// - **Steering, the pending-input queue, and session lifecycle are not client operations here.** The
//   vocabulary below is closed, and it has no `steer`, `interrupt`, `queueInput`, `createSession`,
//   `closeSession`, or `setMode`. The queue is observable (the snapshot reports `queuedSubmissions`
//   and the `queued_submission` cancellation layer settles an entry), and interaction state is
//   answerable, but who owns a session, when it is created, and how a later input is steered into a
//   running turn are decisions for the slices that own the loop and the session record. They are
//   recorded here as an explicit hand-off to Stage 1D and later work, which must state whether it
//   extends this vocabulary or expresses the same intent through it.
// - **Compatibility with the maintained CLI surface is Stage 1D.** Nothing here maps onto the
//   existing `runs.*`/local-control routes; 1A mapped error codes and left the route mapping open.

const utf8Encoder = new TextEncoder()

// Handshake. Version negotiation is exact: the request names the protocol version the client speaks,
// so a client that does not speak this version fails validation here instead of being silently
// downgraded. The result carries the service's complete capability statement for that version.
//
// The result deliberately does not echo the request: with exact negotiation the only acceptable
// answer is this version, and the identity already states the version it was produced under.
export const AgentServiceHandshakeRequestSchema = z
  .object({
    protocolVersion: AgentServiceProtocolVersionSchema
  })
  .strict()

// An unavailable entry is one statement written in two fields — the reason says why the capability is
// unusable, and `requiredClient` says which client could still supply it — and `common.ts` validates
// each field's own domain without requiring the two to agree. The agreement is enforced here, on the
// client side of the boundary and without rewriting the accepted Stage 1A advertisement:
//
// - `requires_desktop_client` means exactly `requiredClient: 'desktop'`. A Desktop client is the only
//   thing that could supply the capability, so an advertisement that says so while naming no client
//   states nothing a caller can act on.
// - `not_supported`, `not_configured`, and `host_unavailable` mean exactly `requiredClient: null`. The
//   service is saying it does not implement the capability, has not configured it, or cannot host it —
//   none of which a Desktop client can supply by connecting.
//
// A self-contradicting advertisement fails validation here instead of being repaired, so a client never
// receives a capability statement that claims a Desktop lease its own reason denies.
export const isConsistentCapabilityAdvertisement = (capability: AgentServiceCapability): boolean =>
  capability.availability === 'available' ||
  (capability.reason === 'requires_desktop_client') === (capability.requiredClient === 'desktop')

export const AgentServiceHandshakeResultSchema = z
  .object({
    identity: AgentServiceIdentitySchema,
    // The capability set is the service's whole availability statement, not the subset that happens to
    // work; the schema behind this field refuses a partial or empty set. A client learns what it may
    // attempt from here and from nowhere else.
    capabilities: AgentServiceCapabilitiesSchema
  })
  .strict()
  .superRefine((handshake, context) => {
    handshake.capabilities.forEach((capability, index) => {
      if (!isConsistentCapabilityAdvertisement(capability)) {
        context.addIssue({
          code: 'custom',
          message:
            'An unavailable capability must state one reason and the client it requires: requires_desktop_client means requiredClient "desktop", and every other reason means requiredClient null',
          path: ['capabilities', index]
        })
      }
    })
  })

// Input submission, including the idempotency identity. `submissionId` is required: a submission
// without one could not be receipted or recognised as a repeat, so a lost response would be
// indistinguishable from a submission that never happened.
//
// A binding that retains submission records recognises the repeat by that identity, and a repeat is
// only a repeat when it carries the same text. Reusing the identity with different content is the
// `duplicate_submission` refusal — `retriable: false`, nothing run — because the other two readings
// are both wrong: silently dropping the new content loses what the caller sent, and running it is the
// second run the identity exists to prevent. A client that wants the new content run says so with a
// new identity.
//
// The text bound is the same bound the snapshot's message text uses, so a submission a client is
// allowed to make is one the resulting transcript can report back.
export const AgentServiceSubmissionRequestSchema = z
  .object({
    serviceInstanceId: AgentServiceInstanceIdSchema,
    sessionId: AgentServiceSessionIdSchema,
    submissionId: AgentServiceSubmissionIdSchema,
    text: z
      .string()
      .min(1)
      .refine((value) => value.trim().length > 0, {
        message: 'Submission text must not be blank'
      })
      .refine(
        (value) => utf8Encoder.encode(value).byteLength <= AGENT_SERVICE_MESSAGE_TEXT_MAX_BYTES,
        {
          message: 'Submission text exceeds its UTF-8 byte limit'
        }
      )
  })
  .strict()

// The lost-response path. A client whose submission response never arrived reuses the submission
// identity and reads the receipt instead of submitting again: a missing receipt is not proof that no
// run started, and a blind retry is what would start a second one.
//
// `sessionId` is part of the query rather than inferred from `submissionId`, so a response can never
// describe a submission that belongs to another session.
export const AgentServiceSubmissionQueryRequestSchema = z
  .object({
    serviceInstanceId: AgentServiceInstanceIdSchema,
    sessionId: AgentServiceSessionIdSchema,
    submissionId: AgentServiceSubmissionIdSchema
  })
  .strict()

// What a receipt query answers. Two outcomes, and neither of them authorizes a resubmission:
//
// - `receipt` reports the acceptance this binding holds for that submission identity, which is how a
//   client recovers a lost response without starting a second run.
// - `receipt_not_retained` states that this binding keeps no submission record at all, so it cannot
//   answer whether the submission was accepted. It is a distinct outcome rather than an error, and
//   specifically not `not_found`: a `not_found` for a submission the binding already accepted and
//   executed would describe work that is running as work that never happened, and "never happened" is
//   exactly the reading that licenses a resubmit — the second run this whole path exists to prevent. A
//   binding that cannot answer the question has to say that instead of answering it wrongly.
//
// The same rule holds where a binding does retain receipts. A `not_found` error there reports a
// submission identity this service holds no record of, and `not_found` never authorizes a resubmit
// either: a record can be pruned, so absence is not proof, and the client's authoritative reads are the
// snapshot and the event log. Nothing in this result — nor in the shared error envelope, which is never
// `retriable` for this code — is a signal that resubmitting the same identity is safe; a client that
// must submit again chooses a new submission identity deliberately.
//
// The lack of receipt retention is expressed as data on the query answer rather than as a capability
// refusal because the Stage 1A vocabulary has no id for it: `session.persistence` is what gates
// `querySubmission` and `readSnapshot`, and a binding that states that capability as available — a
// binding that keeps a session and can answer an authoritative snapshot — must not then refuse the
// operation by claiming the capability is missing. Adding a receipt-retention capability id is a
// Stage 1A vocabulary change, so the honest place for the distinction today is the result.
export const AgentServiceSubmissionQueryResultSchema = z.discriminatedUnion('status', [
  z
    .object({
      status: z.literal('receipt'),
      receipt: AgentServiceSubmissionReceiptSchema
    })
    .strict(),
  z
    .object({
      status: z.literal('receipt_not_retained')
    })
    .strict()
])

// Addressing an interaction answer. The Stage 1B response DTO is the service-facing answer: it names
// the session, interaction, message, and tool call it resolves, and carries the decision or the answer
// itself. It deliberately carries no service instance, because a service already knows which instance
// it is — and it carries no run or request, because it was written to be applied to a pending
// interaction rather than addressed to one.
//
// A client surface cannot leave the instance implicit. One client can hold adapters for more than one
// service instance, so an answer with no instance is an answer a client can deliver to the wrong
// service, and a response that names only a session is one a second instance could accept as its own.
// Stage 1C therefore does not change the accepted 1B DTO: it wraps it in the client-side envelope
// below, which states the instance the answer is addressed to.
//
// `runId` and `requestId` are required for the same reason. A published interaction always carries
// both, so a client that received it always has them, and an interaction identity is not proof that the
// interaction is still the same one: without the run and request, an answer could be applied to an
// interaction that a later run republished under the same interaction id. The envelope is strict, so
// the answer is either this correlation or a validation failure.
//
// Nothing here claims an identity. `serviceInstanceId` is the service the answer is sent *to*, not who
// is answering; the authenticated principal still comes from the transport, and the transport still
// decides whether that principal may answer at all.
export const AgentServiceInteractionResponseRequestSchema = z
  .object({
    serviceInstanceId: AgentServiceInstanceIdSchema,
    runId: AgentServiceRunIdSchema,
    requestId: AgentServiceRequestIdSchema,
    response: AgentServiceInteractionResponseSchema
  })
  .strict()

// The client-facing operation vocabulary. It is closed and written as fixed literals on purpose: it is
// the surface an adapter implements, so adding or renaming an operation is a contract change.
export const AGENT_SERVICE_CLIENT_OPERATIONS = [
  'handshake',
  'submit',
  'querySubmission',
  'readSnapshot',
  'subscribe',
  'cancel',
  'respond'
] as const

export const AgentServiceClientOperationSchema = z.enum(AGENT_SERVICE_CLIENT_OPERATIONS)

// Which capability an operation needs before it can succeed at all, or `null` when the operation is
// protocol core and no advertised capability gates it.
//
// The `null` entries are not oversights. A handshake must work even when a service has nothing to
// offer, because it is how a client learns that. `respond` is gated on the loop rather than on a
// capability of its own because interaction state is owned by the loop: an approval with no loop to
// resume is an approval for nothing. The capability vocabulary has no interaction, approval, or
// idempotency id, and this mapping does not invent one — an operation whose availability no capability
// describes stays core.
//
// `satisfies` makes the mapping total: a new operation without a mapping fails the build instead of
// silently being treated as ungated.
export const AGENT_SERVICE_CLIENT_OPERATION_REQUIRED_CAPABILITY = {
  handshake: null,
  submit: 'agent.loop',
  querySubmission: 'session.persistence',
  readSnapshot: 'session.persistence',
  subscribe: 'session.events',
  cancel: 'agent.loop',
  respond: 'agent.loop'
} as const satisfies Record<AgentServiceClientOperation, AgentServiceCapabilityId | null>

// Refusal for a capability a service's own advertisement does not support, in the shared error
// vocabulary, or `null` when the capability is usable.
//
// Three properties matter, and all three are why this is one function instead of a check written at
// each adapter's call sites:
//
// - `requiredClient` is copied from the service's advertisement, never chosen by the caller, and only
//   when the advertisement is one consistent statement (`isConsistentCapabilityAdvertisement`). A
//   capability the service says `requires_desktop_client` reports `'desktop'`; a capability no client
//   can supply (`not_supported`, `host_unavailable`, `not_configured`) reports `null`. An adapter that
//   invented `'desktop'` would tell a headless caller to wait for a Desktop lease the service never
//   promised, and an advertisement that claims `'desktop'` under a reason denying it is reported as
//   `null` for the same reason: a contradictory advertisement promises no client anything.
// - Anything short of one unambiguous `available` entry refuses. A capability that is absent, that the
//   service marked unavailable, or that is advertised twice (disagreeing with itself) is not support,
//   so absence is never read as support. When the advertisement is unusable for that capability,
//   `requiredClient` is `null` rather than a guess: no client can be promised a capability the
//   service did not state it can supply.
// - The refusal is never a report that the advertisement was usable. `retriable` is false and the code
//   is `capability_unavailable`, so a caller cannot read a refusal as a transient failure to try again;
//   the machine-readable meaning is the code, the capability id, and `requiredClient`, and `message` is
//   a human-readable summary only.
export const resolveCapabilityRefusal = (
  capabilities: readonly AgentServiceCapability[],
  required: AgentServiceCapabilityId
): AgentServiceError | null => {
  const advertised = capabilities.filter((capability) => capability.id === required)
  const only = advertised.length === 1 ? advertised[0] : undefined
  if (only !== undefined && only.availability === 'available') return null

  const unavailable = only !== undefined && only.availability === 'unavailable' ? only : undefined

  // One consistent `unavailable` entry is the only case where a client can honestly be named, and even
  // then only when the reason agrees with it: a `requiredClient: null` refusal is the fail-closed answer
  // for everything else, because a contradictory, absent, or duplicated advertisement promises no
  // client anything.
  if (unavailable !== undefined && isConsistentCapabilityAdvertisement(unavailable)) {
    return {
      code: 'capability_unavailable',
      message: `Capability "${required}" is unavailable (${unavailable.reason})`,
      retriable: false,
      capability: required,
      requiredClient: unavailable.requiredClient
    }
  }

  const message =
    advertised.length === 0
      ? `Capability "${required}" was not advertised by the service`
      : unavailable === undefined
        ? `Capability "${required}" is advertised more than once`
        : `Capability "${required}" is advertised inconsistently (${unavailable.reason} with requiredClient ${String(unavailable.requiredClient)})`

  return {
    code: 'capability_unavailable',
    message,
    retriable: false,
    capability: required,
    requiredClient: null
  }
}

// The operation-level form of the same rule, used by an adapter before it does any work. An operation
// the mapping leaves ungated is protocol core and is never refused here, so a handshake still works
// against a service that advertises nothing usable.
export const resolveClientOperationRefusal = (
  capabilities: readonly AgentServiceCapability[],
  operation: AgentServiceClientOperation
): AgentServiceError | null => {
  const required = AGENT_SERVICE_CLIENT_OPERATION_REQUIRED_CAPABILITY[operation]
  return required === null ? null : resolveCapabilityRefusal(capabilities, required)
}

// One adapter value per binding. Both the built-in DeepChat service binding and a direct ACP binding
// implement this surface, which is what keeps their differences visible as data: the two do not have
// the same feature set, and each says so through its handshake capability set and through typed
// refusals instead of through separate interfaces that pretend the missing operations never existed.
//
// Implementations are ordinary values with these seven functions. An adapter holds its own
// advertisement, checks it with `resolveClientOperationRefusal` before doing work, and answers in
// `AgentServiceResult`. No operation takes an options bag, a cancellation token, a progress callback,
// or an identity, and no operation returns a handle.
//
// `querySubmission` answers `AgentServiceSubmissionQueryResult` rather than a bare receipt, so "this
// binding keeps no receipt" is a value a client must handle rather than an absence it can mistake for
// proof that no run started. `respond` takes the client-side envelope rather than the 1B response DTO,
// so an answer states the service instance, run, and request it is addressed to. Both are the client
// surface being stricter than the shared DTOs it carries, not a second set of DTOs.
export type AgentServiceClientAdapter = {
  readonly handshake: (
    request: AgentServiceHandshakeRequest
  ) => Promise<AgentServiceResult<AgentServiceHandshake>>
  readonly submit: (
    request: AgentServiceSubmissionRequest
  ) => Promise<AgentServiceResult<AgentServiceSubmissionReceipt>>
  readonly querySubmission: (
    request: AgentServiceSubmissionQueryRequest
  ) => Promise<AgentServiceResult<AgentServiceSubmissionQueryResult>>
  readonly readSnapshot: (
    request: AgentServiceSnapshotRequest
  ) => Promise<AgentServiceResult<AgentServiceSnapshot>>
  readonly subscribe: (
    request: AgentServiceEventSubscriptionRequest
  ) => Promise<AgentServiceResult<AgentServiceEventSubscriptionResponse>>
  readonly cancel: (
    request: AgentServiceCancellationRequest
  ) => Promise<AgentServiceResult<AgentServiceCancellationReceipt>>
  readonly respond: (
    request: AgentServiceInteractionResponseRequest
  ) => Promise<AgentServiceResult<AgentServiceInteractionResolution>>
}

export type AgentServiceHandshakeRequest = z.infer<typeof AgentServiceHandshakeRequestSchema>
export type AgentServiceHandshake = z.infer<typeof AgentServiceHandshakeResultSchema>
export type AgentServiceSubmissionRequest = z.infer<typeof AgentServiceSubmissionRequestSchema>
export type AgentServiceSubmissionQueryRequest = z.infer<
  typeof AgentServiceSubmissionQueryRequestSchema
>
export type AgentServiceSubmissionQueryResult = z.infer<
  typeof AgentServiceSubmissionQueryResultSchema
>
export type AgentServiceInteractionResponseRequest = z.infer<
  typeof AgentServiceInteractionResponseRequestSchema
>
export type AgentServiceClientOperation = z.infer<typeof AgentServiceClientOperationSchema>
