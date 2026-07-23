import type { ProviderModelResolutionPort } from '@/provider/settings'
import logger from '@shared/logger'
import type {
  AssistantMessageBlock,
  MessageMetadata,
  SessionGenerationSettings
} from '@shared/types/agent-interface'
import type { ChatMessage } from '@shared/types/core/chat-message'
import type { LLMCoreStreamEvent } from '@shared/types/core/llm-events'
import type { MCPToolDefinition } from '@shared/types/core/mcp'
import type {
  ProviderExecutionPort,
  ModelConfig,
  RateLimitQueueSnapshot
} from '@shared/types/provider'
import type {
  DeepChatTapeViewPolicy,
  DeepChatTapeViewTaskType,
  DeepChatTapeViewTokenBudget
} from '@shared/types/tape-view-manifest'
import { getReasoningEffectiveEnabledForProvider } from '@shared/types/model-db'
import { isTtsModelConfig, isTtsModelId } from '@shared/ttsSettings'
import { nanoid } from 'nanoid'
import { toAppSessionId } from '@/agent/shared/agentSessionIds'
import type { DeepChatAgentInstance } from '@/agent/deepchat/instance/deepChatAgentInstance'
import type { MemoryIngestionObserver } from '@/agent/deepchat/memory/memoryIngestionObserver'
import type { MemoryRuntimeCoordinator } from '@/agent/deepchat/memory/memoryRuntimeCoordinator'
import type { SessionPendingInputs } from '@/session/data/pendingInputs'
import {
  resolveEffectiveActiveSkillNames
} from '@/agent/deepchat/resources/systemPromptBuilder'
import type { SessionPermissionPort } from '@/session/contracts'
import { awaitWithAbort } from '@/lib/awaitWithAbort'
import {
  buildRequestContextBudgetDiagnostics,
  buildRequestContextOverflowErrorMessage,
  capAgentRequestMaxTokens,
  AGENT_CONTEXT_SAFETY_MARGIN_TOKENS,
  estimateToolReserveTokens,
  fitRequestMessagesToContextWindow,
  preflightRequestContext
} from '@/agent/deepchat/runtime/contextBudget'
import type { ContextBuildMetadata } from '@/agent/deepchat/runtime/contextBuilder'
import type {
  CompactionIntent,
  CompactionService
} from '@/agent/deepchat/runtime/compactionService'
import {
  getReasoningPortrait,
  resolveCapabilityProviderId,
  resolveInterleavedReasoningConfig
} from '@/agent/deepchat/runtime/generationSettings'
import { isContextWindowErrorLike } from '@/agent/deepchat/runtime/contextWindowError'
import { cloneBlocksForRenderer } from '@/agent/deepchat/runtime/echo'
import { buildPersistableMessageTracePayload } from '@/agent/deepchat/runtime/messageTracePayload'
import type { SessionTranscript } from '@/session/data/transcript'
import { processStream } from '@/agent/deepchat/runtime/process'
import type { ProviderPermissionCoordinator } from '@/agent/deepchat/runtime/providerPermissionCoordinator'
import type { SessionSummaryState, SessionSettingsStore } from '@/session/data/settings'
import { AUTO_APPROVE_REVIEW_MAX_RECENT_MESSAGES } from '@/agent/deepchat/runtime/toolPermissionReviewer'
import {
  buildExcludedRefs,
  buildIncludedRefs,
  buildRequestRefs,
  createTapeViewManifest,
  resolveTapeViewManifestPolicy,
  type TapeViewContextSelection
} from '@/tape/domain/viewManifest'
import type {
  TapeReconciliationPort,
  TapeToolFactWriter,
  TapeViewManifestReader,
  TapeViewManifestWriter
} from '@/tape/ports/capabilities'
import type { AgentTraceSettingsPort } from '@/agent/traceSettings'
import type { DeepChatToolResolver } from '@/agent/deepchat/runtime/toolResolver'
import type {
  DeepChatEventPublisher,
  DeepChatSessionUpdatePublisher,
  InterleavedReasoningConfig,
  ProcessResult,
  StreamState,
  ToolPermissionReviewRequest,
  ToolPermissionReviewResult
} from '@/agent/deepchat/runtime/types'
import { createState } from '@/agent/deepchat/runtime/types'
import type { ProviderRequestTracePayload } from '@/provider/requestTrace'
import type { InputPreparationCoordinator } from '@/agent/deepchat/loop/inputPreparationCoordinator'
import type { DeepChatContextCoordinator } from '@/agent/deepchat/loop/contextCoordinator'
import { createLoopRun, type LoopRun } from '@/agent/deepchat/loop/loopRun'
import type {
  BasePromptAssembler,
  PostCompactionPromptAssembler,
  ToolExecutionPort,
  ToolResultPort
} from '@/agent/deepchat/loop/ports'

