import logger from '@shared/logger'
import type {
  AgentTapeAnchorResult,
  AgentTapeAnchorsOptions,
  AgentTapeContextOptions,
  AgentTapeContextResult,
  AgentTapeInfo,
  AgentTapeSearchOptions,
  AgentTapeSearchResult,
  ChatMessagePageResult,
  ChatMessageRecord,
  DeepChatSessionState,
  IAgentImplementation,
  MessagePageCursor,
  MessageStartResult,
  PendingSessionInputRecord,
  PermissionMode,
  QueuePendingInputOptions,
  SendMessageInput,
  SessionAgentContextUpdate,
  SessionCompactionState,
  SessionGenerationSettings,
  ToolInteractionResponse,
  ToolInteractionResult
} from '@shared/types/agent-interface'
import type {
  DeepChatTapeReplayExportOptions,
  DeepChatTapeReplaySlice
} from '@shared/types/tape-replay'
import type { DeepChatTapeViewManifestRecord } from '@shared/types/tape-view-manifest'
import type { IConfigPresenter, ILlmProviderPresenter, ISkillPresenter } from '@shared/presenter'
import type { IToolPresenter } from '@shared/types/presenters/tool.presenter'
import { eventBus } from '@/eventbus'
import { MCP_EVENTS } from '@/events'
import { publishDeepchatEvent } from '@/routes/publishDeepchatEvent'
import type { SQLitePresenter } from '../sqlitePresenter'
import type { MemoryRuntimePort } from '../memoryPresenter/injection'
import type { NewSessionHooksBridge } from '../hooksNotifications/newSessionBridge'
import type { ProviderCatalogPort, SessionPermissionPort, SessionUiPort } from '../runtimePorts'
import { CompactionService } from './compactionService'
import { GenerationControlService } from './generationControlService'
import { InteractionResumeService } from './interactionResumeService'
import { MemoryCompactionService } from './memoryCompactionService'
import { MessageHistoryService } from './messageHistoryService'
import { DeepChatMessageStore } from './messageStore'
import { PendingInputCoordinator } from './pendingInputCoordinator'
import { PendingInputService } from './pendingInputService'
import { DeepChatPendingInputStore } from './pendingInputStore'
import { RuntimeSharedState } from './runtimeSharedState'
import { SessionLifecycleService, type SessionInitialization } from './sessionLifecycleService'
import { SessionSettingsService } from './sessionSettingsService'
import { DeepChatSessionStore } from './sessionStore'
import { StreamLifecycleService, type StreamProcessMessageContext } from './streamLifecycleService'
import { AgentTapeAccessService } from './tapeAccessService'
import { DeepChatTapeService } from './tapeService'
import { ToolOutputGuard } from './toolOutputGuard'
import { TurnPreparationService } from './turnPreparationService'

type RuntimeSkillPresenter = Pick<
  ISkillPresenter,
  | 'getMetadataList'
  | 'getActiveSkills'
  | 'loadSkillContent'
  | 'viewDraftSkill'
  | 'installDraftSkill'
  | 'discardDraftSkill'
>

type AgentRuntimePorts = {
  providerCatalogPort?: Pick<ProviderCatalogPort, 'getProviderModels' | 'getCustomModels'>
  sessionPermissionPort?: SessionPermissionPort
  sessionUiPort?: SessionUiPort
  memoryPort?: MemoryRuntimePort
  cacheImage?: (data: string) => Promise<string>
  skillPresenter?: RuntimeSkillPresenter
}

/**
 * Compile-oriented target shape for AgentRuntimePresenter.
 *
 * The service callbacks below are intentionally lazy. They break construction-time dependency
 * cycles without sharing mutable service state or creating runtime imports between collaborators.
 * Participating service constructors must remain side-effect-free, only retain dependencies, and
 * never invoke these callbacks; runtime work starts after the complete service graph is wired.
 */
export class AgentRuntimePresenter implements IAgentImplementation {
  private readonly llmProviderPresenter: ILlmProviderPresenter
  private readonly configPresenter: IConfigPresenter
  private readonly sqlitePresenter: SQLitePresenter
  private readonly toolPresenter: IToolPresenter | null
  private readonly sessionPermissionPort?: SessionPermissionPort
  private readonly cacheImage?: (data: string) => Promise<string>
  private readonly skillPresenter?: RuntimeSkillPresenter

