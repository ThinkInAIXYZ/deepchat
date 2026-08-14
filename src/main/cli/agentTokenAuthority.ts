import { createHash, randomBytes } from 'node:crypto'
import {
  LOCAL_CONTROL_MAX_JSON_RESPONSE_BYTES,
  LOCAL_CONTROL_PROGRAMMATIC_ROUTE_SURFACE_VERSION,
  LocalControlScopesSchema,
  LocalControlTokenSchema,
  type LocalControlScope
} from '@shared/contracts/localControl'
import {
  PROGRAMMATIC_TOOL_RPC_MAX_BODY_BYTES,
  toolBatchRoute,
  toolCallRoute,
  toolDescribeRoute,
  toolSearchRoute
} from '@shared/contracts/routes/tools.routes'
import { z } from 'zod'
import {
  MAX_TAPE_PROGRAMMATIC_TOOL_BATCH_STEPS,
  MAX_TAPE_PROGRAMMATIC_TOOL_CHILDREN,
  MAX_TAPE_PROGRAMMATIC_TOOL_DURATION_MS,
  MAX_TAPE_PROGRAMMATIC_TOOL_INPUT_BYTES,
  MAX_TAPE_PROGRAMMATIC_TOOL_OUTPUT_BYTES
} from '@/tape/domain/toolSurfaceFacts'
import { canonicalJsonStringifyData, hashJsonData } from '@/tape/domain/canonicalJson'
import { parseBoundedJsonBytes } from './body'

export const DEFAULT_AGENT_CLI_TOKEN_TTL_MS = 35 * 60_000
export const DEFAULT_AGENT_CLI_TOKEN_MAX_CALLS = 64
export const DEFAULT_AGENT_CLI_TOKEN_MAX_BYTES = 256 * 1024 * 1024
export const MAX_AGENT_CLI_TOKEN_TTL_MS = 60 * 60_000
export const MAX_AGENT_CLI_TOKEN_CALLS = 1024
export const MAX_AGENT_CLI_TOKEN_BYTES = 1024 * 1024 * 1024

const DEFAULT_MAX_TOKENS = 256
const DEFAULT_MAX_TOKENS_PER_CONVERSATION = 8
const SHA_256_PATTERN = /^[0-9a-f]{64}$/
const MAX_OPERATION_IDENTITY_CHARACTERS = 1_024
const PROGRAMMATIC_TOOL_SAFE_SCALAR_PATTERN = /^[\p{L}\p{N}_.:@/,+-]+$/u
const PROGRAMMATIC_TOOL_SAFE_QUERY_PATTERN = /^[\p{L}\p{N}_.:@/,+-]+(?: [\p{L}\p{N}_.:@/,+-]+)*$/u
const PROGRAMMATIC_TOOL_CANONICAL_LIMIT_PATTERN = /^[1-9][0-9]*$/
const AgentCliProgrammaticRouteSchema = z.enum([
  'tool.search',
  'tool.describe',
  'tool.call',
  'tool.batch'
])

export const AGENT_CLI_PROGRAMMATIC_GRANT_SCHEMA_VERSION = 1 as const

export type AgentCliProgrammaticToolVerb = 'search' | 'describe' | 'call' | 'batch'

export type AgentCliProgrammaticInvocation = Readonly<{
  command: Readonly<{
    domain: 'tool'
    verb: AgentCliProgrammaticToolVerb
  }>
  route: `tool.${AgentCliProgrammaticToolVerb}`
  canonicalInvocationHash: string
}>

export type AgentCliProgrammaticOperationIdentity = Readonly<{
  sessionId: string
  messageId: string
  runId: string
  requestSeq: number
  providerToolCallId: string
}>

export type AgentCliProgrammaticGrantQuotas = Readonly<{
  maxChildren: number
  maxBatchSteps: number
  maxInputBytes: number
  maxOutputBytes: number
  maxDurationMs: number
}>

export type AgentCliProgrammaticOperationBinding = Readonly<{
  schemaVersion: typeof AGENT_CLI_PROGRAMMATIC_GRANT_SCHEMA_VERSION
  surfaceVersion: typeof LOCAL_CONTROL_PROGRAMMATIC_ROUTE_SURFACE_VERSION
  operation: AgentCliProgrammaticOperationIdentity
  command: Readonly<{
    domain: 'tool'
    verb: AgentCliProgrammaticToolVerb
  }>
  route: AgentCliProgrammaticInvocation['route']
  canonicalInvocationHash: string
  adapterMode: 'cli-programmatic'
  capabilityHash: string
  programmaticSurfaceHash: string
  quotas: AgentCliProgrammaticGrantQuotas
}>

export type AgentCliOuterDispatchReceipt = Readonly<{
  sessionId: string
  entryId: number
  created: boolean
  preparedTokenId: string
  operation: AgentCliProgrammaticOperationIdentity
}>

export type AgentCliProgrammaticOperationGrant = AgentCliProgrammaticOperationBinding &
  Readonly<{
    outerDispatchReceipt: Readonly<{
      sessionId: string
      entryId: number
    }>
  }>

export type AgentCliTokenClaims = Readonly<{
  tokenId: string
  conversationId: string
  expiresAt: number
  scopes: readonly LocalControlScope[]
  programmaticOperation?: AgentCliProgrammaticOperationGrant
}>

