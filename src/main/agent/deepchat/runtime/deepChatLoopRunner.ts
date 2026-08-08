import type { ProviderModelResolutionPort } from '@/provider/settings'
import logger from '@shared/logger'
import type { AssistantMessageBlock, MessageMetadata } from '@shared/types/agent-interface'
import type {
  ChatMessage,
  ChatMessageProviderReplayProjector
} from '@shared/types/core/chat-message'
import type { LLMCoreStreamEvent } from '@shared/types/core/llm-events'
import type { MCPToolDefinition } from '@shared/types/core/mcp'
import type {
  ProviderExecutionPort,
  ModelConfig,
  RateLimitQueueSnapshot
} from '@shared/types/provider'
import type {
  DeepChatTapeViewPolicy,
  DeepChatTapeViewSyntheticContribution,
  DeepChatTapeViewTaskType,
  DeepChatTapeViewTokenBudget
} from '@shared/types/tape-view-manifest'
import { randomUUID } from 'node:crypto'
import { getReasoningEffectiveEnabledForProvider } from '@shared/types/model-db'
import { isTtsModelConfig, isTtsModelId } from '@shared/ttsSettings'
import { nanoid } from 'nanoid'
import { toAppSessionId } from '@/agent/shared/agentSessionIds'
import type { DeepChatAgentInstance } from '@/agent/deepchat/instance/deepChatAgentInstance'
import type { MemoryIngestionObserver } from '@/agent/deepchat/memory/memoryIngestionObserver'
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
import type { CompactionService } from '@/agent/deepchat/runtime/compactionService'
import { resolveInterleavedReasoningConfig } from '@/agent/deepchat/runtime/generationSettings'
import { isContextWindowErrorLike } from '@/agent/deepchat/runtime/contextWindowError'
import { buildPersistableMessageTracePayload } from '@/agent/deepchat/runtime/messageTracePayload'
import { cloneBlocksForRenderer } from '@/session/clientMessageProjection'
import type { SessionTranscript } from '@/session/data/transcript'
import { processStream } from '@/agent/deepchat/runtime/process'
import type { ProviderPermissionCoordinator } from '@/agent/deepchat/runtime/providerPermissionCoordinator'
import type { SessionSummaryState, SessionSettingsStore } from '@/session/data/settings'
import { AUTO_APPROVE_REVIEW_MAX_RECENT_MESSAGES } from '@/agent/deepchat/runtime/toolPermissionReviewer'
import {
  buildExcludedRefs,
  buildIncludedRefs,
  buildRequestRefs,
  buildSyntheticContributionRefs,
  createTapeViewManifest,
  resolveTapeViewManifestPolicy,
  type TapeViewContextSelection
} from '@/tape/domain/viewManifest'
import type { DeepChatLoopTapePort } from '@/tape/ports/capabilities'
import {
  ExecutionJournalCorruptionError,
  ExecutionJournalError,
  isExecutionJournalError
} from '@/tape/domain/executionJournal'
import type { AgentTraceSettingsPort } from '@/agent/traceSettings'
import type { RuntimeHookSink } from './runtimeHookSink'
import type { DeepChatToolResolver } from '@/agent/deepchat/runtime/toolResolver'
import type {
  DeepChatEventPublisher,
  DeepChatSessionUpdatePublisher,
  InterleavedReasoningConfig,
  ProcessResult,
  ProcessTerminalSelection,
  StreamState
} from '@/agent/deepchat/runtime/types'
import { createState } from '@/agent/deepchat/runtime/types'
import type {
  ProviderRequestTraceContext,
  ProviderRequestTracePayload
} from '@/provider/requestTrace'
import type { InputPreparationCoordinator } from '@/agent/deepchat/loop/inputPreparationCoordinator'
import type { DeepChatContextCoordinator } from '@/agent/deepchat/loop/contextCoordinator'
import { createLoopRun } from '@/agent/deepchat/loop/loopRun'
import type { ToolExecutionPort, ToolResultPort } from '@/agent/deepchat/loop/ports'
import {
  buildContextCheckpoint,
  createEmptyContextRuntimeContributions,
  getContextSyntheticContributions,
  type ContextRuntimeContributions
} from './contextContributions'
import {
  resolveDeepChatContextBudgetLength,
  shouldBypassDeepChatContextBudget
} from './contextBudgetPolicy'
import { resolveProviderInputCapabilities } from './providerInputCapabilities'
import {
  assertProviderModelRuntimeFacts,
  resolveProviderModelRuntimeFacts,
  type ProviderModelRuntimeFacts
} from './providerModelRuntimeFacts'
import { throwIfAbortRequested } from './abortErrors'
import type { RunLifecycleCoordinator } from './runLifecycleCoordinator'
import type { SessionScopeRegistry } from '@/agent/deepchat/instance/deepChatAgentRuntime'
import type { CompactionRuntimeCoordinator } from './compactionRuntimeCoordinator'
import type { PromptAssemblyService } from './promptAssemblyService'
import type { SessionIdentityService } from './sessionIdentityService'
import type { SessionSettingsCoordinator } from './sessionSettingsCoordinator'
import type { ToolPermissionReviewer } from './toolRuntimeBindings'
import { CommittedRunProjectionError } from './runTerminalProjectionError'

