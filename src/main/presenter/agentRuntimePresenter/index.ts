import logger from '@shared/logger'
import fs from 'fs'
import path from 'path'
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
  IAgentImplementation,
  MessagePageCursor,
  MessageStartResult,
  MessageFile,
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
import type { MCPToolCall, MCPToolResponse, ToolCallImagePreview } from '@shared/types/core/mcp'
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
import type { ReasoningPortrait } from '@shared/types/model-db'
import {
  getReasoningEffectiveEnabledForProvider,
  hasAnthropicReasoningToggle,
  isReasoningEffort,
  normalizeAnthropicReasoningVisibilityValue,
  normalizeReasoningEffortValue,
  normalizeReasoningVisibilityValue,
  isVerbosity
} from '@shared/types/model-db'
import {
  normalizeLegacyThinkingBudgetValue,
  parseFiniteNumericValue,
  toValidNonNegativeInteger,
  validateGenerationNumericField
} from '@shared/utils/generationSettingsValidation'
import { resolveMoonshotKimiTemperaturePolicy } from '@shared/moonshotKimiPolicy'
import {
  DEFAULT_MODEL_TIMEOUT,
  MODEL_TIMEOUT_MAX_MS,
  MODEL_TIMEOUT_MIN_MS
} from '@shared/modelConfigDefaults'
import {
  normalizeImageGenerationOptions,
  supportsOpenAIImageGenerationSettings
} from '@shared/imageGenerationSettings'
import { ApiEndpointType, ModelType, isDeepSeekSeriesModelId } from '@shared/model'
import { isTtsModelConfig, isTtsModelId } from '@shared/ttsSettings'
import {
  isVideoGenerationModelConfig,
  normalizeVideoGenerationOptions,
  supportsOpenAICompatibleVideoGeneration
} from '@shared/videoGenerationSettings'
import { nanoid } from 'nanoid'
import type { SQLitePresenter } from '../sqlitePresenter'
import type { DeepChatTapeEntryRow } from '../sqlitePresenter/tables/deepchatTapeEntries'
import { eventBus } from '@/eventbus'
import { MCP_EVENTS } from '@/events'
import {
  buildRuntimeCapabilitiesPrompt,
  buildSystemEnvPrompt
} from '@/lib/agentRuntime/systemEnvPromptBuilder'
import type { ContextBuildMetadata } from './contextBuilder'
import {
  buildTapeChatView,
  buildTapeResumeView,
  getTapeContextHistoryRecords
} from './tapeViewAssembler'
import {
  capAgentDefaultMaxTokens,
  capAgentRequestMaxTokens,
  AGENT_CONTEXT_SAFETY_MARGIN_TOKENS,
  buildRequestContextBudgetDiagnostics,
  buildRequestContextOverflowErrorMessage,
  estimateToolReserveTokens,
  fitRequestMessagesToContextWindow,
  preflightRequestContext
} from './contextBudget'
import {
  appendReconstructionAnchorStateSection,
  appendSummarySection,
  CompactionService,
  type CompactionIntent
} from './compactionService'
import { buildPersistableMessageTracePayload } from './messageTracePayload'
import { buildTerminalErrorBlocks, DeepChatMessageStore } from './messageStore'
import { DeepChatTapeService } from './tapeService'
import { buildEffectiveTapeView } from './tapeEffectiveView'
import {
  buildExcludedRefs,
  buildIncludedRefs,
  buildRequestRefs,
  createTapeViewManifest,
  resolveTapeViewManifestPolicy,
  type TapeViewContextSelection
} from './tapeViewManifest'
import { PendingInputCoordinator } from './pendingInputCoordinator'
import { DeepChatPendingInputStore } from './pendingInputStore'
import { processStream } from './process'
import { cloneBlocksForRenderer } from './echo'
import { DeepChatSessionStore, type SessionSummaryState } from './sessionStore'
import {
  appendMemorySectionWithManifest,
  type MemoryRuntimePort
} from '../memoryPresenter/injectionPort'
import type { InterleavedReasoningConfig, PendingToolInteraction, ProcessResult } from './types'
import { ToolOutputGuard } from './toolOutputGuard'
import type { ProviderRequestTracePayload } from '../llmProviderPresenter/requestTrace'
import type {
  DeepChatTapeViewPolicy,
  DeepChatTapeViewManifestRecord,
  DeepChatTapeViewTaskType,
  DeepChatTapeViewTokenBudget
} from '@shared/types/tape-view-manifest'
import type { NewSessionHooksBridge } from '../hooksNotifications/newSessionBridge'
import { providerDbLoader } from '../configPresenter/providerDbLoader'
import { resolveSessionVisionTarget } from '../vision/sessionVisionResolver'
import type { ProviderCatalogPort, SessionPermissionPort, SessionUiPort } from '../runtimePorts'
import { publishDeepchatEvent } from '@/routes/publishDeepchatEvent'
import { extractToolCallImagePreviews } from '@/lib/toolCallImagePreviews'
import {
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

type PendingInteractionEntry = {
  interaction: PendingToolInteraction
  blockIndex: number
}

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

type DeferredToolExecutionResult = {
  responseText: string
  isError: boolean
  toolSource?: 'mcp' | 'agent'
  serverName?: string
  offloadPath?: string
  rtkApplied?: boolean
  rtkMode?: 'rewrite' | 'direct' | 'bypass'
  rtkFallbackReason?: string
  imagePreviews?: ToolCallImagePreview[]
  requiresPermission?: boolean
  permissionRequest?: PendingToolInteraction['permission']
  terminalError?: string
}

type ResumeBudgetToolCall = {
  id: string
  name: string
  offloadPath?: string
}

type AgentExtensionPolicy = {
  enabledPluginIds?: string[] | null
  enabledSkillNames?: string[] | null
  enabledMcpServerIds?: string[] | null
}

type PackageJsonManifest = {
  name?: unknown
  scripts?: Record<string, unknown>
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

function normalizeTopP(value: unknown): number | undefined {
  const numeric = parseFiniteNumericValue(value)
  return numeric !== undefined && numeric >= 0.1 && numeric <= 1 ? numeric : undefined
}

function readPackageJsonManifest(workdir: string): PackageJsonManifest | null {
  try {
    const packageJsonPath = path.join(workdir, 'package.json')
    if (!fs.existsSync(packageJsonPath)) {
      return null
    }

    const parsed = JSON.parse(fs.readFileSync(packageJsonPath, 'utf-8')) as unknown
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return null
    }

    return parsed as PackageJsonManifest
  } catch {
    return null
  }
}

function getVerificationScriptNames(workdir: string): string[] {
  const manifest = readPackageJsonManifest(workdir)
  const scripts = manifest?.scripts
  if (!scripts || typeof scripts !== 'object') {
    return []
  }

  return Object.entries(scripts)
    .filter(
      ([name, value]) => typeof name === 'string' && typeof value === 'string' && value.trim()
    )
    .map(([name]) => name)
}

type ActiveProviderPermission = {
  requestId: string
  sessionId: string
  messageId: string
  toolCallId: string
  providerId: string
  permissionType: 'read' | 'write' | 'all' | 'command'
  resolve: (granted: boolean) => Promise<void>
}

type ProviderPermissionInteractionInput = {
  sessionId: string
  messageId: string
  toolCallId: string
  requestId: string
  permissionType: 'read' | 'write' | 'all' | 'command'
  granted: boolean
}

type PersistedSessionGenerationRow = {
  provider_id: string
  model_id: string
  permission_mode: PermissionMode
  system_prompt: string | null
  temperature: number | null
  top_p: number | null
  context_length: number | null
  max_tokens: number | null
  timeout_ms: number | null
  thinking_budget: number | null
  reasoning_effort: SessionGenerationSettings['reasoningEffort'] | null
  reasoning_visibility: SessionGenerationSettings['reasoningVisibility'] | null
  verbosity: SessionGenerationSettings['verbosity'] | null
  force_interleaved_thinking_compat: number | null
}

type SystemPromptCacheEntry = {
  prompt: string
  dayKey: string
  fingerprint: string
}

type ToolProfileKind = 'code' | 'research' | 'analysis' | 'general'

type ToolProfileCacheEntry = {
  profile: ToolProfileKind
  fingerprint: string
  tools: MCPToolDefinition[]
}

type ActiveGeneration = {
  runId: string
  messageId: string
  abortController: AbortController
}

type MemoryAdmissionSpan = {
  spanText: string
  sourceEntryIds: number[]
  hadToolUse: boolean
  visibleTextChars: number
}

type SkillDraftStatus = 'pending' | 'viewed' | 'installed' | 'discarded' | 'error'

type SkillDraftChoice = 'view' | 'install' | 'discard'

const SKILL_DRAFT_ACTION_LABELS: Record<SkillDraftChoice, string> = {
  view: 'chat.skillDraft.actions.view',
  install: 'chat.skillDraft.actions.install',
  discard: 'chat.skillDraft.actions.discard'
}

const SKILL_DRAFT_STATUS_BY_CHOICE: Record<Exclude<SkillDraftChoice, 'view'>, SkillDraftStatus> = {
  install: 'installed',
  discard: 'discarded'
}

const RATE_LIMIT_STREAM_MESSAGE_PREFIX = '__rate_limit__:'
// Minimum new-message delta (since the memory cursor) before the fallback extracts.
const MEMORY_FALLBACK_MIN_DELTA = 6
// Minimum visible text for short non-tool fallback spans.
const MEMORY_MIN_AGENTIC_TEXT_CHARS = 160
const PRE_STREAM_SLOW_STEP_MS = 500
const createAbortError = (): Error => {
  if (typeof DOMException !== 'undefined') {
    return new DOMException('Aborted', 'AbortError')
  }

  const error = new Error('Aborted')
  error.name = 'AbortError'
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

export class AgentRuntimePresenter implements IAgentImplementation {
  private readonly llmProviderPresenter: ILlmProviderPresenter
  private readonly configPresenter: IConfigPresenter
  private readonly sqlitePresenter: SQLitePresenter
  private readonly toolPresenter: IToolPresenter | null
  private readonly sessionStore: DeepChatSessionStore
  private readonly messageStore: DeepChatMessageStore
  private readonly tapeService: DeepChatTapeService
  private readonly pendingInputStore: DeepChatPendingInputStore
  private readonly pendingInputCoordinator: PendingInputCoordinator
  private readonly runtimeState: Map<string, DeepChatSessionState> = new Map()
  private readonly sessionGenerationSettings: Map<string, SessionGenerationSettings> = new Map()
  private readonly abortControllers: Map<string, AbortController> = new Map()
  private readonly deferredToolAbortControllers: Map<string, AbortController> = new Map()
  private readonly activeGenerations: Map<string, ActiveGeneration> = new Map()
  private readonly firstTurnReadySessions: Set<string> = new Set()
  private readonly firstTurnReadyWaiters: Map<string, Set<(ready: boolean) => void>> = new Map()
  private readonly activeSteerPendingInputIds: Map<string, string> = new Map()
  private readonly sessionAgentIds: Map<string, string> = new Map()
  private readonly sessionProjectDirs: Map<string, string | null> = new Map()
  private readonly systemPromptCache: Map<string, SystemPromptCacheEntry> = new Map()
  private readonly toolProfileCache: Map<string, ToolProfileCacheEntry> = new Map()
  private readonly runtimeActivatedSkillsBySession: Map<string, Set<string>> = new Map()
  private readonly sessionCompactionStates: Map<string, SessionCompactionState> = new Map()
  private readonly interactionLocks: Set<string> = new Set()
  private readonly resumingMessages: Set<string> = new Set()
  private readonly drainingPendingQueues: Set<string> = new Set()
  private readonly activeProviderPermissions: Map<string, ActiveProviderPermission> = new Map()
  private readonly compactionService: CompactionService
  private readonly toolOutputGuard: ToolOutputGuard
  private readonly hooksBridge?: NewSessionHooksBridge
  private readonly providerCatalogPort: Pick<
    ProviderCatalogPort,
    'getProviderModels' | 'getCustomModels'
  >
  private readonly sessionPermissionPort?: SessionPermissionPort
  private readonly sessionUiPort?: SessionUiPort
  private readonly memoryPort?: MemoryRuntimePort
  private readonly memoryExtractionChains = new Map<string, Promise<void>>()
  private readonly memoryExtractionEpochs = new Map<string, number>()
  private readonly cacheImage?: (data: string) => Promise<string>
  private readonly skillPresenter?: Pick<
    ISkillPresenter,
    | 'getMetadataList'
    | 'getActiveSkills'
    | 'loadSkillContent'
    | 'viewDraftSkill'
    | 'installDraftSkill'
    | 'discardDraftSkill'
  >
  private toolRegistryRevision = 0
  private nextRunSequence = 0

  constructor(
    llmProviderPresenter: ILlmProviderPresenter,
    configPresenter: IConfigPresenter,
    sqlitePresenter: SQLitePresenter,
    toolPresenter?: IToolPresenter,
    hooksBridge?: NewSessionHooksBridge,
    runtimePorts?: {
      providerCatalogPort?: Pick<ProviderCatalogPort, 'getProviderModels' | 'getCustomModels'>
      sessionPermissionPort?: SessionPermissionPort
      sessionUiPort?: SessionUiPort
      memoryPort?: MemoryRuntimePort
      cacheImage?: (data: string) => Promise<string>
      skillPresenter?: Pick<
        ISkillPresenter,
        | 'getMetadataList'
        | 'getActiveSkills'
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
    this.sessionStore = new DeepChatSessionStore(sqlitePresenter)
    this.messageStore = new DeepChatMessageStore(sqlitePresenter)
    this.tapeService = new DeepChatTapeService(sqlitePresenter)
    this.pendingInputStore = new DeepChatPendingInputStore(sqlitePresenter)
    this.pendingInputCoordinator = new PendingInputCoordinator(this.pendingInputStore)
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
    this.toolOutputGuard = new ToolOutputGuard()
    this.hooksBridge = hooksBridge
    this.providerCatalogPort = runtimePorts?.providerCatalogPort ?? {
      getProviderModels: (providerId) => this.configPresenter.getProviderModels?.(providerId) ?? [],
      getCustomModels: (providerId) => this.configPresenter.getCustomModels?.(providerId) ?? []
    }
    this.sessionPermissionPort = runtimePorts?.sessionPermissionPort
    this.sessionUiPort = runtimePorts?.sessionUiPort
    this.memoryPort = runtimePorts?.memoryPort
    this.cacheImage = runtimePorts?.cacheImage
    this.skillPresenter = runtimePorts?.skillPresenter

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
    eventBus.on(MCP_EVENTS.INITIALIZED, this.handleToolRegistryChanged)
  }

  private requireSessionPermissionPort(): SessionPermissionPort {
    if (this.sessionPermissionPort) {
      return this.sessionPermissionPort
    }

    throw new Error('Session permission port is not available.')
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
    logger.info(
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
    this.clearFirstTurnReady(sessionId)
    this.invalidateSystemPromptCache(sessionId)
    this.invalidateToolProfileCache(sessionId)
  }

  async destroySession(sessionId: string): Promise<void> {
    this.bumpMemoryExtractionEpoch(sessionId)
    const controller =
      this.activeGenerations.get(sessionId)?.abortController ?? this.abortControllers.get(sessionId)
    if (controller) {
      controller.abort()
      this.abortControllers.delete(sessionId)
    }
    this.abortDeferredToolAbortControllers(sessionId)
    this.activeGenerations.delete(sessionId)
    this.clearFirstTurnReady(sessionId)
    this.activeSteerPendingInputIds.delete(sessionId)
    this.clearActiveProviderPermissionsForSession(sessionId)

    this.pendingInputCoordinator.deleteBySession(sessionId)
    this.messageStore.deleteBySession(sessionId)
    this.sessionStore.delete(sessionId)
    this.runtimeState.delete(sessionId)
    this.sessionAgentIds.delete(sessionId)
    this.sessionGenerationSettings.delete(sessionId)
    this.sessionProjectDirs.delete(sessionId)
    this.systemPromptCache.delete(sessionId)
    this.toolProfileCache.delete(sessionId)
    this.runtimeActivatedSkillsBySession.delete(sessionId)
    this.sessionCompactionStates.delete(sessionId)
    this.drainingPendingQueues.delete(sessionId)
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
    const state = this.runtimeState.get(sessionId)
    if (state) {
      this.getSessionAgentId(sessionId)
      if (this.hasPendingInteractions(sessionId)) {
        state.status = 'generating'
      }
      if (hydrationMode === 'full') {
        await this.getEffectiveSessionGenerationSettings(sessionId)
      }
      return { ...state }
    }

    const dbSession = this.sessionStore.get(sessionId) as PersistedSessionGenerationRow | undefined
    if (!dbSession) return null

    this.getSessionAgentId(sessionId)
    const rebuilt: DeepChatSessionState = {
      status: this.hasPendingInteractions(sessionId) ? 'generating' : 'idle',
      providerId: dbSession.provider_id,
      modelId: dbSession.model_id,
      permissionMode: dbSession.permission_mode || 'full_access'
    }
    this.runtimeState.set(sessionId, rebuilt)
    if (hydrationMode === 'full') {
      await this.getEffectiveSessionGenerationSettings(sessionId)
    }
    return { ...rebuilt }
  }

  async listPendingInputs(sessionId: string): Promise<PendingSessionInputRecord[]> {
    return this.pendingInputCoordinator.listPendingInputs(sessionId)
  }

  async waitForFirstTurnReady(
    sessionId: string,
    options?: { timeoutMs?: number }
  ): Promise<boolean> {
    if (this.firstTurnReadySessions.has(sessionId)) {
      return true
    }

    const timeoutMs = Math.max(0, options?.timeoutMs ?? 30000)
    if (timeoutMs === 0) {
      return false
    }

    return await new Promise<boolean>((resolve) => {
      let settled = false
      let timer: ReturnType<typeof setTimeout>

      const waiters =
        this.firstTurnReadyWaiters.get(sessionId) ?? new Set<(ready: boolean) => void>()
      const cleanup = () => {
        const current = this.firstTurnReadyWaiters.get(sessionId)
        current?.delete(resolveWaiter)
        if (current?.size === 0) {
          this.firstTurnReadyWaiters.delete(sessionId)
        }
      }
      const settle = (ready: boolean) => {
        if (settled) return
        settled = true
        clearTimeout(timer)
        cleanup()
        resolve(ready)
      }
      const resolveWaiter = (ready: boolean) => settle(ready)

      waiters.add(resolveWaiter)
      this.firstTurnReadyWaiters.set(sessionId, waiters)
      timer = setTimeout(() => settle(false), timeoutMs)
    })
  }

  private markFirstTurnReady(sessionId: string): void {
    if (this.firstTurnReadySessions.has(sessionId)) {
      return
    }

    this.firstTurnReadySessions.add(sessionId)
    this.settleFirstTurnReadyWaiters(sessionId, true)
  }

  private clearFirstTurnReady(sessionId: string): void {
    this.firstTurnReadySessions.delete(sessionId)
    this.settleFirstTurnReadyWaiters(sessionId, false)
  }

  private settleFirstTurnReadyWaiters(sessionId: string, ready: boolean): void {
    const waiters = this.firstTurnReadyWaiters.get(sessionId)
    if (!waiters) {
      return
    }

    this.firstTurnReadyWaiters.delete(sessionId)
    for (const waiter of waiters) {
      waiter(ready)
    }
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
    const normalizedInput = this.normalizeUserMessageInput(content)
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

    const normalizedInput = this.normalizeUserMessageInput(content)
    if (!normalizedInput.text.trim() && (normalizedInput.files?.length ?? 0) === 0) {
      return
    }

    const activeGeneration = this.activeGenerations.get(sessionId)
    const preStreamController = this.abortControllers.get(sessionId)

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
      if (this.drainingPendingQueues.has(sessionId) || state.status === 'generating') {
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
    if (this.drainingPendingQueues.has(sessionId) || latestState?.status === 'generating') {
      return
    }

    try {
      this.pendingInputCoordinator.deletePendingInput(sessionId, record.id)
      if (this.activeSteerPendingInputIds.get(sessionId) === record.id) {
        this.activeSteerPendingInputIds.delete(sessionId)
      }
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

    const activeGeneration = this.activeGenerations.get(sessionId)
    const preStreamController = this.abortControllers.get(sessionId)

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
    }
  ): Promise<MessageStartResult> {
    const state = this.runtimeState.get(sessionId)
    if (!state) throw new Error(`Session ${sessionId} not found`)
    if (this.hasPendingInteractions(sessionId)) {
      throw new Error('Pending tool interactions must be resolved before sending a new message.')
    }

    const normalizedInput = this.normalizeUserMessageInput(content)
    if (!normalizedInput.text.trim() && (normalizedInput.files?.length ?? 0) === 0) {
      throw new Error('Message cannot be empty.')
    }
    const supportsVision = this.supportsVision(state.providerId, state.modelId)
    const supportsAudioInput = this.supportsAudioInput(state.providerId, state.modelId)
    const projectDir = this.resolveProjectDir(sessionId, context?.projectDir)
    logger.info(
      `[DeepChatAgent] processMessage session=${sessionId} content="${normalizedInput.text.slice(0, 60)}" projectDir=${projectDir ?? '<none>'}`
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
      this.throwIfAbortRequested(preStreamAbortSignal)
      let stepStartedAt = Date.now()
      const generationSettings = await this.getEffectiveSessionGenerationSettings(sessionId)
      this.logSlowPreStreamStep(sessionId, 'generation-settings', stepStartedAt)
      const modelConfig = this.configPresenter.getModelConfig(state.modelId, state.providerId)
      const useContextBudget = this.shouldUseDeepChatContextBudget(
        state.providerId,
        modelConfig,
        state.modelId
      )
      this.throwIfAbortRequested(preStreamAbortSignal)
      const interleavedReasoning = this.resolveInterleavedReasoningConfig(
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
      stepStartedAt = Date.now()
      this.resetRuntimeActivatedSkills(sessionId)
      this.setRuntimeActivatedSkills(sessionId, normalizedInput.activeSkills ?? [])
      const sessionActiveSkillNames = await this.resolveActiveSkillNamesForToolProfile(sessionId)
      const effectiveActiveSkillNames = this.resolveEffectiveActiveSkillNames(
        sessionActiveSkillNames,
        sessionId
      )
      this.logSlowPreStreamStep(sessionId, 'active-skills', stepStartedAt)
      stepStartedAt = Date.now()
      const tools = await this.loadToolDefinitionsForSession(
        sessionId,
        projectDir,
        effectiveActiveSkillNames
      )
      this.logSlowPreStreamStep(sessionId, 'tool-definitions', stepStartedAt)
      const toolReserveTokens = estimateToolReserveTokens(tools)
      this.throwIfAbortRequested(preStreamAbortSignal)
      stepStartedAt = Date.now()
      const baseSystemPrompt = await this.buildSystemPromptWithSkills(
        sessionId,
        generationSettings.systemPrompt,
        tools,
        effectiveActiveSkillNames
      )
      this.logSlowPreStreamStep(sessionId, 'system-prompt', stepStartedAt)
      this.throwIfAbortRequested(preStreamAbortSignal)
      const tapeReady = this.tapeService.ensureSessionTapeReady(sessionId, this.messageStore)
      const historyRecords = getTapeContextHistoryRecords(tapeReady.historyRecords)
      const userContent: UserMessageContent = {
        text: normalizedInput.text,
        files: normalizedInput.files || [],
        links: [],
        search: false,
        think: false,
        ...(normalizedInput.activeSkills?.length
          ? { activeSkills: normalizedInput.activeSkills }
          : {})
      }

      let compactionIntent: CompactionIntent | null = null
      if (useContextBudget) {
        stepStartedAt = Date.now()
        compactionIntent = await this.compactionService.prepareForNextUserTurn({
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
        this.logSlowPreStreamStep(sessionId, 'compaction-prepare', stepStartedAt)
      }
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
          startedExternally: true,
          signal: preStreamAbortSignal
        })
        this.triggerMemoryExtractionFromCompaction(sessionId, compactionIntent)
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

      stepStartedAt = Date.now()
      const systemPrompt = await this.appendMemoryInjection(
        sessionId,
        appendReconstructionAnchorStateSection(
          appendSummarySection(baseSystemPrompt, summaryState.summaryText),
          this.sessionStore.getReconstructionAnchorPromptState(sessionId)
        ),
        normalizedInput.text,
        userMessageId
      )
      this.logSlowPreStreamStep(sessionId, 'memory-injection', stepStartedAt)
      stepStartedAt = Date.now()
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
      this.logSlowPreStreamStep(sessionId, 'context-build', stepStartedAt)
      const messages = contextBuild.messages

      const assistantOrderSeq = this.messageStore.getNextOrderSeq(sessionId)
      assistantMessageId = this.messageStore.createAssistantMessage(sessionId, assistantOrderSeq)
      this.toolPresenter?.clearAgentPlanState?.(sessionId)
      this.throwIfAbortRequested(preStreamAbortSignal)

      if (context?.pendingQueueItemId && pendingInputSource === 'send') {
        this.pendingInputCoordinator.consumeQueuedInput(sessionId, context.pendingQueueItemId)
        consumedPendingQueueItem = true
      }

      if (context?.emitRefreshBeforeStream) {
        this.emitMessageRefresh(sessionId, assistantMessageId)
      }

      const streamResult = await this.runStreamForMessage({
        sessionId,
        messageId: assistantMessageId,
        messages,
        projectDir,
        promptPreview: normalizedInput.text,
        tools,
        baseSystemPrompt,
        refreshSystemPrompt: async (activeSkillNames, refreshedTools) => {
          const refreshedBasePrompt = await this.buildSystemPromptWithSkills(
            sessionId,
            generationSettings.systemPrompt,
            refreshedTools,
            activeSkillNames ?? effectiveActiveSkillNames
          )
          return await this.appendMemoryInjection(
            sessionId,
            appendReconstructionAnchorStateSection(
              appendSummarySection(refreshedBasePrompt, summaryState.summaryText),
              this.sessionStore.getReconstructionAnchorPromptState(sessionId)
            ),
            normalizedInput.text,
            userMessageId
          )
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
          traceDebugEnabled: this.configPresenter.getSetting<boolean>('traceDebugEnabled') === true
        },
        preStreamStartedAt,
        onRunRegistered: (runId) => {
          streamRunId = runId
        }
      })
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
              userMessageId
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
        this.triggerMemoryExtractionFallback(sessionId)
      } else if (result?.status === 'aborted') {
        // Return-path abort: applyProcessResultStatus already dispatched terminal hooks + idle (guarded
        // by active run). Append the canceled block, then continue the queue with the next item.
        this.writeCanceledTerminalBlock(sessionId, assistantMessageId)
        void this.drainPendingQueueIfPossible(sessionId, 'completed')
      }
      return {
        requestId: assistantMessageId,
        messageId: assistantMessageId
      }
    } catch (err) {
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
                userMessageId
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
        this.settleAbortedTurn(sessionId, assistantMessageId, streamRunId)
        // Stop/steer: continue the queue automatically with the next item (steer items first).
        void this.drainPendingQueueIfPossible(sessionId, 'completed')
        return {
          requestId: assistantMessageId,
          messageId: assistantMessageId
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
      return {
        requestId: assistantMessageId,
        messageId: assistantMessageId
      }
    } finally {
      this.clearSessionAbortController(sessionId, preStreamAbortController)
      this.resetRuntimeActivatedSkills(sessionId)
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

  private resolveSkillDraftChoice(answerText: string): SkillDraftChoice | null {
    const normalized = answerText.trim()
    for (const [choice, label] of Object.entries(SKILL_DRAFT_ACTION_LABELS) as Array<
      [SkillDraftChoice, string]
    >) {
      if (normalized === choice || normalized === label) {
        return choice
      }
    }
    return null
  }

  private isSkillDraftConfirmationBlock(block: AssistantMessageBlock): boolean {
    return (
      block.action_type === 'question_request' &&
      block.extra?.skillDraftAction === 'confirm' &&
      typeof block.extra?.skillDraftId === 'string'
    )
  }

  private updateSkillDraftQuestionOptions(block: AssistantMessageBlock, viewed: boolean): void {
    const options = [
      ...(viewed
        ? []
        : [
            {
              label: SKILL_DRAFT_ACTION_LABELS.view,
              description: 'chat.skillDraft.actions.viewDescription'
            }
          ]),
      {
        label: SKILL_DRAFT_ACTION_LABELS.install,
        description: 'chat.skillDraft.actions.installDescription'
      },
      {
        label: SKILL_DRAFT_ACTION_LABELS.discard,
        description: 'chat.skillDraft.actions.discardDescription'
      }
    ]
    block.extra = {
      ...block.extra,
      questionOptions: options
    }
  }

  private updateSkillDraftToolCallResponse(
    blocks: AssistantMessageBlock[],
    toolCallId: string,
    responseText: string,
    isError: boolean
  ): void {
    this.updateToolCallResponse(blocks, toolCallId, responseText, isError)
  }

  private buildSkillDraftToolResponse(result: {
    success: boolean
    action: SkillDraftChoice
    draftId: string
    skillName?: string
    installedSkillName?: string
    error?: string
  }): string {
    if (!result.success) {
      return JSON.stringify({
        success: false,
        action: result.action,
        draftId: result.draftId,
        error: result.error || 'Unknown error'
      })
    }

    return JSON.stringify({
      success: true,
      action: result.action,
      draftId: result.draftId,
      ...(result.skillName ? { skillName: result.skillName } : {}),
      ...(result.installedSkillName ? { installedSkillName: result.installedSkillName } : {})
    })
  }

  private async handleSkillDraftInteraction(
    sessionId: string,
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
    const choice = this.resolveSkillDraftChoice(answerText)
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
        this.updateSkillDraftToolCallResponse(
          blocks,
          toolCall.id!,
          this.buildSkillDraftToolResponse({ success: false, action: 'view', draftId, error }),
          true
        )
        this.markQuestionResolved(actionBlock, SKILL_DRAFT_ACTION_LABELS.view)
        return { keepPending: false, waitingForUserMessage: false }
      }

      const responseText = this.buildSkillDraftToolResponse({
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
      this.updateSkillDraftQuestionOptions(actionBlock, true)
      this.updateSkillDraftToolCallResponse(blocks, toolCall.id!, responseText, false)
      return { keepPending: true, waitingForUserMessage: false, handledInline: true }
    }

    const result =
      choice === 'install'
        ? await this.skillPresenter.installDraftSkill(sessionId, draftId)
        : await this.skillPresenter.discardDraftSkill(sessionId, draftId)

    const responseText = this.buildSkillDraftToolResponse({
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
    this.markQuestionResolved(actionBlock, SKILL_DRAFT_ACTION_LABELS[choice])
    this.updateSkillDraftToolCallResponse(blocks, toolCall.id!, responseText, !result.success)

    if (choice === 'install' && result.success) {
      this.invalidateSystemPromptCache(sessionId)
      this.invalidateToolProfileCache(sessionId)
    }

    return { keepPending: false, waitingForUserMessage: false }
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

        if (this.isSkillDraftConfirmationBlock(actionBlock)) {
          const result = await this.handleSkillDraftInteraction(
            sessionId,
            blocks,
            actionBlock,
            toolCall,
            response
          )
          waitingForUserMessage = result.waitingForUserMessage
          if (result.keepPending) {
            this.messageStore.updateAssistantContent(messageId, blocks)
            this.emitMessageRefresh(sessionId, messageId)
            this.messageStore.updateMessageStatus(messageId, 'pending')
            this.setSessionStatus(sessionId, 'generating')
            return { resumed: false, handledInline: result.handledInline === true }
          }
        } else if (response.kind === 'question_other') {
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
        const requestId = permissionPayload?.requestId?.trim()
        const providerId = permissionPayload?.providerId?.trim()
        if (providerId === 'acp' && requestId) {
          await this.resolveProviderPermissionInteraction({
            sessionId,
            messageId,
            toolCallId: toolCall.id,
            requestId,
            permissionType,
            granted: response.granted
          })
          return { resumed: false }
        }
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
          const imagePresentation = prepareToolImagePreviewPresentation({
            toolCallId: toolCall.id,
            toolName: toolCall.name || '',
            toolSource: execution.toolSource,
            serverName: execution.serverName,
            isError: execution.isError,
            imagePreviews: execution.imagePreviews
          })

          this.updateToolCallResponse(
            blocks,
            toolCall.id,
            execution.responseText,
            execution.isError,
            {
              rtkApplied: execution.rtkApplied,
              rtkMode: execution.rtkMode,
              rtkFallbackReason: execution.rtkFallbackReason,
              imagePreviews: imagePresentation.toolBlockImagePreviews
            }
          )
          insertBlocksAfterToolCall(blocks, toolCall.id, imagePresentation.promotedBlocks)
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
    this.invalidateToolProfileCache(sessionId)
  }

  async setSessionAgentContext(
    sessionId: string,
    config: SessionAgentContextUpdate
  ): Promise<void> {
    const nextProviderId = config.providerId?.trim()
    const nextModelId = config.modelId?.trim()
    const nextAgentId = config.agentId?.trim()
    if (!nextAgentId || !nextProviderId || !nextModelId) {
      throw new Error('Session agent context update requires agentId, providerId and modelId.')
    }

    const state = this.runtimeState.get(sessionId)
    const dbSession = this.sessionStore.get(sessionId)
    if (!state && !dbSession) {
      throw new Error(`Session ${sessionId} not found`)
    }

    if (state?.status === 'generating') {
      throw new Error('Cannot move session while it is generating.')
    }

    const permissionMode: PermissionMode =
      config.permissionMode === 'default' ? 'default' : 'full_access'
    const sanitizedGenerationSettings = await this.sanitizeGenerationSettings(
      nextProviderId,
      nextModelId,
      config.generationSettings ?? {}
    )

    this.runtimeState.set(sessionId, {
      status: state?.status ?? 'idle',
      providerId: nextProviderId,
      modelId: nextModelId,
      permissionMode
    })
    this.sessionStore.updateSessionModel(sessionId, nextProviderId, nextModelId)
    this.sessionStore.updatePermissionMode(sessionId, permissionMode)
    this.sessionStore.updateGenerationSettings(
      sessionId,
      this.buildPersistedGenerationSettingsReplacement(sanitizedGenerationSettings)
    )
    this.sessionAgentIds.set(sessionId, nextAgentId)
    this.sessionProjectDirs.set(sessionId, this.normalizeProjectDir(config.projectDir))
    this.sessionGenerationSettings.set(sessionId, sanitizedGenerationSettings)
    this.invalidateSystemPromptCache(sessionId)
    this.invalidateToolProfileCache(sessionId)
  }

  async setSessionProjectDir(sessionId: string, projectDir: string | null): Promise<void> {
    const normalized = this.normalizeProjectDir(projectDir)
    const previous = this.sessionProjectDirs.has(sessionId)
      ? (this.sessionProjectDirs.get(sessionId) ?? null)
      : this.resolvePersistedSessionProjectDir(sessionId)
    this.sessionProjectDirs.set(sessionId, normalized)
    if (previous !== normalized) {
      this.invalidateSystemPromptCache(sessionId)
      this.invalidateToolProfileCache(sessionId)
    }
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
    // Single responsibility: request the abort and release controllers/permissions. Terminal
    // settlement (canceled block + Stop/SessionEnd hooks + idle status + queue drain) is owned by the
    // in-flight processMessage / resumeAssistantMessage handler, which always observes the abort and
    // settles exactly once. cancelGeneration deliberately does NOT clear the active generation, write
    // the terminal block, dispatch hooks, or set status.
    const activeGeneration = this.activeGenerations.get(sessionId)
    if (activeGeneration) {
      activeGeneration.abortController.abort()
    } else {
      const controller = this.abortControllers.get(sessionId)
      if (controller) {
        controller.abort()
        this.abortControllers.delete(sessionId)
      }
    }
    this.abortDeferredToolAbortControllers(sessionId)
    this.clearActiveProviderPermissionsForSession(sessionId)
  }

  /**
   * Append the canceled terminal block to an assistant message after a stop/steer abort. Idempotent
   * via buildTerminalErrorBlocks (won't duplicate the block).
   */
  private writeCanceledTerminalBlock(sessionId: string, messageId: string | null): void {
    if (!messageId) {
      return
    }
    const assistantMessage = this.messageStore.getMessage(messageId)
    if (assistantMessage?.role !== 'assistant') {
      return
    }
    const blocks = buildTerminalErrorBlocks(
      this.parseAssistantBlocks(assistantMessage.content),
      'common.error.userCanceledGeneration'
    )
    this.messageStore.setMessageError(messageId, blocks)
    this.emitMessageRefresh(sessionId, messageId)
  }

  /**
   * Settle a turn aborted by stop/steer from the stream handler's *throw* (catch) branch: canceled
   * terminal block + terminal hooks + idle status. The return-path settles via applyProcessResultStatus
   * instead. The caller remains responsible for draining the queue.
   */
  private settleAbortedTurn(sessionId: string, messageId: string | null, runId?: string): void {
    this.writeCanceledTerminalBlock(sessionId, messageId)
    this.dispatchTerminalHooks(sessionId, this.runtimeState.get(sessionId), {
      status: 'aborted',
      stopReason: 'user_stop',
      errorMessage: 'common.error.userCanceledGeneration'
    })
    const activeGeneration = this.activeGenerations.get(sessionId)
    const controller = this.abortControllers.get(sessionId)
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

  // Appends the memory section (self-model + recalled memories) to the system prompt.
  // No-op when the agent has memory disabled; any failure falls back to the original prompt.
  private async appendMemoryInjection(
    sessionId: string,
    systemPrompt: string,
    query: string,
    messageId?: string | null
  ): Promise<string> {
    if (!this.memoryPort) {
      return systemPrompt
    }
    try {
      const agentId = this.getSessionAgentId(sessionId) ?? 'deepchat'
      if (!this.memoryPort.isEnabled(agentId)) {
        return systemPrompt
      }
      const injection = await this.memoryPort.buildInjection(agentId, query)
      const assembled = appendMemorySectionWithManifest(systemPrompt, injection)
      if (assembled.manifest) {
        try {
          this.sqlitePresenter.deepchatTapeEntriesTable.appendAnchor({
            sessionId,
            name: 'memory/view_assembled',
            state: assembled.manifest as unknown as Record<string, unknown>,
            meta: messageId ? { messageId } : undefined
          })
        } catch (error) {
          logger.warn(`[DeepChatAgent] memory view anchor skipped: ${String(error)}`)
        }
      }
      return assembled.prompt
    } catch (error) {
      logger.warn(`[DeepChatAgent] memory injection skipped: ${String(error)}`)
      return systemPrompt
    }
  }

  private triggerMemoryExtractionFromCompaction(sessionId: string, intent: CompactionIntent): void {
    if (!this.memoryPort) return
    const agentId = this.getSessionAgentId(sessionId) ?? 'deepchat'
    if (!this.memoryPort.isEnabled(agentId)) return
    const toOrderSeq = Math.max(1, intent.targetCursorOrderSeq)
    this.enqueueSessionExtraction(sessionId, async (epoch) => {
      if (!this.isMemoryExtractionEpochCurrent(sessionId, epoch)) return
      const cursor =
        this.sqlitePresenter.deepchatSessionsTable.getMemoryCursorOrderSeq(sessionId) ?? 0
      const span = this.buildMemorySpanFromTape(sessionId, cursor, toOrderSeq)
      if (!span || span.visibleTextChars <= 0) return
      await this.runMemoryExtraction(
        sessionId,
        {
          spanText: span.spanText,
          sourceEntryIds: span.sourceEntryIds,
          toOrderSeq,
          reason: 'compaction'
        },
        epoch
      )
    })
  }

  // Serializes extraction per session; sibling sessions never block each other.
  private enqueueSessionExtraction(
    sessionId: string,
    task: (epoch: number) => Promise<void>
  ): void {
    const prev = this.memoryExtractionChains.get(sessionId) ?? Promise.resolve()
    const runTask = () => task(this.ensureMemoryExtractionEpoch(sessionId))
    const next = prev.then(runTask, runTask).catch((error) => {
      logger.warn(`[DeepChatAgent] memory extraction chain error: ${String(error)}`)
    })
    this.memoryExtractionChains.set(sessionId, next)
    void next.finally(() => {
      if (this.memoryExtractionChains.get(sessionId) === next) {
        this.memoryExtractionChains.delete(sessionId)
        if (!this.runtimeState.has(sessionId)) {
          this.memoryExtractionEpochs.delete(sessionId)
        }
      }
    })
  }

  private getLatestUserQuery(sessionId: string): string {
    const tailOrderSeq = this.messageStore.getNextOrderSeq(sessionId) - 1
    if (tailOrderSeq < 0) return ''
    const records = this.messageStore.getMessagesUpToOrderSeq(sessionId, tailOrderSeq)
    for (let i = records.length - 1; i >= 0; i -= 1) {
      if (records[i].role === 'user') return this.extractPlainTextFromRecord(records[i])
    }
    return ''
  }

  // Fallback for sessions that never trigger compaction; cursor-gated so it is a no-op
  // once the tail is caught up or the unseen delta is below the threshold.
  private triggerMemoryExtractionFallback(sessionId: string): void {
    if (!this.memoryPort) return
    const agentId = this.getSessionAgentId(sessionId) ?? 'deepchat'
    if (!this.memoryPort.isEnabled(agentId)) return

    // Read the cursor and build the span inside the queued task so a later task sees the
    // cursor a prior one advanced, instead of re-extracting the same stale span.
    this.enqueueSessionExtraction(sessionId, async (epoch) => {
      if (!this.isMemoryExtractionEpochCurrent(sessionId, epoch)) return
      const tailOrderSeq = this.messageStore.getNextOrderSeq(sessionId) - 1
      const cursor =
        this.sqlitePresenter.deepchatSessionsTable.getMemoryCursorOrderSeq(sessionId) ?? 0
      if (tailOrderSeq <= cursor) return
      const span = this.buildMemorySpanFromTape(sessionId, cursor, tailOrderSeq)
      if (!span || span.visibleTextChars <= 0) return
      const delta = tailOrderSeq - cursor
      const admit =
        span.hadToolUse ||
        delta >= MEMORY_FALLBACK_MIN_DELTA ||
        (delta >= 2 && span.visibleTextChars >= MEMORY_MIN_AGENTIC_TEXT_CHARS)
      if (!admit) return
      await this.runMemoryExtraction(
        sessionId,
        {
          spanText: span.spanText,
          sourceEntryIds: span.sourceEntryIds,
          toOrderSeq: tailOrderSeq,
          reason: 'fallback'
        },
        epoch
      )
    })
  }

  private async runMemoryExtraction(
    sessionId: string,
    options: {
      spanText: string
      toOrderSeq: number
      reason: 'compaction' | 'fallback'
      sourceEntryIds?: number[]
    },
    epoch: number
  ): Promise<void> {
    if (!this.memoryPort) return
    try {
      const agentId = this.getSessionAgentId(sessionId) ?? 'deepchat'
      if (!this.memoryPort.isEnabled(agentId)) return
      const state = this.runtimeState.get(sessionId)
      if (!state) return
      if (!this.isMemoryExtractionEpochCurrent(sessionId, epoch)) return

      // Skip if the cursor already passed this span (e.g. a sibling task consumed it first).
      const cursor =
        this.sqlitePresenter.deepchatSessionsTable.getMemoryCursorOrderSeq(sessionId) ?? 0
      if (options.toOrderSeq <= cursor) return

      const result = await this.memoryPort.extractAndStore({
        agentId,
        spanText: options.spanText,
        model: { providerId: state.providerId, modelId: state.modelId },
        sourceSession: sessionId,
        sourceEntryIds: options.sourceEntryIds ?? null
      })

      // Leave the cursor unchanged on failure so this span is retried; a transient LLM or
      // parse error must not mark the span consumed and lose its memories permanently.
      if (!result.ok) return
      if (!this.isMemoryExtractionEpochCurrent(sessionId, epoch)) return
      const createdIds = result.createdIds

      // Success consumes the span even when nothing was extracted.
      this.sqlitePresenter.deepchatSessionsTable.updateMemoryCursorOrderSeq(
        sessionId,
        options.toOrderSeq
      )

      // Audit-only anchor, written only when memories were created; memory/* is not a
      // reconstruction anchor, so it never affects context rebuild.
      if (createdIds.length > 0) {
        this.sqlitePresenter.deepchatTapeEntriesTable.appendAnchor({
          sessionId,
          name: 'memory/extract',
          state: {
            memoryIds: createdIds,
            count: createdIds.length,
            reason: options.reason,
            toOrderSeq: options.toOrderSeq
          }
        })
      }
    } catch (error) {
      logger.warn(`[DeepChatAgent] memory extraction skipped: ${String(error)}`)
    }
  }

  // Builds the extraction span from the effective tape view (retractions, replacements and
  // tool-dedup already applied) over (from, to]. Span text and lineage are gathered from the
  // same pass so a message that contributes no text never leaks into sourceEntryIds.
  private buildMemorySpanFromTape(
    sessionId: string,
    fromOrderSeqExclusive: number,
    toOrderSeqInclusive: number
  ): MemoryAdmissionSpan | null {
    if (toOrderSeqInclusive <= fromOrderSeqExclusive) return null
    const rows = this.sqlitePresenter.deepchatTapeEntriesTable.getBySession(sessionId)
    const view = buildEffectiveTapeView(rows)
    const selected = view.messageEntries.filter(
      (entry) =>
        entry.record.orderSeq > fromOrderSeqExclusive &&
        entry.record.orderSeq <= toOrderSeqInclusive
    )
    if (selected.length === 0) return null
    const windowMsgIds = new Set(selected.map((entry) => entry.record.id))
    const hadToolUse = view.rows.some((row) => {
      const messageId = this.readToolCallMessageId(row)
      return messageId !== null && windowMsgIds.has(messageId)
    })
    const lines: string[] = []
    const sourceEntryIds: number[] = []
    for (const entry of selected) {
      const text = this.extractPlainTextFromRecord(entry.record)
      if (!text) continue
      lines.push(`${entry.record.role === 'user' ? 'User' : 'Assistant'}: ${text}`)
      sourceEntryIds.push(entry.entryId)
    }
    const spanText = lines.join('\n').trim()
    return {
      spanText,
      sourceEntryIds,
      hadToolUse,
      visibleTextChars: spanText.length
    }
  }

  private readToolCallMessageId(row: DeepChatTapeEntryRow): string | null {
    if (row.kind !== 'tool_call') return null
    try {
      const payload = JSON.parse(row.payload_json) as { messageId?: unknown }
      return typeof payload.messageId === 'string' && payload.messageId.length > 0
        ? payload.messageId
        : null
    } catch {
      return null
    }
  }

  private extractPlainTextFromRecord(record: ChatMessageRecord): string {
    try {
      const parsed = JSON.parse(record.content) as unknown
      if (record.role === 'user') {
        const text = (parsed as { text?: unknown })?.text
        return typeof text === 'string' ? text.trim() : ''
      }
      if (Array.isArray(parsed)) {
        return parsed
          .map((block) => {
            const b = block as {
              type?: string
              content?: unknown
            }
            if (b?.type === 'content' && typeof b.content === 'string') return b.content
            return ''
          })
          .filter(Boolean)
          .join(' ')
          .trim()
      }
      return ''
    } catch {
      return ''
    }
  }

  private isAcpBackedSubagentSession(sessionId: string, providerId?: string): boolean {
    const sessionRow = this.sqlitePresenter.newSessionsTable?.get(sessionId)
    if (!sessionRow || sessionRow.session_kind !== 'subagent') {
      return false
    }

    const resolvedProviderId =
      providerId?.trim() || this.runtimeState.get(sessionId)?.providerId?.trim() || ''
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
    return (
      this.activeGenerations.get(sessionId)?.abortController.signal ??
      this.abortControllers.get(sessionId)?.signal
    )
  }

  private ensureSessionAbortController(sessionId: string): AbortController {
    const activeGeneration = this.activeGenerations.get(sessionId)
    if (activeGeneration) {
      if (!activeGeneration.abortController.signal.aborted) {
        return activeGeneration.abortController
      }
      // A just-cancelled run can linger in the map until its handler settles. Never hand an already
      // aborted controller to a fresh turn (it would abort immediately) — drop the stale run first.
      this.clearActiveGeneration(sessionId, activeGeneration.runId)
    }

    const existing = this.abortControllers.get(sessionId)
    if (existing) {
      existing.abort()
    }

    const controller = new AbortController()
    this.abortControllers.set(sessionId, controller)
    return controller
  }

  private clearSessionAbortController(sessionId: string, controller?: AbortController): void {
    const current = this.abortControllers.get(sessionId)
    if (!current) {
      return
    }
    if (controller && current !== controller) {
      return
    }
    this.abortControllers.delete(sessionId)
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

  async compactSession(
    sessionId: string
  ): Promise<{ compacted: boolean; state: SessionCompactionState }> {
    const state = this.runtimeState.get(sessionId) ?? (await this.getSessionListState(sessionId))
    if (!state) {
      throw new Error(`Session ${sessionId} not found`)
    }
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

    this.setSessionStatus(sessionId, 'generating')
    try {
      const generationSettings = await this.getEffectiveSessionGenerationSettings(sessionId)
      const interleavedReasoning = this.resolveInterleavedReasoningConfig(
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
      const activeSkillNames = await this.resolveActiveSkillNamesForToolProfile(sessionId)
      const projectDir = this.resolveProjectDir(sessionId)
      const tools = await this.loadToolDefinitionsForSession(
        sessionId,
        projectDir,
        activeSkillNames
      )
      const toolReserveTokens = estimateToolReserveTokens(tools)
      const baseSystemPrompt = await this.buildSystemPromptWithSkills(
        sessionId,
        generationSettings.systemPrompt,
        tools,
        activeSkillNames
      )
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
        historyRecords: tapeReady.historyRecords
      })

      if (!intent) {
        return {
          compacted: false,
          state: await this.getSessionCompactionState(sessionId)
        }
      }

      const summaryState = await this.applyCompactionIntent(sessionId, intent)
      const compacted = summaryState.summaryUpdatedAt !== intent.previousState.summaryUpdatedAt
      return {
        compacted,
        state: await this.getSessionCompactionState(sessionId)
      }
    } finally {
      this.setSessionStatus(sessionId, 'idle')
    }
  }

  async clearMessages(sessionId: string): Promise<void> {
    const state = await this.getSessionState(sessionId)
    if (!state) {
      throw new Error(`Session ${sessionId} not found`)
    }

    await this.cancelGeneration(sessionId)
    this.pendingInputCoordinator.deleteBySession(sessionId)
    this.clearFirstTurnReady(sessionId)
    this.resetMemoryExtractionCursor(sessionId)
    this.messageStore.deleteBySession(sessionId)
    this.sessionStore.resetTape(sessionId)
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
    this.invalidateMemoryExtractionFromOrderSeq(sessionId, sourceUserMessage.orderSeq)
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
    this.invalidateMemoryExtractionFromOrderSeq(sessionId, target.orderSeq)
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
    this.invalidateMemoryExtractionFromOrderSeq(sessionId, target.orderSeq)
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
    baseSystemPrompt?: string
    initialBlocks?: AssistantMessageBlock[]
    promptPreview?: string
    interleavedReasoning?: InterleavedReasoningConfig
    viewContext?: PendingTapeViewContext
    refreshSystemPrompt?: (
      activeSkillNames: string[] | undefined,
      toolDefinitions: MCPToolDefinition[]
    ) => Promise<string>
    preStreamStartedAt?: number
    onRunRegistered?: (runId: string) => void
  }): Promise<{ runId: string; result: ProcessResult }> {
    const {
      sessionId,
      messageId,
      messages,
      projectDir,
      tools: providedTools,
      baseSystemPrompt,
      initialBlocks,
      promptPreview,
      interleavedReasoning: providedInterleavedReasoning,
      viewContext,
      refreshSystemPrompt,
      preStreamStartedAt,
      onRunRegistered
    } = args
    const state = this.runtimeState.get(sessionId)
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

    const generationSettings = await this.getEffectiveSessionGenerationSettings(sessionId)
    const baseModelConfig = this.configPresenter.getModelConfig(state.modelId, state.providerId)
    const interleavedReasoning =
      providedInterleavedReasoning ??
      this.resolveInterleavedReasoningConfig(state.providerId, state.modelId, generationSettings)
    const contextBudgetLength = this.resolveDeepChatContextBudgetLength(
      state.providerId,
      generationSettings.contextLength,
      baseModelConfig,
      state.modelId
    )
    const capabilityProviderId = this.resolveCapabilityProviderId(state.providerId, state.modelId)
    const reasoningPortrait = this.getReasoningPortrait(state.providerId, state.modelId)
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
    const replaceLeadingSystemPromptInPlace = this.replaceLeadingSystemPromptInPlace.bind(this)
    const persistMessageTrace = this.persistMessageTrace.bind(this)
    const appendTapeViewManifest = this.appendTapeViewManifest.bind(this)
    let requestSeq = Math.max(
      this.tapeService.listViewManifestsByMessage(sessionId, messageId)[0]?.requestSeq ?? 0,
      this.messageStore.getMaxMessageTraceRequestSeq(messageId)
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
        persist: async (payload: ProviderRequestTracePayload) => {
          persistMessageTrace({
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
      await this.resolveActiveSkillNamesForToolProfile(sessionId)
    const getEffectiveRuntimeSkillNames = (baseSkillNames = streamSessionActiveSkillNames) =>
      this.resolveEffectiveActiveSkillNames(baseSkillNames, sessionId)
    const tools =
      providedTools ??
      (await this.loadToolDefinitionsForSession(
        sessionId,
        projectDir,
        getEffectiveRuntimeSkillNames()
      ))
    const supportsVision = this.supportsVision(state.providerId, state.modelId)
    const supportsAudioInput = this.supportsAudioInput(state.providerId, state.modelId)

    const abortController = new AbortController()
    const activeGeneration = this.registerActiveGeneration(sessionId, messageId, abortController)
    onRunRegistered?.(activeGeneration.runId)
    const rateLimitMessageId = this.buildRateLimitStreamMessageId(activeGeneration.runId)
    const emitRateLimitWaitingMessage = this.emitRateLimitWaitingMessage.bind(this)
    const clearRateLimitWaitingMessage = this.clearRateLimitWaitingMessage.bind(this)
    let loggedPreStreamBoundary = false
    const logPreStreamBoundary = () => {
      if (loggedPreStreamBoundary || preStreamStartedAt === undefined) {
        return
      }

      loggedPreStreamBoundary = true
      this.logSlowPreStreamStep(sessionId, 'pre-stream-provider-start', preStreamStartedAt)
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

      let contextOverflowHandoffAttemptedForRun = false
      let strictProviderOverflowRetryUsedForRun = false
      const result = await processStream({
        messages,
        tools,
        refreshTools: async (activeSkillNames) =>
          await this.loadToolDefinitionsForSession(
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
          const refreshedBasePrompt = await this.buildSystemPromptWithSkills(
            sessionId,
            generationSettings.systemPrompt,
            refreshedTools,
            getEffectiveRuntimeSkillNames(activeSkillNames)
          )
          return refreshedBasePrompt
        },
        toolPresenter: this.toolPresenter,
        coreStream: async function* (
          requestMessages,
          requestModelId,
          requestModelConfig,
          requestTemperature,
          requestMaxTokens,
          requestTools
        ) {
          const requestBypassesContextBudget = shouldBypassContextBudget(
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
            }): Promise<{
              providerMessages: ChatMessage[]
              providerMaxTokens: number
            }> => {
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
                    const recovered = await recoverContextPressure({
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
                      replaceLeadingSystemPromptInPlace(requestMessages, recovered.systemPrompt)
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

              const manifestTokenBudget = {
                contextLength: requestModelConfig.contextLength ?? contextBudgetLength,
                requestedMaxTokens: manifestRequestedMaxTokens,
                effectiveMaxTokens: providerMaxTokens,
                reserveTokens: manifestReserveTokens,
                toolReserveTokens: effectiveRequestToolReserveTokens
              }

              requestSeq += 1
              const isInitialViewRequest = requestSeq === 1 && Boolean(viewContext)
              const manifestPolicy = resolveTapeViewManifestPolicy({
                recoveredFromContextPressure,
                isInitialViewRequest,
                viewPolicy: viewContext?.policy,
                viewPolicyVersion: viewContext?.policyVersion
              })
              appendTapeViewManifest({
                sessionId,
                messageId,
                requestSeq,
                taskType: isInitialViewRequest ? viewContext!.taskType : 'tool_loop',
                policy: manifestPolicy.policy,
                policyVersion: manifestPolicy.policyVersion,
                messages: providerMessages,
                tools: effectiveRequestTools,
                tokenBudget: manifestTokenBudget,
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
              const recovered = await recoverContextPressure({
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
                replaceLeadingSystemPromptInPlace(requestMessages, recovered.systemPrompt)
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

              await llmProviderPresenter.executeWithRateLimit(state.providerId, {
                signal: abortController.signal,
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
              if (queuedForRateLimit) {
                clearRateLimitWaitingMessage(sessionId, rateLimitMessageId, activeGeneration.runId)
                queuedForRateLimit = false
              }
              if (abortController.signal.aborted) {
                throw createAbortError()
              }

              logPreStreamBoundary()
              let yieldedProviderEvent = false
              try {
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
              clearRateLimitWaitingMessage(sessionId, rateLimitMessageId, activeGeneration.runId)
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
        hooks: {
          getActiveSkillNames: () => getEffectiveRuntimeSkillNames(),
          activateSkill: async (skillName) => {
            const policy = await this.resolveAgentExtensionPolicy(sessionId)
            if (this.filterSkillNamesByPolicy([skillName], policy).length === 0) {
              return getEffectiveRuntimeSkillNames()
            }
            await this.activateRuntimeSkill(sessionId, skillName)
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
            this.registerActiveProviderPermission(
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
          },
          autoGrantPermission: async (permission) => {
            await this.requireSessionPermissionPort().approvePermission(sessionId, permission)
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
            }),
          cacheImage: this.cacheImage
        },
        io: {
          sessionId,
          requestId: activeGeneration.runId,
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
    try {
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
    } catch (error) {
      logger.warn(
        `[DeepChatAgent] Failed to persist tape view manifest: ${
          error instanceof Error ? error.message : String(error)
        }`
      )
    }
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
  }): Promise<{ messages: ChatMessage[]; systemPrompt?: string; summaryCursorOrderSeq?: number }> {
    let messages = params.requestMessages
    const systemPromptBase =
      params.baseSystemPrompt ?? this.getLeadingSystemPrompt(params.requestMessages) ?? ''
    const tapeReady = this.tapeService.ensureSessionTapeReady(params.sessionId, this.messageStore)
    const intent = await this.compactionService.prepareForContextPressureRecovery({
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

    if (!intent) {
      return { messages }
    }

    const summaryState = await this.applyCompactionIntent(params.sessionId, intent, {
      signal: params.signal
    })
    this.triggerMemoryExtractionFromCompaction(params.sessionId, intent)
    const systemPrompt = await this.appendMemoryInjection(
      params.sessionId,
      appendReconstructionAnchorStateSection(
        appendSummarySection(systemPromptBase, summaryState.summaryText),
        this.sessionStore.getReconstructionAnchorPromptState(params.sessionId)
      ),
      this.getLatestUserQuery(params.sessionId),
      null
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

  private getLeadingSystemPrompt(messages: ChatMessage[]): string | null {
    const first = messages[0]
    return first?.role === 'system' && typeof first.content === 'string' ? first.content : null
  }

  private withoutLeadingSystemMessage(messages: ChatMessage[]): ChatMessage[] {
    return messages[0]?.role === 'system' ? messages.slice(1) : messages
  }

  private replaceLeadingSystemPrompt(messages: ChatMessage[], systemPrompt: string): ChatMessage[] {
    if (!systemPrompt) {
      return this.withoutLeadingSystemMessage(messages)
    }
    if (messages[0]?.role === 'system') {
      return [{ ...messages[0], content: systemPrompt }, ...messages.slice(1)]
    }
    return [{ role: 'system', content: systemPrompt }, ...messages]
  }

  private replaceLeadingSystemPromptInPlace(messages: ChatMessage[], systemPrompt: string): void {
    if (!systemPrompt) {
      if (messages[0]?.role === 'system') {
        messages.shift()
      }
      return
    }
    if (messages[0]?.role === 'system') {
      messages[0] = { ...messages[0], content: systemPrompt }
      return
    }
    messages.unshift({ role: 'system', content: systemPrompt })
  }

  private async drainPendingQueueIfPossible(
    sessionId: string,
    reason: 'enqueue' | 'completed'
  ): Promise<boolean> {
    const state = await this.getSessionState(sessionId)
    if (!state || !this.canStartPendingQueueDrain(sessionId, state.status, reason)) {
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

    this.drainingPendingQueues.add(sessionId)
    try {
      claimedInput =
        pendingInputSource === 'steer'
          ? this.pendingInputCoordinator.claimSteerInput(sessionId, nextPendingInput.id)
          : this.pendingInputCoordinator.claimQueuedInput(sessionId, nextPendingInput.id)
    } catch (error) {
      this.drainingPendingQueues.delete(sessionId)
      console.error('[DeepChatAgent] drainPendingQueueIfPossible error:', error)
      return false
    }

    if (pendingInputSource === 'steer') {
      this.activeSteerPendingInputIds.delete(sessionId)
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
        this.drainingPendingQueues.delete(sessionId)
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
    if (this.drainingPendingQueues.has(sessionId)) {
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
    userMessageId: string | null
  ): void {
    const userMessage = userMessageId ? this.messageStore.getMessage(userMessageId) : null
    if (userMessage) {
      this.invalidateSummaryIfNeeded(sessionId, userMessage.orderSeq)
      this.invalidateMemoryExtractionFromOrderSeq(sessionId, userMessage.orderSeq)
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
    this.clearActiveProviderPermissionsForSession(sessionId)
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
    const activeGeneration = this.activeGenerations.get(sessionId)
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
    const state = this.runtimeState.get(sessionId)
    if (!result || !result.status) {
      if (isActive) {
        this.setSessionStatus(sessionId, 'idle')
      }
      return
    }
    if (result.status === 'paused') {
      if (isActive) {
        this.setSessionStatus(sessionId, 'generating')
      }
      return
    }
    if (result.status === 'completed') {
      this.dispatchTerminalHooks(sessionId, state, result)
      if (isActive) {
        this.setSessionStatus(sessionId, 'idle')
      }
      return
    }
    if (result.status === 'aborted') {
      this.dispatchTerminalHooks(sessionId, state, result)
      if (isActive) {
        this.setSessionStatus(sessionId, 'idle')
      }
      return
    }
    this.dispatchTerminalHooks(sessionId, state, result)
    if (isActive) {
      this.setSessionStatus(sessionId, 'error')
    }
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
    let preStreamAbortController: AbortController | null = null
    let preStreamAbortSignal: AbortSignal | undefined
    let streamRunId: string | undefined

    try {
      const state = this.runtimeState.get(sessionId)
      if (!state) {
        throw new Error(`Session ${sessionId} not found`)
      }

      this.setSessionStatus(sessionId, 'generating')
      preStreamAbortController = this.ensureSessionAbortController(sessionId)
      preStreamAbortSignal = preStreamAbortController.signal
      this.throwIfAbortRequested(preStreamAbortSignal)
      const generationSettings = await this.getEffectiveSessionGenerationSettings(sessionId)
      const modelConfig = this.configPresenter.getModelConfig(state.modelId, state.providerId)
      const useContextBudget = this.shouldUseDeepChatContextBudget(
        state.providerId,
        modelConfig,
        state.modelId
      )
      this.throwIfAbortRequested(preStreamAbortSignal)
      const interleavedReasoning = this.resolveInterleavedReasoningConfig(
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
      const projectDir = this.resolveProjectDir(sessionId)
      const activeSkillNames = await this.resolveActiveSkillNamesForToolProfile(sessionId)
      const tools = await this.loadToolDefinitionsForSession(
        sessionId,
        projectDir,
        activeSkillNames
      )
      const toolReserveTokens = estimateToolReserveTokens(tools)
      this.throwIfAbortRequested(preStreamAbortSignal)
      const baseSystemPrompt = await this.buildSystemPromptWithSkills(
        sessionId,
        generationSettings.systemPrompt,
        tools,
        activeSkillNames
      )
      this.throwIfAbortRequested(preStreamAbortSignal)
      const tapeReady = this.tapeService.ensureSessionTapeReady(sessionId, this.messageStore)
      const resumeTargetOrderSeq =
        tapeReady.historyRecords.find((record) => record.id === messageId)?.orderSeq ??
        this.messageStore.getMessage(messageId)?.orderSeq
      const summaryState = useContextBudget
        ? await this.resolveCompactionStateForResumeTurn({
            sessionId,
            messageId,
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
            compactionMessageOrderSeq: resumeTargetOrderSeq,
            signal: preStreamAbortSignal
          })
        : this.sessionStore.getSummaryState(sessionId)
      this.throwIfAbortRequested(preStreamAbortSignal)
      const resumeTapeReady = this.tapeService.ensureSessionTapeReady(sessionId, this.messageStore)
      const systemPrompt = await this.appendMemoryInjection(
        sessionId,
        appendReconstructionAnchorStateSection(
          appendSummarySection(baseSystemPrompt, summaryState.summaryText),
          this.sessionStore.getReconstructionAnchorPromptState(sessionId)
        ),
        this.getLatestUserQuery(sessionId),
        messageId
      )
      const resumeContextBuild = buildTapeResumeView({
        sessionId,
        assistantMessageId: messageId,
        systemPrompt,
        contextLength: contextBudgetLength,
        reserveTokens: maxTokens,
        messageStore: this.messageStore,
        supportsVision: this.supportsVision(state.providerId, state.modelId),
        historyRecords: resumeTapeReady.historyRecords,
        options: {
          summaryCursorOrderSeq: summaryState.summaryCursorOrderSeq,
          fallbackProtectedTurnCount: 1,
          supportsAudioInput: this.supportsAudioInput(state.providerId, state.modelId),
          extraReserveTokens: toolReserveTokens,
          preserveInterleavedReasoning: interleavedReasoning.preserveReasoningContent,
          preserveEmptyInterleavedReasoning:
            interleavedReasoning.preserveEmptyReasoningContent === true
        }
      })
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
          publishDeepchatEvent('chat.stream.failed', {
            requestId: this.resolveStreamRequestId(sessionId, messageId),
            sessionId,
            messageId,
            failedAt: Date.now(),
            error: resumeBudget.message
          })
          this.setSessionStatus(sessionId, 'error')
          return false
        }
      }

      this.throwIfAbortRequested(preStreamAbortSignal)
      const streamResult = await this.runStreamForMessage({
        sessionId,
        messageId,
        messages: resumeContext,
        projectDir,
        tools,
        baseSystemPrompt,
        initialBlocks,
        interleavedReasoning,
        viewContext: {
          taskType: 'resume',
          policy: resumeContextBuild.policyId,
          policyVersion: resumeContextBuild.policyVersion,
          selection: buildTapeViewSelection(resumeContextBuild.metadata),
          summaryCursorOrderSeq: summaryState.summaryCursorOrderSeq,
          supportsVision: this.supportsVision(state.providerId, state.modelId),
          supportsAudioInput: this.supportsAudioInput(state.providerId, state.modelId),
          traceDebugEnabled: this.configPresenter.getSetting<boolean>('traceDebugEnabled') === true
        },
        onRunRegistered: (runId) => {
          streamRunId = runId
        }
      })
      const { runId, result } = streamResult
      streamRunId = runId
      try {
        this.applyProcessResultStatus(sessionId, result, runId)
      } finally {
        this.clearActiveGeneration(sessionId, runId)
      }
      if (result?.status === 'aborted') {
        // Return-path abort: applyProcessResultStatus already handled hooks + idle.
        this.writeCanceledTerminalBlock(sessionId, messageId)
      }
      if (result?.status === 'completed' || result?.status === 'aborted') {
        void this.drainPendingQueueIfPossible(sessionId, 'completed')
        this.triggerMemoryExtractionFallback(sessionId)
      }
      return true
    } catch (error) {
      console.error('[DeepChatAgent] resumeAssistantMessage error:', error)
      if (this.isAbortError(error) || preStreamAbortSignal?.aborted) {
        this.clearSessionAbortController(sessionId, preStreamAbortController ?? undefined)
        this.settleAbortedTurn(sessionId, messageId, streamRunId)
        // Stop/steer: continue the queue automatically with the next item (steer items first).
        void this.drainPendingQueueIfPossible(sessionId, 'completed')
        return false
      }
      const errorMessage = error instanceof Error ? error.message : String(error)
      const blocks = buildTerminalErrorBlocks(initialBlocks, errorMessage)
      this.messageStore.setMessageError(messageId, blocks)
      this.emitMessageRefresh(sessionId, messageId)
      this.setSessionStatus(sessionId, 'error')
      throw error
    } finally {
      this.clearSessionAbortController(sessionId, preStreamAbortController ?? undefined)
      this.resumingMessages.delete(messageId)
    }
  }

  private async buildSystemPromptWithSkills(
    sessionId: string,
    basePrompt: string,
    toolDefinitions: MCPToolDefinition[],
    activeSkillNamesOverride?: string[]
  ): Promise<string> {
    const normalizedBase = basePrompt?.trim() ?? ''
    const state = this.runtimeState.get(sessionId)
    const providerId = state?.providerId?.trim() || 'unknown-provider'
    const modelId = state?.modelId?.trim() || 'unknown-model'
    if (this.isAcpBackedSubagentSession(sessionId, providerId)) {
      return normalizedBase
    }

    const workdir = this.resolveProjectDir(sessionId)
    const now = new Date()
    const dayKey = this.buildLocalDayKey(now)

    const skillsEnabled = this.configPresenter.getSkillsEnabled()
    const skillPresenter = this.skillPresenter
    const availableSkills: Array<{
      name: string
      description: string
      category?: string | null
      platforms?: string[]
    }> = []
    const activeSkillNames: string[] = activeSkillNamesOverride ? [...activeSkillNamesOverride] : []
    const skillDraftSuggestionsEnabled =
      this.configPresenter.getSkillDraftSuggestionsEnabled?.() ?? false

    const extensionPolicy = await this.resolveAgentExtensionPolicy(sessionId)
    const allowedSkillNameSet =
      extensionPolicy.enabledSkillNames === null || extensionPolicy.enabledSkillNames === undefined
        ? null
        : new Set(this.normalizeSkillNames(extensionPolicy.enabledSkillNames))
    const allowedPluginIdSet =
      extensionPolicy.enabledPluginIds === null || extensionPolicy.enabledPluginIds === undefined
        ? null
        : new Set(this.normalizeSkillNames(extensionPolicy.enabledPluginIds))

    if (skillsEnabled && skillPresenter) {
      if (skillPresenter.getMetadataList) {
        const stepStartedAt = Date.now()
        try {
          const metadataList = await skillPresenter.getMetadataList()
          for (const metadata of metadataList) {
            const skillName = metadata?.name?.trim()
            const ownerPluginId = metadata?.ownerPluginId?.trim()
            if (
              skillName &&
              (!allowedSkillNameSet || allowedSkillNameSet.has(skillName)) &&
              (!ownerPluginId || !allowedPluginIdSet || allowedPluginIdSet.has(ownerPluginId))
            ) {
              availableSkills.push({
                name: skillName,
                description: metadata.description?.trim() || '',
                category: metadata.category ?? null,
                platforms: metadata.platforms
              })
            }
          }
        } catch (error) {
          console.warn(
            `[DeepChatAgent] Failed to load skills metadata for session ${sessionId}:`,
            error
          )
        }
        this.logSlowPreStreamStep(sessionId, 'system-prompt.skills-metadata-load', stepStartedAt)
      }

      if (!activeSkillNamesOverride && skillPresenter.getActiveSkills) {
        const stepStartedAt = Date.now()
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
        this.logSlowPreStreamStep(sessionId, 'system-prompt.active-skills-load', stepStartedAt)
      }
    }

    let stepStartedAt = Date.now()
    const normalizedAvailableSkills = this.normalizeSkillMetadata(availableSkills)
    const availableSkillNames = new Set(normalizedAvailableSkills.map((skill) => skill.name))
    const normalizedActiveSkills = this.filterSkillNamesByPolicy(
      activeSkillNames.filter((skillName) => availableSkillNames.has(skillName)),
      extensionPolicy
    )
    const agentToolNames = this.getAgentToolNames(toolDefinitions)
    const fingerprint = this.buildSystemPromptFingerprint({
      providerId,
      modelId,
      workdir,
      basePrompt: normalizedBase,
      skillsEnabled,
      availableSkillNames: normalizedAvailableSkills.map((skill) => skill.name),
      activeSkillNames: normalizedActiveSkills,
      toolSignature: this.buildToolSignature(toolDefinitions),
      skillDraftSuggestionsEnabled
    })
    this.logSlowPreStreamStep(sessionId, 'system-prompt.fingerprint', stepStartedAt)

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
      ? this.buildSkillsMetadataPrompt(
          normalizedAvailableSkills,
          {
            canListSkills: agentToolNames.has('skill_list'),
            canViewSkills: agentToolNames.has('skill_view'),
            canManageDraftSkills: agentToolNames.has('skill_manage'),
            canRunSkillScripts: agentToolNames.has('skill_run')
          },
          skillDraftSuggestionsEnabled
        )
      : ''

    let skillsPrompt = ''
    if (skillsEnabled && skillPresenter?.loadSkillContent && normalizedActiveSkills.length > 0) {
      stepStartedAt = Date.now()
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
      skillsPrompt = this.buildPinnedSkillsPrompt(skillSections)
      this.logSlowPreStreamStep(sessionId, 'system-prompt.pinned-skills-load', stepStartedAt)
    }

    let envPrompt = ''
    try {
      stepStartedAt = Date.now()
      envPrompt = await buildSystemEnvPrompt({
        providerId,
        modelId,
        workdir,
        now,
        modelLookup: this.providerCatalogPort
      })
      this.logSlowPreStreamStep(sessionId, 'system-prompt.env-prompt', stepStartedAt)
    } catch (error) {
      console.warn(`[DeepChatAgent] Failed to build env prompt for session ${sessionId}:`, error)
    }

    let toolingPrompt = ''
    if (this.toolPresenter) {
      try {
        stepStartedAt = Date.now()
        toolingPrompt = this.toolPresenter.buildToolSystemPrompt({
          conversationId: sessionId,
          toolDefinitions
        })
        this.logSlowPreStreamStep(sessionId, 'system-prompt.tooling-prompt', stepStartedAt)
      } catch (error) {
        console.warn(
          `[DeepChatAgent] Failed to build tooling prompt for session ${sessionId}:`,
          error
        )
      }
    }

    stepStartedAt = Date.now()
    const composedPrompt = this.composePromptSections([
      normalizedBase,
      runtimePrompt,
      envPrompt,
      skillsMetadataPrompt,
      skillsPrompt,
      toolingPrompt,
      this.buildPermissionRulesPrompt(agentToolNames),
      this.buildVerificationPolicyPrompt(workdir)
    ])
    this.logSlowPreStreamStep(sessionId, 'system-prompt.compose', stepStartedAt)

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

  private buildPermissionRulesPrompt(agentToolNames: Set<string>): string {
    const readOnlyTools = ['read'].filter((toolName) => agentToolNames.has(toolName))
    const serializedTools = ['write', 'edit', 'exec', 'process'].filter((toolName) =>
      agentToolNames.has(toolName)
    )

    if (readOnlyTools.length === 0 && serializedTools.length === 0) {
      return ''
    }

    const lines = ['## Permission Rules']
    if (readOnlyTools.length > 0) {
      lines.push(
        `Read-only Agent tools may be batched in parallel when useful: ${readOnlyTools
          .map((toolName) => `\`${toolName}\``)
          .join(', ')}.`
      )
    }
    if (serializedTools.length > 0) {
      lines.push(
        `Mutating and runtime tools stay serialized or permission-gated: ${serializedTools
          .map((toolName) => `\`${toolName}\``)
          .join(', ')}.`
      )
    }
    lines.push('Do not assume approval for file writes or commands when the session asks for it.')

    return lines.join('\n')
  }

  private buildVerificationPolicyPrompt(workdir: string | null): string {
    const lines = [
      '## Verification Policy',
      'After changing code, configuration, tests, docs that affect behavior, or generated assets, check verification status before the final response.',
      'If verification was not run, state the reason explicitly in the final response.'
    ]

    const normalizedWorkdir = workdir?.trim()
    if (!normalizedWorkdir) {
      return lines.join('\n')
    }

    const verificationScripts = getVerificationScriptNames(normalizedWorkdir)
    const manifest = readPackageJsonManifest(normalizedWorkdir)
    const isDeepChatWorkspace =
      String(manifest?.name ?? '').toLowerCase() === 'deepchat' ||
      ['format', 'i18n', 'lint'].every((scriptName) => verificationScripts.includes(scriptName))

    if (isDeepChatWorkspace) {
      lines.push(
        'In the DeepChat repository, prioritize `pnpm run format`, `pnpm run i18n`, and `pnpm run lint` after feature work.'
      )
    } else if (verificationScripts.length > 0) {
      const suggestedScripts = verificationScripts
        .slice(0, 4)
        .map((scriptName) => `\`${scriptName}\``)
      lines.push(
        `When relevant, prefer project-local verification scripts such as ${suggestedScripts.join(', ')}.`
      )
    }

    return lines.join('\n')
  }

  private buildSkillsMetadataPrompt(
    availableSkills: Array<{
      name: string
      description: string
      category?: string | null
      platforms?: string[]
    }>,
    capabilities: {
      canListSkills: boolean
      canViewSkills: boolean
      canManageDraftSkills: boolean
      canRunSkillScripts: boolean
    },
    skillDraftSuggestionsEnabled: boolean
  ): string {
    if (
      !capabilities.canListSkills &&
      !capabilities.canViewSkills &&
      !capabilities.canManageDraftSkills &&
      !capabilities.canRunSkillScripts
    ) {
      return ''
    }

    const lines = ['## Skills']
    let hasContent = false

    if (capabilities.canListSkills || capabilities.canViewSkills) {
      lines.push(
        'Before replying, always scan available skills. If any skill plausibly matches the task, call `skill_view` first.'
      )
      lines.push(
        'Viewing a skill root `SKILL.md` activates that skill for the current message/tool loop; it does not pin the skill to the conversation. Viewing linked skill files is read-only and does not activate the skill.'
      )
      hasContent = true
    }
    if (capabilities.canRunSkillScripts) {
      lines.push(
        'Use `skill_run` only for skills that are active in the current message/tool loop, including manually pinned skills and skills activated by `skill_view`.'
      )
      hasContent = true
    }
    if (capabilities.canManageDraftSkills && skillDraftSuggestionsEnabled) {
      lines.push(
        'After completing a complex task, solving a tricky bug, or discovering a non-trivial workflow, you may draft a reusable skill with `skill_manage`.'
      )
      lines.push(
        'Only propose one draft per task, do it after the main answer is complete, and use `deepchat_question` to ask whether the user wants to keep the draft.'
      )
      lines.push(
        'Do not modify installed skills with `skill_manage`; it is draft-only in this version.'
      )
      hasContent = true
    }

    if (availableSkills.length > 0) {
      lines.push('<available_skills>')
      lines.push(
        ...availableSkills.map((skill) => {
          const details: string[] = []
          if (skill.category) {
            details.push(`category=${skill.category}`)
          }
          if (skill.platforms?.length) {
            details.push(`platforms=${skill.platforms.join(',')}`)
          }
          const suffix = details.length > 0 ? ` [${details.join('; ')}]` : ''
          return `- ${skill.name}: ${skill.description}${suffix}`
        })
      )
      lines.push('</available_skills>')
      hasContent = true
    } else if (hasContent) {
      lines.push('<available_skills>')
      lines.push('(none)')
      lines.push('</available_skills>')
    }

    return hasContent ? lines.join('\n') : ''
  }

  private buildPinnedSkillsPrompt(skillSections: string[]): string {
    if (skillSections.length === 0) {
      return ''
    }
    return [
      '## Active Skills',
      'These skills are active for the current message context. Some may be manually pinned for the conversation; others may have been activated by `skill_view` for this message/tool loop only. Follow them when relevant.',
      '',
      skillSections.join('\n\n')
    ].join('\n')
  }

  private resetRuntimeActivatedSkills(sessionId: string): void {
    this.runtimeActivatedSkillsBySession.delete(sessionId)
  }

  private setRuntimeActivatedSkills(sessionId: string, skillNames: string[]): void {
    const normalizedSkillNames = this.normalizeSkillNames(skillNames)
    if (normalizedSkillNames.length === 0) {
      return
    }
    this.runtimeActivatedSkillsBySession.set(sessionId, new Set(normalizedSkillNames))
  }

  private getRuntimeActivatedSkills(sessionId: string): string[] {
    return this.normalizeSkillNames(
      Array.from(this.runtimeActivatedSkillsBySession.get(sessionId) ?? [])
    )
  }

  private async activateRuntimeSkill(sessionId: string, skillName: string): Promise<string[]> {
    const normalizedSkillName = skillName.trim()
    if (!normalizedSkillName) {
      return this.getRuntimeActivatedSkills(sessionId)
    }

    let activeSkills = this.runtimeActivatedSkillsBySession.get(sessionId)
    if (!activeSkills) {
      activeSkills = new Set<string>()
      this.runtimeActivatedSkillsBySession.set(sessionId, activeSkills)
    }
    activeSkills.add(normalizedSkillName)
    this.invalidateSystemPromptCache(sessionId)
    this.invalidateToolProfileCache(sessionId)
    return this.getRuntimeActivatedSkills(sessionId)
  }

  private resolveEffectiveActiveSkillNames(
    sessionActiveSkillNames: string[],
    sessionId: string
  ): string[] {
    return this.normalizeSkillNames([
      ...sessionActiveSkillNames,
      ...this.getRuntimeActivatedSkills(sessionId)
    ])
  }

  private normalizeSkillNames(skillNames: string[]): string[] {
    return Array.from(
      new Set(skillNames.map((name) => name.trim()).filter((name) => name.length > 0))
    ).sort((a, b) => a.localeCompare(b))
  }

  private normalizeSkillMetadata(
    skills: Array<{
      name: string
      description: string
      category?: string | null
      platforms?: string[]
    }>
  ): Array<{
    name: string
    description: string
    category?: string | null
    platforms?: string[]
  }> {
    const deduped = new Map<string, (typeof skills)[number]>()
    for (const skill of skills) {
      const name = skill.name.trim()
      if (!name || deduped.has(name)) {
        continue
      }
      deduped.set(name, {
        ...skill,
        name,
        description: skill.description.trim(),
        category: skill.category?.trim() || null,
        platforms: skill.platforms?.map((platform) => platform.trim()).filter(Boolean)
      })
    }
    return Array.from(deduped.values()).sort((left, right) => {
      return (
        (left.category ?? '').localeCompare(right.category ?? '') ||
        left.name.localeCompare(right.name)
      )
    })
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
    skillDraftSuggestionsEnabled: boolean
  }): string {
    return JSON.stringify({
      providerId: params.providerId,
      modelId: params.modelId,
      workdir: params.workdir ?? '',
      basePrompt: params.basePrompt,
      skillsEnabled: params.skillsEnabled,
      availableSkillNames: params.availableSkillNames,
      activeSkillNames: params.activeSkillNames,
      toolSignature: params.toolSignature,
      skillDraftSuggestionsEnabled: params.skillDraftSuggestionsEnabled
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
    this.invalidateToolProfileCache(sessionId)
  }

  private invalidateSystemPromptCache(sessionId: string): void {
    this.systemPromptCache.delete(sessionId)
  }

  private invalidateToolProfileCache(sessionId: string): void {
    this.toolProfileCache.delete(sessionId)
  }

  private readonly handleToolRegistryChanged = (): void => {
    this.toolRegistryRevision += 1
    this.toolProfileCache.clear()
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
    if (sessionRow.top_p !== null) {
      patch.topP = sessionRow.top_p
    }
    if (sessionRow.context_length !== null) {
      patch.contextLength = sessionRow.context_length
    }
    if (sessionRow.max_tokens !== null) {
      patch.maxTokens = sessionRow.max_tokens
    }
    if (sessionRow.timeout_ms !== null) {
      patch.timeout = sessionRow.timeout_ms
    }
    if (sessionRow.thinking_budget !== null) {
      patch.thinkingBudget = normalizeLegacyThinkingBudgetValue(sessionRow.thinking_budget)
    }
    if (sessionRow.reasoning_effort !== null) {
      patch.reasoningEffort = sessionRow.reasoning_effort
    }
    if (sessionRow.reasoning_visibility !== null) {
      const reasoningVisibility = this.normalizeReasoningVisibility(
        sessionRow.provider_id,
        sessionRow.model_id,
        sessionRow.reasoning_visibility
      )
      if (reasoningVisibility) {
        patch.reasoningVisibility = reasoningVisibility
      }
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
    if (Object.prototype.hasOwnProperty.call(requestedPatch, 'topP')) {
      patch.topP = sanitized.topP
    }
    if (Object.prototype.hasOwnProperty.call(requestedPatch, 'contextLength')) {
      patch.contextLength = sanitized.contextLength
    }
    if (Object.prototype.hasOwnProperty.call(requestedPatch, 'maxTokens')) {
      patch.maxTokens = sanitized.maxTokens
    }
    if (Object.prototype.hasOwnProperty.call(requestedPatch, 'timeout')) {
      patch.timeout = sanitized.timeout
    }
    if (Object.prototype.hasOwnProperty.call(requestedPatch, 'thinkingBudget')) {
      patch.thinkingBudget = sanitized.thinkingBudget
    }
    if (Object.prototype.hasOwnProperty.call(requestedPatch, 'reasoningEffort')) {
      patch.reasoningEffort = sanitized.reasoningEffort
    }
    if (Object.prototype.hasOwnProperty.call(requestedPatch, 'reasoningVisibility')) {
      patch.reasoningVisibility = sanitized.reasoningVisibility
    }
    if (Object.prototype.hasOwnProperty.call(requestedPatch, 'verbosity')) {
      patch.verbosity = sanitized.verbosity
    }
    if (Object.prototype.hasOwnProperty.call(requestedPatch, 'forceInterleavedThinkingCompat')) {
      patch.forceInterleavedThinkingCompat = sanitized.forceInterleavedThinkingCompat
    }
    if (Object.prototype.hasOwnProperty.call(requestedPatch, 'imageGeneration')) {
      patch.imageGeneration = sanitized.imageGeneration
    }
    if (Object.prototype.hasOwnProperty.call(requestedPatch, 'videoGeneration')) {
      patch.videoGeneration = sanitized.videoGeneration
    }

    return patch
  }

  private buildPersistedGenerationSettingsReplacement(
    settings: SessionGenerationSettings
  ): Partial<SessionGenerationSettings> {
    return {
      systemPrompt: settings.systemPrompt,
      temperature: settings.temperature,
      topP: settings.topP,
      contextLength: settings.contextLength,
      maxTokens: settings.maxTokens,
      timeout: settings.timeout,
      thinkingBudget: settings.thinkingBudget,
      reasoningEffort: settings.reasoningEffort,
      reasoningVisibility: settings.reasoningVisibility,
      verbosity: settings.verbosity,
      forceInterleavedThinkingCompat: settings.forceInterleavedThinkingCompat,
      imageGeneration: settings.imageGeneration,
      videoGeneration: settings.videoGeneration
    }
  }

  private resolveProviderApiType(providerId: string): string | undefined {
    return this.configPresenter.getProviderById?.(providerId)?.apiType
  }

  private async buildDefaultGenerationSettings(
    providerId: string,
    modelId: string
  ): Promise<SessionGenerationSettings> {
    const modelConfig = this.configPresenter.getModelConfig(modelId, providerId)
    const fixedTemperatureKimi = resolveMoonshotKimiTemperaturePolicy(
      providerId,
      modelId,
      modelConfig.reasoning
    )
    const portrait = this.getReasoningPortrait(providerId, modelId)
    const capabilityProviderId = this.resolveCapabilityProviderId(providerId, modelId)
    const anthropicReasoningToggle = hasAnthropicReasoningToggle(capabilityProviderId, portrait)
    const anthropicReasoningEnabled = anthropicReasoningToggle
      ? getReasoningEffectiveEnabledForProvider(capabilityProviderId, portrait, {
          reasoning: modelConfig.reasoning,
          reasoningEffort: modelConfig.reasoningEffort
        })
      : true
    const defaultSystemPrompt = await this.configPresenter.getDefaultSystemPrompt()
    const contextLengthDefault = toValidNonNegativeInteger(modelConfig.contextLength) ?? 32000
    const rawProviderMaxTokensDefault = toValidNonNegativeInteger(modelConfig.maxTokens)
    const providerMaxTokensDefault =
      rawProviderMaxTokensDefault && rawProviderMaxTokensDefault > 0
        ? rawProviderMaxTokensDefault
        : Math.min(4096, contextLengthDefault)
    const maxTokensDefault = capAgentDefaultMaxTokens(
      providerMaxTokensDefault,
      contextLengthDefault
    )
    const timeoutDefault = toValidNonNegativeInteger(modelConfig.timeout) ?? DEFAULT_MODEL_TIMEOUT

    const defaults: SessionGenerationSettings = {
      systemPrompt: defaultSystemPrompt ?? '',
      temperature:
        fixedTemperatureKimi?.temperature ??
        parseFiniteNumericValue(modelConfig.temperature) ??
        0.7,
      topP: normalizeTopP(modelConfig.topP),
      contextLength: contextLengthDefault,
      timeout:
        timeoutDefault >= MODEL_TIMEOUT_MIN_MS && timeoutDefault <= MODEL_TIMEOUT_MAX_MS
          ? timeoutDefault
          : DEFAULT_MODEL_TIMEOUT,
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

    if (
      supportsOpenAIImageGenerationSettings({
        providerId,
        providerApiType: this.resolveProviderApiType(providerId),
        modelId,
        apiEndpoint: modelConfig.apiEndpoint,
        endpointType: modelConfig.endpointType,
        type: modelConfig.type
      })
    ) {
      const imageGeneration = normalizeImageGenerationOptions(modelConfig.imageGeneration)
      if (imageGeneration) {
        defaults.imageGeneration = imageGeneration
      }
    }

    if (
      supportsOpenAICompatibleVideoGeneration({
        providerId,
        providerApiType: this.resolveProviderApiType(providerId),
        modelId,
        apiEndpoint: modelConfig.apiEndpoint,
        endpointType: modelConfig.endpointType,
        type: modelConfig.type
      })
    ) {
      const videoGeneration = normalizeVideoGenerationOptions(modelConfig.videoGeneration)
      if (videoGeneration) {
        defaults.videoGeneration = videoGeneration
      }
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
    if (supportsEffort && (!anthropicReasoningToggle || anthropicReasoningEnabled)) {
      const rawEffort =
        modelConfig.reasoningEffort ??
        this.configPresenter.getReasoningEffortDefault?.(providerId, modelId)
      const normalizedEffort = this.normalizeReasoningEffort(providerId, modelId, rawEffort)
      if (normalizedEffort) {
        defaults.reasoningEffort = normalizedEffort
      }
    }

    if (anthropicReasoningToggle && anthropicReasoningEnabled) {
      const rawVisibility = modelConfig.reasoningVisibility ?? portrait?.visibility
      const normalizedVisibility = this.normalizeReasoningVisibility(
        providerId,
        modelId,
        rawVisibility
      )
      if (normalizedVisibility) {
        defaults.reasoningVisibility = normalizedVisibility
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
    const modelConfig = this.configPresenter.getModelConfig(modelId, providerId)
    const fixedTemperatureKimi = resolveMoonshotKimiTemperaturePolicy(
      providerId,
      modelId,
      modelConfig.reasoning
    )
    const portrait = this.getReasoningPortrait(providerId, modelId)
    const capabilityProviderId = this.resolveCapabilityProviderId(providerId, modelId)
    const anthropicReasoningToggle = hasAnthropicReasoningToggle(capabilityProviderId, portrait)
    const anthropicReasoningEnabled = anthropicReasoningToggle
      ? getReasoningEffectiveEnabledForProvider(capabilityProviderId, portrait, {
          reasoning: modelConfig.reasoning,
          reasoningEffort: modelConfig.reasoningEffort
        })
      : true
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

    if (Object.prototype.hasOwnProperty.call(patch, 'topP')) {
      const normalizedTopP = normalizeTopP(patch.topP)
      if (normalizedTopP !== undefined) {
        next.topP = normalizedTopP
      } else {
        delete next.topP
      }
    }

    if (Object.prototype.hasOwnProperty.call(patch, 'timeout')) {
      const error = validateGenerationNumericField('timeout', patch.timeout)
      const numeric = toValidNonNegativeInteger(parseFiniteNumericValue(patch.timeout))
      if (!error && numeric !== undefined) {
        next.timeout = numeric
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
    if (supportsEffort && (!anthropicReasoningToggle || anthropicReasoningEnabled)) {
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

    if (anthropicReasoningToggle && anthropicReasoningEnabled) {
      const fromPatch = Object.prototype.hasOwnProperty.call(patch, 'reasoningVisibility')
        ? patch.reasoningVisibility
        : next.reasoningVisibility
      const defaultVisibility = this.normalizeReasoningVisibility(
        providerId,
        modelId,
        modelConfig.reasoningVisibility ?? portrait?.visibility
      )
      const normalizedVisibility =
        this.normalizeReasoningVisibility(providerId, modelId, fromPatch) ?? defaultVisibility
      if (normalizedVisibility) {
        next.reasoningVisibility = normalizedVisibility
      } else {
        delete next.reasoningVisibility
      }
    } else {
      delete next.reasoningVisibility
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

    if (
      supportsOpenAIImageGenerationSettings({
        providerId,
        providerApiType: this.resolveProviderApiType(providerId),
        modelId,
        apiEndpoint: modelConfig.apiEndpoint,
        endpointType: modelConfig.endpointType,
        type: modelConfig.type
      })
    ) {
      if (Object.prototype.hasOwnProperty.call(patch, 'imageGeneration')) {
        const imageGeneration = normalizeImageGenerationOptions(patch.imageGeneration)
        if (imageGeneration) {
          next.imageGeneration = imageGeneration
        } else {
          delete next.imageGeneration
        }
      } else {
        const imageGeneration = normalizeImageGenerationOptions(next.imageGeneration)
        if (imageGeneration) {
          next.imageGeneration = imageGeneration
        } else {
          delete next.imageGeneration
        }
      }
    } else {
      delete next.imageGeneration
    }

    if (
      supportsOpenAICompatibleVideoGeneration({
        providerId,
        providerApiType: this.resolveProviderApiType(providerId),
        modelId,
        apiEndpoint: modelConfig.apiEndpoint,
        endpointType: modelConfig.endpointType,
        type: modelConfig.type
      })
    ) {
      if (Object.prototype.hasOwnProperty.call(patch, 'videoGeneration')) {
        const videoGeneration = normalizeVideoGenerationOptions(patch.videoGeneration)
        if (videoGeneration) {
          next.videoGeneration = videoGeneration
        } else {
          delete next.videoGeneration
        }
      } else {
        const videoGeneration = normalizeVideoGenerationOptions(next.videoGeneration)
        if (videoGeneration) {
          next.videoGeneration = videoGeneration
        } else {
          delete next.videoGeneration
        }
      }
    } else {
      delete next.videoGeneration
    }

    if (fixedTemperatureKimi) {
      next.temperature = fixedTemperatureKimi.temperature
    }

    return next
  }

  private resolveInterleavedReasoningConfig(
    providerId: string,
    modelId: string,
    generationSettings: SessionGenerationSettings
  ): InterleavedReasoningConfig {
    const portrait = this.getReasoningPortrait(providerId, modelId)
    const isDeepSeekSeries = isDeepSeekSeriesModelId(modelId)
    const explicitSessionSetting =
      typeof generationSettings.forceInterleavedThinkingCompat === 'boolean'
        ? generationSettings.forceInterleavedThinkingCompat
        : undefined
    const forcedBySessionSetting = explicitSessionSetting === true
    const portraitInterleaved = portrait?.interleaved === true
    const reasoningSupported =
      this.configPresenter.supportsReasoningCapability?.(providerId, modelId) === true
    const preserveReasoningContent =
      isDeepSeekSeries ||
      (explicitSessionSetting !== undefined ? explicitSessionSetting : portraitInterleaved)

    return {
      preserveReasoningContent,
      preserveEmptyReasoningContent: isDeepSeekSeries,
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
    return normalizeReasoningEffortValue(portrait, normalizedValue)
  }

  private normalizeReasoningVisibility(
    providerId: string,
    modelId: string | undefined,
    value: unknown
  ): SessionGenerationSettings['reasoningVisibility'] | undefined {
    if (!modelId) {
      return (
        normalizeAnthropicReasoningVisibilityValue(value) ??
        normalizeReasoningVisibilityValue(value)
      )
    }

    const portrait = this.getReasoningPortrait(providerId, modelId)
    const capabilityProviderId = this.resolveCapabilityProviderId(providerId, modelId)
    if (hasAnthropicReasoningToggle(capabilityProviderId, portrait)) {
      return normalizeAnthropicReasoningVisibilityValue(value) ?? 'omitted'
    }

    return normalizeReasoningVisibilityValue(value)
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

  private resolveCapabilityProviderId(providerId: string, modelId: string | undefined): string {
    if (!modelId) {
      return providerId
    }

    return this.configPresenter.getCapabilityProviderId?.(providerId, modelId) ?? providerId
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
      const activeSkills = this.normalizeSkillNames(
        Array.isArray((parsed as { activeSkills?: unknown }).activeSkills)
          ? ((parsed as { activeSkills?: unknown }).activeSkills as string[])
          : []
      )
      return {
        text,
        files,
        ...(activeSkills.length > 0 ? { activeSkills } : {})
      }
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
    const activeSkills = this.normalizeSkillNames(
      Array.isArray(input.activeSkills) ? input.activeSkills : []
    )
    return {
      text,
      files,
      ...(activeSkills.length > 0 ? { activeSkills } : {})
    }
  }

  private queueVisibleSteerInput(
    sessionId: string,
    input: SendMessageInput
  ): PendingSessionInputRecord {
    const mergeItemId = this.activeSteerPendingInputIds.get(sessionId) ?? null
    try {
      const record = this.pendingInputCoordinator.queueSteerInput(sessionId, input, {
        mergeItemId
      })
      this.activeSteerPendingInputIds.set(sessionId, record.id)
      return record
    } catch (error) {
      if (!mergeItemId) {
        throw error
      }
      this.activeSteerPendingInputIds.delete(sessionId)
      const record = this.pendingInputCoordinator.queueSteerInput(sessionId, input)
      this.activeSteerPendingInputIds.set(sessionId, record.id)
      return record
    }
  }

  private supportsVision(providerId: string, modelId: string): boolean {
    return Boolean(this.configPresenter.getModelConfig(modelId, providerId)?.vision)
  }

  private supportsAudioInput(providerId: string, modelId: string): boolean {
    return this.configPresenter.supportsAudioInputCapability?.(providerId, modelId) === true
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

  private registerActiveProviderPermission(
    sessionId: string,
    messageId: string,
    permission: NonNullable<PendingToolInteraction['permission']>,
    tool: {
      callId?: string
      name?: string
      params?: string
    },
    commitDecision: (granted: boolean) => void
  ): void {
    const requestId = permission.requestId?.trim()
    const providerId = permission.providerId?.trim()
    if (!requestId || providerId !== 'acp') {
      return
    }

    this.activeProviderPermissions.set(requestId, {
      requestId,
      sessionId,
      messageId,
      toolCallId: tool.callId || '',
      providerId,
      permissionType: permission.permissionType,
      resolve: async (granted: boolean) => {
        await this.llmProviderPresenter.resolveAgentPermission(requestId, granted)
        commitDecision(granted)
      }
    })
  }

  private async resolveProviderPermissionInteraction(
    input: ProviderPermissionInteractionInput
  ): Promise<void> {
    const active = this.activeProviderPermissions.get(input.requestId)
    let resolution: { status: 'resolved' } | { status: 'stale'; error: unknown }

    try {
      resolution = await this.resolveProviderPermissionSafely(
        active
          ? () => active.resolve(input.granted)
          : () => this.llmProviderPresenter.resolveAgentPermission(input.requestId, input.granted)
      )
    } finally {
      this.activeProviderPermissions.delete(input.requestId)
    }

    if (active && resolution.status === 'resolved') {
      return
    }

    if (resolution.status === 'stale') {
      console.warn(
        `[DeepChatAgent] Clearing stale ACP permission request ${input.requestId}:`,
        resolution.error
      )
    }

    this.updatePersistedProviderPermissionState(
      input.messageId,
      input.toolCallId,
      input.requestId,
      input.permissionType,
      resolution.status === 'resolved' ? input.granted : false,
      resolution.status === 'stale' ? 'Permission request expired.' : undefined
    )
    this.finishProviderPermissionInteraction(input.sessionId, input.messageId)
  }

  private async resolveProviderPermissionSafely(
    task: () => Promise<void>
  ): Promise<{ status: 'resolved' } | { status: 'stale'; error: unknown }> {
    try {
      await task()
      return { status: 'resolved' }
    } catch (error) {
      if (!this.isUnknownAcpPermissionRequestError(error)) {
        throw error
      }
      return { status: 'stale', error }
    }
  }

  private isUnknownAcpPermissionRequestError(error: unknown): boolean {
    const message =
      error instanceof Error ? error.message : typeof error === 'string' ? error : undefined
    return Boolean(message?.startsWith('Unknown ACP permission request:'))
  }

  private finishProviderPermissionInteraction(sessionId: string, messageId: string): void {
    this.messageStore.updateMessageStatus(messageId, 'sent')
    this.setSessionStatus(sessionId, 'idle')
    this.emitMessageRefresh(sessionId, messageId)
  }

  private updatePersistedProviderPermissionState(
    messageId: string,
    toolCallId: string,
    requestId: string,
    permissionType: 'read' | 'write' | 'all' | 'command',
    granted: boolean,
    deniedMessage = 'User denied the request.'
  ): void {
    const message = this.messageStore.getMessage(messageId)
    if (!message || message.role !== 'assistant') {
      return
    }

    const blocks = this.parseAssistantBlocks(message.content)
    const actionBlock = blocks.find(
      (block) =>
        block.type === 'action' &&
        block.action_type === 'tool_call_permission' &&
        block.tool_call?.id === toolCallId &&
        (block.extra?.permissionRequestId === requestId || requestId === '')
    )

    if (!actionBlock) {
      return
    }

    this.markPermissionResolved(actionBlock, granted, permissionType)
    if (!granted) {
      actionBlock.content = deniedMessage
    }
    this.messageStore.updateAssistantContent(messageId, blocks)
  }

  private clearActiveProviderPermissionsForSession(sessionId: string): void {
    for (const [requestId, permission] of this.activeProviderPermissions.entries()) {
      if (permission.sessionId === sessionId) {
        this.activeProviderPermissions.delete(requestId)
      }
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
      imagePreviews?: ToolCallImagePreview[]
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
    if (rtkMetadata?.imagePreviews && rtkMetadata.imagePreviews.length > 0) {
      toolBlock.tool_call.imagePreviews = rtkMetadata.imagePreviews
    } else if (rtkMetadata?.imagePreviews) {
      delete toolBlock.tool_call.imagePreviews
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
      const extensionPolicy = await this.resolveAgentExtensionPolicy(sessionId)
      const result = await this.toolPresenter.callTool(request, {
        agentId: this.getSessionAgentId(sessionId) ?? 'deepchat',
        enabledMcpServerIds: extensionPolicy.enabledMcpServerIds ?? undefined,
        enabledPluginIds: extensionPolicy.enabledPluginIds ?? undefined,
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
      const imagePreviews =
        rawData.imagePreviews ??
        (await extractToolCallImagePreviews({
          toolName,
          toolArgs: toolCall.params || '{}',
          content: rawData.content,
          cacheImage: this.cacheImage
        }))
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
        toolSource: toolDefinition.source,
        serverName: toolDefinition.server.name,
        offloadPath: prepared.offloadPath,
        rtkApplied: rawData.rtkApplied,
        rtkMode: rawData.rtkMode,
        rtkFallbackReason: rawData.rtkFallbackReason,
        imagePreviews
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
    projectDir: string | null,
    activeSkillNamesOverride?: string[]
  ): Promise<MCPToolDefinition[]> {
    if (!this.toolPresenter) {
      return []
    }

    const providerId = this.runtimeState.get(sessionId)?.providerId?.trim()
    if (this.isAcpBackedSubagentSession(sessionId, providerId)) {
      return []
    }

    try {
      const agentId = this.getSessionAgentId(sessionId) ?? 'deepchat'
      const policy = await this.resolveAgentExtensionPolicy(sessionId)
      const effectiveActiveSkillNames =
        activeSkillNamesOverride === undefined
          ? await this.resolveActiveSkillNamesForToolProfile(sessionId)
          : this.filterSkillNamesByPolicy(activeSkillNamesOverride, policy)
      const profile = await this.resolveToolProfile(
        sessionId,
        projectDir,
        effectiveActiveSkillNames,
        policy
      )
      const cachedProfile = this.toolProfileCache.get(sessionId)
      if (
        cachedProfile &&
        cachedProfile.profile === profile.kind &&
        cachedProfile.fingerprint === profile.fingerprint
      ) {
        this.toolPresenter.syncAgentToolContext?.({
          chatMode: 'agent',
          agentWorkspacePath: projectDir
        })
        return cachedProfile.tools
      }

      const tools = await this.toolPresenter.getAllToolDefinitions({
        agentId,
        enabledMcpServerIds: policy.enabledMcpServerIds ?? undefined,
        enabledPluginIds: policy.enabledPluginIds ?? undefined,
        disabledAgentTools: this.getDisabledAgentTools(sessionId),
        chatMode: 'agent',
        conversationId: sessionId,
        agentWorkspacePath: projectDir,
        activeSkillNames: effectiveActiveSkillNames
      })

      this.toolProfileCache.set(sessionId, {
        profile: profile.kind,
        fingerprint: profile.fingerprint,
        tools
      })

      return tools
    } catch (error) {
      console.error('[DeepChatAgent] failed to fetch tool definitions:', error)
      return []
    }
  }

  private async resolveToolProfile(
    sessionId: string,
    projectDir: string | null,
    activeSkillNamesOverride?: string[],
    extensionPolicy?: AgentExtensionPolicy
  ): Promise<{ kind: ToolProfileKind; fingerprint: string }> {
    const normalizedProjectDir = projectDir?.trim() || null
    const skillsEnabled = this.configPresenter.getSkillsEnabled()
    const policy = extensionPolicy ?? (await this.resolveAgentExtensionPolicy(sessionId))
    const activeSkillNames = this.filterSkillNamesByPolicy(
      activeSkillNamesOverride ?? (await this.resolveActiveSkillNamesForToolProfile(sessionId)),
      policy
    )
    const disabledAgentTools = this.getDisabledAgentTools(sessionId)
    const state = this.runtimeState.get(sessionId)
    const agentId = this.getSessionAgentId(sessionId) ?? 'deepchat'
    const kind: ToolProfileKind = normalizedProjectDir ? 'code' : 'general'

    return {
      kind,
      fingerprint: JSON.stringify({
        kind,
        agentId,
        projectDir: normalizedProjectDir ?? '',
        providerId: state?.providerId ?? '',
        modelId: state?.modelId ?? '',
        toolRegistryRevision: this.toolRegistryRevision,
        disabledAgentTools: [...disabledAgentTools].sort((left, right) =>
          left.localeCompare(right)
        ),
        enabledMcpServerIds: this.normalizeNullablePolicyList(policy.enabledMcpServerIds),
        enabledPluginIds: this.normalizeNullablePolicyList(policy.enabledPluginIds),
        enabledSkillNames: this.normalizeNullablePolicyList(policy.enabledSkillNames),
        skillsEnabled,
        activeSkillNames
      })
    }
  }

  private async resolveActiveSkillNamesForToolProfile(sessionId: string): Promise<string[]> {
    if (!this.configPresenter.getSkillsEnabled() || !this.skillPresenter?.getActiveSkills) {
      return []
    }

    try {
      const policy = await this.resolveAgentExtensionPolicy(sessionId)
      return this.filterSkillNamesByPolicy(
        this.normalizeSkillNames(await this.skillPresenter.getActiveSkills(sessionId)),
        policy
      )
    } catch (error) {
      console.warn(
        `[DeepChatAgent] Failed to load active skills for tool profile in session ${sessionId}:`,
        error
      )
      return []
    }
  }

  private async resolveAgentExtensionPolicy(sessionId: string): Promise<AgentExtensionPolicy> {
    const agentId = this.getSessionAgentId(sessionId) ?? 'deepchat'
    if (typeof this.configPresenter.resolveDeepChatAgentConfig !== 'function') {
      return {}
    }

    try {
      const config = await this.configPresenter.resolveDeepChatAgentConfig(agentId)
      return {
        enabledPluginIds: config.enabledPluginIds,
        enabledSkillNames: config.enabledSkillNames,
        enabledMcpServerIds: config.enabledMcpServerIds
      }
    } catch (error) {
      console.warn(
        `[DeepChatAgent] Failed to resolve extension policy for agent ${agentId}:`,
        error
      )
      return {}
    }
  }

  private normalizeNullablePolicyList(value?: string[] | null): string[] | null | undefined {
    if (value === null || value === undefined) {
      return value
    }
    return this.normalizeSkillNames(value)
  }

  private filterSkillNamesByPolicy(
    skillNames: string[] | undefined,
    policy: AgentExtensionPolicy
  ): string[] {
    const normalizedSkillNames = this.normalizeSkillNames(skillNames ?? [])
    if (policy.enabledSkillNames === null || policy.enabledSkillNames === undefined) {
      return normalizedSkillNames
    }

    const allowed = new Set(this.normalizeSkillNames(policy.enabledSkillNames))
    return normalizedSkillNames.filter((skillName) => allowed.has(skillName))
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
      await this.llmProviderPresenter.executeWithRateLimit(visionModel.providerId, {
        signal: abortSignal
      })
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
    extraReserveTokens?: number
    supportsVision: boolean
    supportsAudioInput: boolean
    preserveInterleavedReasoning: boolean
    preserveEmptyInterleavedReasoning?: boolean
    historyRecords?: ChatMessageRecord[]
    compactionMessageOrderSeq?: number
    signal?: AbortSignal
  }): Promise<SessionSummaryState> {
    const intent = await this.compactionService.prepareForResumeTurn(params)
    return await this.applyCompactionIntent(params.sessionId, intent, {
      compactionMessageOrderSeq: params.compactionMessageOrderSeq,
      shiftMessagesFromCompactionOrderSeq: params.compactionMessageOrderSeq !== undefined,
      signal: params.signal
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
    }
  ): Promise<SessionSummaryState> {
    if (!intent) {
      return this.sessionStore.getSummaryState(sessionId)
    }

    const compactionMessageId =
      options?.compactionMessageId ??
      (options?.compactionMessageOrderSeq !== undefined
        ? this.messageStore.createCompactionMessageAtOrderSeq(
            sessionId,
            Math.max(1, Math.floor(options.compactionMessageOrderSeq)),
            'compacting',
            intent.previousState.summaryUpdatedAt,
            {
              shiftExistingMessages: options.shiftMessagesFromCompactionOrderSeq === true
            }
          )
        : this.messageStore.createCompactionMessage(
            sessionId,
            this.messageStore.getNextOrderSeq(sessionId),
            'compacting',
            intent.previousState.summaryUpdatedAt
          ))

    if (!options?.startedExternally) {
      this.emitMessageRefresh(sessionId, compactionMessageId)
      this.emitCompactionState(sessionId, {
        status: 'compacting',
        cursorOrderSeq: intent.targetCursorOrderSeq,
        summaryUpdatedAt: intent.previousState.summaryUpdatedAt
      })
    }

    let result: Awaited<ReturnType<CompactionService['applyCompaction']>>
    try {
      result = await this.compactionService.applyCompaction(intent, options?.signal)
    } catch (error) {
      if (this.isAbortError(error) || options?.signal?.aborted) {
        this.messageStore.deleteMessage(compactionMessageId)
        this.emitMessageRefresh(sessionId, compactionMessageId)
        this.emitCompactionState(
          sessionId,
          this.summaryStateToCompactionState(intent.previousState)
        )
      }
      throw error
    }
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
    publishDeepchatEvent('sessions.compaction.changed', {
      sessionId,
      status: state.status,
      cursorOrderSeq: state.cursorOrderSeq,
      summaryUpdatedAt: state.summaryUpdatedAt,
      version: Date.now()
    })
  }

  private resetSummaryState(sessionId: string): void {
    this.sessionStore.resetSummaryState(sessionId)
    this.emitCompactionState(sessionId, this.buildIdleCompactionState())
  }

  private ensureMemoryExtractionEpoch(sessionId: string): number {
    if (!this.memoryExtractionEpochs.has(sessionId)) {
      this.memoryExtractionEpochs.set(sessionId, 0)
    }
    return this.memoryExtractionEpochs.get(sessionId) ?? 0
  }

  private bumpMemoryExtractionEpoch(sessionId: string): void {
    const epoch = this.memoryExtractionEpochs.get(sessionId) ?? 0
    this.memoryExtractionEpochs.set(sessionId, epoch + 1)
  }

  private isMemoryExtractionEpochCurrent(sessionId: string, epoch: number): boolean {
    return this.memoryExtractionEpochs.get(sessionId) === epoch
  }

  private resetMemoryExtractionCursor(sessionId: string): void {
    this.bumpMemoryExtractionEpoch(sessionId)
    this.sqlitePresenter.deepchatSessionsTable.rewindMemoryCursorOrderSeq(sessionId, 0)
  }

  private invalidateMemoryExtractionFromOrderSeq(sessionId: string, orderSeq: number): void {
    this.bumpMemoryExtractionEpoch(sessionId)
    const memoryCursor =
      this.sqlitePresenter.deepchatSessionsTable.getMemoryCursorOrderSeq(sessionId) ?? 0
    if (orderSeq <= memoryCursor) {
      this.sqlitePresenter.deepchatSessionsTable.rewindMemoryCursorOrderSeq(
        sessionId,
        Math.max(0, Math.floor(orderSeq) - 1)
      )
    }
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

  private resolveProjectDir(sessionId: string, incoming?: string | null): string | null {
    if (incoming !== undefined) {
      const normalized = this.normalizeProjectDir(incoming)
      const previous = this.sessionProjectDirs.get(sessionId) ?? null
      this.sessionProjectDirs.set(sessionId, normalized)
      if (previous !== normalized) {
        this.invalidateSystemPromptCache(sessionId)
        this.invalidateToolProfileCache(sessionId)
      }
      return normalized
    }
    if (this.sessionProjectDirs.has(sessionId)) {
      return this.sessionProjectDirs.get(sessionId) ?? null
    }

    const persisted = this.resolvePersistedSessionProjectDir(sessionId)
    this.sessionProjectDirs.set(sessionId, persisted)
    return persisted
  }
}
