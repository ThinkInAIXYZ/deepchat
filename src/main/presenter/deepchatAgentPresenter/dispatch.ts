import { eventBus, SendTarget } from '@/eventbus'
import { STREAM_EVENTS } from '@/events'
import { presenter } from '@/presenter'
import type { SearchResult } from '@shared/presenter'
import type { MCPToolCall, MCPContentItem, MCPResourceContent } from '@shared/types/core/mcp'
import type { MCPToolDefinition } from '@shared/types/core/mcp'
import type { IToolPresenter } from '@shared/types/presenters/tool.presenter'
import type { AssistantMessageBlock, PermissionMode } from '@shared/types/agent-interface'
import { parseQuestionToolArgs, QUESTION_TOOL_NAME } from '../../lib/agentRuntime/questionTool'
import type { IoParams, PendingToolInteraction, ProcessHooks, StreamState } from './types'
import type { ChatMessage } from '@shared/types/core/chat-message'
import { nanoid } from 'nanoid'
import type { ToolOutputGuard } from './toolOutputGuard'

type PermissionType = 'read' | 'write' | 'all' | 'command'

type PermissionRequestLike = {
  toolName?: string
  serverName?: string
  permissionType?: PermissionType
  description?: string
  command?: string
  commandSignature?: string
  commandInfo?: {
    command: string
    riskLevel: 'low' | 'medium' | 'high' | 'critical'
    suggestion: string
    signature?: string
    baseCommand?: string
  }
  providerId?: string
  requestId?: string
  rememberable?: boolean
  paths?: string[]
}

function extractTextFromBlocks(blocks: AssistantMessageBlock[]): string {
  return blocks
    .filter((b) => b.type === 'content')
    .map((b) => b.content || '')
    .join('')
}

function extractReasoningFromBlocks(blocks: AssistantMessageBlock[]): string {
  return blocks
    .filter((b) => b.type === 'reasoning_content')
    .map((b) => b.content || '')
    .join('')
}

function requiresReasoningField(modelId: string): boolean {
  const lower = modelId.toLowerCase()
  return (
    lower.includes('deepseek-reasoner') ||
    lower.includes('kimi-k2-thinking') ||
    lower.includes('glm-4.7')
  )
}

function toolResponseToText(content: string | MCPContentItem[]): string {
  if (typeof content === 'string') return content
  return content
    .map((item) => {
      if (item.type === 'text') return item.text
      if (item.type === 'resource' && item.resource?.text) return item.resource.text
      return `[${item.type}]`
    })
    .join('\n')
}

function extractSearchPayload(
  content: string | MCPContentItem[],
  toolName?: string,
  serverName?: string
): { block: AssistantMessageBlock; results: SearchResult[] } | null {
  if (!Array.isArray(content)) {
    return null
  }

  const resourceItems = content.filter(
    (item): item is MCPResourceContent =>
      item.type === 'resource' && item.resource?.mimeType === 'application/deepchat-webpage'
  )
  if (resourceItems.length === 0) {
    return null
  }

  const results = resourceItems
    .map((item) => {
      const resource = item.resource
      if (!resource?.text) {
        return null
      }
      try {
        const parsed = JSON.parse(resource.text) as {
          title?: string
          url?: string
          content?: string
          description?: string
          icon?: string
          favicon?: string
          rank?: number
          snippet?: string
          searchId?: string
        }
        const url = parsed.url || resource.uri || ''
        if (!url) {
          return null
        }
        return {
          title: parsed.title || '',
          url,
          content: parsed.content || '',
          description: parsed.description || parsed.content || '',
          snippet: parsed.snippet || parsed.description || parsed.content || '',
          icon: parsed.icon || '',
          favicon: parsed.favicon || '',
          rank: typeof parsed.rank === 'number' ? parsed.rank : undefined,
          searchId: parsed.searchId
        } as SearchResult
      } catch (error) {
        console.warn('[DeepChatDispatch] Failed to parse search result resource:', error)
        return null
      }
    })
    .filter((item): item is SearchResult => item !== null)

  if (results.length === 0) {
    return null
  }

  const searchId = nanoid()
  const pages = results
    .filter((item) => item.icon || item.favicon)
    .slice(0, 6)
    .map((item) => ({
      url: item.url,
      icon: item.icon || item.favicon || ''
    }))

  const block: AssistantMessageBlock = {
    id: searchId,
    type: 'search',
    content: '',
    status: 'success',
    timestamp: Date.now(),
    extra: {
      total: results.length,
      searchId,
      pages,
      label: toolName || 'web_search',
      name: toolName || 'web_search',
      engine: serverName || undefined,
      provider: serverName || undefined
    }
  }

  return {
    block,
    results: results.map((item) => ({
      ...item,
      searchId: item.searchId || searchId
    }))
  }
}

