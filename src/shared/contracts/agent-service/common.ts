import { z } from 'zod'
import {
  AppErrorSchema,
  EntityIdSchema,
  SessionStatusSchema,
  SubmissionIdSchema,
  TimestampMsSchema
} from '../common'
import type { LocalControlErrorCode } from '../localControl'
import { JsonValueSchema } from '../json'

// The service protocol version is negotiated exactly. A client that does not speak this version
// must fail the handshake instead of silently downgrading to a weaker contract.
export const AGENT_SERVICE_PROTOCOL_VERSION = 1 as const

export const AgentServiceProtocolVersionSchema = z.literal(AGENT_SERVICE_PROTOCOL_VERSION)

// Identifies one running service owner for a profile. It is not a database id, credential, or
// process handle, and it never carries an absolute filesystem path.
export const AgentServiceInstanceIdSchema = EntityIdSchema.max(128)

export const AgentServiceSessionIdSchema = EntityIdSchema.max(128)

// Client-supplied idempotency identity for one submission. Reusing it against the same service
// instance must produce a duplicate receipt rather than a second run.
export const AgentServiceSubmissionIdSchema = SubmissionIdSchema

// Execution identity inside the service. This is distinct from the legacy CLI run identifier
// exposed by the `runs.*` routes, which stays a compatibility surface.
export const AgentServiceRunIdSchema = EntityIdSchema.max(128)

// Identity of one model/agent request inside a run. Clients use it to correlate streaming output
// and cancellation with the request that produced it.
export const AgentServiceRequestIdSchema = EntityIdSchema.max(128)

export const AgentServiceImplementationSchema = z
  .object({
    name: z.string().trim().min(1).max(128),
    version: z.string().trim().min(1).max(64)
  })
  .strict()

export const AgentServiceIdentitySchema = z
  .object({
    serviceInstanceId: AgentServiceInstanceIdSchema,
    protocolVersion: AgentServiceProtocolVersionSchema,
    implementation: AgentServiceImplementationSchema
  })
  .strict()

export const AGENT_SERVICE_CAPABILITIES = [
  'provider.model_request',
  'agent.loop',
  'session.persistence',
  'session.events',
  'tools.builtin',
  'tools.mcp',
  'tools.process',
  'tools.file',
  'skills',
  'memory',
  'media.ocr',
  'media.voice',
  'desktop.cua',
  'desktop.browser_preview',
  'desktop.native_window'
] as const

export const AgentServiceCapabilityIdSchema = z.enum(AGENT_SERVICE_CAPABILITIES)

export const AGENT_SERVICE_UNAVAILABLE_REASONS = [
  'not_supported',
  'requires_desktop_client',
  'host_unavailable',
  'not_configured'
] as const

export const AgentServiceUnavailableReasonSchema = z.enum(AGENT_SERVICE_UNAVAILABLE_REASONS)

// Only a Desktop client can supply a live capability lease. Headless clients never receive these
// capabilities as available and must fail closed when one is missing.
export const AgentServiceRequiredClientSchema = z.enum(['desktop'])

// A capability is advertised with an explicit availability discriminator so an unavailable
// capability is visible in the set instead of being absent or silently reported as supported.
export const AgentServiceCapabilitySchema = z.discriminatedUnion('availability', [
  z
    .object({
      id: AgentServiceCapabilityIdSchema,
      availability: z.literal('available')
    })
    .strict(),
  z
    .object({
      id: AgentServiceCapabilityIdSchema,
      availability: z.literal('unavailable'),
      reason: AgentServiceUnavailableReasonSchema,
      requiredClient: AgentServiceRequiredClientSchema.nullable()
    })
    .strict()
])

