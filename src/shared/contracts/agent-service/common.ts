import { z } from 'zod'
import {
  AppErrorSchema,
  EntityIdSchema,
  SessionStatusSchema,
  SubmissionIdSchema,
  TimestampMsSchema
} from '../common'
import type { LocalControlErrorCode } from '../localControl'
import { JsonValueSchema, type JsonValue } from '../json'

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
export const AGENT_SERVICE_ERROR_DETAILS_MAX_KEYS = 8
export const AGENT_SERVICE_ERROR_DETAIL_KEY_MAX_LENGTH = 128
export const AGENT_SERVICE_ERROR_DETAIL_VALUE_MAX_DEPTH = 4
export const AGENT_SERVICE_ERROR_DETAIL_VALUE_MAX_BYTES = 1024

// Keys are identifier-shaped labels, so the key space itself cannot encode a filesystem path or a
// raw handle.
const AGENT_SERVICE_ERROR_DETAIL_KEY_PATTERN = /^[A-Za-z][A-Za-z0-9_]*(?:\.[A-Za-z][A-Za-z0-9_]*)?$/

// Labels that mark sensitive or non-serializable content are refused as substrings, so
// `access_token`, `apiKey`, `safeStorageCredential`, and `processHandle` are all rejected however
// they are spelled, including inside a longer name.
export const AGENT_SERVICE_FORBIDDEN_ERROR_DETAIL_KEY_FRAGMENTS = [
  'token',
  'secret',
  'password',
  'credential',
  'authorization',
  'apikey',
  'cookie',
  'handle',
  'abortsignal',
  'callback',
  'principal',
  'renderer'
] as const

// Path-shaped labels are refused exactly: a diagnostic key must not describe a service filesystem
// location or a local endpoint.
export const AGENT_SERVICE_FORBIDDEN_ERROR_DETAIL_KEYS = [
  'path',
  'filepath',
  'absolutepath',
  'socket',
  'socketpath'
] as const

const forbiddenErrorDetailKeys = new Set<string>(AGENT_SERVICE_FORBIDDEN_ERROR_DETAIL_KEYS)

const utf8Encoder = new TextEncoder()

const normalizeErrorDetailKey = (key: string) => key.toLowerCase().replace(/[^a-z0-9]/g, '')

const isForbiddenErrorDetailKey = (key: string) => {
  const normalized = normalizeErrorDetailKey(key)
  return (
    forbiddenErrorDetailKeys.has(normalized) ||
    AGENT_SERVICE_FORBIDDEN_ERROR_DETAIL_KEY_FRAGMENTS.some((fragment) =>
      normalized.includes(fragment)
    )
  )
}

type ErrorDetailValueMeasure = { depth: number; bytes: number }

// Conservative upper bound of a value's JSON-encoded UTF-8 size, together with its nesting depth. The
// walk stops as soon as the depth budget is spent, so a hostile or cyclic value can never exhaust the
// stack; object keys are bounded separately by `AGENT_SERVICE_ERROR_DETAIL_KEY_MAX_LENGTH`.
const measureErrorDetailValue = (value: JsonValue, depth: number): ErrorDetailValueMeasure => {
  if (depth > AGENT_SERVICE_ERROR_DETAIL_VALUE_MAX_DEPTH) return { depth, bytes: 0 }
  if (typeof value === 'string') return { depth, bytes: utf8Encoder.encode(value).length + 2 }
  if (value === null || typeof value === 'number' || typeof value === 'boolean') {
    return { depth, bytes: 8 }
  }
  // Not a JSON value at all: `JsonValueSchema` already reports it, so only skip measurement.
  if (typeof value !== 'object') return { depth, bytes: 0 }

  const children: JsonValue[] = Array.isArray(value) ? value : Object.values(value)
  let bytes = 2
  let measuredDepth = depth
  for (const child of children) {
    const measured = measureErrorDetailValue(child, depth + 1)
    measuredDepth = Math.max(measuredDepth, measured.depth)
    bytes += measured.bytes + 1
  }
  return { depth: measuredDepth, bytes }
}

const AgentServiceErrorDetailKeySchema = z
  .string()
  .min(1)
  .max(AGENT_SERVICE_ERROR_DETAIL_KEY_MAX_LENGTH)
  .regex(AGENT_SERVICE_ERROR_DETAIL_KEY_PATTERN)

const AgentServiceErrorDetailValueSchema = JsonValueSchema.superRefine((value, context) => {
  const measured = measureErrorDetailValue(value, 1)
  if (measured.depth > AGENT_SERVICE_ERROR_DETAIL_VALUE_MAX_DEPTH) {
    context.addIssue({
      code: 'custom',
      message: `Detail value depth exceeds ${AGENT_SERVICE_ERROR_DETAIL_VALUE_MAX_DEPTH}`
    })
  }
  if (measured.bytes > AGENT_SERVICE_ERROR_DETAIL_VALUE_MAX_BYTES) {
    context.addIssue({
      code: 'custom',
      message: `Detail value exceeds ${AGENT_SERVICE_ERROR_DETAIL_VALUE_MAX_BYTES} bytes`
    })
  }
})

export const AgentServiceErrorDetailsSchema = z
  .record(AgentServiceErrorDetailKeySchema, AgentServiceErrorDetailValueSchema)
  .superRefine((details, context) => {
    const keys = Object.keys(details)
    if (keys.length > AGENT_SERVICE_ERROR_DETAILS_MAX_KEYS) {
      context.addIssue({
        code: 'custom',
        message: `Detail keys exceed ${AGENT_SERVICE_ERROR_DETAILS_MAX_KEYS}`
      })
    }
    for (const key of keys) {
      if (isForbiddenErrorDetailKey(key)) {
        context.addIssue({
          code: 'custom',
          message: `Forbidden detail key: ${key}`,
          path: [key]
        })
      }
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
