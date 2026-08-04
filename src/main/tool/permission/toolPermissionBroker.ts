import type { PermissionMode } from '@shared/types/agent-interface'
import type { ToolPermissionPreCheckResult } from '@shared/types/tool'
import { createHash, randomUUID } from 'node:crypto'

const MAX_ARGUMENT_BYTES = 1024 * 1024
const MAX_ARGUMENT_PREVIEW_BYTES = 16 * 1024
const MAX_ARGUMENT_DEPTH = 64
const MAX_ARGUMENT_KEYS = 10_000
const MAX_PENDING_PER_CONVERSATION = 64
const DEFAULT_REQUEST_TIMEOUT_MS = 2 * 60 * 1000

export type ToolPermissionSource = 'model' | 'mcp-app'

export interface ToolPermissionContext {
  conversationId: string
  serverId: string
  configGeneration?: number
  bindingHash?: string
  serverName: string
  toolName: string
  executionId?: string
  arguments: unknown
  source: ToolPermissionSource
  permissionType: 'read' | 'write'
  permissionMode?: PermissionMode
  approvalMode?: 'permission_mode' | 'explicit_user'
  description?: string
}

export interface ToolPermissionDecision {
  allowed: boolean
  reason?: 'denied' | 'cancelled' | 'timeout'
}

type PendingPermission = {
  requestId: string
  conversationId: string
  serverId: string
  configGeneration?: number
  bindingHash?: string
  serverName: string
  toolName: string
  executionId?: string
  argumentsHash: string
  argumentsPreview: string
  source: ToolPermissionSource
  permissionType: 'read' | 'write'
  approvalMode: 'permission_mode' | 'explicit_user'
  description?: string
  status: 'pending' | 'approved'
  expiresAt: number
  timeout: NodeJS.Timeout
  settlers: Set<(decision: ToolPermissionDecision) => void>
  abortCleanups: Set<() => void>
}

type CanonicalizeState = {
  keys: number
  seen: WeakSet<object>
}

