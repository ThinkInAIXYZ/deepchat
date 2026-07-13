import logger from '@shared/logger'
import type {
  AssistantMessageBlock,
  DeepChatSessionState,
  MessageMetadata,
  MessageStartResult,
  SendMessageInput
} from '@shared/types/agent-interface'
import type { ChatMessage } from '@shared/types/core/chat-message'
import type { LLMCoreStreamEvent } from '@shared/types/core/llm-events'
import type { MCPToolDefinition, MCPToolResponse } from '@shared/types/core/mcp'
import type {
  IConfigPresenter,
  ILlmProviderPresenter,
  ModelConfig,
  RateLimitQueueSnapshot
} from '@shared/presenter'
import type { IToolPresenter } from '@shared/types/presenters/tool.presenter'
import { getReasoningEffectiveEnabledForProvider } from '@shared/types/model-db'
import { isTtsModelConfig, isTtsModelId } from '@shared/ttsSettings'
import type {
  DeepChatTapeViewPolicy,
  DeepChatTapeViewTaskType,
  DeepChatTapeViewTokenBudget
} from '@shared/types/tape-view-manifest'
import { nanoid } from 'nanoid'
import { publishDeepchatEvent } from '@/routes/publishDeepchatEvent'
import {
  buildAssistantDeliverySegments,
  buildAssistantPreviewMarkdown,
  buildAssistantResponseMarkdown,
  emitDeepChatInternalSessionUpdate,
  extractWaitingInteraction
} from './internalSessionEvents'
import {
  AGENT_CONTEXT_SAFETY_MARGIN_TOKENS,
  buildRequestContextBudgetDiagnostics,
  buildRequestContextOverflowErrorMessage,
  capAgentRequestMaxTokens,
  estimateToolReserveTokens,
  fitRequestMessagesToContextWindow,
  preflightRequestContext
} from './contextBudget'
import { appendReconstructionAnchorStateSection, appendSummarySection } from './compactionService'
import { cloneBlocksForRenderer } from './echo'
import type { GenerationControlService } from './generationControlService'
import { isContextWindowErrorLike } from './contextWindowError'
import { buildTerminalErrorBlocks, type DeepChatMessageStore } from './messageStore'
import { buildPersistableMessageTracePayload } from './messageTracePayload'
import type { MemoryCompactionService } from './memoryCompactionService'
import type { PendingInputService, ProcessPendingInputSource } from './pendingInputService'
import { processStream } from './process'
import type { RuntimeSharedState } from './runtimeSharedState'
import type { SessionSettingsService } from './sessionSettingsService'
import type { DeepChatSessionStore } from './sessionStore'
import type { DeepChatTapeService } from './tapeService'
import {
  buildExcludedRefs,
  buildIncludedRefs,
  buildRequestRefs,
  createTapeViewManifest,
  resolveTapeViewManifestPolicy,
  type TapeViewContextSelection
} from './tapeViewManifest'
import type { ToolOutputGuard } from './toolOutputGuard'
import type { PreparedNewTurn, TurnPreparationService } from './turnPreparationService'
import type {
  InterleavedReasoningConfig,
  PendingToolInteraction,
  ProcessHooks,
  ProcessParams,
  ProcessResult,
  ToolPermissionReviewRequest,
  ToolPermissionReviewResult
} from './types'
import type { ProviderRequestTracePayload } from '../llmProviderPresenter/requestTrace'
import type { NewSessionHooksBridge } from '../hooksNotifications/newSessionBridge'
import { parseMessageMetadata } from '../usageStats'

const PROVIDER_OVERFLOW_RETRY_EXTRA_RESERVE_CAP = 8_192
const AUTO_APPROVE_REVIEW_MAX_RECENT_MESSAGES = 8
const RATE_LIMIT_STREAM_MESSAGE_PREFIX = '__rate_limit__:'
const PRE_STREAM_SLOW_STEP_MS = 500

type StreamProvider = {
  coreStream: (
    messages: ChatMessage[],
    modelId: string,
    modelConfig: ModelConfig,
    temperature: number,
    maxTokens: number,
    tools: MCPToolDefinition[]
  ) => AsyncGenerator<LLMCoreStreamEvent>
}

export type StreamLifecycleViewContext = {
  taskType: DeepChatTapeViewTaskType
  policy: DeepChatTapeViewPolicy
  policyVersion?: number | null
  selection: TapeViewContextSelection
  summaryCursorOrderSeq: number
  supportsVision: boolean
  supportsAudioInput: boolean
  traceDebugEnabled: boolean
}

export type StreamLifecycleRunArgs = {
  sessionId: string
  messageId: string
  messages: ChatMessage[]
  projectDir: string | null
  preStreamAbortController?: AbortController
  tools?: MCPToolDefinition[]
  baseSystemPrompt?: string
  initialBlocks?: AssistantMessageBlock[]
  initialAccounting?: ProcessParams['initialAccounting']
  promptPreview?: string
  interleavedReasoning?: InterleavedReasoningConfig
  viewContext?: StreamLifecycleViewContext
  refreshSystemPrompt?: (
    activeSkillNames: string[] | undefined,
    toolDefinitions: MCPToolDefinition[]
  ) => Promise<string>
  maxProviderRounds?: number
  preStreamStartedAt?: number
  onRunRegistered?: (runId: string) => void
}

export type StreamProcessMessageContext = {
  projectDir?: string | null
  emitRefreshBeforeStream?: boolean
  pendingQueueItemId?: string
  pendingQueueItemSource?: ProcessPendingInputSource
  maxProviderRounds?: number
}

export type StreamLifecycleHookEvent =
  | 'UserPromptSubmit'
  | 'SessionStart'
  | 'PreToolUse'
  | 'PostToolUse'
  | 'PostToolUseFailure'
  | 'PermissionRequest'
  | 'Stop'
  | 'SessionEnd'

export type StreamLifecycleHookContext = {
  sessionId: string
  messageId?: string
  promptPreview?: string
  providerId?: string
  modelId?: string
  projectDir?: string | null
  tool?: {
    callId?: string
    name?: string
    params?: string
    response?: string
    error?: string
  }
  permission?: Record<string, unknown> | null
  stop?: { reason?: string; userStop?: boolean } | null
  usage?: Record<string, number> | null
  error?: { message?: string; stack?: string } | null
}

type PermissionPayload = NonNullable<PendingToolInteraction['permission']>
type StreamingPermissionTool = Parameters<
  NonNullable<ProcessHooks['onStreamingProviderPermission']>
>[1]
type NormalizeToolResultInput = Parameters<NonNullable<ProcessHooks['normalizeToolResult']>>[0]

export type StreamLifecycleHost = {
  hasPendingInteractions: (sessionId: string) => boolean
  resolveProjectDir: (sessionId: string, incoming?: string | null) => string | null
  getSessionAgentId: (sessionId: string) => string | undefined
  setSessionStatus: (sessionId: string, status: DeepChatSessionState['status']) => void
  markFirstTurnReady: (sessionId: string) => void
  autoGrantPermission: (sessionId: string, permission: PermissionPayload) => Promise<void>
  reviewToolPermission: (
    request: ToolPermissionReviewRequest,
    context: {
      providerId: string
      modelId: string
      messages: ChatMessage[]
      signal: AbortSignal
    }
  ) => Promise<ToolPermissionReviewResult>
  registerActiveProviderPermission: (
    sessionId: string,
    messageId: string,
    permission: PermissionPayload,
    tool: StreamingPermissionTool,
    commitDecision: (granted: boolean) => void
  ) => void
  normalizeToolResult: (
    input: NormalizeToolResultInput & { abortSignal: AbortSignal }
  ) => Promise<MCPToolResponse['content']>
}

