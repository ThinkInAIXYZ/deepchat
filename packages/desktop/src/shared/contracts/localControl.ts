import { z } from 'zod'
import { JsonValueSchema, TimestampMsSchema, type JsonValue } from './json'

export const LOCAL_CONTROL_PROTOCOL_VERSION = 1 as const
export const LOCAL_CONTROL_SURFACE_VERSION = 2 as const
export const LOCAL_CONTROL_PUBLIC_ROUTE_SURFACE_VERSION = LOCAL_CONTROL_SURFACE_VERSION
// Authenticated Programmatic grants negotiate a strict superset without advertising that route
// surface in the public descriptor or accepting it from the wire envelope.
export const LOCAL_CONTROL_PROGRAMMATIC_ROUTE_SURFACE_VERSION = 3 as const
export const LOCAL_CONTROL_ROUTE_SURFACE_VERSIONS = [
  LOCAL_CONTROL_PUBLIC_ROUTE_SURFACE_VERSION,
  LOCAL_CONTROL_PROGRAMMATIC_ROUTE_SURFACE_VERSION
] as const
export const LOCAL_CONTROL_MAX_REQUEST_TIMEOUT_MS = 30 * 60_000
export const LOCAL_CONTROL_MAX_JSON_RESPONSE_BYTES = 16 * 1024 * 1024
export const LOCAL_CONTROL_MAX_STREAM_RECORD_BYTES = 20 * 1024 * 1024
export const LOCAL_CONTROL_DESCRIPTOR_FILENAME = 'local-control.json'
export const LOCAL_CONTROL_RPC_PATH = '/v1/rpc'
export const LOCAL_CONTROL_STREAM_PATH = '/v1/stream'
export const LOCAL_CONTROL_UPLOAD_PATH = '/v1/upload'
export const LOCAL_CONTROL_METHOD_HEADER = 'x-deepchat-method'
export const LOCAL_CONTROL_UPLOAD_REQUEST_HEADER = 'x-deepchat-upload-request'
export const LOCAL_CONTROL_MAX_UPLOAD_REQUEST_HEADER_BYTES = 4 * 1024
export const LOCAL_CONTROL_ARTIFACT_PATH_PREFIX = '/v1/artifacts/'
export const LOCAL_CONTROL_AGENT_TOKEN_ENV = 'DEEPCHAT_CLI_AGENT_TOKEN'

export const LOCAL_CONTROL_EFFECTS = [
  'read',
  'compute',
  'local-maintenance',
  'preference-write',
  'security-config',
  'execution-config',
  'supply-chain',
  'credential',
  'destructive'
] as const

export const LocalControlEffectSchema = z.enum(LOCAL_CONTROL_EFFECTS)

export const LOCAL_CONTROL_SCOPES = [
  'system:read',
  'models:read',
  'models:invoke',
  'media:generate',
  'audio:transcribe',
  'ocr:read',
  'ocr:extract',
  'ocr:manage',
  'sessions:run',
  'runs:read',
  'runs:cancel',
  'artifacts:read',
  'artifacts:manage',
  'settings:read',
  'settings:write',
  'providers:read',
  'providers:write',
  'providers:credential',
  'skills:read',
  'skills:write',
  'mcp:read',
  'mcp:write'
] as const

export const LocalControlScopeSchema = z.enum(LOCAL_CONTROL_SCOPES)
export const LocalControlScopesSchema = z
  .array(LocalControlScopeSchema)
  .max(LOCAL_CONTROL_SCOPES.length)
  .superRefine((scopes, context) => {
    const seen = new Set<string>()
    scopes.forEach((scope, index) => {
      if (seen.has(scope)) {
        context.addIssue({
          code: 'custom',
          message: `Duplicate local-control scope: ${scope}`,
          path: [index]
        })
      }
      seen.add(scope)
    })
  })

export const LocalControlPrincipalSchema = z.enum(['human', 'agent'])

export const LocalControlTokenSchema = z
  .string()
  .min(43)
  .max(256)
  .regex(/^[A-Za-z0-9_-]+$/)

export const LocalControlEndpointSchema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('unix'),
    path: z
      .string()
      .min(1)
      .max(4096)
      .refine((value) => !value.includes('\0'), {
        message: 'Unix socket path must not contain NUL'
      })
  }),
  z.object({
    kind: z.literal('pipe'),
    name: z
      .string()
      .min(1)
      .max(1024)
      .refine((value) => !value.includes('\0'), {
        message: 'Named pipe must not contain NUL'
      })
  })
])

export const LocalControlDescriptorSchema = z
  .object({
    protocolVersion: z.literal(LOCAL_CONTROL_PROTOCOL_VERSION),
    surfaceVersion: z.literal(LOCAL_CONTROL_SURFACE_VERSION),
    appVersion: z.string().min(1).max(128),
    endpoint: LocalControlEndpointSchema,
    pid: z.number().int().positive().max(2_147_483_647),
    token: LocalControlTokenSchema,
    startedAt: TimestampMsSchema
  })
  .strict()

const LocalControlRequestIdSchema = z
  .string()
  .min(1)
  .max(128)
  .regex(/^[A-Za-z0-9._:-]+$/)

export const LocalControlEventCursorSchema = z
  .string()
  .min(3)
  .max(128)
  .regex(/^[A-Za-z0-9_-]+:(?:0|[1-9][0-9]*)$/)

