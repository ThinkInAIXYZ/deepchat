import { eventBus, SendTarget } from '@/eventbus'
import { STREAM_EVENTS } from '@/events'
import type {
  MCPToolCall,
  MCPContentItem,
  MCPResourceContent,
  MCPToolResponse
} from '@shared/types/core/mcp'
import type { MCPToolDefinition } from '@shared/types/core/mcp'
import type { SearchResult } from '@shared/types/core/search'
import type { IToolPresenter } from '@shared/types/presenters/tool.presenter'
import type { AgentToolProgressUpdate } from '@shared/types/presenters/tool.presenter'
import type { AssistantMessageBlock, PermissionMode } from '@shared/types/agent-interface'
import { parseQuestionToolArgs, QUESTION_TOOL_NAME } from '../../lib/agentRuntime/questionTool'
import type {
  InterleavedReasoningConfig,
  IoParams,
  PendingToolInteraction,
  ProcessHooks,
  StreamState
} from './types'
import type { ChatMessage, ChatMessageProviderOptions } from '@shared/types/core/chat-message'
import { nanoid } from 'nanoid'
import type { ToolBatchOutputFitItem, ToolOutputGuard } from './toolOutputGuard'
import { buildTerminalErrorBlocks } from './messageStore'
import { finalizeTrailingPendingNarrativeBlocks } from './accumulator'
import type { EchoHandle } from './echo'
import { cloneBlocksForRenderer } from './echo'
import {
  buildAssistantPreviewMarkdown,
  buildAssistantResponseMarkdown,
  emitDeepChatInternalSessionUpdate,
  extractWaitingInteraction
} from './internalSessionEvents'

type PermissionType = 'read' | 'write' | 'all' | 'command'

type ExtractedSearchPayload = ReturnType<typeof extractSearchPayload>

type StagedToolResult = {
  toolCallId: string
  toolName: string
  toolArgs: string
  responseText: string
  isError: boolean
  offloadPath?: string
  searchPayload: ExtractedSearchPayload
  rtkApplied?: boolean
  rtkMode?: 'rewrite' | 'direct' | 'bypass'
  rtkFallbackReason?: string
  postHookKind: 'success' | 'failure'
}

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

type RendererFlushHandle = Pick<EchoHandle, 'flush' | 'schedule'>

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

function parseProviderOptionsJson(
  value: string | undefined
): ChatMessageProviderOptions | undefined {
  if (!value) {
    return undefined
  }

  try {
    const parsed = JSON.parse(value)
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return parsed as ChatMessageProviderOptions
    }
  } catch {}

  return undefined
}

function getBlockProviderOptions(
  block: AssistantMessageBlock
): ChatMessageProviderOptions | undefined {
  return parseProviderOptionsJson(
    typeof block.extra?.providerOptionsJson === 'string'
      ? block.extra.providerOptionsJson
      : undefined
  )
}

function extractAssistantContent(
  blocks: AssistantMessageBlock[]
): ChatMessage['content'] | undefined {
  const textBlocks = blocks.filter(
    (block): block is AssistantMessageBlock & { content: string } =>
      block.type === 'content' && typeof block.content === 'string' && block.content.length > 0
  )

  if (textBlocks.length === 0) {
    return undefined
  }

  const contentParts = textBlocks.map((block) => {
    const providerOptions = getBlockProviderOptions(block)
    return {
      type: 'text' as const,
      text: block.content,
      ...(providerOptions ? { provider_options: providerOptions } : {})
    }
  })

  return contentParts.some((part) => part.provider_options)
    ? contentParts
    : contentParts.map((part) => part.text).join('')
}

function extractReasoningProviderOptions(
  blocks: AssistantMessageBlock[]
): ChatMessageProviderOptions | undefined {
  const reasoningBlocks = blocks.filter((block) => block.type === 'reasoning_content')
  for (const block of reasoningBlocks) {
    const providerOptions = getBlockProviderOptions(block)
    if (providerOptions) {
      return providerOptions
    }
  }

  return undefined
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
  isError: boolean,
  rtkMetadata?: {
    rtkApplied?: boolean
    rtkMode?: 'rewrite' | 'direct' | 'bypass'
    rtkFallbackReason?: string
  }
): void {
  const block = blocks.find((b) => b.type === 'tool_call' && b.tool_call?.id === toolCallId)
  if (block?.tool_call) {
    block.tool_call.response = response
    if (typeof rtkMetadata?.rtkApplied === 'boolean') {
      block.tool_call.rtkApplied = rtkMetadata.rtkApplied
    }
    if (rtkMetadata?.rtkMode) {
      block.tool_call.rtkMode = rtkMetadata.rtkMode
    }
    if (rtkMetadata?.rtkFallbackReason) {
      block.tool_call.rtkFallbackReason = rtkMetadata.rtkFallbackReason
    }
    block.status = isError ? 'error' : 'success'
  }
}