export type StreamLifecycleDependencies = {
  llmProviderPresenter: ILlmProviderPresenter
  configPresenter: IConfigPresenter
  toolPresenter: IToolPresenter | null
  messageStore: DeepChatMessageStore
  sessionStore: DeepChatSessionStore
  tapeService: DeepChatTapeService
  runtimeSharedState: RuntimeSharedState
  generationControlService: GenerationControlService
  sessionSettingsService: SessionSettingsService
  pendingInputService: PendingInputService
  turnPreparationService: TurnPreparationService
  memoryCompactionService: MemoryCompactionService
  toolOutputGuard: ToolOutputGuard
  hooksBridge?: NewSessionHooksBridge
  cacheImage?: (data: string) => Promise<string>
}

type ContextPressureRecoveryInput = {
  sessionId: string
  providerId: string
  modelId: string
  requestMessages: ChatMessage[]
  baseSystemPrompt?: string
  contextLength: number
  requestedMaxTokens: number
  tools: MCPToolDefinition[]
  supportsVision: boolean
  supportsAudioInput: boolean
  interleavedReasoning: InterleavedReasoningConfig
  minimumProtectedTailCount: number
  signal: AbortSignal
}

type TapeViewManifestInput = {
  sessionId: string
  messageId: string
  requestSeq: number
  taskType: DeepChatTapeViewTaskType
  policy: DeepChatTapeViewPolicy
  policyVersion?: number | null
  messages: ChatMessage[]
  tools: MCPToolDefinition[]
  tokenBudget: Omit<DeepChatTapeViewTokenBudget, 'estimatedPromptTokens'>
  providerId: string
  modelId: string
  selection?: TapeViewContextSelection
  summaryCursorOrderSeq: number
  supportsVision: boolean
  supportsAudioInput: boolean
  traceDebugEnabled: boolean
}

function createAbortError(): Error {
  if (typeof DOMException !== 'undefined') {
    return new DOMException('Aborted', 'AbortError')
  }

  const error = new Error('Aborted')
  error.name = 'AbortError'
  return error
}

function getProviderOverflowRetryExtraReserve(contextLength: number): number {
  if (!Number.isFinite(contextLength) || contextLength <= 0) return 0
  return Math.max(
    AGENT_CONTEXT_SAFETY_MARGIN_TOKENS,
    Math.min(Math.floor(contextLength * 0.1), PROVIDER_OVERFLOW_RETRY_EXTRA_RESERVE_CAP)
  )
}

function getProviderOverflowRetryMaxTokens(maxTokens: number): number {
  const normalized = Number.isFinite(maxTokens) ? Math.floor(maxTokens) : 1
  return Math.max(1, Math.min(normalized, Math.floor(normalized / 2) || 1))
}

function isFirstProviderContextOverflowEvent(event: LLMCoreStreamEvent): boolean {
  return event.type === 'error' && isContextWindowErrorLike(event.error_message)
}

function buildProviderContextOverflowAfterRecoveryErrorMessage(
  preflight: ReturnType<typeof preflightRequestContext>
): string {
  const diagnostics = buildRequestContextBudgetDiagnostics(preflight)
  const formatTokenCount = (value: number): string =>
    Number.isFinite(value) ? String(Math.floor(value)) : 'unknown'

  return [
    'The provider still reported a context overflow after DeepChat compacted or trimmed the request.',
    `DeepChat local estimate: usable context ${formatTokenCount(diagnostics.usableContextLength)} tokens, estimated input ${formatTokenCount(diagnostics.inputTokens)} tokens, tool schemas ${formatTokenCount(diagnostics.toolReserveTokens)} tokens, requested output ${formatTokenCount(diagnostics.requestedMaxTokens)} tokens, effective output ${formatTokenCount(diagnostics.effectiveMaxTokens)} tokens, remaining output room ${formatTokenCount(diagnostics.remainingOutputTokens)} tokens.`,
    'The provider may count tokens, system prompts, or tool schemas differently. Try shortening the latest input or attachments, reducing active tools, skills, or system prompt content, lowering max output tokens, or increasing context length.'
  ].join(' ')
}

export class StreamLifecycleService {
  constructor(
    private readonly dependencies: StreamLifecycleDependencies,
    private readonly host: StreamLifecycleHost
  ) {}

