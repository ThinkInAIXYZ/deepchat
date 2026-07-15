import type {
  AssistantMessageBlock,
  DeepChatSessionState,
  PermissionMode
} from '@shared/types/agent-interface'
import type { MCPToolCall, MCPToolResponse, ToolCallImagePreview } from '@shared/types/core/mcp'
import type { ToolExecutionPort, ToolResultPort } from '@/agent/deepchat/loop/ports'
import { awaitWithAbort } from '@/lib/awaitWithAbort'
import { extractToolCallImagePreviews } from '@/lib/toolCallImagePreviews'
import type { PendingToolInteraction } from './types'
import type { DeepChatToolResolver } from './toolResolver'
import { toolContentToText } from './toolAdapters'

export type DeferredToolExecutionResult = {
  responseText: string
  isError: boolean
  invoked?: boolean
  toolSource?: 'mcp' | 'agent'
  serverName?: string
  offloadPath?: string
  rtkApplied?: boolean
  rtkMode?: 'rewrite' | 'direct' | 'bypass'
  rtkFallbackReason?: string
  imagePreviews?: ToolCallImagePreview[]
  requiresPermission?: boolean
  permissionRequest?: PendingToolInteraction['permission']
  terminalError?: string
}

export interface DeferredToolExecutorDependencies {
  toolExecutionPort: ToolExecutionPort | null
  toolResultPort: ToolResultPort
  toolResolver: DeepChatToolResolver
  cacheImage?: (data: string) => Promise<string>
  registerAbortController(sessionId: string, toolCallId: string): AbortController
  clearAbortController(sessionId: string, toolCallId: string, controller?: AbortController): void
  getAbortSignal(sessionId: string): AbortSignal | undefined
  resolveProjectDir(sessionId: string): string | null
  getSessionState(sessionId: string): Promise<DeepChatSessionState | null>
  getRuntimeState(sessionId: string): DeepChatSessionState | undefined
  getSessionAgentId(sessionId: string): string | undefined
  updateSubagentProgress(
    sessionId: string,
    messageId: string,
    toolCallId: string,
    responseMarkdown: string,
    progressJson?: string,
    finalJson?: string
  ): void
}

function normalizePermissionMode(mode: PermissionMode | null | undefined): PermissionMode {
  return mode === 'auto_approve' || mode === 'full_access' ? mode : 'default'
}

function throwIfAbortRequested(signal?: AbortSignal): void {
  if (!signal?.aborted) return
  if (typeof DOMException !== 'undefined') {
    throw new DOMException('Aborted', 'AbortError')
  }
  const error = new Error('Aborted')
  error.name = 'AbortError'
  throw error
}

export class DeferredToolExecutor {
  constructor(private readonly dependencies: DeferredToolExecutorDependencies) {}

