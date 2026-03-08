import type {
  AssistantMessageBlock,
  ChatMessageRecord,
  DeepChatSessionState,
  IAgentImplementation,
  MessageFile,
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
  MCPToolDefinition,
  ModelConfig
} from '@shared/presenter'
import type { IToolPresenter } from '@shared/types/presenters/tool.presenter'
import { nanoid } from 'nanoid'
import type { SQLitePresenter } from '../sqlitePresenter'
import { eventBus, SendTarget } from '@/eventbus'
import { SESSION_EVENTS, STREAM_EVENTS } from '@/events'
import { presenter } from '@/presenter'
import {
  buildRuntimeCapabilitiesPrompt,
  buildSystemEnvPrompt
} from '../agentPresenter/message/systemEnvPromptBuilder'
import { buildContext, buildResumeContext } from './contextBuilder'
import { appendSummarySection, CompactionService, type CompactionIntent } from './compactionService'
import { buildPersistableMessageTracePayload } from './messageTracePayload'
import { DeepChatMessageStore } from './messageStore'
import { processStream } from './process'
import { DeepChatSessionStore, type SessionSummaryState } from './sessionStore'
import type { PendingToolInteraction, ProcessResult } from './types'
import { ToolOutputGuard } from './toolOutputGuard'
import type { ProviderRequestTracePayload } from '../llmProviderPresenter/requestTrace'
import type { NewSessionHooksBridge } from '../hooksNotifications/newSessionBridge'

type PendingInteractionEntry = {
  interaction: PendingToolInteraction
  blockIndex: number
}

type DeferredToolExecutionResult = {
  responseText: string
  isError: boolean
  offloadPath?: string
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
}

type SystemPromptCacheEntry = {
  prompt: string
  dayKey: string
  fingerprint: string
}

const TEMPERATURE_MIN = 0
const TEMPERATURE_MAX = 2
const CONTEXT_LENGTH_MIN = 2048
const MAX_TOKENS_MIN = 128

const isReasoningEffort = (value: unknown): value is SessionGenerationSettings['reasoningEffort'] =>
  value === 'minimal' || value === 'low' || value === 'medium' || value === 'high'

const isVerbosity = (value: unknown): value is SessionGenerationSettings['verbosity'] =>
  value === 'low' || value === 'medium' || value === 'high'

export class DeepChatAgentPresenter implements IAgentImplementation {
  private readonly llmProviderPresenter: ILlmProviderPresenter
  private readonly configPresenter: IConfigPresenter
  private readonly toolPresenter: IToolPresenter | null
  private readonly sessionStore: DeepChatSessionStore
  private readonly messageStore: DeepChatMessageStore
  private readonly runtimeState: Map<string, DeepChatSessionState> = new Map()
  private readonly sessionGenerationSettings: Map<string, SessionGenerationSettings> = new Map()
  private readonly abortControllers: Map<string, AbortController> = new Map()
  private readonly sessionAgentIds: Map<string, string> = new Map()
  private readonly sessionProjectDirs: Map<string, string | null> = new Map()
  private readonly systemPromptCache: Map<string, SystemPromptCacheEntry> = new Map()
  private readonly sessionCompactionStates: Map<string, SessionCompactionState> = new Map()
  private readonly interactionLocks: Set<string> = new Set()
  private readonly resumingMessages: Set<string> = new Set()
  private readonly compactionService: CompactionService
  private readonly toolOutputGuard: ToolOutputGuard
  private readonly hooksBridge?: NewSessionHooksBridge

