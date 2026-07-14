import logger from '@shared/logger'
import type {
  AssistantMessageBlock,
  DeepChatSessionState,
  MessageMetadata,
  MessageStartResult,
  PendingInputEnqueueSource,
  SendMessageInput,
  SessionGenerationSettings,
  UserMessageContent
} from '@shared/types/agent-interface'
import type { ChatMessage } from '@shared/types/core/chat-message'
import type { MCPToolDefinition } from '@shared/types/core/mcp'
import type { IConfigPresenter, ModelConfig } from '@shared/presenter'
import type { IToolPresenter } from '@shared/types/presenters/tool.presenter'
import { toAppSessionId } from '@/agent/shared/agentSessionIds'
import type { DeepChatAgentInstance } from '@/agent/deepchat/instance/deepChatAgentInstance'
import type { MemoryIngestionObserver } from '@/agent/deepchat/memory/memoryIngestionObserver'
import type { MemoryRuntimeCoordinator } from '@/agent/deepchat/memory/memoryRuntimeCoordinator'
import type { PendingInputCoordinator } from '@/agent/deepchat/pending/pendingInputCoordinator'
import { buildTapeViewSelection, type DeepChatLoopRunInput } from './deepChatLoopRunner'
import type { DeepChatContextCoordinator } from '@/agent/deepchat/loop/contextCoordinator'
import type { InputPreparationCoordinator } from '@/agent/deepchat/loop/inputPreparationCoordinator'
import type {
  BasePromptAssembler,
  PostCompactionPromptAssembler
} from '@/agent/deepchat/loop/ports'
import { resolveEffectiveActiveSkillNames } from '@/agent/deepchat/resources/systemPromptBuilder'
import { awaitWithAbort } from '@/lib/awaitWithAbort'
import { publishDeepchatEvent } from '@/routes/publishDeepchatEvent'
import { capAgentRequestMaxTokens, estimateToolReserveTokens } from './contextBudget'
import type { CompactionRuntimeCoordinator } from './compactionRuntimeCoordinator'
import type { CompactionService } from './compactionService'
import { isContextWindowErrorLike } from './contextWindowError'
import { resolveInterleavedReasoningConfig } from './generationSettings'
import {
  updateToolCallResponse,
  normalizeUserMessageInput,
  parseAssistantBlocks
} from './interactionProjection'
import { buildTerminalErrorBlocks, type DeepChatMessageStore } from './messageStore'
import type { ProcessResult } from './types'
import { buildUsageFromMetadata, stampTerminalMetadata } from './runtimeMetadata'
import type { DeepChatSessionStore } from './sessionStore'
import type { DeepChatTapeService } from './tapeService'
import {
  getTapeContextHistoryRecords,
  buildTapeChatView,
  buildTapeResumeView
} from './tapeViewAssembler'
import type { DeepChatToolResolver } from './toolResolver'
import type { ToolOutputGuard } from './toolOutputGuard'
import type { ResumeBudgetToolCall } from './interactionCoordinator'
import { parseMessageMetadata } from '../usageStats'

export type ProcessPendingInputSource = PendingInputEnqueueSource | 'steer'

export interface TurnStartContext {
  projectDir?: string | null
  emitRefreshBeforeStream?: boolean
  pendingQueueItemId?: string
  pendingQueueItemSource?: ProcessPendingInputSource
  maxProviderRounds?: number
}

type PreStreamStepInput = {
  sessionId: string
  messageId?: string | null
  step: string
  signal?: AbortSignal
}

type PreStreamBoundary = {
  complete(): void
  cancel(): void
}

type RuntimeHookEvent = 'UserPromptSubmit' | 'Stop' | 'SessionEnd'

type RuntimeHookContext = {
  sessionId: string
  messageId?: string
  promptPreview?: string
  providerId?: string
  modelId?: string
  projectDir?: string | null
  stop?: { reason?: string; userStop?: boolean } | null
  usage?: Record<string, number> | null
  error?: { message?: string; stack?: string } | null
}