export type IssuedAgentCliToken = AgentCliTokenClaims &
  Readonly<{
    token: string
    maxCalls: number
    maxBytes: number
  }>

export type AgentCliRequestGrant = Readonly<{
  claims: AgentCliTokenClaims
  signal: AbortSignal
  consumeInputBytes(bytes: number): boolean
  consumeOutputBytes(bytes: number): boolean
  admitProgrammaticInvocation?(input: {
    route: string
    params: Readonly<Record<string, unknown>>
  }): boolean
  release(): void
}>

export type AgentCliRequestBeginResult =
  | Readonly<{ status: 'granted'; grant: AgentCliRequestGrant }>
  | Readonly<{ status: 'invalid' | 'expired' | 'quota-exhausted' }>

export type ArmedAgentCliProgrammaticToken = IssuedAgentCliToken &
  Readonly<{
    programmaticOperation: AgentCliProgrammaticOperationGrant
  }>

export type PreparedAgentCliProgrammaticGrant = Readonly<{
  tokenId: string
  conversationId: string
  expiresAt: number
  operation: AgentCliProgrammaticOperationIdentity
  binding: AgentCliProgrammaticOperationBinding
  arm(receipt: AgentCliOuterDispatchReceipt): ArmedAgentCliProgrammaticToken
  revoke(): void
}>

export type AgentCliTokenAuthorityOptions = Readonly<{
  now?: () => number
  createToken?: () => string
  createTokenId?: () => string
  maxTokens?: number
  maxTokensPerConversation?: number
}>

function canonicalIdentitySchema(maxCharacters: number) {
  return z
    .string()
    .min(1)
    .max(maxCharacters)
    .refine((value) => value === value.trim() && !value.includes('\0'), {
      message: 'Operation identity must be canonical'
    })
}

const AgentCliProgrammaticOperationIdentitySchema = z
  .object({
    sessionId: canonicalIdentitySchema(128),
    messageId: canonicalIdentitySchema(MAX_OPERATION_IDENTITY_CHARACTERS),
    runId: canonicalIdentitySchema(MAX_OPERATION_IDENTITY_CHARACTERS),
    requestSeq: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
    providerToolCallId: canonicalIdentitySchema(MAX_OPERATION_IDENTITY_CHARACTERS)
  })
  .strict()

const AgentCliProgrammaticGrantQuotasSchema = z
  .object({
    maxChildren: z.number().int().positive().max(MAX_TAPE_PROGRAMMATIC_TOOL_CHILDREN),
    maxBatchSteps: z.number().int().positive().max(MAX_TAPE_PROGRAMMATIC_TOOL_BATCH_STEPS),
    maxInputBytes: z.number().int().positive().max(MAX_TAPE_PROGRAMMATIC_TOOL_INPUT_BYTES),
    maxOutputBytes: z.number().int().positive().max(MAX_TAPE_PROGRAMMATIC_TOOL_OUTPUT_BYTES),
    maxDurationMs: z.number().int().positive().max(MAX_TAPE_PROGRAMMATIC_TOOL_DURATION_MS)
  })
  .strict()

const AgentCliProgrammaticOperationGrantSchema = z
  .object({
    schemaVersion: z.literal(AGENT_CLI_PROGRAMMATIC_GRANT_SCHEMA_VERSION),
    surfaceVersion: z.literal(LOCAL_CONTROL_PROGRAMMATIC_ROUTE_SURFACE_VERSION),
    operation: AgentCliProgrammaticOperationIdentitySchema,
    command: z
      .object({
        domain: z.literal('tool'),
        verb: z.enum(['search', 'describe', 'call', 'batch'])
      })
      .strict(),
    route: AgentCliProgrammaticRouteSchema,
    canonicalInvocationHash: z.string().regex(SHA_256_PATTERN),
    adapterMode: z.literal('cli-programmatic'),
    capabilityHash: z.string().regex(SHA_256_PATTERN),
    programmaticSurfaceHash: z.string().regex(SHA_256_PATTERN),
    quotas: AgentCliProgrammaticGrantQuotasSchema,
    outerDispatchReceipt: z
      .object({
        sessionId: canonicalIdentitySchema(128),
        entryId: z.number().int().positive().max(Number.MAX_SAFE_INTEGER)
      })
      .strict()
  })
  .strict()
  .superRefine((grant, context) => {
    if (grant.route !== `tool.${grant.command.verb}`) {
      context.addIssue({
        code: 'custom',
        message: 'Programmatic grant route does not match its command',
        path: ['route']
      })
    }
    if (grant.quotas.maxBatchSteps > grant.quotas.maxChildren) {
      context.addIssue({
        code: 'custom',
        message: 'Programmatic grant batch quota exceeds its child quota',
        path: ['quotas', 'maxBatchSteps']
      })
    }
    if (grant.outerDispatchReceipt.sessionId !== grant.operation.sessionId) {
      context.addIssue({
        code: 'custom',
        message: 'Programmatic grant outer dispatch session does not match its operation',
        path: ['outerDispatchReceipt', 'sessionId']
      })
    }
  })