  private readonly runtimeSharedState: RuntimeSharedState
  private readonly sessionStore: DeepChatSessionStore
  private readonly messageStore: DeepChatMessageStore
  private readonly tapeService: DeepChatTapeService
  private readonly tapeAccessService: AgentTapeAccessService
  private readonly toolOutputGuard: ToolOutputGuard
  private readonly sessionSettingsService: SessionSettingsService
  private readonly generationControlService: GenerationControlService
  private readonly pendingInputService: PendingInputService
  private readonly compactionService: CompactionService
  private readonly memoryCompactionService: MemoryCompactionService
  private readonly turnPreparationService: TurnPreparationService
  private readonly streamLifecycleService: StreamLifecycleService
  private readonly interactionResumeService: InteractionResumeService
  private readonly sessionLifecycleService: SessionLifecycleService
  private readonly messageHistoryService: MessageHistoryService

  constructor(
    llmProviderPresenter: ILlmProviderPresenter,
    configPresenter: IConfigPresenter,
    sqlitePresenter: SQLitePresenter,
    toolPresenter?: IToolPresenter,
    hooksBridge?: NewSessionHooksBridge,
    runtimePorts?: AgentRuntimePorts
  ) {
    this.llmProviderPresenter = llmProviderPresenter
    this.configPresenter = configPresenter
    this.sqlitePresenter = sqlitePresenter
    this.toolPresenter = toolPresenter ?? null
    this.sessionPermissionPort = runtimePorts?.sessionPermissionPort
    this.cacheImage = runtimePorts?.cacheImage
    this.skillPresenter = runtimePorts?.skillPresenter

    this.runtimeSharedState = new RuntimeSharedState()
    this.sessionStore = new DeepChatSessionStore(sqlitePresenter)
    this.messageStore = new DeepChatMessageStore(sqlitePresenter)
    this.tapeService = new DeepChatTapeService(sqlitePresenter)
    this.tapeAccessService = new AgentTapeAccessService(this.tapeService, this.messageStore)
    this.toolOutputGuard = new ToolOutputGuard()

    const providerCatalogPort = runtimePorts?.providerCatalogPort ?? {
      getProviderModels: (providerId: string) =>
        this.configPresenter.getProviderModels?.(providerId) ?? [],
      getCustomModels: (providerId: string) =>
        this.configPresenter.getCustomModels?.(providerId) ?? []
    }

    this.sessionSettingsService = new SessionSettingsService(
      this.configPresenter,
      this.sessionStore,
      this.runtimeSharedState,
      {
        invalidateSystemPromptCache: (sessionId) =>
          this.turnPreparationService.invalidateSystemPromptCache(sessionId),
        invalidateToolProfileCache: (sessionId) =>
          this.turnPreparationService.invalidateToolProfileCache(sessionId)
      }
    )

    this.generationControlService = new GenerationControlService(
      this.runtimeSharedState,
      (sessionId) =>
        this.interactionResumeService.clearActiveProviderPermissionsForSession(sessionId)
    )

    const pendingInputStore = new DeepChatPendingInputStore(sqlitePresenter)
    const pendingInputCoordinator = new PendingInputCoordinator(pendingInputStore)
    this.pendingInputService = new PendingInputService(
      pendingInputCoordinator,
      this.runtimeSharedState,
      {
        getSessionState: (sessionId) => this.sessionLifecycleService.getSessionState(sessionId),
        resolveProjectDir: (sessionId, incoming) =>
          this.sessionLifecycleService.resolveProjectDir(sessionId, incoming),
        normalizeInput: (input) => this.turnPreparationService.normalizeUserMessageInput(input),
        isAwaitingToolQuestionFollowUp: (sessionId) =>
          this.interactionResumeService.isAwaitingToolQuestionFollowUp(sessionId),
        hasPendingInteractions: (sessionId) =>
          this.interactionResumeService.hasPendingInteractions(sessionId),
        getGenerationActivity: (sessionId) =>
          this.generationControlService.getGenerationActivity(sessionId),
        cancelGeneration: (sessionId) => this.generationControlService.cancelGeneration(sessionId),
        processMessage: (sessionId, input, context) =>
          this.streamLifecycleService.processMessage(sessionId, input, context),
        rollbackPersistedTurn: (sessionId, userMessageId) =>
          this.messageHistoryService.rollbackPersistedPendingInputTurn(sessionId, userMessageId)
      }
    )

    this.compactionService = new CompactionService(
      this.sessionStore,
      this.messageStore,
      this.llmProviderPresenter,
      this.configPresenter,
      async (sessionId) => {
        const agentId = this.sessionLifecycleService.getSessionAgentId(sessionId) ?? 'deepchat'
        return typeof this.configPresenter.resolveDeepChatAgentConfig === 'function'
          ? await this.configPresenter.resolveDeepChatAgentConfig(agentId)
          : {}
      }
    )

    this.memoryCompactionService = new MemoryCompactionService(
      {
        sqlitePresenter: this.sqlitePresenter,
        sessionStore: this.sessionStore,
        messageStore: this.messageStore,
        runtimeSharedState: this.runtimeSharedState,
        compactionService: this.compactionService,
        memoryPort: runtimePorts?.memoryPort
      },
      {
        getSessionAgentId: (sessionId) => this.sessionLifecycleService.getSessionAgentId(sessionId),
        getSessionListState: (sessionId) =>
          this.sessionLifecycleService.getSessionListState(sessionId),
        hasPendingInteractions: (sessionId) =>
          this.interactionResumeService.hasPendingInteractions(sessionId),
        supportsManualCompaction: (state) =>
          this.turnPreparationService.supportsManualCompaction(state),
        buildManualCompactionRequest: (sessionId, state, signal) =>
          this.turnPreparationService.buildManualCompactionRequest(sessionId, state, signal),
        setSessionStatus: (sessionId, status) =>
          this.sessionLifecycleService.setSessionStatus(sessionId, status),
        emitMessageRefresh: (sessionId, messageId) =>
          this.streamLifecycleService.emitMessageRefresh(sessionId, messageId)
      }
    )

    this.turnPreparationService = new TurnPreparationService(
      {
        configPresenter: this.configPresenter,
        toolPresenter: this.toolPresenter,
        sessionStore: this.sessionStore,
        messageStore: this.messageStore,
        tapeService: this.tapeService,
        compactionPort: this.memoryCompactionService,
        sessionSettingsService: this.sessionSettingsService,
        runtimeSharedState: this.runtimeSharedState,
        providerCatalogPort,
        skillPresenter: this.skillPresenter
      },
      {
        hasPendingInteractions: (sessionId) =>
          this.interactionResumeService.hasPendingInteractions(sessionId),
        resolveProjectDir: (sessionId, incoming) =>
          this.sessionLifecycleService.resolveProjectDir(sessionId, incoming),
        getSessionAgentId: (sessionId) => this.sessionLifecycleService.getSessionAgentId(sessionId),
        getSessionKind: (sessionId) =>
          this.sqlitePresenter.newSessionsTable?.get(sessionId)?.session_kind,
        getDisabledAgentTools: (sessionId) =>
          this.sqlitePresenter.newSessionsTable?.getDisabledAgentTools(sessionId) ?? [],
        applyCompactionIntent: (sessionId, intent, options) =>
          this.memoryCompactionService.applyCompactionIntent(sessionId, intent, options),
        emitCompactionState: (sessionId, state) =>
          this.memoryCompactionService.emitCompactionState(sessionId, state),
        triggerMemoryExtractionFromCompaction: (sessionId, intent) =>
          this.memoryCompactionService.triggerMemoryExtractionFromCompaction(sessionId, intent),
        appendMemoryInjection: (sessionId, prompt, query, messageId, signal) =>
          this.memoryCompactionService.appendMemoryInjection(
            sessionId,
            prompt,
            query,
            messageId,
            signal
          ),
        emitMessageRefresh: (sessionId, messageId) =>
          this.streamLifecycleService.emitMessageRefresh(sessionId, messageId),
        dispatchUserPromptSubmit: (context) =>
          this.streamLifecycleService.dispatchHook('UserPromptSubmit', context)
      }
    )

    this.streamLifecycleService = new StreamLifecycleService(
      {
        llmProviderPresenter: this.llmProviderPresenter,
        configPresenter: this.configPresenter,
        toolPresenter: this.toolPresenter,
        messageStore: this.messageStore,
        sessionStore: this.sessionStore,
        tapeService: this.tapeService,
        runtimeSharedState: this.runtimeSharedState,
        generationControlService: this.generationControlService,
        sessionSettingsService: this.sessionSettingsService,
        pendingInputService: this.pendingInputService,
        turnPreparationService: this.turnPreparationService,
        memoryCompactionService: this.memoryCompactionService,
        toolOutputGuard: this.toolOutputGuard,
        hooksBridge,
        cacheImage: this.cacheImage
      },
      {
        hasPendingInteractions: (sessionId) =>
          this.interactionResumeService.hasPendingInteractions(sessionId),
        resolveProjectDir: (sessionId, incoming) =>
          this.sessionLifecycleService.resolveProjectDir(sessionId, incoming),
        getSessionAgentId: (sessionId) => this.sessionLifecycleService.getSessionAgentId(sessionId),
        setSessionStatus: (sessionId, status) =>
          this.sessionLifecycleService.setSessionStatus(sessionId, status),
        markFirstTurnReady: (sessionId) =>
          this.sessionLifecycleService.markFirstTurnReady(sessionId),
        autoGrantPermission: (sessionId, permission) =>
          this.interactionResumeService.autoGrantPermission(sessionId, permission),
        reviewToolPermission: (request, context) =>
          this.interactionResumeService.reviewToolPermissionForAutoApprove(request, context),
        registerActiveProviderPermission: (
          sessionId,
          messageId,
          permission,
          tool,
          commitDecision
        ) =>
          this.interactionResumeService.registerActiveProviderPermission(
            sessionId,
            messageId,
            permission,
            tool,
            commitDecision
          ),
        normalizeToolResult: (input) =>
          this.interactionResumeService.normalizeToolResultContent(input)
      }
    )

    this.interactionResumeService = new InteractionResumeService({
      llmProviderPresenter: this.llmProviderPresenter,
      configPresenter: this.configPresenter,
      toolPresenter: this.toolPresenter,
      sessionPermissionPort: this.sessionPermissionPort,
      skillPresenter: this.skillPresenter,
      messageStore: this.messageStore,
      sessionStore: this.sessionStore,
      tapeService: this.tapeService,
      generationControlService: this.generationControlService,
      toolOutputGuard: this.toolOutputGuard,
      cacheImage: this.cacheImage,
      getRuntimeState: (sessionId) => this.runtimeSharedState.runtimeState.get(sessionId),
      getSessionState: (sessionId) => this.sessionLifecycleService.getSessionState(sessionId),
      getSessionAgentId: (sessionId) => this.sessionLifecycleService.getSessionAgentId(sessionId),
      resolveProjectDir: (sessionId) => this.sessionLifecycleService.resolveProjectDir(sessionId),
      setSessionStatus: (sessionId, status) =>
        this.sessionLifecycleService.setSessionStatus(sessionId, status),
      emitMessageRefresh: (sessionId, messageId) =>
        this.streamLifecycleService.emitMessageRefresh(sessionId, messageId),
      dispatchHook: (event, context) => this.streamLifecycleService.dispatchHook(event, context),
      publishStreamFailure: (payload) => publishDeepchatEvent('chat.stream.failed', payload),
      resolveStreamRequestId: (sessionId, messageId) =>
        this.streamLifecycleService.resolveStreamRequestId(sessionId, messageId),
      getEffectiveSessionGenerationSettings: (sessionId) =>
        this.sessionSettingsService.getEffectiveGenerationSettings(sessionId),
      shouldUseDeepChatContextBudget: (providerId, modelConfig, modelId) =>
        this.turnPreparationService.shouldUseDeepChatContextBudget(
          providerId,
          modelConfig,
          modelId
        ),
      resolveInterleavedReasoningConfig: (providerId, modelId, settings) =>
        this.turnPreparationService.resolveInterleavedReasoningConfig(
          providerId,
          modelId,
          settings
        ),
      resolveDeepChatContextBudgetLength: (providerId, contextLength, modelConfig, modelId) =>
        this.turnPreparationService.resolveDeepChatContextBudgetLength(
          providerId,
          contextLength,
          modelConfig,
          modelId
        ),
      resolveActiveSkillNamesForToolProfile: (sessionId) =>
        this.turnPreparationService.resolveActiveSkillNamesForToolProfile(sessionId),
      loadToolDefinitionsForSession: (sessionId, projectDir, activeSkillNames) =>
        this.turnPreparationService.loadToolDefinitionsForSession(
          sessionId,
          projectDir,
          activeSkillNames
        ),
      buildSystemPromptWithSkills: (sessionId, basePrompt, tools, activeSkillNames) =>
        this.turnPreparationService.buildSystemPromptWithSkills(
          sessionId,
          basePrompt,
          tools,
          activeSkillNames
        ),
      resolveAgentExtensionPolicy: (sessionId) =>
        this.turnPreparationService.resolveAgentExtensionPolicy(sessionId),
      getDisabledAgentTools: (sessionId) =>
        this.sqlitePresenter.newSessionsTable?.getDisabledAgentTools(sessionId) ?? [],
      supportsVision: (providerId, modelId) =>
        this.turnPreparationService.supportsVision(providerId, modelId),
      supportsAudioInput: (providerId, modelId) =>
        this.turnPreparationService.supportsAudioInput(providerId, modelId),
      resolveCompactionStateForResumeTurn: (input) =>
        this.memoryCompactionService.resolveCompactionStateForResumeTurn(input),
      appendMemoryInjection: (sessionId, prompt, query, messageId, signal) =>
        this.memoryCompactionService.appendMemoryInjection(
          sessionId,
          prompt,
          query,
          messageId,
          signal
        ),
      getLatestUserQuery: (sessionId) => this.memoryCompactionService.getLatestUserQuery(sessionId),
      runStreamForMessage: (args) => this.streamLifecycleService.runStreamForMessage(args),
      applyProcessResultStatus: (sessionId, result, runId) =>
        this.streamLifecycleService.applyProcessResultStatus(sessionId, result, runId),
      settleAbortedTurn: (sessionId, messageId, runId, metadata) =>
        this.streamLifecycleService.settleAbortedTurn(sessionId, messageId, runId, metadata),
      drainPendingQueueIfPossible: (sessionId, reason) =>
        this.pendingInputService.drainPendingQueueIfPossible(sessionId, reason),
      triggerMemoryExtractionFallback: (sessionId) =>
        this.memoryCompactionService.triggerMemoryExtractionFallback(sessionId),
      invalidateSystemPromptCache: (sessionId) =>
        this.turnPreparationService.invalidateSystemPromptCache(sessionId),
      invalidateToolProfileCache: (sessionId) =>
        this.turnPreparationService.invalidateToolProfileCache(sessionId)
    })

    this.sessionLifecycleService = new SessionLifecycleService(
      {
        sqlitePresenter: this.sqlitePresenter,
        sessionStore: this.sessionStore,
        messageStore: this.messageStore,
        runtimeSharedState: this.runtimeSharedState,
        sessionSettingsService: this.sessionSettingsService,
        generationControlService: this.generationControlService,
        sessionUiPort: runtimePorts?.sessionUiPort
      },
      {
        hasPendingInteractions: (sessionId) =>
          this.interactionResumeService.hasPendingInteractions(sessionId),
        destroyPendingInputs: (sessionId) => this.pendingInputService.destroySession(sessionId),
        initializeMemoryCompactionSession: (sessionId) =>
          this.memoryCompactionService.initializeSession(sessionId),
        destroyMemoryCompactionSession: (sessionId) =>
          this.memoryCompactionService.destroySession(sessionId),
        invalidateSystemPromptCache: (sessionId) =>
          this.turnPreparationService.invalidateSystemPromptCache(sessionId),
        invalidateToolProfileCache: (sessionId) =>
          this.turnPreparationService.invalidateToolProfileCache(sessionId),
        clearRuntimeActivatedSkills: (sessionId) =>
          this.turnPreparationService.resetRuntimeActivatedSkills(sessionId),
        clearConversationToolMapping: (sessionId) =>
          this.toolPresenter?.clearConversationToolMapping?.(sessionId)
      }
    )

    this.messageHistoryService = new MessageHistoryService(this.messageStore, {
      getSessionState: (sessionId) => this.sessionLifecycleService.getSessionState(sessionId),
      cancelGeneration: (sessionId) => this.cancelGeneration(sessionId),
      deletePendingInputs: (sessionId) => this.pendingInputService.deleteBySession(sessionId),
      clearFirstTurnReady: (sessionId) =>
        this.sessionLifecycleService.clearFirstTurnReady(sessionId),
      resetMemoryExtractionCursor: (sessionId) =>
        this.memoryCompactionService.resetMemoryExtractionCursor(sessionId),
      clearMemoryIngestionProjectionRetry: (sessionId) =>
        this.memoryCompactionService.clearMemoryIngestionProjectionRetry(sessionId),
      resetTape: (sessionId) => this.sessionStore.resetTape(sessionId),
      resetSummaryState: (sessionId) => this.memoryCompactionService.resetSummaryState(sessionId),
      setSessionStatus: (sessionId, status) =>
        this.sessionLifecycleService.setSessionStatus(sessionId, status),
      hasPendingInteractions: (sessionId) =>
        this.interactionResumeService.hasPendingInteractions(sessionId),
      assertNoActiveInputs: (sessionId) => this.pendingInputService.assertNoActiveInputs(sessionId),
      invalidateSummaryIfNeeded: (sessionId, orderSeq) =>
        this.memoryCompactionService.invalidateSummaryIfNeeded(sessionId, orderSeq),
      invalidateMemoryExtractionFromOrderSeq: (sessionId, orderSeq) =>
        this.memoryCompactionService.invalidateMemoryExtractionFromOrderSeq(sessionId, orderSeq),
      resolveProjectDir: (sessionId) => this.sessionLifecycleService.resolveProjectDir(sessionId),
      processMessage: (sessionId, input, context) =>
        this.streamLifecycleService.processMessage(sessionId, input, context)
    })

    this.recoverInterruptedPersistence()
    this.registerToolRegistryListeners()
  }