export interface TurnCoordinatorPorts {
  configPresenter: IConfigPresenter
  toolPresenter: Pick<IToolPresenter, 'clearAgentPlanState'> | null
  sessionStore: DeepChatSessionStore
  messageStore: DeepChatMessageStore
  tapeService: DeepChatTapeService
  pendingInputCoordinator: PendingInputCoordinator
  toolResolver: DeepChatToolResolver
  compactionService: CompactionService
  compactionRuntimeCoordinator: CompactionRuntimeCoordinator
  inputPreparationCoordinator: InputPreparationCoordinator
  contextCoordinator: DeepChatContextCoordinator
  memoryCoordinator: MemoryRuntimeCoordinator
  memoryIngestionObserver: MemoryIngestionObserver
  postCompactionPromptAssembler: PostCompactionPromptAssembler
  toolOutputGuard: ToolOutputGuard
  getDeepChatInstance(sessionId: string): DeepChatAgentInstance
  getHydratedDeepChatInstance(sessionId: string): DeepChatAgentInstance | undefined
  getRuntimeState(sessionId: string): DeepChatSessionState | undefined
  hasPendingInteractions(sessionId: string): boolean
  supportsVision(providerId: string, modelId: string): boolean
  supportsAudioInput(providerId: string, modelId: string): boolean
  resolveProjectDir(
    sessionId: string,
    projectDir?: string | null,
    expectedInstance?: DeepChatAgentInstance
  ): string | null
  setSessionStatus(sessionId: string, status: DeepChatSessionState['status']): void
  setSessionStatusForInstance(
    sessionId: string,
    expectedInstance: DeepChatAgentInstance,
    status: DeepChatSessionState['status']
  ): boolean
  ensureSessionAbortController(sessionId: string): AbortController
  clearSessionAbortController(sessionId: string, controller?: AbortController): void
  throwIfAbortRequested(signal?: AbortSignal): void
  throwIfStaleDeepChatInstance(sessionId: string, expectedInstance: DeepChatAgentInstance): void
  isStaleDeepChatInstanceError(error: unknown): boolean
  isAbortError(error: unknown): boolean
  getEffectiveSessionGenerationSettings(
    sessionId: string,
    expectedInstance: DeepChatAgentInstance
  ): Promise<SessionGenerationSettings>
  shouldUseDeepChatContextBudget(
    providerId?: string | null,
    modelConfig?: Pick<ModelConfig, 'apiEndpoint' | 'endpointType' | 'type'> | null,
    modelId?: string | null
  ): boolean
  resolveDeepChatContextBudgetLength(
    providerId: string | null | undefined,
    contextLength: number,
    modelConfig?: Pick<ModelConfig, 'apiEndpoint' | 'endpointType' | 'type'> | null,
    modelId?: string | null
  ): number
  createBasePromptAssembler(expectedInstance: DeepChatAgentInstance): BasePromptAssembler
  runPreStreamStep<T>(input: PreStreamStepInput, operation: () => Promise<T>): Promise<T>
  runSynchronousPreStreamStep<T>(sessionId: string, step: string, operation: () => T): T
  logSlowPreStreamStep(sessionId: string, step: string, startedAt: number): void
  startPreStreamProviderBoundaryWatchdog(
    input: PreStreamStepInput,
    preStreamStartedAt: number
  ): PreStreamBoundary
  runStreamForMessage(args: DeepChatLoopRunInput): Promise<{ runId: string; result: ProcessResult }>
  emitMessageRefresh(sessionId: string, messageId: string): void
  resolveStreamRequestId(sessionId: string, messageId: string): string
  dispatchHook(event: RuntimeHookEvent, context: RuntimeHookContext): void
  dispatchTerminalHooks(
    sessionId: string,
    state: DeepChatSessionState | undefined,
    result: ProcessResult
  ): void
  applyProcessResultStatus(
    sessionId: string,
    result: ProcessResult | null | undefined,
    runId?: string
  ): void
  clearActiveGeneration(sessionId: string, runId: string): void
  settleAbortedTurn(
    sessionId: string,
    messageId: string | null,
    runId?: string,
    metadata?: string
  ): void
  drainPendingQueueIfPossible(sessionId: string, reason: 'enqueue' | 'completed'): Promise<boolean>
}

export class TurnCoordinator {
  constructor(private readonly ports: TurnCoordinatorPorts) {}

  private async prepareTurnResources(input: {
    sessionId: string
    messageId?: string | null
    instance: DeepChatAgentInstance
    signal: AbortSignal
    projectDir: string | null
    runtimeActivatedSkillNames?: string[]
  }) {
    const { sessionId, messageId, instance, signal, projectDir } = input
    const state = instance.getRuntimeState()
    if (!state) throw new Error(`Session ${sessionId} not found`)

    this.ports.throwIfAbortRequested(signal)
    const generationSettings = await this.ports.runPreStreamStep(
      { sessionId, messageId, step: 'generation-settings', signal },
      () =>
        awaitWithAbort(
          this.ports.getEffectiveSessionGenerationSettings(sessionId, instance),
          signal
        )
    )
    const modelConfig = this.ports.configPresenter.getModelConfig(state.modelId, state.providerId)
    const useContextBudget = this.ports.shouldUseDeepChatContextBudget(
      state.providerId,
      modelConfig,
      state.modelId
    )
    this.ports.throwIfAbortRequested(signal)
    const interleavedReasoning = resolveInterleavedReasoningConfig(
      this.ports.configPresenter,
      state.providerId,
      state.modelId,
      generationSettings
    )
    const contextBudgetLength = this.ports.resolveDeepChatContextBudgetLength(
      state.providerId,
      generationSettings.contextLength,
      modelConfig,
      state.modelId
    )
    const maxTokens = capAgentRequestMaxTokens(generationSettings.maxTokens, contextBudgetLength)
    if (input.runtimeActivatedSkillNames) {
      instance.replaceRuntimeActivatedSkills(input.runtimeActivatedSkillNames)
    }
    const sessionActiveSkillNames = await this.ports.runPreStreamStep(
      { sessionId, messageId, step: 'active-skills', signal },
      () =>
        awaitWithAbort(
          this.ports.toolResolver.resolveActiveSkillNamesForToolProfile(sessionId, instance),
          signal
        )
    )
    this.ports.throwIfStaleDeepChatInstance(sessionId, instance)
    const activeSkillNames = resolveEffectiveActiveSkillNames(sessionActiveSkillNames, instance)
    const tools = await this.ports.runPreStreamStep(
      { sessionId, messageId, step: 'tool-definitions', signal },
      () =>
        awaitWithAbort(
          this.ports.toolResolver.loadToolDefinitionsForSession(
            sessionId,
            projectDir,
            activeSkillNames,
            instance
          ),
          signal
        )
    )
    const toolReserveTokens = estimateToolReserveTokens(tools)
    this.ports.throwIfAbortRequested(signal)
    const basePromptAssembler = this.ports.createBasePromptAssembler(instance)
    const baseSystemPrompt = await this.ports.runPreStreamStep(
      { sessionId, messageId, step: 'system-prompt', signal },
      () =>
        awaitWithAbort(
          basePromptAssembler.assemble({
            sessionId: toAppSessionId(sessionId),
            configuredPrompt: generationSettings.systemPrompt,
            toolDefinitions: tools,
            activeSkillNames
          }),
          signal
        )
    )
    this.ports.throwIfAbortRequested(signal)

    return {
      generationSettings,
      useContextBudget,
      interleavedReasoning,
      contextBudgetLength,
      maxTokens,
      activeSkillNames,
      tools,
      toolReserveTokens,
      basePromptAssembler,
      baseSystemPrompt
    }
  }