function updateSubagentToolCallBlock(
  blocks: AssistantMessageBlock[],
  toolCallId: string,
  responseMarkdown: string,
  progressJson?: string,
  finalJson?: string
): void {
  const block = blocks.find(
    (item) => item.type === 'tool_call' && item.tool_call?.id === toolCallId
  )
  if (!block?.tool_call) {
    return
  }

  block.tool_call.response = responseMarkdown
  block.status = typeof finalJson === 'string' ? 'success' : 'loading'
  block.extra = {
    ...block.extra,
    ...(typeof progressJson === 'string' ? { subagentProgress: progressJson } : {}),
    ...(typeof finalJson === 'string' ? { subagentFinal: finalJson } : {})
  }
}

function extractSubagentToolState(rawData: MCPToolResponse): {
  subagentProgress?: string
  subagentFinal?: string
} {
  const toolResult =
    rawData.toolResult && typeof rawData.toolResult === 'object'
      ? (rawData.toolResult as Record<string, unknown>)
      : null

  return {
    subagentProgress:
      typeof toolResult?.subagentProgress === 'string' ? toolResult.subagentProgress : undefined,
    subagentFinal:
      typeof toolResult?.subagentFinal === 'string' ? toolResult.subagentFinal : undefined
  }
}

function shouldRefreshToolsAfterCall(toolName: string, rawData: MCPToolResponse): boolean {
  if (toolName !== 'skill_view') {
    return false
  }

  const toolResult =
    rawData.toolResult && typeof rawData.toolResult === 'object'
      ? (rawData.toolResult as Record<string, unknown>)
      : null

  return toolResult?.activationApplied === true
}

function scheduleRendererFlush(
  state: StreamState,
  rendererFlushHandle?: Pick<RendererFlushHandle, 'schedule'>
): void {
  if (!state.dirty) {
    return
  }

  rendererFlushHandle?.schedule()
}

function persistToolExecutionState(
  _io: IoParams,
  state: StreamState,
  rendererFlushHandle?: Pick<RendererFlushHandle, 'schedule'>
): void {
  if (!state.dirty) {
    return
  }

  scheduleRendererFlush(state, rendererFlushHandle)
}

function finalizePendingNarrativeBeforeToolExecution(state: StreamState): void {
  const last = state.blocks[state.blocks.length - 1]
  if (
    !last ||
    last.status !== 'pending' ||
    (last.type !== 'content' && last.type !== 'reasoning_content')
  ) {
    return
  }

  finalizeTrailingPendingNarrativeBlocks(state.blocks)
  state.dirty = true
}

function applyFinalizedToolResults(params: {
  stagedResults: StagedToolResult[]
  fittedResults: ToolBatchOutputFitItem[]
  conversation: ChatMessage[]
  state: StreamState
  io: IoParams
  hooks?: ProcessHooks
  appendToConversation: boolean
}): void {
  const { stagedResults, fittedResults, conversation, state, io, hooks, appendToConversation } =
    params

  for (let index = 0; index < stagedResults.length; index += 1) {
    const stagedResult = stagedResults[index]
    const fittedResult = fittedResults[index]
    if (!fittedResult) {
      continue
    }

    if (appendToConversation) {
      conversation.push({
        role: 'tool',
        tool_call_id: fittedResult.toolCallId,
        content: fittedResult.contextResponseText
      })
    }

    const searchPayload = fittedResult.downgraded ? null : stagedResult.searchPayload
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

    updateToolCallBlock(
      state.blocks,
      fittedResult.toolCallId,
      fittedResult.responseText,
      fittedResult.isError,
      fittedResult.downgraded
        ? undefined
        : {
            rtkApplied: stagedResult.rtkApplied,
            rtkMode: stagedResult.rtkMode,
            rtkFallbackReason: stagedResult.rtkFallbackReason
          }
    )

    if (fittedResult.isError) {
      hooks?.onPostToolUseFailure?.({
        callId: stagedResult.toolCallId,
        name: stagedResult.toolName,
        params: stagedResult.toolArgs,
        error: fittedResult.responseText
      })
    } else if (stagedResult.postHookKind === 'success') {
      hooks?.onPostToolUse?.({
        callId: stagedResult.toolCallId,
        name: stagedResult.toolName,
        params: stagedResult.toolArgs,
        response: fittedResult.responseText
      })
    }
  }

  state.dirty = true
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
  hooks: ProcessHooks | undefined,
  _conversationId: string,
  permission: NonNullable<PendingToolInteraction['permission']>
): Promise<void> {
  if (hooks?.autoGrantPermission) {
    await hooks.autoGrantPermission(permission)
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
    blocks: cloneBlocksForRenderer(blocks)
  })

  emitDeepChatInternalSessionUpdate({
    sessionId: io.sessionId,
    kind: 'blocks',
    updatedAt: Date.now(),
    messageId: io.messageId,
    previewMarkdown: buildAssistantPreviewMarkdown(blocks),
    responseMarkdown: buildAssistantResponseMarkdown(blocks),
    waitingInteraction: extractWaitingInteraction(blocks, io.messageId)
  })
}