function wrapTerminalCommitFailure(
  executionError: unknown,
  terminalCommitError: unknown
): ExecutionJournalError {
  const terminalFailureCause = isExecutionJournalError(terminalCommitError)
    ? terminalCommitError.cause
    : terminalCommitError
  const combinedCause =
    terminalFailureCause === undefined || terminalFailureCause === executionError
      ? executionError
      : new AggregateError(
          [executionError, terminalFailureCause],
          'Run execution and terminal commit both failed.'
        )

  if (terminalCommitError instanceof ExecutionJournalCorruptionError) {
    return new ExecutionJournalCorruptionError(terminalCommitError.message, {
      cause: combinedCause
    })
  }
  if (isExecutionJournalError(terminalCommitError)) {
    return new ExecutionJournalError(terminalCommitError.message, terminalCommitError.code, {
      cause: combinedCause
    })
  }
  return new ExecutionJournalError(
    terminalCommitError instanceof Error
      ? terminalCommitError.message
      : String(terminalCommitError),
    'persistence_failed',
    { cause: combinedCause }
  )
}

type LoopRunLifecyclePort = Pick<
  RunLifecycleCoordinator,
  | 'assertCurrentInstance'
  | 'clearRun'
  | 'ensureOperationController'
  | 'markFirstTurnReady'
  | 'registerRun'
  | 'scopeFor'
>

const PROVIDER_OVERFLOW_RETRY_EXTRA_RESERVE_CAP = 8_192
const RATE_LIMIT_STREAM_MESSAGE_PREFIX = '__rate_limit__:'

export type PendingTapeViewContext = {
  taskType: DeepChatTapeViewTaskType
  policy: DeepChatTapeViewPolicy
  policyVersion?: number | null
  selection: TapeViewContextSelection
  summaryCursorOrderSeq: number
  supportsVision: boolean
  supportsAudioInput: boolean
  traceDebugEnabled: boolean
  contextBuilderVersion: 'legacy-v1' | 'cache-aware-v1'
  syntheticContributions?: DeepChatTapeViewSyntheticContribution[]
}

export type DeepChatLoopRunInput = {
  sessionId: string
  messageId: string
  messages: ChatMessage[]
  projectDir: string | null
  resourceInstance?: DeepChatAgentInstance
  providerModelFacts?: ProviderModelRuntimeFacts
  tools?: MCPToolDefinition[]
  baseSystemPrompt?: string
  contextContributions?: ContextRuntimeContributions
  initialBlocks?: AssistantMessageBlock[]
  initialAccounting?: MessageMetadata
  providerReplayProjector?: ChatMessageProviderReplayProjector
  promptPreview?: string
  search?: boolean
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
  contextBuilderVersion: 'legacy-v1' | 'cache-aware-v1'
  syntheticContributions?: DeepChatTapeViewSyntheticContribution[]
}