function requireCanonicalInvocationParams(value: unknown): Readonly<Record<string, unknown>> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('Programmatic Tool stdin must contain one JSON object')
  }
  return value as Readonly<Record<string, unknown>>
}

function parseCanonicalProgrammaticSearchCommand(
  command: string
): Readonly<{ query: string; limit?: number }> | null {
  const prefix = 'deepchat tool search --query '
  if (!command.startsWith(prefix)) return null
  const argumentsText = command.slice(prefix.length)
  let query: string
  let remainder: string
  if (argumentsText.startsWith('"')) {
    const closingQuote = argumentsText.indexOf('"', 1)
    if (closingQuote < 0) return null
    query = argumentsText.slice(1, closingQuote)
    remainder = argumentsText.slice(closingQuote + 1)
  } else {
    const separator = argumentsText.indexOf(' ')
    query = separator < 0 ? argumentsText : argumentsText.slice(0, separator)
    remainder = separator < 0 ? '' : argumentsText.slice(separator)
  }
  if (!PROGRAMMATIC_TOOL_SAFE_QUERY_PATTERN.test(query) || query.startsWith('-')) return null
  if (!remainder) return Object.freeze({ query })
  const limitMatch = /^ --limit ([1-9][0-9]*)$/.exec(remainder)
  if (!limitMatch || !PROGRAMMATIC_TOOL_CANONICAL_LIMIT_PATTERN.test(limitMatch[1])) return null
  return Object.freeze({ query, limit: Number(limitMatch[1]) })
}

function parseCanonicalProgrammaticDescribeCommand(command: string): string | null {
  const prefix = 'deepchat tool describe --target '
  if (!command.startsWith(prefix)) return null
  const argumentText = command.slice(prefix.length)
  let target = argumentText
  if (argumentText.startsWith('"')) {
    if (argumentText.length < 3 || !argumentText.endsWith('"')) return null
    target = argumentText.slice(1, -1)
  }
  if (!PROGRAMMATIC_TOOL_SAFE_SCALAR_PATTERN.test(target) || target.startsWith('-')) return null
  return target
}

export function buildAgentCliProgrammaticInvocationHash(input: {
  command: Readonly<{ domain: 'tool'; verb: AgentCliProgrammaticToolVerb }>
  route: `tool.${AgentCliProgrammaticToolVerb}`
  params: Readonly<Record<string, unknown>>
}): string {
  if (input.route !== `tool.${input.command.verb}`) {
    throw new Error('Programmatic Tool invocation route does not match its command')
  }
  return hashJsonData({
    surfaceVersion: LOCAL_CONTROL_PROGRAMMATIC_ROUTE_SURFACE_VERSION,
    command: input.command,
    route: input.route,
    params: input.params
  })
}

export function parseAgentCliProgrammaticExecInvocation(input: {
  command: string
  stdin?: string
}): AgentCliProgrammaticInvocation {
  const command = input.command
  const tokens = command.split(' ')
  if (
    tokens.some((token) => token.length === 0) ||
    tokens[0] !== 'deepchat' ||
    tokens[1] !== 'tool'
  ) {
    throw new Error('Programmatic Tool exec requires one canonical DeepChat Tool command')
  }

  const verb = tokens[2]
  let parsed: Readonly<Record<string, unknown>>
  if (verb === 'search') {
    const search = parseCanonicalProgrammaticSearchCommand(command)
    if (input.stdin !== undefined || !search) {
      throw new Error('Programmatic Tool search requires canonical bounded scalar arguments')
    }
    parsed = toolSearchRoute.input.parse(search)
  } else if (verb === 'describe') {
    const target = parseCanonicalProgrammaticDescribeCommand(command)
    if (input.stdin !== undefined || !target) {
      throw new Error(
        'Programmatic Tool describe requires one unquoted or exact double-quoted safe target'
      )
    }
    parsed = toolDescribeRoute.input.parse({ target })
  } else if (verb === 'call' || verb === 'batch') {
    if (tokens.length !== 3 || input.stdin === undefined) {
      throw new Error('Programmatic Tool call and batch require an exact command and owned stdin')
    }
    const stdinBytes = Buffer.from(input.stdin, 'utf8')
    if (stdinBytes.length > MAX_TAPE_PROGRAMMATIC_TOOL_INPUT_BYTES) {
      throw new Error('Programmatic Tool stdin exceeds its supported byte limit')
    }
    const parsedBody = parseBoundedJsonBytes(stdinBytes)
    parsed = (verb === 'call' ? toolCallRoute : toolBatchRoute).input.parse(parsedBody)
  } else {
    throw new Error('Programmatic Tool exec command is unsupported')
  }

  const invocationCommand = Object.freeze({
    domain: 'tool' as const,
    verb: verb as AgentCliProgrammaticToolVerb
  })
  const route = `tool.${verb}` as const
  return Object.freeze({
    command: invocationCommand,
    route,
    canonicalInvocationHash: buildAgentCliProgrammaticInvocationHash({
      command: invocationCommand,
      route,
      params: parsed
    })
  })
}

export function parseAgentCliProgrammaticOperationGrant(
  input: unknown
): AgentCliProgrammaticOperationGrant | null {
  const parsed = AgentCliProgrammaticOperationGrantSchema.safeParse(input)
  return parsed.success ? parsed.data : null
}