export const LocalControlMethodSchema = z
  .string()
  .min(3)
  .max(128)
  .regex(/^[a-z][A-Za-z0-9]*(?:\.[a-z][A-Za-z0-9]*)+$/)

export const LocalControlRpcRequestSchema = z
  .object({
    protocolVersion: z.literal(LOCAL_CONTROL_PROTOCOL_VERSION),
    surfaceVersion: z.literal(LOCAL_CONTROL_SURFACE_VERSION),
    id: LocalControlRequestIdSchema,
    method: LocalControlMethodSchema,
    params: JsonValueSchema.default({})
  })
  .strict()

export const LocalControlUploadBindingSchema = z
  .object({
    size: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
    sha256: z.string().regex(/^[a-f0-9]{64}$/)
  })
  .strict()

export const LocalControlUploadRequestSchema = LocalControlRpcRequestSchema.extend({
  upload: LocalControlUploadBindingSchema
}).strict()

export const LOCAL_CONTROL_ERROR_CODES = [
  'invalid_request',
  'unsupported_version',
  'authentication_failed',
  'permission_denied',
  'approval_denied',
  'approval_timeout',
  'not_found',
  'conflict',
  'rate_limited',
  'body_too_large',
  'result_too_large',
  'unavailable',
  'cancelled',
  'timeout',
  'internal_error'
] as const

export const LocalControlErrorCodeSchema = z.enum(LOCAL_CONTROL_ERROR_CODES)

export const LocalControlErrorSchema = z
  .object({
    code: LocalControlErrorCodeSchema,
    message: z.string().min(1).max(4096),
    retriable: z.boolean(),
    details: z.record(z.string().max(128), JsonValueSchema).optional()
  })
  .strict()

export const LocalControlRpcResponseSchema = z.discriminatedUnion('ok', [
  z
    .object({
      protocolVersion: z.literal(LOCAL_CONTROL_PROTOCOL_VERSION),
      surfaceVersion: z.literal(LOCAL_CONTROL_SURFACE_VERSION),
      id: LocalControlRequestIdSchema,
      ok: z.literal(true),
      result: JsonValueSchema
    })
    .strict(),
  z
    .object({
      protocolVersion: z.literal(LOCAL_CONTROL_PROTOCOL_VERSION),
      surfaceVersion: z.literal(LOCAL_CONTROL_SURFACE_VERSION),
      id: LocalControlRequestIdSchema,
      ok: z.literal(false),
      error: LocalControlErrorSchema
    })
    .strict()
])

export const LocalControlEventEnvelopeSchema = z
  .object({
    protocolVersion: z.literal(LOCAL_CONTROL_PROTOCOL_VERSION),
    surfaceVersion: z.literal(LOCAL_CONTROL_SURFACE_VERSION),
    sequence: z.number().int().nonnegative(),
    timestamp: TimestampMsSchema,
    requestId: LocalControlRequestIdSchema.optional(),
    runId: z.string().min(1).max(128).optional(),
    cursor: LocalControlEventCursorSchema.optional(),
    event: z.string().min(1).max(128),
    data: JsonValueSchema
  })
  .strict()

export const LocalControlStreamRecordSchema = z.union([
  LocalControlEventEnvelopeSchema,
  LocalControlRpcResponseSchema
])

export type LocalControlEffect = z.infer<typeof LocalControlEffectSchema>
export type LocalControlScope = z.infer<typeof LocalControlScopeSchema>
export type LocalControlPrincipal = z.infer<typeof LocalControlPrincipalSchema>
export type LocalControlRouteSurfaceVersion = (typeof LOCAL_CONTROL_ROUTE_SURFACE_VERSIONS)[number]
export type LocalControlEndpoint = z.infer<typeof LocalControlEndpointSchema>
export type LocalControlDescriptor = z.infer<typeof LocalControlDescriptorSchema>
export type LocalControlRpcRequest = z.infer<typeof LocalControlRpcRequestSchema>
export type LocalControlUploadBinding = z.infer<typeof LocalControlUploadBindingSchema>
export type LocalControlUploadRequest = z.infer<typeof LocalControlUploadRequestSchema>
export type LocalControlErrorCode = z.infer<typeof LocalControlErrorCodeSchema>
export type LocalControlError = z.infer<typeof LocalControlErrorSchema>
export type LocalControlRpcResponse = z.infer<typeof LocalControlRpcResponseSchema>
export type LocalControlEventEnvelope = z.infer<typeof LocalControlEventEnvelopeSchema>
export type LocalControlStreamRecord = z.infer<typeof LocalControlStreamRecordSchema>

export function createLocalControlSuccess(id: string, result: JsonValue): LocalControlRpcResponse {
  return LocalControlRpcResponseSchema.parse({
    protocolVersion: LOCAL_CONTROL_PROTOCOL_VERSION,
    surfaceVersion: LOCAL_CONTROL_SURFACE_VERSION,
    id,
    ok: true,
    result
  })
}

export function createLocalControlFailure(
  id: string,
  error: LocalControlError
): LocalControlRpcResponse {
  return LocalControlRpcResponseSchema.parse({
    protocolVersion: LOCAL_CONTROL_PROTOCOL_VERSION,
    surfaceVersion: LOCAL_CONTROL_SURFACE_VERSION,
    id,
    ok: false,
    error
  })
}
