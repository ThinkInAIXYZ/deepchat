import { z } from 'zod'
import {
  AgentServiceCapabilitiesSchema,
  AgentServiceIdentitySchema,
  AgentServiceInstanceIdSchema,
  AgentServiceProtocolVersionSchema,
  AgentServiceSessionIdSchema,
  AgentServiceSubmissionIdSchema,
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
import type {
  AgentServiceCancellationReceipt,
  AgentServiceCancellationRequest,
  AgentServiceInteractionResolution,
  AgentServiceInteractionResponse
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

export const AgentServiceHandshakeResultSchema = z
  .object({
    identity: AgentServiceIdentitySchema,
    // The capability set is the service's whole availability statement, not the subset that happens to
    // work; the schema behind this field refuses a partial or empty set. A client learns what it may
    // attempt from here and from nowhere else.
    capabilities: AgentServiceCapabilitiesSchema
  })
  .strict()

// Input submission, including the idempotency identity. `submissionId` is required: a submission
// without one could not be receipted or recognised as a repeat, so a lost response would be
// indistinguishable from a submission that never happened.
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
// Two properties matter, and both are why this is one function instead of a check written at each
// adapter's call sites:
//
// - `requiredClient` is copied from the service's advertisement, never chosen by the caller. A
//   capability the service says `requires_desktop_client` reports `'desktop'`; a capability no client
//   can supply (`not_supported`, `host_unavailable`, `not_configured`) reports `null`. An adapter that
//   invented `'desktop'` would tell a headless caller to wait for a Desktop lease the service never
//   promised.
// - Anything short of one unambiguous `available` entry refuses. A capability that is absent, that the
//   service marked unavailable, or that is advertised twice (disagreeing with itself) is not support,
//   so absence is never read as support. When the advertisement is unusable for that capability,
//   `requiredClient` is `null` rather than a guess: no client can be promised a capability the
//   service did not state it can supply.
//
// The message is a human-readable summary only. The machine-readable meaning is the code, the
// capability id, and `requiredClient`, and a capability refusal is not retriable.
export const resolveCapabilityRefusal = (
  capabilities: readonly AgentServiceCapability[],
  required: AgentServiceCapabilityId
): AgentServiceError | null => {
  const advertised = capabilities.filter((capability) => capability.id === required)
  const only = advertised.length === 1 ? advertised[0] : undefined
  if (only !== undefined && only.availability === 'available') return null

  const message =
    advertised.length === 0
      ? `Capability "${required}" was not advertised by the service`
      : only !== undefined
        ? `Capability "${required}" is unavailable (${only.reason})`
        : `Capability "${required}" is advertised more than once`

  return {
    code: 'capability_unavailable',
    message,
    retriable: false,
    capability: required,
    requiredClient:
      only !== undefined && only.availability === 'unavailable' ? only.requiredClient : null
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
export type AgentServiceClientAdapter = {
  readonly handshake: (
    request: AgentServiceHandshakeRequest
  ) => Promise<AgentServiceResult<AgentServiceHandshake>>
  readonly submit: (
    request: AgentServiceSubmissionRequest
  ) => Promise<AgentServiceResult<AgentServiceSubmissionReceipt>>
  readonly querySubmission: (
    request: AgentServiceSubmissionQueryRequest
  ) => Promise<AgentServiceResult<AgentServiceSubmissionReceipt>>
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
    request: AgentServiceInteractionResponse
  ) => Promise<AgentServiceResult<AgentServiceInteractionResolution>>
}

export type AgentServiceHandshakeRequest = z.infer<typeof AgentServiceHandshakeRequestSchema>
export type AgentServiceHandshake = z.infer<typeof AgentServiceHandshakeResultSchema>
export type AgentServiceSubmissionRequest = z.infer<typeof AgentServiceSubmissionRequestSchema>
export type AgentServiceSubmissionQueryRequest = z.infer<
  typeof AgentServiceSubmissionQueryRequestSchema
>
export type AgentServiceClientOperation = z.infer<typeof AgentServiceClientOperationSchema>