  async processMessage(
    sessionId: string,
    content: string | SendMessageInput,
    context?: StreamProcessMessageContext
  ): Promise<MessageStartResult> {
    const turnStartedAt = Date.now()
    const state = this.dependencies.runtimeSharedState.runtimeState.get(sessionId)
    if (!state) throw new Error(`Session ${sessionId} not found`)
    if (this.host.hasPendingInteractions(sessionId)) {
      throw new Error('Pending tool interactions must be resolved before sending a new message.')
    }

    const normalizedInput =
      this.dependencies.turnPreparationService.normalizeUserMessageInput(content)
    if (!normalizedInput.text.trim() && (normalizedInput.files?.length ?? 0) === 0) {
      throw new Error('Message cannot be empty.')
    }
    const projectDir = this.host.resolveProjectDir(sessionId, context?.projectDir)
    logger.info(
      `[DeepChatAgent] processMessage session=${sessionId} content="${normalizedInput.text.slice(0, 60)}" projectDir=${projectDir ?? '<none>'}`
    )

    this.host.setSessionStatus(sessionId, 'generating')
    const preStreamAbortController =
      this.dependencies.generationControlService.ensureSessionAbortController(sessionId)
    const preStreamAbortSignal = preStreamAbortController.signal
    const pendingInputSource: ProcessPendingInputSource = context?.pendingQueueItemSource ?? 'send'
    let consumedPendingQueueItem = false
    let userMessageId: string | null = null
    let assistantMessageId: string | null = null
    let streamRunId: string | undefined

    try {
      const prepared = await this.dependencies.turnPreparationService.prepareNewTurn({
        sessionId,
        content: normalizedInput,
        projectDir,
        signal: preStreamAbortSignal,
        onMessageCreated: (role, messageId) => {
          if (role === 'user') userMessageId = messageId
          else assistantMessageId = messageId
        }
      })
      userMessageId = prepared.userMessageId
      assistantMessageId = prepared.assistantMessageId

      if (context?.pendingQueueItemId && pendingInputSource === 'send') {
        this.dependencies.pendingInputService.consumeQueuedInput(
          sessionId,
          context.pendingQueueItemId
        )
        consumedPendingQueueItem = true
      }

      if (context?.emitRefreshBeforeStream) {
        this.emitMessageRefresh(sessionId, prepared.assistantMessageId)
      }

      const { runId, result } = await this.runPreparedTurn(prepared, {
        maxProviderRounds: context?.maxProviderRounds,
        preStreamAbortController,
        onRunRegistered: (registeredRunId) => {
          streamRunId = registeredRunId
        }
      })
      streamRunId = runId

      if (context?.pendingQueueItemId && !consumedPendingQueueItem) {
        if (pendingInputSource === 'queue' || pendingInputSource === 'steer') {
          if (
            result.status === 'completed' ||
            result.status === 'paused' ||
            result.status === 'aborted'
          ) {
            this.dependencies.pendingInputService.consumeClaimedInput(
              sessionId,
              context.pendingQueueItemId,
              pendingInputSource
            )
            consumedPendingQueueItem = true
          } else {
            this.dependencies.pendingInputService.rollbackClaimedInputTurn(
              sessionId,
              context.pendingQueueItemId,
              pendingInputSource,
              userMessageId
            )
            consumedPendingQueueItem = true
          }
        } else {
          this.dependencies.pendingInputService.consumeQueuedInput(
            sessionId,
            context.pendingQueueItemId
          )
          consumedPendingQueueItem = true
        }
      }

      try {
        this.applyProcessResultStatus(sessionId, result, runId)
      } finally {
        this.dependencies.generationControlService.clearActiveGeneration(sessionId, runId)
      }

      if (result?.status === 'completed') {
        void this.dependencies.pendingInputService.drainPendingQueueIfPossible(
          sessionId,
          'completed'
        )
        this.dependencies.memoryCompactionService.triggerMemoryExtractionFallback(sessionId)
      } else if (result?.status === 'aborted') {
        void this.dependencies.pendingInputService.drainPendingQueueIfPossible(
          sessionId,
          'completed'
        )
      }

      return {
        requestId: assistantMessageId,
        messageId: assistantMessageId
      }
    } catch (error) {
      console.error('[DeepChatAgent] processMessage error:', error)
      const aborted = this.isAbortError(error) || preStreamAbortSignal.aborted
      if (context?.pendingQueueItemId && !consumedPendingQueueItem) {
        try {
          if (pendingInputSource === 'queue' || pendingInputSource === 'steer') {
            if (aborted) {
              this.dependencies.pendingInputService.consumeClaimedInput(
                sessionId,
                context.pendingQueueItemId,
                pendingInputSource
              )
            } else {
              this.dependencies.pendingInputService.rollbackClaimedInputTurn(
                sessionId,
                context.pendingQueueItemId,
                pendingInputSource,
                userMessageId
              )
            }
          } else {
            this.dependencies.pendingInputService.releaseClaimedInput(
              sessionId,
              context.pendingQueueItemId,
              pendingInputSource
            )
          }
          consumedPendingQueueItem = true
        } catch (releaseError) {
          console.warn('[DeepChatAgent] failed to release claimed queue input:', releaseError)
        }
      }

      if (aborted) {
        if (userMessageId) this.emitMessageRefresh(sessionId, userMessageId)
        this.dependencies.generationControlService.clearSessionAbortController(
          sessionId,
          preStreamAbortController
        )
        const metadata = assistantMessageId
          ? this.buildPreStreamTerminalMetadata({
              sessionId,
              messageId: assistantMessageId,
              runId: streamRunId,
              runOutcome: 'aborted',
              runStopReason: 'user_stop',
              startedAt: turnStartedAt
            })
          : undefined
        this.settleAbortedTurn(sessionId, assistantMessageId, streamRunId, metadata)
        void this.dependencies.pendingInputService.drainPendingQueueIfPossible(
          sessionId,
          'completed'
        )
        return {
          requestId: assistantMessageId,
          messageId: assistantMessageId
        }
      }

      const errorMessage = error instanceof Error ? error.message : String(error)
      const runStopReason = isContextWindowErrorLike(error) ? 'context_window' : 'pre_stream_error'
      if (assistantMessageId) {
        const existingAssistant = this.dependencies.messageStore.getMessage(assistantMessageId)
        const blocks = buildTerminalErrorBlocks(
          existingAssistant ? this.parseAssistantBlocks(existingAssistant.content) : [],
          errorMessage
        )
        this.dependencies.messageStore.setMessageError(
          assistantMessageId,
          blocks,
          this.buildPreStreamTerminalMetadata({
            sessionId,
            messageId: assistantMessageId,
            runId: streamRunId,
            runOutcome: 'error',
            runStopReason,
            startedAt: turnStartedAt
          })
        )
        this.emitMessageRefresh(sessionId, assistantMessageId)
      }
      this.dispatchHook('Stop', {
        sessionId,
        providerId: state.providerId,
        modelId: state.modelId,
        projectDir,
        stop: { reason: runStopReason, userStop: false }
      })
      this.dispatchHook('SessionEnd', {
        sessionId,
        providerId: state.providerId,
        modelId: state.modelId,
        projectDir,
        error: { message: errorMessage }
      })
      if (
        this.dependencies.generationControlService.shouldApplyTerminalStatus(
          sessionId,
          streamRunId,
          preStreamAbortController
        )
      ) {
        this.host.setSessionStatus(sessionId, 'error')
      }
      return {
        requestId: assistantMessageId,
        messageId: assistantMessageId
      }
    } finally {
      this.dependencies.generationControlService.clearSessionAbortController(
        sessionId,
        preStreamAbortController
      )
      this.dependencies.turnPreparationService.resetRuntimeActivatedSkills(sessionId)
    }
  }

  async runPreparedTurn(
    prepared: PreparedNewTurn,
    options?: Pick<
      StreamLifecycleRunArgs,
      'maxProviderRounds' | 'onRunRegistered' | 'preStreamAbortController'
    >
  ): Promise<{ runId: string; result: ProcessResult }> {
    return await this.runStreamForMessage({
      sessionId: prepared.sessionId,
      messageId: prepared.assistantMessageId,
      messages: prepared.messages,
      projectDir: prepared.projectDir,
      preStreamAbortController: options?.preStreamAbortController,
      promptPreview: prepared.normalizedInput.text,
      tools: prepared.tools,
      baseSystemPrompt: prepared.baseSystemPrompt,
      maxProviderRounds: options?.maxProviderRounds,
      refreshSystemPrompt: prepared.refreshSystemPrompt,
      interleavedReasoning: prepared.interleavedReasoning,
      viewContext: prepared.viewContext,
      preStreamStartedAt: prepared.preStreamStartedAt,
      onRunRegistered: options?.onRunRegistered
    })
  }

  async runStreamForMessage(
    args: StreamLifecycleRunArgs
  ): Promise<{ runId: string; result: ProcessResult }> {
    return await this.executeStream(args)
  }

  resolveStreamRequestId(sessionId: string, messageId: string): string {
    return this.dependencies.generationControlService.resolveStreamRequestId(sessionId, messageId)
  }

  emitMessageRefresh(sessionId: string, messageId: string): void {
    publishDeepchatEvent('chat.stream.completed', {
      requestId: this.resolveStreamRequestId(sessionId, messageId),
      sessionId,
      messageId,
      completedAt: Date.now()
    })

    const message = this.dependencies.messageStore.getMessage(messageId)
    if (!message || message.role !== 'assistant') return

    try {
      const blocks = JSON.parse(message.content) as AssistantMessageBlock[]
      emitDeepChatInternalSessionUpdate({
        sessionId,
        kind: 'blocks',
        updatedAt: Date.now(),
        messageId,
        previewMarkdown: buildAssistantPreviewMarkdown(blocks),
        responseMarkdown: buildAssistantResponseMarkdown(blocks),
        deliverySegments: buildAssistantDeliverySegments(messageId, blocks),
        waitingInteraction: extractWaitingInteraction(blocks, messageId)
      })
    } catch (error) {
      console.warn('[DeepChatAgent] Failed to emit internal message refresh:', error)
    }
  }

