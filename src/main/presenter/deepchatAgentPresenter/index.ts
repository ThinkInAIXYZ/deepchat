import type {
  AssistantMessageBlock,
  ChatMessageRecord,
  DeepChatSessionState,
  IAgentImplementation,
  MessageFile,
  PendingSessionInputRecord,
  PermissionMode,
  SendMessageInput,
  SessionCompactionState,
  SessionGenerationSettings,
  ToolInteractionResponse,
  ToolInteractionResult,
  UserMessageContent
} from '@shared/types/agent-interface'
import type { MCPToolCall, MCPToolResponse } from '@shared/types/core/mcp'
import type { ChatMessage } from '@shared/types/core/chat-message'
import type {
  IConfigPresenter,
  ILlmProviderPresenter,
  ModelConfig,
  RateLimitQueueSnapshot
} from '@shared/presenter'
import type { MCPToolDefinition } from '@shared/types/core/mcp'
import type { IToolPresenter } from '@shared/types/presenters/tool.presenter'
import type { ReasoningPortrait } from '@shared/types/model-db'
import {
  normalizeLegacyThinkingBudgetValue,
  parseFiniteNumericValue,
  toValidNonNegativeInteger,
  validateGenerationNumericField
} from '@shared/utils/generationSettingsValidation'
import { nanoid } from 'nanoid'
import type { SQLitePresenter } from '../sqlitePresenter'
import { eventBus, SendTarget } from '@/eventbus'
import { SESSION_EVENTS, STREAM_EVENTS } from '@/events'
import {
  buildRuntimeCapabilitiesPrompt,
  buildSystemEnvPrompt
} from '@/lib/agentRuntime/systemEnvPromptBuilder'
import { presenter } from '@/presenter'
import {
  buildContext,
  buildResumeContext,
  createUserChatMessage,
  fitMessagesToContextWindow
} from './contextBuilder'
import { appendSummarySection, CompactionService, type CompactionIntent } from './compactionService'
import { buildPersistableMessageTracePayload } from './messageTracePayload'
import { buildTerminalErrorBlocks, DeepChatMessageStore } from './messageStore'
import { PendingInputCoordinator } from './pendingInputCoordinator'
import { DeepChatPendingInputStore } from './pendingInputStore'
import { processStream } from './process'
import { DeepChatSessionStore, type SessionSummaryState } from './sessionStore'
import type { InterleavedReasoningConfig, PendingToolInteraction, ProcessResult } from './types'
import { ToolOutputGuard } from './toolOutputGuard'
import type { ProviderRequestTracePayload } from '../llmProviderPresenter/requestTrace'
import type { NewSessionHooksBridge } from '../hooksNotifications/newSessionBridge'
import { providerDbLoader } from '../configPresenter/providerDbLoader'
import { resolveSessionVisionTarget } from '../vision/sessionVisionResolver'
import {
  buildAssistantPreviewMarkdown,
  buildAssistantResponseMarkdown,
  emitDeepChatInternalSessionUpdate,
  extractWaitingInteraction
} from './internalSessionEvents'

type PendingInteractionEntry = {
  interaction: PendingToolInteraction
  blockIndex: number
}

type DeferredToolExecutionResult = {
  responseText: string
  isError: boolean
  offloadPath?: string
  rtkApplied?: boolean
  rtkMode?: 'rewrite' | 'direct' | 'bypass'
  rtkFallbackReason?: string
  requiresPermission?: boolean
  permissionRequest?: PendingToolInteraction['permission']
  terminalError?: string
}

type ResumeBudgetToolCall = {
  id: string
  name: string
  offloadPath?: string
}

type PersistedSessionGenerationRow = {
  provider_id: string
  model_id: string
  system_prompt: string | null
  temperature: number | null
  context_length: number | null
  max_tokens: number | null
  thinking_budget: number | null
  reasoning_effort: SessionGenerationSettings['reasoningEffort'] | null
  verbosity: SessionGenerationSettings['verbosity'] | null
  force_interleaved_thinking_compat: number | null
}

type SystemPromptCacheEntry = {
  prompt: string
  dayKey: string
  fingerprint: string
}

type ActiveGeneration = {
  runId: string
  messageId: string
  abortController: AbortController
}

const isReasoningEffort = (value: unknown): value is 'minimal' | 'low' | 'medium' | 'high' =>
  value === 'minimal' || value === 'low' || value === 'medium' || value === 'high'

const isVerbosity = (value: unknown): value is 'low' | 'medium' | 'high' =>
  value === 'low' || value === 'medium' || value === 'high'

const RATE_LIMIT_STREAM_MESSAGE_PREFIX = '__rate_limit__:'

const createAbortError = (): Error => {
  if (typeof DOMException !== 'undefined') {
    return new DOMException('Aborted', 'AbortError')
  }

  const error = new Error('Aborted')
  error.name = 'AbortError'
  return error
}

export class DeepChatAgentPresenter implements IAgentImplementation {
  private readonly llmProviderPresenter: ILlmProviderPresenter
  private readonly configPresenter: IConfigPresenter
  private readonly sqlitePresenter: SQLitePresenter
  private readonly toolPresenter: IToolPresenter | null
  private readonly sessionStore: DeepChatSessionStore
  private readonly messageStore: DeepChatMessageStore
  private readonly pendingInputStore: DeepChatPendingInputStore
  private readonly pendingInputCoordinator: PendingInputCoordinator
  private readonly runtimeState: Map<string, DeepChatSessionState> = new Map()
  private readonly sessionGenerationSettings: Map<string, SessionGenerationSettings> = new Map()
  private readonly abortControllers: Map<string, AbortController> = new Map()
  private readonly deferredToolAbortControllers: Map<string, AbortController> = new Map()
  private readonly activeGenerations: Map<string, ActiveGeneration> = new Map()
  private readonly sessionAgentIds: Map<string, string> = new Map()
  private readonly sessionProjectDirs: Map<string, string | null> = new Map()
  private readonly systemPromptCache: Map<string, SystemPromptCacheEntry> = new Map()
  private readonly sessionCompactionStates: Map<string, SessionCompactionState> = new Map()
  private readonly interactionLocks: Set<string> = new Set()
  private readonly resumingMessages: Set<string> = new Set()
  private readonly drainingPendingQueues: Set<string> = new Set()
  private readonly compactionService: CompactionService
  private readonly toolOutputGuard: ToolOutputGuard
  private readonly hooksBridge?: NewSessionHooksBridge
  private nextRunSequence = 0

  constructor(
    llmProviderPresenter: ILlmProviderPresenter,
    configPresenter: IConfigPresenter,
    sqlitePresenter: SQLitePresenter,
    toolPresenter?: IToolPresenter,
    hooksBridge?: NewSessionHooksBridge
  ) {
    this.llmProviderPresenter = llmProviderPresenter
    this.configPresenter = configPresenter
    this.sqlitePresenter = sqlitePresenter
    this.toolPresenter = toolPresenter ?? null
    this.sessionStore = new DeepChatSessionStore(sqlitePresenter)
    this.messageStore = new DeepChatMessageStore(sqlitePresenter)
    this.pendingInputStore = new DeepChatPendingInputStore(sqlitePresenter)
    this.pendingInputCoordinator = new PendingInputCoordinator(this.pendingInputStore)
    this.compactionService = new CompactionService(
      this.sessionStore,
      this.messageStore,
      this.llmProviderPresenter,
      this.configPresenter,
      async (sessionId) => {
        const agentId = this.getSessionAgentId(sessionId) ?? 'deepchat'
        return await this.configPresenter.resolveDeepChatAgentConfig(agentId)
      }
    )
    this.toolOutputGuard = new ToolOutputGuard()
    this.hooksBridge = hooksBridge

    const recovered = this.messageStore.recoverPendingMessages()
    if (recovered > 0) {
      console.log(`DeepChatAgent: recovered ${recovered} pending messages to error status`)
    }

    const recoveredPendingInputs = this.pendingInputCoordinator.recoverClaimedInputsAfterRestart()
    if (recoveredPendingInputs > 0) {
      console.log(
        `DeepChatAgent: recovered ${recoveredPendingInputs} sessions with claimed pending inputs`
      )
    }
  }

  async initSession(
    sessionId: string,
    config: {
      agentId?: string
      providerId: string
      modelId: string
      projectDir?: string | null
      permissionMode?: PermissionMode
      generationSettings?: Partial<SessionGenerationSettings>
    }
  ): Promise<void> {
    const projectDir = this.normalizeProjectDir(config.projectDir)
    const permissionMode: PermissionMode =
      config.permissionMode === 'default' ? 'default' : 'full_access'
    console.log(
      `[DeepChatAgent] initSession id=${sessionId} provider=${config.providerId} model=${config.modelId} permission=${permissionMode} projectDir=${projectDir ?? '<none>'}`
    )
    const generationSettings = await this.sanitizeGenerationSettings(
      config.providerId,
      config.modelId,
      config.generationSettings ?? {}
    )
    this.sessionStore.create(
      sessionId,
      config.providerId,
      config.modelId,
      permissionMode,
      generationSettings
    )
    this.sessionAgentIds.set(
      sessionId,
      config.agentId?.trim() || this.getSessionAgentId(sessionId) || 'deepchat'
    )
    this.sessionProjectDirs.set(sessionId, projectDir)
    this.sessionGenerationSettings.set(sessionId, generationSettings)
    this.runtimeState.set(sessionId, {
      status: 'idle',
      providerId: config.providerId,
      modelId: config.modelId,
      permissionMode
    })
    this.sessionCompactionStates.set(sessionId, this.buildIdleCompactionState())
    this.invalidateSystemPromptCache(sessionId)
  }

  async destroySession(sessionId: string): Promise<void> {
    const controller =
      this.activeGenerations.get(sessionId)?.abortController ?? this.abortControllers.get(sessionId)
    if (controller) {
      controller.abort()
      this.abortControllers.delete(sessionId)
    }
    this.abortDeferredToolAbortControllers(sessionId)
    this.activeGenerations.delete(sessionId)

    this.pendingInputCoordinator.deleteBySession(sessionId)
    this.messageStore.deleteBySession(sessionId)
    this.sessionStore.delete(sessionId)
    this.runtimeState.delete(sessionId)
    this.sessionAgentIds.delete(sessionId)
    this.sessionGenerationSettings.delete(sessionId)
    this.sessionProjectDirs.delete(sessionId)
    this.systemPromptCache.delete(sessionId)
    this.sessionCompactionStates.delete(sessionId)
    this.drainingPendingQueues.delete(sessionId)
  }

  async getSessionState(sessionId: string): Promise<DeepChatSessionState | null> {
    const state = this.runtimeState.get(sessionId)
    if (state) {
      this.getSessionAgentId(sessionId)
      if (this.hasPendingInteractions(sessionId)) {
        state.status = 'generating'
      }
      await this.getEffectiveSessionGenerationSettings(sessionId)
      return { ...state }
    }

    const dbSession = this.sessionStore.get(sessionId)
    if (!dbSession) return null

    this.getSessionAgentId(sessionId)
    const rebuilt: DeepChatSessionState = {
      status: this.hasPendingInteractions(sessionId) ? 'generating' : 'idle',
      providerId: dbSession.provider_id,
      modelId: dbSession.model_id,
      permissionMode: dbSession.permission_mode || 'full_access'
    }
    this.runtimeState.set(sessionId, rebuilt)
    await this.getEffectiveSessionGenerationSettings(sessionId)
    return { ...rebuilt }
  }

  async listPendingInputs(sessionId: string): Promise<PendingSessionInputRecord[]> {
    return this.pendingInputCoordinator.listPendingInputs(sessionId)
  }

  async queuePendingInput(
    sessionId: string,
    content: string | SendMessageInput
  ): Promise<PendingSessionInputRecord> {
    const state = await this.getSessionState(sessionId)
    if (!state) {
      throw new Error(`Session ${sessionId} not found`)
    }

    const shouldClaimImmediately =
      this.isAwaitingToolQuestionFollowUp(sessionId) ||
      this.shouldStartQueuedInputImmediately(sessionId, state.status)
    const record = this.pendingInputCoordinator.queuePendingInput(sessionId, content, {
      state: shouldClaimImmediately ? 'claimed' : 'pending'
    })

    if (record.state === 'claimed') {
      void this.processMessage(sessionId, record.payload, {
        projectDir: this.resolveProjectDir(sessionId),
        pendingQueueItemId: record.id
      })
      return record
    }

    void this.drainPendingQueueIfPossible(sessionId, 'enqueue')
    return record
  }

  async updateQueuedInput(
    sessionId: string,
    itemId: string,
    content: string | SendMessageInput
  ): Promise<PendingSessionInputRecord> {
    await this.ensureSessionReadyForPendingInputMutation(sessionId)
    return this.pendingInputCoordinator.updateQueuedInput(sessionId, itemId, content)
  }

  async moveQueuedInput(
    sessionId: string,
    itemId: string,
    toIndex: number
  ): Promise<PendingSessionInputRecord[]> {
    await this.ensureSessionReadyForPendingInputMutation(sessionId)
    return this.pendingInputCoordinator.moveQueuedInput(sessionId, itemId, toIndex)
  }

  async convertPendingInputToSteer(
    sessionId: string,
    itemId: string
  ): Promise<PendingSessionInputRecord> {
    await this.ensureSessionReadyForPendingInputMutation(sessionId)
    return this.pendingInputCoordinator.convertPendingInputToSteer(sessionId, itemId)
  }

  async deletePendingInput(sessionId: string, itemId: string): Promise<void> {
    await this.ensureSessionReadyForPendingInputMutation(sessionId)
    this.pendingInputCoordinator.deletePendingInput(sessionId, itemId)
  }

  async resumePendingQueue(sessionId: string): Promise<void> {
    const state = await this.getSessionState(sessionId)
    if (!state) {
      throw new Error(`Session ${sessionId} not found`)
    }
    if (this.isAwaitingToolQuestionFollowUp(sessionId)) {
      return
    }

    void this.drainPendingQueueIfPossible(sessionId, 'resume')
  }