  async start(
    sessionId: string,
    content: string | SendMessageInput,
    context?: {
      projectDir?: string | null
      emitRefreshBeforeStream?: boolean
      pendingQueueItemId?: string
      pendingQueueItemSource?: ProcessPendingInputSource
      maxProviderRounds?: number
    }
  ): Promise<MessageStartResult> {
    const instance = this.ports.getHydratedDeepChatInstance(sessionId)
    if (!instance) throw new Error(`Session ${sessionId} not found`)
    const state = instance.getRuntimeState()
    if (!state) throw new Error(`Session ${sessionId} not found`)
    if (this.ports.hasPendingInteractions(sessionId)) {
      throw new Error('Pending tool interactions must be resolved before sending a new message.')
    }

    const normalizedInput = normalizeUserMessageInput(content)
    if (!normalizedInput.text.trim() && (normalizedInput.files?.length ?? 0) === 0) {
      throw new Error('Message cannot be empty.')
    }
    const supportsVision = this.ports.supportsVision(state.providerId, state.modelId)
    const supportsAudioInput = this.ports.supportsAudioInput(state.providerId, state.modelId)
    const projectDir = this.ports.resolveProjectDir(sessionId, context?.projectDir, instance)
    logger.info(
      `[DeepChatAgent] processMessage session=${sessionId} promptLength=${normalizedInput.text.length} fileCount=${normalizedInput.files?.length ?? 0} hasProjectDir=${projectDir !== null}`
    )

    this.ports.setSessionStatus(sessionId, 'generating')
    const preStreamAbortController = this.ports.ensureSessionAbortController(sessionId)
    const preStreamAbortSignal = preStreamAbortController.signal
    const pendingInputSource: ProcessPendingInputSource = context?.pendingQueueItemSource ?? 'send'
    let consumedPendingQueueItem = false
    let userMessageId: string | null = null
    let assistantMessageId: string | null = null
    let streamRunId: string | undefined

    try {
      const preStreamStartedAt = Date.now()
      const {
        generationSettings,
        useContextBudget,
        interleavedReasoning,
        contextBudgetLength,
        maxTokens,
        activeSkillNames: effectiveActiveSkillNames,
        tools,
        toolReserveTokens,
        basePromptAssembler,
        baseSystemPrompt
      } = await this.prepareTurnResources({
        sessionId,
        messageId: userMessageId,
        instance,
        signal: preStreamAbortSignal,
        projectDir,
        runtimeActivatedSkillNames: normalizedInput.activeSkills ?? []
      })
      const userContent: UserMessageContent = {
        text: normalizedInput.text,
        files: normalizedInput.files || [],
        links: [],
        search: false,
        think: false,
        ...(normalizedInput.activeSkills?.length
          ? { activeSkills: normalizedInput.activeSkills }
          : {}),
        ...(normalizedInput.inlineItems?.length ? { inlineItems: normalizedInput.inlineItems } : {})
      }

      const preparedInput = await this.ports.inputPreparationCoordinator.prepareInitial({
        ensureHistory: () =>
          this.ports.runSynchronousPreStreamStep(sessionId, 'tape-ready', () =>
            getTapeContextHistoryRecords(
              this.ports.tapeService.ensureSessionTapeReady(sessionId, this.ports.messageStore)
                .historyRecords
            )
          ),
        prepareIntent: async (historyRecords) => {
          if (!useContextBudget) {
            return null
          }
          return await this.ports.runPreStreamStep(
            {
              sessionId,
              messageId: userMessageId,
              step: 'compaction-prepare',
              signal: preStreamAbortSignal
            },
            () =>
              this.ports.compactionService.prepareForNextUserTurn({
                sessionId,
                providerId: state.providerId,
                modelId: state.modelId,
                systemPrompt: baseSystemPrompt,
                contextLength: generationSettings.contextLength,
                reserveTokens: maxTokens,
                extraReserveTokens: toolReserveTokens,
                supportsVision,
                supportsAudioInput,
                preserveInterleavedReasoning: interleavedReasoning.preserveReasoningContent,
                preserveEmptyInterleavedReasoning:
                  interleavedReasoning.preserveEmptyReasoningContent === true,
                newUserContent: normalizedInput,
                historyRecords,
                signal: preStreamAbortSignal
              })
          )
        },
        createCompactionProjection: (intent) =>
          this.ports.messageStore.createCompactionMessage(
            sessionId,
            this.ports.messageStore.getNextOrderSeq(sessionId),
            'compacting',
            intent.previousState.summaryUpdatedAt
          ),
        appendUserFact: () =>
          this.ports.runSynchronousPreStreamStep(sessionId, 'user-message-create', () =>
            this.ports.messageStore.createUserMessage(
              sessionId,
              this.ports.messageStore.getNextOrderSeq(sessionId),
              userContent
            )
          ),
        beginCompaction: (intent) => {
          this.ports.compactionRuntimeCoordinator.emit(
            sessionId,
            {
              status: 'compacting',
              cursorOrderSeq: intent.targetCursorOrderSeq,
              summaryUpdatedAt: intent.previousState.summaryUpdatedAt
            },
            instance
          )
        },
        applyCompaction: async (intent, compactionMessageId) =>
          await this.ports.runPreStreamStep(
            {
              sessionId,
              messageId: userMessageId,
              step: 'compaction-apply',
              signal: preStreamAbortSignal
            },
            () =>
              this.ports.compactionRuntimeCoordinator.apply(
                sessionId,
                intent,
                {
                  compactionMessageId,
                  startedExternally: true,
                  signal: preStreamAbortSignal
                },
                instance
              )
          ),
        readSummary: () => this.ports.sessionStore.getSummaryState(sessionId),
        afterCompactionApplyReturned: (intent) =>
          this.ports.memoryIngestionObserver.afterCompactionApplyReturned({
            session: instance.getMemorySessionHandle(),
            origin: 'initial',
            targetCursorOrderSeq: intent.targetCursorOrderSeq
          }),
        checkpoints: {
          assertCurrent: () => this.ports.throwIfStaleDeepChatInstance(sessionId, instance)
        }
      })
      const historyRecords = preparedInput.history
      const summaryState = preparedInput.summary
      userMessageId = preparedInput.userMessageId
      if (!userMessageId) {
        throw new Error('Failed to create user message.')
      }
      this.ports.throwIfAbortRequested(preStreamAbortSignal)
      this.ports.emitMessageRefresh(sessionId, userMessageId)

      this.ports.dispatchHook('UserPromptSubmit', {
        sessionId,
        messageId: userMessageId,
        promptPreview: normalizedInput.text,
        providerId: state.providerId,
        modelId: state.modelId,
        projectDir
      })

      const preparedContext = await this.ports.contextCoordinator.assemble({
        assemblePostCompactionPrompt: async () => {
          return await this.ports.runPreStreamStep(
            {
              sessionId,
              messageId: userMessageId,
              step: 'memory-injection',
              signal: preStreamAbortSignal
            },
            () =>
              awaitWithAbort(
                this.ports.postCompactionPromptAssembler.assemble({
                  memorySession: instance.getMemorySessionHandle(),
                  basePrompt: baseSystemPrompt,
                  summaryText: summaryState.summaryText,
                  reconstructionAnchor:
                    this.ports.sessionStore.getReconstructionAnchorPromptState(sessionId),
                  memoryQuery: normalizedInput.text,
                  memoryMessageId: userMessageId
                }),
                preStreamAbortSignal
              )
          )
        },
        buildView: (systemPrompt) => {
          const contextBuildStartedAt = Date.now()
          const contextBuild = buildTapeChatView({
            sessionId,
            newUserContent: normalizedInput,
            systemPrompt,
            contextLength: contextBudgetLength,
            reserveTokens: maxTokens,
            messageStore: this.ports.messageStore,
            supportsVision,
            historyRecords,
            options: {
              summaryCursorOrderSeq: summaryState.summaryCursorOrderSeq,
              supportsAudioInput,
              extraReserveTokens: toolReserveTokens,
              preserveInterleavedReasoning: interleavedReasoning.preserveReasoningContent,
              preserveEmptyInterleavedReasoning:
                interleavedReasoning.preserveEmptyReasoningContent === true
            }
          })
          this.ports.logSlowPreStreamStep(sessionId, 'context-build', contextBuildStartedAt)
          return contextBuild
        },
        assertCurrent: () => this.ports.throwIfStaleDeepChatInstance(sessionId, instance)
      })
      const contextBuild = preparedContext.view
      const messages = contextBuild.messages

      const assistantOrderSeq = this.ports.messageStore.getNextOrderSeq(sessionId)
      this.ports.throwIfStaleDeepChatInstance(sessionId, instance)
      assistantMessageId = this.ports.runSynchronousPreStreamStep(
        sessionId,
        'assistant-message-create',
        () => this.ports.messageStore.createAssistantMessage(sessionId, assistantOrderSeq)
      )
      this.ports.toolPresenter?.clearAgentPlanState?.(sessionId)
      this.ports.throwIfAbortRequested(preStreamAbortSignal)

      if (context?.pendingQueueItemId && pendingInputSource === 'send') {
        this.ports.pendingInputCoordinator.consumeQueuedInput(sessionId, context.pendingQueueItemId)
        consumedPendingQueueItem = true
      }

      if (context?.emitRefreshBeforeStream) {
        this.ports.emitMessageRefresh(sessionId, assistantMessageId)
      }

      this.ports.throwIfStaleDeepChatInstance(sessionId, instance)
      const providerBoundary = this.ports.startPreStreamProviderBoundaryWatchdog(
        {
          sessionId,
          messageId: assistantMessageId,
          step: 'pre-stream-provider-start',
          signal: preStreamAbortSignal
        },
        preStreamStartedAt
      )
      let streamResult: { runId: string; result: ProcessResult }
      try {
        streamResult = await this.ports.runStreamForMessage({
          sessionId,
          messageId: assistantMessageId,
          messages,
          projectDir,
          promptPreview: normalizedInput.text,
          tools,
          baseSystemPrompt,
          resourceInstance: instance,
          abortController: preStreamAbortController,
          maxProviderRounds: context?.maxProviderRounds,
          refreshSystemPrompt: async (activeSkillNames, refreshedTools) => {
            const refreshedBasePrompt = await basePromptAssembler.assemble({
              sessionId: toAppSessionId(sessionId),
              configuredPrompt: generationSettings.systemPrompt,
              toolDefinitions: refreshedTools,
              activeSkillNames: activeSkillNames ?? effectiveActiveSkillNames
            })
            return await this.ports.postCompactionPromptAssembler.assemble({
              memorySession: instance.getMemorySessionHandle(),
              basePrompt: refreshedBasePrompt,
              summaryText: summaryState.summaryText,
              reconstructionAnchor:
                this.ports.sessionStore.getReconstructionAnchorPromptState(sessionId),
              memoryQuery: normalizedInput.text,
              memoryMessageId: userMessageId
            })
          },
          interleavedReasoning,
          viewContext: {
            taskType: 'chat',
            policy: contextBuild.policyId,
            policyVersion: contextBuild.policyVersion,
            selection: buildTapeViewSelection(contextBuild.metadata, userMessageId),
            summaryCursorOrderSeq: summaryState.summaryCursorOrderSeq,
            supportsVision,
            supportsAudioInput,
            traceDebugEnabled:
              this.ports.configPresenter.getSetting<boolean>('traceDebugEnabled') === true
          },
          onBeforeProviderStream: providerBoundary.complete,
          onRunRegistered: (runId) => {
            streamRunId = runId
          }
        })
      } finally {
        providerBoundary.cancel()
      }
      const { runId, result } = streamResult
      streamRunId = runId
      if (context?.pendingQueueItemId && !consumedPendingQueueItem) {
        if (pendingInputSource === 'queue' || pendingInputSource === 'steer') {
          // An aborted queue/steer turn keeps its partial output and is consumed (not rolled back),
          // so the queue advances to the next item instead of re-running this one. Only genuine
          // errors roll the claim back to the waiting lane.
          if (
            result.status === 'completed' ||
            result.status === 'paused' ||
            result.status === 'aborted'
          ) {
            this.consumeClaimedPendingInput(
              sessionId,
              context.pendingQueueItemId,
              pendingInputSource
            )
            consumedPendingQueueItem = true
          } else {
            this.rollbackClaimedPendingInputTurn(
              sessionId,
              context.pendingQueueItemId,
              pendingInputSource,
              userMessageId,
              instance
            )
            consumedPendingQueueItem = true
          }
        } else {
          this.ports.pendingInputCoordinator.consumeQueuedInput(
            sessionId,
            context.pendingQueueItemId
          )
          consumedPendingQueueItem = true
        }
      }
      try {
        this.ports.applyProcessResultStatus(sessionId, result, runId)
      } finally {
        this.ports.clearActiveGeneration(sessionId, runId)
      }
      if (result?.status === 'completed') {
        void this.ports.drainPendingQueueIfPossible(sessionId, 'completed')
      } else if (result?.status === 'aborted') {
        // processStream owns terminal persistence once streaming starts. The lifecycle layer only
        // projects hooks/status and advances queued input after the returned abort.
        void this.ports.drainPendingQueueIfPossible(sessionId, 'completed')
      }
      if (result) {
        this.ports.memoryIngestionObserver.afterTurnSettled({
          session: instance.getMemorySessionHandle(),
          origin: 'initial',
          outcome: { kind: 'returned', status: result.status }
        })
      }
      return {
        requestId: assistantMessageId,
        messageId: assistantMessageId
      }
    } catch (err) {
      this.ports.memoryIngestionObserver.afterTurnSettled({
        session: instance.getMemorySessionHandle(),
        origin: 'initial',
        outcome: { kind: 'thrown', error: err }
      })
      if (this.ports.isStaleDeepChatInstanceError(err)) {
        return {
          requestId: assistantMessageId,
          messageId: assistantMessageId
        }
      }
      console.error('[DeepChatAgent] processMessage error:', err)
      const aborted = this.ports.isAbortError(err) || preStreamAbortSignal.aborted
      if (context?.pendingQueueItemId && !consumedPendingQueueItem) {
        try {
          if (pendingInputSource === 'queue' || pendingInputSource === 'steer') {
            // Abort keeps the partial turn and consumes the claim so the queue advances; only genuine
            // errors roll the claim back to the waiting lane.
            if (aborted) {
              this.consumeClaimedPendingInput(
                sessionId,
                context.pendingQueueItemId,
                pendingInputSource
              )
            } else {
              this.rollbackClaimedPendingInputTurn(
                sessionId,
                context.pendingQueueItemId,
                pendingInputSource,
                userMessageId,
                instance
              )
            }
          } else {
            this.releaseClaimedPendingInput(
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
        if (userMessageId) {
          this.ports.emitMessageRefresh(sessionId, userMessageId)
        }
        this.ports.clearSessionAbortController(sessionId, preStreamAbortController)
        const abortMetadata = stampTerminalMetadata(
          {
            ...(streamRunId ? { runId: streamRunId } : {}),
            provider: state.providerId,
            model: state.modelId,
            providerRounds: 0,
            toolCalls: 0
          },
          'aborted',
          'user_stop'
        )
        this.ports.settleAbortedTurn(
          sessionId,
          assistantMessageId,
          streamRunId,
          JSON.stringify(abortMetadata)
        )
        // Stop/steer: continue the queue automatically with the next item (steer items first).
        void this.ports.drainPendingQueueIfPossible(sessionId, 'completed')
        return {
          requestId: assistantMessageId,
          messageId: assistantMessageId
        }
      }
      const errorMessage = err instanceof Error ? err.message : String(err)
      const stopReason = isContextWindowErrorLike(err) ? 'context_window' : 'pre_stream_error'
      const terminalMetadata = stampTerminalMetadata(
        {
          ...(streamRunId ? { runId: streamRunId } : {}),
          provider: state.providerId,
          model: state.modelId,
          providerRounds: 0,
          toolCalls: 0
        },
        'error',
        stopReason
      )
      if (assistantMessageId) {
        const existingAssistant = this.ports.messageStore.getMessage(assistantMessageId)
        const blocks = buildTerminalErrorBlocks(
          existingAssistant ? parseAssistantBlocks(existingAssistant.content) : [],
          errorMessage
        )
        this.ports.messageStore.setMessageError(
          assistantMessageId,
          blocks,
          JSON.stringify(terminalMetadata)
        )
        this.ports.emitMessageRefresh(sessionId, assistantMessageId)
        publishDeepchatEvent('chat.stream.failed', {
          requestId: this.ports.resolveStreamRequestId(sessionId, assistantMessageId),
          sessionId,
          messageId: assistantMessageId,
          failedAt: Date.now(),
          error: errorMessage
        })
      }
      this.ports.dispatchHook('Stop', {
        sessionId,
        providerId: state.providerId,
        modelId: state.modelId,
        projectDir,
        stop: { reason: stopReason, userStop: false }
      })
      this.ports.dispatchHook('SessionEnd', {
        sessionId,
        providerId: state.providerId,
        modelId: state.modelId,
        projectDir,
        usage: buildUsageFromMetadata(terminalMetadata) ?? null,
        error: { message: errorMessage }
      })
      this.ports.setSessionStatus(sessionId, 'error')
      return {
        requestId: assistantMessageId,
        messageId: assistantMessageId
      }
    } finally {
      this.ports.clearSessionAbortController(sessionId, preStreamAbortController)
      instance.replaceRuntimeActivatedSkills([])
    }
  }

  async resume(
    sessionId: string,
    messageId: string,
    initialBlocks: AssistantMessageBlock[],
    budgetToolCall?: ResumeBudgetToolCall | null,
    initialAccounting?: MessageMetadata
  ): Promise<boolean> {
    const instance = this.ports.getDeepChatInstance(sessionId)
    if (!instance.tryBeginResume(messageId)) {
      return false
    }
    let preStreamAbortController: AbortController | null = null
    let preStreamAbortSignal: AbortSignal | undefined
    let streamRunId: string | undefined
    const resumeAccounting =
      initialAccounting ??
      parseMessageMetadata(this.ports.messageStore.getMessage(messageId)?.metadata ?? '{}')

    try {
      this.ports.throwIfStaleDeepChatInstance(sessionId, instance)
      const state = instance.getRuntimeState()
      if (!state) {
        throw new Error(`Session ${sessionId} not found`)
      }

      this.ports.setSessionStatusForInstance(sessionId, instance, 'generating')
      preStreamAbortController = this.ports.ensureSessionAbortController(sessionId)
      preStreamAbortSignal = preStreamAbortController.signal
      const preStreamStartedAt = Date.now()
      const supportsVision = this.ports.supportsVision(state.providerId, state.modelId)
      const supportsAudioInput = this.ports.supportsAudioInput(state.providerId, state.modelId)
      const projectDir = this.ports.resolveProjectDir(sessionId, undefined, instance)
      const {
        generationSettings,
        useContextBudget,
        interleavedReasoning,
        contextBudgetLength,
        maxTokens,
        tools,
        toolReserveTokens,
        baseSystemPrompt
      } = await this.prepareTurnResources({
        sessionId,
        messageId,
        instance,
        signal: preStreamAbortSignal,
        projectDir
      })
      let resumeTargetOrderSeq: number | undefined
      const preparedInput = await this.ports.inputPreparationCoordinator.prepareExisting({
        ensureHistory: () =>
          this.ports.runSynchronousPreStreamStep(
            sessionId,
            'tape-ready',
            () =>
              this.ports.tapeService.ensureSessionTapeReady(sessionId, this.ports.messageStore)
                .historyRecords
          ),
        refreshHistory: () =>
          this.ports.runSynchronousPreStreamStep(
            sessionId,
            'tape-ready',
            () =>
              this.ports.tapeService.ensureSessionTapeReady(sessionId, this.ports.messageStore)
                .historyRecords
          ),
        prepareIntent: async (historyRecords) => {
          resumeTargetOrderSeq =
            historyRecords.find((record) => record.id === messageId)?.orderSeq ??
            this.ports.messageStore.getMessage(messageId)?.orderSeq
          if (!useContextBudget) {
            return null
          }
          return await this.ports.runPreStreamStep(
            { sessionId, messageId, step: 'compaction-prepare', signal: preStreamAbortSignal },
            () =>
              this.ports.compactionService.prepareForResumeTurn({
                sessionId,
                messageId,
                providerId: state.providerId,
                modelId: state.modelId,
                systemPrompt: baseSystemPrompt,
                contextLength: generationSettings.contextLength,
                reserveTokens: maxTokens,
                extraReserveTokens: toolReserveTokens,
                supportsVision,
                supportsAudioInput,
                preserveInterleavedReasoning: interleavedReasoning.preserveReasoningContent,
                preserveEmptyInterleavedReasoning:
                  interleavedReasoning.preserveEmptyReasoningContent === true,
                historyRecords,
                signal: preStreamAbortSignal
              })
          )
        },
        applyCompaction: async (intent) =>
          await this.ports.runPreStreamStep(
            {
              sessionId,
              messageId,
              step: 'compaction-apply',
              signal: preStreamAbortSignal
            },
            () =>
              this.ports.compactionRuntimeCoordinator.apply(
                sessionId,
                intent,
                {
                  compactionMessageOrderSeq: resumeTargetOrderSeq,
                  shiftMessagesFromCompactionOrderSeq: resumeTargetOrderSeq !== undefined,
                  signal: preStreamAbortSignal
                },
                instance
              )
          ),
        readSummary: () => this.ports.sessionStore.getSummaryState(sessionId),
        checkpoints: {
          assertCurrent: () => this.ports.throwIfStaleDeepChatInstance(sessionId, instance),
          beforeHistoryRefresh: () => {
            this.ports.throwIfStaleDeepChatInstance(sessionId, instance)
            this.ports.throwIfAbortRequested(preStreamAbortSignal)
          }
        }
      })
      const summaryState = preparedInput.summary
      this.ports.throwIfAbortRequested(preStreamAbortSignal)
      const preparedContext = await this.ports.contextCoordinator.assemble({
        assemblePostCompactionPrompt: async () =>
          await this.ports.runPreStreamStep(
            { sessionId, messageId, step: 'memory-injection', signal: preStreamAbortSignal },
            () =>
              awaitWithAbort(
                this.ports.postCompactionPromptAssembler.assemble({
                  memorySession: instance.getMemorySessionHandle(),
                  basePrompt: baseSystemPrompt,
                  summaryText: summaryState.summaryText,
                  reconstructionAnchor:
                    this.ports.sessionStore.getReconstructionAnchorPromptState(sessionId),
                  memoryQuery: this.ports.memoryCoordinator.getLatestUserQuery(sessionId),
                  memoryMessageId: messageId
                }),
                preStreamAbortSignal
              )
          ),
        buildView: (systemPrompt) => {
          const contextBuildStartedAt = Date.now()
          const contextBuild = buildTapeResumeView({
            sessionId,
            assistantMessageId: messageId,
            systemPrompt,
            contextLength: contextBudgetLength,
            reserveTokens: maxTokens,
            messageStore: this.ports.messageStore,
            supportsVision,
            historyRecords: preparedInput.history,
            options: {
              summaryCursorOrderSeq: summaryState.summaryCursorOrderSeq,
              fallbackProtectedTurnCount: 1,
              supportsAudioInput,
              extraReserveTokens: toolReserveTokens,
              preserveInterleavedReasoning: interleavedReasoning.preserveReasoningContent,
              preserveEmptyInterleavedReasoning:
                interleavedReasoning.preserveEmptyReasoningContent === true
            }
          })
          this.ports.logSlowPreStreamStep(sessionId, 'context-build', contextBuildStartedAt)
          return contextBuild
        },
        assertCurrent: () => this.ports.throwIfStaleDeepChatInstance(sessionId, instance)
      })
      const resumeContextBuild = preparedContext.view
      let resumeContext = resumeContextBuild.messages
      if (budgetToolCall?.id && budgetToolCall.name && useContextBudget) {
        const resumeBudget = this.fitResumeBudgetForToolCall({
          resumeContext,
          toolDefinitions: tools,
          contextLength: generationSettings.contextLength,
          maxTokens,
          toolCallId: budgetToolCall.id,
          toolName: budgetToolCall.name
        })

        if (resumeBudget?.kind === 'tool_error') {
          await this.ports.runPreStreamStep(
            { sessionId, messageId, step: 'tool-output-cleanup' },
            () => this.ports.toolOutputGuard.cleanupOffloadedOutput(budgetToolCall.offloadPath)
          )
          this.ports.throwIfStaleDeepChatInstance(sessionId, instance)
          updateToolCallResponse(initialBlocks, budgetToolCall.id, resumeBudget.message, true)
          this.ports.messageStore.updateAssistantContent(messageId, initialBlocks)
          this.ports.emitMessageRefresh(sessionId, messageId)
          resumeContext = this.ports.toolOutputGuard.replaceToolMessageContent(
            resumeContext,
            budgetToolCall.id,
            resumeBudget.message
          )
        } else if (resumeBudget?.kind === 'terminal_error') {
          await this.ports.runPreStreamStep(
            { sessionId, messageId, step: 'tool-output-cleanup' },
            () => this.ports.toolOutputGuard.cleanupOffloadedOutput(budgetToolCall.offloadPath)
          )
          this.ports.throwIfStaleDeepChatInstance(sessionId, instance)
          updateToolCallResponse(initialBlocks, budgetToolCall.id, resumeBudget.message, true)
          const terminalMetadata = stampTerminalMetadata(
            resumeAccounting,
            'error',
            'context_window'
          )
          this.ports.messageStore.setMessageError(
            messageId,
            initialBlocks,
            JSON.stringify(terminalMetadata)
          )
          this.ports.emitMessageRefresh(sessionId, messageId)
          publishDeepchatEvent('chat.stream.failed', {
            requestId: this.ports.resolveStreamRequestId(sessionId, messageId),
            sessionId,
            messageId,
            failedAt: Date.now(),
            error: resumeBudget.message
          })
          this.ports.dispatchTerminalHooks(sessionId, state, {
            status: 'error',
            stopReason: 'context_window',
            errorMessage: resumeBudget.message,
            usage: buildUsageFromMetadata(terminalMetadata)
          })
          this.ports.setSessionStatus(sessionId, 'error')
          this.ports.memoryIngestionObserver.afterTurnSettled({
            session: instance.getMemorySessionHandle(),
            origin: 'resume',
            outcome: { kind: 'returned', status: 'error' }
          })
          return false
        }
      }

      this.ports.throwIfAbortRequested(preStreamAbortSignal)
      this.ports.throwIfStaleDeepChatInstance(sessionId, instance)
      const providerBoundary = this.ports.startPreStreamProviderBoundaryWatchdog(
        {
          sessionId,
          messageId,
          step: 'pre-stream-provider-start',
          signal: preStreamAbortSignal
        },
        preStreamStartedAt
      )
      let streamResult: { runId: string; result: ProcessResult }
      try {
        streamResult = await this.ports.runStreamForMessage({
          sessionId,
          messageId,
          messages: resumeContext,
          projectDir,
          resourceInstance: instance,
          abortController: preStreamAbortController,
          tools,
          baseSystemPrompt,
          initialBlocks,
          initialAccounting: resumeAccounting,
          maxProviderRounds: resumeAccounting.maxProviderRounds,
          interleavedReasoning,
          viewContext: {
            taskType: 'resume',
            policy: resumeContextBuild.policyId,
            policyVersion: resumeContextBuild.policyVersion,
            selection: buildTapeViewSelection(resumeContextBuild.metadata),
            summaryCursorOrderSeq: summaryState.summaryCursorOrderSeq,
            supportsVision,
            supportsAudioInput,
            traceDebugEnabled:
              this.ports.configPresenter.getSetting<boolean>('traceDebugEnabled') === true
          },
          onBeforeProviderStream: providerBoundary.complete,
          onRunRegistered: (runId) => {
            streamRunId = runId
          }
        })
      } finally {
        providerBoundary.cancel()
      }
      const { runId, result } = streamResult
      streamRunId = runId
      try {
        this.ports.applyProcessResultStatus(sessionId, result, runId)
      } finally {
        this.ports.clearActiveGeneration(sessionId, runId)
      }
      if (result?.status === 'completed' || result?.status === 'aborted') {
        void this.ports.drainPendingQueueIfPossible(sessionId, 'completed')
      }
      if (result) {
        this.ports.memoryIngestionObserver.afterTurnSettled({
          session: instance.getMemorySessionHandle(),
          origin: 'resume',
          outcome: { kind: 'returned', status: result.status }
        })
      }
      return true
    } catch (error) {
      this.ports.memoryIngestionObserver.afterTurnSettled({
        session: instance.getMemorySessionHandle(),
        origin: 'resume',
        outcome: { kind: 'thrown', error }
      })
      if (this.ports.isStaleDeepChatInstanceError(error)) {
        return false
      }
      console.error('[DeepChatAgent] resumeAssistantMessage error:', error)
      if (this.ports.isAbortError(error) || preStreamAbortSignal?.aborted) {
        this.ports.clearSessionAbortController(sessionId, preStreamAbortController ?? undefined)
        this.ports.settleAbortedTurn(
          sessionId,
          messageId,
          streamRunId,
          JSON.stringify(
            stampTerminalMetadata(resumeAccounting, 'aborted', 'user_stop', streamRunId)
          )
        )
        // Stop/steer: continue the queue automatically with the next item (steer items first).
        void this.ports.drainPendingQueueIfPossible(sessionId, 'completed')
        return false
      }
      const errorMessage = error instanceof Error ? error.message : String(error)
      const stopReason = isContextWindowErrorLike(error) ? 'context_window' : 'pre_stream_error'
      const terminalMetadata = stampTerminalMetadata(
        resumeAccounting,
        'error',
        stopReason,
        streamRunId
      )
      const blocks = buildTerminalErrorBlocks(initialBlocks, errorMessage)
      this.ports.messageStore.setMessageError(messageId, blocks, JSON.stringify(terminalMetadata))
      this.ports.emitMessageRefresh(sessionId, messageId)
      publishDeepchatEvent('chat.stream.failed', {
        requestId: this.ports.resolveStreamRequestId(sessionId, messageId),
        sessionId,
        messageId,
        failedAt: Date.now(),
        error: errorMessage
      })
      this.ports.dispatchTerminalHooks(sessionId, this.ports.getRuntimeState(sessionId), {
        status: 'error',
        stopReason,
        errorMessage,
        usage: buildUsageFromMetadata(terminalMetadata)
      })
      this.ports.setSessionStatus(sessionId, 'error')
      throw error
    } finally {
      this.ports.clearSessionAbortController(sessionId, preStreamAbortController ?? undefined)
      instance.finishResume(messageId)
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
      this.ports.toolOutputGuard.hasContextBudget({
        conversationMessages: params.resumeContext,
        toolDefinitions: params.toolDefinitions,
        contextLength: params.contextLength,
        maxTokens: params.maxTokens
      })
    ) {
      return null
    }

    return this.ports.toolOutputGuard.fitToolError({
      conversationMessages: params.resumeContext,
      toolDefinitions: params.toolDefinitions,
      contextLength: params.contextLength,
      maxTokens: params.maxTokens,
      toolCallId: params.toolCallId,
      toolName: params.toolName,
      errorMessage: this.ports.toolOutputGuard.buildContextOverflowMessage(
        params.toolCallId,
        params.toolName
      ),
      mode: 'replace'
    })
  }

  rollbackClaimedPendingInputTurn(
    sessionId: string,
    pendingQueueItemId: string,
    pendingInputSource: ProcessPendingInputSource,
    userMessageId: string | null,
    expectedInstance = this.ports.getDeepChatInstance(sessionId)
  ): void {
    this.ports.throwIfStaleDeepChatInstance(sessionId, expectedInstance)
    const userMessage = userMessageId ? this.ports.messageStore.getMessage(userMessageId) : null
    if (userMessage) {
      this.ports.compactionRuntimeCoordinator.invalidateIfNeeded(
        sessionId,
        userMessage.orderSeq,
        expectedInstance
      )
      this.ports.memoryCoordinator.invalidateFromOrderSeq(sessionId, userMessage.orderSeq)
      this.ports.messageStore.deleteFromOrderSeq(sessionId, userMessage.orderSeq)
    }
    this.releaseClaimedPendingInput(sessionId, pendingQueueItemId, pendingInputSource)
  }

  private consumeClaimedPendingInput(
    sessionId: string,
    pendingInputId: string,
    pendingInputSource: ProcessPendingInputSource
  ): void {
    if (pendingInputSource === 'steer') {
      this.ports.pendingInputCoordinator.consumeSteerInput(sessionId, pendingInputId)
      return
    }
    this.ports.pendingInputCoordinator.consumeQueuedInput(sessionId, pendingInputId)
  }

  private releaseClaimedPendingInput(
    sessionId: string,
    pendingInputId: string,
    pendingInputSource: ProcessPendingInputSource
  ): void {
    if (pendingInputSource === 'steer') {
      this.ports.pendingInputCoordinator.releaseClaimedInput(sessionId, pendingInputId)
      return
    }
    this.ports.pendingInputCoordinator.releaseClaimedQueueInput(sessionId, pendingInputId)
  }
}