  dispatchHook(event: StreamLifecycleHookEvent, context: StreamLifecycleHookContext): void {
    try {
      this.dependencies.hooksBridge?.dispatch(event, {
        ...context,
        agentId: this.host.getSessionAgentId(context.sessionId) ?? 'deepchat'
      })
    } catch (error) {
      console.warn(`[DeepChatAgent] Failed to dispatch ${event} hook:`, error)
    }
  }

  dispatchTerminalHooks(
    sessionId: string,
    state: DeepChatSessionState | undefined,
    result: ProcessResult
  ): void {
    if (!state || result.status === 'paused') return

    this.dispatchHook('Stop', {
      sessionId,
      providerId: state.providerId,
      modelId: state.modelId,
      projectDir: this.host.resolveProjectDir(sessionId),
      stop: {
        reason:
          result.stopReason ??
          (result.status === 'completed'
            ? 'complete'
            : result.status === 'aborted'
              ? 'user_stop'
              : 'error'),
        userStop: result.status === 'aborted'
      }
    })
    this.dispatchHook('SessionEnd', {
      sessionId,
      providerId: state.providerId,
      modelId: state.modelId,
      projectDir: this.host.resolveProjectDir(sessionId),
      usage: result.usage ?? null,
      error:
        result.errorMessage || result.terminalError
          ? { message: result.errorMessage ?? result.terminalError }
          : null
    })
  }

  applyProcessResultStatus(
    sessionId: string,
    result: ProcessResult | null | undefined,
    runId?: string
  ): void {
    const isActive =
      !runId || this.dependencies.generationControlService.isActiveRun(sessionId, runId)
    const state = this.dependencies.runtimeSharedState.runtimeState.get(sessionId)
    if (!result?.status) {
      if (isActive) this.host.setSessionStatus(sessionId, 'idle')
      return
    }
    if (result.status === 'paused') {
      if (isActive) this.host.setSessionStatus(sessionId, 'generating')
      return
    }

    this.dispatchTerminalHooks(sessionId, state, result)
    if (!isActive) return
    this.host.setSessionStatus(sessionId, result.status === 'error' ? 'error' : 'idle')
  }

  private writeCanceledTerminalBlock(
    sessionId: string,
    messageId: string | null,
    metadata?: string
  ): void {
    if (!messageId) return
    const assistantMessage = this.dependencies.messageStore.getMessage(messageId)
    if (assistantMessage?.role !== 'assistant') return

    const blocks = buildTerminalErrorBlocks(
      this.parseAssistantBlocks(assistantMessage.content),
      'common.error.userCanceledGeneration'
    )
    if (metadata === undefined) {
      this.dependencies.messageStore.setMessageError(messageId, blocks)
    } else {
      this.dependencies.messageStore.setMessageError(messageId, blocks, metadata)
    }
    this.emitMessageRefresh(sessionId, messageId)
  }

  settleAbortedTurn(
    sessionId: string,
    messageId: string | null,
    runId?: string,
    metadata?: string
  ): void {
    this.writeCanceledTerminalBlock(sessionId, messageId, metadata)
    this.dispatchTerminalHooks(
      sessionId,
      this.dependencies.runtimeSharedState.runtimeState.get(sessionId),
      {
        status: 'aborted',
        stopReason: 'user_stop',
        errorMessage: 'common.error.userCanceledGeneration'
      }
    )
    if (this.dependencies.generationControlService.shouldSetIdleAfterAbort(sessionId, runId)) {
      this.host.setSessionStatus(sessionId, 'idle')
    }
  }

  async recoverRequestContextPressure(
    params: ContextPressureRecoveryInput
  ): Promise<{ messages: ChatMessage[]; systemPrompt?: string; summaryCursorOrderSeq?: number }> {
    let messages = params.requestMessages
    const systemPromptBase =
      params.baseSystemPrompt ?? this.getLeadingSystemPrompt(params.requestMessages) ?? ''
    const tapeReady = this.dependencies.tapeService.ensureSessionTapeReady(
      params.sessionId,
      this.dependencies.messageStore
    )
    const intent =
      await this.dependencies.memoryCompactionService.prepareForContextPressureRecovery({
        sessionId: params.sessionId,
        providerId: params.providerId,
        modelId: params.modelId,
        systemPrompt: systemPromptBase,
        contextLength: params.contextLength,
        reserveTokens: params.requestedMaxTokens,
        extraReserveTokens: estimateToolReserveTokens(params.tools),
        supportsVision: params.supportsVision,
        supportsAudioInput: params.supportsAudioInput,
        preserveInterleavedReasoning: params.interleavedReasoning.preserveReasoningContent,
        preserveEmptyInterleavedReasoning:
          params.interleavedReasoning.preserveEmptyReasoningContent === true,
        projectedMessages: this.withoutLeadingSystemMessage(params.requestMessages),
        historyRecords: tapeReady.historyRecords,
        signal: params.signal
      })

    if (!intent) return { messages }

    const summaryState = await this.dependencies.memoryCompactionService.applyCompactionIntent(
      params.sessionId,
      intent,
      { signal: params.signal }
    )
    this.dependencies.memoryCompactionService.triggerMemoryExtractionFromCompaction(
      params.sessionId,
      intent
    )
    const systemPrompt = await this.dependencies.memoryCompactionService.appendMemoryInjection(
      params.sessionId,
      appendReconstructionAnchorStateSection(
        appendSummarySection(systemPromptBase, summaryState.summaryText),
        this.dependencies.sessionStore.getReconstructionAnchorPromptState(params.sessionId)
      ),
      this.dependencies.memoryCompactionService.getLatestUserQuery(params.sessionId),
      null,
      params.signal
    )
    messages = this.replaceLeadingSystemPrompt(messages, systemPrompt)

    return {
      messages: fitRequestMessagesToContextWindow({
        messages,
        contextLength: params.contextLength,
        reserveTokens: params.requestedMaxTokens + estimateToolReserveTokens(params.tools),
        minimumProtectedTailCount: params.minimumProtectedTailCount
      }),
      systemPrompt,
      summaryCursorOrderSeq: summaryState.summaryCursorOrderSeq
    }
  }