  private recoverInterruptedPersistence(): void {
    const recoveredMessages = this.messageStore.recoverPendingMessages()
    if (recoveredMessages > 0) {
      logger.info(`DeepChatAgent: recovered ${recoveredMessages} pending messages to error status`)
    }

    const recoveredInputs = this.pendingInputService.recoverClaimedInputsAfterRestart()
    if (recoveredInputs > 0) {
      logger.info(
        `DeepChatAgent: recovered ${recoveredInputs} sessions with claimed pending inputs`
      )
    }
  }

  private registerToolRegistryListeners(): void {
    const invalidate = this.turnPreparationService.handleToolRegistryChanged
    eventBus.on(MCP_EVENTS.CONFIG_CHANGED, invalidate)
    eventBus.on(MCP_EVENTS.SERVER_STARTED, invalidate)
    eventBus.on(MCP_EVENTS.SERVER_STOPPED, invalidate)
    eventBus.on(MCP_EVENTS.SERVER_STATUS_CHANGED, invalidate)
    eventBus.on(MCP_EVENTS.CLIENT_LIST_UPDATED, invalidate)
    eventBus.on(MCP_EVENTS.INITIALIZED, invalidate)
  }

  async initSession(sessionId: string, config: SessionInitialization): Promise<void> {
    await this.sessionLifecycleService.initSession(sessionId, config)
  }