export async function executeTools(
  state: StreamState,
  conversation: ChatMessage[],
  prevBlockCount: number,
  tools: MCPToolDefinition[],
  toolPresenter: IToolPresenter,
  modelId: string,
  interleavedReasoning: InterleavedReasoningConfig,
  io: IoParams,
  permissionMode: PermissionMode,
  toolOutputGuard: ToolOutputGuard,
  contextLength: number,
  maxTokens: number,
  rendererFlushHandle: RendererFlushHandle,
  hooks?: ProcessHooks,
  providerId?: string
): Promise<{
  executed: number
  pendingInteractions: PendingToolInteraction[]
  toolsChanged: boolean
  terminalError?: string
}> {
  finalizePendingNarrativeBeforeToolExecution(state)
  persistToolExecutionState(io, state, rendererFlushHandle)

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
  const assistantContent =
    extractAssistantContent(iterationBlocks) ?? extractTextFromBlocks(iterationBlocks)
  const assistantMessage: ChatMessage = {
    role: 'assistant',
    content: assistantContent,
    tool_calls: state.completedToolCalls.map((tc) => ({
      id: tc.id,
      type: 'function' as const,
      function: { name: tc.name, arguments: tc.arguments },
      ...(tc.providerOptions ? { provider_options: tc.providerOptions } : {})
    }))
  }

  const reasoning = extractReasoningFromBlocks(iterationBlocks)
  if (interleavedReasoning.preserveReasoningContent && reasoning) {
    assistantMessage.reasoning_content = reasoning
    const reasoningProviderOptions = extractReasoningProviderOptions(iterationBlocks)
    if (reasoningProviderOptions) {
      assistantMessage.reasoning_provider_options = reasoningProviderOptions
    }
  } else if (
    reasoning &&
    interleavedReasoning.reasoningSupported &&
    !interleavedReasoning.forcedBySessionSetting &&
    !interleavedReasoning.portraitInterleaved
  ) {
    const gapPayload = {
      providerId: providerId?.trim() || 'unknown-provider',
      modelId,
      providerDbSourceUrl: interleavedReasoning.providerDbSourceUrl,
      reasoningContentLength: reasoning.length,
      toolCallCount: state.completedToolCalls.length
    }
    hooks?.onInterleavedReasoningGap?.(gapPayload)
    if (!hooks?.onInterleavedReasoningGap) {
      console.warn('[DeepChatDispatch] Missing interleaved reasoning portrait:', gapPayload)
    }
  }

  conversation.push(assistantMessage)

  let executed = 0
  let toolsChanged = false
  const pendingInteractions: PendingToolInteraction[] = []
  const stagedResults: StagedToolResult[] = []

  for (const tc of state.completedToolCalls) {
    if (io.abortSignal.aborted) break

    const toolDef = tools.find((t) => t.function.name === tc.name)
    const toolCall: MCPToolCall = {
      id: tc.id,
      type: 'function',
      function: { name: tc.name, arguments: tc.arguments },
      server: toolDef?.server,
      conversationId: io.sessionId,
      providerId: providerId?.trim() || undefined
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
          persistToolExecutionState(io, state, rendererFlushHandle)
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
          await autoGrantPermission(hooks, io.sessionId, preCheckedPermission)
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

      const applyProgressUpdate = (update: AgentToolProgressUpdate) => {
        if (update.kind !== 'subagent_orchestrator' || update.toolCallId !== tc.id) {
          return
        }

        updateSubagentToolCallBlock(
          state.blocks,
          tc.id,
          update.responseMarkdown,
          update.progressJson
        )
        state.dirty = true
        scheduleRendererFlush(state, rendererFlushHandle)
      }

      const toolCallResult = await toolPresenter.callTool(toolCall, {
        onProgress: applyProgressUpdate,
        signal: io.abortSignal
      })
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
            await autoGrantPermission(hooks, io.sessionId, pendingPermission)
            const retryCallResult = await toolPresenter.callTool(toolCall, {
              onProgress: applyProgressUpdate,
              signal: io.abortSignal
            })
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

      const subagentState = extractSubagentToolState(toolRawData)
      if (subagentState.subagentProgress || subagentState.subagentFinal) {
        updateSubagentToolCallBlock(
          state.blocks,
          tc.id,
          typeof toolRawData.content === 'string'
            ? toolRawData.content
            : toolResponseToText(toolRawData.content),
          subagentState.subagentProgress,
          subagentState.subagentFinal
        )
      }

      if (hooks?.normalizeToolResult) {
        toolRawData = {
          ...toolRawData,
          content: await hooks.normalizeToolResult({
            sessionId: io.sessionId,
            toolCallId: tc.id,
            toolName: tc.name,
            toolArgs: tc.arguments,
            content: toolRawData.content,
            isError: toolRawData.isError === true
          })
        }
      }

      if (shouldRefreshToolsAfterCall(tc.name, toolRawData)) {
        toolsChanged = true
      }

      const searchPayload = extractSearchPayload(
        toolRawData.content,
        toolContext.name,
        toolContext.serverName
      )

      const responseText = toolResponseToText(toolRawData.content)
      const preparedResult = await toolOutputGuard.prepareToolOutput({
        sessionId: io.sessionId,
        toolCallId: tc.id,
        toolName: toolContext.name,
        rawContent: responseText
      })
      const stagedResponseText =
        preparedResult.kind === 'tool_error' ? preparedResult.message : preparedResult.content
      const stagedIsError = preparedResult.kind === 'tool_error' || toolRawData.isError === true

      stagedResults.push({
        toolCallId: tc.id,
        toolName: tc.name,
        toolArgs: tc.arguments,
        responseText: stagedResponseText,
        isError: stagedIsError,
        offloadPath: preparedResult.kind === 'ok' ? preparedResult.offloadPath : undefined,
        searchPayload,
        rtkApplied: toolRawData.rtkApplied,
        rtkMode: toolRawData.rtkMode,
        rtkFallbackReason: toolRawData.rtkFallbackReason,
        postHookKind: stagedIsError ? 'failure' : 'success'
      })
      executed += 1
    } catch (err) {
      const errorText = err instanceof Error ? err.message : String(err)
      stagedResults.push({
        toolCallId: tc.id,
        toolName: tc.name,
        toolArgs: tc.arguments,
        responseText: `Error: ${errorText}`,
        isError: true,
        searchPayload: null,
        postHookKind: 'failure'
      })
      executed += 1
    }
  }

  if (stagedResults.length > 0) {
    const fittedResults = await toolOutputGuard.fitToolBatchOutputs({
      conversationMessages: conversation,
      results: stagedResults.map((result) => ({
        toolCallId: result.toolCallId,
        toolName: result.toolName,
        responseText: result.responseText,
        isError: result.isError,
        offloadPath: result.offloadPath
      })),
      toolDefinitions: tools,
      contextLength,
      maxTokens
    })

    applyFinalizedToolResults({
      stagedResults,
      fittedResults: fittedResults.results,
      conversation,
      state,
      io,
      hooks,
      appendToConversation: fittedResults.kind === 'ok'
    })
    persistToolExecutionState(io, state, rendererFlushHandle)

    if (fittedResults.kind === 'terminal_error') {
      return {
        executed,
        pendingInteractions,
        toolsChanged,
        terminalError: fittedResults.message
      }
    }
  }

  persistToolExecutionState(io, state, rendererFlushHandle)
  return { executed, pendingInteractions, toolsChanged }
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
  state.blocks = buildTerminalErrorBlocks(state.blocks, errorMessage)

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