  private async executeStream(
    args: StreamLifecycleRunArgs
  ): Promise<{ runId: string; result: ProcessResult }> {
    const {
      sessionId,
      messageId,
      messages,
      projectDir,
      preStreamAbortController,
      tools: providedTools,
      baseSystemPrompt,
      initialBlocks,
      initialAccounting,
      promptPreview,
      interleavedReasoning: providedInterleavedReasoning,
      viewContext,
      refreshSystemPrompt,
      maxProviderRounds,
      preStreamStartedAt,
      onRunRegistered
    } = args
    const state = this.dependencies.runtimeSharedState.runtimeState.get(sessionId)
    if (!state) throw new Error(`Session ${sessionId} not found`)
    if (messages.length === 0) {
      throw new Error('Request was not sent because the prompt is empty.')
    }

    const abortController = preStreamAbortController ?? new AbortController()
    const activeGeneration = this.dependencies.generationControlService.registerActiveGeneration(
      sessionId,
      messageId,
      abortController
    )
    onRunRegistered?.(activeGeneration.runId)
    const rateLimitMessageId = `${RATE_LIMIT_STREAM_MESSAGE_PREFIX}${activeGeneration.runId}`
    let loggedPreStreamBoundary = false
    const logPreStreamBoundary = (): void => {
      if (loggedPreStreamBoundary || preStreamStartedAt === undefined) return
      loggedPreStreamBoundary = true
      this.logSlowPreStreamStep(sessionId, 'pre-stream-provider-start', preStreamStartedAt)
    }

    try {
      this.throwIfAbortRequested(abortController.signal)
      const provider = this.dependencies.llmProviderPresenter.getProviderInstance(
        state.providerId
      ) as StreamProvider
      const generationSettings =
        await this.dependencies.sessionSettingsService.getEffectiveGenerationSettings(sessionId)
      this.throwIfAbortRequested(abortController.signal)
      const baseModelConfig = this.dependencies.configPresenter.getModelConfig(
        state.modelId,
        state.providerId
      )
      const interleavedReasoning =
        providedInterleavedReasoning ??
        this.dependencies.turnPreparationService.resolveInterleavedReasoningConfig(
          state.providerId,
          state.modelId,
          generationSettings
        )
      const contextBudgetLength =
        this.dependencies.turnPreparationService.resolveDeepChatContextBudgetLength(
          state.providerId,
          generationSettings.contextLength,
          baseModelConfig,
          state.modelId
        )
      const capabilityProviderId =
        this.dependencies.turnPreparationService.resolveCapabilityProviderId(
          state.providerId,
          state.modelId
        )
      const reasoningPortrait = this.dependencies.turnPreparationService.getReasoningPortrait(
        state.providerId,
        state.modelId
      )
      const modelConfig: ModelConfig = {
        ...baseModelConfig,
        temperature: generationSettings.temperature,
        topP: generationSettings.topP,
        contextLength: generationSettings.contextLength,
        maxTokens: capAgentRequestMaxTokens(generationSettings.maxTokens, contextBudgetLength),
        timeout: generationSettings.timeout,
        thinkingBudget: generationSettings.thinkingBudget,
        reasoningEffort: generationSettings.reasoningEffort,
        reasoningVisibility: generationSettings.reasoningVisibility,
        verbosity: generationSettings.verbosity,
        imageGeneration: generationSettings.imageGeneration,
        videoGeneration: generationSettings.videoGeneration,
        reasoning: getReasoningEffectiveEnabledForProvider(
          capabilityProviderId,
          reasoningPortrait,
          {
            reasoning: baseModelConfig.reasoning,
            reasoningEffort: generationSettings.reasoningEffort ?? baseModelConfig.reasoningEffort
          }
        ),
        conversationId: sessionId
      }

      const traceEnabled =
        this.dependencies.configPresenter.getSetting<boolean>('traceDebugEnabled') === true
      let requestSeq = Math.max(
        this.dependencies.tapeService.listViewManifestsByMessage(sessionId, messageId)[0]
          ?.requestSeq ?? 0,
        this.dependencies.messageStore.getMaxMessageTraceRequestSeq(messageId)
      )
      if (traceEnabled) {
        const traceAwareConfig = modelConfig as ModelConfig & {
          requestTraceContext?: {
            enabled: boolean
            persist: (payload: ProviderRequestTracePayload) => Promise<void>
          }
        }
        traceAwareConfig.requestTraceContext = {
          enabled: true,
          persist: async (payload) => {
            this.persistMessageTrace({
              sessionId,
              messageId,
              providerId: state.providerId,
              modelId: state.modelId,
              payload,
              requestSeq
            })
          }
        }
      }

      const temperature = generationSettings.temperature
      const maxTokens = capAgentRequestMaxTokens(generationSettings.maxTokens, contextBudgetLength)
      const streamSessionActiveSkillNames =
        await this.dependencies.turnPreparationService.resolveActiveSkillNamesForToolProfile(
          sessionId
        )
      this.throwIfAbortRequested(abortController.signal)
      const streamExtensionPolicy =
        await this.dependencies.turnPreparationService.resolveAgentExtensionPolicy(sessionId)
      this.throwIfAbortRequested(abortController.signal)
      const getEffectiveRuntimeSkillNames = (
        baseSkillNames = streamSessionActiveSkillNames
      ): string[] =>
        this.dependencies.turnPreparationService.resolveEffectiveActiveSkillNames(
          baseSkillNames,
          sessionId
        )
      const tools =
        providedTools ??
        (await this.dependencies.turnPreparationService.loadToolDefinitionsForSession(
          sessionId,
          projectDir,
          getEffectiveRuntimeSkillNames()
        ))
      this.throwIfAbortRequested(abortController.signal)
      const supportsVision = this.dependencies.turnPreparationService.supportsVision(
        state.providerId,
        state.modelId
      )
      const supportsAudioInput = this.dependencies.turnPreparationService.supportsAudioInput(
        state.providerId,
        state.modelId
      )

      this.dispatchHook('SessionStart', {
        sessionId,
        messageId,
        promptPreview,
        providerId: state.providerId,
        modelId: state.modelId,
        projectDir
      })

      let contextOverflowHandoffAttemptedForRun = false
      let strictProviderOverflowRetryUsedForRun = false
      let reviewConversationMessages = messages
      const result = await processStream({
        messages,
        tools,
        onConversationMessagesChange: (nextMessages) => {
          reviewConversationMessages = nextMessages
        },
        coreStreamReportsProviderStart: true,
        maxProviderRounds,
        refreshTools: async (activeSkillNames) =>
          await this.dependencies.turnPreparationService.loadToolDefinitionsForSession(
            sessionId,
            projectDir,
            getEffectiveRuntimeSkillNames(activeSkillNames)
          ),
        refreshSystemPrompt: async (activeSkillNames, refreshedTools) => {
          if (refreshSystemPrompt) {
            return await refreshSystemPrompt(
              getEffectiveRuntimeSkillNames(activeSkillNames),
              refreshedTools
            )
          }
          return await this.dependencies.turnPreparationService.buildSystemPromptWithSkills(
            sessionId,
            generationSettings.systemPrompt,
            refreshedTools,
            getEffectiveRuntimeSkillNames(activeSkillNames)
          )
        },
        toolPresenter: this.dependencies.toolPresenter,
        coreStream: async function* (
          this: StreamLifecycleService,
          requestMessages,
          requestModelId,
          requestModelConfig,
          requestTemperature,
          requestMaxTokens,
          requestTools,
          onProviderRequestStart
        ) {
          const requestBypassesContextBudget =
            this.dependencies.turnPreparationService.shouldBypassDeepChatContextBudget(
              state.providerId,
              requestModelConfig,
              requestModelId
            )
          let queuedForRateLimit = false

          try {
            let preflightContextRecoveryAttempted = false
            let providerOverflowRecoveryAttempted = false
            let providerContextOverflowRecoveryApplied = false
            let strictProviderOverflowRetryPending = false
            let manifestSummaryCursorOrderSeq = viewContext?.summaryCursorOrderSeq ?? 1
            const isTtsRequest =
              isTtsModelConfig(requestModelConfig) || isTtsModelId(requestModelId)
            const effectiveRequestTools: MCPToolDefinition[] = isTtsRequest ? [] : requestTools
            const effectiveRequestToolReserveTokens =
              estimateToolReserveTokens(effectiveRequestTools)

            const prepareProviderAttempt = async (options?: {
              strictProviderOverflowRetry?: boolean
            }): Promise<{ providerMessages: ChatMessage[]; providerMaxTokens: number }> => {
              let providerMessages = requestMessages
              let providerMaxTokens = requestMaxTokens
              let manifestRequestedMaxTokens = requestMaxTokens
              let manifestReserveTokens = requestMaxTokens
              let strictExtraReserveTokens = 0
              let recoveredFromContextPressure =
                providerContextOverflowRecoveryApplied ||
                options?.strictProviderOverflowRetry === true

              if (!requestBypassesContextBudget) {
                let requestedMaxTokens = requestMaxTokens
                if (options?.strictProviderOverflowRetry) {
                  strictProviderOverflowRetryUsedForRun = true
                  requestedMaxTokens = getProviderOverflowRetryMaxTokens(requestMaxTokens)
                  strictExtraReserveTokens = getProviderOverflowRetryExtraReserve(
                    requestModelConfig.contextLength
                  )
                  requestMessages.splice(
                    0,
                    requestMessages.length,
                    ...fitRequestMessagesToContextWindow({
                      messages: requestMessages,
                      contextLength: requestModelConfig.contextLength,
                      reserveTokens:
                        requestedMaxTokens +
                        effectiveRequestToolReserveTokens +
                        strictExtraReserveTokens,
                      minimumProtectedTailCount: 0
                    })
                  )
                }

                let requestPreflight = preflightRequestContext({
                  messages: requestMessages,
                  tools: effectiveRequestTools,
                  contextLength: requestModelConfig.contextLength,
                  requestedMaxTokens
                })
                if (
                  !options?.strictProviderOverflowRetry &&
                  (requestPreflight.requiresContextPressureRecovery ||
                    !requestPreflight.fitsWithinContext)
                ) {
                  preflightContextRecoveryAttempted = true
                  recoveredFromContextPressure = true
                  if (!contextOverflowHandoffAttemptedForRun) {
                    contextOverflowHandoffAttemptedForRun = true
                    const recovered = await this.recoverRequestContextPressure({
                      sessionId,
                      providerId: state.providerId,
                      modelId: requestModelId,
                      requestMessages: requestPreflight.messages,
                      baseSystemPrompt,
                      contextLength: requestModelConfig.contextLength,
                      requestedMaxTokens: requestPreflight.requestedMaxTokens,
                      tools: effectiveRequestTools,
                      supportsVision,
                      supportsAudioInput,
                      interleavedReasoning,
                      minimumProtectedTailCount: 0,
                      signal: abortController.signal
                    })
                    if (recovered.summaryCursorOrderSeq !== undefined) {
                      manifestSummaryCursorOrderSeq = recovered.summaryCursorOrderSeq
                    }
                    requestMessages.splice(0, requestMessages.length, ...recovered.messages)
                    if (recovered.systemPrompt) {
                      this.replaceLeadingSystemPromptInPlace(
                        requestMessages,
                        recovered.systemPrompt
                      )
                    }
                    requestPreflight = preflightRequestContext({
                      messages: requestMessages,
                      tools: effectiveRequestTools,
                      contextLength: requestModelConfig.contextLength,
                      requestedMaxTokens
                    })
                    requestMessages.splice(0, requestMessages.length, ...requestPreflight.messages)
                  }
                }
                if (!requestPreflight.fitsWithinContext) {
                  throw new Error(buildRequestContextOverflowErrorMessage(requestPreflight))
                }
                providerMessages = requestPreflight.messages
                providerMaxTokens = requestPreflight.effectiveMaxTokens
                manifestRequestedMaxTokens = requestPreflight.requestedMaxTokens
                manifestReserveTokens =
                  requestPreflight.requestedMaxTokens + strictExtraReserveTokens
              }
              if (providerMessages.length === 0) {
                throw new Error('Request was not sent because the prompt became empty.')
              }

              requestSeq += 1
              const isInitialViewRequest = requestSeq === 1 && Boolean(viewContext)
              const manifestPolicy = resolveTapeViewManifestPolicy({
                recoveredFromContextPressure,
                isInitialViewRequest,
                viewPolicy: viewContext?.policy,
                viewPolicyVersion: viewContext?.policyVersion
              })
              this.appendTapeViewManifest({
                sessionId,
                messageId,
                requestSeq,
                taskType: isInitialViewRequest ? viewContext!.taskType : 'tool_loop',
                policy: manifestPolicy.policy,
                policyVersion: manifestPolicy.policyVersion,
                messages: providerMessages,
                tools: effectiveRequestTools,
                tokenBudget: {
                  contextLength: requestModelConfig.contextLength ?? contextBudgetLength,
                  requestedMaxTokens: manifestRequestedMaxTokens,
                  effectiveMaxTokens: providerMaxTokens,
                  reserveTokens: manifestReserveTokens,
                  toolReserveTokens: effectiveRequestToolReserveTokens
                },
                providerId: state.providerId,
                modelId: requestModelId,
                selection:
                  isInitialViewRequest && !recoveredFromContextPressure
                    ? viewContext!.selection
                    : undefined,
                summaryCursorOrderSeq: manifestSummaryCursorOrderSeq,
                supportsVision: viewContext?.supportsVision ?? supportsVision,
                supportsAudioInput: viewContext?.supportsAudioInput ?? supportsAudioInput,
                traceDebugEnabled: viewContext?.traceDebugEnabled ?? traceEnabled
              })

              return { providerMessages, providerMaxTokens }
            }

            const recoverProviderContextOverflow = async (
              providerMessages: ChatMessage[],
              providerMaxTokens: number
            ): Promise<void> => {
              contextOverflowHandoffAttemptedForRun = true
              providerOverflowRecoveryAttempted = true
              const recovered = await this.recoverRequestContextPressure({
                sessionId,
                providerId: state.providerId,
                modelId: requestModelId,
                requestMessages: providerMessages,
                baseSystemPrompt,
                contextLength: requestModelConfig.contextLength,
                requestedMaxTokens: providerMaxTokens,
                tools: effectiveRequestTools,
                supportsVision,
                supportsAudioInput,
                interleavedReasoning,
                minimumProtectedTailCount: 0,
                signal: abortController.signal
              })
              if (recovered.summaryCursorOrderSeq !== undefined) {
                manifestSummaryCursorOrderSeq = recovered.summaryCursorOrderSeq
              }
              providerContextOverflowRecoveryApplied = true
              strictProviderOverflowRetryPending = recovered.summaryCursorOrderSeq === undefined
              requestMessages.splice(0, requestMessages.length, ...recovered.messages)
              if (recovered.systemPrompt) {
                this.replaceLeadingSystemPromptInPlace(requestMessages, recovered.systemPrompt)
              }
            }

            const buildProviderOverflowRetryFailure = (
              providerMessages: ChatMessage[],
              providerMaxTokens: number
            ): Error => {
              const retryPreflight = preflightRequestContext({
                messages: providerMessages,
                tools: effectiveRequestTools,
                contextLength: requestModelConfig.contextLength,
                requestedMaxTokens: providerMaxTokens
              })
              return new Error(
                retryPreflight.fitsWithinContext
                  ? buildProviderContextOverflowAfterRecoveryErrorMessage(retryPreflight)
                  : buildRequestContextOverflowErrorMessage(retryPreflight)
              )
            }

            const scheduleStrictProviderOverflowRetry = (): boolean => {
              if (strictProviderOverflowRetryUsedForRun || strictProviderOverflowRetryPending) {
                return false
              }
              strictProviderOverflowRetryPending = true
              return true
            }

            providerAttemptLoop: for (;;) {
              const strictProviderOverflowRetry = strictProviderOverflowRetryPending
              strictProviderOverflowRetryPending = false
              const { providerMessages, providerMaxTokens } = await prepareProviderAttempt({
                strictProviderOverflowRetry
              })

              await this.dependencies.llmProviderPresenter.executeWithRateLimit(state.providerId, {
                signal: abortController.signal,
                onQueued: (snapshot) => {
                  queuedForRateLimit = true
                  this.emitRateLimitWaitingMessage(
                    sessionId,
                    rateLimitMessageId,
                    activeGeneration.runId,
                    snapshot
                  )
                }
              })
              if (queuedForRateLimit) {
                this.clearRateLimitWaitingMessage(
                  sessionId,
                  rateLimitMessageId,
                  activeGeneration.runId
                )
                queuedForRateLimit = false
              }
              if (abortController.signal.aborted) throw createAbortError()

              logPreStreamBoundary()
              let yieldedProviderEvent = false
              try {
                onProviderRequestStart?.()
                for await (const event of provider.coreStream(
                  providerMessages,
                  requestModelId,
                  requestModelConfig,
                  requestTemperature,
                  providerMaxTokens,
                  effectiveRequestTools
                )) {
                  if (
                    !yieldedProviderEvent &&
                    !requestBypassesContextBudget &&
                    isFirstProviderContextOverflowEvent(event)
                  ) {
                    if (
                      strictProviderOverflowRetryUsedForRun ||
                      providerOverflowRecoveryAttempted
                    ) {
                      throw buildProviderOverflowRetryFailure(providerMessages, providerMaxTokens)
                    }
                    if (
                      preflightContextRecoveryAttempted ||
                      contextOverflowHandoffAttemptedForRun
                    ) {
                      if (!scheduleStrictProviderOverflowRetry()) {
                        throw buildProviderOverflowRetryFailure(providerMessages, providerMaxTokens)
                      }
                      continue providerAttemptLoop
                    }
                    await recoverProviderContextOverflow(providerMessages, providerMaxTokens)
                    continue providerAttemptLoop
                  }
                  yieldedProviderEvent = true
                  yield event
                }
                break
              } catch (error) {
                if (
                  !yieldedProviderEvent &&
                  !requestBypassesContextBudget &&
                  isContextWindowErrorLike(error)
                ) {
                  if (strictProviderOverflowRetryUsedForRun || providerOverflowRecoveryAttempted) {
                    throw buildProviderOverflowRetryFailure(providerMessages, providerMaxTokens)
                  }
                  if (preflightContextRecoveryAttempted || contextOverflowHandoffAttemptedForRun) {
                    if (!scheduleStrictProviderOverflowRetry()) {
                      throw buildProviderOverflowRetryFailure(providerMessages, providerMaxTokens)
                    }
                    continue providerAttemptLoop
                  }
                  await recoverProviderContextOverflow(providerMessages, providerMaxTokens)
                  continue providerAttemptLoop
                }
                throw error
              }
            }
          } catch (error) {
            if (queuedForRateLimit) {
              this.clearRateLimitWaitingMessage(
                sessionId,
                rateLimitMessageId,
                activeGeneration.runId
              )
            }
            throw error
          }
        }.bind(this),
        providerId: state.providerId,
        modelId: state.modelId,
        modelConfig,
        temperature,
        maxTokens,
        interleavedReasoning,
        permissionMode: state.permissionMode,
        toolOutputGuard: this.dependencies.toolOutputGuard,
        initialBlocks,
        initialAccounting,
        onFirstProviderRoundReady: () => {
          if (
            !abortController.signal.aborted &&
            this.dependencies.generationControlService.isActiveRun(
              sessionId,
              activeGeneration.runId
            )
          ) {
            this.host.markFirstTurnReady(sessionId)
          }
        },
        shouldYieldForPendingInput: () =>
          this.dependencies.pendingInputService.hasPendingSteerInput(sessionId),
        hooks: {
          getActiveSkillNames: () => getEffectiveRuntimeSkillNames(),
          getEnabledSkillNames: () =>
            this.dependencies.turnPreparationService.normalizeNullablePolicyList(
              streamExtensionPolicy.enabledSkillNames
            ),
          activateSkill: async (skillName) => {
            const policy =
              await this.dependencies.turnPreparationService.resolveAgentExtensionPolicy(sessionId)
            if (
              this.dependencies.turnPreparationService.filterSkillNamesByPolicy([skillName], policy)
                .length === 0
            ) {
              return getEffectiveRuntimeSkillNames()
            }
            await this.dependencies.turnPreparationService.activateRuntimeSkill(
              sessionId,
              skillName
            )
            return getEffectiveRuntimeSkillNames()
          },
          onPreToolUse: (tool) => {
            this.dispatchHook('PreToolUse', {
              sessionId,
              messageId,
              providerId: state.providerId,
              modelId: state.modelId,
              projectDir,
              tool
            })
          },
          onPostToolUse: (tool) => {
            this.dispatchHook('PostToolUse', {
              sessionId,
              messageId,
              providerId: state.providerId,
              modelId: state.modelId,
              projectDir,
              tool
            })
          },
          onPostToolUseFailure: (tool) => {
            this.dispatchHook('PostToolUseFailure', {
              sessionId,
              messageId,
              providerId: state.providerId,
              modelId: state.modelId,
              projectDir,
              tool
            })
          },
          onPermissionRequest: (permission, tool) => {
            this.dispatchHook('PermissionRequest', {
              sessionId,
              messageId,
              providerId: state.providerId,
              modelId: state.modelId,
              projectDir,
              permission,
              tool
            })
          },
          onStreamingProviderPermission: (permission, tool, commitDecision) => {
            this.host.registerActiveProviderPermission(
              sessionId,
              messageId,
              permission,
              tool,
              commitDecision
            )
          },
          onInterleavedReasoningGap: (gap) => {
            console.warn(
              `[DeepChatAgent] Interleaved reasoning gap detected for ${gap.providerId}/${gap.modelId}. Update provider DB metadata at ${gap.providerDbSourceUrl}.`
            )
            if (!traceEnabled) return
            this.persistMessageTrace({
              sessionId,
              messageId,
              providerId: state.providerId,
              modelId: state.modelId,
              requestSeq: 0,
              payload: {
                endpoint: 'deepchat://interleaved-reasoning-gap',
                headers: {},
                body: gap
              }
            })
          },
          autoGrantPermission: async (permission) => {
            await this.host.autoGrantPermission(sessionId, permission)
          },
          reviewToolPermission: async (request) =>
            await this.host.reviewToolPermission(request, {
              providerId: state.providerId,
              modelId: state.modelId,
              messages: reviewConversationMessages.slice(-AUTO_APPROVE_REVIEW_MAX_RECENT_MESSAGES),
              signal: abortController.signal
            }),
          normalizeToolResult: async (tool) =>
            await this.host.normalizeToolResult({
              ...tool,
              abortSignal: abortController.signal
            }),
          cacheImage: this.dependencies.cacheImage
        },
        io: {
          sessionId,
          requestId: activeGeneration.runId,
          messageId,
          providerId: state.providerId,
          modelId: state.modelId,
          messageStore: this.dependencies.messageStore,
          abortSignal: abortController.signal
        }
      })
      return { runId: activeGeneration.runId, result }
    } catch (error) {
      this.dependencies.generationControlService.clearActiveGeneration(
        sessionId,
        activeGeneration.runId
      )
      throw error
    }
  }