  async processMessage(
    sessionId: string,
    content: string | SendMessageInput,
    context?: {
      projectDir?: string | null
      emitRefreshBeforeStream?: boolean
      pendingQueueItemId?: string
    }
  ): Promise<void> {
    const state = this.runtimeState.get(sessionId)
    if (!state) throw new Error(`Session ${sessionId} not found`)
    if (this.hasPendingInteractions(sessionId)) {
      throw new Error('Pending tool interactions must be resolved before sending a new message.')
    }

    const normalizedInput = this.normalizeUserMessageInput(content)
    const supportsVision = this.supportsVision(state.providerId, state.modelId)
    const projectDir = this.resolveProjectDir(sessionId, context?.projectDir)
    console.log(
      `[DeepChatAgent] processMessage session=${sessionId} content="${normalizedInput.text.slice(0, 60)}" projectDir=${projectDir ?? '<none>'}`
    )

    this.setSessionStatus(sessionId, 'generating')
    let consumedPendingQueueItem = false
    let userMessageId: string | null = null
    let assistantMessageId: string | null = null

    try {
      const generationSettings = await this.getEffectiveSessionGenerationSettings(sessionId)
      const interleavedReasoning = this.resolveInterleavedReasoningConfig(
        state.providerId,
        state.modelId,
        generationSettings
      )
      const maxTokens = generationSettings.maxTokens
      const tools = await this.loadToolDefinitionsForSession(sessionId, projectDir)
      const baseSystemPrompt = await this.buildSystemPromptWithSkills(
        sessionId,
        generationSettings.systemPrompt,
        tools
      )
      const historyRecords = this.messageStore
        .getMessages(sessionId)
        .filter((message) => message.status === 'sent')
      const userContent: UserMessageContent = {
        text: normalizedInput.text,
        files: normalizedInput.files || [],
        links: [],
        search: false,
        think: false
      }

      const compactionIntent = await this.compactionService.prepareForNextUserTurn({
        sessionId,
        providerId: state.providerId,
        modelId: state.modelId,
        systemPrompt: baseSystemPrompt,
        contextLength: generationSettings.contextLength,
        reserveTokens: maxTokens,
        supportsVision,
        preserveInterleavedReasoning: interleavedReasoning.preserveReasoningContent,
        newUserContent: normalizedInput
      })
      let summaryState: SessionSummaryState

      if (compactionIntent) {
        const compactionMessageId = this.messageStore.createCompactionMessage(
          sessionId,
          this.messageStore.getNextOrderSeq(sessionId),
          'compacting',
          compactionIntent.previousState.summaryUpdatedAt
        )
        userMessageId = this.messageStore.createUserMessage(
          sessionId,
          this.messageStore.getNextOrderSeq(sessionId),
          userContent
        )
        this.emitCompactionState(sessionId, {
          status: 'compacting',
          cursorOrderSeq: compactionIntent.targetCursorOrderSeq,
          summaryUpdatedAt: compactionIntent.previousState.summaryUpdatedAt
        })
        summaryState = await this.applyCompactionIntent(sessionId, compactionIntent, {
          compactionMessageId,
          startedExternally: true
        })
      } else {
        summaryState = this.sessionStore.getSummaryState(sessionId)
        userMessageId = this.messageStore.createUserMessage(
          sessionId,
          this.messageStore.getNextOrderSeq(sessionId),
          userContent
        )
      }
      if (!userMessageId) {
        throw new Error('Failed to create user message.')
      }
      this.emitMessageRefresh(sessionId, userMessageId)

      this.dispatchHook('UserPromptSubmit', {
        sessionId,
        messageId: userMessageId,
        promptPreview: normalizedInput.text,
        providerId: state.providerId,
        modelId: state.modelId,
        projectDir
      })

      const systemPrompt = appendSummarySection(baseSystemPrompt, summaryState.summaryText)
      const messages = buildContext(
        sessionId,
        normalizedInput,
        systemPrompt,
        generationSettings.contextLength,
        maxTokens,
        this.messageStore,
        supportsVision,
        {
          summaryCursorOrderSeq: summaryState.summaryCursorOrderSeq,
          historyRecords,
          preserveInterleavedReasoning: interleavedReasoning.preserveReasoningContent
        }
      )

      const assistantOrderSeq = this.messageStore.getNextOrderSeq(sessionId)
      assistantMessageId = this.messageStore.createAssistantMessage(sessionId, assistantOrderSeq)

      if (context?.pendingQueueItemId) {
        this.pendingInputCoordinator.consumeQueuedInput(sessionId, context.pendingQueueItemId)
        consumedPendingQueueItem = true
      }

      if (context?.emitRefreshBeforeStream) {
        this.emitMessageRefresh(sessionId, assistantMessageId)
      }

      const { runId, result } = await this.runStreamForMessage({
        sessionId,
        messageId: assistantMessageId,
        messages,
        projectDir,
        promptPreview: normalizedInput.text,
        tools,
        interleavedReasoning
      })
      try {
        this.applyProcessResultStatus(sessionId, result, runId)
      } finally {
        this.clearActiveGeneration(sessionId, runId)
      }
      if (result?.status === 'completed') {
        void this.drainPendingQueueIfPossible(sessionId, 'completed')
      }
    } catch (err) {
      console.error('[DeepChatAgent] processMessage error:', err)
      if (context?.pendingQueueItemId && !consumedPendingQueueItem) {
        try {
          this.pendingInputCoordinator.releaseClaimedQueueInput(
            sessionId,
            context.pendingQueueItemId
          )
        } catch (releaseError) {
          console.warn('[DeepChatAgent] failed to release claimed queue input:', releaseError)
        }
      }
      const errorMessage = err instanceof Error ? err.message : String(err)
      if (assistantMessageId) {
        const existingAssistant = this.messageStore.getMessage(assistantMessageId)
        const blocks = buildTerminalErrorBlocks(
          existingAssistant ? this.parseAssistantBlocks(existingAssistant.content) : [],
          errorMessage
        )
        this.messageStore.setMessageError(assistantMessageId, blocks)
        this.emitMessageRefresh(sessionId, assistantMessageId)
      }
      this.dispatchHook('Stop', {
        sessionId,
        providerId: state.providerId,
        modelId: state.modelId,
        projectDir,
        stop: { reason: 'error', userStop: false }
      })
      this.dispatchHook('SessionEnd', {
        sessionId,
        providerId: state.providerId,
        modelId: state.modelId,
        projectDir,
        error: { message: errorMessage }
      })
      this.setSessionStatus(sessionId, 'error')
    }
  }

  async respondToolInteraction(
    sessionId: string,
    messageId: string,
    toolCallId: string,
    response: ToolInteractionResponse
  ): Promise<ToolInteractionResult> {
    const lockKey = `${messageId}:${toolCallId}`
    if (this.interactionLocks.has(lockKey)) {
      return { resumed: false }
    }
    this.interactionLocks.add(lockKey)

    try {
      const message = await this.messageStore.getMessage(messageId)
      if (!message || message.role !== 'assistant') {
        throw new Error(`Assistant message not found: ${messageId}`)
      }
      if (message.sessionId !== sessionId) {
        throw new Error(`Message ${messageId} does not belong to session ${sessionId}`)
      }

      const blocks = this.parseAssistantBlocks(message.content)
      const pendingEntries = this.collectPendingInteractionEntries(messageId, blocks)
      if (pendingEntries.length === 0) {
        throw new Error('No pending interaction found in target message.')
      }

      const currentEntry = pendingEntries[0]
      if (currentEntry.interaction.toolCallId !== toolCallId) {
        throw new Error('Interaction queue out of order. Please handle the first pending item.')
      }

      let waitingForUserMessage = false
      let resumeBudgetToolCall: ResumeBudgetToolCall | null = null
      let emitResolvedToolHook: (() => void) | null = null
      const actionBlock = blocks[currentEntry.blockIndex]
      const toolCall = actionBlock.tool_call
      if (!toolCall?.id) {
        throw new Error('Invalid action block without tool call id.')
      }

      if (actionBlock.action_type === 'question_request') {
        if (response.kind === 'permission') {
          throw new Error('Invalid response kind for question interaction.')
        }

        if (response.kind === 'question_other') {
          const deferredResult = 'User chose to answer with a follow-up message.'
          this.markQuestionResolved(actionBlock, '')
          this.updateToolCallResponse(blocks, toolCall.id, deferredResult, false)
          waitingForUserMessage = true
        } else {
          const answerText =
            response.kind === 'question_option' ? response.optionLabel : response.answerText
          const normalizedAnswer = answerText.trim()
          if (!normalizedAnswer) {
            throw new Error('Answer cannot be empty.')
          }
          this.markQuestionResolved(actionBlock, normalizedAnswer)
          this.updateToolCallResponse(blocks, toolCall.id, normalizedAnswer, false)
        }
      } else if (actionBlock.action_type === 'tool_call_permission') {
        if (response.kind !== 'permission') {
          throw new Error('Invalid response kind for permission interaction.')
        }
        const permissionPayload = this.parsePermissionPayload(actionBlock)
        const permissionType = permissionPayload?.permissionType ?? 'write'
        const state = this.runtimeState.get(sessionId)
        const projectDir = this.resolveProjectDir(sessionId)
        let shouldDispatchResolvedToolHook = false

        if (response.granted) {
          this.markPermissionResolved(actionBlock, true, permissionType)
          await this.grantPermissionForPayload(sessionId, permissionPayload, toolCall)
          this.dispatchHook('PreToolUse', {
            sessionId,
            messageId,
            providerId: state?.providerId,
            modelId: state?.modelId,
            projectDir,
            tool: {
              callId: toolCall.id,
              name: toolCall.name,
              params: toolCall.params
            }
          })
          const execution = await this.executeDeferredToolCall(sessionId, messageId, toolCall)
          if (execution.terminalError) {
            this.dispatchHook('PostToolUseFailure', {
              sessionId,
              messageId,
              providerId: state?.providerId,
              modelId: state?.modelId,
              projectDir,
              tool: {
                callId: toolCall.id,
                name: toolCall.name,
                params: toolCall.params,
                error: execution.terminalError
              }
            })
            this.updateToolCallResponse(blocks, toolCall.id, execution.terminalError, true)
            this.messageStore.setMessageError(messageId, blocks)
            this.emitMessageRefresh(sessionId, messageId)
            eventBus.sendToRenderer(STREAM_EVENTS.ERROR, SendTarget.ALL_WINDOWS, {
              conversationId: sessionId,
              eventId: messageId,
              messageId,
              error: execution.terminalError
            })
            this.dispatchHook('Stop', {
              sessionId,
              messageId,
              providerId: state?.providerId,
              modelId: state?.modelId,
              projectDir,
              stop: { reason: 'error', userStop: false }
            })
            this.dispatchHook('SessionEnd', {
              sessionId,
              messageId,
              providerId: state?.providerId,
              modelId: state?.modelId,
              projectDir,
              error: { message: execution.terminalError }
            })
            this.setSessionStatus(sessionId, 'error')
            return { resumed: false }
          }
          this.updateToolCallResponse(
            blocks,
            toolCall.id,
            execution.responseText,
            execution.isError,
            {
              rtkApplied: execution.rtkApplied,
              rtkMode: execution.rtkMode,
              rtkFallbackReason: execution.rtkFallbackReason
            }
          )
          resumeBudgetToolCall = {
            id: toolCall.id,
            name: toolCall.name || '',
            offloadPath: execution.offloadPath
          }

          if (execution.requiresPermission && execution.permissionRequest) {
            this.dispatchHook('PermissionRequest', {
              sessionId,
              messageId,
              providerId: state?.providerId,
              modelId: state?.modelId,
              projectDir,
              permission: execution.permissionRequest,
              tool: {
                callId: toolCall.id,
                name: toolCall.name,
                params: toolCall.params
              }
            })
            actionBlock.status = 'pending'
            actionBlock.content = execution.permissionRequest.description
            actionBlock.extra = {
              ...actionBlock.extra,
              needsUserAction: true,
              permissionType: execution.permissionRequest.permissionType,
              permissionRequest: JSON.stringify(execution.permissionRequest)
            }
          } else {
            shouldDispatchResolvedToolHook = true
          }
        } else {
          this.markPermissionResolved(actionBlock, false, permissionType)
          this.updateToolCallResponse(blocks, toolCall.id, 'User denied the request.', true)
          shouldDispatchResolvedToolHook = true
        }

        emitResolvedToolHook = shouldDispatchResolvedToolHook
          ? () => {
              this.dispatchResolvedToolHook({
                sessionId,
                messageId,
                providerId: state?.providerId,
                modelId: state?.modelId,
                projectDir,
                blocks,
                toolCall
              })
            }
          : null
      } else {
        throw new Error(`Unsupported action type: ${actionBlock.action_type}`)
      }

      this.messageStore.updateAssistantContent(messageId, blocks)
      const remainingPending = this.collectPendingInteractionEntries(messageId, blocks)
      this.emitMessageRefresh(sessionId, messageId)

      if (remainingPending.length > 0) {
        emitResolvedToolHook?.()
        this.messageStore.updateMessageStatus(messageId, 'pending')
        this.setSessionStatus(sessionId, 'generating')
        return { resumed: false }
      }

      if (waitingForUserMessage) {
        emitResolvedToolHook?.()
        this.messageStore.updateMessageStatus(messageId, 'sent')
        this.setSessionStatus(sessionId, 'idle')
        return { resumed: false, waitingForUserMessage: true }
      }

      const resumed = await this.resumeAssistantMessage(
        sessionId,
        messageId,
        blocks,
        resumeBudgetToolCall
      )
      emitResolvedToolHook?.()
      return { resumed }
    } finally {
      this.interactionLocks.delete(lockKey)
    }
  }

  async setPermissionMode(sessionId: string, mode: PermissionMode): Promise<void> {
    const normalizedMode: PermissionMode = mode === 'default' ? 'default' : 'full_access'
    const state = this.runtimeState.get(sessionId)
    if (state) {
      state.permissionMode = normalizedMode
    }
    this.sessionStore.updatePermissionMode(sessionId, normalizedMode)
  }

