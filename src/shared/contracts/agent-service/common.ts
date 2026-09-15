import { z } from 'zod'
import {
  AppErrorSchema,
  EntityIdSchema,
  SessionStatusSchema,
  SubmissionIdSchema,
  TimestampMsSchema
} from '../common'

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

export const AgentServiceCapabilitiesSchema = z
  .array(AgentServiceCapabilitySchema)
  .max(AGENT_SERVICE_CAPABILITIES.length)
  .superRefine((capabilities, context) => {
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

// Structured error envelope. `capability` names the missing capability when the code is
// `capability_unavailable`, so callers never have to parse the message.
export const AgentServiceErrorSchema = AppErrorSchema.extend({
  code: AgentServiceErrorCodeSchema,
  capability: AgentServiceCapabilityIdSchema.optional()
}).strict()

export type AgentServiceError = z.infer<typeof AgentServiceErrorSchema>
export type AgentServiceErrorCode = z.infer<typeof AgentServiceErrorCodeSchema>

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
