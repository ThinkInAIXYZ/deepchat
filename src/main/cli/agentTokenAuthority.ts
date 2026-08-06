import { createHash, randomBytes } from 'node:crypto'
import {
  LocalControlScopesSchema,
  LocalControlTokenSchema,
  type LocalControlScope
} from '@shared/contracts/localControl'

export const DEFAULT_AGENT_CLI_TOKEN_TTL_MS = 35 * 60_000
export const DEFAULT_AGENT_CLI_TOKEN_MAX_CALLS = 64
export const DEFAULT_AGENT_CLI_TOKEN_MAX_BYTES = 256 * 1024 * 1024
export const MAX_AGENT_CLI_TOKEN_TTL_MS = 60 * 60_000
export const MAX_AGENT_CLI_TOKEN_CALLS = 1024
export const MAX_AGENT_CLI_TOKEN_BYTES = 1024 * 1024 * 1024

const DEFAULT_MAX_TOKENS = 256
const DEFAULT_MAX_TOKENS_PER_CONVERSATION = 8

export type AgentCliTokenClaims = Readonly<{
  tokenId: string
  conversationId: string
  expiresAt: number
  scopes: readonly LocalControlScope[]
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
  consumeBytes(bytes: number): boolean
  release(): void
}>

export type AgentCliRequestBeginResult =
  | Readonly<{ status: 'granted'; grant: AgentCliRequestGrant }>
  | Readonly<{ status: 'invalid' | 'expired' | 'quota-exhausted' }>

export type AgentCliTokenAuthorityOptions = Readonly<{
  now?: () => number
  createToken?: () => string
  createTokenId?: () => string
  maxTokens?: number
  maxTokensPerConversation?: number
}>

type TokenRecord = {
  digest: string
  claims: AgentCliTokenClaims
  maxCalls: number
  maxBytes: number
  usedCalls: number
  usedBytes: number
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
  if (normalized.length === 0 || normalized.length > 128) {
    throw new Error('conversationId must contain 1 to 128 characters')
  }
  return normalized
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
    const expiresAt = issuedAt + ttlMs
    const claims: AgentCliTokenClaims = {
      tokenId,
      conversationId,
      expiresAt,
      scopes
    }
    const digest = tokenDigest(token)
    const controller = new AbortController()
    const expiryTimer = setTimeout(() => this.removeRecord(digest, 'expired'), ttlMs)
    expiryTimer.unref()
    const record: TokenRecord = {
      digest,
      claims,
      maxCalls,
      maxBytes,
      usedCalls: 0,
      usedBytes: 0,
      activeRequests: 0,
      issuedAt,
      controller,
      expiryTimer
    }
    this.recordsByDigest.set(digest, record)
    this.recordsById.set(tokenId, record)
    const conversationTokens = this.digestsByConversation.get(conversationId) ?? new Set<string>()
    conversationTokens.add(digest)
    this.digestsByConversation.set(conversationId, conversationTokens)

    return { token, ...claims, maxCalls, maxBytes }
  }

  beginRequest(token: string): AgentCliRequestBeginResult {
    const parsedToken = LocalControlTokenSchema.safeParse(token)
    if (!parsedToken.success) return { status: 'invalid' }
    const digest = tokenDigest(parsedToken.data)
    const record = this.recordsByDigest.get(digest)
    if (!record) return { status: 'invalid' }
    if (record.claims.expiresAt <= this.now()) {
      this.removeRecord(digest, 'expired')
      return { status: 'expired' }
    }
    if (record.usedCalls >= record.maxCalls || record.usedBytes >= record.maxBytes) {
      return { status: 'quota-exhausted' }
    }

    record.usedCalls += 1
    record.activeRequests += 1
    let released = false
    return {
      status: 'granted',
      grant: {
        claims: record.claims,
        signal: record.controller.signal,
        consumeBytes: (bytes) => this.consumeRecordBytes(record, bytes),
        release: () => {
          if (released) return
          released = true
          record.activeRequests = Math.max(0, record.activeRequests - 1)
        }
      }
    }
  }

  consumeBytes(tokenId: string, bytes: number): boolean {
    const record = this.recordsById.get(tokenId)
    return record ? this.consumeRecordBytes(record, bytes) : false
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

  private consumeRecordBytes(record: TokenRecord, bytes: number): boolean {
    if (!Number.isSafeInteger(bytes) || bytes < 0) {
      throw new Error('Agent CLI byte usage must be a non-negative safe integer')
    }
    if (this.recordsByDigest.get(record.digest) !== record) return false
    if (record.claims.expiresAt <= this.now()) {
      this.removeRecord(record.digest, 'expired')
      return false
    }
    if (bytes > record.maxBytes - record.usedBytes) {
      record.usedBytes = record.maxBytes
      return false
    }
    record.usedBytes += bytes
    return true
  }

  private enforceConversationCapacity(conversationId: string): void {
    const conversationTokens = this.digestsByConversation.get(conversationId)
    if (!conversationTokens || conversationTokens.size < this.maxTokensPerConversation) return
    const oldest = [...conversationTokens]
      .map((digest) => this.recordsByDigest.get(digest))
      .filter((record): record is TokenRecord => Boolean(record))
      .sort(
        (left, right) =>
          left.issuedAt - right.issuedAt || left.claims.tokenId.localeCompare(right.claims.tokenId)
      )[0]
    if (oldest) this.removeRecord(oldest.digest, 'replaced')
  }

  private pruneRetired(now: number): void {
    for (const record of this.recordsByDigest.values()) {
      if (record.claims.expiresAt <= now) {
        this.removeRecord(record.digest, 'expired')
        continue
      }
      if (
        record.activeRequests === 0 &&
        (record.usedCalls >= record.maxCalls || record.usedBytes >= record.maxBytes)
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