  async setSessionModel(sessionId: string, providerId: string, modelId: string): Promise<void> {
    const nextProviderId = providerId?.trim()
    const nextModelId = modelId?.trim()
    if (!nextProviderId || !nextModelId) {
      throw new Error('Session model update requires providerId and modelId.')
    }

    const state = this.runtimeState.get(sessionId)
    const dbSession = this.sessionStore.get(sessionId)
    if (!state && !dbSession) {
      throw new Error(`Session ${sessionId} not found`)
    }

    if (state?.status === 'generating') {
      throw new Error('Cannot switch model while session is generating.')
    }

    const currentGeneration = await this.getEffectiveSessionGenerationSettings(sessionId)
    const sanitized = await this.sanitizeGenerationSettings(nextProviderId, nextModelId, {
      systemPrompt: currentGeneration.systemPrompt
    })

    if (state) {
      state.providerId = nextProviderId
      state.modelId = nextModelId
    } else {
      this.runtimeState.set(sessionId, {
        status: 'idle',
        providerId: nextProviderId,
        modelId: nextModelId,
        permissionMode: dbSession?.permission_mode || 'full_access'
      })
    }

    this.sessionStore.updateSessionModel(sessionId, nextProviderId, nextModelId)
    this.sessionStore.updateGenerationSettings(
      sessionId,
      this.buildPersistedGenerationSettingsReplacement(sanitized)
    )
    this.sessionGenerationSettings.set(sessionId, sanitized)
    this.invalidateSystemPromptCache(sessionId)
  }

  async getPermissionMode(sessionId: string): Promise<PermissionMode> {
    const state = this.runtimeState.get(sessionId)
    if (state) {
      return state.permissionMode
    }
    const dbSession = this.sessionStore.get(sessionId)
    return dbSession?.permission_mode || 'full_access'
  }

  async getGenerationSettings(sessionId: string): Promise<SessionGenerationSettings | null> {
    const state = this.runtimeState.get(sessionId)
    const dbSession = this.sessionStore.get(sessionId)
    if (!state && !dbSession) {
      return null
    }
    return await this.getEffectiveSessionGenerationSettings(sessionId)
  }

  async updateGenerationSettings(
    sessionId: string,
    settings: Partial<SessionGenerationSettings>
  ): Promise<SessionGenerationSettings> {
    const state = this.runtimeState.get(sessionId)
    const dbSession = this.sessionStore.get(sessionId)
    if (!state && !dbSession) {
      throw new Error(`Session ${sessionId} not found`)
    }

    const providerId = state?.providerId ?? dbSession?.provider_id
    const modelId = state?.modelId ?? dbSession?.model_id
    if (!providerId || !modelId) {
      throw new Error(`Session ${sessionId} model information is missing`)
    }

    const current = await this.getEffectiveSessionGenerationSettings(sessionId)
    const sanitized = await this.sanitizeGenerationSettings(providerId, modelId, settings, current)
    this.sessionGenerationSettings.set(sessionId, sanitized)
    this.sessionStore.updateGenerationSettings(
      sessionId,
      this.buildPersistedGenerationSettingsPatch(settings, sanitized)
    )
    if (Object.prototype.hasOwnProperty.call(settings, 'systemPrompt')) {
      this.invalidateSystemPromptCache(sessionId)
    }
    return sanitized
  }

  async cancelGeneration(sessionId: string): Promise<void> {
    const activeGeneration = this.activeGenerations.get(sessionId)
    if (activeGeneration) {
      activeGeneration.abortController.abort()
      this.clearActiveGeneration(sessionId, activeGeneration.runId)

      const assistantMessage = this.messageStore.getMessage(activeGeneration.messageId)
      if (assistantMessage?.role === 'assistant') {
        const blocks = buildTerminalErrorBlocks(
          this.parseAssistantBlocks(assistantMessage.content),
          'common.error.userCanceledGeneration'
        )
        this.messageStore.setMessageError(activeGeneration.messageId, blocks)
        this.emitMessageRefresh(sessionId, activeGeneration.messageId)
      }

      this.dispatchTerminalHooks(sessionId, this.runtimeState.get(sessionId), {
        status: 'aborted',
        stopReason: 'user_stop',
        errorMessage: 'common.error.userCanceledGeneration'
      })
    } else {
      const controller = this.abortControllers.get(sessionId)
      if (controller) {
        controller.abort()
        this.abortControllers.delete(sessionId)
      }
    }
    this.abortDeferredToolAbortControllers(sessionId)
    this.setSessionStatus(sessionId, 'idle')
  }

  getActiveGeneration(sessionId: string): { eventId: string; runId: string } | null {
    const activeGeneration = this.activeGenerations.get(sessionId)
    if (!activeGeneration) {
      return null
    }

    return {
      eventId: activeGeneration.messageId,
      runId: activeGeneration.runId
    }
  }

  async cancelGenerationByEventId(sessionId: string, eventId: string): Promise<boolean> {
    const activeGeneration = this.activeGenerations.get(sessionId)
    if (!activeGeneration || activeGeneration.messageId !== eventId) {
      return false
    }

    await this.cancelGeneration(sessionId)
    return true
  }

  private dispatchTerminalHooks(
    sessionId: string,
    state: DeepChatSessionState | undefined,
    result: ProcessResult
  ): void {
    if (!state || result.status === 'paused') {
      return
    }

    this.dispatchHook('Stop', {
      sessionId,
      providerId: state.providerId,
      modelId: state.modelId,
      projectDir: this.resolveProjectDir(sessionId),
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
      projectDir: this.resolveProjectDir(sessionId),
      usage: result.usage ?? null,
      error:
        result.errorMessage || result.terminalError
          ? {
              message: result.errorMessage ?? result.terminalError
            }
          : null
    })
  }

  private dispatchHook(
    event:
      | 'UserPromptSubmit'
      | 'SessionStart'
      | 'PreToolUse'
      | 'PostToolUse'
      | 'PostToolUseFailure'
      | 'PermissionRequest'
      | 'Stop'
      | 'SessionEnd',
    context: {
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
      stop?: {
        reason?: string
        userStop?: boolean
      } | null
      usage?: Record<string, number> | null
      error?: {
        message?: string
        stack?: string
      } | null
    }
  ): void {
    try {
      this.hooksBridge?.dispatch(event, {
        ...context,
        agentId: this.getSessionAgentId(context.sessionId) ?? 'deepchat'
      })
    } catch (error) {
      console.warn(`[DeepChatAgent] Failed to dispatch ${event} hook:`, error)
    }
  }

  private getSessionAgentId(sessionId: string): string | undefined {
    const cached = this.sessionAgentIds.get(sessionId)?.trim()
    if (cached) {
      return cached
    }

    const persisted = this.sqlitePresenter.newSessionsTable?.get(sessionId)?.agent_id?.trim()
    if (persisted) {
      this.sessionAgentIds.set(sessionId, persisted)
      return persisted
    }

    return undefined
  }

  private getAbortSignalForSession(sessionId: string): AbortSignal | undefined {
    return (
      this.activeGenerations.get(sessionId)?.abortController.signal ??
      this.abortControllers.get(sessionId)?.signal
    )
  }

  private buildDeferredToolAbortKey(sessionId: string, toolCallId: string): string {
    return `${sessionId}:${toolCallId}`
  }

  private registerDeferredToolAbortController(
    sessionId: string,
    toolCallId: string
  ): AbortController {
    const key = this.buildDeferredToolAbortKey(sessionId, toolCallId)
    this.deferredToolAbortControllers.get(key)?.abort()
    const controller = new AbortController()
    this.deferredToolAbortControllers.set(key, controller)
    return controller
  }

  private clearDeferredToolAbortController(
    sessionId: string,
    toolCallId: string,
    controller?: AbortController
  ): void {
    const key = this.buildDeferredToolAbortKey(sessionId, toolCallId)
    const current = this.deferredToolAbortControllers.get(key)
    if (!current) {
      return
    }
    if (controller && current !== controller) {
      return
    }
    this.deferredToolAbortControllers.delete(key)
  }

  private abortDeferredToolAbortControllers(sessionId: string): void {
    const prefix = `${sessionId}:`
    for (const [key, controller] of this.deferredToolAbortControllers) {
      if (!key.startsWith(prefix)) {
        continue
      }
      controller.abort()
      this.deferredToolAbortControllers.delete(key)
    }
  }

  private throwIfAbortRequested(signal?: AbortSignal): void {
    if (signal?.aborted) {
      throw createAbortError()
    }
  }

  private isAbortError(error: unknown): boolean {
    return error instanceof Error && (error.name === 'AbortError' || error.name === 'CanceledError')
  }

  private dispatchResolvedToolHook(params: {
    sessionId: string
    messageId: string
    providerId?: string
    modelId?: string
    projectDir?: string | null
    blocks: AssistantMessageBlock[]
    toolCall: NonNullable<AssistantMessageBlock['tool_call']>
  }): void {
    const resolvedBlock = params.blocks.find(
      (block) => block.type === 'tool_call' && block.tool_call?.id === params.toolCall.id
    )
    const responseText = resolvedBlock?.tool_call?.response ?? ''
    const isError = resolvedBlock?.status === 'error'

    this.dispatchHook(isError ? 'PostToolUseFailure' : 'PostToolUse', {
      sessionId: params.sessionId,
      messageId: params.messageId,
      providerId: params.providerId,
      modelId: params.modelId,
      projectDir: params.projectDir,
      tool: isError
        ? {
            callId: params.toolCall.id,
            name: params.toolCall.name,
            params: params.toolCall.params,
            error: responseText
          }
        : {
            callId: params.toolCall.id,
            name: params.toolCall.name,
            params: params.toolCall.params,
            response: responseText
          }
    })
  }

  async getMessages(sessionId: string): Promise<ChatMessageRecord[]> {
    return this.messageStore.getMessages(sessionId)
  }

  async getMessageIds(sessionId: string): Promise<string[]> {
    return this.messageStore.getMessageIds(sessionId)
  }

  async getMessage(messageId: string): Promise<ChatMessageRecord | null> {
    return this.messageStore.getMessage(messageId)
  }

  async getSessionCompactionState(sessionId: string): Promise<SessionCompactionState> {
    const runtimeState = this.runtimeState.get(sessionId)
    const session = this.sessionStore.get(sessionId)
    if (!runtimeState && !session) {
      throw new Error(`Session ${sessionId} not found`)
    }

    const persistedState = this.summaryStateToCompactionState(
      this.sessionStore.getSummaryState(sessionId)
    )
    const currentCompactionState = this.sessionCompactionStates.get(sessionId)
    if (currentCompactionState?.status === 'compacting') {
      return { ...currentCompactionState }
    }

    if (
      currentCompactionState &&
      this.isSameCompactionState(currentCompactionState, persistedState)
    ) {
      return { ...currentCompactionState }
    }

    this.sessionCompactionStates.set(sessionId, persistedState)
    return { ...persistedState }
  }

  async clearMessages(sessionId: string): Promise<void> {
    const state = await this.getSessionState(sessionId)
    if (!state) {
      throw new Error(`Session ${sessionId} not found`)
    }

    await this.cancelGeneration(sessionId)
    this.pendingInputCoordinator.deleteBySession(sessionId)
    this.messageStore.deleteBySession(sessionId)
    this.resetSummaryState(sessionId)
    this.setSessionStatus(sessionId, 'idle')
  }

  async retryMessage(sessionId: string, messageId: string): Promise<void> {
    const state = await this.getSessionState(sessionId)
    if (!state) {
      throw new Error(`Session ${sessionId} not found`)
    }
    if (state.status === 'generating') {
      throw new Error('Cannot retry while session is generating.')
    }
    if (this.hasPendingInteractions(sessionId)) {
      throw new Error('Please resolve pending tool interactions before retrying.')
    }
    this.assertNoActivePendingInputs(sessionId)

    const target = await this.messageStore.getMessage(messageId)
    if (!target) {
      throw new Error(`Message ${messageId} not found`)
    }
    if (target.sessionId !== sessionId) {
      throw new Error(`Message ${messageId} does not belong to session ${sessionId}`)
    }

    const sourceUserMessage =
      target.role === 'user'
        ? target
        : this.messageStore.getLastUserMessageBeforeOrAt(sessionId, target.orderSeq)
    if (!sourceUserMessage) {
      throw new Error('No user message found for retry.')
    }

    const retryInput = this.extractUserMessageInput(sourceUserMessage.content)
    if (!retryInput.text.trim()) {
      throw new Error('Cannot retry an empty user message.')
    }

    this.invalidateSummaryIfNeeded(sessionId, sourceUserMessage.orderSeq)
    this.messageStore.deleteFromOrderSeq(sessionId, sourceUserMessage.orderSeq)
    await this.processMessage(sessionId, retryInput, {
      projectDir: this.resolveProjectDir(sessionId),
      emitRefreshBeforeStream: true
    })
  }

  async deleteMessage(sessionId: string, messageId: string): Promise<void> {
    this.assertNoActivePendingInputs(sessionId)
    const target = await this.messageStore.getMessage(messageId)
    if (!target) {
      throw new Error(`Message ${messageId} not found`)
    }
    if (target.sessionId !== sessionId) {
      throw new Error(`Message ${messageId} does not belong to session ${sessionId}`)
    }

    await this.cancelGeneration(sessionId)
    this.invalidateSummaryIfNeeded(sessionId, target.orderSeq)
    this.messageStore.deleteFromOrderSeq(sessionId, target.orderSeq)
    this.setSessionStatus(sessionId, 'idle')
  }

  async editUserMessage(
    sessionId: string,
    messageId: string,
    text: string
  ): Promise<ChatMessageRecord> {
    this.assertNoActivePendingInputs(sessionId)
    const target = await this.messageStore.getMessage(messageId)
    if (!target) {
      throw new Error(`Message ${messageId} not found`)
    }
    if (target.sessionId !== sessionId) {
      throw new Error(`Message ${messageId} does not belong to session ${sessionId}`)
    }
    if (target.role !== 'user') {
      throw new Error('Only user messages can be edited.')
    }

    const nextText = text.trim()
    if (!nextText) {
      throw new Error('Edited message cannot be empty.')
    }

    const nextContent = this.buildEditedUserContent(target.content, nextText)
    this.invalidateSummaryIfNeeded(sessionId, target.orderSeq)
    this.messageStore.updateMessageContent(messageId, nextContent)

    const updated = await this.messageStore.getMessage(messageId)
    if (!updated) {
      throw new Error(`Message ${messageId} not found after edit`)
    }
    return updated
  }

  async forkSessionFromMessage(
    sourceSessionId: string,
    targetSessionId: string,
    targetMessageId: string
  ): Promise<void> {
    const target = await this.messageStore.getMessage(targetMessageId)
    if (!target) {
      throw new Error(`Message ${targetMessageId} not found`)
    }
    if (target.sessionId !== sourceSessionId) {
      throw new Error(`Message ${targetMessageId} does not belong to session ${sourceSessionId}`)
    }

    this.messageStore.cloneSentMessagesToSession(sourceSessionId, targetSessionId, target.orderSeq)
    this.resetSummaryState(targetSessionId)
  }