export interface DeepChatLoopRunnerPorts {
  publishEvent: DeepChatEventPublisher
  publishSessionUpdate: DeepChatSessionUpdatePublisher
  providerRuntime: ProviderExecutionPort
  providerSettings: ProviderModelResolutionPort
  traceSettings: AgentTraceSettingsPort
  sessionStore: SessionSettingsStore
  messageStore: SessionTranscript
  tape: DeepChatLoopTapePort
  pendingInputCoordinator: SessionPendingInputs
  toolResolver: DeepChatToolResolver
  providerPermissionCoordinator: ProviderPermissionCoordinator
  compactionService: CompactionService
  inputPreparationCoordinator: InputPreparationCoordinator
  contextCoordinator: DeepChatContextCoordinator
  memoryIngestionObserver: MemoryIngestionObserver
  toolExecutionPort: ToolExecutionPort
  toolResultPort: ToolResultPort
  cacheImage(data: string): Promise<string>
  registry: SessionScopeRegistry
  sessionSettings: Pick<SessionSettingsCoordinator, 'getEffectiveGenerationSettings'>
  promptAssembly: Pick<PromptAssemblyService, 'createBasePromptAssembler'>
  runLifecycle: LoopRunLifecyclePort
  identity: Pick<SessionIdentityService, 'getAgentId'>
  sessionPermissionPort: SessionPermissionPort
  reviewToolPermission: ToolPermissionReviewer
  hookSink: Pick<RuntimeHookSink, 'scope'>
  compaction: Pick<CompactionRuntimeCoordinator, 'apply'>
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

function selectProcessTerminal(result: ProcessResult): ProcessTerminalSelection {
  let stopReason = result.stopReason
  if (!stopReason) {
    switch (result.status) {
      case 'paused':
        stopReason = 'interaction'
        break
      case 'aborted':
        stopReason = 'user_stop'
        break
      case 'error':
        stopReason = result.terminalError ? 'tool_error' : 'provider_error'
        break
      case 'completed':
        stopReason = 'complete'
        break
    }
  }

  const errorMessage =
    result.status === 'error'
      ? (result.terminalError ?? result.errorMessage ?? 'Unknown error')
      : result.status === 'aborted'
        ? result.errorMessage
        : undefined
  return {
    outcome: result.status,
    stopReason,
    ...(errorMessage === undefined ? {} : { errorMessage })
  }
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
    syntheticContributions: metadata.syntheticContributions,
    newUserMessageId
  }
}

export class DeepChatLoopRunner {
  constructor(private readonly ports: DeepChatLoopRunnerPorts) {}