// A capability set is the service's complete availability statement for this protocol version, not a
// list of the capabilities that happen to work. An omitted capability would be indistinguishable from
// a supported one for a client that only inspects the set, so every id in
// `AGENT_SERVICE_CAPABILITIES` must appear exactly once; an empty or partial set fails closed.
export const AgentServiceCapabilitiesSchema = z
  .array(AgentServiceCapabilitySchema)
  .min(1)
  .max(AGENT_SERVICE_CAPABILITIES.length)
  .superRefine((capabilities, context) => {
    if (capabilities.length === 0) {
      context.addIssue({ code: 'custom', message: 'Capability set must not be empty' })
      return
    }

    const seen = new Set<string>()
    capabilities.forEach((capability, index) => {
      if (seen.has(capability.id)) {
        context.addIssue({
          code: 'custom',
          message: `Duplicate capability: ${capability.id}`,
          path: [index]
        })
      }
      seen.add(capability.id)
    })

    const missing = AGENT_SERVICE_CAPABILITIES.filter((id) => !seen.has(id))
    if (missing.length > 0) {
      context.addIssue({
        code: 'custom',
        message: `Missing capabilities: ${missing.join(', ')}`
      })
    }
  })

export const AGENT_SERVICE_ERROR_CODES = [
  'invalid_request',
  'unauthorized',
  'forbidden',
  'not_found',
  'conflict',
  'duplicate_submission',
  'capability_unavailable',
  'service_unavailable',
  'internal'
] as const

export const AgentServiceErrorCodeSchema = z.enum(AGENT_SERVICE_ERROR_CODES)

// `message` is a human-readable summary for logs and UI fallbacks. It is bounded and must not be
// blank, but it is never the machine-readable contract: structured fields carry the meaning, so a
// client never has to parse this text.
export const AGENT_SERVICE_ERROR_MESSAGE_MAX_LENGTH = 4096

// `details` is a diagnostic channel for bounded context, never a passthrough of host internals. The
// transport already bounds the raw frame; these limits keep an error DTO small no matter what a
// service implementation puts in it.
//
// Redaction is deliberately not one of these limits, and cannot be: a schema has no reliable way to
// tell a credential or a filesystem path from an ordinary diagnostic string, so nothing here
// inspects values for secrets. A producer that must not disclose a value does not place it in
// `details`. Names that merely sound sensitive stay accepted, because they are legitimate
// diagnostics: `tokenCount`, `maxTokens`, and `provider` are all valid detail keys.
export const AGENT_SERVICE_ERROR_DETAILS_MAX_KEYS = 8
export const AGENT_SERVICE_ERROR_DETAIL_KEY_MAX_LENGTH = 128
export const AGENT_SERVICE_ERROR_DETAIL_VALUE_MAX_DEPTH = 4
export const AGENT_SERVICE_ERROR_DETAIL_VALUE_MAX_BYTES = 1024

// Top-level keys are identifier-shaped labels. Nested keys carry no label contract, so they are
// bounded only by the encoded size budget of the value that contains them.
const AGENT_SERVICE_ERROR_DETAIL_KEY_PATTERN = /^[A-Za-z][A-Za-z0-9_]*(?:\.[A-Za-z][A-Za-z0-9_]*)?$/

const utf8Encoder = new TextEncoder()

// Depth-first walk that stops as soon as the depth budget is spent. Because the walk is cut off at
// the budget, a cyclic or pathologically deep value can never exhaust the stack: it simply reports a
// depth beyond the budget and is rejected.
const measureErrorDetailValueDepth = (value: unknown, depth: number): number => {
  if (depth > AGENT_SERVICE_ERROR_DETAIL_VALUE_MAX_DEPTH) return depth
  if (value === null || typeof value !== 'object') return depth

  const children: unknown[] = Array.isArray(value) ? value : Object.values(value)
  let measuredDepth = depth
  for (const child of children) {
    measuredDepth = Math.max(measuredDepth, measureErrorDetailValueDepth(child, depth + 1))
  }
  return measuredDepth
}