  async execute(
    sessionId: string,
    messageId: string,
    toolCall: NonNullable<AssistantMessageBlock['tool_call']>,
    onToolCallStarted?: () => void
  ): Promise<DeferredToolExecutionResult> {
    if (!this.dependencies.toolExecutionPort) {
      return {
        responseText: 'Tool presenter is not available.',
        isError: true
      }
    }

    const toolName = toolCall.name
    if (!toolName) {
      return {
        responseText: 'Invalid tool call without tool name.',
        isError: true
      }
    }

    const deferredAbortController = toolCall.id
      ? this.dependencies.registerAbortController(sessionId, toolCall.id)
      : null
    const deferredAbortSignal =
      deferredAbortController?.signal ?? this.dependencies.getAbortSignal(sessionId)
    let invoked = false

    try {
      throwIfAbortRequested(deferredAbortSignal)
      const projectDir = this.dependencies.resolveProjectDir(sessionId)
      const sessionState = await awaitWithAbort(
        this.dependencies.getSessionState(sessionId),
        deferredAbortSignal
      )
      const toolDefinitions = await awaitWithAbort(
        this.dependencies.toolResolver.loadToolDefinitionsForSession(sessionId, projectDir),
        deferredAbortSignal
      )
      throwIfAbortRequested(deferredAbortSignal)

      const toolDefinition = toolDefinitions.find((definition) => {
        if (definition.function.name !== toolName) {
          return false
        }
        if (toolCall.server_name) {
          return definition.server.name === toolCall.server_name
        }
        return true
      })

      if (!toolDefinition) {
        const disabledAgentTools = this.dependencies.toolResolver.getDisabledAgentTools(sessionId)
        return {
          responseText: disabledAgentTools.includes(toolName)
            ? `Tool '${toolName}' is disabled for the current session.`
            : `Tool '${toolName}' is no longer available in the current session.`,
          isError: true
        }
      }

      const request: MCPToolCall = {
        id: toolCall.id || '',
        type: 'function',
        function: {
          name: toolName,
          arguments: toolCall.params || '{}'
        },
        server: toolDefinition.server,
        conversationId: sessionId,
        providerId: sessionState?.providerId?.trim() || undefined
      }

      const extensionPolicy = await awaitWithAbort(
        this.dependencies.toolResolver.resolveAgentExtensionPolicy(sessionId),
        deferredAbortSignal
      )
      throwIfAbortRequested(deferredAbortSignal)
      const deferredPermissionMode = normalizePermissionMode(
        this.dependencies.getRuntimeState(sessionId)?.permissionMode
      )
      const deferredActiveSkillNames = await awaitWithAbort(
        this.dependencies.toolResolver.resolveActiveSkillNamesForToolProfile(sessionId),
        deferredAbortSignal
      )
      throwIfAbortRequested(deferredAbortSignal)
      invoked = true
      onToolCallStarted?.()
      const result = await this.dependencies.toolExecutionPort.execute(request, {
        agentId: this.dependencies.getSessionAgentId(sessionId) ?? 'deepchat',
        permissionMode: deferredPermissionMode,
        activeSkillNames: deferredActiveSkillNames,
        enabledSkillNames: extensionPolicy.enabledSkillNames ?? undefined,
        enabledMcpServerIds: this.dependencies.toolResolver.toToolDefinitionMcpServerIds(
          extensionPolicy.enabledMcpServerIds
        ),
        onProgress: (update) => {
          if (
            update.kind !== 'subagent_orchestrator' ||
            update.toolCallId !== (toolCall.id || '')
          ) {
            return
          }

          this.dependencies.updateSubagentProgress(
            sessionId,
            messageId,
            toolCall.id || '',
            update.responseMarkdown,
            update.progressJson
          )
        },
        signal: deferredAbortSignal
      })
      throwIfAbortRequested(deferredAbortSignal)
      const rawData = result.rawData as MCPToolResponse
      if (rawData.requiresPermission) {
        return {
          responseText: toolContentToText(rawData.content),
          isError: true,
          invoked,
          requiresPermission: true,
          permissionRequest: rawData.permissionRequest as PendingToolInteraction['permission']
        }
      }
      const subagentToolResult =
        rawData.toolResult && typeof rawData.toolResult === 'object'
          ? (rawData.toolResult as Record<string, unknown>)
          : null
      if (typeof subagentToolResult?.subagentProgress === 'string') {
        this.dependencies.updateSubagentProgress(
          sessionId,
          messageId,
          toolCall.id || '',
          toolContentToText(rawData.content),
          subagentToolResult.subagentProgress,
          typeof subagentToolResult.subagentFinal === 'string'
            ? subagentToolResult.subagentFinal
            : undefined
        )
      } else if (typeof subagentToolResult?.subagentFinal === 'string') {
        this.dependencies.updateSubagentProgress(
          sessionId,
          messageId,
          toolCall.id || '',
          toolContentToText(rawData.content),
          undefined,
          subagentToolResult.subagentFinal
        )
      }
      const imagePreviews =
        rawData.imagePreviews ??
        (await extractToolCallImagePreviews({
          toolName,
          toolArgs: toolCall.params || '{}',
          content: rawData.content,
          cacheImage: this.dependencies.cacheImage,
          signal: deferredAbortSignal
        }))
      throwIfAbortRequested(deferredAbortSignal)
      const normalizedContent = await this.dependencies.toolResultPort.normalize({
        sessionId,
        toolCallId: toolCall.id || '',
        toolName,
        toolArgs: toolCall.params || '{}',
        content: rawData.content,
        isError: rawData.isError === true,
        signal: deferredAbortSignal
      })
      throwIfAbortRequested(deferredAbortSignal)
      const responseText = toolContentToText(normalizedContent)
      const prepared = await awaitWithAbort(
        this.dependencies.toolResultPort.prepare({
          sessionId,
          toolCallId: toolCall.id || '',
          toolName,
          rawContent: responseText
        }),
        deferredAbortSignal
      )
      throwIfAbortRequested(deferredAbortSignal)
      if (prepared.kind === 'tool_error') {
        return {
          responseText: prepared.message,
          isError: true,
          invoked
        }
      }
      return {
        responseText: prepared.content,
        isError: Boolean(rawData.isError),
        invoked,
        toolSource: toolDefinition.source,
        serverName: toolDefinition.server.name,
        offloadPath: prepared.offloadPath,
        rtkApplied: rawData.rtkApplied,
        rtkMode: rawData.rtkMode,
        rtkFallbackReason: rawData.rtkFallbackReason,
        imagePreviews
      }
    } catch (error) {
      if (deferredAbortSignal?.aborted) {
        throw error
      }
      const errorText = error instanceof Error ? error.message : String(error)
      return {
        responseText: `Error: ${errorText}`,
        isError: true,
        invoked
      }
    } finally {
      if (toolCall.id) {
        this.dependencies.clearAbortController(
          sessionId,
          toolCall.id,
          deferredAbortController ?? undefined
        )
      }
    }
  }
}
