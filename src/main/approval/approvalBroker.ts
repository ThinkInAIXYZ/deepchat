import { createHash, randomUUID } from 'node:crypto'
import type { JsonValue } from '@shared/contracts/json'

const MAX_ARGUMENT_BYTES = 1024 * 1024
const MAX_REDACTED_DISPLAY_BYTES = 16 * 1024
const MAX_ARGUMENT_PREVIEW_BYTES = 16 * 1024
const MAX_ARGUMENT_DEPTH = 64
const MAX_ARGUMENT_KEYS = 10_000
const MAX_DOMAIN_BYTES = 128
const MAX_SCOPE_KEY_BYTES = 512
const MAX_OPERATION_BYTES = 256
const MAX_EFFECT_BYTES = 128
const MAX_BINDING_KEY_BYTES = 64 * 1024
const DEFAULT_MAX_PENDING_PER_SCOPE = 64
const DEFAULT_REQUEST_TIMEOUT_MS = 2 * 60_000

export type ApprovalDecision =
  | Readonly<{ allowed: true }>
  | Readonly<{ allowed: false; reason: 'denied' | 'cancelled' | 'timeout' }>

export type ApprovalResolution = Readonly<{
  requestId: string
  scopeKey: string
  decision: 'approved' | 'denied' | 'cancelled'
}>

export type ApprovalBinding<TMetadata = unknown> = Readonly<{
  domain: string
  scopeKey: string
  operation: string
  effect: string
  bindingKey: string
  arguments: unknown
  redactedDisplayData?: JsonValue
  metadata: TMetadata
}>

export type ApprovalCreateOptions = Readonly<{
  deduplicatePending?: boolean
  includeArgumentsPreview?: boolean
  consumeOnApprove?: boolean
  timeoutMs?: number
  signal?: AbortSignal
}>

export type ApprovalSnapshot<TMetadata = unknown> = Readonly<{
  requestId: string
  domain: string
  scopeKey: string
  operation: string
  effect: string
  argumentsHash: string
  argumentsPreview?: string
  redactedDisplayData?: JsonValue
  status: 'pending' | 'approved'
  expiresAt: number
  metadata: TMetadata
}>

export type ApprovalPublicSnapshot = Omit<ApprovalSnapshot<never>, 'metadata'>

export type ApprovalMatch = Readonly<{
  requestId?: string
  domain: string
  scopeKey: string
  operation: string
  effect: string
  bindingKey: string
  arguments: unknown
}>

export type ApprovalEvent =
  | Readonly<{ type: 'created'; approval: ApprovalPublicSnapshot }>
  | Readonly<{
      type: 'resolved'
      approval: ApprovalPublicSnapshot
      decision: ApprovalDecision
    }>
  | Readonly<{
      type: 'removed'
      approval: ApprovalPublicSnapshot
      reason: 'consumed' | 'denied' | 'cancelled' | 'timeout' | 'cleared'
    }>

export type ApprovalBrokerOptions = Readonly<{
  defaultTimeoutMs?: number
  maxPendingPerScope?: number
  now?: () => number
  createRequestId?: () => string
  log?: Pick<Console, 'warn'>
}>

type PendingApproval = {
  requestId: string
  domain: string
  scopeKey: string
  operation: string
  effect: string
  bindingKey: string
  argumentsHash: string
  argumentsPreview?: string
  redactedDisplayData?: JsonValue
  metadata: unknown
  status: 'pending' | 'approved'
  consumeOnApprove: boolean
  expiresAt: number
  timeout: NodeJS.Timeout
  settlers: Set<(decision: ApprovalDecision) => void>
  abortCleanups: Set<() => void>
}

type CanonicalizeState = {
  keys: number
  seen: WeakSet<object>
}

export class ApprovalCapacityError extends Error {
  constructor(readonly scopeKey: string) {
    super('Too many pending approval requests for scope')
    this.name = 'ApprovalCapacityError'
  }
}