function updateToolCallBlock(
  blocks: AssistantMessageBlock[],
  toolCallId: string,
  response: string,
  isError: boolean
): void {
  const block = blocks.find((b) => b.type === 'tool_call' && b.tool_call?.id === toolCallId)
  if (block?.tool_call) {
    block.tool_call.response = response
    block.status = isError ? 'error' : 'success'
  }
}

function isPermissionType(value: unknown): value is PermissionType {
  return value === 'read' || value === 'write' || value === 'all' || value === 'command'
}

function normalizePermissionRequest(
  request: PermissionRequestLike | null | undefined,
  fallback: {
    toolName: string
    serverName?: string
    description: string
  }
): PendingToolInteraction['permission'] {
  const permissionType = isPermissionType(request?.permissionType)
    ? request.permissionType
    : 'write'
  const toolName = typeof request?.toolName === 'string' ? request.toolName : fallback.toolName
  const serverName =
    typeof request?.serverName === 'string' ? request.serverName : fallback.serverName
  const description =
    typeof request?.description === 'string' && request.description.trim().length > 0
      ? request.description
      : fallback.description

  return {
    permissionType,
    description,
    toolName,
    serverName,
    providerId: typeof request?.providerId === 'string' ? request.providerId : undefined,
    requestId: typeof request?.requestId === 'string' ? request.requestId : undefined,
    rememberable: request?.rememberable === false ? false : true,
    command: typeof request?.command === 'string' ? request.command : undefined,
    commandSignature:
      typeof request?.commandSignature === 'string' ? request.commandSignature : undefined,
    paths: Array.isArray(request?.paths)
      ? request.paths.filter((item): item is string => typeof item === 'string' && item.length > 0)
      : undefined,
    commandInfo: request?.commandInfo
  }
}

async function autoGrantPermission(
  conversationId: string,
  permission: NonNullable<PendingToolInteraction['permission']>
): Promise<void> {
  const type = permission.permissionType
  const serverName = permission.serverName || ''
  const toolName = permission.toolName || ''

  if (type === 'command') {
    const command = permission.command || permission.commandInfo?.command || ''
    const signature =
      permission.commandSignature ||
      permission.commandInfo?.signature ||
      (command ? presenter.commandPermissionService.extractCommandSignature(command) : '')
    if (signature) {
      presenter.commandPermissionService.approve(conversationId, signature, false)
    }
    return
  }

  if (
    serverName === 'agent-filesystem' &&
    Array.isArray(permission.paths) &&
    permission.paths.length
  ) {
    presenter.filePermissionService?.approve(conversationId, permission.paths, false)
    return
  }

  if (serverName === 'deepchat-settings' && toolName) {
    presenter.settingsPermissionService?.approve(conversationId, toolName, false)
    return
  }

  if (serverName && (type === 'read' || type === 'write' || type === 'all')) {
    await presenter.mcpPresenter.grantPermission(serverName, type, false, conversationId)
  }
}

function appendPermissionActionBlock(
  state: StreamState,
  io: IoParams,
  toolCall: {
    id: string
    name: string
    args: string
    serverName?: string
    serverIcons?: string
    serverDescription?: string
  },
  permission: NonNullable<PendingToolInteraction['permission']>
): PendingToolInteraction {
  state.blocks.push({
    type: 'action',
    content: permission.description,
    status: 'pending',
    timestamp: Date.now(),
    action_type: 'tool_call_permission',
    tool_call: {
      id: toolCall.id,
      name: toolCall.name,
      params: toolCall.args,
      server_name: toolCall.serverName,
      server_icons: toolCall.serverIcons,
      server_description: toolCall.serverDescription
    },
    extra: {
      needsUserAction: true,
      permissionType: permission.permissionType,
      toolName: permission.toolName || toolCall.name,
      serverName: permission.serverName || toolCall.serverName || '',
      ...(permission.providerId ? { providerId: permission.providerId } : {}),
      ...(permission.requestId ? { permissionRequestId: permission.requestId } : {}),
      ...(permission.commandInfo ? { commandInfo: JSON.stringify(permission.commandInfo) } : {}),
      permissionRequest: JSON.stringify(permission),
      ...(permission.rememberable === false ? { rememberable: false } : {})
    }
  })
  state.dirty = true
  return {
    type: 'permission',
    messageId: io.messageId,
    toolCallId: toolCall.id,
    toolName: toolCall.name,
    toolArgs: toolCall.args,
    serverName: toolCall.serverName,
    serverIcons: toolCall.serverIcons,
    serverDescription: toolCall.serverDescription,
    permission
  }
}

