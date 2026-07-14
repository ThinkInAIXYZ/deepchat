import logger from '@shared/logger'
import type {
  AssistantMessageBlock,
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
  MessageMetadata,
  MessagePageCursor,
  MessageStartResult,
  PendingInputEnqueueSource,
  PendingSessionInputRecord,
  PermissionMode,
  QueuePendingInputOptions,
  SendMessageInput,
  SessionCompactionState,
  SessionAgentContextUpdate,
  SessionGenerationSettings,
  ToolInteractionResponse,
  ToolInteractionResult,
  UserMessageContent
} from '@shared/types/agent-interface'
import type { MCPToolResponse } from '@shared/types/core/mcp'
import type { ChatMessage } from '@shared/types/core/chat-message'
import type {
  DeepChatTapeReplayExportOptions,
  DeepChatTapeReplaySlice
} from '@shared/types/tape-replay'
import type {
  IConfigPresenter,
  ILlmProviderPresenter,
  ISkillPresenter,
  ModelConfig,
  RateLimitQueueSnapshot
} from '@shared/presenter'
import type { MCPToolDefinition } from '@shared/types/core/mcp'
import type { LLMCoreStreamEvent } from '@shared/types/core/llm-events'
import type { IToolPresenter } from '@shared/types/presenters/tool.presenter'
import { getReasoningEffectiveEnabledForProvider } from '@shared/types/model-db'
import { ApiEndpointType, ModelType } from '@shared/model'
import { isTtsModelConfig, isTtsModelId } from '@shared/ttsSettings'
import { isVideoGenerationModelConfig } from '@shared/videoGenerationSettings'
import { nanoid } from 'nanoid'
import type { SQLitePresenter } from '../sqlitePresenter'
import type { DeepChatTapeEntryRow } from '../sqlitePresenter/tables/deepchatTapeEntries'
import { eventBus } from '@/eventbus'
import { MCP_EVENTS } from '@/events'
import {
  buildSystemPromptWithSkills,
  filterSkillNamesByPolicy,
  resolveEffectiveActiveSkillNames
} from '@/agent/deepchat/resources/systemPromptBuilder'
import { createLoopRun, type LoopRun } from '@/agent/deepchat/loop/loopRun'
import { MAX_TOOL_CALLS } from '@/agent/deepchat/loop/deepChatLoopEngine'
import { InputPreparationCoordinator } from '@/agent/deepchat/loop/inputPreparationCoordinator'
import { DeepChatContextCoordinator } from '@/agent/deepchat/loop/contextCoordinator'
import type {
  BasePromptAssembler,
  PostCompactionPromptAssembler,
  ToolExecutionPort,
  ToolResultPort
} from '@/agent/deepchat/loop/ports'
import { DeepChatAgentRuntime } from '@/agent/deepchat/instance/deepChatAgentRuntime'
import { MemoryRuntimeCoordinator } from '@/agent/deepchat/memory/memoryRuntimeCoordinator'
import type { MemoryIngestionObserver } from '@/agent/deepchat/memory/memoryIngestionObserver'
import type { MemoryPromptContributor } from '@/agent/deepchat/memory/memoryPromptContributor'
import type {
  DeepChatAgentInstance,
  DeepChatAgentInstanceDelegate
} from '@/agent/deepchat/instance/deepChatAgentInstance'
import { toAppSessionId } from '@/agent/shared/agentSessionIds'
import type { ContextBuildMetadata } from './contextBuilder'
import {
  buildTapeChatView,
  buildTapeResumeView,
  getTapeContextHistoryRecords
} from './tapeViewAssembler'
import {
  capAgentRequestMaxTokens,
  AGENT_CONTEXT_SAFETY_MARGIN_TOKENS,
  buildRequestContextBudgetDiagnostics,
  buildRequestContextOverflowErrorMessage,
  estimateToolReserveTokens,
  fitRequestMessagesToContextWindow,
  preflightRequestContext
} from './contextBudget'
import {
  getReasoningPortrait,
  mapPersistedGenerationPatch,
  resolveCapabilityProviderId,
  resolveInterleavedReasoningConfig,
  sanitizeGenerationSettings,
  type PersistedSessionGenerationRow
} from './generationSettings'
import {
  appendReconstructionAnchorStateSection,
  appendSummarySection,
  CompactionService,
  type CompactionIntent
} from './compactionService'
import { buildPersistableMessageTracePayload } from './messageTracePayload'
import {
  AUTO_APPROVE_REVIEW_MAX_RECENT_MESSAGES,
  reviewAutoApproveToolPermission
} from './toolPermissionReviewer'
import { buildTerminalErrorBlocks, DeepChatMessageStore } from './messageStore'
import { DeepChatTapeService } from './tapeService'
import {
  buildExcludedRefs,
  buildIncludedRefs,
  buildRequestRefs,
  createTapeViewManifest,
  resolveTapeViewManifestPolicy,
  type TapeViewContextSelection
} from './tapeViewManifest'
import { PendingInputCoordinator } from '@/agent/deepchat/pending/pendingInputCoordinator'
import { DeepChatPendingInputStore } from '@/agent/deepchat/pending/pendingInputStore'
import { MAX_TOOL_CALLS_SKIPPED_ERROR, processStream } from './process'
import { cloneBlocksForRenderer } from './echo'
import { DeepChatSessionStore, type SessionSummaryState } from './sessionStore'
import type { MemoryRuntimePort } from '../memoryPresenter/injection'
import type {
  InterleavedReasoningConfig,
  PendingToolInteraction,
  ProcessResult,
  StreamState,
  ToolPermissionReviewRequest,
  ToolPermissionReviewResult
} from './types'
import { createState } from './types'
import { ToolOutputGuard } from './toolOutputGuard'
import {
  createToolExecutionPort,
  createToolResultPort,
  normalizeToolResultContent
} from './toolAdapters'
import { DeepChatToolResolver } from './toolResolver'
import { DeferredToolExecutor, type DeferredToolExecutionResult } from './deferredToolExecutor'
import { normalizePermissionMode, SessionSettingsCoordinator } from './sessionSettingsCoordinator'
import { CompactionRuntimeCoordinator } from './compactionRuntimeCoordinator'
import { ProviderPermissionCoordinator } from './providerPermissionCoordinator'
import {
  buildUsageFromMetadata,
  incrementToolCallAccounting,
  stampTerminalMetadata
} from './runtimeMetadata'
import type { ProviderRequestTracePayload } from '../llmProviderPresenter/requestTrace'
import type {
  DeepChatTapeViewPolicy,
  DeepChatTapeViewManifestRecord,
  DeepChatTapeViewTaskType,
  DeepChatTapeViewTokenBudget
} from '@shared/types/tape-view-manifest'
import type { NewSessionHookNotificationObserver } from '../hooksNotifications/newSessionBridge'
import type {
  AcpAsLlmProviderPermissionPort,
  ProviderCatalogPort,
  SessionPermissionPort,
  SessionUiPort
} from '../runtimePorts'
import { publishDeepchatEvent } from '@/routes/publishDeepchatEvent'
import { parseMessageMetadata } from '../usageStats'
import { awaitWithAbort } from '@/lib/awaitWithAbort'
import {
  buildAssistantDeliverySegments,
  buildAssistantPreviewMarkdown,
  buildAssistantResponseMarkdown,
  emitDeepChatInternalSessionUpdate,
  extractWaitingInteraction
} from './internalSessionEvents'
import {
  insertBlocksAfterToolCall,
  prepareToolImagePreviewPresentation
} from './imageGenerationBlocks'
import { isContextWindowErrorLike } from './contextWindowError'
import type { AcpAgentInstanceDependencyFactory, AcpPendingInputFacet } from '@/agent/acp/instance'
import { createAcpCompatibilityDependencies } from './acpCompatibilityDependencies'
import {
  buildEditedUserContent,
  buildSkillDraftToolResponse,
  collectPendingInteractionEntries,
  extractUserMessageInput,
  hasQuestionFollowUpIntent,
  isSkillDraftConfirmationBlock,
  markPermissionResolved,
  markQuestionResolved,
  normalizeUserMessageInput,
  parseAssistantBlocks,
  parsePermissionPayload,
  reconcilePendingInteractionEntries,
  replacePendingInteractions,
  resolveSkillDraftChoice,
  SKILL_DRAFT_ACTION_LABELS,
  SKILL_DRAFT_STATUS_BY_CHOICE,
  updateSkillDraftQuestionOptions,
  updateSkillDraftToolCallResponse,
  updateToolCallResponse,
  type PendingInteractionEntry
} from './interactionProjection'

type ProcessPendingInputSource = PendingInputEnqueueSource | 'steer'

type PendingTapeViewContext = {
  taskType: DeepChatTapeViewTaskType
  policy: DeepChatTapeViewPolicy
  policyVersion?: number | null
  selection: TapeViewContextSelection
  summaryCursorOrderSeq: number
  supportsVision: boolean
  supportsAudioInput: boolean
  traceDebugEnabled: boolean
}

type ResumeBudgetToolCall = {
  id: string
  name: string
  offloadPath?: string
}

const PROVIDER_OVERFLOW_RETRY_EXTRA_RESERVE_CAP = 8_192