const PROVIDER_OVERFLOW_RETRY_EXTRA_RESERVE_CAP = 8_192
const RATE_LIMIT_STREAM_MESSAGE_PREFIX = '__rate_limit__:'

type HookEvent =
  | 'SessionStart'
  | 'PreToolUse'
  | 'PostToolUse'
  | 'PostToolUseFailure'
  | 'PermissionRequest'

type HookContext = {
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
}

export type PendingTapeViewContext = {
  taskType: DeepChatTapeViewTaskType
  policy: DeepChatTapeViewPolicy
  policyVersion?: number | null
  selection: TapeViewContextSelection
  summaryCursorOrderSeq: number
  supportsVision: boolean
  supportsAudioInput: boolean
  traceDebugEnabled: boolean
}

export type DeepChatLoopRunInput = {
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
}

export interface AppendTapeViewManifestInput {
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

export interface DeepChatLoopRunnerPorts {
  publishEvent: DeepChatEventPublisher
  publishSessionUpdate: DeepChatSessionUpdatePublisher
  providerRuntime: ProviderExecutionPort
  providerSettings: ProviderModelResolutionPort
  traceSettings: AgentTraceSettingsPort
  sessionStore: SessionSettingsStore
  messageStore: SessionTranscript
  tapeReconciliation: TapeReconciliationPort
  tapeViewManifestReader: TapeViewManifestReader
  tapeViewManifestWriter: TapeViewManifestWriter
  tapeToolFactWriter: TapeToolFactWriter
  pendingInputCoordinator: SessionPendingInputs
  toolResolver: DeepChatToolResolver
  providerPermissionCoordinator: ProviderPermissionCoordinator
  compactionService: CompactionService
  inputPreparationCoordinator: InputPreparationCoordinator
  contextCoordinator: DeepChatContextCoordinator
  memoryCoordinator: MemoryRuntimeCoordinator
  memoryIngestionObserver: MemoryIngestionObserver
  postCompactionPromptAssembler: PostCompactionPromptAssembler
  toolExecutionPort: ToolExecutionPort
  toolResultPort: ToolResultPort
  cacheImage(data: string): Promise<string>
  getDeepChatInstance(sessionId: string): DeepChatAgentInstance
  getEffectiveSessionGenerationSettings(
    sessionId: string,
    expectedInstance: DeepChatAgentInstance
  ): Promise<SessionGenerationSettings>
  createBasePromptAssembler(expectedInstance: DeepChatAgentInstance): BasePromptAssembler
  ensureSessionAbortController(sessionId: string): AbortController
  throwIfStaleDeepChatInstance(sessionId: string, expectedInstance: DeepChatAgentInstance): void
  throwIfAbortRequested(signal: AbortSignal): void
  resolveDeepChatContextBudgetLength(
    providerId: string | null | undefined,
    contextLength: number,
    modelConfig?: Pick<ModelConfig, 'apiEndpoint' | 'endpointType' | 'type'> | null,
    modelId?: string | null
  ): number
  shouldBypassDeepChatContextBudget(
    providerId?: string | null,
    modelConfig?: Pick<ModelConfig, 'apiEndpoint' | 'endpointType' | 'type'> | null,
    modelId?: string | null
  ): boolean
  supportsVision(providerId: string, modelId: string): boolean
  supportsAudioInput(providerId: string, modelId: string): boolean
  registerActiveGeneration(
    sessionId: string,
    run: LoopRun<StreamState>,
    expectedInstance: DeepChatAgentInstance
  ): LoopRun<StreamState>
  clearActiveGeneration(sessionId: string, runId: string): void
  isActiveRun(sessionId: string, runId: string): boolean
  markFirstTurnReady(sessionId: string): void
  getSessionAgentId(sessionId: string): string | undefined
  sessionPermissionPort: SessionPermissionPort
  reviewToolPermission(
    request: ToolPermissionReviewRequest,
    context: {
      providerId: string
      modelId: string
      messages: ChatMessage[]
      signal: AbortSignal
    }
  ): Promise<ToolPermissionReviewResult>
  dispatchHook(event: HookEvent, context: HookContext): void
  applyCompactionIntent(
    sessionId: string,
    intent: CompactionIntent | null,
    options: { signal?: AbortSignal },
    expectedInstance: DeepChatAgentInstance
  ): Promise<SessionSummaryState>
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

export function buildTapeViewSelection(
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

export class DeepChatLoopRunner {
  private nextRunSequence = 0

  constructor(private readonly ports: DeepChatLoopRunnerPorts) {}

  async run(args: DeepChatLoopRunInput): Promise<{ runId: string; result: ProcessResult }> {
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
    const resourceInstance = providedResourceInstance ?? this.ports.getDeepChatInstance(sessionId)
    this.ports.throwIfStaleDeepChatInstance(sessionId, resourceInstance)
    const abortController =
      providedAbortController ?? this.ports.ensureSessionAbortController(sessionId)
    const abortSignal = abortController.signal
    this.ports.throwIfAbortRequested(abortSignal)
    const state = resourceInstance.getRuntimeState()
    if (!state) {
      throw new Error(`Session ${sessionId} not found`)
    }
    if (messages.length === 0) {
      throw new Error('Request was not sent because the prompt is empty.')
    }

    const generationSettings = await awaitWithAbort(
      this.ports.getEffectiveSessionGenerationSettings(sessionId, resourceInstance),
      abortSignal
    )
    const baseModelConfig = this.ports.providerSettings.getModelConfig(
      state.modelId,
      state.providerId
    )
    const interleavedReasoning =
      providedInterleavedReasoning ??
      resolveInterleavedReasoningConfig(
        this.ports.providerSettings,
        state.providerId,
        state.modelId,
        generationSettings
      )
    const contextBudgetLength = this.ports.resolveDeepChatContextBudgetLength(
      state.providerId,
      generationSettings.contextLength,
      baseModelConfig,
      state.modelId
    )
    const capabilityProviderId = resolveCapabilityProviderId(
      this.ports.providerSettings,
      state.providerId,
      state.modelId
    )
    const reasoningPortrait = getReasoningPortrait(
      this.ports.providerSettings,
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

    const traceEnabled = this.ports.traceSettings.isEnabled()
    const initialRequestSeq = Math.max(
      this.ports.tapeViewManifestReader.listViewManifestsByMessage(sessionId, messageId)[0]
        ?.requestSeq ?? 0,
      this.ports.messageStore.getMaxMessageTraceRequestSeq(messageId)
    )
    const temperature = generationSettings.temperature
    const maxTokens = capAgentRequestMaxTokens(generationSettings.maxTokens, contextBudgetLength)

    const streamSessionActiveSkillNames = await awaitWithAbort(
      this.ports.toolResolver.resolveActiveSkillNamesForToolProfile(sessionId),
      abortSignal
    )
    this.ports.throwIfStaleDeepChatInstance(sessionId, resourceInstance)
    const streamExtensionPolicy = await awaitWithAbort(
      this.ports.toolResolver.resolveAgentExtensionPolicy(sessionId, resourceInstance),
      abortSignal
    )
    this.ports.throwIfStaleDeepChatInstance(sessionId, resourceInstance)
    const getEffectiveRuntimeSkillNames = (baseSkillNames = streamSessionActiveSkillNames) =>
      resolveEffectiveActiveSkillNames(baseSkillNames, resourceInstance)
    const toolCatalog = this.ports.toolResolver.createSessionToolCatalogPort(
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
    this.ports.throwIfStaleDeepChatInstance(sessionId, resourceInstance)
    const supportsVision = this.ports.supportsVision(state.providerId, state.modelId)
    const supportsAudioInput = this.ports.supportsAudioInput(state.providerId, state.modelId)

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
    const activeGeneration = this.ports.registerActiveGeneration(
      sessionId,
      loopRun,
      resourceInstance
    )
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
        persist: async (payload) => {
          this.persistMessageTrace({
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
    const rateLimitMessageId = `${RATE_LIMIT_STREAM_MESSAGE_PREFIX}${activeGeneration.runId}`
    let crossedPreStreamBoundary = false
    const crossPreStreamBoundary = () => {
      if (crossedPreStreamBoundary) return
      crossedPreStreamBoundary = true
      onBeforeProviderStream?.()
    }
    const ports = this.ports
    const recoverRequestContextPressure = this.recoverRequestContextPressure.bind(this)
    const appendTapeViewManifest = this.appendTapeViewManifest.bind(this)
    const emitRateLimitWaitingMessage = this.emitRateLimitWaitingMessage.bind(this)
    const clearRateLimitWaitingMessage = this.clearRateLimitWaitingMessage.bind(this)

    try {
      this.ports.dispatchHook('SessionStart', {
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
          return await this.ports.createBasePromptAssembler(resourceInstance).assemble({
            sessionId: toAppSessionId(sessionId),
            configuredPrompt: generationSettings.systemPrompt,
            toolDefinitions: refreshedTools,
            activeSkillNames: getEffectiveRuntimeSkillNames(activeSkillNames)
          })
        },
        toolExecution: this.ports.toolExecutionPort,
        toolResults: this.ports.toolResultPort,
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
          const requestBypassesContextBudget = ports.shouldBypassDeepChatContextBudget(
            state.providerId,
            requestModelConfig,
            requestModelId
          )
          const isTtsRequest = isTtsModelConfig(requestModelConfig) || isTtsModelId(requestModelId)
          const effectiveRequestTools: MCPToolDefinition[] = isTtsRequest ? [] : requestTools
          let queuedForRateLimit = false
          yield* ports.contextCoordinator.streamProviderAttempts({
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
                await recoverRequestContextPressure({
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
                await ports.providerRuntime.executeWithRateLimit(state.providerId, {
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
                ports.providerRuntime.streamChat(
                  state.providerId,
                  messages,
                  modelId,
                  modelConfig,
                  temperature,
                  maxTokens,
                  tools
                ),
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
            this.ports.isActiveRun(sessionId, activeGeneration.runId)
          ) {
            this.ports.markFirstTurnReady(sessionId)
          }
        },
        shouldYieldForPendingInput: () =>
          Boolean(this.ports.pendingInputCoordinator.getNextSteerInput(sessionId)),
        notificationObserver: {
          notify: (notification) => {
            this.ports.dispatchHook(notification.event, {
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
          getEnabledMcpServerIds: () =>
            this.ports.toolResolver.normalizeNullablePolicyList(
              streamExtensionPolicy.enabledMcpServerIds
            ),
          getAgentId: () =>
            resourceInstance.getAgentId()?.trim() ||
            this.ports.getSessionAgentId(sessionId) ||
            'deepchat',
          activateSkill: async (skillName) => {
            const validated = await this.ports.toolResolver.validateSkillNamesForSession(
              sessionId,
              [skillName],
              resourceInstance
            )
            if (!validated.includes(skillName)) {
              return getEffectiveRuntimeSkillNames()
            }
            resourceInstance.activateRuntimeSkill(skillName)
            return getEffectiveRuntimeSkillNames()
          },
          onStreamingProviderPermission: (permission, tool, commitDecision) => {
            this.ports.providerPermissionCoordinator.register(
              sessionId,
              messageId,
              permission,
              tool,
              commitDecision
            )
          },
          autoGrantPermission: async (permission) => {
            await this.ports.sessionPermissionPort.approvePermission(sessionId, permission)
          },
          reviewToolPermission: async (request) =>
            await this.ports.reviewToolPermission(request, {
              providerId: state.providerId,
              modelId: state.modelId,
              messages: reviewConversationMessages.slice(-AUTO_APPROVE_REVIEW_MAX_RECENT_MESSAGES),
              signal: abortController.signal
            }),
          cacheImage: this.ports.cacheImage
        },
        diagnostics: {
          onInterleavedReasoningGap: (gap) => {
            console.warn(
              `[DeepChatAgent] Interleaved reasoning gap detected for ${gap.providerId}/${gap.modelId}. Update provider DB metadata at ${gap.providerDbSourceUrl}.`
            )
            if (!traceEnabled) {
              return
            }
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
          }
        },
        io: {
          messageStore: this.ports.messageStore,
          tapeToolFactWriter: this.ports.tapeToolFactWriter,
          publishEvent: this.ports.publishEvent,
          publishSessionUpdate: this.ports.publishSessionUpdate
        }
      })
      return {
        runId: activeGeneration.runId,
        result
      }
    } catch (error) {
      this.ports.clearActiveGeneration(sessionId, activeGeneration.runId)
      throw error
    }
  }

  appendTapeViewManifest(params: AppendTapeViewManifestInput): void {
    const sourceMaps = this.ports.tapeViewManifestReader.getViewManifestSourceMaps(
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
    this.ports.tapeViewManifestWriter.appendViewManifest(manifest)
  }

  emitRateLimitWaitingMessage(
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

    this.ports.publishEvent('chat.stream.updated', {
      kind: 'snapshot',
      requestId,
      sessionId,
      messageId,
      updatedAt: Date.now(),
      blocks: cloneBlocksForRenderer([block])
    })
  }

  clearRateLimitWaitingMessage(sessionId: string, messageId: string, requestId: string): void {
    this.ports.publishEvent('chat.stream.updated', {
      kind: 'snapshot',
      requestId,
      sessionId,
      messageId,
      updatedAt: Date.now(),
      blocks: []
    })
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
    this.ports.messageStore.insertMessageTrace({
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
    return await this.ports.contextCoordinator.recoverFromPressure<SessionSummaryState>({
      requestMessages: params.requestMessages,
      baseSystemPrompt: params.baseSystemPrompt,
      requestedMaxTokens: params.requestedMaxTokens,
      toolReserveTokens,
      minimumProtectedTailCount: params.minimumProtectedTailCount,
      prepareCompaction: async (systemPrompt) => {
        const prepared = await this.ports.inputPreparationCoordinator.prepareExisting({
          ensureHistory: () =>
            this.ports.tapeReconciliation.ensureSessionTapeReady(
              params.sessionId,
              this.ports.messageStore
            )
              .historyRecords,
          prepareIntent: async (historyRecords) =>
            await this.ports.compactionService.prepareForContextPressureRecovery({
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
              projectedMessages:
                params.requestMessages[0]?.role === 'system'
                  ? params.requestMessages.slice(1)
                  : params.requestMessages,
              historyRecords,
              signal: params.signal
            }),
          applyCompaction: async (intent) =>
            await this.ports.applyCompactionIntent(
              params.sessionId,
              intent,
              { signal: params.signal },
              params.expectedInstance
            ),
          readSummary: () => this.ports.sessionStore.getSummaryState(params.sessionId),
          afterCompactionApplyReturned: (intent) =>
            this.ports.memoryIngestionObserver.afterCompactionApplyReturned({
              session: params.expectedInstance.getMemorySessionHandle(),
              origin: 'context-pressure',
              targetCursorOrderSeq: intent.targetCursorOrderSeq
            }),
          checkpoints: {
            assertCurrent: () =>
              this.ports.throwIfStaleDeepChatInstance(params.sessionId, params.expectedInstance)
          }
        })
        return prepared.intent ? { applied: true, summary: prepared.summary } : { applied: false }
      },
      assemblePostCompactionPrompt: async (summaryState, systemPrompt) =>
        await this.ports.postCompactionPromptAssembler.assemble({
          memorySession: params.expectedInstance.getMemorySessionHandle(),
          basePrompt: systemPrompt,
          summaryText: summaryState.summaryText,
          reconstructionAnchor: this.ports.sessionStore.getReconstructionAnchorPromptState(
            params.sessionId
          ),
          memoryQuery: this.ports.memoryCoordinator.getLatestUserQuery(params.sessionId),
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
        this.ports.throwIfStaleDeepChatInstance(params.sessionId, params.expectedInstance)
    })
  }
}