function canonicalize(value: unknown, state: CanonicalizeState, depth = 0): unknown {
  if (depth > MAX_ARGUMENT_DEPTH) {
    throw new Error('Approval arguments exceed the depth limit')
  }
  if (Array.isArray(value)) {
    if (state.seen.has(value)) throw new Error('Approval arguments must not contain cycles')
    state.seen.add(value)
    const output = value.map((entry) => canonicalize(entry, state, depth + 1))
    state.seen.delete(value)
    return output
  }

  if (value && typeof value === 'object') {
    if (state.seen.has(value)) throw new Error('Approval arguments must not contain cycles')
    state.seen.add(value)
    const output = Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))
        .map(([key, entry]) => {
          state.keys += 1
          if (state.keys > MAX_ARGUMENT_KEYS) {
            throw new Error('Approval arguments exceed the key limit')
          }
          return [key, canonicalize(entry, state, depth + 1)]
        })
    )
    state.seen.delete(value)
    return output
  }

  if (
    value !== null &&
    typeof value !== 'string' &&
    typeof value !== 'number' &&
    typeof value !== 'boolean' &&
    value !== undefined
  ) {
    throw new Error('Approval arguments must be JSON-compatible')
  }
  if (typeof value === 'number' && !Number.isFinite(value)) {
    throw new Error('Approval arguments must contain only finite numbers')
  }
  return value
}

function serializeArguments(value: unknown): {
  hash: string
  preview: string
} {
  const serialized =
    JSON.stringify(canonicalize(value, { keys: 0, seen: new WeakSet<object>() })) ?? 'null'
  const bytes = Buffer.byteLength(serialized, 'utf8')
  if (bytes > MAX_ARGUMENT_BYTES) {
    throw new Error(`Approval arguments exceed the ${MAX_ARGUMENT_BYTES}-byte limit`)
  }

  return {
    hash: createHash('sha256').update(serialized).digest('hex'),
    preview:
      bytes <= MAX_ARGUMENT_PREVIEW_BYTES
        ? serialized
        : `${Buffer.from(serialized).subarray(0, MAX_ARGUMENT_PREVIEW_BYTES).toString('utf8')}…`
  }
}

function canonicalizeRedactedDisplayData(value: JsonValue | undefined): JsonValue | undefined {
  if (value === undefined) return undefined
  const canonical = canonicalize(value, { keys: 0, seen: new WeakSet<object>() })
  const serialized = JSON.stringify(canonical)
  if (
    serialized === undefined ||
    Buffer.byteLength(serialized, 'utf8') > MAX_REDACTED_DISPLAY_BYTES
  ) {
    throw new Error('Redacted approval display data exceeds its byte limit')
  }
  return JSON.parse(serialized) as JsonValue
}

function cloneJsonValue(value: JsonValue): JsonValue {
  return structuredClone(value)
}

function positiveSafeInteger(value: number, name: string): number {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new Error(`${name} must be a positive safe integer`)
  }
  return value
}

function boundedString(value: string, name: string, maxBytes: number): string {
  if (!value.trim()) throw new Error(`${name} must not be empty`)
  if (Buffer.byteLength(value, 'utf8') > maxBytes) {
    throw new Error(`${name} exceeds its byte limit`)
  }
  return value
}

export function hashApprovalArguments(value: unknown): string {
  return serializeArguments(value).hash
}

export class ApprovalBroker {
  private readonly defaultTimeoutMs: number
  private readonly maxPendingPerScope: number
  private readonly now: () => number
  private readonly createRequestId: () => string
  private readonly log: Pick<Console, 'warn'>
  private readonly pending = new Map<string, PendingApproval>()
  private readonly listeners = new Set<(event: ApprovalEvent) => void>()

  constructor(options: ApprovalBrokerOptions = {}) {
    this.defaultTimeoutMs = positiveSafeInteger(
      options.defaultTimeoutMs ?? DEFAULT_REQUEST_TIMEOUT_MS,
      'defaultTimeoutMs'
    )
    this.maxPendingPerScope = positiveSafeInteger(
      options.maxPendingPerScope ?? DEFAULT_MAX_PENDING_PER_SCOPE,
      'maxPendingPerScope'
    )
    this.now = options.now ?? Date.now
    this.createRequestId = options.createRequestId ?? randomUUID
    this.log = options.log ?? console
  }

