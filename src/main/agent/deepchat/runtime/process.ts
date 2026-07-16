import logger from '@shared/logger'
import type { AssistantMessageBlock } from '@shared/types/agent-interface'
import type { ChatMessage } from '@shared/types/core/chat-message'
import type { PermissionRequestPayload } from '@shared/types/core/llm-events'
import type {
  IoParams,
  PendingToolInteraction,
  ProcessParams,
  ProcessResult,
  StreamState
} from './types'
import { accumulate, commitRoundUsage, finalizeTrailingPendingNarrativeBlocks } from './accumulator'
import { startEcho } from './echo'
import {
  executeTools,
  finalize,
  finalizeError,
  finalizePaused,
  publishPlanUpdated
} from './dispatch'
import { isContextWindowErrorLike } from './contextWindowError'
import {
  extractLatestCompletedToolBatch,
  NoProgressToolLoopGuard,
  NO_PROGRESS_TERMINAL_ERROR
} from './noProgressToolLoopGuard'
import {
  DeepChatLoopEngine,
  type DeepChatLoopCommitCallbacks,
  type DeepChatLoopOutcome
} from '@/agent/deepchat/loop/deepChatLoopEngine'
import { emitDeepChatLoopNotification } from '@/agent/deepchat/loop/notificationObserver'
import type { OutputSink } from '@/agent/deepchat/loop/ports'
import { buildTapeToolFactInputs } from '@/session/data/tapeFacts'

const UNKNOWN_CONTEXT_LIMIT = Number.MAX_SAFE_INTEGER
const USER_CANCELED_GENERATION_ERROR = 'common.error.userCanceledGeneration'
export const NO_MODEL_RESPONSE_ERROR = 'common.error.noModelResponse'
export const INCOMPLETE_PROVIDER_STREAM_ERROR =
  'Provider stream ended without a terminal stop event.'
export const INCOMPLETE_TOOL_USE_ERROR =
  'Provider requested tool use without a completed tool call.'
const deepChatLoopEngine = new DeepChatLoopEngine()
type PendingPermissionPayload = NonNullable<PendingToolInteraction['permission']>
type PendingPermissionCommandInfo = NonNullable<PendingPermissionPayload['commandInfo']>
type ToolRoundBatch = { prevBlockCount: number }

class MaxProviderRoundsError extends Error {
  constructor(limit: number) {
    super(`Maximum agent turns exceeded (${limit}).`)
    this.name = 'MaxProviderRoundsError'
  }
}

function isAbortError(error: unknown): boolean {
  return error instanceof Error && (error.name === 'AbortError' || error.name === 'CanceledError')
}

function getLatestErrorMessage(state: StreamState): string | null {
  for (let index = state.blocks.length - 1; index >= 0; index -= 1) {
    const block = state.blocks[index]
    if (block.type === 'error' && typeof block.content === 'string' && block.content.trim()) {
      return block.content
    }
  }
  return null
}

function stripTrailingErrorBlock(state: StreamState, message: string): void {
  const lastBlock = state.blocks[state.blocks.length - 1]
  if (lastBlock?.type === 'error' && lastBlock.content === message) {
    state.blocks.pop()
  }
}

export const MAX_TOOL_CALLS_SKIPPED_ERROR =
  'Tool call was not executed because the maximum tool-call limit was reached.'

function stampRunAccounting(state: StreamState): void {
  state.metadata.providerRounds = state.providerRoundCount
  state.metadata.toolCalls = state.toolCallCount
}

function stampRunOutcome(
  state: StreamState,
  outcome: 'completed' | 'paused' | 'aborted' | 'error',
  stopReason: string
): void {
  state.metadata.runOutcome = outcome
  state.metadata.runStopReason = stopReason
}

function toNonNegativeNumber(value: number | undefined): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : undefined
}

function toPositiveInteger(value: number | undefined): number | undefined {
  return typeof value === 'number' && Number.isInteger(value) && value > 0 ? value : undefined
}

function markUnexecutedToolCallsForLimit(state: StreamState): void {
  const unexecutedIds = new Set(state.completedToolCalls.map((toolCall) => toolCall.id))
  for (const block of state.blocks) {
    if (
      block.type !== 'tool_call' ||
      !block.tool_call?.id ||
      !unexecutedIds.has(block.tool_call.id) ||
      (block.status !== 'pending' && block.status !== 'loading')
    ) {
      continue
    }

    block.status = 'error'
    block.tool_call.response = MAX_TOOL_CALLS_SKIPPED_ERROR
    block.extra = {
      ...block.extra,
      toolCallSkippedReason: 'max_tool_calls'
    }
    state.dirty = true
  }
}