type TokenRecord = {
  digest: string
  claims: AgentCliTokenClaims
  state: 'prepared' | 'arming' | 'armed' | 'admitting'
  preparedProgrammaticOperation?: AgentCliProgrammaticOperationBinding
  assertAuthorityActive?: () => void
  maxCalls: number
  maxBytes: number
  maxInputBytes: number
  maxOutputBytes: number
  usedCalls: number
  usedBytes: number
  usedInputBytes: number
  usedOutputBytes: number
  activeRequests: number
  issuedAt: number
  controller: AbortController
  expiryTimer: NodeJS.Timeout
}

function positiveSafeInteger(value: number, name: string): number {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new Error(`${name} must be a positive safe integer`)
  }
  return value
}

function boundedPositiveSafeInteger(value: number, maximum: number, name: string): number {
  const normalized = positiveSafeInteger(value, name)
  if (normalized > maximum) throw new Error(`${name} exceeds its supported maximum`)
  return normalized
}

function tokenDigest(token: string): string {
  return createHash('sha256').update(token).digest('hex')
}

function normalizeConversationId(value: string): string {
  const normalized = value.trim()
  if (normalized.length === 0 || normalized.length > 128 || normalized.includes('\0')) {
    throw new Error('conversationId must contain 1 to 128 characters')
  }
  return normalized
}

function normalizeOperationIdentityValue(value: string, name: string): string {
  const normalized = value.trim()
  if (
    normalized.length === 0 ||
    normalized.length > MAX_OPERATION_IDENTITY_CHARACTERS ||
    normalized.includes('\0')
  ) {
    throw new Error(`${name} must contain 1 to ${MAX_OPERATION_IDENTITY_CHARACTERS} characters`)
  }
  return normalized
}

function normalizeProgrammaticOperationBinding(
  input: AgentCliProgrammaticOperationBinding
): AgentCliProgrammaticOperationBinding {
  if (input.schemaVersion !== AGENT_CLI_PROGRAMMATIC_GRANT_SCHEMA_VERSION) {
    throw new Error('Programmatic grant schema version is unsupported')
  }
  if (input.surfaceVersion !== LOCAL_CONTROL_PROGRAMMATIC_ROUTE_SURFACE_VERSION) {
    throw new Error('Programmatic local-control surface version is unsupported')
  }
  if (input.command.domain !== 'tool') {
    throw new Error('Programmatic grant command domain must be tool')
  }
  if (!['search', 'describe', 'call', 'batch'].includes(input.command.verb)) {
    throw new Error('Programmatic grant command verb is unsupported')
  }
  if (input.adapterMode !== 'cli-programmatic') {
    throw new Error('Programmatic grant adapter mode is unsupported')
  }
  const operation = Object.freeze({
    sessionId: normalizeConversationId(input.operation.sessionId),
    messageId: normalizeOperationIdentityValue(input.operation.messageId, 'messageId'),
    runId: normalizeOperationIdentityValue(input.operation.runId, 'runId'),
    requestSeq: positiveSafeInteger(input.operation.requestSeq, 'requestSeq'),
    providerToolCallId: normalizeOperationIdentityValue(
      input.operation.providerToolCallId,
      'providerToolCallId'
    )
  })
  const route = AgentCliProgrammaticRouteSchema.parse(input.route)
  if (route !== `tool.${input.command.verb}`) {
    throw new Error('Programmatic grant route does not match its command')
  }
  const canonicalInvocationHash = input.canonicalInvocationHash.trim()
  const capabilityHash = input.capabilityHash.trim()
  const programmaticSurfaceHash = input.programmaticSurfaceHash.trim()
  if (!SHA_256_PATTERN.test(canonicalInvocationHash)) {
    throw new Error('canonicalInvocationHash must be a SHA-256 hash')
  }
  if (!SHA_256_PATTERN.test(capabilityHash)) {
    throw new Error('capabilityHash must be a SHA-256 hash')
  }
  if (!SHA_256_PATTERN.test(programmaticSurfaceHash)) {
    throw new Error('programmaticSurfaceHash must be a SHA-256 hash')
  }
  const maxInputBytes = boundedPositiveSafeInteger(
    input.quotas.maxInputBytes,
    MAX_TAPE_PROGRAMMATIC_TOOL_INPUT_BYTES,
    'maxInputBytes'
  )
  const maxOutputBytes = boundedPositiveSafeInteger(
    input.quotas.maxOutputBytes,
    MAX_TAPE_PROGRAMMATIC_TOOL_OUTPUT_BYTES,
    'maxOutputBytes'
  )
  const quotas = Object.freeze({
    maxChildren: boundedPositiveSafeInteger(
      input.quotas.maxChildren,
      MAX_TAPE_PROGRAMMATIC_TOOL_CHILDREN,
      'maxChildren'
    ),
    maxBatchSteps: boundedPositiveSafeInteger(
      input.quotas.maxBatchSteps,
      MAX_TAPE_PROGRAMMATIC_TOOL_BATCH_STEPS,
      'maxBatchSteps'
    ),
    maxInputBytes,
    maxOutputBytes,
    maxDurationMs: boundedPositiveSafeInteger(
      input.quotas.maxDurationMs,
      MAX_TAPE_PROGRAMMATIC_TOOL_DURATION_MS,
      'maxDurationMs'
    )
  })
  if (quotas.maxBatchSteps > quotas.maxChildren) {
    throw new Error('maxBatchSteps must not exceed maxChildren')
  }
  return Object.freeze({
    schemaVersion: AGENT_CLI_PROGRAMMATIC_GRANT_SCHEMA_VERSION,
    surfaceVersion: LOCAL_CONTROL_PROGRAMMATIC_ROUTE_SURFACE_VERSION,
    operation,
    command: Object.freeze({ domain: 'tool' as const, verb: input.command.verb }),
    route,
    canonicalInvocationHash,
    adapterMode: 'cli-programmatic' as const,
    capabilityHash,
    programmaticSurfaceHash,
    quotas
  })
}