  create<TMetadata>(
    binding: ApprovalBinding<TMetadata>,
    options: ApprovalCreateOptions = {}
  ): ApprovalSnapshot<TMetadata> {
    options.signal?.throwIfAborted()
    this.pruneExpired()
    const serialized = serializeArguments(binding.arguments)
    const domain = boundedString(binding.domain, 'Approval domain', MAX_DOMAIN_BYTES)
    const scopeKey = boundedString(binding.scopeKey, 'Approval scope key', MAX_SCOPE_KEY_BYTES)
    const operation = boundedString(binding.operation, 'Approval operation', MAX_OPERATION_BYTES)
    const effect = boundedString(binding.effect, 'Approval effect', MAX_EFFECT_BYTES)
    const bindingKey = boundedString(
      binding.bindingKey,
      'Approval binding key',
      MAX_BINDING_KEY_BYTES
    )

    if (options.deduplicatePending) {
      const existing = Array.from(this.pending.values()).find(
        (entry) =>
          entry.status === 'pending' &&
          entry.domain === domain &&
          entry.scopeKey === scopeKey &&
          entry.operation === operation &&
          entry.effect === effect &&
          entry.bindingKey === bindingKey &&
          entry.argumentsHash === serialized.hash
      )
      if (existing) {
        this.attachAbort(existing, options.signal)
        options.signal?.throwIfAborted()
        return this.toSnapshot(existing) as ApprovalSnapshot<TMetadata>
      }
    }

    const scopePending = Array.from(this.pending.values()).filter(
      (entry) => entry.scopeKey === scopeKey
    ).length
    if (scopePending >= this.maxPendingPerScope) throw new ApprovalCapacityError(scopeKey)

    const timeoutMs = positiveSafeInteger(
      options.timeoutMs ?? this.defaultTimeoutMs,
      'approval timeoutMs'
    )
    const now = this.now()
    if (!Number.isSafeInteger(now) || now < 0 || now > Number.MAX_SAFE_INTEGER - timeoutMs) {
      throw new Error('Approval clock is outside the supported range')
    }
    const requestId = this.allocateRequestId()
    const pending: PendingApproval = {
      requestId,
      domain,
      scopeKey,
      operation,
      effect,
      bindingKey,
      argumentsHash: serialized.hash,
      ...(options.includeArgumentsPreview ? { argumentsPreview: serialized.preview } : {}),
      ...(binding.redactedDisplayData !== undefined
        ? { redactedDisplayData: canonicalizeRedactedDisplayData(binding.redactedDisplayData) }
        : {}),
      metadata: binding.metadata,
      status: 'pending',
      consumeOnApprove: options.consumeOnApprove ?? false,
      expiresAt: now + timeoutMs,
      settlers: new Set(),
      abortCleanups: new Set(),
      timeout: setTimeout(() => this.expire(requestId), timeoutMs)
    }
    pending.timeout.unref()
    this.pending.set(requestId, pending)
    this.attachAbort(pending, options.signal)
    options.signal?.throwIfAborted()
    this.emit({ type: 'created', approval: this.toPublicSnapshot(pending) })
    return this.toSnapshot(pending) as ApprovalSnapshot<TMetadata>
  }

  async wait(requestId: string, signal?: AbortSignal): Promise<ApprovalDecision> {
    this.pruneExpired()
    const pending = this.pending.get(requestId)
    if (!pending) return { allowed: false, reason: 'cancelled' }
    if (signal?.aborted) {
      this.resolve({ requestId, scopeKey: pending.scopeKey, decision: 'cancelled' })
      return { allowed: false, reason: 'cancelled' }
    }
    if (pending.status === 'approved') {
      if (pending.consumeOnApprove) this.deletePending(pending, 'consumed')
      return { allowed: true }
    }

    return await new Promise<ApprovalDecision>((resolve) => {
      pending.settlers.add(resolve)
      this.attachAbort(pending, signal)
    })
  }

  resolve(resolution: ApprovalResolution): boolean {
    this.pruneExpired()
    const pending = this.pending.get(resolution.requestId)
    if (!pending || pending.scopeKey !== resolution.scopeKey) return false

    if (resolution.decision === 'approved') {
      if (pending.status !== 'pending') return false
      pending.status = 'approved'
      const decision = { allowed: true } as const
      const hadWaiters = pending.settlers.size > 0
      this.settle(pending, decision)
      this.emit({
        type: 'resolved',
        approval: this.toPublicSnapshot(pending),
        decision
      })
      if (pending.consumeOnApprove && hadWaiters) this.deletePending(pending, 'consumed')
      return true
    }

    const decision: ApprovalDecision = {
      allowed: false,
      reason: resolution.decision === 'denied' ? 'denied' : 'cancelled'
    }
    this.settle(pending, decision)
    this.emit({
      type: 'resolved',
      approval: this.toPublicSnapshot(pending),
      decision
    })
    this.deletePending(pending, decision.reason)
    return true
  }

  consumeApproved(match: ApprovalMatch): boolean {
    this.pruneExpired()
    const argumentsHash = hashApprovalArguments(match.arguments)
    const approved = Array.from(this.pending.values()).find(
      (entry) =>
        entry.status === 'approved' &&
        (match.requestId === undefined || entry.requestId === match.requestId) &&
        entry.domain === match.domain &&
        entry.scopeKey === match.scopeKey &&
        entry.operation === match.operation &&
        entry.effect === match.effect &&
        entry.bindingKey === match.bindingKey &&
        entry.argumentsHash === argumentsHash
    )
    if (!approved) return false
    this.deletePending(approved, 'consumed')
    return true
  }