  private async runStreamForMessage(args: {
    sessionId: string
    messageId: string
    messages: ChatMessage[]
    projectDir: string | null
    tools?: MCPToolDefinition[]
    initialBlocks?: AssistantMessageBlock[]
    promptPreview?: string
    interleavedReasoning?: InterleavedReasoningConfig
  }): Promise<{ runId: string; result: ProcessResult }> {
    const {
      sessionId,
      messageId,
      messages,
      projectDir,
      tools: providedTools,
      initialBlocks,
      promptPreview,
      interleavedReasoning: providedInterleavedReasoning
    } = args
    const state = this.runtimeState.get(sessionId)
    if (!state) {
      throw new Error(`Session ${sessionId} not found`)
    }

    const provider = (
      this.llmProviderPresenter as unknown as {
        getProviderInstance: (id: string) => {
          coreStream: (
            messages: ChatMessage[],
            modelId: string,
            modelConfig: ModelConfig,
            temperature: number,
            maxTokens: number,
            tools: import('@shared/types/core/mcp').MCPToolDefinition[]
          ) => AsyncGenerator<import('@shared/types/core/llm-events').LLMCoreStreamEvent>
        }
      }
    ).getProviderInstance(state.providerId)

    const generationSettings = await this.getEffectiveSessionGenerationSettings(sessionId)
    const interleavedReasoning =
      providedInterleavedReasoning ??
      this.resolveInterleavedReasoningConfig(state.providerId, state.modelId, generationSettings)
    const baseModelConfig = this.configPresenter.getModelConfig(state.modelId, state.providerId)
    const modelConfig: ModelConfig = {
      ...baseModelConfig,
      temperature: generationSettings.temperature,
      contextLength: generationSettings.contextLength,
      maxTokens: generationSettings.maxTokens,
      thinkingBudget: generationSettings.thinkingBudget,
      reasoningEffort: generationSettings.reasoningEffort,
      verbosity: generationSettings.verbosity
    }

    const traceEnabled = this.configPresenter.getSetting<boolean>('traceDebugEnabled') === true
    const llmProviderPresenter = this.llmProviderPresenter
    const pendingInputCoordinator = this.pendingInputCoordinator
    const injectSteerInputsIntoRequest = this.injectSteerInputsIntoRequest.bind(this)
    const persistMessageTrace = this.persistMessageTrace.bind(this)
    if (traceEnabled) {
      const traceAwareConfig = modelConfig as ModelConfig & {
        requestTraceContext?: {
          enabled: boolean
          persist: (payload: ProviderRequestTracePayload) => Promise<void>
        }
      }
      traceAwareConfig.requestTraceContext = {
        enabled: true,
        persist: async (payload: ProviderRequestTracePayload) => {
          persistMessageTrace({
            sessionId,
            messageId,
            providerId: state.providerId,
            modelId: state.modelId,
            payload
          })
        }
      }
    }

    const temperature = generationSettings.temperature
    const maxTokens = generationSettings.maxTokens

    const tools = providedTools ?? (await this.loadToolDefinitionsForSession(sessionId, projectDir))
    const supportsVision = this.supportsVision(state.providerId, state.modelId)

    const abortController = new AbortController()
    const activeGeneration = this.registerActiveGeneration(sessionId, messageId, abortController)
    const rateLimitMessageId = this.buildRateLimitStreamMessageId(activeGeneration.runId)
    const emitRateLimitWaitingMessage = this.emitRateLimitWaitingMessage.bind(this)
    const clearRateLimitWaitingMessage = this.clearRateLimitWaitingMessage.bind(this)

    try {
      this.dispatchHook('SessionStart', {
        sessionId,
        messageId,
        promptPreview,
        providerId: state.providerId,
        modelId: state.modelId,
        projectDir
      })

      const result = await processStream({
        messages,
        tools,
        toolPresenter: this.toolPresenter,
        coreStream: async function* (
          requestMessages,
          requestModelId,
          requestModelConfig,
          requestTemperature,
          requestMaxTokens,
          requestTools
        ) {
          const claimedSteerBatch = pendingInputCoordinator.claimSteerBatchForNextLoop(sessionId)
          const injectedMessages = injectSteerInputsIntoRequest(
            requestMessages,
            claimedSteerBatch,
            supportsVision,
            requestModelConfig.contextLength,
            requestMaxTokens
          )

          let didConsumeSteerBatch = false
          let queuedForRateLimit = false

          try {
            await llmProviderPresenter.executeWithRateLimit(state.providerId, {
              signal: abortController.signal,
              onQueued: (snapshot) => {
                queuedForRateLimit = true
                emitRateLimitWaitingMessage(sessionId, rateLimitMessageId, snapshot)
              }
            })
            if (queuedForRateLimit) {
              clearRateLimitWaitingMessage(sessionId, rateLimitMessageId)
              queuedForRateLimit = false
            }

            for await (const event of provider.coreStream(
              injectedMessages,
              requestModelId,
              requestModelConfig,
              requestTemperature,
              requestMaxTokens,
              requestTools
            )) {
              if (!didConsumeSteerBatch && claimedSteerBatch.length > 0) {
                pendingInputCoordinator.consumeClaimedSteerBatch(sessionId)
                didConsumeSteerBatch = true
              }
              yield event
            }

            if (!didConsumeSteerBatch && claimedSteerBatch.length > 0) {
              pendingInputCoordinator.consumeClaimedSteerBatch(sessionId)
            }
          } catch (error) {
            if (queuedForRateLimit) {
              clearRateLimitWaitingMessage(sessionId, rateLimitMessageId)
            }
            if (!didConsumeSteerBatch && claimedSteerBatch.length > 0) {
              pendingInputCoordinator.releaseClaimedInputs(sessionId)
            }
            throw error
          }
        },
        providerId: state.providerId,
        modelId: state.modelId,
        modelConfig,
        temperature,
        maxTokens,
        interleavedReasoning,
        permissionMode: state.permissionMode,
        toolOutputGuard: this.toolOutputGuard,
        initialBlocks,
        hooks: {
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
          onInterleavedReasoningGap: (gap) => {
            console.warn(
              `[DeepChatAgent] Interleaved reasoning gap detected for ${gap.providerId}/${gap.modelId}. Update provider DB metadata at ${gap.providerDbSourceUrl}.`
            )
            if (!traceEnabled) {
              return
            }
            persistMessageTrace({
              sessionId,
              messageId,
              providerId: state.providerId,
              modelId: state.modelId,
              payload: {
                endpoint: 'deepchat://interleaved-reasoning-gap',
                headers: {},
                body: gap
              }
            })
          },
          normalizeToolResult: async (tool) =>
            await this.normalizeToolResultContent({
              sessionId: tool.sessionId,
              toolCallId: tool.toolCallId,
              toolName: tool.toolName,
              toolArgs: tool.toolArgs,
              content: tool.content,
              isError: tool.isError,
              abortSignal: abortController.signal
            })
        },
        io: {
          sessionId,
          messageId,
          messageStore: this.messageStore,
          abortSignal: abortController.signal
        }
      })
      return {
        runId: activeGeneration.runId,
        result
      }
    } catch (error) {
      this.clearActiveGeneration(sessionId, activeGeneration.runId)
      throw error
    }
  }

  private injectSteerInputsIntoRequest(
    messages: ChatMessage[],
    steerInputs: PendingSessionInputRecord[],
    supportsVision: boolean,
    contextLength: number,
    reserveTokens: number
  ): ChatMessage[] {
    if (steerInputs.length === 0) {
      return messages
    }

    const steerMessages = steerInputs.map((input) =>
      createUserChatMessage(input.payload, supportsVision)
    )
    const clonedMessages = [...messages]
    const lastMessage = clonedMessages[clonedMessages.length - 1]
    const trailingUserCount = lastMessage?.role === 'user' ? 1 : 0
    const injectedMessages =
      trailingUserCount > 0
        ? [...clonedMessages.slice(0, -1), ...steerMessages, lastMessage]
        : [...clonedMessages, ...steerMessages]

    return fitMessagesToContextWindow(
      injectedMessages,
      contextLength,
      reserveTokens,
      steerMessages.length + trailingUserCount
    )
  }

  private async drainPendingQueueIfPossible(
    sessionId: string,
    reason: 'enqueue' | 'resume' | 'completed'
  ): Promise<boolean> {
    if (this.drainingPendingQueues.has(sessionId)) {
      return false
    }

    const state = await this.getSessionState(sessionId)
    if (!state || !this.canDrainPendingQueueFromStatus(state.status, reason)) {
      return false
    }
    if (this.isAwaitingToolQuestionFollowUp(sessionId)) {
      return false
    }
    if (this.hasPendingInteractions(sessionId)) {
      return false
    }

    const nextQueuedInput = this.pendingInputCoordinator.getNextQueuedInput(sessionId)
    if (!nextQueuedInput) {
      return false
    }

    this.drainingPendingQueues.add(sessionId)
    try {
      const claimedInput = this.pendingInputCoordinator.claimQueuedInput(
        sessionId,
        nextQueuedInput.id
      )
      await this.processMessage(sessionId, claimedInput.payload, {
        projectDir: this.resolveProjectDir(sessionId),
        pendingQueueItemId: claimedInput.id
      })
      return true
    } catch (error) {
      console.error('[DeepChatAgent] drainPendingQueueIfPossible error:', error)
      return false
    } finally {
      this.drainingPendingQueues.delete(sessionId)
      if (
        this.pendingInputCoordinator.getNextQueuedInput(sessionId) &&
        (await this.getSessionState(sessionId))?.status === 'idle' &&
        !this.hasPendingInteractions(sessionId)
      ) {
        void this.drainPendingQueueIfPossible(sessionId, 'completed')
      }
    }
  }

  private shouldStartQueuedInputImmediately(
    sessionId: string,
    status: DeepChatSessionState['status']
  ): boolean {
    if (!this.canDrainPendingQueueFromStatus(status, 'enqueue')) {
      return false
    }
    if (this.hasPendingInteractions(sessionId)) {
      return false
    }
    if (this.drainingPendingQueues.has(sessionId)) {
      return false
    }
    return this.pendingInputCoordinator.getNextQueuedInput(sessionId) === null
  }

  private canDrainPendingQueueFromStatus(
    status: DeepChatSessionState['status'],
    reason: 'enqueue' | 'resume' | 'completed'
  ): boolean {
    if (status === 'idle') {
      return true
    }

    return (reason === 'enqueue' || reason === 'resume') && status === 'error'
  }

  private registerActiveGeneration(
    sessionId: string,
    messageId: string,
    abortController: AbortController
  ): ActiveGeneration {
    const generation: ActiveGeneration = {
      runId: `${sessionId}:${++this.nextRunSequence}`,
      messageId,
      abortController
    }
    this.activeGenerations.set(sessionId, generation)
    this.abortControllers.set(sessionId, abortController)
    return generation
  }

  private clearActiveGeneration(sessionId: string, runId: string): void {
    const activeGeneration = this.activeGenerations.get(sessionId)
    if (!activeGeneration || activeGeneration.runId !== runId) {
      return
    }
    this.activeGenerations.delete(sessionId)
    if (this.abortControllers.get(sessionId) === activeGeneration.abortController) {
      this.abortControllers.delete(sessionId)
    }
  }

  private isActiveRun(sessionId: string, runId: string): boolean {
    return this.activeGenerations.get(sessionId)?.runId === runId
  }

  private buildRateLimitStreamMessageId(runId: string): string {
    return `${RATE_LIMIT_STREAM_MESSAGE_PREFIX}${runId}`
  }

  private emitRateLimitWaitingMessage(
    sessionId: string,
    messageId: string,
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

    eventBus.sendToRenderer(STREAM_EVENTS.RESPONSE, SendTarget.ALL_WINDOWS, {
      conversationId: sessionId,
      eventId: messageId,
      messageId,
      blocks: [block]
    })
  }

  private clearRateLimitWaitingMessage(sessionId: string, messageId: string): void {
    eventBus.sendToRenderer(STREAM_EVENTS.RESPONSE, SendTarget.ALL_WINDOWS, {
      conversationId: sessionId,
      eventId: messageId,
      messageId,
      blocks: []
    })
  }

  private applyProcessResultStatus(
    sessionId: string,
    result: ProcessResult | null | undefined,
    runId?: string
  ): void {
    if (runId && !this.isActiveRun(sessionId, runId)) {
      return
    }
    const state = this.runtimeState.get(sessionId)
    if (!result || !result.status) {
      this.setSessionStatus(sessionId, 'idle')
      return
    }
    if (result.status === 'completed') {
      this.dispatchTerminalHooks(sessionId, state, result)
      this.setSessionStatus(sessionId, 'idle')
      return
    }
    if (result.status === 'paused') {
      this.setSessionStatus(sessionId, 'generating')
      return
    }
    if (result.status === 'aborted') {
      this.dispatchTerminalHooks(sessionId, state, result)
      this.setSessionStatus(sessionId, 'idle')
      return
    }
    this.dispatchTerminalHooks(sessionId, state, result)
    this.setSessionStatus(sessionId, 'error')
  }