  private appendTapeViewManifest(params: TapeViewManifestInput): void {
    try {
      const sourceMaps = this.dependencies.tapeService.getViewManifestSourceMaps(
        params.sessionId,
        params.messageId
      )
      const manifest = createTapeViewManifest({
        sessionId: params.sessionId,
        messageId: params.messageId,
        requestSeq: params.requestSeq,
        taskType: params.taskType,
        policy: params.policy,
        policyVersion: params.policyVersion ?? null,
        messages: params.messages,
        tools: params.tools,
        latestEntryId: sourceMaps.latestEntryId,
        anchorEntryIds: sourceMaps.reconstructionAnchorEntryIds,
        reconstructionAnchorEntryId: sourceMaps.reconstructionAnchorEntryId,
        included: params.selection
          ? buildIncludedRefs(params.selection, sourceMaps)
          : buildRequestRefs(params.messages, sourceMaps),
        excluded: params.selection ? buildExcludedRefs(params.selection, sourceMaps) : [],
        summaryCursor: params.selection?.summaryCursor,
        tokenBudget: params.tokenBudget,
        providerId: params.providerId,
        modelId: params.modelId,
        summaryCursorOrderSeq: params.summaryCursorOrderSeq,
        supportsVision: params.supportsVision,
        supportsAudioInput: params.supportsAudioInput,
        traceDebugEnabled: params.traceDebugEnabled
      })
      this.dependencies.tapeService.appendViewManifest(manifest)
    } catch (error) {
      logger.warn(
        `[DeepChatAgent] Failed to persist tape view manifest: ${
          error instanceof Error ? error.message : String(error)
        }`
      )
    }
  }

