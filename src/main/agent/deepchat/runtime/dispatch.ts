import type {
  MCPToolCall,
  MCPContentItem,
  MCPResourceContent,
  MCPToolResponse,
  ToolCallImagePreview
} from '@shared/types/core/mcp'
import type { MCPToolDefinition } from '@shared/types/core/mcp'
import type { SearchResult } from '@shared/types/core/search'
import type { AgentToolProgressUpdate } from '@shared/types/tool'
import type { AssistantMessageBlock, PermissionMode } from '@shared/types/agent-interface'
import type { AgentPlanSnapshot, AgentPlanTerminalReason } from '@shared/types/agent-plan'
import {
  parseQuestionToolArgs,
  QUESTION_TOOL_NAME
} from '@/tool/agentTools/questionTool'
import { UPDATE_PLAN_TOOL_NAME } from '@/tool/agentTools/agentPlanTool'
import type {
  InterleavedReasoningConfig,
  IoParams,
  PendingToolInteraction,
  ProcessControlCollaborators,
  StreamState,
  ToolBatchInteraction,
  ToolCallResult,
  ToolDispatchCollaborators
} from './types'
import type { ChatMessage, ChatMessageProviderOptions } from '@shared/types/core/chat-message'
import { nanoid } from 'nanoid'
import type {
  DeepChatLoopNotificationObserver,
  PendingToolInteractionOrigin,
  PersistedToolBatchState,
  ToolBatchOutcome,
  ToolBatchOutputFitItem,
  ToolExecutionPort,
  ToolResultPort
} from '@/agent/deepchat/loop/ports'
import { emitDeepChatLoopNotification } from '@/agent/deepchat/loop/notificationObserver'
import { buildTerminalErrorBlocks } from '@/session/data/transcript'
import { finalizeTrailingPendingNarrativeBlocks } from './accumulator'
import type { EchoHandle } from './echo'
import { cloneBlocksForRenderer } from './echo'
import {
  insertBlocksAfterToolCall,
  prepareToolImagePreviewPresentation
} from './imageGenerationBlocks'
import {
  buildAssistantDeliverySegments,
  buildAssistantPreviewMarkdown,
  buildAssistantResponseMarkdown,
  extractWaitingInteraction
} from './sessionUpdates'
import { extractToolCallImagePreviews } from '@/lib/toolCallImagePreviews'
import { selectToolBatchExecutionMode } from './toolExecutionPolicy'

type PermissionType = 'read' | 'write' | 'all' | 'command'

type ExtractedSearchPayload = ReturnType<typeof extractSearchPayload>
type ToolExecutionContext = {
  toolDef?: MCPToolDefinition
  toolCall: MCPToolCall
  toolContext: {
    id: string
    name: string
    args: string
    serverName?: string
    serverIcons?: string
    serverDescription?: string
  }
  completedToolCall: StreamState['completedToolCalls'][number]
}

type StagedToolResult = {
  toolCallId: string
  toolName: string
  toolSource?: 'mcp' | 'agent'
  serverName?: string
  toolArgs: string
  responseText: string
  isError: boolean
  offloadPath?: string
  searchPayload: ExtractedSearchPayload
  rtkApplied?: boolean
  rtkMode?: 'rewrite' | 'direct' | 'bypass'
  rtkFallbackReason?: string
  imagePreviews?: ToolCallImagePreview[]
  mcpResult?: MCPToolResponse['mcpResult']
  skillDraftPrompt?: SkillDraftPromptPayload
  postHookKind: 'success' | 'failure'
  skippedReason?: 'max_tokens'
}

type SkillDraftPromptPayload = {
  draftId: string
  skillName: string
}

type SkillDraftToolResult = {
  skillDraft?: {
    status?: unknown
    draftId?: unknown
    skillName?: unknown
  }
}