function operationIdentitiesMatch(
  left: AgentCliProgrammaticOperationIdentity,
  right: AgentCliProgrammaticOperationIdentity
): boolean {
  return (
    left.sessionId === right.sessionId &&
    left.messageId === right.messageId &&
    left.runId === right.runId &&
    left.requestSeq === right.requestSeq &&
    left.providerToolCallId === right.providerToolCallId
  )
}

export class AgentCliTokenCapacityError extends Error {
  constructor() {
    super('Agent CLI token capacity is exhausted')
    this.name = 'AgentCliTokenCapacityError'
  }
}

export class AgentCliTokenAuthority {
  private readonly now: () => number
  private readonly createToken: () => string
  private readonly createTokenId: () => string
  private readonly maxTokens: number
  private readonly maxTokensPerConversation: number
  private readonly recordsByDigest = new Map<string, TokenRecord>()
  private readonly recordsById = new Map<string, TokenRecord>()
  private readonly digestsByConversation = new Map<string, Set<string>>()

  constructor(options: AgentCliTokenAuthorityOptions = {}) {
    this.now = options.now ?? Date.now
    this.createToken = options.createToken ?? (() => randomBytes(32).toString('base64url'))
    this.createTokenId = options.createTokenId ?? (() => randomBytes(16).toString('base64url'))
    this.maxTokens = positiveSafeInteger(options.maxTokens ?? DEFAULT_MAX_TOKENS, 'maxTokens')
    this.maxTokensPerConversation = positiveSafeInteger(
      options.maxTokensPerConversation ?? DEFAULT_MAX_TOKENS_PER_CONVERSATION,
      'maxTokensPerConversation'
    )
  }

  issue(
    input: Readonly<{
      conversationId: string
      scopes: readonly LocalControlScope[]
      ttlMs?: number
      maxCalls?: number
      maxBytes?: number
    }>
  ): IssuedAgentCliToken {
    const conversationId = normalizeConversationId(input.conversationId)
    const scopes = LocalControlScopesSchema.parse([...input.scopes])
    if (scopes.length === 0) throw new Error('scopes must contain at least one capability')
    const ttlMs = boundedPositiveSafeInteger(
      input.ttlMs ?? DEFAULT_AGENT_CLI_TOKEN_TTL_MS,
      MAX_AGENT_CLI_TOKEN_TTL_MS,
      'ttlMs'
    )
    const maxCalls = boundedPositiveSafeInteger(
      input.maxCalls ?? DEFAULT_AGENT_CLI_TOKEN_MAX_CALLS,
      MAX_AGENT_CLI_TOKEN_CALLS,
      'maxCalls'
    )
    const maxBytes = boundedPositiveSafeInteger(
      input.maxBytes ?? DEFAULT_AGENT_CLI_TOKEN_MAX_BYTES,
      MAX_AGENT_CLI_TOKEN_BYTES,
      'maxBytes'
    )
    const allocation = this.allocateToken(conversationId, ttlMs)
    const claims: AgentCliTokenClaims = {
      tokenId: allocation.tokenId,
      conversationId,
      expiresAt: allocation.expiresAt,
      scopes: Object.freeze(scopes)
    }
    const record: TokenRecord = {
      digest: allocation.digest,
      claims,
      state: 'armed',
      maxCalls,
      maxBytes,
      maxInputBytes: maxBytes,
      maxOutputBytes: maxBytes,
      usedCalls: 0,
      usedBytes: 0,
      usedInputBytes: 0,
      usedOutputBytes: 0,
      activeRequests: 0,
      issuedAt: allocation.issuedAt,
      controller: allocation.controller,
      expiryTimer: allocation.expiryTimer
    }
    this.registerRecord(record)

    return { token: allocation.token, ...claims, maxCalls, maxBytes }
  }