  cancelScope(scopeKey: string): void {
    for (const pending of Array.from(this.pending.values())) {
      if (pending.scopeKey === scopeKey) {
        this.resolve({
          requestId: pending.requestId,
          scopeKey,
          decision: 'cancelled'
        })
      }
    }
  }

  clearDomain(domain: string): void {
    this.clearMatching((pending) => pending.domain === domain)
  }

  clear(): void {
    this.clearMatching(() => true)
  }

  subscribe(listener: (event: ApprovalEvent) => void): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  private clearMatching(predicate: (pending: PendingApproval) => boolean): void {
    for (const pending of Array.from(this.pending.values())) {
      if (!predicate(pending)) continue
      const decision = { allowed: false, reason: 'cancelled' } as const
      this.settle(pending, decision)
      this.emit({
        type: 'resolved',
        approval: this.toPublicSnapshot(pending),
        decision
      })
      this.deletePending(pending, 'cleared')
    }
  }

  private allocateRequestId(): string {
    for (let attempt = 0; attempt < 8; attempt += 1) {
      const requestId = this.createRequestId()
      if (!/^[A-Za-z0-9_-]{16,128}$/.test(requestId)) {
        throw new Error('Approval request ID generator returned an invalid identifier')
      }
      if (!this.pending.has(requestId)) return requestId
    }
    throw new Error('Unable to allocate a unique approval request ID')
  }

  private expire(requestId: string): void {
    const pending = this.pending.get(requestId)
    if (!pending) return
    if (pending.status === 'pending') {
      const decision = { allowed: false, reason: 'timeout' } as const
      this.settle(pending, decision)
      this.emit({
        type: 'resolved',
        approval: this.toPublicSnapshot(pending),
        decision
      })
    }
    this.deletePending(pending, 'timeout')
  }

  private pruneExpired(): void {
    const now = this.now()
    for (const pending of Array.from(this.pending.values())) {
      if (pending.expiresAt <= now) this.expire(pending.requestId)
    }
  }

  private attachAbort(pending: PendingApproval, signal?: AbortSignal): void {
    if (!signal) return
    const onAbort = () => {
      if (this.pending.get(pending.requestId) !== pending) return
      this.resolve({
        requestId: pending.requestId,
        scopeKey: pending.scopeKey,
        decision: 'cancelled'
      })
    }
    signal.addEventListener('abort', onAbort, { once: true })
    pending.abortCleanups.add(() => signal.removeEventListener('abort', onAbort))
    if (signal.aborted) onAbort()
  }

  private settle(pending: PendingApproval, decision: ApprovalDecision): void {
    for (const settle of pending.settlers) settle(decision)
    pending.settlers.clear()
  }

  private deletePending(
    pending: PendingApproval,
    reason: Extract<ApprovalEvent, { type: 'removed' }>['reason']
  ): void {
    if (this.pending.get(pending.requestId) !== pending) return
    clearTimeout(pending.timeout)
    for (const cleanup of pending.abortCleanups) cleanup()
    pending.abortCleanups.clear()
    this.pending.delete(pending.requestId)
    this.emit({ type: 'removed', approval: this.toPublicSnapshot(pending), reason })
  }

  private toSnapshot(pending: PendingApproval): ApprovalSnapshot {
    return {
      requestId: pending.requestId,
      domain: pending.domain,
      scopeKey: pending.scopeKey,
      operation: pending.operation,
      effect: pending.effect,
      argumentsHash: pending.argumentsHash,
      ...(pending.argumentsPreview !== undefined
        ? { argumentsPreview: pending.argumentsPreview }
        : {}),
      ...(pending.redactedDisplayData !== undefined
        ? { redactedDisplayData: cloneJsonValue(pending.redactedDisplayData) }
        : {}),
      status: pending.status,
      expiresAt: pending.expiresAt,
      metadata: pending.metadata
    }
  }

  private toPublicSnapshot(pending: PendingApproval): ApprovalPublicSnapshot {
    const { metadata: _metadata, ...approval } = this.toSnapshot(pending)
    return approval
  }

  private emit(event: ApprovalEvent): void {
    queueMicrotask(() => {
      for (const listener of this.listeners) {
        try {
          listener(event)
        } catch (error) {
          this.log.warn('[ApprovalBroker] Subscriber failed', {
            type: event.type,
            domain: event.approval.domain,
            operation: event.approval.operation,
            failure: { name: error instanceof Error ? error.name : typeof error }
          })
        }
      }
    })
  }
}