  async destroySession(sessionId: string): Promise<void> {
    await this.sessionLifecycleService.destroySession(sessionId)
  }

  async getSessionState(sessionId: string): Promise<DeepChatSessionState | null> {
    return await this.sessionLifecycleService.getSessionState(sessionId)
  }

  async getSessionListState(sessionId: string): Promise<DeepChatSessionState | null> {
    return await this.sessionLifecycleService.getSessionListState(sessionId)
  }

  async waitForFirstTurnReady(
    sessionId: string,
    options?: { timeoutMs?: number }
  ): Promise<boolean> {
    return await this.sessionLifecycleService.waitForFirstTurnReady(sessionId, options)
  }

  async setSessionAgentContext(
    sessionId: string,
    config: SessionAgentContextUpdate
  ): Promise<void> {
    await this.sessionLifecycleService.setSessionAgentContext(sessionId, config)
  }

  async setSessionProjectDir(sessionId: string, projectDir: string | null): Promise<void> {
    await this.sessionLifecycleService.setSessionProjectDir(sessionId, projectDir)
  }

  async processMessage(
    sessionId: string,
    content: string | SendMessageInput,
    context?: StreamProcessMessageContext
  ): Promise<MessageStartResult> {
    return await this.streamLifecycleService.processMessage(sessionId, content, context)
  }