// The size budget is the UTF-8 length of the value's own JSON encoding, so nested keys, string
// escaping, and array elements are counted the way a transport would count them and no nesting
// shape can hide bytes from the budget. `null` means the value cannot be encoded at all — a cycle, a
// bigint, a function — which is not measurable and therefore fails closed instead of passing on a
// partial measurement.
const measureErrorDetailValueBytes = (value: unknown): number | null => {
  try {
    const encoded = JSON.stringify(value)
    return encoded === undefined ? null : utf8Encoder.encode(encoded).length
  } catch {
    return null
  }
}

const AgentServiceErrorDetailKeySchema = z
  .string()
  .min(1)
  .max(AGENT_SERVICE_ERROR_DETAIL_KEY_MAX_LENGTH)
  .regex(AGENT_SERVICE_ERROR_DETAIL_KEY_PATTERN)

// Both checks run before `JsonValueSchema` so that a value the encoder cannot represent is rejected
// by measurement, rather than by a recursive JSON walk that would not terminate on it.
const AgentServiceErrorDetailValueSchema = z
  .unknown()
  .superRefine((value, context) => {
    const depth = measureErrorDetailValueDepth(value, 1)
    if (depth > AGENT_SERVICE_ERROR_DETAIL_VALUE_MAX_DEPTH) {
      context.addIssue({
        code: 'custom',
        message: `Detail value depth exceeds ${AGENT_SERVICE_ERROR_DETAIL_VALUE_MAX_DEPTH}`
      })
      return
    }

    const bytes = measureErrorDetailValueBytes(value)
    if (bytes === null) {
      context.addIssue({
        code: 'custom',
        message: 'Detail value is not JSON-encodable'
      })
      return
    }

    if (bytes > AGENT_SERVICE_ERROR_DETAIL_VALUE_MAX_BYTES) {
      context.addIssue({
        code: 'custom',
        message: `Detail value exceeds ${AGENT_SERVICE_ERROR_DETAIL_VALUE_MAX_BYTES} bytes`
      })
    }
  })
  .pipe(JsonValueSchema)

export const AgentServiceErrorDetailsSchema = z
  .record(AgentServiceErrorDetailKeySchema, AgentServiceErrorDetailValueSchema)
  .superRefine((details, context) => {
    if (Object.keys(details).length > AGENT_SERVICE_ERROR_DETAILS_MAX_KEYS) {
      context.addIssue({
        code: 'custom',
        message: `Detail keys exceed ${AGENT_SERVICE_ERROR_DETAILS_MAX_KEYS}`
      })
    }
  })

// Structured error envelope. It reuses the AppError field semantics but overrides `message` and
// `details` with bounded schemas, and ties the structured fields to the code so clients never fall
// back to the message:
//
// - `capability_unavailable` must name the missing capability and the client it requires, so a
//   headless caller can report both without parsing text. The availability reason stays in the
//   capability set, which the handshake already requires to be complete.
// - Every other code must omit those fields, so "which capability failed" can never be inferred from
//   a code that does not mean that.
//
// Identity is never carried here: it comes from the transport. Unknown fields are rejected so a peer
// cannot smuggle in a claimed principal or renderer identity.
export const AgentServiceErrorSchema = AppErrorSchema.extend({
  code: AgentServiceErrorCodeSchema,
  message: z.string().trim().min(1).max(AGENT_SERVICE_ERROR_MESSAGE_MAX_LENGTH),
  details: AgentServiceErrorDetailsSchema.optional(),
  capability: AgentServiceCapabilityIdSchema.optional(),
  requiredClient: AgentServiceRequiredClientSchema.nullable().optional()
})
  .strict()
  .superRefine((error, context) => {
    if (error.code === 'capability_unavailable') {
      if (error.capability === undefined) {
        context.addIssue({
          code: 'custom',
          message: 'capability is required when code is capability_unavailable',
          path: ['capability']
        })
      }
      if (error.requiredClient === undefined) {
        context.addIssue({
          code: 'custom',
          message:
            'requiredClient is required when code is capability_unavailable; use null when no client can supply the capability',
          path: ['requiredClient']
        })
      }
      return
    }
    for (const field of ['capability', 'requiredClient'] as const) {
      if (error[field] !== undefined) {
        context.addIssue({
          code: 'custom',
          message: `${field} is only valid when code is capability_unavailable`,
          path: [field]
        })
      }
    }
  })