function getProviderOverflowRetryExtraReserve(contextLength: number): number {
  if (!Number.isFinite(contextLength) || contextLength <= 0) {
    return 0
  }
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

const RATE_LIMIT_STREAM_MESSAGE_PREFIX = '__rate_limit__:'
const PRE_STREAM_SLOW_STEP_MS = 500
export const PRE_STREAM_STUCK_WARN_MS = 5_000
export const PRE_STREAM_STUCK_ESCALATION_MS = 30_000
const STALE_DEEPCHAT_INSTANCE_ERROR_NAME = 'StaleDeepChatAgentInstanceError'

interface PreStreamStepWatchdog {
  complete(): void
  cancel(): void
}

interface PreStreamStepInput {
  sessionId: string
  messageId?: string | null
  step: string
  signal?: AbortSignal
}

const createAbortError = (): Error => {
  if (typeof DOMException !== 'undefined') {
    return new DOMException('Aborted', 'AbortError')
  }

  const error = new Error('Aborted')
  error.name = 'AbortError'
  return error
}

const createStaleDeepChatInstanceError = (sessionId: string): Error => {
  const error = new Error(`DeepChat agent instance was replaced: ${sessionId}`)
  error.name = STALE_DEEPCHAT_INSTANCE_ERROR_NAME
  return error
}

function buildTapeViewSelection(
  metadata: ContextBuildMetadata,
  newUserMessageId?: string | null
): TapeViewContextSelection {
  return {
    includedRecords: metadata.includedRecords,
    excludedRecords: metadata.excludedRecords,
    summaryCursor: metadata.summaryCursor,
    includesSystemPrompt: metadata.includesSystemPrompt,
    newUserMessageId
  }
}

export class AgentRuntimePresenter {
  private readonly llmProviderPresenter: ILlmProviderPresenter
  private readonly configPresenter: IConfigPresenter
  private readonly sqlitePresenter: SQLitePresenter
  private readonly toolPresenter: IToolPresenter | null
  private readonly sessionStore: DeepChatSessionStore
  private readonly messageStore: DeepChatMessageStore
  private readonly tapeService: DeepChatTapeService
  private readonly pendingInputStore: DeepChatPendingInputStore
  private readonly pendingInputCoordinator: PendingInputCoordinator
  readonly deepChatRuntime: DeepChatAgentRuntime
  private readonly toolResolver: DeepChatToolResolver
  private readonly sessionSettingsCoordinator: SessionSettingsCoordinator
  private readonly providerPermissionCoordinator: ProviderPermissionCoordinator
  private readonly compactionService: CompactionService
  private readonly compactionRuntimeCoordinator: CompactionRuntimeCoordinator
  private readonly inputPreparationCoordinator = new InputPreparationCoordinator()
  private readonly contextCoordinator = new DeepChatContextCoordinator()
  private readonly toolOutputGuard: ToolOutputGuard
  private readonly toolExecutionPort: ToolExecutionPort | null
  private readonly toolResultPort: ToolResultPort
  private readonly deferredToolExecutor: DeferredToolExecutor
  private readonly hookNotificationObserver?: NewSessionHookNotificationObserver
  private readonly providerCatalogPort: Pick<
    ProviderCatalogPort,
    'getProviderModels' | 'getCustomModels'
  >
  private readonly sessionPermissionPort?: SessionPermissionPort
  private readonly acpAsLlmProviderPermission?: AcpAsLlmProviderPermissionPort
  private readonly sessionUiPort?: SessionUiPort
  private readonly memoryCoordinator: MemoryRuntimeCoordinator
  private readonly memoryPromptContributor: MemoryPromptContributor
  readonly memoryIngestionObserver: MemoryIngestionObserver
  private readonly cacheImage?: (data: string) => Promise<string>
  private readonly skillPresenter?: Pick<
    ISkillPresenter,
    | 'getMetadataList'
    | 'getActiveSkills'
    | 'setActiveSkills'
    | 'loadSkillContent'
    | 'viewDraftSkill'
    | 'installDraftSkill'
    | 'discardDraftSkill'
  >
  private nextRunSequence = 0
  private readonly postCompactionPromptAssembler: PostCompactionPromptAssembler

  constructor(
    llmProviderPresenter: ILlmProviderPresenter,
    configPresenter: IConfigPresenter,
    sqlitePresenter: SQLitePresenter,
    toolPresenter?: IToolPresenter,
    hookNotificationObserver?: NewSessionHookNotificationObserver,
    runtimePorts?: {
      providerCatalogPort?: Pick<ProviderCatalogPort, 'getProviderModels' | 'getCustomModels'>
      sessionPermissionPort?: SessionPermissionPort
      acpAsLlmProviderPermission?: AcpAsLlmProviderPermissionPort
      sessionUiPort?: SessionUiPort
      memoryPort?: MemoryRuntimePort
      cacheImage?: (data: string) => Promise<string>
      skillPresenter?: Pick<
        ISkillPresenter,
        | 'getMetadataList'
        | 'getActiveSkills'
        | 'setActiveSkills'
        | 'loadSkillContent'
        | 'viewDraftSkill'
        | 'installDraftSkill'
        | 'discardDraftSkill'
      >
    }
  ) {
    this.llmProviderPresenter = llmProviderPresenter
    this.configPresenter = configPresenter
    this.sqlitePresenter = sqlitePresenter
    this.toolPresenter = toolPresenter ?? null
    this.hookNotificationObserver = hookNotificationObserver
    this.providerCatalogPort = runtimePorts?.providerCatalogPort ?? {
      getProviderModels: (providerId) => this.configPresenter.getProviderModels?.(providerId) ?? [],
      getCustomModels: (providerId) => this.configPresenter.getCustomModels?.(providerId) ?? []
    }
    this.sessionPermissionPort = runtimePorts?.sessionPermissionPort
    this.acpAsLlmProviderPermission = runtimePorts?.acpAsLlmProviderPermission
    this.sessionUiPort = runtimePorts?.sessionUiPort
    this.cacheImage = runtimePorts?.cacheImage
    this.skillPresenter = runtimePorts?.skillPresenter
    this.sessionStore = new DeepChatSessionStore(sqlitePresenter)
    this.messageStore = new DeepChatMessageStore(sqlitePresenter)
    this.tapeService = new DeepChatTapeService(sqlitePresenter)
    this.pendingInputStore = new DeepChatPendingInputStore(sqlitePresenter)
    this.pendingInputCoordinator = new PendingInputCoordinator(this.pendingInputStore)
    this.deepChatRuntime = new DeepChatAgentRuntime((sessionId) =>
      this.createDeepChatInstanceDelegate(sessionId)
    )
    this.toolResolver = new DeepChatToolResolver({
      configPresenter: this.configPresenter,
      sqlitePresenter: this.sqlitePresenter,
      toolPresenter: this.toolPresenter,
      skillPresenter: this.skillPresenter,
      deepChatRuntime: this.deepChatRuntime,
      getDeepChatInstance: (sessionId) => this.getDeepChatInstance(sessionId),
      getSessionAgentId: (sessionId) => this.getSessionAgentId(sessionId),
      getRuntimeState: (sessionId) => this.getDeepChatRuntimeState(sessionId),
      assertCurrent: (sessionId, instance) =>
        this.throwIfStaleDeepChatInstance(sessionId, instance),
      isAcpBackedSubagentSession: (sessionId, providerId) =>
        this.isAcpBackedSubagentSession(sessionId, providerId),
      isStaleInstanceError: (error) => this.isStaleDeepChatInstanceError(error)
    })
    this.sessionSettingsCoordinator = new SessionSettingsCoordinator({
      configPresenter: this.configPresenter,
      sessionStore: this.sessionStore,
      toolResolver: this.toolResolver,
      toolPresenter: this.toolPresenter,
      sessionPermissionPort: this.sessionPermissionPort,
      getRuntimeState: (sessionId) => this.getDeepChatRuntimeState(sessionId),
      getInstance: (sessionId) => this.getDeepChatInstance(sessionId),
      getEffectiveGenerationSettings: async (sessionId) =>
        await this.getEffectiveSessionGenerationSettings(sessionId),
      normalizeProjectDir: (projectDir) => this.normalizeProjectDir(projectDir),
      resolvePersistedProjectDir: (sessionId) => this.resolvePersistedSessionProjectDir(sessionId),
      invalidateSystemPromptCache: (sessionId) => this.invalidateSystemPromptCache(sessionId),
      invalidateToolProfileCache: (sessionId) => this.invalidateToolProfileCache(sessionId)
    })
    this.providerPermissionCoordinator = new ProviderPermissionCoordinator({
      messageStore: this.messageStore,
      getOrCreateInstance: (sessionId) => this.getDeepChatInstance(sessionId),
      getHydratedInstance: (sessionId) => this.getHydratedDeepChatInstance(sessionId),
      requirePermissionPort: () => this.requireAcpAsLlmProviderPermission(),
      emitMessageRefresh: (sessionId, messageId) => this.emitMessageRefresh(sessionId, messageId),
      resolveStreamRequestId: (sessionId, messageId) =>
        this.resolveStreamRequestId(sessionId, messageId),
      dispatchTerminalHooks: (sessionId, state, result) =>
        this.dispatchTerminalHooks(sessionId, state, result),
      getRuntimeState: (sessionId) => this.getDeepChatRuntimeState(sessionId),
      setSessionStatus: (sessionId, status) => this.setSessionStatus(sessionId, status)
    })
    this.memoryCoordinator = new MemoryRuntimeCoordinator({
      memoryPort: runtimePorts?.memoryPort,
      getSessionAgentId: (sessionId) => this.getSessionAgentId(sessionId),
      getSessionRuntimeState: (sessionId) => this.getDeepChatRuntimeState(sessionId),
      hasSessionRuntimeState: (sessionId) => Boolean(this.getDeepChatRuntimeState(sessionId)),
      assertCurrentSessionHandle: (handle) => {
        const sessionId = handle.sessionId
        if (this.getHydratedDeepChatInstance(sessionId)?.getMemorySessionHandle() !== handle) {
          throw createStaleDeepChatInstanceError(sessionId)
        }
      },
      getNextMessageOrderSeq: (sessionId) => this.messageStore.getNextOrderSeq(sessionId),
      getMessagesUpToOrderSeq: (sessionId, orderSeq) =>
        this.messageStore.getMessagesUpToOrderSeq(sessionId, orderSeq),
      getMemoryCursorOrderSeq: (sessionId) =>
        this.sqlitePresenter.deepchatSessionsTable.getMemoryCursorOrderSeq(sessionId),
      updateMemoryCursorOrderSeq: (sessionId, orderSeq) =>
        this.sqlitePresenter.deepchatSessionsTable.updateMemoryCursorOrderSeq(sessionId, orderSeq),
      rewindMemoryCursorOrderSeq: (sessionId, orderSeq) =>
        this.sqlitePresenter.deepchatSessionsTable.rewindMemoryCursorOrderSeq(sessionId, orderSeq),
      getTapeRows: (sessionId) =>
        this.sqlitePresenter.deepchatTapeEntriesTable.getBySession(sessionId),
      appendTapeAnchor: (input) => {
        this.sqlitePresenter.deepchatTapeEntriesTable.appendAnchor(input)
      },
      getIngestionProjection: () => this.sqlitePresenter.deepchatMemoryIngestionProjectionTable
    })
    this.memoryPromptContributor = this.memoryCoordinator
    this.memoryIngestionObserver = this.memoryCoordinator
    this.postCompactionPromptAssembler = {
      assemble: async (input) => {
        const promptWithSummary = appendSummarySection(input.basePrompt, input.summaryText)
        const promptWithReconstruction = appendReconstructionAnchorStateSection(
          promptWithSummary,
          input.reconstructionAnchor
        )
        return await this.memoryPromptContributor.contribute({
          session: input.memorySession,
          basePrompt: promptWithReconstruction,
          query: input.memoryQuery,
          messageId: input.memoryMessageId
        })
      }
    }
    this.compactionService = new CompactionService(
      this.sessionStore,
      this.messageStore,
      this.llmProviderPresenter,
      this.configPresenter,
      async (sessionId) => {
        const agentId = this.getSessionAgentId(sessionId) ?? 'deepchat'
        if (typeof this.configPresenter.resolveDeepChatAgentConfig !== 'function') {
          return {}
        }

        return await this.configPresenter.resolveDeepChatAgentConfig(agentId)
      }
    )
    this.compactionRuntimeCoordinator = new CompactionRuntimeCoordinator({
      compactionService: this.compactionService,
      sessionStore: this.sessionStore,
      messageStore: this.messageStore,
      getInstance: (sessionId) => this.getDeepChatInstance(sessionId),
      assertCurrent: (sessionId, instance) =>
        this.throwIfStaleDeepChatInstance(sessionId, instance),
      emitMessageRefresh: (sessionId, messageId) => this.emitMessageRefresh(sessionId, messageId),
      isAbortError: (error) => this.isAbortError(error),
      throwIfAbortRequested: (signal) => this.throwIfAbortRequested(signal)
    })
    this.toolOutputGuard = new ToolOutputGuard()
    this.toolExecutionPort = createToolExecutionPort(this.toolPresenter)
    this.toolResultPort = createToolResultPort({
      outputGuard: this.toolOutputGuard,
      normalize: async (tool) =>
        await this.normalizeToolResultContent({
          sessionId: tool.sessionId,
          toolCallId: tool.toolCallId,
          toolName: tool.toolName,
          toolArgs: tool.toolArgs,
          content: tool.content,
          isError: tool.isError,
          abortSignal: tool.signal
        })
    })
    this.deferredToolExecutor = new DeferredToolExecutor({
      toolExecutionPort: this.toolExecutionPort,
      toolResultPort: this.toolResultPort,
      toolResolver: this.toolResolver,
      cacheImage: this.cacheImage,
      registerAbortController: (sessionId, toolCallId) =>
        this.registerDeferredToolAbortController(sessionId, toolCallId),
      clearAbortController: (sessionId, toolCallId, controller) =>
        this.clearDeferredToolAbortController(sessionId, toolCallId, controller),
      getAbortSignal: (sessionId) => this.getAbortSignalForSession(sessionId),
      resolveProjectDir: (sessionId) => this.resolveProjectDir(sessionId),
      getSessionState: async (sessionId) => await this.getSessionState(sessionId),
      getRuntimeState: (sessionId) => this.getDeepChatRuntimeState(sessionId),
      getSessionAgentId: (sessionId) => this.getSessionAgentId(sessionId),
      updateSubagentProgress: (...args) => this.updateSubagentToolCallProgress(...args)
    })
    const recovered = this.messageStore.recoverPendingMessages()
    if (recovered > 0) {
      logger.info(`DeepChatAgent: recovered ${recovered} pending messages to error status`)
    }

    const recoveredPendingInputs = this.pendingInputCoordinator.recoverClaimedInputsAfterRestart()
    if (recoveredPendingInputs > 0) {
      logger.info(
        `DeepChatAgent: recovered ${recoveredPendingInputs} sessions with claimed pending inputs`
      )
    }

    eventBus.on(MCP_EVENTS.CONFIG_CHANGED, this.handleToolRegistryChanged)
    eventBus.on(MCP_EVENTS.SERVER_STARTED, this.handleToolRegistryChanged)
    eventBus.on(MCP_EVENTS.SERVER_STOPPED, this.handleToolRegistryChanged)
    eventBus.on(MCP_EVENTS.SERVER_STATUS_CHANGED, this.handleToolRegistryChanged)
    eventBus.on(MCP_EVENTS.CLIENT_LIST_UPDATED, this.handleToolRegistryChanged)
    eventBus.on(MCP_EVENTS.INITIALIZED, this.handleToolRegistryChanged)
  }

  createAcpAgentInstanceDependencies(
    input: Parameters<AcpAgentInstanceDependencyFactory>[0]
  ): ReturnType<AcpAgentInstanceDependencyFactory> {
    return createAcpCompatibilityDependencies(
      {
        configPresenter: this.configPresenter,
        llmProviderPresenter: this.llmProviderPresenter,
        sessionStore: this.sessionStore,
        messageStore: this.messageStore,
        tapeService: this.tapeService,
        toolResolver: this.toolResolver,
        appendViewManifest: (manifest) => {
          this.appendTapeViewManifest({
            sessionId: manifest.sessionId,
            messageId: manifest.messageId,
            requestSeq: manifest.requestSeq,
            taskType: manifest.taskType,
            policy: manifest.policy,
            policyVersion: manifest.policyVersion,
            messages: manifest.messages,
            tools: manifest.localToolDefinitions,
            tokenBudget: manifest.tokenBudget,
            providerId: manifest.providerId,
            modelId: manifest.modelId,
            summaryCursorOrderSeq: manifest.summaryCursorOrderSeq,
            supportsVision: manifest.supportsVision,
            supportsAudioInput: manifest.supportsAudioInput,
            traceDebugEnabled: manifest.traceDebugEnabled
          })
        },
        setStatus: (sessionId, status) => this.setSessionStatus(sessionId, status),
        getSessionState: async (sessionId) => await this.getSessionState(sessionId),
        getDeepChatInstance: (sessionId) => this.getDeepChatInstance(sessionId),
        getGenerationSettings: async (sessionId, instance) =>
          await this.getEffectiveSessionGenerationSettings(sessionId, instance),
        buildSystemPrompt: async (sessionId, basePrompt, tools, activeSkills, instance) =>
          await this.buildSystemPromptWithSkills(
            sessionId,
            basePrompt,
            tools,
            activeSkills,
            instance
          ),
        emitRateLimitWaitingMessage: (sessionId, messageId, requestId, snapshot) =>
          this.emitRateLimitWaitingMessage(sessionId, messageId, requestId, snapshot),
        clearRateLimitWaitingMessage: (sessionId, messageId, requestId) =>
          this.clearRateLimitWaitingMessage(sessionId, messageId, requestId),
        dispatchHook: (event, context) => this.dispatchHook(event, context)
      },
      input
    )
  }

  getAcpPendingInputFacet(): AcpPendingInputFacet {
    return this.pendingInputCoordinator
  }

  private requireSessionPermissionPort(): SessionPermissionPort {
    if (this.sessionPermissionPort) {
      return this.sessionPermissionPort
    }

    throw new Error('Session permission port is not available.')
  }

  private requireAcpAsLlmProviderPermission(): AcpAsLlmProviderPermissionPort {
    if (this.acpAsLlmProviderPermission) {
      return this.acpAsLlmProviderPermission
    }
    throw new Error('ACP-as-LLM provider permission control is not available.')
  }

  private getDeepChatInstance(sessionId: string): DeepChatAgentInstance {
    return this.deepChatRuntime.getOrHydrate(toAppSessionId(sessionId))
  }

  private getHydratedDeepChatInstance(sessionId: string): DeepChatAgentInstance | undefined {
    return this.deepChatRuntime.getHydrated(toAppSessionId(sessionId))
  }

  private getDeepChatRuntimeState(sessionId: string): DeepChatSessionState | undefined {
    return this.getHydratedDeepChatInstance(sessionId)?.getRuntimeState()
  }

  private createBasePromptAssembler(expectedInstance: DeepChatAgentInstance): BasePromptAssembler {
    return {
      assemble: async (input) =>
        await this.buildSystemPromptWithSkills(
          input.sessionId,
          input.configuredPrompt,
          [...input.toolDefinitions],
          [...input.activeSkillNames],
          expectedInstance
        )
    }
  }

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

    this.throwIfAbortRequested(signal)
    const generationSettings = await this.runPreStreamStep(
      { sessionId, messageId, step: 'generation-settings', signal },
      () => awaitWithAbort(this.getEffectiveSessionGenerationSettings(sessionId, instance), signal)
    )
    const modelConfig = this.configPresenter.getModelConfig(state.modelId, state.providerId)
    const useContextBudget = this.shouldUseDeepChatContextBudget(
      state.providerId,
      modelConfig,
      state.modelId
    )
    this.throwIfAbortRequested(signal)
    const interleavedReasoning = resolveInterleavedReasoningConfig(
      this.configPresenter,
      state.providerId,
      state.modelId,
      generationSettings
    )
    const contextBudgetLength = this.resolveDeepChatContextBudgetLength(
      state.providerId,
      generationSettings.contextLength,
      modelConfig,
      state.modelId
    )
    const maxTokens = capAgentRequestMaxTokens(generationSettings.maxTokens, contextBudgetLength)
    if (input.runtimeActivatedSkillNames) {
      instance.replaceRuntimeActivatedSkills(input.runtimeActivatedSkillNames)
    }
    const sessionActiveSkillNames = await this.runPreStreamStep(
      { sessionId, messageId, step: 'active-skills', signal },
      () =>
        awaitWithAbort(
          this.toolResolver.resolveActiveSkillNamesForToolProfile(sessionId, instance),
          signal
        )
    )
    this.throwIfStaleDeepChatInstance(sessionId, instance)
    const activeSkillNames = input.runtimeActivatedSkillNames
      ? resolveEffectiveActiveSkillNames(sessionActiveSkillNames, instance)
      : sessionActiveSkillNames
    const tools = await this.runPreStreamStep(
      { sessionId, messageId, step: 'tool-definitions', signal },
      () =>
        awaitWithAbort(
          this.toolResolver.loadToolDefinitionsForSession(
            sessionId,
            projectDir,
            activeSkillNames,
            instance
          ),
          signal
        )
    )
    const toolReserveTokens = estimateToolReserveTokens(tools)
    this.throwIfAbortRequested(signal)
    const basePromptAssembler = this.createBasePromptAssembler(instance)
    const baseSystemPrompt = await this.runPreStreamStep(
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
    this.throwIfAbortRequested(signal)

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

  private isCurrentDeepChatInstance(
    sessionId: string,
    expectedInstance: DeepChatAgentInstance
  ): boolean {
    return this.getHydratedDeepChatInstance(sessionId) === expectedInstance
  }

  private throwIfStaleDeepChatInstance(
    sessionId: string,
    expectedInstance: DeepChatAgentInstance
  ): void {
    if (!this.isCurrentDeepChatInstance(sessionId, expectedInstance)) {
      throw createStaleDeepChatInstanceError(sessionId)
    }
  }

  private isStaleDeepChatInstanceError(error: unknown): boolean {
    return error instanceof Error && error.name === STALE_DEEPCHAT_INSTANCE_ERROR_NAME
  }

  private createDeepChatInstanceDelegate(sessionId: string): DeepChatAgentInstanceDelegate {
    return {
      send: async (input) => {
        if (input.queue) {
          await this.queuePendingInput(sessionId, input.content, input.queue)
          return { requestId: null, messageId: null }
        }
        return await this.processMessage(sessionId, input.content, input.context)
      },
      cancel: async () => await this.cancelGeneration(sessionId),
      snapshot: async (options) =>
        options?.lightweight
          ? await this.getSessionListState(sessionId)
          : await this.getSessionState(sessionId),
      close: async () => await this.destroySession(sessionId)
    }
  }

  private async reviewToolPermissionForAutoApprove(
    request: ToolPermissionReviewRequest,
    context: {
      providerId: string
      modelId: string
      messages: ChatMessage[]
      signal: AbortSignal
    }
  ): Promise<ToolPermissionReviewResult> {
    return await reviewAutoApproveToolPermission(
      {
        configPresenter: this.configPresenter,
        llmProviderPresenter: this.llmProviderPresenter,
        getSessionAgentId: (sessionId) => this.getSessionAgentId(sessionId)
      },
      request,
      context
    )
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
    const permissionMode = normalizePermissionMode(config.permissionMode)
    logger.info(
      `[DeepChatAgent] initSession id=${sessionId} provider=${config.providerId} model=${config.modelId} permission=${permissionMode} hasProjectDir=${projectDir !== null}`
    )
    const generationSettings = await sanitizeGenerationSettings(
      this.configPresenter,
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
    const instance = this.getDeepChatInstance(sessionId)
    instance.setAgentId(config.agentId?.trim() || this.getSessionAgentId(sessionId) || 'deepchat')
    instance.setProjectDir(projectDir)
    instance.setGenerationSettings(generationSettings)
    instance.setRuntimeState({
      status: 'idle',
      providerId: config.providerId,
      modelId: config.modelId,
      permissionMode
    })
    instance.setCompactionState(this.compactionRuntimeCoordinator.idleState())
    this.memoryCoordinator.initializeSession(sessionId)
    this.clearFirstTurnReady(sessionId)
    this.invalidateSystemPromptCache(sessionId)
    this.invalidateToolProfileCache(sessionId)
  }

  async destroySession(sessionId: string): Promise<void> {
    const instance = this.getHydratedDeepChatInstance(sessionId)
    this.memoryCoordinator.beginSessionDestroy(sessionId)
    instance?.abortAndClearGeneration()
    this.abortDeferredToolAbortControllers(sessionId)
    this.clearFirstTurnReady(sessionId)
    this.providerPermissionCoordinator.clearSession(sessionId)

    this.pendingInputCoordinator.deleteBySession(sessionId)
    this.messageStore.deleteBySession(sessionId)
    this.sessionStore.delete(sessionId)
    instance?.clearOwnedState()
    this.deepChatRuntime.evict(toAppSessionId(sessionId))
    this.memoryCoordinator.finishSessionDestroy(sessionId)
    this.toolPresenter?.clearConversationToolMapping?.(sessionId)
  }

  async getSessionState(sessionId: string): Promise<DeepChatSessionState | null> {
    return await this.getResolvedSessionState(sessionId, 'full')
  }

  async getSessionListState(sessionId: string): Promise<DeepChatSessionState | null> {
    return await this.getResolvedSessionState(sessionId, 'summary')
  }

  private async getResolvedSessionState(
    sessionId: string,
    hydrationMode: 'full' | 'summary'
  ): Promise<DeepChatSessionState | null> {
    const instance = this.getDeepChatInstance(sessionId)
    const state = instance.getRuntimeState()
    if (state) {
      this.getSessionAgentId(sessionId)
      if (hydrationMode === 'full') {
        await this.getEffectiveSessionGenerationSettings(sessionId)
      }
      return {
        ...state,
        ...(this.hasPendingInteractions(sessionId) ? { status: 'generating' as const } : {})
      }
    }

    const dbSession = this.sessionStore.get(sessionId) as PersistedSessionGenerationRow | undefined
    if (!dbSession) {
      this.deepChatRuntime.evict(toAppSessionId(sessionId))
      return null
    }

    this.getSessionAgentId(sessionId)
    const hasPendingInteractions = this.hasPendingInteractions(sessionId)
    const rebuilt: DeepChatSessionState = {
      status: 'idle',
      providerId: dbSession.provider_id,
      modelId: dbSession.model_id,
      permissionMode: normalizePermissionMode(dbSession.permission_mode)
    }
    instance.setRuntimeState(rebuilt)
    if (hydrationMode === 'full') {
      await this.getEffectiveSessionGenerationSettings(sessionId)
    }
    return {
      ...rebuilt,
      ...(hasPendingInteractions ? { status: 'generating' as const } : {})
    }
  }

  async listPendingInputs(sessionId: string): Promise<PendingSessionInputRecord[]> {
    return this.pendingInputCoordinator.listPendingInputs(sessionId)
  }

  async waitForFirstTurnReady(
    sessionId: string,
    options?: { timeoutMs?: number }
  ): Promise<boolean> {
    return await this.getDeepChatInstance(sessionId).waitForFirstTurnReady(options)
  }

  private markFirstTurnReady(sessionId: string): void {
    this.getDeepChatInstance(sessionId).markFirstTurnReady()
  }

  private clearFirstTurnReady(sessionId: string): void {
    this.getDeepChatInstance(sessionId).clearFirstTurnReady()
  }

  async queuePendingInput(
    sessionId: string,
    content: string | SendMessageInput,
    options?: QueuePendingInputOptions
  ): Promise<PendingSessionInputRecord> {
    const state = await this.getSessionState(sessionId)
    if (!state) {
      throw new Error(`Session ${sessionId} not found`)
    }
    const projectDir =
      options && Object.prototype.hasOwnProperty.call(options, 'projectDir')
        ? this.resolveProjectDir(sessionId, options.projectDir)
        : this.resolveProjectDir(sessionId)
    const normalizedInput = normalizeUserMessageInput(content)
    if (!normalizedInput.text.trim() && (normalizedInput.files?.length ?? 0) === 0) {
      throw new Error('Message cannot be empty.')
    }

    const shouldClaimImmediately =
      ((options?.source ?? 'send') === 'send' && this.isAwaitingToolQuestionFollowUp(sessionId)) ||
      this.shouldStartQueuedInputImmediately(sessionId, state.status)
    const record = this.pendingInputCoordinator.queuePendingInput(sessionId, content, {
      state: shouldClaimImmediately ? 'claimed' : 'pending'
    })

    if (record.state === 'claimed') {
      void this.processMessage(sessionId, record.payload, {
        projectDir,
        pendingQueueItemId: record.id,
        pendingQueueItemSource: options?.source ?? 'send'
      })
      return record
    }

    void this.drainPendingQueueIfPossible(sessionId, 'enqueue')
    return record
  }

  async steerActiveTurn(sessionId: string, content: string | SendMessageInput): Promise<void> {
    const state = await this.getSessionState(sessionId)
    if (!state) {
      throw new Error(`Session ${sessionId} not found`)
    }
    if (this.isAwaitingToolQuestionFollowUp(sessionId) || this.hasPendingInteractions(sessionId)) {
      throw new Error('Please resolve pending tool interactions before steering.')
    }

    const normalizedInput = normalizeUserMessageInput(content)
    if (!normalizedInput.text.trim() && (normalizedInput.files?.length ?? 0) === 0) {
      return
    }

    const instance = this.getHydratedDeepChatInstance(sessionId)
    const activeGeneration = instance?.getActiveGeneration()
    const preStreamController = instance?.getAbortController()

    if (activeGeneration) {
      // Enqueue the steer input first (it sorts ahead of queued items, and rapid successive steers
      // merge into the same pending record), then interrupt the active stream.
      this.queueVisibleSteerInput(sessionId, normalizedInput)
      // A stream is actively producing tokens: interrupt it while preserving its partial output.
      // The abort settlement auto-drains the queue and runs the steer input as the next turn.
      await this.cancelGeneration(sessionId)
      return
    }

    if (preStreamController) {
      this.queueVisibleSteerInput(sessionId, normalizedInput)
      // The current turn is still in pre-stream setup (no tokens yet, user message not persisted).
      // Don't abort — let it finish; the steer input drains right after as the next visible turn.
      return
    }

    if (!this.canStartPendingQueueDrain(sessionId, state.status, 'enqueue')) {
      if (instance?.isPendingQueueDraining() || state.status === 'generating') {
        this.queueVisibleSteerInput(sessionId, normalizedInput)
        return
      }
      throw new Error('Unable to start the steered input.')
    }

    const record = this.queueVisibleSteerInput(sessionId, normalizedInput)
    const started = await this.drainPendingQueueIfPossible(sessionId, 'enqueue')
    if (started) {
      return
    }

    const latestState = await this.getSessionState(sessionId)
    if (instance?.isPendingQueueDraining() || latestState?.status === 'generating') {
      return
    }

    try {
      this.pendingInputCoordinator.deletePendingInput(sessionId, record.id)
      instance?.clearActiveSteerPendingInputId(record.id)
    } catch (deleteError) {
      console.error('[AgentRuntime] Failed to delete unstarted steer input:', deleteError)
    }
    throw new Error('Unable to start the steered input.')
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

  /**
   * Low-level, non-interrupting promote: move a queued item into the steer lane (so it sorts ahead of
   * queued items) WITHOUT aborting the active turn. The interactive UI uses {@link steerPendingInput}
   * instead, which promotes *and* interrupts. Retained as an interface-level capability and exercised
   * by the agentSession integration tests.
   */
  async convertPendingInputToSteer(
    sessionId: string,
    itemId: string
  ): Promise<PendingSessionInputRecord> {
    await this.ensureSessionReadyForPendingInputMutation(sessionId)
    return this.pendingInputCoordinator.convertPendingInputToSteer(sessionId, itemId)
  }

  async steerPendingInput(sessionId: string, itemId: string): Promise<PendingSessionInputRecord> {
    await this.ensureSessionReadyForPendingInputMutation(sessionId)
    if (this.isAwaitingToolQuestionFollowUp(sessionId) || this.hasPendingInteractions(sessionId)) {
      throw new Error('Please resolve pending tool interactions before steering.')
    }

    // Promote the queued item to steer (it now sorts ahead of any queued items), then interrupt the
    // active turn exactly like steerActiveTurn so the abort settlement runs this item as the next turn.
    const record = this.pendingInputCoordinator.convertPendingInputToSteer(sessionId, itemId)

    const instance = this.getHydratedDeepChatInstance(sessionId)
    const activeGeneration = instance?.getActiveGeneration()
    const preStreamController = instance?.getAbortController()

    if (activeGeneration) {
      // A stream is actively producing tokens: interrupt it while preserving its partial output.
      // The abort settlement auto-drains the queue and runs the steer item as the next turn.
      await this.cancelGeneration(sessionId)
      return record
    }

    if (preStreamController) {
      // The current turn is still in pre-stream setup (no tokens yet, user message not persisted).
      // Don't abort — let it finish; the steer input drains right after as the next visible turn.
      return record
    }

    // No turn in flight: drain immediately. If the drain cannot start, roll the promotion back to the
    // queue so the item is never stranded in the locked steer lane, and surface the failure.
    const started = await this.drainPendingQueueIfPossible(sessionId, 'enqueue')
    if (!started) {
      try {
        this.pendingInputCoordinator.restoreSteerInputToQueue(sessionId, itemId)
      } catch (restoreError) {
        console.error('[AgentRuntime] Failed to restore steered input to queue:', restoreError)
      }
      throw new Error('Unable to start the steered input.')
    }
    return record
  }

  async deletePendingInput(sessionId: string, itemId: string): Promise<void> {
    await this.ensureSessionReadyForPendingInputMutation(sessionId)
    this.pendingInputCoordinator.deletePendingInput(sessionId, itemId)
  }

  async processMessage(
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
    const instance = this.getHydratedDeepChatInstance(sessionId)
    if (!instance) throw new Error(`Session ${sessionId} not found`)
    const state = instance.getRuntimeState()
    if (!state) throw new Error(`Session ${sessionId} not found`)
    if (this.hasPendingInteractions(sessionId)) {
      throw new Error('Pending tool interactions must be resolved before sending a new message.')
    }

    const normalizedInput = normalizeUserMessageInput(content)
    if (!normalizedInput.text.trim() && (normalizedInput.files?.length ?? 0) === 0) {
      throw new Error('Message cannot be empty.')
    }
    const supportsVision = this.supportsVision(state.providerId, state.modelId)
    const supportsAudioInput = this.supportsAudioInput(state.providerId, state.modelId)
    const projectDir = this.resolveProjectDir(sessionId, context?.projectDir, instance)
    logger.info(
      `[DeepChatAgent] processMessage session=${sessionId} promptLength=${normalizedInput.text.length} fileCount=${normalizedInput.files?.length ?? 0} hasProjectDir=${projectDir !== null}`
    )

    this.setSessionStatus(sessionId, 'generating')
    const preStreamAbortController = this.ensureSessionAbortController(sessionId)
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

      const preparedInput = await this.inputPreparationCoordinator.prepareInitial({
        ensureHistory: () =>
          this.runSynchronousPreStreamStep(sessionId, 'tape-ready', () =>
            getTapeContextHistoryRecords(
              this.tapeService.ensureSessionTapeReady(sessionId, this.messageStore).historyRecords
            )
          ),
        prepareIntent: async (historyRecords) => {
          if (!useContextBudget) {
            return null
          }
          return await this.runPreStreamStep(
            {
              sessionId,
              messageId: userMessageId,
              step: 'compaction-prepare',
              signal: preStreamAbortSignal
            },
            () =>
              this.compactionService.prepareForNextUserTurn({
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
          this.messageStore.createCompactionMessage(
            sessionId,
            this.messageStore.getNextOrderSeq(sessionId),
            'compacting',
            intent.previousState.summaryUpdatedAt
          ),
        appendUserFact: () =>
          this.runSynchronousPreStreamStep(sessionId, 'user-message-create', () =>
            this.messageStore.createUserMessage(
              sessionId,
              this.messageStore.getNextOrderSeq(sessionId),
              userContent
            )
          ),
        beginCompaction: (intent) => {
          this.compactionRuntimeCoordinator.emit(
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
          await this.runPreStreamStep(
            {
              sessionId,
              messageId: userMessageId,
              step: 'compaction-apply',
              signal: preStreamAbortSignal
            },
            () =>
              this.applyCompactionIntent(
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
        readSummary: () => this.sessionStore.getSummaryState(sessionId),
        afterCompactionApplyReturned: (intent) =>
          this.memoryIngestionObserver.afterCompactionApplyReturned({
            session: instance.getMemorySessionHandle(),
            origin: 'initial',
            targetCursorOrderSeq: intent.targetCursorOrderSeq
          }),
        checkpoints: {
          assertCurrent: () => this.throwIfStaleDeepChatInstance(sessionId, instance)
        }
      })
      const historyRecords = preparedInput.history
      const summaryState = preparedInput.summary
      userMessageId = preparedInput.userMessageId
      if (!userMessageId) {
        throw new Error('Failed to create user message.')
      }
      this.throwIfAbortRequested(preStreamAbortSignal)
      this.emitMessageRefresh(sessionId, userMessageId)

      this.dispatchHook('UserPromptSubmit', {
        sessionId,
        messageId: userMessageId,
        promptPreview: normalizedInput.text,
        providerId: state.providerId,
        modelId: state.modelId,
        projectDir
      })

      const preparedContext = await this.contextCoordinator.assemble({
        assemblePostCompactionPrompt: async () => {
          return await this.runPreStreamStep(
            {
              sessionId,
              messageId: userMessageId,
              step: 'memory-injection',
              signal: preStreamAbortSignal
            },
            () =>
              awaitWithAbort(
                this.postCompactionPromptAssembler.assemble({
                  memorySession: instance.getMemorySessionHandle(),
                  basePrompt: baseSystemPrompt,
                  summaryText: summaryState.summaryText,
                  reconstructionAnchor:
                    this.sessionStore.getReconstructionAnchorPromptState(sessionId),
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
            messageStore: this.messageStore,
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
          this.logSlowPreStreamStep(sessionId, 'context-build', contextBuildStartedAt)
          return contextBuild
        },
        assertCurrent: () => this.throwIfStaleDeepChatInstance(sessionId, instance)
      })
      const contextBuild = preparedContext.view
      const messages = contextBuild.messages

      const assistantOrderSeq = this.messageStore.getNextOrderSeq(sessionId)
      this.throwIfStaleDeepChatInstance(sessionId, instance)
      assistantMessageId = this.runSynchronousPreStreamStep(
        sessionId,
        'assistant-message-create',
        () => this.messageStore.createAssistantMessage(sessionId, assistantOrderSeq)
      )
      this.toolPresenter?.clearAgentPlanState?.(sessionId)
      this.throwIfAbortRequested(preStreamAbortSignal)

      if (context?.pendingQueueItemId && pendingInputSource === 'send') {
        this.pendingInputCoordinator.consumeQueuedInput(sessionId, context.pendingQueueItemId)
        consumedPendingQueueItem = true
      }

      if (context?.emitRefreshBeforeStream) {
        this.emitMessageRefresh(sessionId, assistantMessageId)
      }

      this.throwIfStaleDeepChatInstance(sessionId, instance)
      const providerBoundary = this.startPreStreamProviderBoundaryWatchdog(
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
        streamResult = await this.runStreamForMessage({
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
            return await this.postCompactionPromptAssembler.assemble({
              memorySession: instance.getMemorySessionHandle(),
              basePrompt: refreshedBasePrompt,
              summaryText: summaryState.summaryText,
              reconstructionAnchor: this.sessionStore.getReconstructionAnchorPromptState(sessionId),
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
              this.configPresenter.getSetting<boolean>('traceDebugEnabled') === true
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
          this.pendingInputCoordinator.consumeQueuedInput(sessionId, context.pendingQueueItemId)
          consumedPendingQueueItem = true
        }
      }
      try {
        this.applyProcessResultStatus(sessionId, result, runId)
      } finally {
        this.clearActiveGeneration(sessionId, runId)
      }
      if (result?.status === 'completed') {
        void this.drainPendingQueueIfPossible(sessionId, 'completed')
      } else if (result?.status === 'aborted') {
        // processStream owns terminal persistence once streaming starts. The lifecycle layer only
        // projects hooks/status and advances queued input after the returned abort.
        void this.drainPendingQueueIfPossible(sessionId, 'completed')
      }
      if (result) {
        this.memoryIngestionObserver.afterTurnSettled({
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
      this.memoryIngestionObserver.afterTurnSettled({
        session: instance.getMemorySessionHandle(),
        origin: 'initial',
        outcome: { kind: 'thrown', error: err }
      })
      if (this.isStaleDeepChatInstanceError(err)) {
        return {
          requestId: assistantMessageId,
          messageId: assistantMessageId
        }
      }
      console.error('[DeepChatAgent] processMessage error:', err)
      const aborted = this.isAbortError(err) || preStreamAbortSignal.aborted
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
          this.emitMessageRefresh(sessionId, userMessageId)
        }
        this.clearSessionAbortController(sessionId, preStreamAbortController)
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
        this.settleAbortedTurn(
          sessionId,
          assistantMessageId,
          streamRunId,
          JSON.stringify(abortMetadata)
        )
        // Stop/steer: continue the queue automatically with the next item (steer items first).
        void this.drainPendingQueueIfPossible(sessionId, 'completed')
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
        const existingAssistant = this.messageStore.getMessage(assistantMessageId)
        const blocks = buildTerminalErrorBlocks(
          existingAssistant ? parseAssistantBlocks(existingAssistant.content) : [],
          errorMessage
        )
        this.messageStore.setMessageError(
          assistantMessageId,
          blocks,
          JSON.stringify(terminalMetadata)
        )
        this.emitMessageRefresh(sessionId, assistantMessageId)
        publishDeepchatEvent('chat.stream.failed', {
          requestId: this.resolveStreamRequestId(sessionId, assistantMessageId),
          sessionId,
          messageId: assistantMessageId,
          failedAt: Date.now(),
          error: errorMessage
        })
      }
      this.dispatchHook('Stop', {
        sessionId,
        providerId: state.providerId,
        modelId: state.modelId,
        projectDir,
        stop: { reason: stopReason, userStop: false }
      })
      this.dispatchHook('SessionEnd', {
        sessionId,
        providerId: state.providerId,
        modelId: state.modelId,
        projectDir,
        usage: buildUsageFromMetadata(terminalMetadata) ?? null,
        error: { message: errorMessage }
      })
      this.setSessionStatus(sessionId, 'error')
      return {
        requestId: assistantMessageId,
        messageId: assistantMessageId
      }
    } finally {
      this.clearSessionAbortController(sessionId, preStreamAbortController)
      instance.replaceRuntimeActivatedSkills([])
    }
  }

  private logSlowPreStreamStep(sessionId: string, step: string, startedAt: number): void {
    const elapsed = Date.now() - startedAt
    if (elapsed < PRE_STREAM_SLOW_STEP_MS) {
      return
    }

    logger.warn(
      `[DeepChatAgent] pre-stream step slow session=${sessionId} step=${step} elapsed=${elapsed}ms`
    )
  }

  private startPreStreamStepWatchdog(input: PreStreamStepInput): PreStreamStepWatchdog {
    const { sessionId, messageId, step, signal } = input
    const startedAt = Date.now()
    let closed = signal?.aborted === true
    let warnTimer: ReturnType<typeof setTimeout> | null = null
    let escalationTimer: ReturnType<typeof setTimeout> | null = null

    const clearTimers = () => {
      if (warnTimer) clearTimeout(warnTimer)
      if (escalationTimer) clearTimeout(escalationTimer)
      warnTimer = null
      escalationTimer = null
      signal?.removeEventListener('abort', cancel)
    }
    const close = (completed: boolean) => {
      if (closed) return
      closed = true
      clearTimers()
      if (completed) this.logSlowPreStreamStep(sessionId, step, startedAt)
    }
    const cancel = () => close(false)
    const logStuck = (escalated: boolean) => {
      if (closed) return
      logger.warn(
        `[DeepChatAgent] pre-stream step STUCK${escalated ? ' escalation' : ''} session=${sessionId} message=${messageId ?? '<pending>'} step=${step} elapsedMs=${Date.now() - startedAt}`
      )
    }

    if (!closed) {
      signal?.addEventListener('abort', cancel, { once: true })
      warnTimer = setTimeout(() => logStuck(false), PRE_STREAM_STUCK_WARN_MS)
      escalationTimer = setTimeout(() => logStuck(true), PRE_STREAM_STUCK_ESCALATION_MS)
      if (typeof warnTimer.unref === 'function') warnTimer.unref()
      if (typeof escalationTimer.unref === 'function') escalationTimer.unref()
    }

    return {
      complete: () => close(true),
      cancel
    }
  }

  private async runPreStreamStep<T>(
    input: PreStreamStepInput,
    operation: () => Promise<T>
  ): Promise<T> {
    this.throwIfAbortRequested(input.signal)
    const watchdog = this.startPreStreamStepWatchdog(input)
    try {
      const result = await operation()
      watchdog.complete()
      return result
    } catch (error) {
      watchdog.cancel()
      throw error
    }
  }

  private runSynchronousPreStreamStep<T>(sessionId: string, step: string, operation: () => T): T {
    const startedAt = Date.now()
    try {
      return operation()
    } finally {
      this.logSlowPreStreamStep(sessionId, step, startedAt)
    }
  }

  private startPreStreamProviderBoundaryWatchdog(
    input: PreStreamStepInput,
    preStreamStartedAt: number
  ): PreStreamStepWatchdog {
    const watchdog = this.startPreStreamStepWatchdog(input)
    let crossed = false
    const close = (completed: boolean) => {
      if (crossed) return false
      crossed = true
      if (completed) {
        watchdog.complete()
      } else {
        watchdog.cancel()
      }
      return true
    }
    return {
      complete: () => {
        if (!close(true)) return
        this.logSlowPreStreamStep(input.sessionId, 'pre-stream-total', preStreamStartedAt)
      },
      cancel: () => {
        close(false)
      }
    }
  }

  private async handleSkillDraftInteraction(
    sessionId: string,
    instance: DeepChatAgentInstance,
    blocks: AssistantMessageBlock[],
    actionBlock: AssistantMessageBlock,
    toolCall: NonNullable<AssistantMessageBlock['tool_call']>,
    response: Exclude<ToolInteractionResponse, { kind: 'permission' }>
  ): Promise<{ keepPending: boolean; waitingForUserMessage: boolean; handledInline?: boolean }> {
    if (!this.skillPresenter) {
      throw new Error('Skill presenter is not available.')
    }

    if (response.kind === 'question_other') {
      throw new Error('Custom skill draft responses are not supported.')
    }

    const answerText =
      response.kind === 'question_option' ? response.optionLabel : response.answerText
    const choice = resolveSkillDraftChoice(answerText)
    if (!choice) {
      throw new Error('Unknown skill draft action.')
    }

    const draftId = String(actionBlock.extra?.skillDraftId ?? '').trim()
    if (!draftId) {
      throw new Error('Skill draft id is missing.')
    }

    if (choice === 'view') {
      const result = await this.skillPresenter.viewDraftSkill(sessionId, draftId)
      if (!result.success) {
        const error = result.error || 'Unknown error'
        actionBlock.extra = {
          ...actionBlock.extra,
          skillDraftStatus: 'error',
          skillDraftError: error
        }
        updateSkillDraftToolCallResponse(
          blocks,
          toolCall.id!,
          buildSkillDraftToolResponse({ success: false, action: 'view', draftId, error }),
          true
        )
        markQuestionResolved(actionBlock, SKILL_DRAFT_ACTION_LABELS.view)
        return { keepPending: false, waitingForUserMessage: false }
      }

      const responseText = buildSkillDraftToolResponse({
        success: true,
        action: 'view',
        draftId,
        skillName: result.skillName
      })
      actionBlock.status = 'pending'
      const currentExtra = actionBlock.extra ?? {}
      actionBlock.extra = {
        ...currentExtra,
        needsUserAction: true,
        questionResolution: 'asked',
        skillDraftStatus: 'viewed',
        skillDraftName: result.skillName ?? currentExtra.skillDraftName,
        skillDraftPreview: result.content ?? ''
      }
      updateSkillDraftQuestionOptions(actionBlock, true)
      updateSkillDraftToolCallResponse(blocks, toolCall.id!, responseText, false)
      return { keepPending: true, waitingForUserMessage: false, handledInline: true }
    }

    const result =
      choice === 'install'
        ? await this.skillPresenter.installDraftSkill(sessionId, draftId)
        : await this.skillPresenter.discardDraftSkill(sessionId, draftId)

    const responseText = buildSkillDraftToolResponse({
      success: result.success,
      action: result.action,
      draftId,
      skillName: result.skillName,
      installedSkillName: result.installedSkillName,
      error: result.error
    })

    const error = result.error || 'Unknown error'
    actionBlock.extra = {
      ...actionBlock.extra,
      skillDraftStatus: result.success ? SKILL_DRAFT_STATUS_BY_CHOICE[choice] : 'error',
      ...(result.success ? {} : { skillDraftError: error })
    }
    markQuestionResolved(actionBlock, SKILL_DRAFT_ACTION_LABELS[choice])
    updateSkillDraftToolCallResponse(blocks, toolCall.id!, responseText, !result.success)

    if (choice === 'install' && result.success) {
      instance.invalidateResourceCaches()
    }

    return { keepPending: false, waitingForUserMessage: false }
  }

  async respondToolInteraction(
    sessionId: string,
    messageId: string,
    toolCallId: string,
    response: ToolInteractionResponse
  ): Promise<ToolInteractionResult> {
    const instance = this.getDeepChatInstance(sessionId)
    if (!instance.tryLockInteraction(messageId, toolCallId)) {
      return { resumed: false }
    }

    const interactionOwnerRun = instance.getActiveGeneration()
    const interactionOwnedByActiveRun = interactionOwnerRun?.messageId === messageId
    let interactionAbortController: AbortController | null = null
    let interactionAbortSignal: AbortSignal | undefined
    try {
      if (interactionOwnedByActiveRun && interactionOwnerRun.abortController.signal.aborted) {
        return { resumed: false }
      }
      if (interactionOwnedByActiveRun) {
        interactionAbortSignal = interactionOwnerRun.abortController.signal
      } else if (!interactionOwnerRun) {
        interactionAbortController = this.ensureSessionAbortController(sessionId)
        interactionAbortSignal = interactionAbortController.signal
      }
      this.throwIfAbortRequested(interactionAbortSignal)
      const message = await this.messageStore.getMessage(messageId)
      if (!message || message.role !== 'assistant') {
        throw new Error(`Assistant message not found: ${messageId}`)
      }
      if (message.sessionId !== sessionId) {
        throw new Error(`Message ${messageId} does not belong to session ${sessionId}`)
      }

      const blocks = parseAssistantBlocks(message.content)
      const pendingEntries = reconcilePendingInteractionEntries(
        instance,
        collectPendingInteractionEntries(messageId, blocks)
      )
      replacePendingInteractions(instance, pendingEntries)
      if (pendingEntries.length === 0) {
        throw new Error('No pending interaction found in target message.')
      }

      const firstPendingInteraction = instance.getFirstPendingInteraction()
      const currentEntry = pendingEntries[0]
      if (
        firstPendingInteraction?.messageId !== messageId ||
        firstPendingInteraction.toolCallId !== toolCallId
      ) {
        throw new Error('Interaction queue out of order. Please handle the first pending item.')
      }

      let waitingForUserMessage = false
      let resumeBudgetToolCall: ResumeBudgetToolCall | null = null
      let emitResolvedToolHook: (() => void) | null = null
      let resumeAccounting = parseMessageMetadata(message.metadata)
      let accountingChanged = false
      const actionBlock = blocks[currentEntry.blockIndex]
      const toolCall = actionBlock.tool_call
      if (!toolCall?.id) {
        throw new Error('Invalid action block without tool call id.')
      }

      if (actionBlock.action_type === 'question_request') {
        if (response.kind === 'permission') {
          throw new Error('Invalid response kind for question interaction.')
        }

        if (isSkillDraftConfirmationBlock(actionBlock)) {
          const result = await awaitWithAbort(
            this.handleSkillDraftInteraction(
              sessionId,
              instance,
              blocks,
              actionBlock,
              toolCall,
              response
            ),
            interactionAbortSignal
          )
          if (!this.isCurrentDeepChatInstance(sessionId, instance)) {
            return { resumed: false }
          }
          waitingForUserMessage = result.waitingForUserMessage
          if (result.keepPending) {
            this.messageStore.updateAssistantContent(messageId, blocks)
            this.emitMessageRefresh(sessionId, messageId)
            this.messageStore.updateMessageStatus(messageId, 'pending')
            this.setSessionStatus(sessionId, 'generating')
            return { resumed: false, handledInline: result.handledInline === true }
          }
          instance.advancePendingToolBatch({ committedResultCallId: toolCall.id })
        } else if (response.kind === 'question_other') {
          const deferredResult = 'User chose to answer with a follow-up message.'
          markQuestionResolved(actionBlock, '', true)
          updateToolCallResponse(blocks, toolCall.id, deferredResult, false)
          instance.advancePendingToolBatch({ committedResultCallId: toolCall.id })
          waitingForUserMessage = true
        } else {
          const answerText =
            response.kind === 'question_option' ? response.optionLabel : response.answerText
          const normalizedAnswer = answerText.trim()
          if (!normalizedAnswer) {
            throw new Error('Answer cannot be empty.')
          }
          markQuestionResolved(actionBlock, normalizedAnswer)
          updateToolCallResponse(blocks, toolCall.id, normalizedAnswer, false)
          instance.advancePendingToolBatch({ committedResultCallId: toolCall.id })
        }
      } else if (actionBlock.action_type === 'tool_call_permission') {
        if (response.kind !== 'permission') {
          throw new Error('Invalid response kind for permission interaction.')
        }
        const permissionPayload = parsePermissionPayload(actionBlock)
        const permissionType = permissionPayload?.permissionType ?? 'write'
        const requestId = permissionPayload?.requestId?.trim()
        const providerId = permissionPayload?.providerId?.trim()
        if (providerId === 'acp' && requestId) {
          await awaitWithAbort(
            this.providerPermissionCoordinator.resolve({
              sessionId,
              messageId,
              toolCallId: toolCall.id,
              requestId,
              permissionType,
              granted: response.granted,
              ownerRun: interactionOwnerRun,
              signal: interactionAbortSignal
            }),
            interactionAbortSignal
          )
          return { resumed: false }
        }
        const state = this.getDeepChatRuntimeState(sessionId)
        const projectDir = this.resolveProjectDir(sessionId)
        let shouldDispatchResolvedToolHook = false

        if (response.granted) {
          markPermissionResolved(actionBlock, true, permissionType)
          await awaitWithAbort(
            this.grantPermissionForPayload(sessionId, permissionPayload, toolCall),
            interactionAbortSignal
          )
          const nextToolCallAccounting = incrementToolCallAccounting(resumeAccounting)
          let deferredToolCallCounted = false
          const markDeferredToolCallStarted = () => {
            if (deferredToolCallCounted) {
              return
            }
            deferredToolCallCounted = true
            resumeAccounting = nextToolCallAccounting
            accountingChanged = true
            this.messageStore.updateAssistantMetadata(messageId, JSON.stringify(resumeAccounting))
          }
          let execution: DeferredToolExecutionResult
          if ((nextToolCallAccounting.toolCalls ?? 0) > MAX_TOOL_CALLS) {
            execution = {
              responseText: MAX_TOOL_CALLS_SKIPPED_ERROR,
              isError: true
            }
          } else {
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
            execution = await this.executeDeferredToolCall(
              sessionId,
              messageId,
              toolCall,
              markDeferredToolCallStarted
            )
            if ((execution.invoked || execution.terminalError) && !deferredToolCallCounted) {
              markDeferredToolCallStarted()
            }
          }
          if (execution.invoked) {
            instance.advancePendingToolBatch({ invokedCallId: toolCall.id })
          }
          if (execution.terminalError) {
            const terminalMetadata = stampTerminalMetadata(resumeAccounting, 'error', 'tool_error')
            instance.advancePendingToolBatch({ committedResultCallId: toolCall.id })
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
            updateToolCallResponse(blocks, toolCall.id, execution.terminalError, true)
            this.messageStore.setMessageError(messageId, blocks, JSON.stringify(terminalMetadata))
            this.emitMessageRefresh(sessionId, messageId)
            publishDeepchatEvent('chat.stream.failed', {
              requestId: this.resolveStreamRequestId(sessionId, messageId),
              sessionId,
              messageId,
              failedAt: Date.now(),
              error: execution.terminalError
            })
            this.dispatchHook('Stop', {
              sessionId,
              messageId,
              providerId: state?.providerId,
              modelId: state?.modelId,
              projectDir,
              stop: { reason: 'tool_error', userStop: false }
            })
            this.dispatchHook('SessionEnd', {
              sessionId,
              messageId,
              providerId: state?.providerId,
              modelId: state?.modelId,
              projectDir,
              usage: buildUsageFromMetadata(terminalMetadata) ?? null,
              error: { message: execution.terminalError }
            })
            this.setSessionStatus(sessionId, 'error')
            replacePendingInteractions(
              instance,
              reconcilePendingInteractionEntries(
                instance,
                collectPendingInteractionEntries(messageId, blocks)
              )
            )
            return { resumed: false }
          }
          const imagePresentation = prepareToolImagePreviewPresentation({
            toolCallId: toolCall.id,
            toolName: toolCall.name || '',
            toolSource: execution.toolSource,
            serverName: execution.serverName,
            isError: execution.isError,
            imagePreviews: execution.imagePreviews
          })

          updateToolCallResponse(blocks, toolCall.id, execution.responseText, execution.isError, {
            rtkApplied: execution.rtkApplied,
            rtkMode: execution.rtkMode,
            rtkFallbackReason: execution.rtkFallbackReason,
            imagePreviews: imagePresentation.toolBlockImagePreviews
          })
          insertBlocksAfterToolCall(blocks, toolCall.id, imagePresentation.promotedBlocks)
          resumeBudgetToolCall = {
            id: toolCall.id,
            name: toolCall.name || '',
            offloadPath: execution.offloadPath
          }

          if (execution.requiresPermission && execution.permissionRequest) {
            instance.transitionPendingInteractionOrigin(
              messageId,
              toolCall.id,
              'post-call-permission'
            )
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
            instance.advancePendingToolBatch({ committedResultCallId: toolCall.id })
            shouldDispatchResolvedToolHook = true
          }
        } else {
          markPermissionResolved(actionBlock, false, permissionType)
          updateToolCallResponse(blocks, toolCall.id, 'User denied the request.', true)
          instance.advancePendingToolBatch({ committedResultCallId: toolCall.id })
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

      const remainingPending = reconcilePendingInteractionEntries(
        instance,
        collectPendingInteractionEntries(messageId, blocks)
      )
      const awaitsUserFollowUp = waitingForUserMessage || hasQuestionFollowUpIntent(blocks)
      const finishesForUserFollowUp = awaitsUserFollowUp && remainingPending.length === 0
      const persistedMetadata = finishesForUserFollowUp
        ? stampTerminalMetadata(resumeAccounting, 'completed', 'user_follow_up')
        : resumeAccounting
      this.messageStore.updateAssistantContent(
        messageId,
        blocks,
        finishesForUserFollowUp || accountingChanged ? JSON.stringify(persistedMetadata) : undefined
      )
      replacePendingInteractions(instance, remainingPending)
      this.emitMessageRefresh(sessionId, messageId)

      if (remainingPending.length > 0) {
        emitResolvedToolHook?.()
        this.messageStore.updateMessageStatus(messageId, 'pending')
        this.setSessionStatus(sessionId, 'generating')
        return { resumed: false }
      }

      if (awaitsUserFollowUp) {
        emitResolvedToolHook?.()
        this.messageStore.updateMessageStatus(messageId, 'sent')
        this.dispatchTerminalHooks(sessionId, this.getDeepChatRuntimeState(sessionId), {
          status: 'completed',
          stopReason: 'user_follow_up',
          usage: buildUsageFromMetadata(persistedMetadata)
        })
        this.setSessionStatus(sessionId, 'idle')
        return { resumed: false, waitingForUserMessage: true }
      }

      this.clearSessionAbortController(sessionId, interactionAbortController ?? undefined)
      const resumed = await this.resumeAssistantMessage(
        sessionId,
        messageId,
        blocks,
        resumeBudgetToolCall,
        resumeAccounting
      )
      emitResolvedToolHook?.()
      return { resumed }
    } catch (error) {
      if (this.isAbortError(error) || interactionAbortSignal?.aborted) {
        if (interactionOwnedByActiveRun) {
          return { resumed: false }
        }
        const accounting = parseMessageMetadata(
          this.messageStore.getMessage(messageId)?.metadata ?? '{}'
        )
        if (interactionAbortController) {
          this.clearSessionAbortController(sessionId, interactionAbortController)
        }
        instance.replacePendingInteractions([])
        this.settleAbortedTurn(
          sessionId,
          messageId,
          undefined,
          JSON.stringify(stampTerminalMetadata(accounting, 'aborted', 'user_stop'))
        )
        void this.drainPendingQueueIfPossible(sessionId, 'completed')
        return { resumed: false }
      }
      throw error
    } finally {
      if (interactionAbortController) {
        this.clearSessionAbortController(sessionId, interactionAbortController)
      }
      instance.unlockInteraction(messageId, toolCallId)
    }
  }

  async setPermissionMode(sessionId: string, mode: PermissionMode): Promise<void> {
    await this.sessionSettingsCoordinator.setPermissionMode(sessionId, mode)
  }

  async setSessionModel(sessionId: string, providerId: string, modelId: string): Promise<void> {
    await this.sessionSettingsCoordinator.setModel(sessionId, providerId, modelId)
  }

  async setSessionAgentContext(
    sessionId: string,
    config: SessionAgentContextUpdate
  ): Promise<void> {
    await this.sessionSettingsCoordinator.setAgentContext(sessionId, config)
  }

  async setSessionProjectDir(sessionId: string, projectDir: string | null): Promise<void> {
    this.sessionSettingsCoordinator.setProjectDir(sessionId, projectDir)
  }

  async getPermissionMode(sessionId: string): Promise<PermissionMode> {
    return this.sessionSettingsCoordinator.getPermissionMode(sessionId)
  }

  async getGenerationSettings(sessionId: string): Promise<SessionGenerationSettings | null> {
    return await this.sessionSettingsCoordinator.getGenerationSettings(sessionId)
  }

  async updateGenerationSettings(
    sessionId: string,
    settings: Partial<SessionGenerationSettings>
  ): Promise<SessionGenerationSettings> {
    return await this.sessionSettingsCoordinator.updateGenerationSettings(sessionId, settings)
  }

  async cancelGeneration(sessionId: string): Promise<void> {
    const instance = this.getHydratedDeepChatInstance(sessionId)
    if (!instance) {
      return
    }

    if (!instance.hasPendingInteractions()) {
      this.refreshPendingInteractionsFromStore(sessionId)
    }
    const pendingInteractions = instance.getPendingInteractions()
    const hasDeferredHandler = pendingInteractions.some((interaction) =>
      instance.hasDeferredToolAbortController(interaction.toolCallId)
    )
    const hasAsyncSettlementOwner = Boolean(
      instance.getActiveGeneration() || instance.getAbortController() || hasDeferredHandler
    )

    instance.requestGenerationAbort()
    this.abortDeferredToolAbortControllers(sessionId)
    this.providerPermissionCoordinator.clearSession(sessionId)

    if (hasAsyncSettlementOwner || pendingInteractions.length === 0) {
      return
    }

    const messageId = pendingInteractions[0].messageId
    const metadata = parseMessageMetadata(this.messageStore.getMessage(messageId)?.metadata ?? '{}')
    const terminalMetadata = stampTerminalMetadata(metadata, 'aborted', 'user_stop')
    instance.replacePendingInteractions([])
    this.settleAbortedTurn(
      sessionId,
      messageId,
      terminalMetadata.runId,
      JSON.stringify(terminalMetadata)
    )
    void this.drainPendingQueueIfPossible(sessionId, 'completed')
  }

  /**
   * Append the canceled terminal block to an assistant message after a stop/steer abort. Idempotent
   * via buildTerminalErrorBlocks (won't duplicate the block).
   */
  private writeCanceledTerminalBlock(
    sessionId: string,
    messageId: string | null,
    metadata?: string
  ): void {
    if (!messageId) {
      return
    }
    const assistantMessage = this.messageStore.getMessage(messageId)
    if (assistantMessage?.role !== 'assistant') {
      return
    }
    const blocks = buildTerminalErrorBlocks(
      parseAssistantBlocks(assistantMessage.content),
      'common.error.userCanceledGeneration'
    )
    this.messageStore.setMessageError(messageId, blocks, metadata)
    this.emitMessageRefresh(sessionId, messageId)
  }

  /**
   * Settle a turn aborted by stop/steer from the stream handler's *throw* (catch) branch: canceled
   * terminal block + terminal hooks + idle status. The return-path settles via applyProcessResultStatus
   * instead. The caller remains responsible for draining the queue.
   */
  private settleAbortedTurn(
    sessionId: string,
    messageId: string | null,
    runId?: string,
    metadata?: string
  ): void {
    this.writeCanceledTerminalBlock(sessionId, messageId, metadata)
    const usage = metadata ? buildUsageFromMetadata(parseMessageMetadata(metadata)) : undefined
    this.dispatchTerminalHooks(sessionId, this.getDeepChatRuntimeState(sessionId), {
      status: 'aborted',
      stopReason: 'user_stop',
      errorMessage: 'common.error.userCanceledGeneration',
      usage
    })
    const instance = this.getHydratedDeepChatInstance(sessionId)
    const activeGeneration = instance?.getActiveGeneration()
    const controller = instance?.getAbortController()
    const hasReplacementController = Boolean(
      controller && (!activeGeneration || controller !== activeGeneration.abortController)
    )
    const canSetIdle = runId
      ? activeGeneration?.runId === runId || (!activeGeneration && !hasReplacementController)
      : !hasReplacementController
    if (canSetIdle) {
      this.setSessionStatus(sessionId, 'idle')
    }
  }

  getActiveGeneration(sessionId: string): { eventId: string; runId: string } | null {
    const activeGeneration = this.getHydratedDeepChatInstance(sessionId)?.getActiveGeneration()
    if (!activeGeneration) {
      return null
    }

    return {
      eventId: activeGeneration.messageId,
      runId: activeGeneration.runId
    }
  }

  async cancelGenerationByEventId(sessionId: string, eventId: string): Promise<boolean> {
    const activeGeneration = this.getHydratedDeepChatInstance(sessionId)?.getActiveGeneration()
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
      this.hookNotificationObserver?.notify({
        event,
        context: {
          ...context,
          agentId: this.getSessionAgentId(context.sessionId) ?? 'deepchat'
        }
      })
    } catch (error) {
      console.warn(`[DeepChatAgent] Failed to dispatch ${event} hook:`, error)
    }
  }

  private getSessionAgentId(sessionId: string): string | undefined {
    const instance = this.deepChatRuntime.getHydrated(toAppSessionId(sessionId))
    const cached = instance?.getAgentId()?.trim()
    if (cached) {
      return cached
    }

    const persisted = this.sqlitePresenter.newSessionsTable?.get(sessionId)?.agent_id?.trim()
    if (persisted) {
      instance?.setAgentId(persisted)
      return persisted
    }

    return undefined
  }

  private isAcpBackedSubagentSession(sessionId: string, providerId?: string): boolean {
    const sessionRow = this.sqlitePresenter.newSessionsTable?.get(sessionId)
    if (!sessionRow || sessionRow.session_kind !== 'subagent') {
      return false
    }

    const resolvedProviderId =
      providerId?.trim() || this.getDeepChatRuntimeState(sessionId)?.providerId?.trim() || ''
    return resolvedProviderId === 'acp'
  }

  private shouldUseDeepChatContextBudget(
    providerId?: string | null,
    modelConfig?: Pick<ModelConfig, 'apiEndpoint' | 'endpointType' | 'type'> | null,
    modelId?: string | null
  ): boolean {
    if (providerId?.trim() === 'acp') {
      return false
    }

    if (!modelConfig) {
      return true
    }

    if (modelConfig.type === ModelType.ImageGeneration || modelConfig.type === ModelType.TTS) {
      return false
    }

    if (modelConfig.apiEndpoint && modelConfig.apiEndpoint !== ApiEndpointType.Chat) {
      return false
    }

    if (modelConfig.endpointType === 'image-generation') {
      return false
    }

    if (isVideoGenerationModelConfig(modelConfig, modelId?.trim() || '')) {
      return false
    }

    return true
  }

  private shouldBypassDeepChatContextBudget(
    providerId?: string | null,
    modelConfig?: Pick<ModelConfig, 'apiEndpoint' | 'endpointType' | 'type'> | null,
    modelId?: string | null
  ): boolean {
    return !this.shouldUseDeepChatContextBudget(providerId, modelConfig, modelId)
  }

  private resolveDeepChatContextBudgetLength(
    providerId: string | null | undefined,
    contextLength: number,
    modelConfig?: Pick<ModelConfig, 'apiEndpoint' | 'endpointType' | 'type'> | null,
    modelId?: string | null
  ): number {
    return this.shouldBypassDeepChatContextBudget(providerId, modelConfig, modelId)
      ? Number.MAX_SAFE_INTEGER
      : contextLength
  }

  private getAbortSignalForSession(sessionId: string): AbortSignal | undefined {
    return this.getHydratedDeepChatInstance(sessionId)?.getAbortSignal()
  }

  private ensureSessionAbortController(sessionId: string): AbortController {
    const instance = this.getDeepChatInstance(sessionId)
    const activeGeneration = instance.getActiveGeneration()
    if (activeGeneration) {
      if (!activeGeneration.abortController.signal.aborted) {
        return activeGeneration.abortController
      }
      // A just-cancelled run can linger in the map until its handler settles. Never hand an already
      // aborted controller to a fresh turn (it would abort immediately) — drop the stale run first.
      this.clearActiveGeneration(sessionId, activeGeneration.runId)
    }

    const existing = instance.getAbortController()
    if (existing) {
      existing.abort()
    }

    const controller = new AbortController()
    instance.setAbortController(controller)
    return controller
  }

  private clearSessionAbortController(sessionId: string, controller?: AbortController): void {
    this.getHydratedDeepChatInstance(sessionId)?.clearAbortController(controller)
  }

  private registerDeferredToolAbortController(
    sessionId: string,
    toolCallId: string
  ): AbortController {
    return this.getDeepChatInstance(sessionId).registerDeferredToolAbortController(toolCallId)
  }

  private clearDeferredToolAbortController(
    sessionId: string,
    toolCallId: string,
    controller?: AbortController
  ): void {
    this.getHydratedDeepChatInstance(sessionId)?.clearDeferredToolAbortController(
      toolCallId,
      controller
    )
  }

  private abortDeferredToolAbortControllers(sessionId: string): void {
    this.getHydratedDeepChatInstance(sessionId)?.abortDeferredToolCalls()
  }

  private throwIfAbortRequested(signal?: AbortSignal): void {
    if (signal?.aborted) {
      throw createAbortError()
    }
  }

  private isAbortError(error: unknown): boolean {
    return error instanceof Error && (error.name === 'AbortError' || error.name === 'CanceledError')
  }

  private toTapeAnchorResult(row: DeepChatTapeEntryRow): AgentTapeAnchorResult {
    const parseJsonObject = (raw: string): Record<string, unknown> => {
      try {
        const parsed = JSON.parse(raw) as unknown
        if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
          return parsed as Record<string, unknown>
        }
      } catch {}
      return {}
    }

    return {
      sessionId: row.session_id,
      entryId: row.entry_id,
      kind: row.kind,
      name: row.name,
      payload: parseJsonObject(row.payload_json),
      meta: parseJsonObject(row.meta_json),
      createdAt: row.created_at
    }
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

  async hasMessages(sessionId: string): Promise<boolean> {
    return this.messageStore.hasMessages(sessionId)
  }

  async getTapeInfo(sessionId: string): Promise<AgentTapeInfo> {
    this.tapeService.ensureSessionTapeReady(sessionId, this.messageStore)
    return this.tapeService.info(sessionId)
  }

  async searchTape(
    sessionId: string,
    query: string,
    options?: AgentTapeSearchOptions
  ): Promise<AgentTapeSearchResult[]> {
    this.tapeService.ensureSessionTapeReady(sessionId, this.messageStore)
    return this.tapeService.search(sessionId, query, options)
  }

  async getTapeContext(
    sessionId: string,
    entryIds: number[],
    options?: AgentTapeContextOptions
  ): Promise<AgentTapeContextResult> {
    this.tapeService.ensureSessionTapeReady(sessionId, this.messageStore)
    return this.tapeService.getContext(sessionId, entryIds, options)
  }

  async listTapeAnchors(
    sessionId: string,
    options?: AgentTapeAnchorsOptions
  ): Promise<AgentTapeAnchorResult[]> {
    this.tapeService.ensureSessionTapeReady(sessionId, this.messageStore)
    return this.tapeService.anchors(sessionId, options)
  }

  async handoffTape(
    sessionId: string,
    name: string,
    state: Record<string, unknown> = {}
  ): Promise<AgentTapeAnchorResult> {
    this.tapeService.ensureSessionTapeReady(sessionId, this.messageStore)
    const row = this.tapeService.handoff(sessionId, name, state)
    return this.toTapeAnchorResult(row)
  }

  async listMessageViewManifests(
    sessionId: string,
    messageId: string
  ): Promise<DeepChatTapeViewManifestRecord[]> {
    this.tapeService.ensureSessionTapeReady(sessionId, this.messageStore)
    return this.tapeService.listViewManifestsByMessage(sessionId, messageId)
  }

  async exportMessageTapeReplaySlice(
    sessionId: string,
    messageId: string,
    options?: DeepChatTapeReplayExportOptions
  ): Promise<DeepChatTapeReplaySlice | null> {
    this.tapeService.ensureSessionTapeReady(sessionId, this.messageStore)
    return this.tapeService.exportReplaySlice(sessionId, messageId, options)
  }

  async mergeSubagentTape(
    parentSessionId: string,
    childSessionId: string,
    meta: Record<string, unknown> = {}
  ): Promise<void> {
    this.tapeService.ensureSessionTapeReady(parentSessionId, this.messageStore)
    this.tapeService.ensureSessionTapeReady(childSessionId, this.messageStore)
    this.tapeService.recordExternalForkMerge(parentSessionId, childSessionId, childSessionId, meta)
  }

  async discardSubagentTape(
    parentSessionId: string,
    childSessionId: string,
    meta: Record<string, unknown> = {}
  ): Promise<void> {
    this.tapeService.ensureSessionTapeReady(parentSessionId, this.messageStore)
    this.tapeService.recordExternalForkDiscard(
      parentSessionId,
      childSessionId,
      childSessionId,
      meta
    )
  }

  async listMessagesPage(
    sessionId: string,
    options?: {
      limit?: number
      cursor?: MessagePageCursor | null
    }
  ): Promise<ChatMessagePageResult> {
    return this.messageStore.listMessagesPage(sessionId, options)
  }

  async getMessageIds(sessionId: string): Promise<string[]> {
    return this.messageStore.getMessageIds(sessionId)
  }

  async getMessage(messageId: string): Promise<ChatMessageRecord | null> {
    return this.messageStore.getMessage(messageId)
  }

  async getSessionCompactionState(sessionId: string): Promise<SessionCompactionState> {
    return await this.getSessionCompactionStateForInstance(sessionId)
  }

  private async getSessionCompactionStateForInstance(
    sessionId: string,
    expectedInstance?: DeepChatAgentInstance
  ): Promise<SessionCompactionState> {
    const hydratedInstance = expectedInstance ?? this.getHydratedDeepChatInstance(sessionId)
    const runtimeState = hydratedInstance?.getRuntimeState()
    const session = this.sessionStore.get(sessionId)
    if (!runtimeState && !session) {
      throw new Error(`Session ${sessionId} not found`)
    }
    const instance = hydratedInstance ?? this.getDeepChatInstance(sessionId)
    this.throwIfStaleDeepChatInstance(sessionId, instance)

    const persistedState = this.compactionRuntimeCoordinator.fromSummary(
      this.sessionStore.getSummaryState(sessionId)
    )
    const currentCompactionState = instance.getCompactionState()
    if (currentCompactionState?.status === 'compacting') {
      return currentCompactionState
    }

    if (
      currentCompactionState &&
      this.compactionRuntimeCoordinator.isSame(currentCompactionState, persistedState)
    ) {
      return currentCompactionState
    }

    instance.setCompactionState(persistedState)
    return { ...persistedState }
  }

  async compactSession(
    sessionId: string
  ): Promise<{ compacted: boolean; state: SessionCompactionState }> {
    const instance = this.getDeepChatInstance(sessionId)
    const state = instance.getRuntimeState() ?? (await this.getSessionListState(sessionId))
    if (!state) {
      throw new Error(`Session ${sessionId} not found`)
    }
    this.throwIfStaleDeepChatInstance(sessionId, instance)
    const modelConfig = this.configPresenter.getModelConfig(state.modelId, state.providerId)
    if (this.shouldBypassDeepChatContextBudget(state.providerId, modelConfig, state.modelId)) {
      throw new Error('Manual compaction is only available for DeepChat agent sessions.')
    }
    if (state.status !== 'idle') {
      throw new Error('Manual compaction is only available when the session is idle.')
    }
    if (this.hasPendingInteractions(sessionId)) {
      throw new Error('Pending tool interactions must be resolved before compacting.')
    }

    this.setSessionStatusForInstance(sessionId, instance, 'generating')
    const compactionAbortController = this.ensureSessionAbortController(sessionId)
    const compactionAbortSignal = compactionAbortController.signal
    try {
      this.throwIfAbortRequested(compactionAbortSignal)
      const generationSettings = await awaitWithAbort(
        this.getEffectiveSessionGenerationSettings(sessionId, instance),
        compactionAbortSignal
      )
      const interleavedReasoning = resolveInterleavedReasoningConfig(
        this.configPresenter,
        state.providerId,
        state.modelId,
        generationSettings
      )
      const contextBudgetLength = this.resolveDeepChatContextBudgetLength(
        state.providerId,
        generationSettings.contextLength,
        modelConfig,
        state.modelId
      )
      const maxTokens = capAgentRequestMaxTokens(generationSettings.maxTokens, contextBudgetLength)
      const activeSkillNames = await awaitWithAbort(
        this.toolResolver.resolveActiveSkillNamesForToolProfile(sessionId, instance),
        compactionAbortSignal
      )
      this.throwIfStaleDeepChatInstance(sessionId, instance)
      const projectDir = this.resolveProjectDir(sessionId, undefined, instance)
      const tools = await awaitWithAbort(
        this.toolResolver.loadToolDefinitionsForSession(
          sessionId,
          projectDir,
          activeSkillNames,
          instance
        ),
        compactionAbortSignal
      )
      const toolReserveTokens = estimateToolReserveTokens(tools)
      const baseSystemPrompt = await awaitWithAbort(
        this.createBasePromptAssembler(instance).assemble({
          sessionId: toAppSessionId(sessionId),
          configuredPrompt: generationSettings.systemPrompt,
          toolDefinitions: tools,
          activeSkillNames
        }),
        compactionAbortSignal
      )
      this.throwIfAbortRequested(compactionAbortSignal)
      const tapeReady = this.tapeService.ensureSessionTapeReady(sessionId, this.messageStore)

      const intent = await this.compactionService.prepareForManualCompaction({
        sessionId,
        providerId: state.providerId,
        modelId: state.modelId,
        systemPrompt: baseSystemPrompt,
        contextLength: generationSettings.contextLength,
        reserveTokens: maxTokens,
        extraReserveTokens: toolReserveTokens,
        supportsVision: this.supportsVision(state.providerId, state.modelId),
        supportsAudioInput: this.supportsAudioInput(state.providerId, state.modelId),
        preserveInterleavedReasoning: interleavedReasoning.preserveReasoningContent,
        preserveEmptyInterleavedReasoning:
          interleavedReasoning.preserveEmptyReasoningContent === true,
        historyRecords: tapeReady.historyRecords,
        signal: compactionAbortSignal
      })
      this.throwIfAbortRequested(compactionAbortSignal)
      this.throwIfStaleDeepChatInstance(sessionId, instance)

      if (!intent) {
        return {
          compacted: false,
          state: await this.getSessionCompactionStateForInstance(sessionId, instance)
        }
      }

      const summaryState = await this.applyCompactionIntent(
        sessionId,
        intent,
        { signal: compactionAbortSignal },
        instance
      )
      this.throwIfAbortRequested(compactionAbortSignal)
      this.throwIfStaleDeepChatInstance(sessionId, instance)
      const compacted = summaryState.summaryUpdatedAt !== intent.previousState.summaryUpdatedAt
      return {
        compacted,
        state: await this.getSessionCompactionStateForInstance(sessionId, instance)
      }
    } finally {
      const currentController = instance.getAbortController()
      const stillOwnsLifecycle =
        currentController === undefined || currentController === compactionAbortController
      this.clearSessionAbortController(sessionId, compactionAbortController)
      if (stillOwnsLifecycle) {
        this.setSessionStatusForInstance(sessionId, instance, 'idle')
      }
    }
  }

  async clearMessages(sessionId: string): Promise<void> {
    const instance = this.getDeepChatInstance(sessionId)
    const state = await this.getSessionState(sessionId)
    if (!state) {
      throw new Error(`Session ${sessionId} not found`)
    }
    this.throwIfStaleDeepChatInstance(sessionId, instance)

    await this.cancelGeneration(sessionId)
    this.throwIfStaleDeepChatInstance(sessionId, instance)
    this.pendingInputCoordinator.deleteBySession(sessionId)
    this.clearFirstTurnReady(sessionId)
    this.memoryCoordinator.resetExtractionCursor(sessionId)
    this.memoryCoordinator.clearProjectionRetry(sessionId)
    this.messageStore.deleteBySession(sessionId)
    instance.replacePendingInteractions([])
    this.sessionStore.resetTape(sessionId)
    this.compactionRuntimeCoordinator.reset(sessionId, instance)
    this.setSessionStatusForInstance(sessionId, instance, 'idle')
  }

  async retryMessage(sessionId: string, messageId: string): Promise<void> {
    const prepared = await this.prepareRetryMessage(sessionId, messageId)
    await this.processMessage(sessionId, prepared.content, {
      projectDir: prepared.projectDir,
      emitRefreshBeforeStream: true
    })
  }

  async prepareRetryMessage(
    sessionId: string,
    messageId: string
  ): Promise<{ content: SendMessageInput; projectDir: string | null }> {
    const instance = this.getDeepChatInstance(sessionId)
    const state = await this.getSessionState(sessionId)
    if (!state) {
      throw new Error(`Session ${sessionId} not found`)
    }
    this.throwIfStaleDeepChatInstance(sessionId, instance)
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
    this.throwIfStaleDeepChatInstance(sessionId, instance)

    const retryInput = extractUserMessageInput(sourceUserMessage.content)
    if (!retryInput.text.trim()) {
      throw new Error('Cannot retry an empty user message.')
    }

    this.compactionRuntimeCoordinator.invalidateIfNeeded(
      sessionId,
      sourceUserMessage.orderSeq,
      instance
    )
    this.memoryCoordinator.invalidateFromOrderSeq(sessionId, sourceUserMessage.orderSeq)
    this.messageStore.deleteFromOrderSeq(sessionId, sourceUserMessage.orderSeq)
    return {
      content: retryInput,
      projectDir: this.resolveProjectDir(sessionId, undefined, instance)
    }
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
    const instance = this.getDeepChatInstance(sessionId)

    await this.cancelGeneration(sessionId)
    this.throwIfStaleDeepChatInstance(sessionId, instance)
    this.compactionRuntimeCoordinator.invalidateIfNeeded(sessionId, target.orderSeq, instance)
    this.memoryCoordinator.invalidateFromOrderSeq(sessionId, target.orderSeq)
    this.messageStore.deleteFromOrderSeq(sessionId, target.orderSeq)
    this.refreshPendingInteractionsFromStore(sessionId)
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
    const instance = this.getDeepChatInstance(sessionId)

    const nextContent = buildEditedUserContent(target.content, nextText)
    this.compactionRuntimeCoordinator.invalidateIfNeeded(sessionId, target.orderSeq, instance)
    this.memoryCoordinator.invalidateFromOrderSeq(sessionId, target.orderSeq)
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

    const targetInstance = this.getDeepChatInstance(targetSessionId)
    this.messageStore.cloneSentMessagesToSession(sourceSessionId, targetSessionId, target.orderSeq)
    this.compactionRuntimeCoordinator.reset(targetSessionId, targetInstance)
  }

  private async runStreamForMessage(args: {
    sessionId: string
    messageId: string
    messages: ChatMessage[]
    projectDir: string | null
    resourceInstance?: DeepChatAgentInstance
    tools?: MCPToolDefinition[]
    baseSystemPrompt?: string
    initialBlocks?: AssistantMessageBlock[]
    initialAccounting?: MessageMetadata
    promptPreview?: string
    interleavedReasoning?: InterleavedReasoningConfig
    viewContext?: PendingTapeViewContext
    refreshSystemPrompt?: (
      activeSkillNames: string[] | undefined,
      toolDefinitions: MCPToolDefinition[]
    ) => Promise<string>
    maxProviderRounds?: number
    onBeforeProviderStream?: () => void
    onRunRegistered?: (runId: string) => void
    abortController?: AbortController
  }): Promise<{ runId: string; result: ProcessResult }> {
    const {
      sessionId,
      messageId,
      messages,
      projectDir,
      resourceInstance: providedResourceInstance,
      tools: providedTools,
      baseSystemPrompt,
      initialBlocks,
      initialAccounting,
      promptPreview,
      interleavedReasoning: providedInterleavedReasoning,
      viewContext,
      refreshSystemPrompt,
      maxProviderRounds,
      onBeforeProviderStream,
      onRunRegistered,
      abortController: providedAbortController
    } = args
    const resourceInstance = providedResourceInstance ?? this.getDeepChatInstance(sessionId)
    this.throwIfStaleDeepChatInstance(sessionId, resourceInstance)
    const abortController = providedAbortController ?? this.ensureSessionAbortController(sessionId)
    const abortSignal = abortController.signal
    this.throwIfAbortRequested(abortSignal)
    const state = resourceInstance.getRuntimeState()
    if (!state) {
      throw new Error(`Session ${sessionId} not found`)
    }
    if (messages.length === 0) {
      throw new Error('Request was not sent because the prompt is empty.')
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

    const generationSettings = await awaitWithAbort(
      this.getEffectiveSessionGenerationSettings(sessionId, resourceInstance),
      abortSignal
    )
    const baseModelConfig = this.configPresenter.getModelConfig(state.modelId, state.providerId)
    const interleavedReasoning =
      providedInterleavedReasoning ??
      resolveInterleavedReasoningConfig(
        this.configPresenter,
        state.providerId,
        state.modelId,
        generationSettings
      )
    const contextBudgetLength = this.resolveDeepChatContextBudgetLength(
      state.providerId,
      generationSettings.contextLength,
      baseModelConfig,
      state.modelId
    )
    const capabilityProviderId = resolveCapabilityProviderId(
      this.configPresenter,
      state.providerId,
      state.modelId
    )
    const reasoningPortrait = getReasoningPortrait(
      this.configPresenter,
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
      reasoning: getReasoningEffectiveEnabledForProvider(capabilityProviderId, reasoningPortrait, {
        reasoning: baseModelConfig.reasoning,
        reasoningEffort: generationSettings.reasoningEffort ?? baseModelConfig.reasoningEffort
      }),
      conversationId: sessionId
    }

    const traceEnabled = this.configPresenter.getSetting<boolean>('traceDebugEnabled') === true
    const llmProviderPresenter = this.llmProviderPresenter
    const shouldBypassContextBudget = this.shouldBypassDeepChatContextBudget.bind(this)
    const recoverContextPressure = this.recoverRequestContextPressure.bind(this)
    const contextCoordinator = this.contextCoordinator
    const persistMessageTrace = this.persistMessageTrace.bind(this)
    const appendTapeViewManifest = this.appendTapeViewManifest.bind(this)
    const initialRequestSeq = Math.max(
      this.tapeService.listViewManifestsByMessage(sessionId, messageId)[0]?.requestSeq ?? 0,
      this.messageStore.getMaxMessageTraceRequestSeq(messageId)
    )

    const temperature = generationSettings.temperature
    const maxTokens = capAgentRequestMaxTokens(generationSettings.maxTokens, contextBudgetLength)

    const streamSessionActiveSkillNames = await awaitWithAbort(
      this.toolResolver.resolveActiveSkillNamesForToolProfile(sessionId, resourceInstance),
      abortSignal
    )
    this.throwIfStaleDeepChatInstance(sessionId, resourceInstance)
    const streamExtensionPolicy = await awaitWithAbort(
      this.toolResolver.resolveAgentExtensionPolicy(sessionId, resourceInstance),
      abortSignal
    )
    this.throwIfStaleDeepChatInstance(sessionId, resourceInstance)
    const getEffectiveRuntimeSkillNames = (baseSkillNames = streamSessionActiveSkillNames) =>
      resolveEffectiveActiveSkillNames(baseSkillNames, resourceInstance)
    const toolCatalog = this.toolResolver.createSessionToolCatalogPort(
      sessionId,
      projectDir,
      resourceInstance
    )
    const tools =
      providedTools ??
      (await awaitWithAbort(
        toolCatalog.resolve({ activeSkillNames: getEffectiveRuntimeSkillNames() }),
        abortSignal
      ))
    this.throwIfStaleDeepChatInstance(sessionId, resourceInstance)
    const supportsVision = this.supportsVision(state.providerId, state.modelId)
    const supportsAudioInput = this.supportsAudioInput(state.providerId, state.modelId)

    abortController.signal.throwIfAborted()
    const loopRun = createLoopRun<StreamState>({
      runId: `${sessionId}:${++this.nextRunSequence}`,
      sessionId: toAppSessionId(sessionId),
      messageId,
      abortController,
      messages,
      streamState: createState(),
      resources: {
        toolDefinitions: tools,
        activeSkillNames: getEffectiveRuntimeSkillNames()
      },
      initialRequestSeq
    })
    const activeGeneration = this.registerActiveGeneration(sessionId, loopRun, resourceInstance)
    onRunRegistered?.(activeGeneration.runId)
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
            payload,
            requestSeq: loopRun.requestSeq
          })
        }
      }
    }
    const rateLimitMessageId = this.buildRateLimitStreamMessageId(activeGeneration.runId)
    const emitRateLimitWaitingMessage = this.emitRateLimitWaitingMessage.bind(this)
    const clearRateLimitWaitingMessage = this.clearRateLimitWaitingMessage.bind(this)
    let crossedPreStreamBoundary = false
    const crossPreStreamBoundary = () => {
      if (crossedPreStreamBoundary) return
      crossedPreStreamBoundary = true
      onBeforeProviderStream?.()
    }

    try {
      this.dispatchHook('SessionStart', {
        sessionId,
        messageId,
        promptPreview,
        providerId: state.providerId,
        modelId: state.modelId,
        projectDir
      })

      let reviewConversationMessages = messages
      const result = await processStream({
        run: loopRun,
        onConversationMessagesChange: (nextMessages) => {
          reviewConversationMessages = nextMessages
        },
        maxProviderRounds,
        toolCatalog,
        refreshSystemPrompt: async (activeSkillNames, refreshedTools) => {
          if (refreshSystemPrompt) {
            return await refreshSystemPrompt(
              getEffectiveRuntimeSkillNames(activeSkillNames),
              refreshedTools
            )
          }
          return await this.createBasePromptAssembler(resourceInstance).assemble({
            sessionId: toAppSessionId(sessionId),
            configuredPrompt: generationSettings.systemPrompt,
            toolDefinitions: refreshedTools,
            activeSkillNames: getEffectiveRuntimeSkillNames(activeSkillNames)
          })
        },
        toolExecution: this.toolExecutionPort,
        toolResults: this.toolResultPort,
        coreStream: async function* (
          requestMessages,
          requestModelId,
          requestModelConfig,
          requestTemperature,
          requestMaxTokens,
          requestTools,
          onProviderRequestStart,
          assertProviderRequestAvailable
        ) {
          const requestBypassesContextBudget = shouldBypassContextBudget(
            state.providerId,
            requestModelConfig,
            requestModelId
          )
          const isTtsRequest = isTtsModelConfig(requestModelConfig) || isTtsModelId(requestModelId)
          const effectiveRequestTools: MCPToolDefinition[] = isTtsRequest ? [] : requestTools
          let queuedForRateLimit = false
          yield* contextCoordinator.streamProviderAttempts({
            run: loopRun,
            requestMessages,
            modelId: requestModelId,
            modelConfig: requestModelConfig,
            temperature: requestTemperature,
            maxTokens: requestMaxTokens,
            tools: effectiveRequestTools,
            bypassContextBudget: requestBypassesContextBudget,
            fallbackContextLength: contextBudgetLength,
            supportsVision,
            supportsAudioInput,
            traceDebugEnabled: traceEnabled,
            viewContext,
            budget: {
              estimateToolReserveTokens,
              preflight: ({ messages, tools, requestedMaxTokens }) =>
                preflightRequestContext({
                  messages,
                  tools,
                  contextLength: requestModelConfig.contextLength,
                  requestedMaxTokens
                }),
              fitStrictRetry: ({ messages, reserveTokens }) =>
                fitRequestMessagesToContextWindow({
                  messages,
                  contextLength: requestModelConfig.contextLength,
                  reserveTokens,
                  minimumProtectedTailCount: 0
                }),
              getStrictRetryMaxTokens: getProviderOverflowRetryMaxTokens,
              getStrictRetryExtraReserve: () =>
                getProviderOverflowRetryExtraReserve(requestModelConfig.contextLength),
              buildOverflowError: (preflight) =>
                new Error(buildRequestContextOverflowErrorMessage(preflight)),
              buildOverflowAfterRecoveryError: (preflight) =>
                new Error(buildProviderContextOverflowAfterRecoveryErrorMessage(preflight))
            },
            recovery: {
              recover: async ({ requestMessages, requestedMaxTokens, tools }) =>
                await recoverContextPressure({
                  sessionId,
                  providerId: state.providerId,
                  modelId: requestModelId,
                  requestMessages,
                  baseSystemPrompt,
                  contextLength: requestModelConfig.contextLength,
                  requestedMaxTokens,
                  tools,
                  supportsVision,
                  supportsAudioInput,
                  interleavedReasoning,
                  minimumProtectedTailCount: 0,
                  signal: abortController.signal,
                  expectedInstance: resourceInstance
                })
            },
            manifest: {
              resolvePolicy: resolveTapeViewManifestPolicy,
              append: (manifest) =>
                appendTapeViewManifest({
                  sessionId,
                  messageId,
                  ...manifest,
                  providerId: state.providerId,
                  modelId: requestModelId
                }),
              onAppendError: (error) =>
                logger.warn(
                  `[DeepChatAgent] Failed to persist tape view manifest: ${
                    error instanceof Error ? error.message : String(error)
                  }`
                )
            },
            rateGate: {
              beforeWait: crossPreStreamBoundary,
              wait: async (signal) => {
                await llmProviderPresenter.executeWithRateLimit(state.providerId, {
                  signal,
                  onQueued: (snapshot) => {
                    queuedForRateLimit = true
                    emitRateLimitWaitingMessage(
                      sessionId,
                      rateLimitMessageId,
                      activeGeneration.runId,
                      snapshot
                    )
                  }
                })
              },
              clearWaiting: () => {
                if (!queuedForRateLimit) {
                  return
                }
                clearRateLimitWaitingMessage(sessionId, rateLimitMessageId, activeGeneration.runId)
                queuedForRateLimit = false
              }
            },
            provider: {
              assertAvailable: assertProviderRequestAvailable,
              stream: ({ messages, modelId, modelConfig, temperature, maxTokens, tools }) =>
                provider.coreStream(messages, modelId, modelConfig, temperature, maxTokens, tools),
              beforeStream: () => {
                onProviderRequestStart?.()
                crossPreStreamBoundary()
              }
            },
            isContextOverflowEvent: isFirstProviderContextOverflowEvent,
            isContextOverflowError: isContextWindowErrorLike,
            createAbortError
          })
        },
        coreStreamReportsProviderStart: true,
        providerId: state.providerId,
        modelId: state.modelId,
        modelConfig,
        temperature,
        maxTokens,
        interleavedReasoning,
        permissionMode: state.permissionMode,
        initialBlocks,
        initialAccounting,
        onFirstProviderRoundReady: () => {
          if (
            !abortController.signal.aborted &&
            this.isActiveRun(sessionId, activeGeneration.runId)
          ) {
            this.markFirstTurnReady(sessionId)
          }
        },
        shouldYieldForPendingInput: () =>
          Boolean(this.pendingInputCoordinator.getNextSteerInput(sessionId)),
        notificationObserver: {
          notify: (notification) => {
            this.dispatchHook(notification.event, {
              sessionId,
              messageId,
              providerId: state.providerId,
              modelId: state.modelId,
              projectDir,
              tool: { ...notification.tool },
              permission:
                notification.event === 'PermissionRequest' ? { ...notification.permission } : null
            })
          }
        },
        controls: {
          getActiveSkillNames: () => getEffectiveRuntimeSkillNames(),
          getEnabledSkillNames: () =>
            this.toolResolver.normalizeNullablePolicyList(streamExtensionPolicy.enabledSkillNames),
          getEnabledMcpServerIds: () =>
            this.toolResolver.normalizeNullablePolicyList(
              streamExtensionPolicy.enabledMcpServerIds
            ),
          getAgentId: () =>
            resourceInstance.getAgentId()?.trim() ||
            this.getSessionAgentId(sessionId) ||
            'deepchat',
          activateSkill: async (skillName) => {
            const policy = await this.toolResolver.resolveAgentExtensionPolicy(
              sessionId,
              resourceInstance
            )
            if (filterSkillNamesByPolicy([skillName], policy).length === 0) {
              return getEffectiveRuntimeSkillNames()
            }
            resourceInstance.activateRuntimeSkill(skillName)
            return getEffectiveRuntimeSkillNames()
          },
          onStreamingProviderPermission: (permission, tool, commitDecision) => {
            this.providerPermissionCoordinator.register(
              sessionId,
              messageId,
              permission,
              tool,
              commitDecision
            )
          },
          autoGrantPermission: async (permission) => {
            await this.requireSessionPermissionPort().approvePermission(sessionId, permission)
          },
          reviewToolPermission: async (request) =>
            await this.reviewToolPermissionForAutoApprove(request, {
              providerId: state.providerId,
              modelId: state.modelId,
              messages: reviewConversationMessages.slice(-AUTO_APPROVE_REVIEW_MAX_RECENT_MESSAGES),
              signal: abortController.signal
            }),
          cacheImage: this.cacheImage
        },
        diagnostics: {
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
              requestSeq: 0,
              payload: {
                endpoint: 'deepchat://interleaved-reasoning-gap',
                headers: {},
                body: gap
              }
            })
          }
        },
        io: {
          messageStore: this.messageStore,
          tapeRecorder: this.tapeService
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

  private appendTapeViewManifest(params: {
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
  }): void {
    const sourceMaps = this.tapeService.getViewManifestSourceMaps(
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
    this.tapeService.appendViewManifest(manifest)
  }

  private async recoverRequestContextPressure(params: {
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
    expectedInstance: DeepChatAgentInstance
  }): Promise<{ messages: ChatMessage[]; systemPrompt?: string; summaryCursorOrderSeq?: number }> {
    const toolReserveTokens = estimateToolReserveTokens(params.tools)
    return await this.contextCoordinator.recoverFromPressure<SessionSummaryState>({
      requestMessages: params.requestMessages,
      baseSystemPrompt: params.baseSystemPrompt,
      requestedMaxTokens: params.requestedMaxTokens,
      toolReserveTokens,
      minimumProtectedTailCount: params.minimumProtectedTailCount,
      prepareCompaction: async (systemPrompt) => {
        const prepared = await this.inputPreparationCoordinator.prepareExisting({
          ensureHistory: () =>
            this.tapeService.ensureSessionTapeReady(params.sessionId, this.messageStore)
              .historyRecords,
          prepareIntent: async (historyRecords) =>
            await this.compactionService.prepareForContextPressureRecovery({
              sessionId: params.sessionId,
              providerId: params.providerId,
              modelId: params.modelId,
              systemPrompt,
              contextLength: params.contextLength,
              reserveTokens: params.requestedMaxTokens,
              extraReserveTokens: toolReserveTokens,
              supportsVision: params.supportsVision,
              supportsAudioInput: params.supportsAudioInput,
              preserveInterleavedReasoning: params.interleavedReasoning.preserveReasoningContent,
              preserveEmptyInterleavedReasoning:
                params.interleavedReasoning.preserveEmptyReasoningContent === true,
              projectedMessages: this.withoutLeadingSystemMessage(params.requestMessages),
              historyRecords,
              signal: params.signal
            }),
          applyCompaction: async (intent) =>
            await this.applyCompactionIntent(
              params.sessionId,
              intent,
              { signal: params.signal },
              params.expectedInstance
            ),
          readSummary: () => this.sessionStore.getSummaryState(params.sessionId),
          afterCompactionApplyReturned: (intent) =>
            this.memoryIngestionObserver.afterCompactionApplyReturned({
              session: params.expectedInstance.getMemorySessionHandle(),
              origin: 'context-pressure',
              targetCursorOrderSeq: intent.targetCursorOrderSeq
            }),
          checkpoints: {
            assertCurrent: () =>
              this.throwIfStaleDeepChatInstance(params.sessionId, params.expectedInstance)
          }
        })
        return prepared.intent ? { applied: true, summary: prepared.summary } : { applied: false }
      },
      assemblePostCompactionPrompt: async (summaryState, systemPrompt) =>
        await this.postCompactionPromptAssembler.assemble({
          memorySession: params.expectedInstance.getMemorySessionHandle(),
          basePrompt: systemPrompt,
          summaryText: summaryState.summaryText,
          reconstructionAnchor: this.sessionStore.getReconstructionAnchorPromptState(
            params.sessionId
          ),
          memoryQuery: this.memoryCoordinator.getLatestUserQuery(params.sessionId),
          memoryMessageId: null
        }),
      getSummaryCursorOrderSeq: (summaryState) => summaryState.summaryCursorOrderSeq,
      fit: ({ messages, reserveTokens, minimumProtectedTailCount }) =>
        fitRequestMessagesToContextWindow({
          messages,
          contextLength: params.contextLength,
          reserveTokens,
          minimumProtectedTailCount
        }),
      assertCurrent: () =>
        this.throwIfStaleDeepChatInstance(params.sessionId, params.expectedInstance)
    })
  }

  private withoutLeadingSystemMessage(messages: ChatMessage[]): ChatMessage[] {
    return messages[0]?.role === 'system' ? messages.slice(1) : messages
  }

  private async drainPendingQueueIfPossible(
    sessionId: string,
    reason: 'enqueue' | 'completed'
  ): Promise<boolean> {
    const state = await this.getSessionState(sessionId)
    if (!state || !this.canStartPendingQueueDrain(sessionId, state.status, reason)) {
      return false
    }
    const instance = this.getHydratedDeepChatInstance(sessionId)
    if (!instance) {
      return false
    }

    const nextSteerInput = this.pendingInputCoordinator.getNextSteerInput(sessionId)
    const nextQueuedInput = nextSteerInput
      ? null
      : this.pendingInputCoordinator.getNextQueuedInput(sessionId)
    const nextPendingInput = nextSteerInput ?? nextQueuedInput
    if (!nextPendingInput) {
      return false
    }

    const pendingInputSource: ProcessPendingInputSource = nextSteerInput ? 'steer' : 'queue'
    let claimedInput: PendingSessionInputRecord

    instance.markPendingQueueDrainStarted()
    try {
      claimedInput =
        pendingInputSource === 'steer'
          ? this.pendingInputCoordinator.claimSteerInput(sessionId, nextPendingInput.id)
          : this.pendingInputCoordinator.claimQueuedInput(sessionId, nextPendingInput.id)
    } catch (error) {
      instance.markPendingQueueDrainFinished()
      console.error('[DeepChatAgent] drainPendingQueueIfPossible error:', error)
      return false
    }

    if (pendingInputSource === 'steer') {
      instance.clearActiveSteerPendingInputId()
    }

    void this.processMessage(sessionId, claimedInput.payload, {
      projectDir: this.resolveProjectDir(sessionId),
      pendingQueueItemId: claimedInput.id,
      pendingQueueItemSource: pendingInputSource
    })
      .catch((error) => {
        console.error('[DeepChatAgent] drainPendingQueueIfPossible error:', error)
      })
      .finally(async () => {
        instance.markPendingQueueDrainFinished()
        try {
          if (
            this.pendingInputCoordinator.hasPendingTurnInput(sessionId) &&
            (await this.getSessionState(sessionId))?.status === 'idle' &&
            !this.hasPendingInteractions(sessionId)
          ) {
            void this.drainPendingQueueIfPossible(sessionId, 'completed')
          }
        } catch (error) {
          console.error('[DeepChatAgent] drainPendingQueueIfPossible cleanup error:', error)
        }
      })

    return true
  }

  private shouldStartQueuedInputImmediately(
    sessionId: string,
    status: DeepChatSessionState['status']
  ): boolean {
    if (!this.canStartPendingQueueDrain(sessionId, status, 'enqueue')) {
      return false
    }
    return !this.pendingInputCoordinator.hasPendingTurnInput(sessionId)
  }

  private canStartPendingQueueDrain(
    sessionId: string,
    status: DeepChatSessionState['status'],
    reason: 'enqueue' | 'completed'
  ): boolean {
    if (!this.canDrainPendingQueueFromStatus(status, reason)) {
      return false
    }
    if (this.isAwaitingToolQuestionFollowUp(sessionId)) {
      return false
    }
    if (this.hasPendingInteractions(sessionId)) {
      return false
    }
    if (this.getHydratedDeepChatInstance(sessionId)?.isPendingQueueDraining()) {
      return false
    }
    return true
  }

  private canDrainPendingQueueFromStatus(
    status: DeepChatSessionState['status'],
    reason: 'enqueue' | 'completed'
  ): boolean {
    if (status === 'idle') {
      return true
    }

    return reason === 'enqueue' && status === 'error'
  }

  private rollbackClaimedPendingInputTurn(
    sessionId: string,
    pendingQueueItemId: string,
    pendingInputSource: ProcessPendingInputSource,
    userMessageId: string | null,
    expectedInstance = this.getDeepChatInstance(sessionId)
  ): void {
    this.throwIfStaleDeepChatInstance(sessionId, expectedInstance)
    const userMessage = userMessageId ? this.messageStore.getMessage(userMessageId) : null
    if (userMessage) {
      this.compactionRuntimeCoordinator.invalidateIfNeeded(
        sessionId,
        userMessage.orderSeq,
        expectedInstance
      )
      this.memoryCoordinator.invalidateFromOrderSeq(sessionId, userMessage.orderSeq)
      this.messageStore.deleteFromOrderSeq(sessionId, userMessage.orderSeq)
    }
    this.releaseClaimedPendingInput(sessionId, pendingQueueItemId, pendingInputSource)
  }

  private consumeClaimedPendingInput(
    sessionId: string,
    pendingInputId: string,
    pendingInputSource: ProcessPendingInputSource
  ): void {
    if (pendingInputSource === 'steer') {
      this.pendingInputCoordinator.consumeSteerInput(sessionId, pendingInputId)
      return
    }
    this.pendingInputCoordinator.consumeQueuedInput(sessionId, pendingInputId)
  }

  private releaseClaimedPendingInput(
    sessionId: string,
    pendingInputId: string,
    pendingInputSource: ProcessPendingInputSource
  ): void {
    if (pendingInputSource === 'steer') {
      this.pendingInputCoordinator.releaseClaimedInput(sessionId, pendingInputId)
      return
    }
    this.pendingInputCoordinator.releaseClaimedQueueInput(sessionId, pendingInputId)
  }

  private registerActiveGeneration(
    sessionId: string,
    run: LoopRun<StreamState>,
    expectedInstance = this.getDeepChatInstance(sessionId)
  ): LoopRun<StreamState> {
    this.throwIfStaleDeepChatInstance(sessionId, expectedInstance)
    return expectedInstance.registerActiveGeneration(run)
  }

  private clearActiveGeneration(sessionId: string, runId: string): void {
    if (this.getHydratedDeepChatInstance(sessionId)?.clearActiveGeneration(runId)) {
      this.providerPermissionCoordinator.clearSession(sessionId)
    }
  }

  private isActiveRun(sessionId: string, runId: string): boolean {
    return this.getHydratedDeepChatInstance(sessionId)?.isActiveRun(runId) ?? false
  }

  private buildRateLimitStreamMessageId(runId: string): string {
    return `${RATE_LIMIT_STREAM_MESSAGE_PREFIX}${runId}`
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
    const renderedBlocks = cloneBlocksForRenderer([block])

    publishDeepchatEvent('chat.stream.updated', {
      kind: 'snapshot',
      requestId,
      sessionId,
      messageId,
      updatedAt: Date.now(),
      blocks: renderedBlocks
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

  private resolveStreamRequestId(sessionId: string, messageId: string): string {
    const activeGeneration = this.getHydratedDeepChatInstance(sessionId)?.getActiveGeneration()
    if (activeGeneration?.messageId === messageId) {
      return activeGeneration.runId
    }

    return messageId
  }

  private applyProcessResultStatus(
    sessionId: string,
    result: ProcessResult | null | undefined,
    runId?: string
  ): void {
    // Terminal hooks describe the run that just ended, so they fire even if a newer run has since
    // become the active one. Session status, however, must not be clobbered by a stale run — guard it.
    const isActive = !runId || this.isActiveRun(sessionId, runId)
    const state = this.getDeepChatRuntimeState(sessionId)
    if (!result || !result.status) {
      if (isActive) {
        this.getHydratedDeepChatInstance(sessionId)?.replacePendingInteractions([])
        this.setSessionStatus(sessionId, 'idle')
      }
      return
    }
    if (result.status === 'paused') {
      if (isActive) {
        const instance = this.getHydratedDeepChatInstance(sessionId)
        if (instance && result.toolBatchExecutionState) {
          instance.replacePendingToolBatch(
            result.pendingInteractions ?? [],
            result.toolBatchExecutionState
          )
        } else {
          instance?.replacePendingInteractions(result.pendingInteractions ?? [])
        }
        this.setSessionStatus(sessionId, 'generating')
      }
      return
    }
    if (result.status === 'completed') {
      this.dispatchTerminalHooks(sessionId, state, result)
      if (isActive) {
        this.getHydratedDeepChatInstance(sessionId)?.replacePendingInteractions([])
        this.setSessionStatus(sessionId, 'idle')
      }
      return
    }
    if (result.status === 'aborted') {
      this.dispatchTerminalHooks(sessionId, state, result)
      if (isActive) {
        this.getHydratedDeepChatInstance(sessionId)?.replacePendingInteractions([])
        this.setSessionStatus(sessionId, 'idle')
      }
      return
    }
    this.dispatchTerminalHooks(sessionId, state, result)
    if (isActive) {
      this.getHydratedDeepChatInstance(sessionId)?.replacePendingInteractions([])
      this.setSessionStatus(sessionId, 'error')
    }
  }

  private async resumeAssistantMessage(
    sessionId: string,
    messageId: string,
    initialBlocks: AssistantMessageBlock[],
    budgetToolCall?: ResumeBudgetToolCall | null,
    initialAccounting?: MessageMetadata
  ): Promise<boolean> {
    const instance = this.getDeepChatInstance(sessionId)
    if (!instance.tryBeginResume(messageId)) {
      return false
    }
    let preStreamAbortController: AbortController | null = null
    let preStreamAbortSignal: AbortSignal | undefined
    let streamRunId: string | undefined
    const resumeAccounting =
      initialAccounting ??
      parseMessageMetadata(this.messageStore.getMessage(messageId)?.metadata ?? '{}')

    try {
      this.throwIfStaleDeepChatInstance(sessionId, instance)
      const state = instance.getRuntimeState()
      if (!state) {
        throw new Error(`Session ${sessionId} not found`)
      }

      this.setSessionStatusForInstance(sessionId, instance, 'generating')
      preStreamAbortController = this.ensureSessionAbortController(sessionId)
      preStreamAbortSignal = preStreamAbortController.signal
      const preStreamStartedAt = Date.now()
      const supportsVision = this.supportsVision(state.providerId, state.modelId)
      const supportsAudioInput = this.supportsAudioInput(state.providerId, state.modelId)
      const projectDir = this.resolveProjectDir(sessionId, undefined, instance)
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
      const preparedInput = await this.inputPreparationCoordinator.prepareExisting({
        ensureHistory: () =>
          this.runSynchronousPreStreamStep(
            sessionId,
            'tape-ready',
            () =>
              this.tapeService.ensureSessionTapeReady(sessionId, this.messageStore).historyRecords
          ),
        refreshHistory: () =>
          this.runSynchronousPreStreamStep(
            sessionId,
            'tape-ready',
            () =>
              this.tapeService.ensureSessionTapeReady(sessionId, this.messageStore).historyRecords
          ),
        prepareIntent: async (historyRecords) => {
          resumeTargetOrderSeq =
            historyRecords.find((record) => record.id === messageId)?.orderSeq ??
            this.messageStore.getMessage(messageId)?.orderSeq
          if (!useContextBudget) {
            return null
          }
          return await this.runPreStreamStep(
            { sessionId, messageId, step: 'compaction-prepare', signal: preStreamAbortSignal },
            () =>
              this.compactionService.prepareForResumeTurn({
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
          await this.runPreStreamStep(
            {
              sessionId,
              messageId,
              step: 'compaction-apply',
              signal: preStreamAbortSignal
            },
            () =>
              this.applyCompactionIntent(
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
        readSummary: () => this.sessionStore.getSummaryState(sessionId),
        checkpoints: {
          assertCurrent: () => this.throwIfStaleDeepChatInstance(sessionId, instance),
          beforeHistoryRefresh: () => {
            this.throwIfStaleDeepChatInstance(sessionId, instance)
            this.throwIfAbortRequested(preStreamAbortSignal)
          }
        }
      })
      const summaryState = preparedInput.summary
      this.throwIfAbortRequested(preStreamAbortSignal)
      const preparedContext = await this.contextCoordinator.assemble({
        assemblePostCompactionPrompt: async () =>
          await this.runPreStreamStep(
            { sessionId, messageId, step: 'memory-injection', signal: preStreamAbortSignal },
            () =>
              awaitWithAbort(
                this.postCompactionPromptAssembler.assemble({
                  memorySession: instance.getMemorySessionHandle(),
                  basePrompt: baseSystemPrompt,
                  summaryText: summaryState.summaryText,
                  reconstructionAnchor:
                    this.sessionStore.getReconstructionAnchorPromptState(sessionId),
                  memoryQuery: this.memoryCoordinator.getLatestUserQuery(sessionId),
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
            messageStore: this.messageStore,
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
          this.logSlowPreStreamStep(sessionId, 'context-build', contextBuildStartedAt)
          return contextBuild
        },
        assertCurrent: () => this.throwIfStaleDeepChatInstance(sessionId, instance)
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
          await this.runPreStreamStep({ sessionId, messageId, step: 'tool-output-cleanup' }, () =>
            this.toolOutputGuard.cleanupOffloadedOutput(budgetToolCall.offloadPath)
          )
          this.throwIfStaleDeepChatInstance(sessionId, instance)
          updateToolCallResponse(initialBlocks, budgetToolCall.id, resumeBudget.message, true)
          this.messageStore.updateAssistantContent(messageId, initialBlocks)
          this.emitMessageRefresh(sessionId, messageId)
          resumeContext = this.toolOutputGuard.replaceToolMessageContent(
            resumeContext,
            budgetToolCall.id,
            resumeBudget.message
          )
        } else if (resumeBudget?.kind === 'terminal_error') {
          await this.runPreStreamStep({ sessionId, messageId, step: 'tool-output-cleanup' }, () =>
            this.toolOutputGuard.cleanupOffloadedOutput(budgetToolCall.offloadPath)
          )
          this.throwIfStaleDeepChatInstance(sessionId, instance)
          updateToolCallResponse(initialBlocks, budgetToolCall.id, resumeBudget.message, true)
          const terminalMetadata = stampTerminalMetadata(
            resumeAccounting,
            'error',
            'context_window'
          )
          this.messageStore.setMessageError(
            messageId,
            initialBlocks,
            JSON.stringify(terminalMetadata)
          )
          this.emitMessageRefresh(sessionId, messageId)
          publishDeepchatEvent('chat.stream.failed', {
            requestId: this.resolveStreamRequestId(sessionId, messageId),
            sessionId,
            messageId,
            failedAt: Date.now(),
            error: resumeBudget.message
          })
          this.dispatchTerminalHooks(sessionId, state, {
            status: 'error',
            stopReason: 'context_window',
            errorMessage: resumeBudget.message,
            usage: buildUsageFromMetadata(terminalMetadata)
          })
          this.setSessionStatus(sessionId, 'error')
          this.memoryIngestionObserver.afterTurnSettled({
            session: instance.getMemorySessionHandle(),
            origin: 'resume',
            outcome: { kind: 'returned', status: 'error' }
          })
          return false
        }
      }

      this.throwIfAbortRequested(preStreamAbortSignal)
      this.throwIfStaleDeepChatInstance(sessionId, instance)
      const providerBoundary = this.startPreStreamProviderBoundaryWatchdog(
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
        streamResult = await this.runStreamForMessage({
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
              this.configPresenter.getSetting<boolean>('traceDebugEnabled') === true
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
        this.applyProcessResultStatus(sessionId, result, runId)
      } finally {
        this.clearActiveGeneration(sessionId, runId)
      }
      if (result?.status === 'completed' || result?.status === 'aborted') {
        void this.drainPendingQueueIfPossible(sessionId, 'completed')
      }
      if (result) {
        this.memoryIngestionObserver.afterTurnSettled({
          session: instance.getMemorySessionHandle(),
          origin: 'resume',
          outcome: { kind: 'returned', status: result.status }
        })
      }
      return true
    } catch (error) {
      this.memoryIngestionObserver.afterTurnSettled({
        session: instance.getMemorySessionHandle(),
        origin: 'resume',
        outcome: { kind: 'thrown', error }
      })
      if (this.isStaleDeepChatInstanceError(error)) {
        return false
      }
      console.error('[DeepChatAgent] resumeAssistantMessage error:', error)
      if (this.isAbortError(error) || preStreamAbortSignal?.aborted) {
        this.clearSessionAbortController(sessionId, preStreamAbortController ?? undefined)
        this.settleAbortedTurn(
          sessionId,
          messageId,
          streamRunId,
          JSON.stringify(
            stampTerminalMetadata(resumeAccounting, 'aborted', 'user_stop', streamRunId)
          )
        )
        // Stop/steer: continue the queue automatically with the next item (steer items first).
        void this.drainPendingQueueIfPossible(sessionId, 'completed')
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
      this.messageStore.setMessageError(messageId, blocks, JSON.stringify(terminalMetadata))
      this.emitMessageRefresh(sessionId, messageId)
      publishDeepchatEvent('chat.stream.failed', {
        requestId: this.resolveStreamRequestId(sessionId, messageId),
        sessionId,
        messageId,
        failedAt: Date.now(),
        error: errorMessage
      })
      this.dispatchTerminalHooks(sessionId, this.getDeepChatRuntimeState(sessionId), {
        status: 'error',
        stopReason,
        errorMessage,
        usage: buildUsageFromMetadata(terminalMetadata)
      })
      this.setSessionStatus(sessionId, 'error')
      throw error
    } finally {
      this.clearSessionAbortController(sessionId, preStreamAbortController ?? undefined)
      instance.finishResume(messageId)
    }
  }

  private async buildSystemPromptWithSkills(
    sessionId: string,
    basePrompt: string,
    toolDefinitions: MCPToolDefinition[],
    activeSkillNamesOverride?: string[],
    resourceInstance = this.getDeepChatInstance(sessionId)
  ): Promise<string> {
    return await buildSystemPromptWithSkills(
      {
        configPresenter: this.configPresenter,
        skillPresenter: this.skillPresenter,
        providerCatalogPort: this.providerCatalogPort,
        toolPresenter: this.toolPresenter,
        assertCurrent: (id, instance) => this.throwIfStaleDeepChatInstance(id, instance),
        isAcpBackedSubagentSession: (id, providerId) =>
          this.isAcpBackedSubagentSession(id, providerId),
        resolveProjectDir: (id, projectDir, instance) =>
          this.resolveProjectDir(id, projectDir, instance),
        resolveAgentExtensionPolicy: async (id, instance) =>
          await this.toolResolver.resolveAgentExtensionPolicy(id, instance),
        logSlowStep: (id, step, startedAt) => this.logSlowPreStreamStep(id, step, startedAt)
      },
      {
        sessionId,
        basePrompt,
        toolDefinitions,
        activeSkillNamesOverride,
        resourceInstance
      }
    )
  }

  public invalidateSessionSystemPromptCache(sessionId: string): void {
    this.invalidateSystemPromptCache(sessionId)
    this.invalidateToolProfileCache(sessionId)
  }

  private invalidateSystemPromptCache(sessionId: string): void {
    this.getHydratedDeepChatInstance(sessionId)?.invalidateSystemPromptCache()
  }

  private invalidateToolProfileCache(sessionId: string): void {
    this.getHydratedDeepChatInstance(sessionId)?.invalidateToolProfileCache()
  }

  private readonly handleToolRegistryChanged = (): void => {
    this.deepChatRuntime.markToolRegistryChanged()
  }

  private async getEffectiveSessionGenerationSettings(
    sessionId: string,
    expectedInstance = this.getDeepChatInstance(sessionId)
  ): Promise<SessionGenerationSettings> {
    this.throwIfStaleDeepChatInstance(sessionId, expectedInstance)
    const cached = expectedInstance.getGenerationSettings()
    if (cached) {
      return { ...cached }
    }

    const state = expectedInstance.getRuntimeState()
    const dbSession = this.sessionStore.get(sessionId) as PersistedSessionGenerationRow | undefined
    const providerId = state?.providerId ?? dbSession?.provider_id
    const modelId = state?.modelId ?? dbSession?.model_id

    if (!providerId || !modelId) {
      throw new Error(`Session ${sessionId} not found`)
    }

    const persistedPatch = dbSession
      ? mapPersistedGenerationPatch(this.configPresenter, dbSession)
      : {}
    const sanitized = await sanitizeGenerationSettings(
      this.configPresenter,
      providerId,
      modelId,
      persistedPatch
    )
    this.throwIfStaleDeepChatInstance(sessionId, expectedInstance)
    expectedInstance.setGenerationSettings(sanitized)
    return { ...sanitized }
  }

  private persistMessageTrace(args: {
    sessionId: string
    messageId: string
    providerId: string
    modelId: string
    payload: ProviderRequestTracePayload
    requestSeq?: number
  }): void {
    const { sessionId, messageId, providerId, modelId, payload, requestSeq } = args
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
      truncated: persistable.truncated,
      requestSeq
    })
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

  private queueVisibleSteerInput(
    sessionId: string,
    input: SendMessageInput
  ): PendingSessionInputRecord {
    const instance = this.getDeepChatInstance(sessionId)
    const mergeItemId = instance.getActiveSteerPendingInputId() ?? null
    try {
      const record = this.pendingInputCoordinator.queueSteerInput(sessionId, input, {
        mergeItemId
      })
      instance.setActiveSteerPendingInputId(record.id)
      return record
    } catch (error) {
      if (!mergeItemId) {
        throw error
      }
      instance.clearActiveSteerPendingInputId()
      const record = this.pendingInputCoordinator.queueSteerInput(sessionId, input)
      instance.setActiveSteerPendingInputId(record.id)
      return record
    }
  }

  private supportsVision(providerId: string, modelId: string): boolean {
    return Boolean(this.configPresenter.getModelConfig(modelId, providerId)?.vision)
  }

  private supportsAudioInput(providerId: string, modelId: string): boolean {
    return this.configPresenter.supportsAudioInputCapability?.(providerId, modelId) === true
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

    const sessionPermissionPort = this.requireSessionPermissionPort()
    const permissionType = payload.permissionType
    const serverName = payload.serverName || toolCall.server_name || ''
    const toolName = payload.toolName || toolCall.name || ''

    if (permissionType === 'command') {
      const command = payload.command || payload.commandInfo?.command || ''
      const signature = payload.commandSignature || payload.commandInfo?.signature || command
      if (signature) {
        await sessionPermissionPort.approvePermission(sessionId, {
          permissionType: 'command',
          command,
          commandSignature: signature,
          commandInfo: payload.commandInfo
        })
      }
      return
    }

    if (serverName === 'agent-filesystem' && Array.isArray(payload.paths) && payload.paths.length) {
      await sessionPermissionPort.approvePermission(sessionId, {
        permissionType:
          permissionType === 'read' || permissionType === 'write' || permissionType === 'all'
            ? permissionType
            : 'write',
        serverName,
        toolName,
        paths: payload.paths
      })
      return
    }

    if (serverName === 'deepchat-settings' && toolName) {
      await sessionPermissionPort.approvePermission(sessionId, {
        permissionType: 'write',
        serverName,
        toolName
      })
      return
    }

    if (
      serverName &&
      (permissionType === 'read' || permissionType === 'write' || permissionType === 'all')
    ) {
      await sessionPermissionPort.approvePermission(sessionId, {
        permissionType,
        serverName,
        toolName
      })
    }
  }

  private async executeDeferredToolCall(
    sessionId: string,
    messageId: string,
    toolCall: NonNullable<AssistantMessageBlock['tool_call']>,
    onToolCallStarted?: () => void
  ): Promise<DeferredToolExecutionResult> {
    return await this.deferredToolExecutor.execute(
      sessionId,
      messageId,
      toolCall,
      onToolCallStarted
    )
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
    return await normalizeToolResultContent(
      {
        configPresenter: this.configPresenter,
        llmProviderPresenter: this.llmProviderPresenter,
        getAbortSignal: (sessionId) => this.getAbortSignalForSession(sessionId),
        getSessionModel: (sessionId) => {
          const state = this.getDeepChatRuntimeState(sessionId)
          const persisted = this.sessionStore.get(sessionId)
          return {
            providerId: state?.providerId ?? persisted?.provider_id,
            modelId: state?.modelId ?? persisted?.model_id,
            agentId: this.getSessionAgentId(sessionId)
          }
        }
      },
      params
    )
  }

  private hasPendingInteractions(sessionId: string): boolean {
    return this.refreshPendingInteractionsFromStore(sessionId)
  }

  private refreshPendingInteractionsFromStore(sessionId: string): boolean {
    const messages = this.messageStore.getMessages(sessionId)
    const pendingEntries: PendingInteractionEntry[] = []
    for (const message of messages) {
      if (message.role !== 'assistant') continue
      const blocks = parseAssistantBlocks(message.content)
      pendingEntries.push(
        ...collectPendingInteractionEntries(message.id, blocks, pendingEntries.length)
      )
    }
    const instance = this.getHydratedDeepChatInstance(sessionId)
    if (instance) {
      replacePendingInteractions(
        instance,
        reconcilePendingInteractionEntries(instance, pendingEntries)
      )
      return instance.hasPendingInteractions()
    }
    return pendingEntries.length > 0
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

      return parseAssistantBlocks(message.content).some(
        (block) =>
          block.type === 'action' &&
          block.action_type === 'question_request' &&
          block.status === 'success' &&
          block.extra?.needsUserAction === false &&
          block.extra?.questionResolution === 'replied' &&
          block.extra?.questionFollowUpPending === true
      )
    })
  }

  private async applyCompactionIntent(
    sessionId: string,
    intent: CompactionIntent | null,
    options?: {
      compactionMessageId?: string
      compactionMessageOrderSeq?: number
      shiftMessagesFromCompactionOrderSeq?: boolean
      startedExternally?: boolean
      signal?: AbortSignal
    },
    expectedInstance = this.getDeepChatInstance(sessionId)
  ): Promise<SessionSummaryState> {
    return await this.compactionRuntimeCoordinator.apply(
      sessionId,
      intent,
      options,
      expectedInstance
    )
  }

  private setSessionStatusForInstance(
    sessionId: string,
    expectedInstance: DeepChatAgentInstance,
    status: DeepChatSessionState['status']
  ): boolean {
    if (!this.isCurrentDeepChatInstance(sessionId, expectedInstance)) {
      return false
    }

    const current = expectedInstance.getRuntimeState()
    if (!current) {
      return false
    }
    if (current.status === status) {
      return true
    }
    current.status = status
    publishDeepchatEvent('sessions.status.changed', {
      sessionId,
      status,
      version: Date.now()
    })
    publishDeepchatEvent('sessions.updated', {
      sessionIds: [sessionId],
      reason: 'updated'
    })
    emitDeepChatInternalSessionUpdate({
      sessionId,
      kind: 'status',
      updatedAt: Date.now(),
      status
    })

    this.sessionUiPort?.refreshSessionUi()
    return true
  }

  private setSessionStatus(sessionId: string, status: DeepChatSessionState['status']): void {
    const instance = this.getHydratedDeepChatInstance(sessionId)
    if (instance) {
      this.setSessionStatusForInstance(sessionId, instance, status)
    }
  }

  private emitMessageRefresh(sessionId: string, messageId: string): void {
    publishDeepchatEvent('chat.stream.completed', {
      requestId: this.resolveStreamRequestId(sessionId, messageId),
      sessionId,
      messageId,
      completedAt: Date.now()
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
        deliverySegments: buildAssistantDeliverySegments(messageId, blocks),
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

  private resolvePersistedSessionProjectDir(sessionId: string): string | null {
    try {
      const session = this.sqlitePresenter.newSessionsTable?.get(sessionId)
      return this.normalizeProjectDir(session?.project_dir ?? null)
    } catch (error) {
      console.warn('[DeepChatAgent] Failed to resolve persisted project directory:', {
        sessionId,
        error
      })
      return null
    }
  }

  private resolveProjectDir(
    sessionId: string,
    incoming?: string | null,
    expectedInstance = this.getDeepChatInstance(sessionId)
  ): string | null {
    this.throwIfStaleDeepChatInstance(sessionId, expectedInstance)
    const instance = expectedInstance
    if (incoming !== undefined) {
      const normalized = this.normalizeProjectDir(incoming)
      const previous = instance.hasProjectDir()
        ? instance.getProjectDir()
        : this.resolvePersistedSessionProjectDir(sessionId)
      instance.setProjectDir(normalized)
      if (previous !== normalized) {
        instance.invalidateResourceCaches()
      }
      return normalized
    }
    if (instance.hasProjectDir()) {
      return instance.getProjectDir()
    }

    const persisted = this.resolvePersistedSessionProjectDir(sessionId)
    instance.setProjectDir(persisted)
    return persisted
  }
}