  private async resumeAssistantMessage(
    sessionId: string,
    messageId: string,
    initialBlocks: AssistantMessageBlock[],
    budgetToolCall?: ResumeBudgetToolCall | null
  ): Promise<boolean> {
    if (this.resumingMessages.has(messageId)) {
      return false
    }
    this.resumingMessages.add(messageId)

    try {
      const state = this.runtimeState.get(sessionId)
      if (!state) {
        throw new Error(`Session ${sessionId} not found`)
      }

      this.setSessionStatus(sessionId, 'generating')
      const generationSettings = await this.getEffectiveSessionGenerationSettings(sessionId)
      const interleavedReasoning = this.resolveInterleavedReasoningConfig(
        state.providerId,
        state.modelId,
        generationSettings
      )
      const maxTokens = generationSettings.maxTokens
      const projectDir = this.resolveProjectDir(sessionId)
      const tools = await this.loadToolDefinitionsForSession(sessionId, projectDir)
      const baseSystemPrompt = await this.buildSystemPromptWithSkills(
        sessionId,
        generationSettings.systemPrompt,
        tools
      )
      const summaryState = await this.resolveCompactionStateForResumeTurn({
        sessionId,
        messageId,
        providerId: state.providerId,
        modelId: state.modelId,
        systemPrompt: baseSystemPrompt,
        contextLength: generationSettings.contextLength,
        reserveTokens: maxTokens,
        supportsVision: this.supportsVision(state.providerId, state.modelId),
        preserveInterleavedReasoning: interleavedReasoning.preserveReasoningContent
      })
      const systemPrompt = appendSummarySection(baseSystemPrompt, summaryState.summaryText)
      let resumeContext = buildResumeContext(
        sessionId,
        messageId,
        systemPrompt,
        generationSettings.contextLength,
        maxTokens,
        this.messageStore,
        this.supportsVision(state.providerId, state.modelId),
        {
          summaryCursorOrderSeq: summaryState.summaryCursorOrderSeq,
          fallbackProtectedTurnCount: 1,
          preserveInterleavedReasoning: interleavedReasoning.preserveReasoningContent
        }
      )
      if (budgetToolCall?.id && budgetToolCall.name) {
        const resumeBudget = this.fitResumeBudgetForToolCall({
          resumeContext,
          toolDefinitions: tools,
          contextLength: generationSettings.contextLength,
          maxTokens,
          toolCallId: budgetToolCall.id,
          toolName: budgetToolCall.name
        })

        if (resumeBudget?.kind === 'tool_error') {
          await this.toolOutputGuard.cleanupOffloadedOutput(budgetToolCall.offloadPath)
          this.updateToolCallResponse(initialBlocks, budgetToolCall.id, resumeBudget.message, true)
          this.messageStore.updateAssistantContent(messageId, initialBlocks)
          this.emitMessageRefresh(sessionId, messageId)
          resumeContext = this.toolOutputGuard.replaceToolMessageContent(
            resumeContext,
            budgetToolCall.id,
            resumeBudget.message
          )
        } else if (resumeBudget?.kind === 'terminal_error') {
          await this.toolOutputGuard.cleanupOffloadedOutput(budgetToolCall.offloadPath)
          this.updateToolCallResponse(initialBlocks, budgetToolCall.id, resumeBudget.message, true)
          this.messageStore.setMessageError(messageId, initialBlocks)
          this.emitMessageRefresh(sessionId, messageId)
          eventBus.sendToRenderer(STREAM_EVENTS.ERROR, SendTarget.ALL_WINDOWS, {
            conversationId: sessionId,
            eventId: messageId,
            messageId,
            error: resumeBudget.message
          })
          this.setSessionStatus(sessionId, 'error')
          return false
        }
      }

      const { runId, result } = await this.runStreamForMessage({
        sessionId,
        messageId,
        messages: resumeContext,
        projectDir,
        tools,
        initialBlocks,
        interleavedReasoning
      })
      try {
        this.applyProcessResultStatus(sessionId, result, runId)
      } finally {
        this.clearActiveGeneration(sessionId, runId)
      }
      if (result?.status === 'completed') {
        void this.drainPendingQueueIfPossible(sessionId, 'completed')
      }
      return true
    } catch (error) {
      console.error('[DeepChatAgent] resumeAssistantMessage error:', error)
      const errorMessage = error instanceof Error ? error.message : String(error)
      const blocks = buildTerminalErrorBlocks(initialBlocks, errorMessage)
      this.messageStore.setMessageError(messageId, blocks)
      this.emitMessageRefresh(sessionId, messageId)
      this.setSessionStatus(sessionId, 'error')
      throw error
    } finally {
      this.resumingMessages.delete(messageId)
    }
  }

  private async buildSystemPromptWithSkills(
    sessionId: string,
    basePrompt: string,
    toolDefinitions: MCPToolDefinition[]
  ): Promise<string> {
    const normalizedBase = basePrompt?.trim() ?? ''
    const state = this.runtimeState.get(sessionId)
    const providerId = state?.providerId?.trim() || 'unknown-provider'
    const modelId = state?.modelId?.trim() || 'unknown-model'
    const workdir = this.resolveProjectDir(sessionId)
    const now = new Date()
    const dayKey = this.buildLocalDayKey(now)

    const skillsEnabled = this.configPresenter.getSkillsEnabled()
    const skillPresenter = presenter?.skillPresenter
    const availableSkillNames: string[] = []
    const activeSkillNames: string[] = []

    if (skillsEnabled && skillPresenter) {
      if (skillPresenter.getMetadataList) {
        try {
          const metadataList = await skillPresenter.getMetadataList()
          for (const metadata of metadataList) {
            const skillName = metadata?.name?.trim()
            if (skillName) {
              availableSkillNames.push(skillName)
            }
          }
        } catch (error) {
          console.warn(
            `[DeepChatAgent] Failed to load skills metadata for session ${sessionId}:`,
            error
          )
        }
      }

      if (skillPresenter.getActiveSkills) {
        try {
          const activeSkills = await skillPresenter.getActiveSkills(sessionId)
          for (const skillName of activeSkills) {
            const normalizedName = skillName?.trim()
            if (normalizedName) {
              activeSkillNames.push(normalizedName)
            }
          }
        } catch (error) {
          console.warn(
            `[DeepChatAgent] Failed to load active skills for session ${sessionId}:`,
            error
          )
        }
      }
    }

    const normalizedAvailableSkills = this.normalizeSkillNames(availableSkillNames)
    const normalizedActiveSkills = this.normalizeSkillNames(activeSkillNames)
    const agentToolNames = this.getAgentToolNames(toolDefinitions)
    const fingerprint = this.buildSystemPromptFingerprint({
      providerId,
      modelId,
      workdir,
      basePrompt: normalizedBase,
      skillsEnabled,
      availableSkillNames: normalizedAvailableSkills,
      activeSkillNames: normalizedActiveSkills,
      toolSignature: this.buildToolSignature(toolDefinitions)
    })

    const cachedPrompt = this.systemPromptCache.get(sessionId)
    if (
      cachedPrompt &&
      cachedPrompt.dayKey === dayKey &&
      cachedPrompt.fingerprint === fingerprint
    ) {
      return cachedPrompt.prompt
    }

    const runtimePrompt = buildRuntimeCapabilitiesPrompt({
      hasYoBrowser: toolDefinitions.some(
        (tool) => tool.source === 'agent' && tool.server.name === 'yobrowser'
      ),
      hasExec: agentToolNames.has('exec'),
      hasProcess: agentToolNames.has('process')
    })
    const skillsMetadataPrompt = skillsEnabled
      ? this.buildSkillsMetadataPrompt(normalizedAvailableSkills, {
          canListSkills: agentToolNames.has('skill_list'),
          canControlSkills: agentToolNames.has('skill_control'),
          canRunSkillScripts: agentToolNames.has('skill_run')
        })
      : ''

    let skillsPrompt = ''
    if (skillsEnabled && skillPresenter?.loadSkillContent && normalizedActiveSkills.length > 0) {
      const skillSections: string[] = []
      for (const skillName of normalizedActiveSkills) {
        try {
          const skill = await skillPresenter.loadSkillContent(skillName)
          const content = skill?.content?.trim()
          if (content) {
            skillSections.push(`### ${skillName}\n${content}`)
          }
        } catch (error) {
          console.warn(
            `[DeepChatAgent] Failed to load skill content for "${skillName}" in session ${sessionId}:`,
            error
          )
        }
      }
      skillsPrompt = this.buildActiveSkillsPrompt(skillSections)
    }

    let envPrompt = ''
    try {
      envPrompt = await buildSystemEnvPrompt({
        providerId,
        modelId,
        workdir,
        now
      })
    } catch (error) {
      console.warn(`[DeepChatAgent] Failed to build env prompt for session ${sessionId}:`, error)
    }

    let toolingPrompt = ''
    if (this.toolPresenter) {
      try {
        toolingPrompt = this.toolPresenter.buildToolSystemPrompt({
          conversationId: sessionId,
          toolDefinitions
        })
      } catch (error) {
        console.warn(
          `[DeepChatAgent] Failed to build tooling prompt for session ${sessionId}:`,
          error
        )
      }
    }

    const composedPrompt = this.composePromptSections([
      runtimePrompt,
      skillsMetadataPrompt,
      skillsPrompt,
      envPrompt,
      toolingPrompt,
      normalizedBase
    ])

    this.systemPromptCache.set(sessionId, {
      prompt: composedPrompt,
      dayKey,
      fingerprint
    })

    return composedPrompt
  }

  private composePromptSections(sections: string[]): string {
    return sections
      .map((section) => section.trim())
      .filter((section) => section.length > 0)
      .join('\n\n')
  }

  private buildSkillsMetadataPrompt(
    availableSkillNames: string[],
    capabilities: {
      canListSkills: boolean
      canControlSkills: boolean
      canRunSkillScripts: boolean
    }
  ): string {
    if (
      !capabilities.canListSkills &&
      !capabilities.canControlSkills &&
      !capabilities.canRunSkillScripts
    ) {
      return ''
    }

    const lines = ['## Skills']
    let hasContent = false

    if (capabilities.canListSkills) {
      lines.push(
        'If you may need specialized guidance, call `skill_list` to inspect available skills and activation status.'
      )
      hasContent = true
    }
    if (capabilities.canControlSkills) {
      lines.push(
        'After identifying a matching skill, call `skill_control` to activate or deactivate it before proceeding.'
      )
      hasContent = true
    }
    if (capabilities.canRunSkillScripts) {
      lines.push(
        'Use `skill_run` to execute bundled helper scripts from active skills when a skill provides them.'
      )
      hasContent = true
    }

    if (availableSkillNames.length > 0) {
      lines.push('Installed skill names:')
      lines.push(...availableSkillNames.map((name) => `- ${name}`))
      hasContent = true
    } else if (hasContent) {
      lines.push('Installed skill names: (none)')
    }

    return hasContent ? lines.join('\n') : ''
  }

  private buildActiveSkillsPrompt(skillSections: string[]): string {
    if (skillSections.length === 0) {
      return ''
    }
    return [
      '## Activated Skills',
      'Follow these active skill instructions during this conversation.',
      '',
      skillSections.join('\n\n')
    ].join('\n')
  }

  private normalizeSkillNames(skillNames: string[]): string[] {
    return Array.from(
      new Set(skillNames.map((name) => name.trim()).filter((name) => name.length > 0))
    ).sort((a, b) => a.localeCompare(b))
  }

  private buildSystemPromptFingerprint(params: {
    providerId: string
    modelId: string
    workdir: string | null
    basePrompt: string
    skillsEnabled: boolean
    availableSkillNames: string[]
    activeSkillNames: string[]
    toolSignature: string[]
  }): string {
    return JSON.stringify({
      providerId: params.providerId,
      modelId: params.modelId,
      workdir: params.workdir ?? '',
      basePrompt: params.basePrompt,
      skillsEnabled: params.skillsEnabled,
      availableSkillNames: params.availableSkillNames,
      activeSkillNames: params.activeSkillNames,
      toolSignature: params.toolSignature
    })
  }

  private getAgentToolNames(toolDefinitions: MCPToolDefinition[]): Set<string> {
    return new Set(
      toolDefinitions.filter((tool) => tool.source === 'agent').map((tool) => tool.function.name)
    )
  }

  private buildToolSignature(toolDefinitions: MCPToolDefinition[]): string[] {
    return toolDefinitions
      .filter((tool) => tool.source === 'agent')
      .map((tool) => `${tool.server.name}:${tool.function.name}`)
      .sort((left, right) => left.localeCompare(right))
  }

  private buildLocalDayKey(now: Date): string {
    const year = now.getFullYear()
    const month = String(now.getMonth() + 1).padStart(2, '0')
    const day = String(now.getDate()).padStart(2, '0')
    return `${year}-${month}-${day}`
  }

  public invalidateSessionSystemPromptCache(sessionId: string): void {
    this.invalidateSystemPromptCache(sessionId)
  }

  private invalidateSystemPromptCache(sessionId: string): void {
    this.systemPromptCache.delete(sessionId)
  }

  private async getEffectiveSessionGenerationSettings(
    sessionId: string
  ): Promise<SessionGenerationSettings> {
    const cached = this.sessionGenerationSettings.get(sessionId)
    if (cached) {
      return { ...cached }
    }

    const state = this.runtimeState.get(sessionId)
    const dbSession = this.sessionStore.get(sessionId) as PersistedSessionGenerationRow | undefined
    const providerId = state?.providerId ?? dbSession?.provider_id
    const modelId = state?.modelId ?? dbSession?.model_id

    if (!providerId || !modelId) {
      throw new Error(`Session ${sessionId} not found`)
    }

    const persistedPatch = dbSession ? this.mapPersistedGenerationPatch(dbSession) : {}
    const sanitized = await this.sanitizeGenerationSettings(providerId, modelId, persistedPatch)
    this.sessionGenerationSettings.set(sessionId, sanitized)
    return { ...sanitized }
  }

  private persistMessageTrace(args: {
    sessionId: string
    messageId: string
    providerId: string
    modelId: string
    payload: ProviderRequestTracePayload
  }): void {
    const { sessionId, messageId, providerId, modelId, payload } = args
    const persistable = buildPersistableMessageTracePayload(payload)

    this.messageStore.insertMessageTrace({
      id: nanoid(),
      sessionId,
      messageId,
      providerId,
      modelId,
      endpoint: persistable.endpoint,
      headersJson: persistable.headersJson,
      bodyJson: persistable.bodyJson,
      truncated: persistable.truncated
    })
  }

  private mapPersistedGenerationPatch(
    sessionRow: PersistedSessionGenerationRow
  ): Partial<SessionGenerationSettings> {
    const patch: Partial<SessionGenerationSettings> = {}

    if (sessionRow.system_prompt !== null) {
      patch.systemPrompt = sessionRow.system_prompt
    }
    if (sessionRow.temperature !== null) {
      patch.temperature = sessionRow.temperature
    }
    if (sessionRow.context_length !== null) {
      patch.contextLength = sessionRow.context_length
    }
    if (sessionRow.max_tokens !== null) {
      patch.maxTokens = sessionRow.max_tokens
    }
    if (sessionRow.thinking_budget !== null) {
      patch.thinkingBudget = normalizeLegacyThinkingBudgetValue(sessionRow.thinking_budget)
    }
    if (sessionRow.reasoning_effort !== null) {
      patch.reasoningEffort = sessionRow.reasoning_effort
    }
    if (sessionRow.verbosity !== null) {
      patch.verbosity = sessionRow.verbosity
    }
    if (typeof sessionRow.force_interleaved_thinking_compat === 'number') {
      patch.forceInterleavedThinkingCompat = sessionRow.force_interleaved_thinking_compat === 1
    }

    return patch
  }