  async run(args: DeepChatLoopRunInput): Promise<{ runId: string; result: ProcessResult }> {
    const {
      sessionId,
      messageId,
      messages,
      projectDir,
      resourceInstance: providedResourceInstance,
      providerModelFacts: providedProviderModelFacts,
      tools: providedTools,
      baseSystemPrompt,
      contextContributions,
      initialBlocks,
      initialAccounting,
      providerReplayProjector,
      promptPreview,
      search,
      interleavedReasoning: providedInterleavedReasoning,
      viewContext,
      refreshSystemPrompt,
      maxProviderRounds,
      onBeforeProviderStream,
      onRunRegistered,
      abortController: providedAbortController
    } = args
    let activeContextContributions = contextContributions
    const getOrCreateContextContributions = (): ContextRuntimeContributions => {
      activeContextContributions ??= createEmptyContextRuntimeContributions()
      return activeContextContributions
    }
    const resourceInstance = providedResourceInstance ?? this.ports.registry.getOrHydrateScope(toAppSessionId(sessionId)).instance
    const resourceScope = this.ports.runLifecycle.scopeFor(sessionId, resourceInstance)
    resourceScope.assertCurrent()
    const abortController =
      providedAbortController ?? this.ports.runLifecycle.ensureOperationController(resourceScope)
    const abortSignal = abortController.signal
    throwIfAbortRequested(abortSignal)
    const state = resourceInstance.getRuntimeState()
    if (!state) {
      throw new Error(`Session ${sessionId} not found`)
    }
    if (messages.length === 0) {
      throw new Error('Request was not sent because the prompt is empty.')
    }

    const providerModelFacts =
      providedProviderModelFacts ??
      resolveProviderModelRuntimeFacts(
        this.ports.providerSettings,
        state.providerId,
        state.modelId
      )
    assertProviderModelRuntimeFacts(providerModelFacts, state.providerId, state.modelId)
    const generationSettings = await awaitWithAbort(
      this.ports.sessionSettings.getEffectiveGenerationSettings(
        sessionId,
        resourceInstance,
        providerModelFacts
      ),
      abortSignal
    )
    const baseModelConfig = providerModelFacts.modelConfig
    const capabilitySnapshot = providerModelFacts.capabilitySnapshot
    const interleavedReasoning =
      providedInterleavedReasoning ??
      resolveInterleavedReasoningConfig(
        this.ports.providerSettings,
        state.providerId,
        state.modelId,
        generationSettings,
        capabilitySnapshot
      )
    const contextBudgetLength = resolveDeepChatContextBudgetLength(
      state.providerId,
      generationSettings.contextLength,
      baseModelConfig,
      state.modelId
    )
    const capabilityProviderId = capabilitySnapshot.identity.providerId
    const reasoningPortrait = capabilitySnapshot.reasoningPortrait
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
      this.ports.tape.listViewManifestsByMessage(sessionId, messageId)[0]
        ?.requestSeq ?? 0,
      this.ports.messageStore.getMaxMessageTraceRequestSeq(messageId),
      this.ports.tape.getMaxProviderAttemptRequestSeq(sessionId, messageId)
    )
    const temperature = generationSettings.temperature
    const maxTokens = capAgentRequestMaxTokens(generationSettings.maxTokens, contextBudgetLength)

    const streamSessionActiveSkillNames = await awaitWithAbort(
      this.ports.toolResolver.resolveActiveSkillNamesForToolProfile(sessionId),
      abortSignal
    )
    resourceScope.assertCurrent()
    const streamExtensionPolicy = await awaitWithAbort(
      this.ports.toolResolver.resolveAgentExtensionPolicy(sessionId, resourceInstance),
      abortSignal
    )
    resourceScope.assertCurrent()
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
    resourceScope.assertCurrent()
    const { supportsVision, supportsAudioInput } = resolveProviderInputCapabilities(
      this.ports.providerSettings,
      state.providerId,
      state.modelId,
      providerModelFacts
    )