  constructor(
    llmProviderPresenter: ILlmProviderPresenter,
    configPresenter: IConfigPresenter,
    sqlitePresenter: SQLitePresenter,
    toolPresenter?: IToolPresenter,
    hooksBridge?: NewSessionHooksBridge
  ) {
    this.llmProviderPresenter = llmProviderPresenter
    this.configPresenter = configPresenter
    this.toolPresenter = toolPresenter ?? null
    this.sessionStore = new DeepChatSessionStore(sqlitePresenter)
    this.messageStore = new DeepChatMessageStore(sqlitePresenter)
    this.compactionService = new CompactionService(
      this.sessionStore,
      this.messageStore,
      this.llmProviderPresenter,
      this.configPresenter
    )
    this.toolOutputGuard = new ToolOutputGuard()
    this.hooksBridge = hooksBridge

    const recovered = this.messageStore.recoverPendingMessages()
    if (recovered > 0) {
      console.log(`DeepChatAgent: recovered ${recovered} pending messages to error status`)
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
    this.sessionAgentIds.set(sessionId, config.agentId?.trim() || 'deepchat')
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
    const controller = this.abortControllers.get(sessionId)
    if (controller) {
      controller.abort()
      this.abortControllers.delete(sessionId)
    }

    this.messageStore.deleteBySession(sessionId)
    this.sessionStore.delete(sessionId)
    this.runtimeState.delete(sessionId)
    this.sessionAgentIds.delete(sessionId)
    this.sessionGenerationSettings.delete(sessionId)
    this.sessionProjectDirs.delete(sessionId)
    this.systemPromptCache.delete(sessionId)
    this.sessionCompactionStates.delete(sessionId)
  }

  async getSessionState(sessionId: string): Promise<DeepChatSessionState | null> {
    const state = this.runtimeState.get(sessionId)
    if (state) {
      if (this.hasPendingInteractions(sessionId)) {
        state.status = 'generating'
      }
      await this.getEffectiveSessionGenerationSettings(sessionId)
      return { ...state }
    }

    const dbSession = this.sessionStore.get(sessionId)
    if (!dbSession) return null

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

  async processMessage(
    sessionId: string,
    content: string | SendMessageInput,
    context?: { projectDir?: string | null; emitRefreshBeforeStream?: boolean }
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

    try {
      const generationSettings = await this.getEffectiveSessionGenerationSettings(sessionId)
      const maxTokens = generationSettings.maxTokens
      const baseSystemPrompt = await this.buildSystemPromptWithSkills(
        sessionId,
        generationSettings.systemPrompt
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

      const compactionIntent = this.compactionService.prepareForNextUserTurn({
        sessionId,
        providerId: state.providerId,
        modelId: state.modelId,
        systemPrompt: baseSystemPrompt,
        contextLength: generationSettings.contextLength,
        reserveTokens: maxTokens,
        supportsVision,
        newUserContent: normalizedInput
      })
      let userMessageId: string
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
        this.emitMessageRefresh(sessionId, userMessageId)
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
          historyRecords
        }
      )

      const assistantOrderSeq = this.messageStore.getNextOrderSeq(sessionId)
      const assistantMessageId = this.messageStore.createAssistantMessage(
        sessionId,
        assistantOrderSeq
      )

      if (context?.emitRefreshBeforeStream) {
        this.emitMessageRefresh(sessionId, assistantMessageId || userMessageId)
      }

      const result = await this.runStreamForMessage({
        sessionId,
        messageId: assistantMessageId,
        messages,
        projectDir,
        promptPreview: normalizedInput.text
      })
      this.applyProcessResultStatus(sessionId, result)
    } catch (err) {
      console.error('[DeepChatAgent] processMessage error:', err)
      const errorMessage = err instanceof Error ? err.message : String(err)
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

        if (response.granted) {
          this.markPermissionResolved(actionBlock, true, permissionType)
          await this.grantPermissionForPayload(sessionId, permissionPayload, toolCall)
          this.dispatchHook('PreToolUse', {
            sessionId,
            messageId,
            providerId: state?.providerId,
            modelId: state?.modelId,
            projectDir: this.resolveProjectDir(sessionId),
            tool: {
              callId: toolCall.id,
              name: toolCall.name,
              params: toolCall.params
            }
          })
          const execution = await this.executeDeferredToolCall(sessionId, toolCall)
          if (execution.terminalError) {
            this.dispatchHook('PostToolUseFailure', {
              sessionId,
              messageId,
              providerId: state?.providerId,
              modelId: state?.modelId,
              projectDir: this.resolveProjectDir(sessionId),
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
              projectDir: this.resolveProjectDir(sessionId),
              stop: { reason: 'error', userStop: false }
            })
            this.dispatchHook('SessionEnd', {
              sessionId,
              messageId,
              providerId: state?.providerId,
              modelId: state?.modelId,
              projectDir: this.resolveProjectDir(sessionId),
              error: { message: execution.terminalError }
            })
            this.setSessionStatus(sessionId, 'error')
            return { resumed: false }
          }
          this.dispatchHook(execution.isError ? 'PostToolUseFailure' : 'PostToolUse', {
            sessionId,
            messageId,
            providerId: state?.providerId,
            modelId: state?.modelId,
            projectDir: this.resolveProjectDir(sessionId),
            tool: execution.isError
              ? {
                  callId: toolCall.id,
                  name: toolCall.name,
                  params: toolCall.params,
                  error: execution.responseText
                }
              : {
                  callId: toolCall.id,
                  name: toolCall.name,
                  params: toolCall.params,
                  response: execution.responseText
                }
          })
          this.updateToolCallResponse(
            blocks,
            toolCall.id,
            execution.responseText,
            execution.isError
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
              projectDir: this.resolveProjectDir(sessionId),
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
          }
        } else {
          this.markPermissionResolved(actionBlock, false, permissionType)
          this.updateToolCallResponse(blocks, toolCall.id, 'User denied the request.', true)
        }
      } else {
        throw new Error(`Unsupported action type: ${actionBlock.action_type}`)
      }

      this.messageStore.updateAssistantContent(messageId, blocks)
      const remainingPending = this.collectPendingInteractionEntries(messageId, blocks)
      this.emitMessageRefresh(sessionId, messageId)

      if (remainingPending.length > 0) {
        this.messageStore.updateMessageStatus(messageId, 'pending')
        this.setSessionStatus(sessionId, 'generating')
        return { resumed: false }
      }

      if (waitingForUserMessage) {
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
    const sanitized = await this.sanitizeGenerationSettings(
      nextProviderId,
      nextModelId,
      {},
      currentGeneration
    )

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
    this.sessionStore.updateGenerationSettings(sessionId, sanitized)
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
    this.sessionStore.updateGenerationSettings(sessionId, sanitized)
    if (Object.prototype.hasOwnProperty.call(settings, 'systemPrompt')) {
      this.invalidateSystemPromptCache(sessionId)
    }
    return sanitized
  }

  async cancelGeneration(sessionId: string): Promise<void> {
    const controller = this.abortControllers.get(sessionId)
    if (controller) {
      controller.abort()
      this.abortControllers.delete(sessionId)
    }
    this.setSessionStatus(sessionId, 'idle')
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
        agentId: this.sessionAgentIds.get(context.sessionId) ?? 'deepchat'
      })
    } catch (error) {
      console.warn(`[DeepChatAgent] Failed to dispatch ${event} hook:`, error)
    }
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
  }): Promise<ProcessResult> {
    const {
      sessionId,
      messageId,
      messages,
      projectDir,
      tools: providedTools,
      initialBlocks,
      promptPreview
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
            tools: import('@shared/presenter').MCPToolDefinition[]
          ) => AsyncGenerator<import('@shared/types/core/llm-events').LLMCoreStreamEvent>
        }
      }
    ).getProviderInstance(state.providerId)

    const generationSettings = await this.getEffectiveSessionGenerationSettings(sessionId)
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
          this.persistMessageTrace({
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

    const abortController = new AbortController()
    this.abortControllers.set(sessionId, abortController)

    try {
      this.dispatchHook('SessionStart', {
        sessionId,
        messageId,
        promptPreview,
        providerId: state.providerId,
        modelId: state.modelId,
        projectDir
      })

      return await processStream({
        messages,
        tools,
        toolPresenter: this.toolPresenter,
        coreStream: provider.coreStream.bind(provider),
        providerId: state.providerId,
        modelId: state.modelId,
        modelConfig,
        temperature,
        maxTokens,
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
          }
        },
        io: {
          sessionId,
          messageId,
          messageStore: this.messageStore,
          abortSignal: abortController.signal
        }
      })
    } finally {
      const active = this.abortControllers.get(sessionId)
      if (active === abortController) {
        this.abortControllers.delete(sessionId)
      }
    }
  }

  private applyProcessResultStatus(
    sessionId: string,
    result: ProcessResult | null | undefined
  ): void {
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
      const maxTokens = generationSettings.maxTokens
      const baseSystemPrompt = await this.buildSystemPromptWithSkills(
        sessionId,
        generationSettings.systemPrompt
      )
      const summaryState = await this.resolveCompactionStateForResumeTurn({
        sessionId,
        messageId,
        providerId: state.providerId,
        modelId: state.modelId,
        systemPrompt: baseSystemPrompt,
        contextLength: generationSettings.contextLength,
        reserveTokens: maxTokens,
        supportsVision: this.supportsVision(state.providerId, state.modelId)
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
          fallbackProtectedTurnCount: 1
        }
      )
      const projectDir = this.resolveProjectDir(sessionId)
      const tools = await this.loadToolDefinitionsForSession(sessionId, projectDir)

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

      const result = await this.runStreamForMessage({
        sessionId,
        messageId,
        messages: resumeContext,
        projectDir,
        tools,
        initialBlocks
      })
      this.applyProcessResultStatus(sessionId, result)
      return true
    } catch (error) {
      console.error('[DeepChatAgent] resumeAssistantMessage error:', error)
      this.setSessionStatus(sessionId, 'error')
      throw error
    } finally {
      this.resumingMessages.delete(messageId)
    }
  }

  private async buildSystemPromptWithSkills(
    sessionId: string,
    basePrompt: string
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
    const fingerprint = this.buildSystemPromptFingerprint({
      providerId,
      modelId,
      workdir,
      basePrompt: normalizedBase,
      skillsEnabled,
      availableSkillNames: normalizedAvailableSkills,
      activeSkillNames: normalizedActiveSkills
    })

    const cachedPrompt = this.systemPromptCache.get(sessionId)
    if (
      cachedPrompt &&
      cachedPrompt.dayKey === dayKey &&
      cachedPrompt.fingerprint === fingerprint
    ) {
      return cachedPrompt.prompt
    }

    const runtimePrompt = buildRuntimeCapabilitiesPrompt()
    const skillsMetadataPrompt = skillsEnabled
      ? this.buildSkillsMetadataPrompt(normalizedAvailableSkills)
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
        toolingPrompt = this.toolPresenter.buildToolSystemPrompt({ conversationId: sessionId })
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

  private buildSkillsMetadataPrompt(availableSkillNames: string[]): string {
    const lines = [
      '## Skills',
      'If you may need specialized guidance, call `skill_list` first to inspect available skills and activation status.',
      'After identifying a matching skill, call `skill_control` to activate or deactivate it before proceeding.'
    ]

    if (availableSkillNames.length > 0) {
      lines.push('Installed skill names:')
      lines.push(...availableSkillNames.map((name) => `- ${name}`))
    } else {
      lines.push('Installed skill names: (none)')
    }

    return lines.join('\n')
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
  }): string {
    return JSON.stringify({
      providerId: params.providerId,
      modelId: params.modelId,
      workdir: params.workdir ?? '',
      basePrompt: params.basePrompt,
      skillsEnabled: params.skillsEnabled,
      availableSkillNames: params.availableSkillNames,
      activeSkillNames: params.activeSkillNames
    })
  }

  private buildLocalDayKey(now: Date): string {
    const year = now.getFullYear()
    const month = String(now.getMonth() + 1).padStart(2, '0')
    const day = String(now.getDate()).padStart(2, '0')
    return `${year}-${month}-${day}`
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
      patch.thinkingBudget = sessionRow.thinking_budget
    }
    if (sessionRow.reasoning_effort !== null) {
      patch.reasoningEffort = sessionRow.reasoning_effort
    }
    if (sessionRow.verbosity !== null) {
      patch.verbosity = sessionRow.verbosity
    }

    return patch
  }

  private async buildDefaultGenerationSettings(
    providerId: string,
    modelId: string
  ): Promise<SessionGenerationSettings> {
    const modelConfig = this.configPresenter.getModelConfig(modelId, providerId)
    const defaultSystemPrompt = await this.configPresenter.getDefaultSystemPrompt()
    const contextLengthLimit = this.getContextLengthLimit(modelConfig)
    const maxTokensLimit = this.getMaxTokensLimit(modelConfig)

    const defaults: SessionGenerationSettings = {
      systemPrompt: defaultSystemPrompt ?? '',
      temperature: this.clampNumber(
        modelConfig.temperature ?? 0.7,
        TEMPERATURE_MIN,
        TEMPERATURE_MAX
      ),
      contextLength: this.clampInteger(
        modelConfig.contextLength ?? contextLengthLimit,
        CONTEXT_LENGTH_MIN,
        contextLengthLimit
      ),
      maxTokens: this.clampInteger(
        modelConfig.maxTokens ?? Math.min(4096, maxTokensLimit),
        MAX_TOKENS_MIN,
        maxTokensLimit
      )
    }

    defaults.maxTokens = Math.min(defaults.maxTokens, defaults.contextLength)

    const supportsReasoning =
      this.configPresenter.supportsReasoningCapability?.(providerId, modelId) === true
    if (supportsReasoning) {
      const budgetRange = this.configPresenter.getThinkingBudgetRange?.(providerId, modelId) ?? {}
      const defaultBudget = this.toFiniteNumber(
        modelConfig.thinkingBudget ?? budgetRange.default ?? undefined
      )
      if (defaultBudget !== undefined) {
        defaults.thinkingBudget = this.clampNumberWithOptionalRange(
          Math.round(defaultBudget),
          budgetRange.min,
          budgetRange.max
        )
      }
    }

    const supportsEffort =
      this.configPresenter.supportsReasoningEffortCapability?.(providerId, modelId) === true
    if (supportsEffort) {
      const rawEffort =
        modelConfig.reasoningEffort ??
        this.configPresenter.getReasoningEffortDefault?.(providerId, modelId)
      const normalizedEffort = this.normalizeReasoningEffort(providerId, rawEffort)
      if (normalizedEffort) {
        defaults.reasoningEffort = normalizedEffort
      }
    }

    const supportsVerbosity =
      this.configPresenter.supportsVerbosityCapability?.(providerId, modelId) === true
    if (supportsVerbosity) {
      const rawVerbosity =
        modelConfig.verbosity ?? this.configPresenter.getVerbosityDefault?.(providerId, modelId)
      if (isVerbosity(rawVerbosity)) {
        defaults.verbosity = rawVerbosity
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
    const modelConfig = this.configPresenter.getModelConfig(modelId, providerId)
    const contextLengthLimit = this.getContextLengthLimit(modelConfig)
    const maxTokensLimit = this.getMaxTokensLimit(modelConfig)

    const next: SessionGenerationSettings = { ...base }

    if (Object.prototype.hasOwnProperty.call(patch, 'systemPrompt')) {
      next.systemPrompt =
        typeof patch.systemPrompt === 'string' ? patch.systemPrompt : base.systemPrompt
    }

    if (Object.prototype.hasOwnProperty.call(patch, 'temperature')) {
      const numeric = this.toFiniteNumber(patch.temperature)
      next.temperature = this.clampNumber(
        numeric ?? base.temperature,
        TEMPERATURE_MIN,
        TEMPERATURE_MAX
      )
    }

    if (Object.prototype.hasOwnProperty.call(patch, 'contextLength')) {
      const numeric = this.toFiniteNumber(patch.contextLength)
      next.contextLength = this.clampInteger(
        Math.round(numeric ?? base.contextLength),
        CONTEXT_LENGTH_MIN,
        contextLengthLimit
      )
    } else {
      next.contextLength = this.clampInteger(
        next.contextLength,
        CONTEXT_LENGTH_MIN,
        contextLengthLimit
      )
    }

    if (Object.prototype.hasOwnProperty.call(patch, 'maxTokens')) {
      const numeric = this.toFiniteNumber(patch.maxTokens)
      next.maxTokens = this.clampInteger(
        Math.round(numeric ?? base.maxTokens),
        MAX_TOKENS_MIN,
        maxTokensLimit
      )
    } else {
      next.maxTokens = this.clampInteger(next.maxTokens, MAX_TOKENS_MIN, maxTokensLimit)
    }
    next.maxTokens = Math.min(next.maxTokens, next.contextLength)

    const supportsReasoning =
      this.configPresenter.supportsReasoningCapability?.(providerId, modelId) === true
    if (supportsReasoning) {
      const budgetRange = this.configPresenter.getThinkingBudgetRange?.(providerId, modelId) ?? {}
      if (Object.prototype.hasOwnProperty.call(patch, 'thinkingBudget')) {
        const raw = patch.thinkingBudget
        const numeric = this.toFiniteNumber(raw)
        if (numeric === undefined) {
          delete next.thinkingBudget
        } else {
          next.thinkingBudget = this.clampNumberWithOptionalRange(
            Math.round(numeric),
            budgetRange.min,
            budgetRange.max
          )
        }
      } else if (next.thinkingBudget !== undefined) {
        next.thinkingBudget = this.clampNumberWithOptionalRange(
          Math.round(next.thinkingBudget),
          budgetRange.min,
          budgetRange.max
        )
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
        this.normalizeReasoningEffort(providerId, fromPatch) ??
        this.normalizeReasoningEffort(providerId, defaultEffort)
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
      const candidate = isVerbosity(fromPatch) ? fromPatch : defaultVerbosity
      if (isVerbosity(candidate)) {
        next.verbosity = candidate
      } else {
        delete next.verbosity
      }
    } else {
      delete next.verbosity
    }

    return next
  }

  private normalizeReasoningEffort(
    providerId: string,
    value: unknown
  ): SessionGenerationSettings['reasoningEffort'] | undefined {
    if (!isReasoningEffort(value)) {
      return undefined
    }
    if (providerId !== 'grok') {
      return value
    }
    if (value === 'low' || value === 'high') {
      return value
    }
    return value === 'minimal' ? 'low' : 'high'
  }

  private toFiniteNumber(value: unknown): number | undefined {
    if (typeof value !== 'number' || Number.isNaN(value) || !Number.isFinite(value)) {
      return undefined
    }
    return value
  }

  private clampNumber(value: number, min: number, max: number): number {
    if (value < min) return min
    if (value > max) return max
    return value
  }

  private clampInteger(value: number, min: number, max: number): number {
    return Math.round(this.clampNumber(value, min, max))
  }

  private clampNumberWithOptionalRange(value: number, min?: number, max?: number): number {
    let next = value
    if (typeof min === 'number' && Number.isFinite(min)) {
      next = Math.max(next, Math.round(min))
    }
    if (typeof max === 'number' && Number.isFinite(max)) {
      next = Math.min(next, Math.round(max))
    }
    return next
  }

  private getContextLengthLimit(modelConfig: ModelConfig): number {
    const configured = this.toFiniteNumber(modelConfig.contextLength)
    if (configured === undefined) {
      return 32000
    }
    return Math.max(CONTEXT_LENGTH_MIN, Math.round(configured))
  }

  private getMaxTokensLimit(modelConfig: ModelConfig): number {
    const configured = this.toFiniteNumber(modelConfig.maxTokens)
    if (configured === undefined) {
      return 4096
    }
    return Math.max(MAX_TOKENS_MIN, Math.round(configured))
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
    isError: boolean
  ): void {
    const toolBlock = blocks.find(
      (block) => block.type === 'tool_call' && block.tool_call?.id === toolCallId
    )
    if (!toolBlock?.tool_call) return
    toolBlock.tool_call.response = responseText
    toolBlock.status = isError ? 'error' : 'success'
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

    const request: MCPToolCall = {
      id: toolCall.id || '',
      type: 'function',
      function: {
        name: toolName,
        arguments: toolCall.params || '{}'
      },
      server: toolDefinition?.server,
      conversationId: sessionId
    }

    try {
      const result = await this.toolPresenter.callTool(request)
      const rawData = result.rawData as MCPToolResponse
      if (rawData.requiresPermission) {
        return {
          responseText: this.toolContentToText(rawData.content),
          isError: true,
          requiresPermission: true,
          permissionRequest: rawData.permissionRequest as PendingToolInteraction['permission']
        }
      }
      const responseText = this.toolContentToText(rawData.content)
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
        offloadPath: prepared.offloadPath
      }
    } catch (error) {
      const errorText = error instanceof Error ? error.message : String(error)
      return {
        responseText: `Error: ${errorText}`,
        isError: true
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
        chatMode: 'agent',
        conversationId: sessionId,
        agentWorkspacePath: projectDir
      })
    } catch (error) {
      console.error('[DeepChatAgent] failed to fetch tool definitions:', error)
      return []
    }
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

  private async resolveCompactionStateForResumeTurn(params: {
    sessionId: string
    messageId: string
    providerId: string
    modelId: string
    systemPrompt: string
    contextLength: number
    reserveTokens: number
    supportsVision: boolean
  }): Promise<SessionSummaryState> {
    const intent = this.compactionService.prepareForResumeTurn(params)
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
  }

  private emitMessageRefresh(sessionId: string, messageId: string): void {
    eventBus.sendToRenderer(STREAM_EVENTS.END, SendTarget.ALL_WINDOWS, {
      conversationId: sessionId,
      eventId: messageId,
      messageId
    })
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