  async respondToolInteraction(
    sessionId: string,
    messageId: string,
    toolCallId: string,
    response: ToolInteractionResponse
  ): Promise<ToolInteractionResult> {
    return await this.interactionResumeService.respondToolInteraction(
      sessionId,
      messageId,
      toolCallId,
      response
    )
  }

  listPendingInputs(sessionId: string): Promise<PendingSessionInputRecord[]> {
    return this.pendingInputService.listPendingInputs(sessionId)
  }

  queuePendingInput(
    sessionId: string,
    content: string | SendMessageInput,
    options?: QueuePendingInputOptions
  ): Promise<PendingSessionInputRecord> {
    return this.pendingInputService.queuePendingInput(sessionId, content, options)
  }

  steerActiveTurn(sessionId: string, content: string | SendMessageInput): Promise<void> {
    return this.pendingInputService.steerActiveTurn(sessionId, content)
  }

  updateQueuedInput(
    sessionId: string,
    itemId: string,
    content: string | SendMessageInput
  ): Promise<PendingSessionInputRecord> {
    return this.pendingInputService.updateQueuedInput(sessionId, itemId, content)
  }

  moveQueuedInput(
    sessionId: string,
    itemId: string,
    toIndex: number
  ): Promise<PendingSessionInputRecord[]> {
    return this.pendingInputService.moveQueuedInput(sessionId, itemId, toIndex)
  }