  prepareProgrammaticOperation(
    input: Readonly<{
      binding: AgentCliProgrammaticOperationBinding
      ttlMs?: number
      assertAuthorityActive: () => void
    }>
  ): PreparedAgentCliProgrammaticGrant {
    const binding = normalizeProgrammaticOperationBinding(input.binding)
    const conversationId = normalizeConversationId(binding.operation.sessionId)
    if (typeof input.assertAuthorityActive !== 'function') {
      throw new Error('Programmatic grant requires a process-live authority assertion')
    }
    input.assertAuthorityActive()
    const ttlMs = boundedPositiveSafeInteger(
      input.ttlMs ?? Math.min(binding.quotas.maxDurationMs, DEFAULT_AGENT_CLI_TOKEN_TTL_MS),
      Math.min(binding.quotas.maxDurationMs, MAX_AGENT_CLI_TOKEN_TTL_MS),
      'ttlMs'
    )
    // Transport framing is not part of the capability's canonical input/output quotas. Keep the
    // bearer transport hard-bounded independently so a changed but route-bounded request reaches
    // exact-hash admission and receives the same fail-closed shape instead of a quota oracle.
    const maxInputBytes = PROGRAMMATIC_TOOL_RPC_MAX_BODY_BYTES
    const maxOutputBytes = LOCAL_CONTROL_MAX_JSON_RESPONSE_BYTES
    const maxBytes = maxInputBytes + maxOutputBytes
    const allocation = this.allocateToken(conversationId, ttlMs)
    const claims: AgentCliTokenClaims = Object.freeze({
      tokenId: allocation.tokenId,
      conversationId,
      expiresAt: allocation.expiresAt,
      scopes: Object.freeze([])
    })
    const record: TokenRecord = {
      digest: allocation.digest,
      claims,
      state: 'prepared',
      preparedProgrammaticOperation: binding,
      assertAuthorityActive: input.assertAuthorityActive,
      maxCalls: 1,
      maxBytes,
      maxInputBytes,
      maxOutputBytes,
      usedCalls: 0,
      usedBytes: 0,
      usedInputBytes: 0,
      usedOutputBytes: 0,
      activeRequests: 0,
      issuedAt: allocation.issuedAt,
      controller: allocation.controller,
      expiryTimer: allocation.expiryTimer
    }
    this.registerRecord(record)
    let armAttempted = false
    let revoked = false
    return Object.freeze({
      tokenId: claims.tokenId,
      conversationId,
      expiresAt: claims.expiresAt,
      operation: binding.operation,
      binding,
      arm: (receipt) => {
        if (armAttempted || revoked) throw new Error('Programmatic grant is no longer pending')
        armAttempted = true
        return this.armProgrammaticOperation(record, allocation.token, receipt)
      },
      revoke: () => {
        if (revoked) return
        revoked = true
        this.removeRecord(record.digest, 'revoked')
      }
    })
  }

  beginRequest(token: string): AgentCliRequestBeginResult {
    const parsedToken = LocalControlTokenSchema.safeParse(token)
    if (!parsedToken.success) return { status: 'invalid' }
    const digest = tokenDigest(parsedToken.data)
    const record = this.recordsByDigest.get(digest)
    if (!record) return { status: 'invalid' }
    if (record.state !== 'armed') return { status: 'invalid' }
    if (record.claims.expiresAt <= this.now()) {
      this.removeRecord(digest, 'expired')
      return { status: 'expired' }
    }
    const programmaticOperation = record.claims.programmaticOperation
    if (
      record.usedCalls >= record.maxCalls ||
      record.usedBytes >= record.maxBytes ||
      record.usedInputBytes >= record.maxInputBytes ||
      record.usedOutputBytes >= record.maxOutputBytes
    ) {
      // Exact one-use grants deliberately collapse replay into the same authentication shape as
      // changed route/body, expiry, and revocation. Ordinary reusable Agent tokens retain their
      // explicit quota response.
      return { status: programmaticOperation ? 'invalid' : 'quota-exhausted' }
    }
    const validatesProgrammaticAuthority = Boolean(record.assertAuthorityActive)
    if (Boolean(programmaticOperation) !== validatesProgrammaticAuthority) {
      this.removeRecord(digest, 'revoked')
      return { status: 'invalid' }
    }
    if (programmaticOperation) record.state = 'admitting'
    try {
      record.assertAuthorityActive?.()
    } catch {
      this.removeRecord(digest, 'revoked')
      return { status: 'invalid' }
    }
    if (
      this.recordsByDigest.get(digest) !== record ||
      record.state !== (programmaticOperation ? 'admitting' : 'armed') ||
      record.controller.signal.aborted
    ) {
      return { status: 'invalid' }
    }
    if (record.claims.expiresAt <= this.now()) {
      this.removeRecord(digest, 'expired')
      return { status: 'expired' }
    }
    if (!programmaticOperation) record.usedCalls += 1
    record.activeRequests += 1
    let released = false
    return {
      status: 'granted',
      grant: {
        claims: record.claims,
        signal: record.controller.signal,
        consumeInputBytes: (bytes) => this.consumeRecordBytes(record, bytes, 'input'),
        consumeOutputBytes: (bytes) => this.consumeRecordBytes(record, bytes, 'output'),
        ...(programmaticOperation
          ? {
              admitProgrammaticInvocation: (input: {
                route: string
                params: Readonly<Record<string, unknown>>
              }) => this.admitProgrammaticInvocation(record, input)
            }
          : {}),
        release: () => {
          if (released) return
          released = true
          record.activeRequests = Math.max(0, record.activeRequests - 1)
          if (
            programmaticOperation &&
            this.recordsByDigest.get(record.digest) === record &&
            record.state === 'admitting'
          ) {
            this.removeRecord(record.digest, 'revoked')
          }
        }
      }
    }
  }