  private persistMessageTrace(args: {
    sessionId: string
    messageId: string
    providerId: string
    modelId: string
    payload: ProviderRequestTracePayload
    requestSeq?: number
  }): void {
    const persistable = buildPersistableMessageTracePayload(args.payload)
    this.dependencies.messageStore.insertMessageTrace({
      id: nanoid(),
      sessionId: args.sessionId,
      messageId: args.messageId,
      providerId: args.providerId,
      modelId: args.modelId,
      endpoint: persistable.endpoint,
      headersJson: persistable.headersJson,
      bodyJson: persistable.bodyJson,
      truncated: persistable.truncated,
      requestSeq: args.requestSeq
    })
  }

  private emitRateLimitWaitingMessage(
    sessionId: string,
    messageId: string,
    requestId: string,
    snapshot: RateLimitQueueSnapshot
  ): void {
    const block: AssistantMessageBlock = {
      type: 'action',
      action_type: 'rate_limit',
      content: '',
      status: 'pending',
      timestamp: Date.now(),
      extra: {
        providerId: snapshot.providerId,
        qpsLimit: snapshot.qpsLimit,
        currentQps: snapshot.currentQps,
        queueLength: snapshot.queueLength,
        estimatedWaitTime: snapshot.estimatedWaitTime
      }
    }
    publishDeepchatEvent('chat.stream.updated', {
      kind: 'snapshot',
      requestId,
      sessionId,
      messageId,
      updatedAt: Date.now(),
      blocks: cloneBlocksForRenderer([block])
    })
  }