  convertPendingInputToSteer(
    sessionId: string,
    itemId: string
  ): Promise<PendingSessionInputRecord> {
    return this.pendingInputService.convertPendingInputToSteer(sessionId, itemId)
  }

  steerPendingInput(sessionId: string, itemId: string): Promise<PendingSessionInputRecord> {
    return this.pendingInputService.steerPendingInput(sessionId, itemId)
  }

  deletePendingInput(sessionId: string, itemId: string): Promise<void> {
    return this.pendingInputService.deletePendingInput(sessionId, itemId)
  }

  async cancelGeneration(sessionId: string): Promise<void> {
    this.generationControlService.cancelGeneration(sessionId)
    this.memoryCompactionService.cancelManualCompaction(sessionId)
  }

  getActiveGeneration(sessionId: string): { eventId: string; runId: string } | null {
    return this.generationControlService.getActiveGeneration(sessionId)
  }

  async cancelGenerationByEventId(sessionId: string, eventId: string): Promise<boolean> {
    return this.generationControlService.cancelGenerationByEventId(sessionId, eventId)
  }

  async setPermissionMode(sessionId: string, mode: PermissionMode): Promise<void> {
    await this.sessionSettingsService.setPermissionMode(sessionId, mode)
  }

  async setSessionModel(sessionId: string, providerId: string, modelId: string): Promise<void> {
    await this.sessionSettingsService.setSessionModel(sessionId, providerId, modelId)
  }