    abortController.signal.throwIfAborted()
    const loopRun = createLoopRun<StreamState>({
      runId: randomUUID(),
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
    const runStarted = this.ports.tape.commitRunStarted({
      sessionId,
      runId: loopRun.runId,
      messageId,
      runKind: 'loop',
      createdAt: loopRun.startedAt
    })
    if (!runStarted.created) {
      throw new ExecutionJournalCorruptionError(
        `Execution Journal run identity ${loopRun.runId} was already committed.`
      )
    }

    let terminalCommitAttempted = false
    let committedTerminal: ProcessTerminalSelection | null = null
    const commitRunTerminal = (selection: ProcessTerminalSelection): void => {
      if (committedTerminal) {
        if (
          committedTerminal.outcome === selection.outcome &&
          committedTerminal.stopReason === selection.stopReason &&
          committedTerminal.errorMessage === selection.errorMessage
        ) {
          return
        }
        throw new ExecutionJournalCorruptionError(
          `Run ${loopRun.runId} selected conflicting terminal outcomes.`
        )
      }
      resourceScope.assertCurrent()
      if (terminalCommitAttempted) {
        throw new ExecutionJournalCorruptionError(
          `Run ${loopRun.runId} repeated a failed terminal commit.`
        )
      }

      terminalCommitAttempted = true
      const receipt = this.ports.tape.commitRunTerminal({
        sessionId,
        runId: loopRun.runId,
        messageId,
        outcome: selection.outcome,
        stopReason: selection.stopReason,
        ...(selection.errorMessage === undefined
          ? {}
          : { errorMessage: selection.errorMessage })
      })
      if (!receipt.created) {
        throw new ExecutionJournalCorruptionError(
          `Execution Journal terminal for Run ${loopRun.runId} already existed.`
        )
      }
      committedTerminal = { ...selection }
    }

    try {
      const activeGeneration = this.ports.runLifecycle.registerRun(resourceScope, loopRun)
      onRunRegistered?.(activeGeneration.runId)
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
      const persistMessageTrace = this.persistMessageTrace.bind(this)
      const emitRateLimitWaitingMessage = this.emitRateLimitWaitingMessage.bind(this)
      const clearRateLimitWaitingMessage = this.clearRateLimitWaitingMessage.bind(this)
      const hooks = this.ports.hookSink.scope({
        sessionId,
        messageId,
        providerId: state.providerId,
        modelId: state.modelId,
        projectDir
      })

      hooks.emit({ event: 'SessionStart', promptPreview })

      let reviewConversationMessages = messages
      const result = await processStream({
        run: loopRun,
        onConversationMessagesChange: (nextMessages) => {
          reviewConversationMessages = nextMessages
        },
        maxProviderRounds,
        providerReplayProjector,
        toolCatalog,
        refreshSystemPrompt: async (activeSkillNames, refreshedTools) => {
          if (refreshSystemPrompt) {
            return await refreshSystemPrompt(
              getEffectiveRuntimeSkillNames(activeSkillNames),
              refreshedTools
            )
          }
          return await this.ports.promptAssembly.createBasePromptAssembler(resourceInstance).assemble({
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
          requestTools
        ) {
          const requestBypassesContextBudget = shouldBypassDeepChatContextBudget(
            state.providerId,
            requestModelConfig,
            requestModelId
          )
          const isTtsRequest = isTtsModelConfig(requestModelConfig) || isTtsModelId(requestModelId)
          const effectiveRequestTools: MCPToolDefinition[] = isTtsRequest ? [] : requestTools
          // ACP and non-chat media routes are not safe to replay before their first visible event.
          const allowTransientRetry = !requestBypassesContextBudget && !isTtsRequest
          let queuedForRateLimit = false
          yield* ports.contextCoordinator.streamProviderAttempts({
            run: loopRun,
            requestMessages,
            modelId: requestModelId,
            modelConfig: requestModelConfig,
            temperature: requestTemperature,
            maxTokens: requestMaxTokens,
            tools: effectiveRequestTools,
            allowTransientRetry,
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
                  requestedMaxTokens,
                  contextContributions: activeContextContributions
                }),
              fitStrictRetry: ({ messages, reserveTokens }) =>
                fitRequestMessagesToContextWindow({
                  messages,
                  contextLength: requestModelConfig.contextLength,
                  reserveTokens,
                  minimumProtectedTailCount: 0,
                  contextContributions: activeContextContributions
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
                  contextContributions: getOrCreateContextContributions(),
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
                  syntheticContributions: activeContextContributions
                    ? getContextSyntheticContributions(activeContextContributions)
                    : manifest.syntheticContributions,
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
              stream: ({
                identity,
                messages,
                modelId,
                modelConfig,
                temperature,
                maxTokens,
                tools,
                signal
              }) => {
                const attemptModelConfig = traceEnabled
                  ? (Object.assign({}, modelConfig, {
                      requestTraceContext: {
                        enabled: true,
                        persist: async (payload: ProviderRequestTracePayload) => {
                          persistMessageTrace({
                            sessionId,
                            messageId,
                            providerId: state.providerId,
                            modelId: state.modelId,
                            payload,
                            requestSeq: identity.requestSeq,
                            logicalRound: identity.logicalRound,
                            physicalAttempt: identity.physicalAttempt
                          })
                        }
                      } satisfies ProviderRequestTraceContext
                    }) as ModelConfig)
                  : modelConfig
                return ports.providerRuntime.streamChat(
                  state.providerId,
                  messages,
                  modelId,
                  attemptModelConfig,
                  temperature,
                  maxTokens,
                  tools,
                  {
                    signal,
                    ...(search === true ? { search: true } : {})
                  }
                )
              },
              beforeStream: () => {
                crossPreStreamBoundary()
              }
            },
            outcome: {
              append: (outcome) =>
                ports.tape.appendProviderAttempt({
                  sessionId,
                  messageId,
                  providerId: state.providerId,
                  modelId: requestModelId,
                  ...outcome
                }),
              onAppendError: (error) =>
                logger.warn(
                  `[DeepChatAgent] Failed to persist provider attempt outcome: ${
                    error instanceof Error ? error.message : String(error)
                  }`
                )
            },
            retryObserver: (event) => {
              logger.info('[DeepChatAgent] Provider retry lifecycle', {
                sessionId,
                messageId,
                providerId: state.providerId,
                modelId: requestModelId,
                ...event
              })
            },
            isContextOverflowEvent: isFirstProviderContextOverflowEvent,
            isContextOverflowError: isContextWindowErrorLike,
            createAbortError
          })
        },
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
          this.ports.runLifecycle.markFirstTurnReady(resourceScope, activeGeneration.runId)
        },
        shouldYieldForPendingInput: () =>
          Boolean(this.ports.pendingInputCoordinator.getNextSteerInput(sessionId)),
        notificationObserver: hooks.toolObserver(),
        controls: {
          getActiveSkillNames: () => getEffectiveRuntimeSkillNames(),
          getEnabledMcpServerIds: () =>
            this.ports.toolResolver.normalizeNullablePolicyList(
              streamExtensionPolicy.enabledMcpServerIds
            ),
          getAgentId: () =>
            resourceInstance.getAgentId()?.trim() ||
            this.ports.identity.getAgentId(sessionId) ||
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
        commitRunTerminal,
        io: {
          messageStore: this.ports.messageStore,
          tapeToolFactWriter: this.ports.tape,
          executionJournalWriter: this.ports.tape,
          publishEvent: this.ports.publishEvent,
          publishSessionUpdate: this.ports.publishSessionUpdate
        }
      })
      resourceScope.assertCurrent()
      commitRunTerminal(selectProcessTerminal(result))
      return {
        runId: activeGeneration.runId,
        result
      }
    } catch (error) {
      let errorToPropagate: unknown =
        committedTerminal && !isExecutionJournalError(error)
          ? new CommittedRunProjectionError(loopRun.runId, committedTerminal, { cause: error })
          : error
      try {
        if (!terminalCommitAttempted && resourceScope.isCurrent()) {
          const aborted = abortSignal.aborted
          const fallbackTerminal: ProcessTerminalSelection = {
            outcome: aborted ? 'aborted' : 'error',
            stopReason: aborted
              ? 'user_stop'
              : isContextWindowErrorLike(error)
                ? 'context_window'
                : 'pre_stream_error',
            errorMessage: error instanceof Error ? error.message : String(error)
          }
          commitRunTerminal(fallbackTerminal)
          errorToPropagate = new CommittedRunProjectionError(loopRun.runId, fallbackTerminal, {
            cause: error
          })
        }
      } catch (terminalCommitError) {
        errorToPropagate =
          terminalCommitError === error
            ? error
            : wrapTerminalCommitFailure(error, terminalCommitError)
      } finally {
        this.ports.runLifecycle.clearRun(resourceScope, loopRun.runId)
      }
      throw errorToPropagate
    }
  }

  appendTapeViewManifest(params: AppendTapeViewManifestInput): void {
    const sourceMaps = this.ports.tape.getViewManifestSourceMaps(
      params.sessionId,
      params.messageId
    )
    const selection = params.selection
      ? {
          ...params.selection,
          ...(params.syntheticContributions !== undefined
            ? { syntheticContributions: params.syntheticContributions }
            : {})
        }
      : undefined
    const manifest = createTapeViewManifest({
      sessionId: params.sessionId,
      messageId: params.messageId,
      requestSeq: params.requestSeq,
      taskType: params.taskType,
      policy: params.policy,
      policyVersion: params.policyVersion ?? null,
      contextBuilderVersion: params.contextBuilderVersion,
      messages: params.messages,
      tools: params.tools,
      latestEntryId: sourceMaps.latestEntryId,
      anchorEntryIds: sourceMaps.reconstructionAnchorEntryIds,
      reconstructionAnchorEntryId: sourceMaps.reconstructionAnchorEntryId,
      included: selection
        ? buildIncludedRefs(selection, sourceMaps)
        : [
            ...buildRequestRefs(params.messages, sourceMaps),
            ...buildSyntheticContributionRefs(params.syntheticContributions ?? [])
          ],
      excluded: selection ? buildExcludedRefs(selection, sourceMaps) : [],
      summaryCursor: selection?.summaryCursor,
      tokenBudget: params.tokenBudget,
      providerId: params.providerId,
      modelId: params.modelId,
      summaryCursorOrderSeq: params.summaryCursorOrderSeq,
      supportsVision: params.supportsVision,
      supportsAudioInput: params.supportsAudioInput,
      traceDebugEnabled: params.traceDebugEnabled
    })
    this.ports.tape.appendViewManifest(manifest)
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
    logicalRound?: number | null
    physicalAttempt?: number | null
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
      requestSeq: args.requestSeq,
      logicalRound: args.logicalRound,
      physicalAttempt: args.physicalAttempt
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
    contextContributions: ContextRuntimeContributions
    signal: AbortSignal
    expectedInstance: DeepChatAgentInstance
  }): Promise<{
    messages: ChatMessage[]
    summaryCursorOrderSeq?: number
    syntheticContributions?: DeepChatTapeViewSyntheticContribution[]
  }> {
    const toolReserveTokens = estimateToolReserveTokens(params.tools)
    return await this.ports.contextCoordinator.recoverFromPressure<SessionSummaryState>({
      requestMessages: params.requestMessages,
      baseSystemPrompt: params.baseSystemPrompt,
      requestedMaxTokens: params.requestedMaxTokens,
      toolReserveTokens,
      minimumProtectedTailCount: params.minimumProtectedTailCount,
      contextContributions: params.contextContributions,
      prepareCompaction: async (systemPrompt) => {
        const prepared = await this.ports.inputPreparationCoordinator.prepareExisting({
          ensureHistory: () =>
            this.ports.tape.ensureSessionTapeReady(
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
              projectedMessages: this.removeLeadingContextContributions(
                params.requestMessages,
                params.contextContributions
              ),
              historyRecords,
              signal: params.signal
            }),
          applyCompaction: async (intent) =>
            await this.ports.compaction.apply(
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
              this.ports.runLifecycle.assertCurrentInstance(
                params.sessionId,
                params.expectedInstance
              )
          }
        })
        return prepared.intent ? { applied: true, summary: prepared.summary } : { applied: false }
      },
      assembleCheckpoint: async (summaryState) =>
        buildContextCheckpoint(
          summaryState.summaryText,
          this.ports.sessionStore.getReconstructionAnchorPromptState(params.sessionId)
        ),
      getSummaryCursorOrderSeq: (summaryState) => summaryState.summaryCursorOrderSeq,
      fit: ({ messages, reserveTokens, minimumProtectedTailCount }) =>
        fitRequestMessagesToContextWindow({
          messages,
          contextLength: params.contextLength,
          reserveTokens,
          minimumProtectedTailCount,
          contextContributions: params.contextContributions
        }),
      assertCurrent: () =>
        this.ports.runLifecycle.assertCurrentInstance(params.sessionId, params.expectedInstance)
    })
  }

  private removeLeadingContextContributions(
    messages: ChatMessage[],
    context: ContextRuntimeContributions
  ): ChatMessage[] {
    let offset = messages[0]?.role === 'system' ? 1 : 0
    if (
      context.checkpoint.message &&
      messages[offset]?.role === 'user' &&
      messages[offset]?.content === context.checkpoint.message.content
    ) {
      offset += 1
    }
    return messages.slice(offset)
  }
}