export type ProviderTerminalDecision =
  | {
      type: 'complete'
      stopReason: 'complete' | 'max_tokens' | 'max_turn_requests'
    }
  | {
      type: 'error'
      error: string
      source: 'context' | 'empty' | 'provider'
      stopReason: 'context_window' | 'empty_response' | 'provider_error'
    }

export function resolveProviderTerminalDecision(state: StreamState): ProviderTerminalDecision {
  const stopReason = state.stopReason
  if (stopReason === 'error') {
    const streamErrorMessage = getLatestErrorMessage(state) ?? NO_MODEL_RESPONSE_ERROR
    if (isContextWindowErrorLike(streamErrorMessage)) {
      stripTrailingErrorBlock(state, streamErrorMessage)
      return {
        type: 'error',
        error: streamErrorMessage,
        source: 'context',
        stopReason: 'context_window'
      }
    }
    return {
      type: 'error',
      error: streamErrorMessage,
      source: 'provider',
      stopReason: 'provider_error'
    }
  }
  if (stopReason === null) {
    return {
      type: 'error',
      error: INCOMPLETE_PROVIDER_STREAM_ERROR,
      source: 'provider',
      stopReason: 'provider_error'
    }
  }
  if (state.blocks.length === 0 && !state.latestAgentPlanSnapshot) {
    return {
      type: 'error',
      error: NO_MODEL_RESPONSE_ERROR,
      source: 'empty',
      stopReason: 'empty_response'
    }
  }
  switch (stopReason) {
    case 'complete':
    case 'max_tokens':
    case 'max_turn_requests':
      return { type: 'complete', stopReason }
    case 'tool_use':
      return {
        type: 'error',
        error: INCOMPLETE_TOOL_USE_ERROR,
        source: 'provider',
        stopReason: 'provider_error'
      }
  }
  const unsupportedStopReason: never = stopReason
  throw new Error(`Unsupported provider stop reason: ${String(unsupportedStopReason)}`)
}

function parseAssistantBlocks(rawContent: string): AssistantMessageBlock[] {
  try {
    const parsed = JSON.parse(rawContent) as AssistantMessageBlock[]
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return []
  }
}

function isTerminalPendingStatus(status: AssistantMessageBlock['status']): boolean {
  return status === 'pending' || status === 'loading'
}

function isUserCanceledAlreadyFinalized(io: IoParams): boolean {
  const message = io.messageStore.getMessage(io.messageId)
  if (!message || message.role !== 'assistant' || message.status !== 'error') {
    return false
  }

  const blocks = parseAssistantBlocks(message.content)
  if (blocks.length === 0) {
    return false
  }

  if (blocks.some((block) => isTerminalPendingStatus(block.status))) {
    return false
  }

  return blocks.some(
    (block) => block.type === 'error' && block.content === USER_CANCELED_GENERATION_ERROR
  )
}

function finalizeUserCanceledErrorIfNeeded(state: StreamState, io: IoParams): void {
  if (isUserCanceledAlreadyFinalized(io)) {
    return
  }

  finalizeError(state, io, USER_CANCELED_GENERATION_ERROR)
}

function normalizeProviderPermissionType(
  permissionType: unknown
): 'read' | 'write' | 'all' | 'command' {
  return permissionType === 'read' ||
    permissionType === 'write' ||
    permissionType === 'all' ||
    permissionType === 'command'
    ? permissionType
    : 'write'
}

function parseStreamingPermissionPaths(raw: unknown): string[] | undefined {
  if (!Array.isArray(raw)) {
    return undefined
  }

  const paths = raw.filter(
    (item): item is string => typeof item === 'string' && item.trim().length > 0
  )
  return paths.length > 0 ? paths : undefined
}

function parseStreamingPermissionCommandInfo(
  raw: unknown
): PendingPermissionCommandInfo | undefined {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return undefined
  }

  const value = raw as Record<string, unknown>
  if (typeof value.command !== 'string' || !value.command.trim()) {
    return undefined
  }

  const riskLevel =
    value.riskLevel === 'low' ||
    value.riskLevel === 'medium' ||
    value.riskLevel === 'high' ||
    value.riskLevel === 'critical'
      ? value.riskLevel
      : 'medium'

  return {
    command: value.command.trim(),
    riskLevel,
    suggestion: typeof value.suggestion === 'string' ? value.suggestion.trim() : '',
    ...(typeof value.signature === 'string' && value.signature.trim()
      ? { signature: value.signature.trim() }
      : {}),
    ...(typeof value.baseCommand === 'string' && value.baseCommand.trim()
      ? { baseCommand: value.baseCommand.trim() }
      : {})
  }
}