  async getPermissionMode(sessionId: string): Promise<PermissionMode> {
    return await this.sessionSettingsService.getPermissionMode(sessionId)
  }

  async getGenerationSettings(sessionId: string): Promise<SessionGenerationSettings | null> {
    return await this.sessionSettingsService.getGenerationSettings(sessionId)
  }

  async updateGenerationSettings(
    sessionId: string,
    settings: Partial<SessionGenerationSettings>
  ): Promise<SessionGenerationSettings> {
    return await this.sessionSettingsService.updateGenerationSettings(sessionId, settings)
  }

  async getMessages(sessionId: string): Promise<ChatMessageRecord[]> {
    return this.messageStore.getMessages(sessionId)
  }

  async hasMessages(sessionId: string): Promise<boolean> {
    return this.messageStore.hasMessages(sessionId)
  }

  async listMessagesPage(
    sessionId: string,
    options?: { limit?: number; cursor?: MessagePageCursor | null }
  ): Promise<ChatMessagePageResult> {
    return this.messageStore.listMessagesPage(sessionId, options)
  }

  async getMessageIds(sessionId: string): Promise<string[]> {
    return this.messageStore.getMessageIds(sessionId)
  }

  async getMessage(messageId: string): Promise<ChatMessageRecord | null> {
    return this.messageStore.getMessage(messageId)
  }