const canonicalize = (value: unknown, state: CanonicalizeState, depth = 0): unknown => {
  if (depth > MAX_ARGUMENT_DEPTH) {
    throw new Error('Tool arguments exceed the permission depth limit')
  }
  if (Array.isArray(value)) {
    if (state.seen.has(value)) {
      throw new Error('Tool arguments must not contain cycles')
    }
    state.seen.add(value)
    const output = value.map((entry) => canonicalize(entry, state, depth + 1))
    state.seen.delete(value)
    return output
  }

  if (value && typeof value === 'object') {
    if (state.seen.has(value)) {
      throw new Error('Tool arguments must not contain cycles')
    }
    state.seen.add(value)
    const output = Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))
        .map(([key, entry]) => {
          state.keys += 1
          if (state.keys > MAX_ARGUMENT_KEYS) {
            throw new Error('Tool arguments exceed the permission key limit')
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
    throw new Error('Tool arguments must be JSON-compatible')
  }
  if (typeof value === 'number' && !Number.isFinite(value)) {
    throw new Error('Tool arguments must contain only finite numbers')
  }
  return value
}

const serializeArguments = (value: unknown): { hash: string; preview: string } => {
  const serialized =
    JSON.stringify(canonicalize(value, { keys: 0, seen: new WeakSet<object>() })) ?? 'null'
  const bytes = Buffer.byteLength(serialized, 'utf8')
  if (bytes > MAX_ARGUMENT_BYTES) {
    throw new Error(`Tool arguments exceed the ${MAX_ARGUMENT_BYTES}-byte permission limit`)
  }

  const preview =
    bytes <= MAX_ARGUMENT_PREVIEW_BYTES
      ? serialized
      : `${Buffer.from(serialized).subarray(0, MAX_ARGUMENT_PREVIEW_BYTES).toString('utf8')}…`

  return {
    hash: createHash('sha256').update(serialized).digest('hex'),
    preview
  }
}

export class ToolPermissionBroker {
  private readonly pending = new Map<string, PendingPermission>()

  constructor(private readonly timeoutMs = DEFAULT_REQUEST_TIMEOUT_MS) {}

  evaluateModel(
    context: ToolPermissionContext,
    signal?: AbortSignal
  ): ToolPermissionPreCheckResult | null {
    if (context.permissionMode === 'full_access' && context.approvalMode !== 'explicit_user') {
      return null
    }

    const pending = this.createPending(context, signal)
    return this.toPermissionRequest(pending)
  }

  authorizeExecution(
    context: ToolPermissionContext,
    signal?: AbortSignal
  ): { allowed: true } | { allowed: false; request: ToolPermissionPreCheckResult } {
    signal?.throwIfAborted()
    if (
      context.source === 'model' &&
      context.permissionMode === 'full_access' &&
      context.approvalMode !== 'explicit_user'
    ) {
      return { allowed: true }
    }

    const { hash } = serializeArguments(context.arguments)
    const approved = Array.from(this.pending.values()).find(
      (entry) =>
        entry.status === 'approved' &&
        entry.conversationId === context.conversationId &&
        entry.serverId === context.serverId &&
        entry.configGeneration === context.configGeneration &&
        entry.bindingHash === context.bindingHash &&
        entry.toolName === context.toolName &&
        entry.executionId === context.executionId &&
        entry.argumentsHash === hash &&
        entry.source === context.source &&
        entry.permissionType === context.permissionType &&
        entry.approvalMode === (context.approvalMode ?? 'permission_mode')
    )

    if (approved) {
      this.deletePending(approved.requestId)
      return { allowed: true }
    }

    const pending = this.createPending(context, signal)
    return { allowed: false, request: this.toPermissionRequest(pending) }
  }

  async requestAppDecision(
    context: Omit<ToolPermissionContext, 'source'>,
    onRequest: (request: ToolPermissionPreCheckResult) => void
  ): Promise<ToolPermissionDecision> {
    if (
      context.approvalMode !== 'explicit_user' &&
      (context.permissionMode === 'full_access' || context.permissionMode === 'auto_approve')
    ) {
      return { allowed: true }
    }
    const pending = this.createPending({ ...context, source: 'mcp-app' })
    try {
      onRequest(this.toPermissionRequest(pending))
    } catch {
      this.deletePending(pending.requestId)
      return { allowed: false, reason: 'denied' }
    }
    return await new Promise<ToolPermissionDecision>((resolve) => {
      pending.settlers.add(resolve)
    })
  }

  approve(requestId: string, conversationId: string): boolean {
    const pending = this.pending.get(requestId)
    if (
      !pending ||
      pending.status !== 'pending' ||
      pending.conversationId !== conversationId ||
      pending.expiresAt <= Date.now()
    ) {
      return false
    }

    if (pending.source === 'mcp-app') {
      this.settleAppPermission(pending, { allowed: true })
      this.deletePending(requestId)
      return true
    }

    pending.status = 'approved'
    return true
  }

  deny(requestId: string, conversationId: string): boolean {
    return this.resolveDenied(requestId, conversationId, 'denied')
  }

  cancel(requestId: string, conversationId: string): boolean {
    return this.resolveDenied(requestId, conversationId, 'cancelled')
  }

  cancelConversation(conversationId: string): void {
    for (const pending of this.pending.values()) {
      if (pending.conversationId === conversationId) {
        this.settleAppPermission(pending, { allowed: false, reason: 'cancelled' })
        this.deletePending(pending.requestId)
      }
    }
  }

  clear(): void {
    for (const pending of this.pending.values()) {
      this.settleAppPermission(pending, { allowed: false, reason: 'cancelled' })
      this.deletePending(pending.requestId)
    }
  }

  private createPending(context: ToolPermissionContext, signal?: AbortSignal): PendingPermission {
    signal?.throwIfAborted()
    this.pruneExpired()
    const { hash, preview } = serializeArguments(context.arguments)
    const existing = Array.from(this.pending.values()).find(
      (entry) =>
        entry.status === 'pending' &&
        entry.conversationId === context.conversationId &&
        entry.serverId === context.serverId &&
        entry.configGeneration === context.configGeneration &&
        entry.bindingHash === context.bindingHash &&
        entry.toolName === context.toolName &&
        entry.executionId === context.executionId &&
        entry.argumentsHash === hash &&
        entry.source === context.source &&
        entry.permissionType === context.permissionType &&
        entry.approvalMode === (context.approvalMode ?? 'permission_mode')
    )
    if (existing) {
      this.attachAbort(existing, signal)
      return existing
    }
    const conversationPending = Array.from(this.pending.values()).filter(
      (entry) => entry.conversationId === context.conversationId
    ).length
    if (conversationPending >= MAX_PENDING_PER_CONVERSATION) {
      throw new Error('Too many pending tool permission requests')
    }

    const requestId = randomUUID()
    const expiresAt = Date.now() + this.timeoutMs
    const pending: PendingPermission = {
      requestId,
      conversationId: context.conversationId,
      serverId: context.serverId,
      configGeneration: context.configGeneration,
      bindingHash: context.bindingHash,
      serverName: context.serverName,
      toolName: context.toolName,
      executionId: context.executionId,
      argumentsHash: hash,
      argumentsPreview: preview,
      source: context.source,
      permissionType: context.permissionType,
      approvalMode: context.approvalMode ?? 'permission_mode',
      description: context.description,
      status: 'pending',
      expiresAt,
      settlers: new Set(),
      abortCleanups: new Set(),
      timeout: setTimeout(() => {
        const current = this.pending.get(requestId)
        if (current) {
          this.settleAppPermission(current, { allowed: false, reason: 'timeout' })
        }
        this.deletePending(requestId)
      }, this.timeoutMs)
    }

    this.pending.set(requestId, pending)
    this.attachAbort(pending, signal)
    return pending
  }

  private toPermissionRequest(pending: PendingPermission): ToolPermissionPreCheckResult {
    return {
      needsPermission: true,
      requestId: pending.requestId,
      conversationId: pending.conversationId,
      toolName: pending.toolName,
      serverName: pending.serverName,
      permissionType: pending.permissionType,
      description:
        pending.description ??
        `components.messageBlockPermissionRequest.description.${pending.permissionType}`,
      rememberable: false,
      ...(pending.approvalMode === 'explicit_user' ? { requiresUserConfirmation: true } : {}),
      source: pending.source,
      serverId: pending.serverId,
      configGeneration: pending.configGeneration,
      bindingHash: pending.bindingHash,
      argumentsHash: pending.argumentsHash,
      argumentsPreview: pending.argumentsPreview
    }
  }

  private resolveDenied(
    requestId: string,
    conversationId: string,
    reason: 'denied' | 'cancelled'
  ): boolean {
    const pending = this.pending.get(requestId)
    if (!pending || pending.conversationId !== conversationId) {
      return false
    }

    this.settleAppPermission(pending, { allowed: false, reason })
    this.deletePending(requestId)
    return true
  }

  private deletePending(requestId: string): void {
    const pending = this.pending.get(requestId)
    if (!pending) {
      return
    }
    clearTimeout(pending.timeout)
    for (const cleanup of pending.abortCleanups) {
      cleanup()
    }
    pending.abortCleanups.clear()
    this.pending.delete(requestId)
  }

  private pruneExpired(): void {
    const now = Date.now()
    for (const pending of this.pending.values()) {
      if (pending.expiresAt <= now) {
        this.settleAppPermission(pending, { allowed: false, reason: 'timeout' })
        this.deletePending(pending.requestId)
      }
    }
  }

  private attachAbort(pending: PendingPermission, signal?: AbortSignal): void {
    if (!signal) {
      return
    }
    const onAbort = () => {
      if (this.pending.get(pending.requestId) !== pending) {
        return
      }
      this.settleAppPermission(pending, { allowed: false, reason: 'cancelled' })
      this.deletePending(pending.requestId)
    }
    signal.addEventListener('abort', onAbort, { once: true })
    pending.abortCleanups.add(() => signal.removeEventListener('abort', onAbort))
    if (signal.aborted) {
      onAbort()
    }
  }

  private settleAppPermission(pending: PendingPermission, decision: ToolPermissionDecision): void {
    for (const settle of pending.settlers) {
      settle(decision)
    }
    pending.settlers.clear()
  }
}