function toStreamingProviderPermission(
  permission: PermissionRequestPayload
): PendingPermissionPayload {
  const toolName =
    typeof permission.tool_call_name === 'string' && permission.tool_call_name.trim()
      ? permission.tool_call_name.trim()
      : undefined
  const serverName =
    typeof permission.server_name === 'string' && permission.server_name.trim()
      ? permission.server_name.trim()
      : undefined
  const providerId =
    typeof permission.providerId === 'string' && permission.providerId.trim()
      ? permission.providerId.trim()
      : undefined
  const requestId =
    typeof permission.requestId === 'string' && permission.requestId.trim()
      ? permission.requestId.trim()
      : undefined
  const command =
    typeof permission.command === 'string' && permission.command.trim()
      ? permission.command.trim()
      : undefined
  const commandSignature =
    typeof permission.commandSignature === 'string' && permission.commandSignature.trim()
      ? permission.commandSignature.trim()
      : undefined
  const paths = parseStreamingPermissionPaths(permission.paths)
  const commandInfo = parseStreamingPermissionCommandInfo(permission.commandInfo)
  const metadata =
    permission.metadata &&
    typeof permission.metadata === 'object' &&
    !Array.isArray(permission.metadata)
      ? (permission.metadata as Record<string, unknown>)
      : undefined
  const permissionType = normalizeProviderPermissionType(permission.permissionType)

  return {
    permissionType,
    description:
      typeof permission.description === 'string' && permission.description.trim()
        ? permission.description
        : `components.messageBlockPermissionRequest.description.${permissionType}`,
    ...(toolName ? { toolName } : {}),
    ...(serverName ? { serverName } : {}),
    ...(providerId ? { providerId } : {}),
    ...(requestId ? { requestId } : {}),
    ...(command ? { command } : {}),
    ...(commandSignature ? { commandSignature } : {}),
    ...(paths ? { paths } : {}),
    ...(commandInfo ? { commandInfo } : {}),
    ...(metadata?.rememberable === false ? { rememberable: false } : {})
  }
}

export function appendStreamingProviderPermissionBlock(
  state: StreamState,
  permissionPayload: PermissionRequestPayload
): {
  actionBlock: AssistantMessageBlock
  permission: PendingPermissionPayload
  tool: {
    callId?: string
    name?: string
    params?: string
  }
} {
  const permission = toStreamingProviderPermission(permissionPayload)
  const toolCallId =
    typeof permissionPayload.tool_call_id === 'string' && permissionPayload.tool_call_id.trim()
      ? permissionPayload.tool_call_id.trim()
      : permission.requestId || 'acp-permission'
  const toolArgs =
    typeof permissionPayload.tool_call_params === 'string' ? permissionPayload.tool_call_params : ''
  const toolName = permission.toolName || toolCallId
  finalizeTrailingPendingNarrativeBlocks(state.blocks)
  const actionBlock: AssistantMessageBlock = {
    type: 'action',
    content: permission.description,
    status: 'pending',
    timestamp: Date.now(),
    action_type: 'tool_call_permission',
    tool_call: {
      id: toolCallId,
      name: toolName,
      params: toolArgs,
      ...(permission.serverName ? { server_name: permission.serverName } : {}),
      ...(typeof permissionPayload.server_description === 'string'
        ? { server_description: permissionPayload.server_description }
        : {}),
      ...(typeof permissionPayload.server_icons === 'string'
        ? { server_icons: permissionPayload.server_icons }
        : {})
    },
    extra: {
      needsUserAction: true,
      permissionType: permission.permissionType,
      ...(permission.toolName ? { toolName: permission.toolName } : {}),
      ...(permission.serverName ? { serverName: permission.serverName } : {}),
      ...(permission.providerId ? { providerId: permission.providerId } : {}),
      ...(permission.requestId ? { permissionRequestId: permission.requestId } : {}),
      permissionRequest: JSON.stringify(permission),
      ...(permission.rememberable === false ? { rememberable: false } : {})
    }
  }

  state.blocks.push(actionBlock)
  state.dirty = true

  return {
    actionBlock,
    permission,
    tool: {
      callId: toolCallId,
      name: toolName,
      params: toolArgs
    }
  }
}

