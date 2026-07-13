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
import { accumulate, finalizeTrailingPendingNarrativeBlocks } from './accumulator'
import { startEcho } from './echo'
import {
  executeTools,
  finalize,
  finalizeError,
  finalizePaused,
  publishPlanUpdated,
  persistAbortExceptionPlanState
} from './dispatch'
import { isContextWindowErrorLike } from './contextWindowError'
import {
  DeepChatLoopEngine,
  type DeepChatLoopCommitCallbacks,
  type DeepChatLoopOutcome
} from '@/agent/deepchat/loop/deepChatLoopEngine'
import { emitDeepChatLoopNotification } from '@/agent/deepchat/loop/notificationObserver'
import type { OutputSink } from '@/agent/deepchat/loop/ports'
import { buildTapeToolFactInputs } from './tapeFacts'

const UNKNOWN_CONTEXT_LIMIT = Number.MAX_SAFE_INTEGER
const USER_CANCELED_GENERATION_ERROR = 'common.error.userCanceledGeneration'
export const NO_MODEL_RESPONSE_ERROR = 'common.error.noModelResponse'
const deepChatLoopEngine = new DeepChatLoopEngine()
type PendingPermissionPayload = NonNullable<PendingToolInteraction['permission']>
type PendingPermissionCommandInfo = NonNullable<PendingPermissionPayload['commandInfo']>
type ToolRoundBatch = { prevBlockCount: number }

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

export type ProviderTerminalDecision =
  | { type: 'complete' }
  | { type: 'error'; error: string; source: 'context' | 'empty' }

export function resolveProviderTerminalDecision(state: StreamState): ProviderTerminalDecision {
  if (state.stopReason === 'error') {
    const streamErrorMessage = getLatestErrorMessage(state)
    if (streamErrorMessage && isContextWindowErrorLike(streamErrorMessage)) {
      stripTrailingErrorBlock(state, streamErrorMessage)
      return { type: 'error', error: streamErrorMessage, source: 'context' }
    }
  }
  if (state.blocks.length === 0 && !state.latestAgentPlanSnapshot) {
    return { type: 'error', error: NO_MODEL_RESPONSE_ERROR, source: 'empty' }
  }
  return { type: 'complete' }
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
  if (outcome.type === 'thrown') {
    if (io.abortSignal.aborted || isAbortError(outcome.error)) {
      logger.info(`[ProcessStream] aborted via exception after ${eventCount} events`)
      persistAbortExceptionPlanState(state, io)
      return {
        status: 'aborted',
        stopReason: 'user_stop',
        errorMessage: USER_CANCELED_GENERATION_ERROR,
        usage: buildUsageSnapshot(state)
      }
    }

    console.error(`[ProcessStream] exception after ${eventCount} events:`, outcome.error)
    outputSink.fail({
      runId: run.runId,
      sessionId: run.sessionId,
      messageId: run.messageId,
      error: outcome.error
    })
    return {
      status: 'error',
      stopReason: 'error',
      errorMessage: outcome.error instanceof Error ? outcome.error.message : String(outcome.error),
      usage: buildUsageSnapshot(state)
    }
  }

  if (outcome.type === 'halted') {
    const result = outcome.result
    if (result.status === 'paused') {
      finalizePaused(state, io)
    } else if (result.status === 'aborted') {
      finalizeUserCanceledErrorIfNeeded(state, io)
    } else if (result.status === 'error') {
      outputSink.fail({
        runId: run.runId,
        sessionId: run.sessionId,
        messageId: run.messageId,
        error: result.terminalError ?? result.errorMessage ?? 'Unknown error'
      })
    } else {
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

  if (outcome.type === 'max_tool_calls') {
    logger.info(
      `[ProcessStream] max tool calls reached (${outcome.attemptedToolCount} > ${outcome.limit}), stopping`
    )
    state.planTerminalReason = 'max_steps'
  }

  if (io.abortSignal.aborted) {
    finalizeUserCanceledErrorIfNeeded(state, io)
    return {
      status: 'aborted',
      stopReason: 'user_stop',
      errorMessage: USER_CANCELED_GENERATION_ERROR,
      usage: buildUsageSnapshot(state)
    }
  }
  const terminalDecision = resolveProviderTerminalDecision(state)
  if (terminalDecision.type === 'error') {
    outputSink.fail({
      runId: run.runId,
      sessionId: run.sessionId,
      messageId: run.messageId,
      error: terminalDecision.error
    })
    if (terminalDecision.source === 'context') {
      return {
        status: 'error',
        terminalError: terminalDecision.error
      }
    }
    return {
      status: 'error',
      terminalError: terminalDecision.error,
      stopReason: 'error',
      errorMessage: terminalDecision.error,
      usage: buildUsageSnapshot(state)
    }
  }

  outputSink.complete({
    runId: run.runId,
    sessionId: run.sessionId,
    messageId: run.messageId,
    blocks: state.blocks,
    metadata: { ...state.metadata }
  })
  return {
    status: 'completed',
    stopReason: 'complete',
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
    abortSignal: run.abortController.signal
  }

  const state = run.streamState
  state.metadata.provider = providerId
  state.metadata.model = modelId
  if (Array.isArray(initialBlocks) && initialBlocks.length > 0) {
    state.blocks = JSON.parse(JSON.stringify(initialBlocks)) as typeof state.blocks
  }
  const echo = startEcho(state, io)
  const conversationMessages = run.messages
  params.onConversationMessagesChange?.(conversationMessages)
  let currentTools = run.resources.toolDefinitions
  let firstProviderRoundReady = false
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
    return await deepChatLoopEngine.run<StreamState, ToolRoundBatch, ProcessResult, ProcessResult>(
      run,
      {
        maxProviderRounds: params.maxProviderRounds,
        consumeProviderRound: async () => {
          const prevBlockCount = state.blocks.length
          const stream = coreStream(
            conversationMessages,
            modelId,
            modelConfig,
            temperature,
            maxTokens,
            currentTools
          )

          // Reset per-iteration accumulator state
          state.completedToolCalls = []
          state.pendingToolCalls.clear()

          for await (const event of stream) {
            eventCount++
            if (io.abortSignal.aborted) {
              logger.info(`[ProcessStream] aborted after ${eventCount} events`)
              echo.stop()
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
          const executed = await executeTools(
            state,
            conversationMessages,
            batch.prevBlockCount,
            currentTools,
            toolExecution!,
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
              diagnostics
            },
            providerId
          )

          if (executed.type === 'completed' && executed.terminalError) {
            return {
              type: 'halted',
              result: {
                status: 'error',
                terminalError: executed.terminalError,
                stopReason: 'error',
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

          return { type: 'continue', executedToolCount: executed.executed }
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
