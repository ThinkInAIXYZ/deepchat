import type { PermissionMode } from '@shared/types/agent-interface'
import type { ToolPermissionPreCheckResult } from '@shared/types/tool'
import {
  ApprovalBroker,
  ApprovalCapacityError,
  type ApprovalMatch,
  type ApprovalSnapshot
} from '@/approval'

const MAX_PENDING_PER_CONVERSATION = 64
const DEFAULT_REQUEST_TIMEOUT_MS = 2 * 60_000
const TOOL_APPROVAL_DOMAIN = 'tool-permission'
const TOOL_APPROVAL_OPERATION = 'tool.execute'

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

export type ToolPermissionBrokerOptions = Readonly<{
  approvalBroker?: ApprovalBroker
  timeoutMs?: number
}>

type ToolApprovalMetadata = Readonly<{
  conversationId: string
  serverId: string
  configGeneration?: number
  bindingHash?: string
  serverName: string
  toolName: string
  executionId?: string
  source: ToolPermissionSource
  permissionType: 'read' | 'write'
  approvalMode: 'permission_mode' | 'explicit_user'
  description?: string
}>

function toolScopeKey(conversationId: string): string {
  return `tool:${conversationId}`
}

function toolBindingKey(context: ToolPermissionContext): string {
  if (
    context.configGeneration !== undefined &&
    (!Number.isSafeInteger(context.configGeneration) || context.configGeneration <= 0)
  ) {
    throw new Error('Tool permission config generation must be a positive safe integer')
  }
  return JSON.stringify([
    context.serverId,
    context.configGeneration === undefined
      ? ['config-generation-absent']
      : ['config-generation-present', context.configGeneration],
    context.bindingHash === undefined
      ? ['binding-hash-absent']
      : ['binding-hash-present', context.bindingHash],
    context.toolName,
    context.executionId === undefined
      ? ['execution-id-absent']
      : ['execution-id-present', context.executionId],
    context.source,
    context.permissionType,
    context.approvalMode ?? 'permission_mode'
  ])
}

function toMetadata(context: ToolPermissionContext): ToolApprovalMetadata {
  return {
    conversationId: context.conversationId,
    serverId: context.serverId,
    configGeneration: context.configGeneration,
    bindingHash: context.bindingHash,
    serverName: context.serverName,
    toolName: context.toolName,
    executionId: context.executionId,
    source: context.source,
    permissionType: context.permissionType,
    approvalMode: context.approvalMode ?? 'permission_mode',
    description: context.description
  }
}

export class ToolPermissionBroker {
  private readonly approvals: ApprovalBroker
  private readonly timeoutMs: number

  constructor(options: number | ToolPermissionBrokerOptions = {}) {
    const normalized = typeof options === 'number' ? { timeoutMs: options } : options
    this.timeoutMs = normalized.timeoutMs ?? DEFAULT_REQUEST_TIMEOUT_MS
    this.approvals =
      normalized.approvalBroker ??
      new ApprovalBroker({
        defaultTimeoutMs: this.timeoutMs,
        maxPendingPerScope: MAX_PENDING_PER_CONVERSATION
      })
  }

  evaluateModel(
    context: ToolPermissionContext,
    signal?: AbortSignal
  ): ToolPermissionPreCheckResult | null {
    if (context.permissionMode === 'full_access' && context.approvalMode !== 'explicit_user') {
      return null
    }

    return this.toPermissionRequest(this.createPending(context, signal))
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

    if (this.approvals.consumeApproved(this.toMatch(context))) return { allowed: true }
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
    const appContext = { ...context, source: 'mcp-app' as const }
    const pending = this.createPending(appContext)
    const decision = this.approvals.wait(pending.requestId)
    try {
      onRequest(this.toPermissionRequest(pending))
    } catch {
      this.approvals.resolve({
        requestId: pending.requestId,
        scopeKey: toolScopeKey(context.conversationId),
        decision: 'denied'
      })
    }
    return await decision
  }

  approve(requestId: string, conversationId: string): boolean {
    return this.approvals.resolve({
      requestId,
      scopeKey: toolScopeKey(conversationId),
      decision: 'approved'
    })
  }

  deny(requestId: string, conversationId: string): boolean {
    return this.approvals.resolve({
      requestId,
      scopeKey: toolScopeKey(conversationId),
      decision: 'denied'
    })
  }

  cancel(requestId: string, conversationId: string): boolean {
    return this.approvals.resolve({
      requestId,
      scopeKey: toolScopeKey(conversationId),
      decision: 'cancelled'
    })
  }

  cancelConversation(conversationId: string): void {
    this.approvals.cancelScope(toolScopeKey(conversationId))
  }

  clear(): void {
    this.approvals.clearDomain(TOOL_APPROVAL_DOMAIN)
  }

  private createPending(
    context: ToolPermissionContext,
    signal?: AbortSignal
  ): ApprovalSnapshot<ToolApprovalMetadata> {
    try {
      return this.approvals.create(
        {
          domain: TOOL_APPROVAL_DOMAIN,
          scopeKey: toolScopeKey(context.conversationId),
          operation: TOOL_APPROVAL_OPERATION,
          effect: context.permissionType,
          bindingKey: toolBindingKey(context),
          arguments: context.arguments,
          metadata: toMetadata(context)
        },
        {
          deduplicatePending: true,
          includeArgumentsPreview: true,
          consumeOnApprove: context.source === 'mcp-app',
          timeoutMs: this.timeoutMs,
          signal
        }
      )
    } catch (error) {
      if (error instanceof ApprovalCapacityError) {
        throw new Error('Too many pending tool permission requests')
      }
      throw error
    }
  }

  private toMatch(context: ToolPermissionContext): ApprovalMatch {
    return {
      domain: TOOL_APPROVAL_DOMAIN,
      scopeKey: toolScopeKey(context.conversationId),
      operation: TOOL_APPROVAL_OPERATION,
      effect: context.permissionType,
      bindingKey: toolBindingKey(context),
      arguments: context.arguments
    }
  }

  private toPermissionRequest(
    pending: ApprovalSnapshot<ToolApprovalMetadata>
  ): ToolPermissionPreCheckResult {
    const metadata = pending.metadata
    return {
      needsPermission: true,
      requestId: pending.requestId,
      conversationId: metadata.conversationId,
      toolName: metadata.toolName,
      serverName: metadata.serverName,
      permissionType: metadata.permissionType,
      description:
        metadata.description ??
        `components.messageBlockPermissionRequest.description.${metadata.permissionType}`,
      rememberable: false,
      ...(metadata.approvalMode === 'explicit_user' ? { requiresUserConfirmation: true } : {}),
      source: metadata.source,
      serverId: metadata.serverId,
      configGeneration: metadata.configGeneration,
      bindingHash: metadata.bindingHash,
      argumentsHash: pending.argumentsHash,
      argumentsPreview: pending.argumentsPreview
    }
  }
}