  private buildPersistedGenerationSettingsPatch(
    requestedPatch: Partial<SessionGenerationSettings>,
    sanitized: SessionGenerationSettings
  ): Partial<SessionGenerationSettings> {
    const patch: Partial<SessionGenerationSettings> = {}

    if (Object.prototype.hasOwnProperty.call(requestedPatch, 'systemPrompt')) {
      patch.systemPrompt = sanitized.systemPrompt
    }
    if (Object.prototype.hasOwnProperty.call(requestedPatch, 'temperature')) {
      patch.temperature = sanitized.temperature
    }
    if (Object.prototype.hasOwnProperty.call(requestedPatch, 'contextLength')) {
      patch.contextLength = sanitized.contextLength
    }
    if (Object.prototype.hasOwnProperty.call(requestedPatch, 'maxTokens')) {
      patch.maxTokens = sanitized.maxTokens
    }
    if (Object.prototype.hasOwnProperty.call(requestedPatch, 'thinkingBudget')) {
      patch.thinkingBudget = sanitized.thinkingBudget
    }
    if (Object.prototype.hasOwnProperty.call(requestedPatch, 'reasoningEffort')) {
      patch.reasoningEffort = sanitized.reasoningEffort
    }
    if (Object.prototype.hasOwnProperty.call(requestedPatch, 'verbosity')) {
      patch.verbosity = sanitized.verbosity
    }
    if (Object.prototype.hasOwnProperty.call(requestedPatch, 'forceInterleavedThinkingCompat')) {
      patch.forceInterleavedThinkingCompat = sanitized.forceInterleavedThinkingCompat
    }

    return patch
  }

  private buildPersistedGenerationSettingsReplacement(
    settings: SessionGenerationSettings
  ): Partial<SessionGenerationSettings> {
    return {
      systemPrompt: settings.systemPrompt,
      temperature: settings.temperature,
      contextLength: settings.contextLength,
      maxTokens: settings.maxTokens,
      thinkingBudget: settings.thinkingBudget,
      reasoningEffort: settings.reasoningEffort,
      verbosity: settings.verbosity,
      forceInterleavedThinkingCompat: settings.forceInterleavedThinkingCompat
    }
  }

  private async buildDefaultGenerationSettings(
    providerId: string,
    modelId: string
  ): Promise<SessionGenerationSettings> {
    const modelConfig = this.configPresenter.getModelConfig(modelId, providerId)
    const portrait = this.getReasoningPortrait(providerId, modelId)
    const defaultSystemPrompt = await this.configPresenter.getDefaultSystemPrompt()
    const contextLengthDefault = toValidNonNegativeInteger(modelConfig.contextLength) ?? 32000
    const maxTokensDefault =
      toValidNonNegativeInteger(modelConfig.maxTokens) ?? Math.min(4096, contextLengthDefault)

    const defaults: SessionGenerationSettings = {
      systemPrompt: defaultSystemPrompt ?? '',
      temperature: parseFiniteNumericValue(modelConfig.temperature) ?? 0.7,
      contextLength: contextLengthDefault,
      maxTokens:
        maxTokensDefault <= contextLengthDefault
          ? maxTokensDefault
          : Math.min(4096, contextLengthDefault)
    }

    const interleavedThinkingDefault =
      typeof modelConfig.forceInterleavedThinkingCompat === 'boolean'
        ? modelConfig.forceInterleavedThinkingCompat
        : portrait?.interleaved === true
          ? true
          : undefined
    if (typeof interleavedThinkingDefault === 'boolean') {
      defaults.forceInterleavedThinkingCompat = interleavedThinkingDefault
    }

    const supportsReasoning =
      this.configPresenter.supportsReasoningCapability?.(providerId, modelId) === true
    if (supportsReasoning) {
      const defaultBudget = normalizeLegacyThinkingBudgetValue(
        modelConfig.thinkingBudget ??
          this.configPresenter.getThinkingBudgetRange?.(providerId, modelId)?.default
      )
      if (defaultBudget !== undefined) {
        defaults.thinkingBudget = defaultBudget
      }
    }

    const supportsEffort =
      this.configPresenter.supportsReasoningEffortCapability?.(providerId, modelId) === true
    if (supportsEffort) {
      const rawEffort =
        modelConfig.reasoningEffort ??
        this.configPresenter.getReasoningEffortDefault?.(providerId, modelId)
      const normalizedEffort = this.normalizeReasoningEffort(providerId, modelId, rawEffort)
      if (normalizedEffort) {
        defaults.reasoningEffort = normalizedEffort
      }
    }

    const supportsVerbosity =
      this.configPresenter.supportsVerbosityCapability?.(providerId, modelId) === true
    if (supportsVerbosity) {
      const rawVerbosity =
        modelConfig.verbosity ?? this.configPresenter.getVerbosityDefault?.(providerId, modelId)
      const normalizedVerbosity = this.normalizeVerbosity(providerId, modelId, rawVerbosity)
      if (normalizedVerbosity) {
        defaults.verbosity = normalizedVerbosity
      }
    }

    return defaults
  }

  private async sanitizeGenerationSettings(
    providerId: string,
    modelId: string,
    patch: Partial<SessionGenerationSettings>,
    baseSettings?: SessionGenerationSettings
  ): Promise<SessionGenerationSettings> {
    const base = baseSettings
      ? { ...baseSettings }
      : await this.buildDefaultGenerationSettings(providerId, modelId)
    const next: SessionGenerationSettings = { ...base }

    if (Object.prototype.hasOwnProperty.call(patch, 'systemPrompt')) {
      next.systemPrompt =
        typeof patch.systemPrompt === 'string' ? patch.systemPrompt : base.systemPrompt
    }

    if (Object.prototype.hasOwnProperty.call(patch, 'temperature')) {
      const numeric = parseFiniteNumericValue(patch.temperature)
      if (numeric !== undefined) {
        next.temperature = numeric
      }
    }

    const parsedContextLength = parseFiniteNumericValue(patch.contextLength)
    const parsedMaxTokens = parseFiniteNumericValue(patch.maxTokens)
    const nextContextReference =
      Object.prototype.hasOwnProperty.call(patch, 'contextLength') &&
      toValidNonNegativeInteger(parsedContextLength) !== undefined
        ? toValidNonNegativeInteger(parsedContextLength)
        : next.contextLength
    const nextMaxTokensReference =
      Object.prototype.hasOwnProperty.call(patch, 'maxTokens') &&
      toValidNonNegativeInteger(parsedMaxTokens) !== undefined
        ? toValidNonNegativeInteger(parsedMaxTokens)
        : next.maxTokens

    if (Object.prototype.hasOwnProperty.call(patch, 'contextLength')) {
      const error = validateGenerationNumericField('contextLength', patch.contextLength, {
        maxTokens: nextMaxTokensReference
      })
      const numeric = toValidNonNegativeInteger(parsedContextLength)
      if (!error && numeric !== undefined) {
        next.contextLength = numeric
      }
    }

    if (Object.prototype.hasOwnProperty.call(patch, 'maxTokens')) {
      const error = validateGenerationNumericField('maxTokens', patch.maxTokens, {
        contextLength: nextContextReference
      })
      const numeric = toValidNonNegativeInteger(parsedMaxTokens)
      if (!error && numeric !== undefined) {
        next.maxTokens = numeric
      }
    }

    const supportsReasoning =
      this.configPresenter.supportsReasoningCapability?.(providerId, modelId) === true
    if (supportsReasoning) {
      if (Object.prototype.hasOwnProperty.call(patch, 'thinkingBudget')) {
        const raw = patch.thinkingBudget
        if (raw === undefined) {
          delete next.thinkingBudget
        } else if (!validateGenerationNumericField('thinkingBudget', raw)) {
          const numeric = toValidNonNegativeInteger(raw)
          if (numeric !== undefined) {
            next.thinkingBudget = numeric
          }
        }
      }
    } else {
      delete next.thinkingBudget
    }

    const supportsEffort =
      this.configPresenter.supportsReasoningEffortCapability?.(providerId, modelId) === true
    if (supportsEffort) {
      const fromPatch = Object.prototype.hasOwnProperty.call(patch, 'reasoningEffort')
        ? patch.reasoningEffort
        : next.reasoningEffort
      const defaultEffort = this.configPresenter.getReasoningEffortDefault?.(providerId, modelId)
      const normalizedEffort =
        this.normalizeReasoningEffort(providerId, modelId, fromPatch) ??
        this.normalizeReasoningEffort(providerId, modelId, defaultEffort)
      if (normalizedEffort) {
        next.reasoningEffort = normalizedEffort
      } else {
        delete next.reasoningEffort
      }
    } else {
      delete next.reasoningEffort
    }

    const supportsVerbosity =
      this.configPresenter.supportsVerbosityCapability?.(providerId, modelId) === true
    if (supportsVerbosity) {
      const fromPatch = Object.prototype.hasOwnProperty.call(patch, 'verbosity')
        ? patch.verbosity
        : next.verbosity
      const defaultVerbosity = this.configPresenter.getVerbosityDefault?.(providerId, modelId)
      const normalizedVerbosity =
        this.normalizeVerbosity(providerId, modelId, fromPatch) ??
        this.normalizeVerbosity(providerId, modelId, defaultVerbosity)
      if (normalizedVerbosity) {
        next.verbosity = normalizedVerbosity
      } else {
        delete next.verbosity
      }
    } else {
      delete next.verbosity
    }

    if (Object.prototype.hasOwnProperty.call(patch, 'forceInterleavedThinkingCompat')) {
      if (typeof patch.forceInterleavedThinkingCompat === 'boolean') {
        next.forceInterleavedThinkingCompat = patch.forceInterleavedThinkingCompat
      } else {
        delete next.forceInterleavedThinkingCompat
      }
    } else if (typeof base.forceInterleavedThinkingCompat !== 'boolean') {
      delete next.forceInterleavedThinkingCompat
    }

    return next
  }

  private resolveInterleavedReasoningConfig(
    providerId: string,
    modelId: string,
    generationSettings: SessionGenerationSettings
  ): InterleavedReasoningConfig {
    const portrait = this.getReasoningPortrait(providerId, modelId)
    const explicitSessionSetting =
      typeof generationSettings.forceInterleavedThinkingCompat === 'boolean'
        ? generationSettings.forceInterleavedThinkingCompat
        : undefined
    const forcedBySessionSetting = explicitSessionSetting === true
    const portraitInterleaved = portrait?.interleaved === true
    const reasoningSupported =
      this.configPresenter.supportsReasoningCapability?.(providerId, modelId) === true

    return {
      preserveReasoningContent:
        explicitSessionSetting !== undefined ? explicitSessionSetting : portraitInterleaved,
      forcedBySessionSetting,
      portraitInterleaved,
      reasoningSupported,
      providerDbSourceUrl: providerDbLoader.getSourceUrl()
    }
  }

  private normalizeReasoningEffort(
    providerId: string,
    modelId: string | undefined,
    value: unknown
  ): SessionGenerationSettings['reasoningEffort'] | undefined {
    if (!isReasoningEffort(value)) {
      return undefined
    }
    const normalizedValue = value

    if (!modelId) {
      return normalizedValue
    }

    const portrait = this.getReasoningPortrait(providerId, modelId)
    const options = portrait?.effortOptions?.filter(isReasoningEffort)
    if (!options || options.length === 0) {
      return normalizedValue
    }

    if (options.includes(normalizedValue)) {
      return normalizedValue
    }

    const defaultEffort = portrait?.effort
    if (defaultEffort && isReasoningEffort(defaultEffort) && options.includes(defaultEffort)) {
      return defaultEffort
    }

    return undefined
  }

  private normalizeVerbosity(
    providerId: string,
    modelId: string,
    value: unknown
  ): SessionGenerationSettings['verbosity'] | undefined {
    if (!isVerbosity(value)) {
      return undefined
    }
    const normalizedValue = value

    const portrait = this.getReasoningPortrait(providerId, modelId)
    const options = portrait?.verbosityOptions?.filter(isVerbosity)
    if (!options || options.length === 0) {
      return normalizedValue
    }

    if (options.includes(normalizedValue)) {
      return normalizedValue
    }

    const defaultVerbosity = portrait?.verbosity
    if (defaultVerbosity && isVerbosity(defaultVerbosity) && options.includes(defaultVerbosity)) {
      return defaultVerbosity
    }

    return undefined
  }

  private getReasoningPortrait(providerId: string, modelId: string): ReasoningPortrait | null {
    return this.configPresenter.getReasoningPortrait?.(providerId, modelId) ?? null
  }

  private async ensureSessionReadyForPendingInputMutation(sessionId: string): Promise<void> {
    const state = await this.getSessionState(sessionId)
    if (!state) {
      throw new Error(`Session ${sessionId} not found`)
    }
  }

  private assertNoActivePendingInputs(sessionId: string): void {
    if (!this.pendingInputCoordinator.hasActiveInputs(sessionId)) {
      return
    }
    throw new Error('Please clear the waiting lane before mutating chat history.')
  }

  private parseAssistantBlocks(rawContent: string): AssistantMessageBlock[] {
    try {
      const parsed = JSON.parse(rawContent) as AssistantMessageBlock[]
      return Array.isArray(parsed) ? parsed : []
    } catch {
      return []
    }
  }

  private extractUserMessageInput(content: string): SendMessageInput {
    const fallback: SendMessageInput = { text: '', files: [] }

    try {
      const parsed = JSON.parse(content) as UserMessageContent | SendMessageInput | string
      if (typeof parsed === 'string') {
        return { text: parsed, files: [] }
      }
      if (!parsed || typeof parsed !== 'object') {
        return fallback
      }

      const text = typeof parsed.text === 'string' ? parsed.text : ''
      const files = Array.isArray((parsed as { files?: unknown }).files)
        ? ((parsed as { files?: unknown }).files as MessageFile[]).filter((file) => Boolean(file))
        : []
      return { text, files }
    } catch {
      return { text: content, files: [] }
    }
  }

  private normalizeUserMessageInput(input: string | SendMessageInput): SendMessageInput {
    if (typeof input === 'string') {
      return { text: input, files: [] }
    }
    if (!input || typeof input !== 'object') {
      return { text: '', files: [] }
    }
    const text = typeof input.text === 'string' ? input.text : ''
    const files = Array.isArray(input.files)
      ? input.files.filter((file): file is MessageFile => Boolean(file))
      : []
    return { text, files }
  }

