import logger from '@shared/logger'
import type { AssistantMessageBlock } from '@shared/types/agent-interface'
import type { PermissionRequestPayload } from '@shared/types/core/llm-events'
import type {
  IoParams,
  PendingToolInteraction,
  ProcessParams,
  ProcessResult,
  StreamState
} from './types'
import { createState } from './types'
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

const MAX_TOOL_CALLS = 128
const UNKNOWN_CONTEXT_LIMIT = Number.MAX_SAFE_INTEGER
const USER_CANCELED_GENERATION_ERROR = 'common.error.userCanceledGeneration'
const NO_MODEL_RESPONSE_ERROR = 'common.error.noModelResponse'
const MAX_TOOL_CALLS_SKIPPED_ERROR =
  'Tool call was not executed because the maximum tool-call limit was reached.'

class MaxProviderRoundsError extends Error {
  constructor(limit: number) {
    super(`Maximum agent turns exceeded (${limit}).`)
    this.name = 'MaxProviderRoundsError'
  }
}

type PendingPermissionPayload = NonNullable<PendingToolInteraction['permission']>
type PendingPermissionCommandInfo = NonNullable<PendingPermissionPayload['commandInfo']>

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

function stampRunOutcome(
  state: StreamState,
  outcome: 'completed' | 'paused' | 'aborted' | 'error',
  stopReason: string
): void {
  state.metadata.runOutcome = outcome
  state.metadata.runStopReason = stopReason
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

function toNonNegativeNumber(value: number | undefined): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : undefined
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

function appendStreamingProviderPermissionBlock(
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

function replaceLeadingSystemMessage(
  messages: ProcessParams['messages'],
  systemPrompt: string
): void {
  if (!systemPrompt) {
    return
  }

  if (messages[0]?.role === 'system') {
    messages[0] = { ...messages[0], content: systemPrompt }
    return
  }

  messages.unshift({ role: 'system', content: systemPrompt })
}

function markStreamingProviderPermissionResolved(
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

/**
 * Unified stream processor. Handles both simple completions and multi-turn
 * tool-calling loops in a single code path.
 */
export async function processStream(params: ProcessParams): Promise<ProcessResult> {
  const {
    messages,
    tools,
    toolPresenter,
    coreStream,
    providerId,
    modelId,
    modelConfig,
    temperature,
    maxTokens,
    interleavedReasoning,
    permissionMode,
    initialBlocks,
    hooks,
    io
  } = params

  const state = createState()
  const initialAccounting = params.initialAccounting
  if (initialAccounting) {
    state.metadata.inputTokens = toNonNegativeNumber(initialAccounting.inputTokens)
    state.metadata.outputTokens = toNonNegativeNumber(initialAccounting.outputTokens)
    state.metadata.totalTokens = toNonNegativeNumber(initialAccounting.totalTokens)
    state.metadata.cachedInputTokens = toNonNegativeNumber(initialAccounting.cachedInputTokens)
    state.metadata.cacheWriteInputTokens = toNonNegativeNumber(
      initialAccounting.cacheWriteInputTokens
    )
    state.metadata.generationTime = toNonNegativeNumber(initialAccounting.generationTime)
    state.metadata.firstTokenTime = toNonNegativeNumber(initialAccounting.firstTokenTime)
    state.metadata.noProgressToolLoop = initialAccounting.noProgressToolLoop
    state.providerRoundCount = Math.floor(
      toNonNegativeNumber(initialAccounting.providerRounds) ?? 0
    )
    state.toolCallCount = Math.floor(toNonNegativeNumber(initialAccounting.toolCalls) ?? 0)
  }
  state.metadata.runId = io.requestId
  state.metadata.provider = providerId
  state.metadata.model = modelId
  if (Array.isArray(initialBlocks) && initialBlocks.length > 0) {
    state.blocks = JSON.parse(JSON.stringify(initialBlocks)) as typeof state.blocks
  }
  const echo = startEcho(state, io)
  const conversationMessages = [...messages]
  params.onConversationMessagesChange?.(conversationMessages)
  let currentTools = [...tools]
  let toolCallCount = state.toolCallCount
  let providerRoundCount = state.providerRoundCount
  const noProgressToolLoopGuard = new NoProgressToolLoopGuard(initialAccounting?.noProgressToolLoop)
  const maxProviderRounds =
    Number.isInteger(params.maxProviderRounds) && params.maxProviderRounds! > 0
      ? params.maxProviderRounds!
      : Number.POSITIVE_INFINITY
  let firstProviderRoundReady = false

  logger.info(`[ProcessStream] start session=${io.sessionId} message=${io.messageId}`)
  let eventCount = 0

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
          logger.warn(
            `[ProcessStream] repeated tool batch resumed count=${resumedObservation.repeatedBatchCount}; requesting a strategy change`
          )
        }
        if (resumedObservation.shouldTerminate) {
          logger.warn(
            `[ProcessStream] ${NO_PROGRESS_TERMINAL_ERROR} session=${io.sessionId} message=${io.messageId}`
          )
          state.planTerminalReason = 'max_steps'
          stampRunOutcome(state, 'error', 'no_progress')
          finalizeError(state, io, NO_PROGRESS_TERMINAL_ERROR)
          return {
            status: 'error' as const,
            terminalError: NO_PROGRESS_TERMINAL_ERROR,
            stopReason: 'no_progress',
            errorMessage: NO_PROGRESS_TERMINAL_ERROR,
            usage: buildUsageSnapshot(state)
          }
        }
      }
    }

    while (true) {
      if (providerRoundCount >= maxProviderRounds) {
        const errorMessage = new MaxProviderRoundsError(maxProviderRounds).message
        logger.info(`[ProcessStream] ${errorMessage}`)
        stampRunOutcome(state, 'error', 'max_turns')
        finalizeError(state, io, errorMessage)
        return {
          status: 'error' as const,
          terminalError: errorMessage,
          stopReason: 'max_turns',
          errorMessage,
          usage: buildUsageSnapshot(state)
        }
      }

      const markProviderRoundStarted = (): void => {
        if (providerRoundCount >= maxProviderRounds) {
          throw new MaxProviderRoundsError(maxProviderRounds)
        }
        providerRoundCount += 1
        state.providerRoundCount = providerRoundCount
      }
      if (params.coreStreamReportsProviderStart !== true) {
        markProviderRoundStarted()
      }

      const prevBlockCount = state.blocks.length

      const stream = coreStream(
        conversationMessages,
        modelId,
        modelConfig,
        temperature,
        maxTokens,
        currentTools,
        params.coreStreamReportsProviderStart === true ? markProviderRoundStarted : undefined
      )

      // Reset per-iteration accumulator state
      state.completedToolCalls = []
      state.pendingToolCalls.clear()
      let providerErrorObserved = false

      for await (const event of stream) {
        eventCount++
        if (io.abortSignal.aborted) {
          logger.info(`[ProcessStream] aborted after ${eventCount} events`)
          echo.stop()
          commitRoundUsage(state)
          stampRunOutcome(state, 'aborted', 'user_stop')
          finalizeUserCanceledErrorIfNeeded(state, io)
          return {
            status: 'aborted' as const,
            stopReason: 'user_stop',
            errorMessage: USER_CANCELED_GENERATION_ERROR,
            usage: buildUsageSnapshot(state)
          }
        }

        if (event.type === 'permission') {
          const { actionBlock, permission, tool } = appendStreamingProviderPermissionBlock(
            state,
            event.permission
          )
          hooks?.onPermissionRequest?.(permission, tool)
          hooks?.onStreamingProviderPermission?.(permission, tool, (granted) => {
            markStreamingProviderPermissionResolved(actionBlock, granted, permission.permissionType)
            state.dirty = true
            echo.flush()
          })
          echo.flush()
          continue
        }

        accumulate(state, event)
        if (event.type === 'error') providerErrorObserved = true
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

      commitRoundUsage(state)
      if (providerErrorObserved) state.stopReason = 'error'

      logger.info(
        `[ProcessStream] stream iteration done reason=${state.stopReason} events=${eventCount} blocks=${state.blocks.length}`
      )

      if (io.abortSignal.aborted) {
        stampRunOutcome(state, 'aborted', 'user_stop')
        finalizeUserCanceledErrorIfNeeded(state, io)
        return {
          status: 'aborted' as const,
          stopReason: 'user_stop',
          errorMessage: USER_CANCELED_GENERATION_ERROR,
          usage: buildUsageSnapshot(state)
        }
      }
      if (!firstProviderRoundReady && state.blocks.length > 0) {
        firstProviderRoundReady = true
        echo.flush()
        try {
          params.onFirstProviderRoundReady?.()
        } catch (error) {
          console.warn('[ProcessStream] first provider round readiness callback failed:', error)
        }
      }

      // Break conditions: not tool_use, abort, no completed tool calls
      if (state.stopReason !== 'tool_use') break
      if (state.completedToolCalls.length === 0) break

      // Check max tool call limit
      if (toolCallCount + state.completedToolCalls.length > MAX_TOOL_CALLS) {
        logger.info(
          `[ProcessStream] max tool calls reached (${toolCallCount + state.completedToolCalls.length} > ${MAX_TOOL_CALLS}), stopping`
        )
        state.stopReason = 'max_tool_calls'
        state.planTerminalReason = 'max_steps'
        markUnexecutedToolCallsForLimit(state)
        break
      }

      // Execute tools and continue loop (toolPresenter is guaranteed non-null here
      // because completedToolCalls > 0 means tools were requested, which requires
      // tools.length > 0, which requires toolPresenter to be non-null)
      const completedToolBatch = state.completedToolCalls.map((toolCall) => ({ ...toolCall }))
      const toolBatchMessageStart = conversationMessages.length
      const executed = await executeTools(
        state,
        conversationMessages,
        prevBlockCount,
        currentTools,
        toolPresenter!,
        modelId,
        interleavedReasoning,
        io,
        permissionMode,
        params.toolOutputGuard,
        providerId === 'acp'
          ? Number.MAX_SAFE_INTEGER
          : modelConfig.contextLength > 0
            ? modelConfig.contextLength
            : UNKNOWN_CONTEXT_LIMIT,
        maxTokens,
        echo,
        hooks,
        providerId
      )
      toolCallCount += executed.executed
      state.toolCallCount = toolCallCount
      echo.flush()
      io.messageStore.appendAssistantToolFactsSnapshot(io.messageId, 'tool_loop')

      if (executed.terminalError) {
        stampRunOutcome(state, 'error', 'tool_error')
        finalizeError(state, io, executed.terminalError)
        return {
          status: 'error' as const,
          terminalError: executed.terminalError,
          stopReason: 'tool_error',
          errorMessage: executed.terminalError,
          usage: buildUsageSnapshot(state)
        }
      }

      if (executed.pendingInteractions.length > 0) {
        logger.info(
          `[ProcessStream] paused for user interaction count=${executed.pendingInteractions.length}`
        )
        stampRunOutcome(state, 'paused', 'interaction')
        finalizePaused(state, io)
        return {
          status: 'paused' as const,
          pendingInteractions: executed.pendingInteractions,
          usage: buildUsageSnapshot(state)
        }
      }

      // Check abort after tool execution
      if (io.abortSignal.aborted) {
        stampRunOutcome(state, 'aborted', 'user_stop')
        finalizeUserCanceledErrorIfNeeded(state, io)
        return {
          status: 'aborted' as const,
          stopReason: 'user_stop',
          errorMessage: USER_CANCELED_GENERATION_ERROR,
          usage: buildUsageSnapshot(state)
        }
      }

      if (params.shouldYieldForPendingInput?.()) {
        stampRunOutcome(state, 'completed', 'pending_input')
        finalize(state, io)
        return {
          status: 'completed' as const,
          stopReason: 'pending_input',
          usage: buildUsageSnapshot(state)
        }
      }

      const noProgressObservation = noProgressToolLoopGuard.observe(
        completedToolBatch,
        conversationMessages.slice(toolBatchMessageStart)
      )
      state.metadata.noProgressToolLoop = noProgressObservation.snapshot
      if (noProgressObservation.correctionAppended) {
        logger.warn(
          `[ProcessStream] repeated tool batch detected count=${noProgressObservation.repeatedBatchCount}; requesting a strategy change`
        )
      }
      if (noProgressObservation.shouldTerminate) {
        logger.warn(
          `[ProcessStream] ${NO_PROGRESS_TERMINAL_ERROR} session=${io.sessionId} message=${io.messageId}`
        )
        state.planTerminalReason = 'max_steps'
        stampRunOutcome(state, 'error', 'no_progress')
        finalizeError(state, io, NO_PROGRESS_TERMINAL_ERROR)
        return {
          status: 'error' as const,
          terminalError: NO_PROGRESS_TERMINAL_ERROR,
          stopReason: 'no_progress',
          errorMessage: NO_PROGRESS_TERMINAL_ERROR,
          usage: buildUsageSnapshot(state)
        }
      }

      if (executed.toolsChanged) {
        const activeSkillNames = hooks?.getActiveSkillNames?.()
        if (params.refreshTools) {
          try {
            currentTools = await params.refreshTools(activeSkillNames)
          } catch (error) {
            console.warn('[ProcessStream] failed to refresh tools after skill activation:', error)
          }
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
    }

    // Finalize
    if (io.abortSignal.aborted) {
      stampRunOutcome(state, 'aborted', 'user_stop')
      finalizeUserCanceledErrorIfNeeded(state, io)
      return {
        status: 'aborted' as const,
        stopReason: 'user_stop',
        errorMessage: USER_CANCELED_GENERATION_ERROR,
        usage: buildUsageSnapshot(state)
      }
    }
    if (state.stopReason === 'error') {
      const streamErrorMessage = getLatestErrorMessage(state) ?? NO_MODEL_RESPONSE_ERROR
      const isContextWindowError = isContextWindowErrorLike(streamErrorMessage)
      if (isContextWindowError) {
        stripTrailingErrorBlock(state, streamErrorMessage)
      }
      stampRunOutcome(state, 'error', isContextWindowError ? 'context_window' : 'provider_error')
      finalizeError(state, io, streamErrorMessage)
      return {
        status: 'error' as const,
        terminalError: streamErrorMessage,
        stopReason: isContextWindowError ? 'context_window' : 'provider_error',
        errorMessage: streamErrorMessage,
        usage: buildUsageSnapshot(state)
      }
    }
    if (state.blocks.length === 0 && !state.latestAgentPlanSnapshot) {
      stampRunOutcome(state, 'error', 'empty_response')
      finalizeError(state, io, NO_MODEL_RESPONSE_ERROR)
      return {
        status: 'error' as const,
        terminalError: NO_MODEL_RESPONSE_ERROR,
        stopReason: 'empty_response',
        errorMessage: NO_MODEL_RESPONSE_ERROR,
        usage: buildUsageSnapshot(state)
      }
    }
    const stopReason =
      state.stopReason === 'max_tokens' || state.stopReason === 'max_tool_calls'
        ? state.stopReason
        : 'complete'
    stampRunOutcome(state, 'completed', stopReason)
    finalize(state, io)
    return {
      status: 'completed' as const,
      stopReason,
      usage: buildUsageSnapshot(state)
    }
  } catch (err) {
    commitRoundUsage(state)
    if (io.abortSignal.aborted || isAbortError(err)) {
      logger.info(`[ProcessStream] aborted via exception after ${eventCount} events`)
      stampRunOutcome(state, 'aborted', 'user_stop')
      finalizeUserCanceledErrorIfNeeded(state, io)
      return {
        status: 'aborted' as const,
        stopReason: 'user_stop',
        errorMessage: USER_CANCELED_GENERATION_ERROR,
        usage: buildUsageSnapshot(state)
      }
    }
    if (err instanceof MaxProviderRoundsError) {
      logger.info(`[ProcessStream] ${err.message}`)
      stampRunOutcome(state, 'error', 'max_turns')
      finalizeError(state, io, err.message)
      return {
        status: 'error' as const,
        terminalError: err.message,
        stopReason: 'max_turns',
        errorMessage: err.message,
        usage: buildUsageSnapshot(state)
      }
    }
    console.error(`[ProcessStream] exception after ${eventCount} events:`, err)
    const errorMessage = err instanceof Error ? err.message : String(err)
    const contextWindowError = isContextWindowErrorLike(err)
    stampRunOutcome(state, 'error', contextWindowError ? 'context_window' : 'provider_error')
    finalizeError(state, io, err)
    return {
      status: 'error' as const,
      terminalError: errorMessage,
      stopReason: contextWindowError ? 'context_window' : 'provider_error',
      errorMessage,
      usage: buildUsageSnapshot(state)
    }
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