  async getTapeInfo(sessionId: string): Promise<AgentTapeInfo> {
    return this.tapeAccessService.getTapeInfo(sessionId)
  }

  async searchTape(
    sessionId: string,
    query: string,
    options?: AgentTapeSearchOptions
  ): Promise<AgentTapeSearchResult[]> {
    return this.tapeAccessService.searchTape(sessionId, query, options)
  }

  async getTapeContext(
    sessionId: string,
    entryIds: number[],
    options?: AgentTapeContextOptions
  ): Promise<AgentTapeContextResult> {
    return this.tapeAccessService.getTapeContext(sessionId, entryIds, options)
  }

  async listTapeAnchors(
    sessionId: string,
    options?: AgentTapeAnchorsOptions
  ): Promise<AgentTapeAnchorResult[]> {
    return this.tapeAccessService.listTapeAnchors(sessionId, options)
  }

  async handoffTape(
    sessionId: string,
    name: string,
    state: Record<string, unknown> = {}
  ): Promise<AgentTapeAnchorResult> {
    return this.tapeAccessService.handoffTape(sessionId, name, state)
  }

  async listMessageViewManifests(
    sessionId: string,
    messageId: string
  ): Promise<DeepChatTapeViewManifestRecord[]> {
    return this.tapeAccessService.listMessageViewManifests(sessionId, messageId)
  }

  async exportMessageTapeReplaySlice(
    sessionId: string,
    messageId: string,
    options?: DeepChatTapeReplayExportOptions
  ): Promise<DeepChatTapeReplaySlice | null> {
    return this.tapeAccessService.exportMessageTapeReplaySlice(sessionId, messageId, options)
  }

  async mergeSubagentTape(
    parentSessionId: string,
    childSessionId: string,
    meta: Record<string, unknown> = {}
  ): Promise<void> {
    await this.tapeAccessService.mergeSubagentTape(parentSessionId, childSessionId, meta)
  }

  async discardSubagentTape(
    parentSessionId: string,
    childSessionId: string,
    meta: Record<string, unknown> = {}
  ): Promise<void> {
    await this.tapeAccessService.discardSubagentTape(parentSessionId, childSessionId, meta)
  }

  async getSessionCompactionState(sessionId: string): Promise<SessionCompactionState> {
    return await this.memoryCompactionService.getSessionCompactionState(sessionId)
  }

  async compactSession(
    sessionId: string
  ): Promise<{ compacted: boolean; state: SessionCompactionState }> {
    return await this.memoryCompactionService.compactSession(sessionId)
  }

  async clearMessages(sessionId: string): Promise<void> {
    await this.messageHistoryService.clearMessages(sessionId)
  }

  async retryMessage(sessionId: string, messageId: string): Promise<void> {
    await this.messageHistoryService.retryMessage(sessionId, messageId)
  }

  async deleteMessage(sessionId: string, messageId: string): Promise<void> {
    await this.messageHistoryService.deleteMessage(sessionId, messageId)
  }

  async editUserMessage(
    sessionId: string,
    messageId: string,
    text: string
  ): Promise<ChatMessageRecord> {
    return await this.messageHistoryService.editUserMessage(sessionId, messageId, text)
  }

  async forkSessionFromMessage(
    sourceSessionId: string,
    targetSessionId: string,
    targetMessageId: string
  ): Promise<void> {
    await this.messageHistoryService.forkSessionFromMessage(
      sourceSessionId,
      targetSessionId,
      targetMessageId
    )
  }

  public invalidateSessionSystemPromptCache(sessionId: string): void {
    this.turnPreparationService.invalidateSessionCaches(sessionId)
  }
}