function appendQuestionActionBlock(
  state: StreamState,
  io: IoParams,
  toolCall: {
    id: string
    name: string
    args: string
    serverName?: string
    serverIcons?: string
    serverDescription?: string
  },
  question: NonNullable<PendingToolInteraction['question']>
): PendingToolInteraction {
  state.blocks.push({
    type: 'action',
    content: '',
    status: 'pending',
    timestamp: Date.now(),
    action_type: 'question_request',
    tool_call: {
      id: toolCall.id,
      name: toolCall.name,
      params: toolCall.args,
      server_name: toolCall.serverName,
      server_icons: toolCall.serverIcons,
      server_description: toolCall.serverDescription
    },
    extra: {
      needsUserAction: true,
      questionHeader: question.header || '',
      questionText: question.question,
      questionOptions: question.options,
      questionMultiple: question.multiple,
      questionCustom: question.custom,
      questionResolution: 'asked'
    }
  })
  state.dirty = true
  return {
    type: 'question',
    messageId: io.messageId,
    toolCallId: toolCall.id,
    toolName: toolCall.name,
    toolArgs: toolCall.args,
    serverName: toolCall.serverName,
    serverIcons: toolCall.serverIcons,
    serverDescription: toolCall.serverDescription,
    question
  }
}

function flushBlocksToRenderer(io: IoParams, blocks: AssistantMessageBlock[]): void {
  eventBus.sendToRenderer(STREAM_EVENTS.RESPONSE, SendTarget.ALL_WINDOWS, {
    conversationId: io.sessionId,
    eventId: io.messageId,
    messageId: io.messageId,
    blocks: JSON.parse(JSON.stringify(blocks))
  })
}