  private clearRateLimitWaitingMessage(
    sessionId: string,
    messageId: string,
    requestId: string
  ): void {
    publishDeepchatEvent('chat.stream.updated', {
      kind: 'snapshot',
      requestId,
      sessionId,
      messageId,
      updatedAt: Date.now(),
      blocks: []
    })
  }

  private getLeadingSystemPrompt(messages: ChatMessage[]): string | null {
    const first = messages[0]
    return first?.role === 'system' && typeof first.content === 'string' ? first.content : null
  }

  private withoutLeadingSystemMessage(messages: ChatMessage[]): ChatMessage[] {
    return messages[0]?.role === 'system' ? messages.slice(1) : messages
  }

  private replaceLeadingSystemPrompt(messages: ChatMessage[], systemPrompt: string): ChatMessage[] {
    if (!systemPrompt) return this.withoutLeadingSystemMessage(messages)
    if (messages[0]?.role === 'system') {
      return [{ ...messages[0], content: systemPrompt }, ...messages.slice(1)]
    }
    return [{ role: 'system', content: systemPrompt }, ...messages]
  }

  private replaceLeadingSystemPromptInPlace(messages: ChatMessage[], systemPrompt: string): void {
    if (!systemPrompt) {
      if (messages[0]?.role === 'system') messages.shift()
      return
    }
    if (messages[0]?.role === 'system') {
      messages[0] = { ...messages[0], content: systemPrompt }
      return
    }
    messages.unshift({ role: 'system', content: systemPrompt })
  }

  private buildPreStreamTerminalMetadata(params: {
    sessionId: string
    messageId: string
    runId?: string
    runOutcome: 'aborted' | 'error'
    runStopReason: string
    startedAt: number
  }): string {
    const state = this.dependencies.runtimeSharedState.runtimeState.get(params.sessionId)
    const existing = parseMessageMetadata(
      this.dependencies.messageStore.getMessage(params.messageId)?.metadata ?? '{}'
    )
    const normalizeCount = (value: number | undefined): number =>
      typeof value === 'number' && Number.isFinite(value) && value >= 0 ? Math.floor(value) : 0
    const metadata: MessageMetadata = {
      ...existing,
      runId: params.runId ?? existing.runId ?? params.messageId,
      runOutcome: params.runOutcome,
      runStopReason: params.runStopReason,
      provider: state?.providerId ?? existing.provider,
      model: state?.modelId ?? existing.model,
      providerRounds: normalizeCount(existing.providerRounds),
      toolCalls: normalizeCount(existing.toolCalls),
      generationTime:
        typeof existing.generationTime === 'number' && Number.isFinite(existing.generationTime)
          ? Math.max(0, existing.generationTime)
          : Math.max(0, Date.now() - params.startedAt)
    }
    return JSON.stringify(metadata)
  }

  private parseAssistantBlocks(rawContent: string): AssistantMessageBlock[] {
    try {
      const parsed = JSON.parse(rawContent) as AssistantMessageBlock[]
      return Array.isArray(parsed) ? parsed : []
    } catch {
      return []
    }
  }

  private isAbortError(error: unknown): boolean {
    return error instanceof Error && (error.name === 'AbortError' || error.name === 'CanceledError')
  }

  private throwIfAbortRequested(signal: AbortSignal): void {
    if (signal.aborted) throw createAbortError()
  }

  private logSlowPreStreamStep(sessionId: string, step: string, startedAt: number): void {
    const elapsed = Date.now() - startedAt
    if (elapsed < PRE_STREAM_SLOW_STEP_MS) return
    logger.warn(
      `[DeepChatAgent] pre-stream step slow session=${sessionId} step=${step} elapsed=${elapsed}ms`
    )
  }
}