  private supportsVision(providerId: string, modelId: string): boolean {
    return Boolean(this.configPresenter.getModelConfig(modelId, providerId)?.vision)
  }

  private buildEditedUserContent(rawContent: string, text: string): string {
    const fallback: UserMessageContent = {
      text,
      files: [],
      links: [],
      search: false,
      think: false
    }

    try {
      const parsed = JSON.parse(rawContent) as Record<string, unknown> | string
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
        return JSON.stringify(fallback)
      }

      const next = { ...parsed, text } as Record<string, unknown>

      if (!Array.isArray(next.files)) {
        next.files = []
      }
      if (!Array.isArray(next.links)) {
        next.links = []
      }
      if (typeof next.search !== 'boolean') {
        next.search = false
      }
      if (typeof next.think !== 'boolean') {
        next.think = false
      }

      if (Array.isArray(next.content)) {
        let replaced = false
        const mapped = next.content.map((item) => {
          if (
            !replaced &&
            item &&
            typeof item === 'object' &&
            !Array.isArray(item) &&
            (item as { type?: unknown }).type === 'text'
          ) {
            replaced = true
            return { ...(item as Record<string, unknown>), content: text }
          }
          return item
        })

        if (!replaced) {
          mapped.unshift({ type: 'text', content: text })
        }
        next.content = mapped
      }

      return JSON.stringify(next)
    } catch {
      return JSON.stringify(fallback)
    }
  }

  private collectPendingInteractionEntries(
    messageId: string,
    blocks: AssistantMessageBlock[]
  ): PendingInteractionEntry[] {
    const entries: PendingInteractionEntry[] = []

    for (let index = 0; index < blocks.length; index += 1) {
      const block = blocks[index]
      if (
        block.type !== 'action' ||
        (block.action_type !== 'tool_call_permission' &&
          block.action_type !== 'question_request') ||
        block.status !== 'pending' ||
        block.extra?.needsUserAction === false
      ) {
        continue
      }

      const toolCallId = block.tool_call?.id
      if (!toolCallId) {
        continue
      }

      const toolName = block.tool_call?.name || ''
      const toolArgs = block.tool_call?.params || ''

      if (block.action_type === 'question_request') {
        entries.push({
          blockIndex: index,
          interaction: {
            type: 'question',
            messageId,
            toolCallId,
            toolName,
            toolArgs,
            serverName: block.tool_call?.server_name,
            serverIcons: block.tool_call?.server_icons,
            serverDescription: block.tool_call?.server_description,
            question: {
              header:
                typeof block.extra?.questionHeader === 'string' ? block.extra.questionHeader : '',
              question:
                typeof block.extra?.questionText === 'string' ? block.extra.questionText : '',
              options: this.parseQuestionOptions(block.extra?.questionOptions),
              custom: block.extra?.questionCustom !== false,
              multiple: Boolean(block.extra?.questionMultiple)
            }
          }
        })
        continue
      }

      entries.push({
        blockIndex: index,
        interaction: {
          type: 'permission',
          messageId,
          toolCallId,
          toolName,
          toolArgs,
          serverName: block.tool_call?.server_name,
          serverIcons: block.tool_call?.server_icons,
          serverDescription: block.tool_call?.server_description,
          permission: this.parsePermissionPayload(block)
        }
      })
    }

    return entries
  }

  private parseQuestionOptions(raw: unknown): Array<{ label: string; description?: string }> {
    const parseOption = (value: unknown): { label: string; description?: string } | null => {
      if (!value || typeof value !== 'object') return null
      const candidate = value as { label?: unknown; description?: unknown }
      if (typeof candidate.label !== 'string') return null
      const label = candidate.label.trim()
      if (!label) return null
      if (typeof candidate.description === 'string' && candidate.description.trim()) {
        return { label, description: candidate.description.trim() }
      }
      return { label }
    }

    if (Array.isArray(raw)) {
      return raw
        .map((item) => parseOption(item))
        .filter((item): item is { label: string; description?: string } => Boolean(item))
    }
    if (typeof raw === 'string' && raw.trim()) {
      try {
        const parsed = JSON.parse(raw) as unknown
        if (Array.isArray(parsed)) {
          return parsed
            .map((item) => parseOption(item))
            .filter((item): item is { label: string; description?: string } => Boolean(item))
        }
      } catch {
        return []
      }
    }
    return []
  }

  private parsePermissionPayload(
    block: AssistantMessageBlock
  ): PendingToolInteraction['permission'] | undefined {
    const rawPayload = block.extra?.permissionRequest
    if (typeof rawPayload === 'string' && rawPayload.trim()) {
      try {
        const parsed = JSON.parse(rawPayload) as PendingToolInteraction['permission']
        if (parsed && typeof parsed === 'object') {
          return {
            ...parsed,
            permissionType:
              parsed.permissionType === 'read' ||
              parsed.permissionType === 'write' ||
              parsed.permissionType === 'all' ||
              parsed.permissionType === 'command'
                ? parsed.permissionType
                : 'write'
          }
        }
      } catch {
        // ignore parsing failure
      }
    }

    const permissionType = block.extra?.permissionType
    return {
      permissionType:
        permissionType === 'read' ||
        permissionType === 'write' ||
        permissionType === 'all' ||
        permissionType === 'command'
          ? permissionType
          : 'write',
      description: typeof block.content === 'string' ? block.content : '',
      toolName:
        typeof block.extra?.toolName === 'string' ? block.extra.toolName : block.tool_call?.name,
      serverName:
        typeof block.extra?.serverName === 'string'
          ? block.extra.serverName
          : block.tool_call?.server_name,
      providerId: typeof block.extra?.providerId === 'string' ? block.extra.providerId : undefined,
      requestId:
        typeof block.extra?.permissionRequestId === 'string'
          ? block.extra.permissionRequestId
          : undefined
    }
  }

  private markQuestionResolved(block: AssistantMessageBlock, answerText: string): void {
    block.status = 'success'
    block.extra = {
      ...block.extra,
      needsUserAction: false,
      questionResolution: 'replied',
      ...(answerText ? { answerText } : {})
    }
  }

  private markPermissionResolved(
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

  private updateToolCallResponse(
    blocks: AssistantMessageBlock[],
    toolCallId: string,
    responseText: string,
    isError: boolean,
    rtkMetadata?: {
      rtkApplied?: boolean
      rtkMode?: 'rewrite' | 'direct' | 'bypass'
      rtkFallbackReason?: string
    }
  ): void {
    const toolBlock = blocks.find(
      (block) => block.type === 'tool_call' && block.tool_call?.id === toolCallId
    )
    if (!toolBlock?.tool_call) return
    toolBlock.tool_call.response = responseText
    if (typeof rtkMetadata?.rtkApplied === 'boolean') {
      toolBlock.tool_call.rtkApplied = rtkMetadata.rtkApplied
    }
    if (rtkMetadata?.rtkMode) {
      toolBlock.tool_call.rtkMode = rtkMetadata.rtkMode
    }
    if (rtkMetadata?.rtkFallbackReason) {
      toolBlock.tool_call.rtkFallbackReason = rtkMetadata.rtkFallbackReason
    }
    toolBlock.status = isError ? 'error' : 'success'
  }

  private updateSubagentToolCallProgress(
    sessionId: string,
    messageId: string,
    toolCallId: string,
    responseMarkdown: string,
    progressJson?: string,
    finalJson?: string
  ): void {
    try {
      const message = this.messageStore.getMessage(messageId)
      if (!message || message.role !== 'assistant') {
        return
      }

      const latestMessage = this.messageStore.getMessage(messageId)
      if (!latestMessage || latestMessage.role !== 'assistant') {
        return
      }

      const blocks = JSON.parse(latestMessage.content) as AssistantMessageBlock[]
      const toolBlock = blocks.find(
        (block) => block.type === 'tool_call' && block.tool_call?.id === toolCallId
      )
      if (!toolBlock?.tool_call) {
        return
      }

      toolBlock.tool_call.response = responseMarkdown
      toolBlock.status = finalJson ? 'success' : 'loading'
      toolBlock.extra = {
        ...toolBlock.extra,
        ...(typeof progressJson === 'string' ? { subagentProgress: progressJson } : {}),
        ...(finalJson ? { subagentFinal: finalJson } : {})
      }
      this.messageStore.updateAssistantContent(messageId, blocks)
      this.emitMessageRefresh(sessionId, messageId)
    } catch (error) {
      console.warn('[DeepChatAgent] Failed to persist subagent tool progress:', error)
    }
  }

  private async grantPermissionForPayload(
    sessionId: string,
    payload: PendingToolInteraction['permission'] | undefined,
    toolCall: NonNullable<AssistantMessageBlock['tool_call']>
  ): Promise<void> {
    if (!payload) return

    const permissionType = payload.permissionType
    const serverName = payload.serverName || toolCall.server_name || ''
    const toolName = payload.toolName || toolCall.name || ''

    if (permissionType === 'command') {
      const command = payload.command || payload.commandInfo?.command || ''
      const signature =
        payload.commandSignature ||
        payload.commandInfo?.signature ||
        (command ? presenter.commandPermissionService.extractCommandSignature(command) : '')
      if (signature) {
        presenter.commandPermissionService.approve(sessionId, signature, false)
      }
      return
    }

    if (serverName === 'agent-filesystem' && Array.isArray(payload.paths) && payload.paths.length) {
      presenter.filePermissionService?.approve(sessionId, payload.paths, false)
      return
    }

    if (serverName === 'deepchat-settings' && toolName) {
      presenter.settingsPermissionService?.approve(sessionId, toolName, false)
      return
    }

    if (
      serverName &&
      (permissionType === 'read' || permissionType === 'write' || permissionType === 'all')
    ) {
      await presenter.mcpPresenter.grantPermission(serverName, permissionType, false, sessionId)
    }
  }

  private async executeDeferredToolCall(
    sessionId: string,
    messageId: string,
    toolCall: NonNullable<AssistantMessageBlock['tool_call']>
  ): Promise<DeferredToolExecutionResult> {
    if (!this.toolPresenter) {
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

    const projectDir = this.resolveProjectDir(sessionId)
    const sessionState = await this.getSessionState(sessionId)
    const toolDefinitions = await this.loadToolDefinitionsForSession(sessionId, projectDir)

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
      const disabledAgentTools = this.getDisabledAgentTools(sessionId)
      if (disabledAgentTools.includes(toolName)) {
        return {
          responseText: `Tool '${toolName}' is disabled for the current session.`,
          isError: true
        }
      }

      return {
        responseText: `Tool '${toolName}' is no longer available in the current session.`,
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
      server: toolDefinition?.server,
      conversationId: sessionId,
      providerId: sessionState?.providerId?.trim() || undefined
    }
    const deferredAbortController = toolCall.id
      ? this.registerDeferredToolAbortController(sessionId, toolCall.id)
      : null
    const deferredAbortSignal =
      deferredAbortController?.signal ?? this.getAbortSignalForSession(sessionId)

    try {
      const result = await this.toolPresenter.callTool(request, {
        onProgress: (update) => {
          if (
            update.kind !== 'subagent_orchestrator' ||
            update.toolCallId !== (toolCall.id || '')
          ) {
            return
          }

          this.updateSubagentToolCallProgress(
            sessionId,
            messageId,
            toolCall.id || '',
            update.responseMarkdown,
            update.progressJson
          )
        },
        signal: deferredAbortSignal
      })
      const rawData = result.rawData as MCPToolResponse
      if (rawData.requiresPermission) {
        return {
          responseText: this.toolContentToText(rawData.content),
          isError: true,
          requiresPermission: true,
          permissionRequest: rawData.permissionRequest as PendingToolInteraction['permission']
        }
      }
      const subagentToolResult =
        rawData.toolResult && typeof rawData.toolResult === 'object'
          ? (rawData.toolResult as Record<string, unknown>)
          : null
      if (typeof subagentToolResult?.subagentProgress === 'string') {
        this.updateSubagentToolCallProgress(
          sessionId,
          messageId,
          toolCall.id || '',
          this.toolContentToText(rawData.content),
          subagentToolResult.subagentProgress,
          typeof subagentToolResult.subagentFinal === 'string'
            ? subagentToolResult.subagentFinal
            : undefined
        )
      } else if (typeof subagentToolResult?.subagentFinal === 'string') {
        this.updateSubagentToolCallProgress(
          sessionId,
          messageId,
          toolCall.id || '',
          this.toolContentToText(rawData.content),
          undefined,
          subagentToolResult.subagentFinal
        )
      }
      const normalizedContent = await this.normalizeToolResultContent({
        sessionId,
        toolCallId: toolCall.id || '',
        toolName,
        toolArgs: toolCall.params || '{}',
        content: rawData.content,
        isError: rawData.isError === true,
        abortSignal: deferredAbortSignal
      })
      const responseText = this.toolContentToText(normalizedContent)
      const prepared = await this.toolOutputGuard.prepareToolOutput({
        sessionId,
        toolCallId: toolCall.id || '',
        toolName,
        rawContent: responseText
      })
      if (prepared.kind === 'tool_error') {
        return {
          responseText: prepared.message,
          isError: true
        }
      }
      return {
        responseText: prepared.content,
        isError: Boolean(rawData.isError),
        offloadPath: prepared.offloadPath,
        rtkApplied: rawData.rtkApplied,
        rtkMode: rawData.rtkMode,
        rtkFallbackReason: rawData.rtkFallbackReason
      }
    } catch (error) {
      const errorText = error instanceof Error ? error.message : String(error)
      return {
        responseText: `Error: ${errorText}`,
        isError: true
      }
    } finally {
      if (toolCall.id) {
        this.clearDeferredToolAbortController(
          sessionId,
          toolCall.id,
          deferredAbortController ?? undefined
        )
      }
    }
  }

  private async loadToolDefinitionsForSession(
    sessionId: string,
    projectDir: string | null
  ): Promise<MCPToolDefinition[]> {
    if (!this.toolPresenter) {
      return []
    }

    try {
      return await this.toolPresenter.getAllToolDefinitions({
        disabledAgentTools: this.getDisabledAgentTools(sessionId),
        chatMode: 'agent',
        conversationId: sessionId,
        agentWorkspacePath: projectDir
      })
    } catch (error) {
      console.error('[DeepChatAgent] failed to fetch tool definitions:', error)
      return []
    }
  }

  private getDisabledAgentTools(sessionId: string): string[] {
    return this.sqlitePresenter.newSessionsTable?.getDisabledAgentTools(sessionId) ?? []
  }

  private fitResumeBudgetForToolCall(params: {
    resumeContext: ChatMessage[]
    toolDefinitions: MCPToolDefinition[]
    contextLength: number
    maxTokens: number
    toolCallId: string
    toolName: string
  }) {
    if (
      this.toolOutputGuard.hasContextBudget({
        conversationMessages: params.resumeContext,
        toolDefinitions: params.toolDefinitions,
        contextLength: params.contextLength,
        maxTokens: params.maxTokens
      })
    ) {
      return null
    }

    return this.toolOutputGuard.fitToolError({
      conversationMessages: params.resumeContext,
      toolDefinitions: params.toolDefinitions,
      contextLength: params.contextLength,
      maxTokens: params.maxTokens,
      toolCallId: params.toolCallId,
      toolName: params.toolName,
      errorMessage: this.toolOutputGuard.buildContextOverflowMessage(
        params.toolCallId,
        params.toolName
      ),
      mode: 'replace'
    })
  }

  private async normalizeToolResultContent(params: {
    sessionId: string
    toolCallId: string
    toolName: string
    toolArgs: string
    content: MCPToolResponse['content']
    isError: boolean
    abortSignal?: AbortSignal
  }): Promise<MCPToolResponse['content']> {
    if (params.isError) {
      return params.content
    }

    const abortSignal = params.abortSignal ?? this.getAbortSignalForSession(params.sessionId)
    const screenshotPayload = this.extractScreenshotToolPayload(
      params.toolName,
      params.toolArgs,
      params.content
    )
    if (!screenshotPayload) {
      return params.content
    }

    try {
      this.throwIfAbortRequested(abortSignal)
      const visionModel = await this.resolveScreenshotVisionModel(params.sessionId, abortSignal)
      this.throwIfAbortRequested(abortSignal)

      if (!visionModel) {
        return 'Screenshot captured, but automatic English analysis is unavailable because neither the current session model nor the agent vision model can analyze images.'
      }

      const messages: ChatMessage[] = [
        {
          role: 'user',
          content: [
            {
              type: 'text',
              text: this.buildScreenshotAnalysisPrompt()
            },
            {
              type: 'image_url',
              image_url: {
                url: screenshotPayload.dataUrl,
                detail: 'auto'
              }
            }
          ]
        }
      ]

      const modelConfig = this.configPresenter.getModelConfig(
        visionModel.modelId,
        visionModel.providerId
      )
      const response = await this.llmProviderPresenter.generateCompletionStandalone(
        visionModel.providerId,
        messages,
        visionModel.modelId,
        modelConfig?.temperature ?? 0.2,
        Math.min(modelConfig?.maxTokens ?? 900, 900),
        abortSignal ? { signal: abortSignal } : undefined
      )
      this.throwIfAbortRequested(abortSignal)
      const normalized = response.trim()
      if (!normalized) {
        return 'Screenshot captured, but automatic English analysis returned no usable description.'
      }
      return normalized
    } catch (error) {
      if (this.isAbortError(error)) {
        return 'Screenshot captured, but automatic English analysis was canceled.'
      }

      const message = error instanceof Error ? error.message : String(error)
      console.warn('[DeepChatAgent] Failed to normalize screenshot tool output:', {
        sessionId: params.sessionId,
        toolCallId: params.toolCallId,
        error: message
      })
      return `Screenshot captured, but automatic English analysis failed: ${message}`
    }
  }

  private extractScreenshotToolPayload(
    toolName: string,
    toolArgs: string,
    content: MCPToolResponse['content']
  ): { dataUrl: string } | null {
    if (toolName !== 'cdp_send' || typeof content !== 'string') {
      return null
    }

    const parsedArgs = this.parseJsonRecord(toolArgs)
    if (!parsedArgs || parsedArgs.method !== 'Page.captureScreenshot') {
      return null
    }

    const parsedContent = this.parseJsonRecord(content)
    const rawData = typeof parsedContent?.data === 'string' ? parsedContent.data.trim() : ''
    if (!rawData) {
      return null
    }

    const screenshotParams = this.normalizeJsonRecord(parsedArgs.params)
    const mimeType = this.resolveScreenshotMimeType(screenshotParams?.format)
    const dataUrl = rawData.startsWith('data:image/')
      ? rawData
      : `data:${mimeType};base64,${rawData}`

    return { dataUrl }
  }

  private normalizeJsonRecord(value: unknown): Record<string, unknown> | null {
    if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
      return value as Record<string, unknown>
    }

    if (typeof value !== 'string' || !value.trim()) {
      return null
    }

    return this.parseJsonRecord(value)
  }

  private parseJsonRecord(value: string): Record<string, unknown> | null {
    try {
      const parsed = JSON.parse(value) as unknown
      if (typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)) {
        return parsed as Record<string, unknown>
      }
    } catch {}

    return null
  }

  private resolveScreenshotMimeType(format: unknown): string {
    if (format === 'jpeg') {
      return 'image/jpeg'
    }
    if (format === 'webp') {
      return 'image/webp'
    }
    return 'image/png'
  }

  private async resolveScreenshotVisionModel(
    sessionId: string,
    abortSignal?: AbortSignal
  ): Promise<{ providerId: string; modelId: string } | null> {
    this.throwIfAbortRequested(abortSignal)
    const state = this.runtimeState.get(sessionId)
    const dbSession = this.sessionStore.get(sessionId)
    const agentId = this.getSessionAgentId(sessionId) ?? 'deepchat'
    const resolved = await resolveSessionVisionTarget({
      providerId: state?.providerId ?? dbSession?.provider_id,
      modelId: state?.modelId ?? dbSession?.model_id,
      agentId,
      configPresenter: this.configPresenter,
      signal: abortSignal,
      logLabel: `screenshot:${sessionId}`
    })
    this.throwIfAbortRequested(abortSignal)

    if (!resolved) {
      return null
    }

    if (resolved.source === 'agent-vision-model') {
      const agentSupportsVision =
        (await this.configPresenter.agentSupportsCapability?.(agentId, 'vision')) === true
      this.throwIfAbortRequested(abortSignal)
      if (!agentSupportsVision) {
        return null
      }
    }

    return {
      providerId: resolved.providerId,
      modelId: resolved.modelId
    }
  }

  private buildScreenshotAnalysisPrompt(): string {
    return [
      'Analyze this browser screenshot and respond in English only.',
      'Describe only what is clearly visible.',
      'Include the page type or layout, the most important visible text, interactive controls, status indicators, warnings, errors, and any detail that matters for the next browser action.',
      'Do not speculate about hidden or unreadable content.',
      'Return detailed plain text in a single paragraph.'
    ].join('\n')
  }

  private toolContentToText(content: MCPToolResponse['content']): string {
    if (typeof content === 'string') {
      return content
    }
    if (!Array.isArray(content)) {
      return ''
    }
    return content
      .map((item) => {
        if (item.type === 'text') return item.text
        if (item.type === 'resource' && item.resource?.text) return item.resource.text
        return `[${item.type}]`
      })
      .join('\n')
  }

  private hasPendingInteractions(sessionId: string): boolean {
    const messages = this.messageStore.getMessages(sessionId)
    for (const message of messages) {
      if (message.role !== 'assistant') continue
      const blocks = this.parseAssistantBlocks(message.content)
      const pendingEntries = this.collectPendingInteractionEntries(message.id, blocks)
      if (pendingEntries.length > 0) {
        return true
      }
    }
    return false
  }

  private isAwaitingToolQuestionFollowUp(sessionId: string): boolean {
    const messages = this.messageStore.getMessages(sessionId)
    let latestUserOrderSeq = 0

    for (const message of messages) {
      if (message.role === 'user') {
        latestUserOrderSeq = Math.max(latestUserOrderSeq, message.orderSeq)
      }
    }

    return messages.some((message) => {
      if (message.role !== 'assistant' || message.orderSeq <= latestUserOrderSeq) {
        return false
      }

      return this.parseAssistantBlocks(message.content).some(
        (block) =>
          block.type === 'action' &&
          block.action_type === 'question_request' &&
          block.status === 'success' &&
          block.extra?.needsUserAction === false &&
          block.extra?.questionResolution === 'replied' &&
          typeof block.extra?.answerText !== 'string'
      )
    })
  }

  private async resolveCompactionStateForResumeTurn(params: {
    sessionId: string
    messageId: string
    providerId: string
    modelId: string
    systemPrompt: string
    contextLength: number
    reserveTokens: number
    supportsVision: boolean
    preserveInterleavedReasoning: boolean
  }): Promise<SessionSummaryState> {
    const intent = await this.compactionService.prepareForResumeTurn(params)
    return await this.applyCompactionIntent(params.sessionId, intent)
  }

  private async applyCompactionIntent(
    sessionId: string,
    intent: CompactionIntent | null,
    options?: {
      compactionMessageId?: string
      startedExternally?: boolean
    }
  ): Promise<SessionSummaryState> {
    if (!intent) {
      return this.sessionStore.getSummaryState(sessionId)
    }

    const compactionMessageId =
      options?.compactionMessageId ??
      this.messageStore.createCompactionMessage(
        sessionId,
        this.messageStore.getNextOrderSeq(sessionId),
        'compacting',
        intent.previousState.summaryUpdatedAt
      )

    if (!options?.startedExternally) {
      this.emitMessageRefresh(sessionId, compactionMessageId)
      this.emitCompactionState(sessionId, {
        status: 'compacting',
        cursorOrderSeq: intent.targetCursorOrderSeq,
        summaryUpdatedAt: intent.previousState.summaryUpdatedAt
      })
    }

    const result = await this.compactionService.applyCompaction(intent)
    if (result.succeeded) {
      this.messageStore.updateCompactionMessage(
        compactionMessageId,
        'compacted',
        result.summaryState.summaryUpdatedAt
      )
    } else {
      this.messageStore.deleteMessage(compactionMessageId)
    }
    this.emitMessageRefresh(sessionId, compactionMessageId)
    this.emitCompactionState(
      sessionId,
      result.succeeded
        ? this.summaryStateToCompactionState(result.summaryState, 'compacted')
        : this.summaryStateToCompactionState(result.summaryState)
    )
    return result.summaryState
  }

  private buildIdleCompactionState(): SessionCompactionState {
    return {
      status: 'idle',
      cursorOrderSeq: 1,
      summaryUpdatedAt: null
    }
  }

  private summaryStateToCompactionState(
    summaryState: SessionSummaryState,
    preferredStatus?: 'compacted'
  ): SessionCompactionState {
    const hasPersistedSummary =
      Boolean(summaryState.summaryText?.trim()) && summaryState.summaryUpdatedAt !== null
    if (preferredStatus === 'compacted' || hasPersistedSummary) {
      return {
        status: 'compacted',
        cursorOrderSeq: Math.max(1, summaryState.summaryCursorOrderSeq),
        summaryUpdatedAt: summaryState.summaryUpdatedAt
      }
    }
    return this.buildIdleCompactionState()
  }

  private isSameCompactionState(
    left: SessionCompactionState,
    right: SessionCompactionState
  ): boolean {
    return (
      left.status === right.status &&
      left.cursorOrderSeq === right.cursorOrderSeq &&
      left.summaryUpdatedAt === right.summaryUpdatedAt
    )
  }

  private emitCompactionState(sessionId: string, state: SessionCompactionState): void {
    this.sessionCompactionStates.set(sessionId, { ...state })
    eventBus.sendToRenderer(SESSION_EVENTS.COMPACTION_UPDATED, SendTarget.ALL_WINDOWS, {
      sessionId,
      status: state.status,
      cursorOrderSeq: state.cursorOrderSeq,
      summaryUpdatedAt: state.summaryUpdatedAt
    })
  }

  private resetSummaryState(sessionId: string): void {
    this.sessionStore.resetSummaryState(sessionId)
    this.emitCompactionState(sessionId, this.buildIdleCompactionState())
  }

  private invalidateSummaryIfNeeded(sessionId: string, orderSeq: number): void {
    const summaryState = this.sessionStore.getSummaryState(sessionId)
    if (orderSeq < summaryState.summaryCursorOrderSeq) {
      this.resetSummaryState(sessionId)
    }
  }

  private setSessionStatus(sessionId: string, status: DeepChatSessionState['status']): void {
    const current = this.runtimeState.get(sessionId)
    if (!current) {
      return
    }
    if (current.status === status) {
      return
    }
    current.status = status
    eventBus.sendToRenderer(SESSION_EVENTS.STATUS_CHANGED, SendTarget.ALL_WINDOWS, {
      sessionId,
      status
    })
    emitDeepChatInternalSessionUpdate({
      sessionId,
      kind: 'status',
      updatedAt: Date.now(),
      status
    })

    try {
      void presenter.floatingButtonPresenter.refreshWidgetState()
    } catch (error) {
      console.warn('[DeepChatAgent] Failed to refresh floating widget state:', error)
    }
  }

  private emitMessageRefresh(sessionId: string, messageId: string): void {
    eventBus.sendToRenderer(STREAM_EVENTS.END, SendTarget.ALL_WINDOWS, {
      conversationId: sessionId,
      eventId: messageId,
      messageId
    })

    const message = this.messageStore.getMessage(messageId)
    if (!message || message.role !== 'assistant') {
      return
    }

    try {
      const blocks = JSON.parse(message.content) as AssistantMessageBlock[]
      emitDeepChatInternalSessionUpdate({
        sessionId,
        kind: 'blocks',
        updatedAt: Date.now(),
        messageId,
        previewMarkdown: buildAssistantPreviewMarkdown(blocks),
        responseMarkdown: buildAssistantResponseMarkdown(blocks),
        waitingInteraction: extractWaitingInteraction(blocks, messageId)
      })
    } catch (error) {
      console.warn('[DeepChatAgent] Failed to emit internal message refresh:', error)
    }
  }

  private normalizeProjectDir(projectDir?: string | null): string | null {
    const normalized = projectDir?.trim()
    return normalized ? normalized : null
  }

  private resolveProjectDir(sessionId: string, incoming?: string | null): string | null {
    if (incoming !== undefined) {
      const normalized = this.normalizeProjectDir(incoming)
      const previous = this.sessionProjectDirs.get(sessionId) ?? null
      this.sessionProjectDirs.set(sessionId, normalized)
      if (previous !== normalized) {
        this.invalidateSystemPromptCache(sessionId)
      }
      return normalized
    }
    return this.sessionProjectDirs.get(sessionId) ?? null
  }
}