type ToolRunOutcome =
  | {
      kind: 'staged'
      stagedResult: StagedToolResult
      toolsChanged: boolean
    }
  | {
      kind: 'permission'
      permission: NonNullable<PendingToolInteraction['permission']>
      toolContext: ToolExecutionContext['toolContext']
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

type RendererFlushHandle = Pick<EchoHandle, 'flush' | 'schedule' | 'rescheduleRenderer'>

type MutableToolBatchState = {
  callOrder: string[]
  invokedCallIds: Set<string>
  committedResultCallIds: Set<string>
}

const USER_CANCELED_GENERATION_ERROR = 'common.error.userCanceledGeneration'
export const TRUNCATED_TOOL_CALL_ERROR =
  'Tool call was not executed because the model response reached the output token limit, so its arguments may be incomplete. Retry the tool call with complete arguments.'

export type ToolBatchDisposition =
  | { kind: 'execute' }
  | { kind: 'reject'; reason: 'output_truncated' }

function createToolBatchState(toolCalls: readonly ToolCallResult[]): MutableToolBatchState {
  return {
    callOrder: toolCalls.map((toolCall) => toolCall.id),
    invokedCallIds: new Set(),
    committedResultCallIds: new Set()
  }
}

interface CommitStagedToolResultsParams {
  stagedResults: StagedToolResult[]
  pendingInteractions: ToolBatchInteraction[]
  batchState: MutableToolBatchState
  executed: number
  toolsChanged: boolean
  conversation: ChatMessage[]
  state: StreamState
  batchToolCallBlocks: AssistantMessageBlock[]
  toolBlockStartIndex: number
  io: IoParams
  notificationObserver?: DeepChatLoopNotificationObserver
  takeInteractionOrder: () => number
  toolResults: ToolResultPort
  tools: MCPToolDefinition[]
  contextLength: number
  maxTokens: number
  rendererFlushHandle: RendererFlushHandle
}

async function commitStagedToolResults(
  params: CommitStagedToolResultsParams
): Promise<ToolBatchOutcome<ToolBatchInteraction>> {
  const {
    stagedResults,
    pendingInteractions,
    batchState,
    executed,
    toolsChanged,
    conversation,
    state,
    batchToolCallBlocks,
    toolBlockStartIndex,
    io,
    notificationObserver,
    takeInteractionOrder,
    toolResults,
    tools,
    contextLength,
    maxTokens,
    rendererFlushHandle
  } = params

  if (stagedResults.length > 0) {
    const fittedResults = await toolResults.fitBatch({
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
    const finalizedInteractions = applyFinalizedToolResults({
      stagedResults,
      fittedResults: fittedResults.results,
      conversation,
      state,
      batchToolCallBlocks,
      toolBlockStartIndex,
      io,
      notificationObserver,
      appendToConversation: fittedResults.kind === 'ok',
      takeInteractionOrder
    })
    pendingInteractions.push(...finalizedInteractions)
    for (const result of stagedResults) {
      batchState.committedResultCallIds.add(result.toolCallId)
    }
    persistToolExecutionState(io, state, rendererFlushHandle)

    if (fittedResults.kind === 'terminal_error') {
      return buildToolBatchOutcome(
        batchState,
        pendingInteractions,
        executed,
        toolsChanged,
        fittedResults.message
      )
    }
  }

  persistToolExecutionState(io, state, rendererFlushHandle)
  return buildToolBatchOutcome(batchState, pendingInteractions, executed, toolsChanged)
}

function snapshotToolBatchState(
  state: MutableToolBatchState,
  interactions: readonly ToolBatchInteraction[]
): PersistedToolBatchState {
  return {
    callOrder: [...state.callOrder],
    invokedCallIds: [...state.invokedCallIds],
    committedResultCallIds: [...state.committedResultCallIds],
    pendingInteractionCallIds: interactions.map((interaction) => interaction.toolCallId)
  }
}

function buildToolBatchOutcome(
  executionStateSource: MutableToolBatchState,
  interactions: ToolBatchInteraction[],
  executed: number,
  toolsChanged: boolean,
  terminalError?: string
): ToolBatchOutcome<ToolBatchInteraction> {
  const orderedInteractions = [...interactions]
    .sort((left, right) => left.order - right.order)
    .map((interaction, order) => ({ ...interaction, order }))
  const executionState = snapshotToolBatchState(executionStateSource, orderedInteractions)
  if (terminalError) {
    return {
      type: 'completed',
      executed,
      toolsChanged,
      executionState,
      terminalError
    }
  }
  if (orderedInteractions.length > 0) {
    return {
      type: 'paused',
      executed,
      toolsChanged,
      interactions: orderedInteractions,
      executionState
    }
  }
  return { type: 'completed', executed, toolsChanged, executionState }
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
  },
  imagePreviews?: ToolCallImagePreview[],
  mcpResult?: MCPToolResponse['mcpResult']
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
    if (imagePreviews && imagePreviews.length > 0) {
      block.tool_call.imagePreviews = imagePreviews
    } else if (imagePreviews) {
      delete block.tool_call.imagePreviews
    }
    if (mcpResult) {
      block.tool_call.mcpResult = mcpResult
    }
    block.status = isError ? 'error' : 'success'
  }
}

function markToolCallSkipped(
  blocks: AssistantMessageBlock[],
  toolCallId: string,
  reason: NonNullable<StagedToolResult['skippedReason']>
): void {
  const block = blocks.find((candidate) => candidate.tool_call?.id === toolCallId)
  if (!block) return

  block.extra = {
    ...block.extra,
    toolCallSkippedReason: reason
  }
  delete block.extra.toolCallIncompleteReason
}

function setToolCallAutoApproveReviewing(
  blocks: AssistantMessageBlock[],
  toolCallId: string,
  reviewing: boolean
): boolean {
  const block = blocks.find((b) => b.type === 'tool_call' && b.tool_call?.id === toolCallId)
  if (!block?.tool_call) return false
  const extra = { ...block.extra }
  if (reviewing) {
    extra.autoApproveReviewStatus = 'reviewing'
  } else {
    delete extra.autoApproveReviewStatus
  }
  if (Object.keys(extra).length > 0) {
    block.extra = extra
  } else {
    delete block.extra
  }
  return true
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

function markInternalPlanToolCallBlock(blocks: AssistantMessageBlock[], toolCallId: string): void {
  const block = blocks.find(
    (item) => item.type === 'tool_call' && item.tool_call?.id === toolCallId
  )
  if (!block?.tool_call || block.tool_call.name !== UPDATE_PLAN_TOOL_NAME) {
    return
  }

  block.extra = {
    ...block.extra,
    internalTool: true
  }
}

export function publishPlanUpdated(io: IoParams, snapshot: AgentPlanSnapshot): void {
  io.publishEvent('chat.plan.updated', {
    sessionId: io.sessionId,
    messageId: io.messageId,
    ...(snapshot.toolCallId ? { toolCallId: snapshot.toolCallId } : {}),
    plan: snapshot.plan,
    ...(snapshot.explanation ? { explanation: snapshot.explanation } : {}),
    revision: snapshot.revision,
    updatedAt: snapshot.updatedAt,
    ...(snapshot.terminalReason ? { terminalReason: snapshot.terminalReason } : {})
  })
}

function stampPlanTerminalIfOpen(
  state: StreamState,
  io: IoParams,
  reason: AgentPlanTerminalReason | undefined
): boolean {
  if (!reason) {
    return false
  }

  const current = state.latestAgentPlanSnapshot
  if (
    !current ||
    current.terminalReason ||
    !current.plan.some((entry) => entry.status === 'in_progress')
  ) {
    return false
  }

  const snapshot: AgentPlanSnapshot = {
    ...current,
    sessionId: io.sessionId,
    messageId: io.messageId,
    terminalReason: reason,
    updatedAt: new Date().toISOString()
  }
  state.latestAgentPlanSnapshot = snapshot
  publishPlanUpdated(io, snapshot)
  return true
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

function extractSkillDraftPromptPayload(
  rawData: MCPToolResponse
): SkillDraftPromptPayload | undefined {
  const toolResult = rawData.toolResult as SkillDraftToolResult | null | undefined
  const skillDraft = toolResult?.skillDraft
  if (!skillDraft || typeof skillDraft !== 'object') {
    return undefined
  }
  if (skillDraft.status !== 'created') {
    return undefined
  }
  if (typeof skillDraft.draftId !== 'string' || typeof skillDraft.skillName !== 'string') {
    return undefined
  }
  const draftId = skillDraft.draftId.trim()
  const skillName = skillDraft.skillName.trim()
  if (!draftId || !skillName) {
    return undefined
  }
  return { draftId, skillName }
}

function extractActivatedSkillAfterCall(toolName: string, rawData: MCPToolResponse): string | null {
  if (toolName !== 'skill_view') {
    return null
  }

  const toolResult =
    rawData.toolResult && typeof rawData.toolResult === 'object'
      ? (rawData.toolResult as Record<string, unknown>)
      : null

  if (toolResult?.activationApplied !== true) {
    return null
  }

  const activatedSkill =
    typeof toolResult.activatedSkill === 'string' ? toolResult.activatedSkill.trim() : ''
  return activatedSkill || null
}

function buildToolExecutionContext(
  toolCallResult: StreamState['completedToolCalls'][number],
  tools: MCPToolDefinition[],
  sessionId: string,
  providerId?: string
): ToolExecutionContext {
  const toolDef = tools.find((tool) => tool.function.name === toolCallResult.name)
  const toolCall: MCPToolCall = {
    id: toolCallResult.id,
    type: 'function',
    function: { name: toolCallResult.name, arguments: toolCallResult.arguments },
    server: toolDef?.server,
    conversationId: sessionId,
    providerId: providerId?.trim() || undefined
  }

  return {
    toolDef,
    toolCall,
    completedToolCall: toolCallResult,
    toolContext: {
      id: toolCallResult.id,
      name: toolCallResult.name,
      args: toolCallResult.arguments,
      serverName: toolDef?.server.name,
      serverIcons: toolDef?.server.icons,
      serverDescription: toolDef?.server.description
    }
  }
}

function buildToolErrorOutcome(
  execution: ToolExecutionContext,
  error: unknown
): Extract<ToolRunOutcome, { kind: 'staged' }> {
  const errorText = error instanceof Error ? error.message : String(error)
  return {
    kind: 'staged',
    stagedResult: {
      toolCallId: execution.completedToolCall.id,
      toolName: execution.completedToolCall.name,
      toolSource: execution.toolDef?.source,
      serverName: execution.toolContext.serverName,
      toolArgs: execution.completedToolCall.arguments,
      responseText: `Error: ${errorText}`,
      isError: true,
      searchPayload: null,
      postHookKind: 'failure'
    },
    toolsChanged: false
  }
}

function buildReturnedToolResultOutcome(
  execution: ToolExecutionContext,
  rawData: MCPToolResponse
): Extract<ToolRunOutcome, { kind: 'staged' }> {
  const responseText = toolResponseToText(rawData.content)
  const isError = rawData.isError === true
  return {
    kind: 'staged',
    stagedResult: {
      toolCallId: execution.completedToolCall.id,
      toolName: execution.completedToolCall.name,
      toolSource: execution.toolDef?.source,
      serverName: execution.toolContext.serverName,
      toolArgs: execution.completedToolCall.arguments,
      responseText,
      isError,
      searchPayload: extractSearchPayload(
        rawData.content,
        execution.toolContext.name,
        execution.toolContext.serverName
      ),
      rtkApplied: rawData.rtkApplied,
      rtkMode: rawData.rtkMode,
      rtkFallbackReason: rawData.rtkFallbackReason,
      imagePreviews: rawData.imagePreviews,
      mcpResult: rawData.mcpResult,
      postHookKind: isError ? 'failure' : 'success'
    },
    toolsChanged: false
  }
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

function rescheduleRendererFlush(
  state: StreamState,
  rendererFlushHandle?: Pick<RendererFlushHandle, 'schedule' | 'rescheduleRenderer'>
): void {
  if (!state.dirty) {
    return
  }

  if (rendererFlushHandle?.rescheduleRenderer) {
    rendererFlushHandle.rescheduleRenderer()
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

function finalizePendingNarrativeBeforeToolSettlement(state: StreamState): void {
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
  batchToolCallBlocks: AssistantMessageBlock[]
  toolBlockStartIndex: number
  io: IoParams
  notificationObserver?: DeepChatLoopNotificationObserver
  appendToConversation: boolean
  takeInteractionOrder: () => number
}): ToolBatchInteraction[] {
  const {
    stagedResults,
    fittedResults,
    conversation,
    state,
    batchToolCallBlocks,
    toolBlockStartIndex,
    io,
    notificationObserver,
    appendToConversation,
    takeInteractionOrder
  } = params
  const interactions: ToolBatchInteraction[] = []

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

    const imagePresentation = prepareToolImagePreviewPresentation({
      toolCallId: stagedResult.toolCallId,
      toolName: stagedResult.toolName,
      toolSource: stagedResult.toolSource,
      serverName: stagedResult.serverName,
      isError: fittedResult.isError,
      imagePreviews: stagedResult.imagePreviews
    })
    updateToolCallBlock(
      batchToolCallBlocks,
      fittedResult.toolCallId,
      fittedResult.responseText,
      fittedResult.isError,
      fittedResult.downgraded
        ? undefined
        : {
            rtkApplied: stagedResult.rtkApplied,
            rtkMode: stagedResult.rtkMode,
            rtkFallbackReason: stagedResult.rtkFallbackReason
          },
      imagePresentation.toolBlockImagePreviews,
      stagedResult.mcpResult
    )
    if (stagedResult.skippedReason) {
      markToolCallSkipped(batchToolCallBlocks, stagedResult.toolCallId, stagedResult.skippedReason)
    }
    insertBlocksAfterToolCall(
      state.blocks,
      fittedResult.toolCallId,
      imagePresentation.promotedBlocks,
      toolBlockStartIndex
    )

    if (stagedResult.skillDraftPrompt && !fittedResult.isError && !fittedResult.downgraded) {
      const interaction = appendSkillDraftQuestionActionBlock(
        state,
        io,
        {
          id: stagedResult.toolCallId,
          name: stagedResult.toolName,
          args: stagedResult.toolArgs,
          serverName: stagedResult.serverName
        },
        stagedResult.skillDraftPrompt,
        takeInteractionOrder()
      )
      interactions.push(interaction)
    }

    if (fittedResult.isError) {
      emitDeepChatLoopNotification(notificationObserver, {
        event: 'PostToolUseFailure',
        tool: {
          callId: stagedResult.toolCallId,
          name: stagedResult.toolName,
          params: stagedResult.toolArgs,
          error: fittedResult.responseText
        }
      })
    } else if (stagedResult.postHookKind === 'success') {
      emitDeepChatLoopNotification(notificationObserver, {
        event: 'PostToolUse',
        tool: {
          callId: stagedResult.toolCallId,
          name: stagedResult.toolName,
          params: stagedResult.toolArgs,
          response: fittedResult.responseText
        }
      })
    }
  }

  state.dirty = true
  return interactions
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
): NonNullable<PendingToolInteraction['permission']> {
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
  controls: ProcessControlCollaborators | undefined,
  _conversationId: string,
  permission: NonNullable<PendingToolInteraction['permission']>
): Promise<void> {
  if (controls?.autoGrantPermission) {
    await controls.autoGrantPermission(permission)
  }
}

function getToolCapabilityPermissionMode(permissionMode: PermissionMode): PermissionMode {
  return permissionMode === 'auto_approve' ? 'full_access' : permissionMode
}

function collectStringValues(value: unknown, keys: Set<string>, results: string[]): void {
  if (!value || typeof value !== 'object') return
  if (Array.isArray(value)) {
    for (const item of value) {
      if (typeof item === 'string' && item.trim()) results.push(item)
      else collectStringValues(item, keys, results)
    }
    return
  }

  for (const [key, entry] of Object.entries(value)) {
    const normalizedKey = key.toLowerCase()
    if (typeof entry === 'string' && keys.has(normalizedKey) && entry.trim()) {
      results.push(entry)
      continue
    }
    if (Array.isArray(entry) && keys.has(normalizedKey)) {
      for (const item of entry) {
        if (typeof item === 'string' && item.trim()) results.push(item)
      }
      continue
    }
    collectStringValues(entry, keys, results)
  }
}

function parseToolArgs(toolArgs: string): Record<string, unknown> | null {
  if (!toolArgs.trim()) return null
  try {
    const parsed = JSON.parse(toolArgs) as unknown
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : null
  } catch {
    return null
  }
}

function extractToolArgPaths(toolArgs: string): string[] {
  const parsed = parseToolArgs(toolArgs)
  if (!parsed) return []
  const paths: string[] = []
  collectStringValues(
    parsed,
    new Set(['path', 'paths', 'file', 'files', 'filepath', 'filepaths', 'dir', 'cwd']),
    paths
  )
  return Array.from(new Set(paths))
}

function extractToolArgCommand(toolArgs: string): string | undefined {
  const parsed = parseToolArgs(toolArgs)
  if (!parsed) return undefined
  for (const key of ['command', 'cmd', 'script']) {
    const value = parsed[key]
    if (typeof value === 'string' && value.trim()) return value
  }
  return undefined
}

function isReviewableFullAccessToolCall(execution: ToolExecutionContext): boolean {
  if (execution.toolDef?.source !== 'agent') return false
  if (extractToolArgCommand(execution.toolContext.args)) return true
  const name = execution.toolContext.name.toLowerCase()
  if (
    [
      'read',
      'write',
      'edit',
      'delete',
      'remove',
      'exec',
      'bash',
      'shell',
      'terminal',
      'command',
      'process',
      'file',
      'search',
      'settings',
      'memory',
      'skill'
    ].some((part) => name.includes(part))
  ) {
    return true
  }
  return extractToolArgPaths(execution.toolContext.args).length > 0
}

function buildSyntheticPermissionForReview(
  execution: ToolExecutionContext
): NonNullable<PendingToolInteraction['permission']> {
  const name = execution.toolContext.name
  const lowerName = name.toLowerCase()
  const paths = extractToolArgPaths(execution.toolContext.args)
  const command = extractToolArgCommand(execution.toolContext.args)
  if (
    command ||
    ['bash', 'shell', 'terminal', 'command'].some((part) => lowerName.includes(part))
  ) {
    return {
      permissionType: 'command',
      description: `Auto-review requested approval for command tool ${name}.`,
      toolName: name,
      serverName: execution.toolContext.serverName,
      command,
      rememberable: false
    }
  }

  const permissionType: 'read' | 'write' | 'all' = ['read', 'search', 'list', 'find'].some((part) =>
    lowerName.includes(part)
  )
    ? 'read'
    : 'write'
  return {
    permissionType,
    description: `Auto-review requested approval for tool ${name}.`,
    toolName: name,
    serverName: paths.length > 0 ? 'agent-filesystem' : execution.toolContext.serverName,
    paths: paths.length > 0 ? paths : undefined,
    rememberable: false
  }
}

async function reviewAutoApproveAction(params: {
  controls: ProcessControlCollaborators | undefined
  io: IoParams
  state: StreamState
  batchToolCallBlocks: AssistantMessageBlock[]
  rendererFlushHandle: RendererFlushHandle
  execution: ToolExecutionContext
  permission: NonNullable<PendingToolInteraction['permission']>
  reason: 'tool_call' | 'precheck' | 'requires_permission'
}): Promise<'auto_allow' | 'ask_user'> {
  const {
    controls,
    io,
    state,
    batchToolCallBlocks,
    rendererFlushHandle,
    execution,
    permission,
    reason
  } = params
  const reviewToolPermission = controls?.reviewToolPermission
  if (!reviewToolPermission) {
    return 'ask_user'
  }

  if (setToolCallAutoApproveReviewing(batchToolCallBlocks, execution.completedToolCall.id, true)) {
    state.dirty = true
    rendererFlushHandle.flush()
  }
  try {
    const result = await reviewToolPermission({
      sessionId: io.sessionId,
      messageId: io.messageId,
      toolCallId: execution.completedToolCall.id,
      toolName: execution.toolContext.name,
      toolArgs: execution.toolContext.args,
      toolSource: execution.toolDef?.source ?? 'mcp',
      serverName: permission.serverName || execution.toolContext.serverName,
      permission,
      reason
    })
    io.abortSignal.throwIfAborted()

    if (!result || result.decision === 'ask_user') {
      return 'ask_user'
    }
    if (result.decision === 'block') {
      const rationale = result.rationale?.trim() || 'Auto-review blocked this action.'
      throw new Error(rationale)
    }
    if (result.decision === 'auto_allow') {
      return 'auto_allow'
    }
    return 'ask_user'
  } finally {
    if (
      setToolCallAutoApproveReviewing(batchToolCallBlocks, execution.completedToolCall.id, false)
    ) {
      state.dirty = true
      rendererFlushHandle.flush()
    }
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
  permission: NonNullable<PendingToolInteraction['permission']>,
  origin: Extract<PendingToolInteractionOrigin, 'pre-check-permission' | 'post-call-permission'>,
  order: number
): ToolBatchInteraction {
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
    origin,
    order,
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
  question: NonNullable<PendingToolInteraction['question']>,
  origin: Extract<PendingToolInteractionOrigin, 'question' | 'skill-draft-confirmation'>,
  order: number,
  extra?: Record<string, unknown>
): ToolBatchInteraction {
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
      questionResolution: 'asked',
      ...extra
    }
  })
  state.dirty = true
  return {
    type: 'question',
    origin,
    order,
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

function buildSkillDraftQuestion(
  _payload: SkillDraftPromptPayload
): NonNullable<PendingToolInteraction['question']> {
  return {
    header: 'chat.skillDraft.confirmationTitle',
    question: 'chat.skillDraft.confirmationQuestion',
    options: [
      {
        label: 'chat.skillDraft.actions.view',
        description: 'chat.skillDraft.actions.viewDescription'
      },
      {
        label: 'chat.skillDraft.actions.install',
        description: 'chat.skillDraft.actions.installDescription'
      },
      {
        label: 'chat.skillDraft.actions.discard',
        description: 'chat.skillDraft.actions.discardDescription'
      }
    ],
    custom: false,
    multiple: false
  }
}

function appendSkillDraftQuestionActionBlock(
  state: StreamState,
  io: IoParams,
  toolContext: ToolExecutionContext['toolContext'],
  payload: SkillDraftPromptPayload,
  order: number
): ToolBatchInteraction {
  const question = buildSkillDraftQuestion(payload)
  return appendQuestionActionBlock(
    state,
    io,
    toolContext,
    question,
    'skill-draft-confirmation',
    order,
    {
      skillDraftAction: 'confirm',
      skillDraftId: payload.draftId,
      skillDraftName: payload.skillName,
      skillDraftPreview: '',
      skillDraftStatus: 'pending'
    }
  )
}

function flushBlocksToRenderer(io: IoParams, blocks: AssistantMessageBlock[]): void {
  const renderedBlocks = cloneBlocksForRenderer(blocks)
  io.publishEvent('chat.stream.updated', {
    kind: 'snapshot',
    requestId: io.requestId,
    sessionId: io.sessionId,
    messageId: io.messageId,
    providerId: io.providerId,
    modelId: io.modelId,
    updatedAt: Date.now(),
    blocks: renderedBlocks
  })

  io.publishSessionUpdate({
    sessionId: io.sessionId,
    kind: 'blocks',
    updatedAt: Date.now(),
    messageId: io.messageId,
    previewMarkdown: buildAssistantPreviewMarkdown(blocks),
    responseMarkdown: buildAssistantResponseMarkdown(blocks),
    deliverySegments: buildAssistantDeliverySegments(io.messageId, blocks),
    waitingInteraction: extractWaitingInteraction(blocks, io.messageId)
  })
}

async function runToolCall(params: {
  execution: ToolExecutionContext
  toolExecution: ToolExecutionPort
  toolResults: ToolResultPort
  permissionMode: PermissionMode
  toolPermissionMode: PermissionMode
  controls?: ProcessControlCollaborators
  io: IoParams
  state: StreamState
  batchToolCallBlocks: AssistantMessageBlock[]
  rendererFlushHandle: RendererFlushHandle
  allowProgressUpdates: boolean
  onToolCallStarted?: (toolCallId: string) => void
}): Promise<ToolRunOutcome> {
  const {
    execution,
    toolExecution,
    toolResults,
    permissionMode,
    toolPermissionMode,
    controls,
    io,
    state,
    batchToolCallBlocks,
    rendererFlushHandle,
    allowProgressUpdates,
    onToolCallStarted
  } = params
  const { completedToolCall, toolCall, toolContext } = execution
  let returnedToolResult: MCPToolResponse | null = null

  try {
    io.abortSignal.throwIfAborted()
    const applyProgressUpdate = (update: AgentToolProgressUpdate) => {
      if (
        update.kind === 'agent_plan' &&
        update.toolCallId === completedToolCall.id &&
        allowProgressUpdates
      ) {
        markInternalPlanToolCallBlock(batchToolCallBlocks, completedToolCall.id)
        const snapshot: AgentPlanSnapshot = {
          ...update.snapshot,
          sessionId: io.sessionId,
          messageId: io.messageId,
          toolCallId: update.snapshot.toolCallId ?? completedToolCall.id
        }
        state.latestAgentPlanSnapshot = snapshot
        publishPlanUpdated(io, snapshot)
        state.dirty = true
        scheduleRendererFlush(state, rendererFlushHandle)
        return
      }

      if (
        !allowProgressUpdates ||
        update.kind !== 'subagent_orchestrator' ||
        update.toolCallId !== completedToolCall.id
      ) {
        return
      }

      updateSubagentToolCallBlock(
        batchToolCallBlocks,
        completedToolCall.id,
        update.responseMarkdown,
        update.progressJson
      )
      state.dirty = true
      scheduleRendererFlush(state, rendererFlushHandle)
    }

    let toolCallStarted = false
    const callTool = async () => {
      io.abortSignal.throwIfAborted()
      if (!toolCallStarted) {
        toolCallStarted = true
        onToolCallStarted?.(completedToolCall.id)
      }
      const enabledMcpServerIds = controls?.getEnabledMcpServerIds?.()
      const result = await toolExecution.execute(toolCall, {
        runId: io.requestId,
        onProgress: applyProgressUpdate,
        signal: io.abortSignal,
        permissionMode: toolPermissionMode,
        activeSkillNames: controls?.getActiveSkillNames?.(),
        agentId: controls?.getAgentId?.(),
        ...(enabledMcpServerIds === null || enabledMcpServerIds === undefined
          ? {}
          : { enabledMcpServerIds })
      })
      return result
    }

    let toolCallResult = await callTool()
    let toolRawData = toolCallResult.rawData

    if (toolRawData?.requiresPermission) {
      io.abortSignal.throwIfAborted()
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
          await autoGrantPermission(controls, io.sessionId, pendingPermission)
          toolCallResult = await callTool()
          toolRawData = toolCallResult.rawData
        } else if (permissionMode === 'auto_approve') {
          const review = await reviewAutoApproveAction({
            controls,
            io,
            state,
            batchToolCallBlocks,
            rendererFlushHandle,
            execution,
            permission: pendingPermission,
            reason: 'requires_permission'
          })
          if (review === 'auto_allow') {
            await autoGrantPermission(controls, io.sessionId, pendingPermission)
            toolCallResult = await callTool()
            toolRawData = toolCallResult.rawData
          } else {
            return {
              kind: 'permission',
              permission: pendingPermission,
              toolContext
            }
          }
        } else {
          return {
            kind: 'permission',
            permission: pendingPermission,
            toolContext
          }
        }
      }
    }

    // Never stage a permission payload as a successful tool result after auto-grant retry.
    if (toolRawData?.requiresPermission) {
      io.abortSignal.throwIfAborted()
      const pendingPermission = normalizePermissionRequest(
        toolRawData.permissionRequest as PermissionRequestLike | undefined,
        {
          toolName: toolContext.name,
          serverName: toolContext.serverName,
          description: `Permission required for ${toolContext.name}`
        }
      )
      if (pendingPermission) {
        return {
          kind: 'permission',
          permission: pendingPermission,
          toolContext
        }
      }
      return buildToolErrorOutcome(
        execution,
        new Error(`Tool ${toolContext.name} still requires permission after approval.`)
      )
    }

    returnedToolResult = toolRawData
    if (io.abortSignal.aborted) {
      return buildReturnedToolResultOutcome(execution, toolRawData)
    }

    const subagentState = extractSubagentToolState(toolRawData)
    if (allowProgressUpdates && (subagentState.subagentProgress || subagentState.subagentFinal)) {
      updateSubagentToolCallBlock(
        batchToolCallBlocks,
        completedToolCall.id,
        typeof toolRawData.content === 'string'
          ? toolRawData.content
          : toolResponseToText(toolRawData.content),
        subagentState.subagentProgress,
        subagentState.subagentFinal
      )
    }

    const imagePreviews =
      toolRawData.imagePreviews ??
      (await extractToolCallImagePreviews({
        toolName: completedToolCall.name,
        toolArgs: completedToolCall.arguments,
        content: toolRawData.content,
        cacheImage: controls?.cacheImage,
        signal: io.abortSignal
      }))

    toolRawData = {
      ...toolRawData,
      content: await toolResults.normalize({
        sessionId: io.sessionId,
        toolCallId: completedToolCall.id,
        toolName: completedToolCall.name,
        toolArgs: completedToolCall.arguments,
        content: toolRawData.content,
        isError: toolRawData.isError === true,
        ownerPluginId: toolRawData.ownerPluginId,
        signal: io.abortSignal
      })
    }
    io.abortSignal.throwIfAborted()

    const searchPayload = extractSearchPayload(
      toolRawData.content,
      toolContext.name,
      toolContext.serverName
    )

    const responseText = toolResponseToText(toolRawData.content)
    const preparedResult = await toolResults.prepare({
      sessionId: io.sessionId,
      toolCallId: completedToolCall.id,
      toolName: toolContext.name,
      rawContent: responseText
    })
    io.abortSignal.throwIfAborted()
    const stagedResponseText =
      preparedResult.kind === 'tool_error' ? preparedResult.message : preparedResult.content
    const stagedIsError = preparedResult.kind === 'tool_error' || toolRawData.isError === true

    const activatedSkill = extractActivatedSkillAfterCall(completedToolCall.name, toolRawData)
    if (activatedSkill) {
      await controls?.activateSkill?.(activatedSkill)
      io.abortSignal.throwIfAborted()
    }

    return {
      kind: 'staged',
      stagedResult: {
        toolCallId: completedToolCall.id,
        toolName: completedToolCall.name,
        toolSource: execution.toolDef?.source,
        serverName: toolContext.serverName,
        toolArgs: completedToolCall.arguments,
        responseText: stagedResponseText,
        isError: stagedIsError,
        offloadPath: preparedResult.kind === 'ok' ? preparedResult.offloadPath : undefined,
        searchPayload,
        rtkApplied: toolRawData.rtkApplied,
        rtkMode: toolRawData.rtkMode,
        rtkFallbackReason: toolRawData.rtkFallbackReason,
        imagePreviews,
        mcpResult: toolRawData.mcpResult,
        skillDraftPrompt: extractSkillDraftPromptPayload(toolRawData),
        postHookKind: stagedIsError ? 'failure' : 'success'
      },
      toolsChanged: Boolean(activatedSkill)
    }
  } catch (err) {
    if (io.abortSignal.aborted && returnedToolResult) {
      return buildReturnedToolResultOutcome(execution, returnedToolResult)
    }
    if (io.abortSignal.aborted) throw err
    return buildToolErrorOutcome(execution, err)
  }
}

export interface SettleToolBatchParams {
  state: StreamState
  conversation: ChatMessage[]
  prevBlockCount: number
  toolCalls: ToolCallResult[]
  disposition: ToolBatchDisposition
  tools: MCPToolDefinition[]
  toolExecution: ToolExecutionPort
  modelId: string
  interleavedReasoning: InterleavedReasoningConfig
  io: IoParams
  permissionMode: PermissionMode
  toolResults: ToolResultPort
  contextLength: number
  maxTokens: number
  rendererFlushHandle: RendererFlushHandle
  collaborators?: ToolDispatchCollaborators
  providerId?: string
}

export async function settleToolBatch(
  params: SettleToolBatchParams
): Promise<ToolBatchOutcome<ToolBatchInteraction>> {
  const {
    state,
    conversation,
    prevBlockCount,
    toolCalls,
    disposition,
    tools,
    toolExecution,
    modelId,
    interleavedReasoning,
    io,
    permissionMode,
    toolResults,
    contextLength,
    maxTokens,
    rendererFlushHandle,
    collaborators,
    providerId
  } = params
  const { notificationObserver, controls, diagnostics, onToolCallStarted } = collaborators ?? {}
  if (disposition.kind === 'execute') {
    io.abortSignal.throwIfAborted()
  }
  finalizePendingNarrativeBeforeToolSettlement(state)
  persistToolExecutionState(io, state, rendererFlushHandle)
  const batchToolCallBlocks = state.blocks
    .slice(prevBlockCount)
    .filter((block) => block.type === 'tool_call')
  const batchState = createToolBatchState(toolCalls)
  let nextInteractionOrder = 0
  const takeInteractionOrder = () => nextInteractionOrder++

  for (const tc of toolCalls) {
    const toolDef = tools.find((t) => t.function.name === tc.name)
    if (!toolDef) continue
    const block = batchToolCallBlocks.find((candidate) => candidate.tool_call?.id === tc.id)
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
    tool_calls: toolCalls.map((tc) => ({
      id: tc.id,
      type: 'function' as const,
      function: { name: tc.name, arguments: tc.arguments },
      ...(tc.providerOptions ? { provider_options: tc.providerOptions } : {})
    }))
  }

  const reasoning = extractReasoningFromBlocks(iterationBlocks)
  const shouldPreserveReasoning =
    interleavedReasoning.preserveReasoningContent &&
    (Boolean(reasoning) || interleavedReasoning.preserveEmptyReasoningContent === true)
  if (shouldPreserveReasoning) {
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
      toolCallCount: toolCalls.length
    }
    diagnostics?.onInterleavedReasoningGap?.(gapPayload)
    if (!diagnostics?.onInterleavedReasoningGap) {
      console.warn('[DeepChatDispatch] Missing interleaved reasoning portrait:', gapPayload)
    }
  }

  conversation.push(assistantMessage)

  let executed = 0
  let toolsChanged = false
  const pendingInteractions: ToolBatchInteraction[] = []
  const stagedResults: StagedToolResult[] = []

  if (disposition.kind === 'reject') {
    for (const toolCall of toolCalls) {
      const toolDef = tools.find((candidate) => candidate.function.name === toolCall.name)
      stagedResults.push({
        toolCallId: toolCall.id,
        toolName: toolCall.name,
        toolSource: toolDef?.source,
        serverName: toolDef?.server.name,
        toolArgs: toolCall.arguments,
        responseText: TRUNCATED_TOOL_CALL_ERROR,
        isError: true,
        searchPayload: null,
        postHookKind: 'failure',
        skippedReason: 'max_tokens'
      })
    }

    return await commitStagedToolResults({
      stagedResults,
      pendingInteractions,
      batchState,
      executed,
      toolsChanged,
      conversation,
      state,
      batchToolCallBlocks,
      toolBlockStartIndex: prevBlockCount,
      io,
      notificationObserver,
      takeInteractionOrder,
      toolResults,
      tools,
      contextLength,
      maxTokens,
      rendererFlushHandle
    })
  }

  const toolPermissionMode = getToolCapabilityPermissionMode(permissionMode)

  const batchExecutionMode = selectToolBatchExecutionMode({
    permissionMode,
    toolCalls,
    toolDefinitions: tools
  })

  if (batchExecutionMode === 'parallel') {
    const executions = toolCalls.map((tc) =>
      buildToolExecutionContext(tc, tools, io.sessionId, providerId)
    )

    const settledOutcomes = await Promise.allSettled(
      executions.map(async (execution) => {
        try {
          if (toolExecution.preCheck) {
            const preChecked = await toolExecution.preCheck(execution.toolCall, {
              permissionMode: toolPermissionMode,
              signal: io.abortSignal
            })
            io.abortSignal.throwIfAborted()
            if (preChecked?.needsPermission) {
              const permission = normalizePermissionRequest(preChecked as PermissionRequestLike, {
                toolName: execution.toolContext.name,
                serverName: execution.toolContext.serverName,
                description: `Permission required for ${execution.toolContext.name}`
              })
              if (permission) {
                await autoGrantPermission(controls, io.sessionId, permission)
                io.abortSignal.throwIfAborted()
              }
            }
          }

          emitDeepChatLoopNotification(notificationObserver, {
            event: 'PreToolUse',
            tool: {
              callId: execution.completedToolCall.id,
              name: execution.completedToolCall.name,
              params: execution.completedToolCall.arguments
            }
          })

          return await runToolCall({
            execution,
            toolExecution,
            toolResults,
            permissionMode,
            toolPermissionMode,
            controls,
            io,
            state,
            batchToolCallBlocks,
            rendererFlushHandle,
            allowProgressUpdates: false,
            onToolCallStarted
          })
        } catch (error) {
          if (io.abortSignal.aborted) throw error
          return buildToolErrorOutcome(execution, error)
        }
      })
    )
    const outcomes: ToolRunOutcome[] = []
    let cancellationError: unknown
    for (const outcome of settledOutcomes) {
      if (outcome.status === 'fulfilled') {
        outcomes.push(outcome.value)
      } else if (io.abortSignal.aborted) {
        cancellationError ??= outcome.reason
      } else {
        throw outcome.reason
      }
    }

    for (const outcome of outcomes) {
      batchState.invokedCallIds.add(
        outcome.kind === 'permission' ? outcome.toolContext.id : outcome.stagedResult.toolCallId
      )
      if (outcome.kind === 'permission') {
        emitDeepChatLoopNotification(notificationObserver, {
          event: 'PermissionRequest',
          permission: outcome.permission,
          tool: {
            callId: outcome.toolContext.id,
            name: outcome.toolContext.name,
            params: outcome.toolContext.args
          }
        })
        const interaction = appendPermissionActionBlock(
          state,
          io,
          outcome.toolContext,
          outcome.permission,
          'post-call-permission',
          takeInteractionOrder()
        )
        pendingInteractions.push(interaction)
        updateToolCallBlock(batchToolCallBlocks, outcome.toolContext.id, '', false)
        rescheduleRendererFlush(state, rendererFlushHandle)
        continue
      }

      stagedResults.push(outcome.stagedResult)
      toolsChanged = toolsChanged || outcome.toolsChanged
      executed += 1
    }

    if (cancellationError && stagedResults.length === 0) {
      throw cancellationError
    }

    return await commitStagedToolResults({
      stagedResults,
      pendingInteractions,
      batchState,
      executed,
      toolsChanged,
      conversation,
      state,
      batchToolCallBlocks,
      toolBlockStartIndex: prevBlockCount,
      io,
      notificationObserver,
      takeInteractionOrder,
      toolResults,
      tools,
      contextLength,
      maxTokens,
      rendererFlushHandle
    })
  }

  for (const tc of toolCalls) {
    if (io.abortSignal.aborted && stagedResults.length > 0) {
      break
    }
    io.abortSignal.throwIfAborted()

    const execution = buildToolExecutionContext(tc, tools, io.sessionId, providerId)
    const { toolCall, toolContext } = execution

    if (!execution.toolDef) {
      stagedResults.push({
        toolCallId: tc.id,
        toolName: tc.name,
        toolArgs: tc.arguments,
        responseText: `Error: Tool is not available in the current session: ${tc.name}`,
        isError: true,
        searchPayload: null,
        postHookKind: 'failure'
      })
      executed += 1
      continue
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
          updateToolCallBlock(batchToolCallBlocks, tc.id, errorText, true)
          state.dirty = true
          batchState.committedResultCallIds.add(tc.id)
          executed += 1
          persistToolExecutionState(io, state, rendererFlushHandle)
          continue
        }

        const interaction = appendQuestionActionBlock(
          state,
          io,
          toolContext,
          {
            header: parsedQuestion.data.header,
            question: parsedQuestion.data.question,
            options: parsedQuestion.data.options,
            custom: parsedQuestion.data.custom !== false,
            multiple: Boolean(parsedQuestion.data.multiple)
          },
          'question',
          takeInteractionOrder()
        )
        pendingInteractions.push(interaction)
        updateToolCallBlock(batchToolCallBlocks, tc.id, '', false)
        rescheduleRendererFlush(state, rendererFlushHandle)
        continue
      }

      let preCheckedPermission: PendingToolInteraction['permission'] | null = null
      if (toolExecution.preCheck) {
        const preChecked = await toolExecution.preCheck(toolCall, {
          permissionMode: toolPermissionMode,
          signal: io.abortSignal
        })
        io.abortSignal.throwIfAborted()
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
          await autoGrantPermission(controls, io.sessionId, preCheckedPermission)
          io.abortSignal.throwIfAborted()
        } else if (permissionMode === 'auto_approve') {
          const review = await reviewAutoApproveAction({
            controls,
            io,
            state,
            batchToolCallBlocks,
            rendererFlushHandle,
            execution,
            permission: preCheckedPermission,
            reason: 'precheck'
          })
          if (review === 'auto_allow') {
            await autoGrantPermission(controls, io.sessionId, preCheckedPermission)
            io.abortSignal.throwIfAborted()
          } else {
            emitDeepChatLoopNotification(notificationObserver, {
              event: 'PermissionRequest',
              permission: preCheckedPermission,
              tool: {
                callId: tc.id,
                name: tc.name,
                params: tc.arguments
              }
            })
            const interaction = appendPermissionActionBlock(
              state,
              io,
              toolContext,
              preCheckedPermission,
              'pre-check-permission',
              takeInteractionOrder()
            )
            pendingInteractions.push(interaction)
            updateToolCallBlock(batchToolCallBlocks, tc.id, '', false)
            rescheduleRendererFlush(state, rendererFlushHandle)
            continue
          }
        } else {
          emitDeepChatLoopNotification(notificationObserver, {
            event: 'PermissionRequest',
            permission: preCheckedPermission,
            tool: {
              callId: tc.id,
              name: tc.name,
              params: tc.arguments
            }
          })
          const interaction = appendPermissionActionBlock(
            state,
            io,
            toolContext,
            preCheckedPermission,
            'pre-check-permission',
            takeInteractionOrder()
          )
          pendingInteractions.push(interaction)
          updateToolCallBlock(batchToolCallBlocks, tc.id, '', false)
          rescheduleRendererFlush(state, rendererFlushHandle)
          continue
        }
      }

      if (
        permissionMode === 'auto_approve' &&
        !preCheckedPermission &&
        isReviewableFullAccessToolCall(execution)
      ) {
        const reviewPermission = buildSyntheticPermissionForReview(execution)
        const review = await reviewAutoApproveAction({
          controls,
          io,
          state,
          batchToolCallBlocks,
          rendererFlushHandle,
          execution,
          permission: reviewPermission,
          reason: 'tool_call'
        })
        if (review !== 'auto_allow') {
          emitDeepChatLoopNotification(notificationObserver, {
            event: 'PermissionRequest',
            permission: reviewPermission,
            tool: {
              callId: tc.id,
              name: tc.name,
              params: tc.arguments
            }
          })
          const interaction = appendPermissionActionBlock(
            state,
            io,
            toolContext,
            reviewPermission,
            'pre-check-permission',
            takeInteractionOrder()
          )
          pendingInteractions.push(interaction)
          updateToolCallBlock(batchToolCallBlocks, tc.id, '', false)
          rescheduleRendererFlush(state, rendererFlushHandle)
          continue
        }
      }

      emitDeepChatLoopNotification(notificationObserver, {
        event: 'PreToolUse',
        tool: {
          callId: tc.id,
          name: tc.name,
          params: tc.arguments
        }
      })

      const outcome = await runToolCall({
        execution,
        toolExecution,
        toolResults,
        permissionMode,
        toolPermissionMode,
        controls,
        io,
        state,
        batchToolCallBlocks,
        rendererFlushHandle,
        allowProgressUpdates: true,
        onToolCallStarted
      })
      batchState.invokedCallIds.add(tc.id)

      if (outcome.kind === 'permission') {
        emitDeepChatLoopNotification(notificationObserver, {
          event: 'PermissionRequest',
          permission: outcome.permission,
          tool: {
            callId: tc.id,
            name: tc.name,
            params: tc.arguments
          }
        })
        const interaction = appendPermissionActionBlock(
          state,
          io,
          toolContext,
          outcome.permission,
          'post-call-permission',
          takeInteractionOrder()
        )
        pendingInteractions.push(interaction)
        updateToolCallBlock(batchToolCallBlocks, tc.id, '', false)
        rescheduleRendererFlush(state, rendererFlushHandle)
        continue
      }

      stagedResults.push(outcome.stagedResult)
      toolsChanged = toolsChanged || outcome.toolsChanged
      executed += 1
    } catch (err) {
      if (io.abortSignal.aborted) {
        if (stagedResults.length > 0) {
          break
        }
        throw err
      }
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

  return await commitStagedToolResults({
    stagedResults,
    pendingInteractions,
    batchState,
    executed,
    toolsChanged,
    conversation,
    state,
    batchToolCallBlocks,
    toolBlockStartIndex: prevBlockCount,
    io,
    notificationObserver,
    takeInteractionOrder,
    toolResults,
    tools,
    contextLength,
    maxTokens,
    rendererFlushHandle
  })
}

