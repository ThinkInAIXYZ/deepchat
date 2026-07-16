import { nanoid } from 'nanoid'
import type * as schema from '@agentclientprotocol/sdk/dist/schema/index.js'
import type { AcpAgentConfig } from '@shared/types/acp'
import type { PermissionRequestPayload } from '@shared/types/core/llm-events'
import type { AcpPermissionPresentationPort } from '@/agent/acp/instance/ports'

const DEFAULT_PERMISSION_TIMEOUT_MS = 60_000

interface PendingPermission {
  requestId: string
  remoteSessionId: string
  request: schema.RequestPermissionRequest
  resolve: (response: schema.RequestPermissionResponse) => void
  timeout: ReturnType<typeof setTimeout>
}

export interface AcpPermissionBridgeOptions {
  presentation: AcpPermissionPresentationPort
  timeoutMs?: number
  createRequestId?: () => string
}

interface AcpPermissionContext {
  providerId: 'acp'
  providerName: string
  conversationId: string
  agent: AcpAgentConfig
}

export class AcpPermissionBridge {
  private readonly pending = new Map<string, PendingPermission>()
  private readonly timeoutMs: number
  private readonly createRequestId: () => string

  constructor(private readonly options: AcpPermissionBridgeOptions) {
    this.timeoutMs = Math.max(0, options.timeoutMs ?? DEFAULT_PERMISSION_TIMEOUT_MS)
    this.createRequestId = options.createRequestId ?? nanoid
  }

  request(
    request: schema.RequestPermissionRequest,
    context: AcpPermissionContext
  ): Promise<schema.RequestPermissionResponse> {
    const requestId = this.createRequestId()
    const promise = new Promise<schema.RequestPermissionResponse>((resolve) => {
      const timeout = setTimeout(() => {
        this.cancel(requestId)
      }, this.timeoutMs)
      this.pending.set(requestId, {
        requestId,
        remoteSessionId: request.sessionId,
        request,
        resolve,
        timeout
      })
    })

    try {
      this.options.presentation.present(this.buildPayload(requestId, request, context))
    } catch (error) {
      console.warn('[ACP] Failed to present permission request:', error)
      this.cancel(requestId)
    }
    return promise
  }

  resolve(requestId: string, granted: boolean): boolean {
    const state = this.take(requestId)
    if (!state) return false

    const option = this.pickOption(state.request.options, granted)
    state.resolve(
      option
        ? { outcome: { outcome: 'selected', optionId: option.optionId } }
        : { outcome: { outcome: 'cancelled' } }
    )
    this.settlePresentation(requestId, granted && Boolean(option))
    return true
  }

  cancel(requestId: string): boolean {
    const state = this.take(requestId)
    if (!state) return false
    state.resolve({ outcome: { outcome: 'cancelled' } })
    this.settlePresentation(requestId, false)
    return true
  }

  cancelSession(remoteSessionId: string): number {
    const requestIds = [...this.pending.values()]
      .filter((state) => state.remoteSessionId === remoteSessionId)
      .map((state) => state.requestId)
    requestIds.forEach((requestId) => this.cancel(requestId))
    return requestIds.length
  }

  close(): void {
    for (const requestId of this.pending.keys()) {
      this.cancel(requestId)
    }
  }

  private take(requestId: string): PendingPermission | undefined {
    const state = this.pending.get(requestId)
    if (!state) return undefined
    this.pending.delete(requestId)
    clearTimeout(state.timeout)
    return state
  }

  private settlePresentation(requestId: string, granted: boolean): void {
    try {
      this.options.presentation.settle(requestId, granted)
    } catch (error) {
      console.warn('[ACP] Failed to settle permission presentation:', error)
    }
  }

  private pickOption(
    options: schema.PermissionOption[],
    granted: boolean
  ): schema.PermissionOption | null {
    const order: schema.PermissionOption['kind'][] = granted
      ? ['allow_once', 'allow_always']
      : ['reject_once', 'reject_always']
    for (const kind of order) {
      const option = options.find((candidate) => candidate.kind === kind)
      if (option) return option
    }
    return null
  }

  private buildPayload(
    requestId: string,
    request: schema.RequestPermissionRequest,
    context: AcpPermissionContext
  ): PermissionRequestPayload {
    const permissionType = this.mapPermissionType(request.toolCall.kind)
    const toolName = request.toolCall.title?.trim() || request.toolCall.toolCallId
    const command = this.extractCommand(request.toolCall)
    return {
      providerId: context.providerId,
      providerName: context.providerName,
      requestId,
      sessionId: request.sessionId,
      conversationId: context.conversationId,
      agentId: context.agent.id,
      agentName: context.agent.name,
      tool_call_id: request.toolCall.toolCallId,
      tool_call_name: toolName,
      tool_call_params: this.summarizeToolCallParams(request.toolCall),
      description: `components.messageBlockPermissionRequest.description.${permissionType}`,
      permissionType,
      server_name: context.agent.name,
      server_description: context.agent.command,
      ...(command ? { command } : {}),
      options: request.options.map((option) => ({
        optionId: option.optionId,
        kind: option.kind,
        name: option.name
      })),
      metadata: { rememberable: false }
    }
  }

  private summarizeToolCallParams(
    toolCall: schema.RequestPermissionRequest['toolCall']
  ): string {
    if (toolCall.locations?.length) {
      return [...new Set(toolCall.locations.map((location) => location.path))].slice(0, 3).join(', ')
    }
    if (toolCall.rawInput && Object.keys(toolCall.rawInput).length > 0) {
      try {
        return JSON.stringify(toolCall.rawInput)
      } catch {}
    }
    return toolCall.toolCallId
  }

  private extractCommand(
    toolCall: schema.RequestPermissionRequest['toolCall']
  ): string | undefined {
    if (!toolCall.rawInput || typeof toolCall.rawInput !== 'object') return undefined
    const command = (toolCall.rawInput as Record<string, unknown>).command
    return typeof command === 'string' && command.trim() ? command.trim() : undefined
  }

  private mapPermissionType(kind?: schema.ToolKind | null): 'read' | 'write' | 'all' | 'command' {
    switch (kind) {
      case 'read':
      case 'fetch':
      case 'search':
        return 'read'
      case 'edit':
      case 'delete':
      case 'move':
        return 'write'
      case 'execute':
        return 'command'
      default:
        return 'all'
    }
  }
}