  consumeBytes(tokenId: string, bytes: number): boolean {
    const record = this.recordsById.get(tokenId)
    return record?.state === 'armed' && record.activeRequests > 0
      ? this.consumeRecordBytes(record, bytes, 'output')
      : false
  }

  revokeConversation(conversationId: string): void {
    const normalized = conversationId.trim()
    if (!normalized) return
    for (const digest of this.digestsByConversation.get(normalized) ?? []) {
      this.removeRecord(digest, 'revoked')
    }
  }

  clear(): void {
    for (const digest of this.recordsByDigest.keys()) {
      this.removeRecord(digest, 'revoked')
    }
  }

  snapshot(): Readonly<{ tokens: number; conversations: number }> {
    this.pruneRetired(this.now())
    return {
      tokens: this.recordsByDigest.size,
      conversations: this.digestsByConversation.size
    }
  }

  private allocateToken(
    conversationId: string,
    ttlMs: number
  ): Readonly<{
    token: string
    tokenId: string
    digest: string
    issuedAt: number
    expiresAt: number
    controller: AbortController
    expiryTimer: NodeJS.Timeout
  }> {
    const issuedAt = this.now()
    if (issuedAt > Number.MAX_SAFE_INTEGER - ttlMs) {
      throw new Error('Agent CLI token expiry is outside the supported range')
    }
    this.pruneRetired(issuedAt)
    const replacesConversationToken =
      (this.digestsByConversation.get(conversationId)?.size ?? 0) >= this.maxTokensPerConversation
    if (this.recordsByDigest.size >= this.maxTokens && !replacesConversationToken) {
      throw new AgentCliTokenCapacityError()
    }
    const token = LocalControlTokenSchema.parse(this.createUniqueToken())
    const tokenId = this.createUniqueTokenId()
    if (replacesConversationToken) this.enforceConversationCapacity(conversationId)
    if (this.recordsByDigest.size >= this.maxTokens) {
      throw new AgentCliTokenCapacityError()
    }
    const digest = tokenDigest(token)
    const controller = new AbortController()
    const expiryTimer = setTimeout(() => this.removeRecord(digest, 'expired'), ttlMs)
    expiryTimer.unref()
    return {
      token,
      tokenId,
      digest,
      issuedAt,
      expiresAt: issuedAt + ttlMs,
      controller,
      expiryTimer
    }
  }

  private registerRecord(record: TokenRecord): void {
    this.recordsByDigest.set(record.digest, record)
    this.recordsById.set(record.claims.tokenId, record)
    const conversationTokens =
      this.digestsByConversation.get(record.claims.conversationId) ?? new Set<string>()
    conversationTokens.add(record.digest)
    this.digestsByConversation.set(record.claims.conversationId, conversationTokens)
  }

  private armProgrammaticOperation(
    record: TokenRecord,
    token: string,
    receipt: AgentCliOuterDispatchReceipt
  ): ArmedAgentCliProgrammaticToken {
    try {
      if (this.recordsByDigest.get(record.digest) !== record || record.state !== 'prepared') {
        throw new Error('Programmatic grant is no longer pending')
      }
      if (!record.preparedProgrammaticOperation || !record.assertAuthorityActive) {
        throw new Error('Programmatic grant lost its prepared authority')
      }
      if (record.claims.expiresAt <= this.now()) {
        throw new Error('Programmatic grant expired before outer dispatch committed')
      }
      record.state = 'arming'
      record.assertAuthorityActive()
      if (
        this.recordsByDigest.get(record.digest) !== record ||
        record.state !== 'arming' ||
        record.controller.signal.aborted
      ) {
        throw new Error('Programmatic grant is no longer pending')
      }
      if (record.claims.expiresAt <= this.now()) {
        throw new Error('Programmatic grant expired before outer dispatch committed')
      }
      if (
        receipt.created !== true ||
        receipt.sessionId !== record.claims.conversationId ||
        receipt.preparedTokenId !== record.claims.tokenId ||
        !Number.isSafeInteger(receipt.entryId) ||
        receipt.entryId <= 0 ||
        !operationIdentitiesMatch(receipt.operation, record.preparedProgrammaticOperation.operation)
      ) {
        throw new Error('Programmatic grant requires its newly committed outer dispatch receipt')
      }
      const programmaticOperation: AgentCliProgrammaticOperationGrant = Object.freeze({
        ...record.preparedProgrammaticOperation,
        outerDispatchReceipt: Object.freeze({
          sessionId: receipt.sessionId,
          entryId: receipt.entryId
        })
      })
      record.claims = Object.freeze({
        ...record.claims,
        programmaticOperation
      })
      record.preparedProgrammaticOperation = undefined
      record.state = 'armed'
      return {
        token,
        ...record.claims,
        programmaticOperation,
        maxCalls: record.maxCalls,
        maxBytes: record.maxBytes
      }
    } catch (error) {
      this.removeRecord(record.digest, 'revoked')
      throw error
    }
  }

  private createUniqueToken(): string {
    for (let attempt = 0; attempt < 8; attempt += 1) {
      const candidate = this.createToken()
      if (!this.recordsByDigest.has(tokenDigest(candidate))) return candidate
    }
    throw new Error('Failed to allocate a unique Agent CLI token')
  }