function replaceLeadingSystemMessage(messages: ChatMessage[], systemPrompt: string): void {
  if (!systemPrompt) {
    return
  }

  if (messages[0]?.role === 'system') {
    messages[0] = { ...messages[0], content: systemPrompt }
    return
  }

  messages.unshift({ role: 'system', content: systemPrompt })
}

function commitCorrectedToolMessage(
  conversationMessages: ChatMessage[],
  batchMessages: ChatMessage[]
): void {
  const correctedMessage = batchMessages.findLast((message) => message.role === 'tool')
  if (!correctedMessage?.tool_call_id) return

  const messageIndex = conversationMessages.findLastIndex(
    (message) => message.role === 'tool' && message.tool_call_id === correctedMessage.tool_call_id
  )
  if (messageIndex >= 0) {
    conversationMessages[messageIndex] = correctedMessage
  }
}

export function markStreamingProviderPermissionResolved(
  block: AssistantMessageBlock,
  granted: boolean,
  permissionType: 'read' | 'write' | 'all' | 'command'
): void {
  block.status = granted ? 'granted' : 'denied'
  block.extra = {
    ...block.extra,
    needsUserAction: false,
    ...(granted ? { grantedPermissions: permissionType } : {})
  }
  if (!granted) {
    block.content = 'User denied the request.'
  }
}

function settleLoopOutcome(
  outcome: DeepChatLoopOutcome<ProcessResult>,
  state: StreamState,
  io: IoParams,
  eventCount: number,
  run: ProcessParams['run'],
  outputSink: OutputSink
): ProcessResult {
  stampRunAccounting(state)
  if (outcome.type === 'thrown') {
    commitRoundUsage(state)
    if (io.abortSignal.aborted || isAbortError(outcome.error)) {
      logger.info(`[ProcessStream] aborted via exception after ${eventCount} events`)
      stampRunOutcome(state, 'aborted', 'user_stop')
      finalizeUserCanceledErrorIfNeeded(state, io)
      return {
        status: 'aborted',
        stopReason: 'user_stop',
        errorMessage: USER_CANCELED_GENERATION_ERROR,
        usage: buildUsageSnapshot(state)
      }
    }

    if (outcome.error instanceof MaxProviderRoundsError) {
      logger.info(`[ProcessStream] ${outcome.error.message}`)
      stampRunOutcome(state, 'error', 'max_turns')
      outputSink.fail({
        runId: run.runId,
        sessionId: run.sessionId,
        messageId: run.messageId,
        error: outcome.error
      })
      return {
        status: 'error',
        terminalError: outcome.error.message,
        stopReason: 'max_turns',
        errorMessage: outcome.error.message,
        usage: buildUsageSnapshot(state)
      }
    }

    console.error(`[ProcessStream] exception after ${eventCount} events:`, outcome.error)
    const errorMessage =
      outcome.error instanceof Error ? outcome.error.message : String(outcome.error)
    const contextWindowError = isContextWindowErrorLike(outcome.error)
    const stopReason = contextWindowError ? 'context_window' : 'provider_error'
    stampRunOutcome(state, 'error', stopReason)
    outputSink.fail({
      runId: run.runId,
      sessionId: run.sessionId,
      messageId: run.messageId,
      error: outcome.error
    })
    return {
      status: 'error',
      terminalError: errorMessage,
      stopReason,
      errorMessage,
      usage: buildUsageSnapshot(state)
    }
  }

  if (outcome.type === 'halted') {
    const result = outcome.result
    if (result.status === 'paused') {
      stampRunOutcome(state, 'paused', result.stopReason ?? 'interaction')
      finalizePaused(state, io)
    } else if (result.status === 'aborted') {
      stampRunOutcome(state, 'aborted', result.stopReason ?? 'user_stop')
      finalizeUserCanceledErrorIfNeeded(state, io)
    } else if (result.status === 'error') {
      stampRunOutcome(
        state,
        'error',
        result.stopReason ?? (result.terminalError ? 'tool_error' : 'provider_error')
      )
      outputSink.fail({
        runId: run.runId,
        sessionId: run.sessionId,
        messageId: run.messageId,
        error: result.terminalError ?? result.errorMessage ?? 'Unknown error'
      })
    } else {
      stampRunOutcome(state, 'completed', result.stopReason ?? 'complete')
      outputSink.complete({
        runId: run.runId,
        sessionId: run.sessionId,
        messageId: run.messageId,
        blocks: state.blocks,
        metadata: { ...state.metadata }
      })
    }
    return result
  }

  if (outcome.type === 'max_provider_rounds') {
    const errorMessage = `Maximum agent turns exceeded (${outcome.limit}).`
    logger.info(`[ProcessStream] ${errorMessage}`)
    stampRunOutcome(state, 'error', 'max_turns')
    outputSink.fail({
      runId: run.runId,
      sessionId: run.sessionId,
      messageId: run.messageId,
      error: errorMessage
    })
    return {
      status: 'error',
      terminalError: errorMessage,
      stopReason: 'max_turns',
      errorMessage,
      usage: buildUsageSnapshot(state)
    }
  }

  if (io.abortSignal.aborted) {
    stampRunOutcome(state, 'aborted', 'user_stop')
    finalizeUserCanceledErrorIfNeeded(state, io)
    return {
      status: 'aborted',
      stopReason: 'user_stop',
      errorMessage: USER_CANCELED_GENERATION_ERROR,
      usage: buildUsageSnapshot(state)
    }
  }
  if (outcome.type === 'max_tool_calls') {
    logger.info(
      `[ProcessStream] max tool calls reached (${outcome.attemptedToolCount} > ${outcome.limit}), stopping`
    )
    state.planTerminalReason = 'max_steps'
    markUnexecutedToolCallsForLimit(state)
    stampRunOutcome(state, 'completed', 'max_tool_calls')
    outputSink.complete({
      runId: run.runId,
      sessionId: run.sessionId,
      messageId: run.messageId,
      blocks: state.blocks,
      metadata: { ...state.metadata }
    })
    return {
      status: 'completed',
      stopReason: 'max_tool_calls',
      usage: buildUsageSnapshot(state)
    }
  }
  const terminalDecision = resolveProviderTerminalDecision(state)
  if (terminalDecision.type === 'error') {
    stampRunOutcome(state, 'error', terminalDecision.stopReason)
    outputSink.fail({
      runId: run.runId,
      sessionId: run.sessionId,
      messageId: run.messageId,
      error: terminalDecision.error
    })
    return {
      status: 'error',
      terminalError: terminalDecision.error,
      stopReason: terminalDecision.stopReason,
      errorMessage: terminalDecision.error,
      usage: buildUsageSnapshot(state)
    }
  }

  stampRunOutcome(state, 'completed', terminalDecision.stopReason)
  outputSink.complete({
    runId: run.runId,
    sessionId: run.sessionId,
    messageId: run.messageId,
    blocks: state.blocks,
    metadata: { ...state.metadata }
  })
  return {
    status: 'completed',
    stopReason: terminalDecision.stopReason,
    usage: buildUsageSnapshot(state)
  }
}