export async function executeTools(
  state: StreamState,
  conversation: ChatMessage[],
  prevBlockCount: number,
  tools: MCPToolDefinition[],
  toolPresenter: IToolPresenter,
  modelId: string,
  io: IoParams,
  permissionMode: PermissionMode,
  toolOutputGuard: ToolOutputGuard,
  contextLength: number,
  maxTokens: number,
  hooks?: ProcessHooks
): Promise<{
  executed: number
  pendingInteractions: PendingToolInteraction[]
  terminalError?: string
}> {
  for (const tc of state.completedToolCalls) {
    const toolDef = tools.find((t) => t.function.name === tc.name)
    if (!toolDef) continue
    const block = state.blocks.find((b) => b.type === 'tool_call' && b.tool_call?.id === tc.id)
    if (!block?.tool_call) continue
    block.tool_call.server_name = toolDef.server.name
    block.tool_call.server_icons = toolDef.server.icons
    block.tool_call.server_description = toolDef.server.description
  }

  const iterationBlocks = state.blocks.slice(prevBlockCount)
  const assistantText = extractTextFromBlocks(iterationBlocks)
  const assistantMessage: ChatMessage = {
    role: 'assistant',
    content: assistantText,
    tool_calls: state.completedToolCalls.map((tc) => ({
      id: tc.id,
      type: 'function' as const,
      function: { name: tc.name, arguments: tc.arguments }
    }))
  }

  if (requiresReasoningField(modelId)) {
    const reasoning = extractReasoningFromBlocks(iterationBlocks)
    if (reasoning) {
      assistantMessage.reasoning_content = reasoning
    }
  }

  conversation.push(assistantMessage)

  let executed = 0
  const pendingInteractions: PendingToolInteraction[] = []

  for (const tc of state.completedToolCalls) {
    if (io.abortSignal.aborted) break

    const toolDef = tools.find((t) => t.function.name === tc.name)
    const toolCall: MCPToolCall = {
      id: tc.id,
      type: 'function',
      function: { name: tc.name, arguments: tc.arguments },
      server: toolDef?.server,
      conversationId: io.sessionId
    }

    const toolContext = {
      id: tc.id,
      name: tc.name,
      args: tc.arguments,
      serverName: toolDef?.server.name,
      serverIcons: toolDef?.server.icons,
      serverDescription: toolDef?.server.description
    }

    try {
      if (toolCall.function.name === QUESTION_TOOL_NAME) {
        const parsedQuestion = parseQuestionToolArgs(tc.arguments)
        if (!parsedQuestion.success) {
          const errorText = `Error: ${parsedQuestion.error}`
          conversation.push({
            role: 'tool',
            tool_call_id: tc.id,
            content: errorText
          })
          updateToolCallBlock(state.blocks, tc.id, errorText, true)
          state.dirty = true
          executed += 1
          flushBlocksToRenderer(io, state.blocks)
          io.messageStore.updateAssistantContent(io.messageId, state.blocks)
          continue
        }

        const interaction = appendQuestionActionBlock(state, io, toolContext, {
          header: parsedQuestion.data.header,
          question: parsedQuestion.data.question,
          options: parsedQuestion.data.options,
          custom: parsedQuestion.data.custom !== false,
          multiple: Boolean(parsedQuestion.data.multiple)
        })
        pendingInteractions.push(interaction)
        updateToolCallBlock(state.blocks, tc.id, '', false)
        continue
      }

      let preCheckedPermission: PendingToolInteraction['permission'] | null = null
      if (toolPresenter.preCheckToolPermission) {
        const preChecked = await toolPresenter.preCheckToolPermission(toolCall)
        if (preChecked?.needsPermission) {
          preCheckedPermission = normalizePermissionRequest(preChecked as PermissionRequestLike, {
            toolName: toolContext.name,
            serverName: toolContext.serverName,
            description: `Permission required for ${toolContext.name}`
          })
        }
      }

      if (preCheckedPermission) {
        if (permissionMode === 'full_access') {
          await autoGrantPermission(io.sessionId, preCheckedPermission)
        } else {
          hooks?.onPermissionRequest?.(preCheckedPermission, {
            callId: tc.id,
            name: tc.name,
            params: tc.arguments
          })
          const interaction = appendPermissionActionBlock(
            state,
            io,
            toolContext,
            preCheckedPermission
          )
          pendingInteractions.push(interaction)
          updateToolCallBlock(state.blocks, tc.id, '', false)
          continue
        }
      }

      hooks?.onPreToolUse?.({
        callId: tc.id,
        name: tc.name,
        params: tc.arguments
      })

      const toolCallResult = await toolPresenter.callTool(toolCall)
      let toolRawData = toolCallResult.rawData

      if (toolRawData?.requiresPermission) {
        const pendingPermission = normalizePermissionRequest(
          toolRawData.permissionRequest as PermissionRequestLike | undefined,
          {
            toolName: toolContext.name,
            serverName: toolContext.serverName,
            description: `Permission required for ${toolContext.name}`
          }
        )

        if (pendingPermission) {
          if (permissionMode === 'full_access') {
            await autoGrantPermission(io.sessionId, pendingPermission)
            const retryCallResult = await toolPresenter.callTool(toolCall)
            toolRawData = retryCallResult.rawData
          } else {
            hooks?.onPermissionRequest?.(pendingPermission, {
              callId: tc.id,
              name: tc.name,
              params: tc.arguments
            })
            const interaction = appendPermissionActionBlock(
              state,
              io,
              toolContext,
              pendingPermission
            )
            pendingInteractions.push(interaction)
            updateToolCallBlock(state.blocks, tc.id, '', false)
            continue
          }
        }
      }

      const searchPayload = extractSearchPayload(
        toolRawData.content,
        toolContext.name,
        toolContext.serverName
      )
      if (searchPayload) {
        state.blocks.push(searchPayload.block)
        for (const result of searchPayload.results) {
          io.messageStore.addSearchResult({
            sessionId: io.sessionId,
            messageId: io.messageId,
            searchId: result.searchId,
            rank: typeof result.rank === 'number' ? result.rank : null,
            result
          })
        }
      }

      const responseText = toolResponseToText(toolRawData.content)
      const guardedResult = await toolOutputGuard.guardToolOutput({
        sessionId: io.sessionId,
        toolCallId: tc.id,
        toolName: toolContext.name,
        rawContent: responseText,
        conversationMessages: conversation,
        toolDefinitions: tools,
        contextLength,
        maxTokens
      })

      if (guardedResult.kind === 'terminal_error') {
        updateToolCallBlock(state.blocks, tc.id, guardedResult.message, true)
        hooks?.onPostToolUseFailure?.({
          callId: tc.id,
          name: tc.name,
          params: tc.arguments,
          error: guardedResult.message
        })
        state.dirty = true
        executed += 1
        flushBlocksToRenderer(io, state.blocks)
        io.messageStore.updateAssistantContent(io.messageId, state.blocks)
        return {
          executed,
          pendingInteractions,
          terminalError: guardedResult.message
        }
      }

      const isToolError = guardedResult.kind === 'tool_error' || toolRawData.isError === true
      const toolMessageContent =
        guardedResult.kind === 'tool_error' ? guardedResult.message : guardedResult.content
      conversation.push({
        role: 'tool',
        tool_call_id: tc.id,
        content: toolMessageContent
      })
      updateToolCallBlock(state.blocks, tc.id, toolMessageContent, isToolError)
      if (isToolError) {
        hooks?.onPostToolUseFailure?.({
          callId: tc.id,
          name: tc.name,
          params: tc.arguments,
          error: toolMessageContent
        })
      } else {
        hooks?.onPostToolUse?.({
          callId: tc.id,
          name: tc.name,
          params: tc.arguments,
          response: toolMessageContent
        })
      }
    } catch (err) {
      const errorText = err instanceof Error ? err.message : String(err)
      conversation.push({
        role: 'tool',
        tool_call_id: tc.id,
        content: `Error: ${errorText}`
      })
      updateToolCallBlock(state.blocks, tc.id, `Error: ${errorText}`, true)
      hooks?.onPostToolUseFailure?.({
        callId: tc.id,
        name: tc.name,
        params: tc.arguments,
        error: `Error: ${errorText}`
      })
    }

    state.dirty = true
    executed += 1
    flushBlocksToRenderer(io, state.blocks)
    io.messageStore.updateAssistantContent(io.messageId, state.blocks)
  }

  return { executed, pendingInteractions }
}