function stampGenerationTiming(state: StreamState): void {
  state.metadata.generationTime = Math.max(0, Date.now() - state.startTime)
  if (state.firstTokenTime !== null) {
    state.metadata.firstTokenTime = Math.max(0, state.firstTokenTime - state.startTime)
  }
  if (state.metadata.outputTokens && state.metadata.generationTime > 0) {
    state.metadata.tokensPerSecond = Math.round(
      (state.metadata.outputTokens / state.metadata.generationTime) * 1000
    )
  }
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

  stampGenerationTiming(state)

  io.messageStore.updateAssistantContent(io.messageId, state.blocks, JSON.stringify(state.metadata))
  flushBlocksToRenderer(io, state.blocks)
  io.publishEvent('chat.stream.completed', {
    requestId: io.requestId,
    sessionId: io.sessionId,
    messageId: io.messageId,
    completedAt: Date.now()
  })
}

export function finalize(state: StreamState, io: IoParams): void {
  for (const block of state.blocks) {
    if (block.status === 'pending') block.status = 'success'
  }
  stampPlanTerminalIfOpen(state, io, state.planTerminalReason)

  stampGenerationTiming(state)

  io.messageStore.finalizeAssistantMessage(
    io.messageId,
    state.blocks,
    JSON.stringify(state.metadata)
  )
  flushBlocksToRenderer(io, state.blocks)
  io.publishEvent('chat.stream.completed', {
    requestId: io.requestId,
    sessionId: io.sessionId,
    messageId: io.messageId,
    completedAt: Date.now()
  })
}

export function finalizeError(state: StreamState, io: IoParams, error: unknown): void {
  const errorMessage = error instanceof Error ? error.message : String(error)
  state.blocks = buildTerminalErrorBlocks(state.blocks, errorMessage)
  stampPlanTerminalIfOpen(
    state,
    io,
    errorMessage === USER_CANCELED_GENERATION_ERROR ? 'aborted' : 'error'
  )

  stampGenerationTiming(state)

  io.messageStore.setMessageError(io.messageId, state.blocks, JSON.stringify(state.metadata))
  flushBlocksToRenderer(io, state.blocks)
  io.publishEvent('chat.stream.failed', {
    requestId: io.requestId,
    sessionId: io.sessionId,
    messageId: io.messageId,
    failedAt: Date.now(),
    error: errorMessage
  })
}

export function persistAbortExceptionPlanState(state: StreamState, io: IoParams): void {
  const hadPlanSnapshot = Boolean(state.latestAgentPlanSnapshot)
  stampPlanTerminalIfOpen(state, io, 'aborted')

  if (!hadPlanSnapshot || state.blocks.length === 0) {
    return
  }

  io.messageStore.updateAssistantContent(io.messageId, state.blocks)
  flushBlocksToRenderer(io, state.blocks)
}