export type AgentServiceError = z.infer<typeof AgentServiceErrorSchema>
export type AgentServiceErrorCode = z.infer<typeof AgentServiceErrorCodeSchema>

// Explicit mapping from Agent Service error codes onto the maintained local-control CLI codes, so a
// transport adapter can forward a failure into that envelope without inventing a code per call site.
//
// The mapping is lossy where the two vocabularies differ in granularity, and an adapter must not
// read it as an equivalence:
//
// - `capability_unavailable` and `service_unavailable` both forward as local-control `unavailable`,
//   which distinguishes neither a single missing capability from a whole service outage nor which
//   capability was involved. The identity lives in the Agent Service error (`capability`,
//   `requiredClient`) and an adapter that needs it keeps that error alongside the forwarded code.
// - `duplicate_submission` forwards as `conflict`, which does not say that a submission identity was
//   reused.
//
// Stage 1A does not change `localControl.ts`; the local-control-only codes (version negotiation,
// approval decisions, rate limits, size limits, cancellation deadlines, timeouts) describe transport
// or approval concerns and have no Agent Service source code here. The mapping is total by
// construction: `satisfies` fails the build if a new error code is added without a target.
export const AGENT_SERVICE_ERROR_CODE_TO_LOCAL_CONTROL_CODE = {
  invalid_request: 'invalid_request',
  unauthorized: 'authentication_failed',
  forbidden: 'permission_denied',
  not_found: 'not_found',
  conflict: 'conflict',
  duplicate_submission: 'conflict',
  capability_unavailable: 'unavailable',
  service_unavailable: 'unavailable',
  internal: 'internal_error'
} as const satisfies Record<AgentServiceErrorCode, LocalControlErrorCode>

export const defineAgentServiceResultSchema = <ValueSchema extends z.ZodTypeAny>(
  value: ValueSchema
) =>
  z.discriminatedUnion('ok', [
    z
      .object({
        ok: z.literal(true),
        value
      })
      .strict(),
    z
      .object({
        ok: z.literal(false),
        error: AgentServiceErrorSchema
      })
      .strict()
  ])

export type AgentServiceResult<Value> =
  | { ok: true; value: Value }
  | { ok: false; error: AgentServiceError }

// A client-held reference to a session owned by exactly one service instance. Clients address
// service state through references like this, never through service filesystem paths.
export const AgentServiceSessionRefSchema = z
  .object({
    serviceInstanceId: AgentServiceInstanceIdSchema,
    sessionId: AgentServiceSessionIdSchema
  })
  .strict()

// Queryable receipt for one submission. A lost response is not proof that no run started, so a
// client reuses the submission identity and reads this receipt before retrying side effects.
export const AgentServiceSubmissionReceiptSchema = z
  .object({
    submissionId: AgentServiceSubmissionIdSchema,
    outcome: z.enum(['accepted', 'duplicate']),
    sessionId: AgentServiceSessionIdSchema,
    runId: AgentServiceRunIdSchema.nullable(),
    requestId: AgentServiceRequestIdSchema.nullable(),
    messageId: EntityIdSchema.nullable(),
    status: SessionStatusSchema,
    acceptedAt: TimestampMsSchema
  })
  .strict()

export type AgentServiceIdentity = z.infer<typeof AgentServiceIdentitySchema>
export type AgentServiceCapability = z.infer<typeof AgentServiceCapabilitySchema>
export type AgentServiceCapabilityId = z.infer<typeof AgentServiceCapabilityIdSchema>
export type AgentServiceSessionRef = z.infer<typeof AgentServiceSessionRefSchema>
export type AgentServiceSubmissionReceipt = z.infer<typeof AgentServiceSubmissionReceiptSchema>