export function finalizePaused(state: StreamState, io: IoParams): void {
  for (const block of state.blocks) {
    if (
      block.type === 'action' &&
      (block.action_type === 'tool_call_permission' || block.action_type === 'question_request') &&
      block.status === 'pending'
    ) {
      continue
    }
    if (block.status === 'pending') {
      block.status = 'success'
    }
  }

  io.messageStore.updateAssistantContent(io.messageId, state.blocks)
  flushBlocksToRenderer(io, state.blocks)
  eventBus.sendToRenderer(STREAM_EVENTS.END, SendTarget.ALL_WINDOWS, {
    conversationId: io.sessionId,
    eventId: io.messageId,
    messageId: io.messageId
  })
}

export function finalize(state: StreamState, io: IoParams): void {
  for (const block of state.blocks) {
    if (block.status === 'pending') block.status = 'success'
  }

  const endTime = Date.now()
  state.metadata.generationTime = endTime - state.startTime
  if (state.firstTokenTime !== null) {
    state.metadata.firstTokenTime = state.firstTokenTime - state.startTime
  }
  if (state.metadata.outputTokens && state.metadata.generationTime > 0) {
    state.metadata.tokensPerSecond = Math.round(
      (state.metadata.outputTokens / state.metadata.generationTime) * 1000
    )
  }

  io.messageStore.finalizeAssistantMessage(
    io.messageId,
    state.blocks,
    JSON.stringify(state.metadata)
  )
  flushBlocksToRenderer(io, state.blocks)
  eventBus.sendToRenderer(STREAM_EVENTS.END, SendTarget.ALL_WINDOWS, {
    conversationId: io.sessionId,
    eventId: io.messageId,
    messageId: io.messageId
  })
}

export function finalizeError(state: StreamState, io: IoParams, error: unknown): void {
  const errorMessage = error instanceof Error ? error.message : String(error)
  const errorBlock: AssistantMessageBlock = {
    type: 'error',
    content: errorMessage,
    status: 'error',
    timestamp: Date.now()
  }
  state.blocks.push(errorBlock)

  for (const block of state.blocks) {
    if (block.status === 'pending') block.status = 'error'
  }

  const endTime = Date.now()
  state.metadata.generationTime = endTime - state.startTime
  if (state.firstTokenTime !== null) {
    state.metadata.firstTokenTime = state.firstTokenTime - state.startTime
  }
  if (state.metadata.outputTokens && state.metadata.generationTime > 0) {
    state.metadata.tokensPerSecond = Math.round(
      (state.metadata.outputTokens / state.metadata.generationTime) * 1000
    )
  }

  io.messageStore.setMessageError(io.messageId, state.blocks, JSON.stringify(state.metadata))
  flushBlocksToRenderer(io, state.blocks)
  eventBus.sendToRenderer(STREAM_EVENTS.ERROR, SendTarget.ALL_WINDOWS, {
    conversationId: io.sessionId,
    eventId: io.messageId,
    messageId: io.messageId,
    error: errorMessage
  })
}