/**
 * Unified stream processor. Handles both simple completions and multi-turn
 * tool-calling loops in a single code path.
 */
export async function processStream(params: ProcessParams): Promise<ProcessResult> {
  const {
    run,
    toolCatalog,
    toolExecution,
    toolResults,
    coreStream,
    providerId,
    modelId,
    modelConfig,
    temperature,
    maxTokens,
    interleavedReasoning,
    permissionMode,
    initialBlocks,
    notificationObserver,
    controls,
    diagnostics
  } = params
  const io: IoParams = {
    sessionId: run.sessionId,
    requestId: run.runId,
    messageId: run.messageId,
    providerId,
    modelId,
    messageStore: params.io.messageStore,
    abortSignal: run.abortController.signal,
    publishEvent: params.io.publishEvent,
    publishSessionUpdate: params.io.publishSessionUpdate
  }

  const state = run.streamState
  const initialAccounting = params.initialAccounting
  const maxProviderRounds =
    toPositiveInteger(params.maxProviderRounds) ??
    toPositiveInteger(initialAccounting?.maxProviderRounds)
  if (initialAccounting) {
    const initialGenerationTime = toNonNegativeNumber(initialAccounting.generationTime)
    const initialFirstTokenTime = toNonNegativeNumber(initialAccounting.firstTokenTime)
    state.metadata.inputTokens = toNonNegativeNumber(initialAccounting.inputTokens)
    state.metadata.outputTokens = toNonNegativeNumber(initialAccounting.outputTokens)
    state.metadata.totalTokens = toNonNegativeNumber(initialAccounting.totalTokens)
    state.metadata.cachedInputTokens = toNonNegativeNumber(initialAccounting.cachedInputTokens)
    state.metadata.cacheWriteInputTokens = toNonNegativeNumber(
      initialAccounting.cacheWriteInputTokens
    )
    state.metadata.generationTime = initialGenerationTime
    state.metadata.firstTokenTime = initialFirstTokenTime
    state.metadata.reasoningStartTime = toNonNegativeNumber(initialAccounting.reasoningStartTime)
    state.metadata.reasoningEndTime = toNonNegativeNumber(initialAccounting.reasoningEndTime)
    state.metadata.noProgressToolLoop = initialAccounting.noProgressToolLoop
    state.providerRoundCount = Math.floor(
      toNonNegativeNumber(initialAccounting.providerRounds) ?? 0
    )
    state.toolCallCount = Math.floor(toNonNegativeNumber(initialAccounting.toolCalls) ?? 0)
    if (initialGenerationTime !== undefined) {
      state.startTime -= initialGenerationTime
    }
    if (initialFirstTokenTime !== undefined) {
      state.firstTokenTime = state.startTime + initialFirstTokenTime
    }
  }
  state.metadata.provider = providerId
  state.metadata.model = modelId
  if (maxProviderRounds !== undefined) {
    state.metadata.maxProviderRounds = maxProviderRounds
  }
  if (Array.isArray(initialBlocks) && initialBlocks.length > 0) {
    state.blocks = JSON.parse(JSON.stringify(initialBlocks)) as typeof state.blocks
  }
  state.metadata.runId = run.runId
  const echo = startEcho(state, io)
  const conversationMessages = run.messages
  params.onConversationMessagesChange?.(conversationMessages)
  let currentTools = run.resources.toolDefinitions
  let firstProviderRoundReady = false
  const noProgressToolLoopGuard = new NoProgressToolLoopGuard(state.metadata.noProgressToolLoop)
  const outputSink: OutputSink = {
    update: () => echo.flush(),
    complete: () => finalize(state, io),
    fail: ({ error }) => finalizeError(state, io, error)
  }
  const updateOutput = (): void => {
    outputSink.update({
      runId: run.runId,
      sessionId: run.sessionId,
      messageId: run.messageId,
      blocks: state.blocks
    })
  }

  logger.info(`[ProcessStream] start session=${io.sessionId} message=${io.messageId}`)
  let eventCount = 0
  const commits: DeepChatLoopCommitCallbacks<StreamState, ProcessResult, ProcessResult> = {
    updateOutput: ({ outcome }) => {
      if (outcome === 'halted' || firstProviderRoundReady || state.blocks.length === 0) {
        return
      }

      firstProviderRoundReady = true
      updateOutput()
      try {
        params.onFirstProviderRoundReady?.()
      } catch (error) {
        console.warn('[ProcessStream] first provider round readiness callback failed:', error)
      }
    },
    afterRoundPersisted: async () => {
      updateOutput()
      const record = io.messageStore.getMessage(run.messageId)
      if (!record) return
      try {
        for (const input of buildTapeToolFactInputs(record)) {
          await params.io.tapeRecorder.appendToolFact(input)
        }
      } catch (error) {
        logger.warn(
          `[ProcessStream] Failed to append tool facts: ${
            error instanceof Error ? error.message : String(error)
          }`
        )
      }
    },
    settleTurn: ({ outcome }) => {
      if (outcome.type === 'thrown') {
        return settleLoopOutcome(outcome, state, io, eventCount, run, outputSink)
      }

      try {
        return settleLoopOutcome(outcome, state, io, eventCount, run, outputSink)
      } catch (error) {
        return settleLoopOutcome({ type: 'thrown', error }, state, io, eventCount, run, outputSink)
      }
    }
  }

  try {
    if (initialAccounting?.runOutcome === 'paused') {
      const resumedToolBatch = extractLatestCompletedToolBatch(conversationMessages)
      if (resumedToolBatch) {
        const resumedObservation = noProgressToolLoopGuard.observe(
          resumedToolBatch.toolCalls,
          resumedToolBatch.batchMessages
        )
        state.metadata.noProgressToolLoop = resumedObservation.snapshot
        if (resumedObservation.correctionAppended) {
          commitCorrectedToolMessage(conversationMessages, resumedToolBatch.batchMessages)
          logger.warn(
            `[ProcessStream] repeated resumed tool batch detected count=${resumedObservation.repeatedBatchCount}; requesting a strategy change`
          )
        }
        if (resumedObservation.shouldTerminate) {
          state.planTerminalReason = 'max_steps'
          return settleLoopOutcome(
            {
              type: 'halted',
              result: {
                status: 'error',
                terminalError: NO_PROGRESS_TERMINAL_ERROR,
                stopReason: 'no_progress',
                errorMessage: NO_PROGRESS_TERMINAL_ERROR,
                usage: buildUsageSnapshot(state)
              }
            },
            state,
            io,
            eventCount,
            run,
            outputSink
          )
        }
      }
    }

    return await deepChatLoopEngine.run<StreamState, ToolRoundBatch, ProcessResult, ProcessResult>(
      run,
      {
        maxProviderRounds,
        initialExecutedToolCount: state.toolCallCount,
        consumeProviderRound: async () => {
          const prevBlockCount = state.blocks.length
          const assertProviderRequestAvailable = (): void => {
            if (maxProviderRounds !== undefined && state.providerRoundCount >= maxProviderRounds) {
              throw new MaxProviderRoundsError(maxProviderRounds)
            }
          }
          const markProviderRequestStarted = (): void => {
            assertProviderRequestAvailable()
            state.providerRoundCount += 1
            state.metadata.providerRounds = state.providerRoundCount
          }
          if (params.coreStreamReportsProviderStart !== true) {
            markProviderRequestStarted()
          } else {
            assertProviderRequestAvailable()
          }
          const stream = coreStream(
            conversationMessages,
            modelId,
            modelConfig,
            temperature,
            maxTokens,
            currentTools,
            params.coreStreamReportsProviderStart === true ? markProviderRequestStarted : undefined,
            params.coreStreamReportsProviderStart === true
              ? assertProviderRequestAvailable
              : undefined
          )

          // Reset per-iteration accumulator state
          state.stopReason = null
          state.completedToolCalls = []
          state.pendingToolCalls.clear()

          for await (const event of stream) {
            eventCount++
            if (io.abortSignal.aborted) {
              logger.info(`[ProcessStream] aborted after ${eventCount} events`)
              echo.stop()
              commitRoundUsage(state)
              return {
                type: 'halted',
                result: {
                  status: 'aborted',
                  stopReason: 'user_stop',
                  errorMessage: USER_CANCELED_GENERATION_ERROR,
                  usage: buildUsageSnapshot(state)
                }
              }
            }

            if (event.type === 'permission') {
              const { actionBlock, permission, tool } = appendStreamingProviderPermissionBlock(
                state,
                event.permission
              )
              emitDeepChatLoopNotification(notificationObserver, {
                event: 'PermissionRequest',
                permission,
                tool
              })
              controls?.onStreamingProviderPermission?.(permission, tool, (granted) => {
                markStreamingProviderPermissionResolved(
                  actionBlock,
                  granted,
                  permission.permissionType
                )
                state.dirty = true
                updateOutput()
              })
              updateOutput()
              continue
            }

            accumulate(state, event)
            if (event.type === 'plan' && state.latestAgentPlanSnapshot) {
              state.latestAgentPlanSnapshot = {
                ...state.latestAgentPlanSnapshot,
                sessionId: io.sessionId,
                messageId: io.messageId
              }
              publishPlanUpdated(io, state.latestAgentPlanSnapshot)
            }
            echo.schedule()
          }

          logger.info(
            `[ProcessStream] stream iteration done reason=${state.stopReason} events=${eventCount} blocks=${state.blocks.length}`
          )

          commitRoundUsage(state)

          if (io.abortSignal.aborted) {
            return {
              type: 'halted',
              result: {
                status: 'aborted',
                stopReason: 'user_stop',
                errorMessage: USER_CANCELED_GENERATION_ERROR,
                usage: buildUsageSnapshot(state)
              }
            }
          }

          if (state.stopReason !== 'tool_use' || state.completedToolCalls.length === 0) {
            return { type: 'terminal' }
          }

          return {
            type: 'tool_batch',
            batch: { prevBlockCount },
            toolCallCount: state.completedToolCalls.length
          }
        },
        executeToolBatch: async ({ batch }) => {
          // A completed tool call implies that the tool presenter and definitions were available.
          const completedToolBatch = state.completedToolCalls.map((toolCall) => ({ ...toolCall }))
          const toolBatchMessageStart = conversationMessages.length
          let startedToolCallCount = 0
          let executed: Awaited<ReturnType<typeof executeTools>>
          try {
            executed = await executeTools(
              state,
              conversationMessages,
              batch.prevBlockCount,
              currentTools,
              toolExecution,
              modelId,
              interleavedReasoning,
              io,
              permissionMode,
              toolResults,
              providerId === 'acp'
                ? Number.MAX_SAFE_INTEGER
                : modelConfig.contextLength > 0
                  ? modelConfig.contextLength
                  : UNKNOWN_CONTEXT_LIMIT,
              maxTokens,
              echo,
              {
                notificationObserver,
                controls,
                diagnostics,
                onToolCallStarted: () => {
                  startedToolCallCount += 1
                }
              },
              providerId
            )
          } finally {
            state.toolCallCount += startedToolCallCount
            state.metadata.toolCalls = state.toolCallCount
          }

          if (executed.type === 'completed' && executed.terminalError) {
            return {
              type: 'halted',
              result: {
                status: 'error',
                terminalError: executed.terminalError,
                stopReason: 'tool_error',
                errorMessage: executed.terminalError,
                usage: buildUsageSnapshot(state)
              }
            }
          }

          if (executed.type === 'paused') {
            logger.info(
              `[ProcessStream] paused for user interaction count=${executed.interactions.length}`
            )
            return {
              type: 'halted',
              result: {
                status: 'paused',
                pendingInteractions: [...executed.interactions],
                toolBatchExecutionState: executed.executionState
              }
            }
          }

          if (executed.type === 'completed') {
            const completedBatchMessages = conversationMessages.slice(toolBatchMessageStart)
            const noProgressObservation = noProgressToolLoopGuard.observe(
              completedToolBatch,
              completedBatchMessages
            )
            state.metadata.noProgressToolLoop = noProgressObservation.snapshot
            if (noProgressObservation.correctionAppended) {
              commitCorrectedToolMessage(conversationMessages, completedBatchMessages)
              logger.warn(
                `[ProcessStream] repeated tool batch detected count=${noProgressObservation.repeatedBatchCount}; requesting a strategy change`
              )
            }
            if (noProgressObservation.shouldTerminate) {
              logger.warn(
                `[ProcessStream] ${NO_PROGRESS_TERMINAL_ERROR} session=${io.sessionId} message=${io.messageId}`
              )
              state.planTerminalReason = 'max_steps'
              return {
                type: 'halted',
                result: {
                  status: 'error',
                  terminalError: NO_PROGRESS_TERMINAL_ERROR,
                  stopReason: 'no_progress',
                  errorMessage: NO_PROGRESS_TERMINAL_ERROR,
                  usage: buildUsageSnapshot(state)
                }
              }
            }
          }

          if (io.abortSignal.aborted) {
            return {
              type: 'halted',
              result: {
                status: 'aborted',
                stopReason: 'user_stop',
                errorMessage: USER_CANCELED_GENERATION_ERROR,
                usage: buildUsageSnapshot(state)
              }
            }
          }

          if (params.shouldYieldForPendingInput?.()) {
            return {
              type: 'halted',
              result: {
                status: 'completed',
                stopReason: 'pending_input',
                usage: buildUsageSnapshot(state)
              }
            }
          }

          if (executed.toolsChanged) {
            const activeSkillNames = controls?.getActiveSkillNames?.()
            run.resources.activeSkillNames = [...(activeSkillNames ?? [])]
            try {
              run.resources.toolDefinitions = await toolCatalog.resolve({ activeSkillNames })
              currentTools = run.resources.toolDefinitions
            } catch (error) {
              console.warn('[ProcessStream] failed to refresh tools after skill activation:', error)
            }
            if (params.refreshSystemPrompt) {
              try {
                const refreshedSystemPrompt = await params.refreshSystemPrompt(
                  activeSkillNames,
                  currentTools
                )
                replaceLeadingSystemMessage(conversationMessages, refreshedSystemPrompt)
              } catch (error) {
                console.warn(
                  '[ProcessStream] failed to refresh system prompt after skill activation:',
                  error
                )
              }
            }
          }

          return { type: 'continue', executedToolCount: startedToolCallCount }
        }
      },
      commits
    )
  } finally {
    echo.stop()
  }
}

function buildUsageSnapshot(state: StreamState): Record<string, number> {
  const usage: Record<string, number> = {}
  if (typeof state.metadata.totalTokens === 'number') {
    usage.totalTokens = state.metadata.totalTokens
  }
  if (typeof state.metadata.inputTokens === 'number') {
    usage.inputTokens = state.metadata.inputTokens
  }
  if (typeof state.metadata.outputTokens === 'number') {
    usage.outputTokens = state.metadata.outputTokens
  }
  if (typeof state.metadata.cachedInputTokens === 'number') {
    usage.cachedInputTokens = state.metadata.cachedInputTokens
  }
  if (typeof state.metadata.cacheWriteInputTokens === 'number') {
    usage.cacheWriteInputTokens = state.metadata.cacheWriteInputTokens
  }
  return usage
}