  private createUniqueTokenId(): string {
    for (let attempt = 0; attempt < 8; attempt += 1) {
      const candidate = this.createTokenId()
      if (/^[A-Za-z0-9_-]{16,128}$/.test(candidate) && !this.recordsById.has(candidate)) {
        return candidate
      }
    }
    throw new Error('Failed to allocate a unique Agent CLI token ID')
  }

  private consumeRecordBytes(
    record: TokenRecord,
    bytes: number,
    direction: 'input' | 'output'
  ): boolean {
    if (!Number.isSafeInteger(bytes) || bytes < 0) {
      throw new Error('Agent CLI byte usage must be a non-negative safe integer')
    }
    if (this.recordsByDigest.get(record.digest) !== record) return false
    if (record.claims.expiresAt <= this.now()) {
      this.removeRecord(record.digest, 'expired')
      return false
    }
    const maximum = direction === 'input' ? record.maxInputBytes : record.maxOutputBytes
    const used = direction === 'input' ? record.usedInputBytes : record.usedOutputBytes
    if (bytes > maximum - used || bytes > record.maxBytes - record.usedBytes) {
      record.usedBytes = record.maxBytes
      if (direction === 'input') record.usedInputBytes = maximum
      else record.usedOutputBytes = maximum
      return false
    }
    record.usedBytes += bytes
    if (direction === 'input') record.usedInputBytes += bytes
    else record.usedOutputBytes += bytes
    return true
  }

  private admitProgrammaticInvocation(
    record: TokenRecord,
    input: {
      route: string
      params: Readonly<Record<string, unknown>>
    }
  ): boolean {
    const operation = record.claims.programmaticOperation
    if (
      !operation ||
      !record.assertAuthorityActive ||
      this.recordsByDigest.get(record.digest) !== record ||
      record.state !== 'admitting' ||
      record.activeRequests !== 1 ||
      record.controller.signal.aborted
    ) {
      return false
    }
    try {
      record.assertAuthorityActive()
      if (
        this.recordsByDigest.get(record.digest) !== record ||
        record.state !== 'admitting' ||
        record.controller.signal.aborted ||
        record.claims.expiresAt <= this.now()
      ) {
        throw new Error('Programmatic grant is no longer active')
      }
      const params = requireCanonicalInvocationParams(input.params)
      const canonicalParamsBytes = Buffer.byteLength(canonicalJsonStringifyData(params), 'utf8')
      const invocationHash = buildAgentCliProgrammaticInvocationHash({
        command: operation.command,
        route: operation.route,
        params
      })
      if (
        input.route !== operation.route ||
        canonicalParamsBytes > operation.quotas.maxInputBytes ||
        invocationHash !== operation.canonicalInvocationHash
      ) {
        throw new Error('Programmatic invocation does not match its grant')
      }
      record.usedCalls += 1
      record.state = 'armed'
      return true
    } catch {
      this.removeRecord(record.digest, 'revoked')
      return false
    }
  }

  private enforceConversationCapacity(conversationId: string): void {
    const conversationTokens = this.digestsByConversation.get(conversationId)
    if (!conversationTokens || conversationTokens.size < this.maxTokensPerConversation) return
    const oldestReplaceable = [...conversationTokens]
      .map((digest) => this.recordsByDigest.get(digest))
      .filter(
        (record): record is TokenRecord =>
          record !== undefined &&
          record.activeRequests === 0 &&
          record.preparedProgrammaticOperation === undefined &&
          record.claims.programmaticOperation === undefined
      )
      .sort(
        (left, right) =>
          left.issuedAt - right.issuedAt || left.claims.tokenId.localeCompare(right.claims.tokenId)
      )[0]
    if (!oldestReplaceable) throw new AgentCliTokenCapacityError()
    this.removeRecord(oldestReplaceable.digest, 'replaced')
  }

  private pruneRetired(now: number): void {
    for (const record of this.recordsByDigest.values()) {
      if (record.claims.expiresAt <= now) {
        this.removeRecord(record.digest, 'expired')
        continue
      }
      if (
        record.activeRequests === 0 &&
        (record.usedCalls >= record.maxCalls ||
          record.usedBytes >= record.maxBytes ||
          record.usedInputBytes >= record.maxInputBytes ||
          record.usedOutputBytes >= record.maxOutputBytes)
      ) {
        this.removeRecord(record.digest, 'exhausted')
      }
    }
  }

  private removeRecord(
    digest: string,
    reason: 'expired' | 'exhausted' | 'replaced' | 'revoked'
  ): void {
    const record = this.recordsByDigest.get(digest)
    if (!record) return
    this.recordsByDigest.delete(digest)
    this.recordsById.delete(record.claims.tokenId)
    const conversationTokens = this.digestsByConversation.get(record.claims.conversationId)
    conversationTokens?.delete(digest)
    if (conversationTokens?.size === 0) {
      this.digestsByConversation.delete(record.claims.conversationId)
    }
    clearTimeout(record.expiryTimer)
    record.controller.abort(new Error(`Agent CLI token ${reason}`))
  }
}
