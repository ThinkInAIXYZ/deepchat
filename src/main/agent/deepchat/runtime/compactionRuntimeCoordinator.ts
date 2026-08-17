import type { ProviderModelResolutionPort } from '@/provider/settings'
import type {
  SessionCompactionSnapshot,
  SessionCompactionState
} from '@shared/types/agent-interface'
import type { DeepChatAgentInstance } from '@/agent/deepchat/instance/deepChatAgentInstance'
import {
  hasCompactionBoundaryAdvanced,
  type CompactionIntent,
  type CompactionService
} from './compactionService'
import type { DeepChatEventPublisher } from './types'
import type { SessionTranscript } from '@/session/data/transcript'
import type { SessionSettingsStore, SessionSummaryState } from '@/session/data/settings'
import { isAbortError, throwIfAbortRequested } from './abortErrors'
import type { DeepChatToolResolver } from './toolResolver'
import type { RunLifecycleCoordinator } from './runLifecycleCoordinator'
import type { SessionSettingsCoordinator } from './sessionSettingsCoordinator'
import type { TapeReconciliationPort } from '@/tape/ports/capabilities'
import type { TapeTranscriptReader } from '@/tape/ports/capabilities'
import type { SessionScopeRegistry } from '@/agent/deepchat/instance/deepChatAgentRuntime'
import type { MessageProjectionService } from './messageProjectionService'
import type { PromptAssemblyService } from './promptAssemblyService'
import type { SessionStateResolver } from './sessionStateResolver'
import { awaitWithAbort } from '@/lib/awaitWithAbort'
import { capAgentRequestMaxTokens, estimateToolReserveTokens } from './contextBudget'
import {
  resolveDeepChatContextBudgetLength,
  shouldBypassDeepChatContextBudget
} from './contextBudgetPolicy'
import { resolveInterleavedReasoningConfig } from './generationSettings'
import { resolveProviderInputCapabilities } from './providerInputCapabilities'
import { resolveProviderModelRuntimeFacts } from './providerModelRuntimeFacts'
import { toAppSessionId } from '@/agent/shared/agentSessionIds'
import type { CommandShellService } from '@/agent/shared/process/commandShellService'
import {
  isSummaryGapReason,
  type SummaryGapReason
} from './contextContributions'

type ManualCompactionLifecycle = Pick<
  RunLifecycleCoordinator,
  | 'canSettleOperation'
  | 'clearOperationController'
  | 'ensureOperationController'
  | 'hasPendingInteractions'
  | 'scopeFor'
  | 'transitionStatus'
>

type ManualCompactionToolResolver = Pick<
  DeepChatToolResolver,
  'loadToolDefinitionsForSession' | 'resolveActiveSkillNamesForToolProfile'
>

type ManualCompactionSessionSettings = Pick<
  SessionSettingsCoordinator,
  'getEffectiveGenerationSettings' | 'resolveProjectDir'
>

type CompactionServicePort = Pick<
  CompactionService,
  'applyCompaction' | 'prepareForManualCompaction'
>

type CompactionSessionStore = Pick<
  SessionSettingsStore,
  | 'get'
  | 'getReconstructionAnchorPromptState'
  | 'getReconstructionAnchorPromptStateByCompactionAttemptId'
  | 'getSummaryState'
  | 'resetSummaryState'
>

type CompactionTranscript = TapeTranscriptReader &
  Pick<
    SessionTranscript,
    | 'createCompactionMessage'
    | 'createCompactionMessageAtOrderSeq'
    | 'deleteMessage'
    | 'getNextOrderSeq'
    | 'recordCompactionModelCall'
    | 'updateCompactionMessage'
  >

export interface CompactionRuntimeCoordinatorDependencies {
  compactionService: CompactionServicePort
  sessionStore: CompactionSessionStore
  messageStore: CompactionTranscript
  providerSettings: ProviderModelResolutionPort
  toolResolver: ManualCompactionToolResolver
  runLifecycle: ManualCompactionLifecycle
  sessionSettings: ManualCompactionSessionSettings
  tapeReconciliation: TapeReconciliationPort
  registry: SessionScopeRegistry
  sessionState: Pick<SessionStateResolver, 'getSummary'>
  promptAssembly: Pick<PromptAssemblyService, 'createBasePromptAssembler'>
  commandShell: Pick<CommandShellService, 'resolveForTurn'>
  messageProjection: Pick<MessageProjectionService, 'refresh'>
  publishEvent: DeepChatEventPublisher
}

interface ApplyCompactionOptions {
  compactionMessageId?: string
  compactionMessageOrderSeq?: number
  shiftMessagesFromCompactionOrderSeq?: boolean
  startedExternally?: boolean
  signal?: AbortSignal
}

export class CompactionRuntimeCoordinator {
  private readonly emitSeqBySession = new Map<string, number>()

  constructor(private readonly deps: CompactionRuntimeCoordinatorDependencies) {}

  private instance(sessionId: string): DeepChatAgentInstance {
    return this.deps.registry.getOrHydrateScope(toAppSessionId(sessionId)).instance
  }

  private assertCurrent(sessionId: string, instance: DeepChatAgentInstance): void {
    this.deps.registry.scopeFor(toAppSessionId(sessionId), instance).assertCurrent()
  }

  async getSnapshot(
    sessionId: string,
    expectedInstance?: DeepChatAgentInstance
  ): Promise<SessionCompactionSnapshot> {
    const projection = this.resolveProjection(sessionId, expectedInstance)
    return {
      state: projection.state,
      emitSeq: this.currentEmitSeq(sessionId),
      latestAnchorEntryId: projection.latestAnchorEntryId
    }
  }

  private resolveProjection(
    sessionId: string,
    expectedInstance?: DeepChatAgentInstance
  ): { state: SessionCompactionState; latestAnchorEntryId: number | null } {
    const hydratedInstance = expectedInstance ?? this.deps.registry.getHydratedScope(toAppSessionId(sessionId))?.instance
    const runtimeState = hydratedInstance?.getRuntimeState()
    const session = this.deps.sessionStore.get(sessionId)
    if (!runtimeState && !session) {
      throw new Error(`Session ${sessionId} not found`)
    }
    const instance = hydratedInstance ?? this.instance(sessionId)
    this.assertCurrent(sessionId, instance)

    const reconstructionAnchor = this.deps.sessionStore.getReconstructionAnchorPromptState(sessionId)
    const latestAnchorEntryId = reconstructionAnchor?.entryId ?? null
    const persistedState = this.fromSummary(
      this.deps.sessionStore.getSummaryState(sessionId),
      undefined,
      reconstructionAnchor?.state.reason
    )
    const currentCompactionState = instance.getCompactionState()
    if (currentCompactionState?.status === 'compacting') {
      return {
        state: { ...currentCompactionState, boundaryReason: null },
        latestAnchorEntryId
      }
    }

    if (currentCompactionState && this.isSame(currentCompactionState, persistedState)) {
      return { state: currentCompactionState, latestAnchorEntryId }
    }

    instance.setCompactionState(persistedState)
    return { state: { ...persistedState }, latestAnchorEntryId }
  }

  async compact(
    sessionId: string
  ): Promise<{ compacted: boolean; state: SessionCompactionState }> {
    const instance = this.instance(sessionId)
    const scope = this.deps.runLifecycle.scopeFor(sessionId, instance)
    const state = instance.getRuntimeState() ?? (await this.deps.sessionState.getSummary(sessionId))
    if (!state) {
      throw new Error(`Session ${sessionId} not found`)
    }
    this.assertCurrent(sessionId, instance)
    const modelConfig = this.deps.providerSettings.getModelConfig(
      state.modelId,
      state.providerId
    )
    if (shouldBypassDeepChatContextBudget(state.providerId, modelConfig, state.modelId)) {
      throw new Error('Manual compaction is only available for DeepChat agent sessions.')
    }
    if (state.status !== 'idle') {
      throw new Error('Manual compaction is only available when the session is idle.')
    }
    if (this.deps.runLifecycle.hasPendingInteractions(sessionId)) {
      throw new Error('Pending tool interactions must be resolved before compacting.')
    }

    const providerModelFacts = resolveProviderModelRuntimeFacts(
      this.deps.providerSettings,
      state.providerId,
      state.modelId,
      modelConfig
    )
    const { capabilitySnapshot } = providerModelFacts
    this.deps.runLifecycle.transitionStatus(scope, 'generating')
    const compactionAbortController = this.deps.runLifecycle.ensureOperationController(scope)
    const compactionAbortSignal = compactionAbortController.signal
    try {
      throwIfAbortRequested(compactionAbortSignal)
      const generationSettings = await awaitWithAbort(
        this.deps.sessionSettings.getEffectiveGenerationSettings(
          sessionId,
          instance,
          providerModelFacts
        ),
        compactionAbortSignal
      )
      const interleavedReasoning = resolveInterleavedReasoningConfig(
        this.deps.providerSettings,
        state.providerId,
        state.modelId,
        generationSettings,
        capabilitySnapshot
      )
      const contextBudgetLength = resolveDeepChatContextBudgetLength(
        state.providerId,
        generationSettings.contextLength,
        modelConfig,
        state.modelId
      )
      const maxTokens = capAgentRequestMaxTokens(
        generationSettings.maxTokens,
        contextBudgetLength
      )
      const activeSkillNames = await awaitWithAbort(
        this.deps.toolResolver.resolveActiveSkillNamesForToolProfile(sessionId),
        compactionAbortSignal
      )
      this.assertCurrent(sessionId, instance)
      const projectDir = this.deps.sessionSettings.resolveProjectDir(
        sessionId,
        undefined,
        instance
      )
      const tools = await awaitWithAbort(
        this.deps.toolResolver.loadToolDefinitionsForSession(
          sessionId,
          projectDir,
          activeSkillNames,
          instance
        ),
        compactionAbortSignal
      )
      const toolReserveTokens = estimateToolReserveTokens(tools)
      const commandShell = await awaitWithAbort(
        this.deps.commandShell.resolveForTurn(),
        compactionAbortSignal
      )
      const baseSystemPrompt = await awaitWithAbort(
        this.deps.promptAssembly.createBasePromptAssembler(instance).assemble({
          sessionId: toAppSessionId(sessionId),
          configuredPrompt: generationSettings.systemPrompt,
          toolDefinitions: tools,
          activeSkillNames,
          sessionActiveSkillNames: activeSkillNames,
          contextLength: generationSettings.contextLength,
          commandShell
        }),
        compactionAbortSignal
      )
      throwIfAbortRequested(compactionAbortSignal)
      const tapeReady = this.deps.tapeReconciliation.ensureSessionTapeReady(
        sessionId,
        this.deps.messageStore
      )
      const { supportsVision, supportsAudioInput } = resolveProviderInputCapabilities(
        this.deps.providerSettings,
        state.providerId,
        state.modelId,
        providerModelFacts
      )

      const intent = await this.deps.compactionService.prepareForManualCompaction({
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
        historyRecords: tapeReady.historyRecords,
        signal: compactionAbortSignal
      })
      throwIfAbortRequested(compactionAbortSignal)
      this.assertCurrent(sessionId, instance)

      if (!intent) {
        return {
          compacted: false,
          state: this.resolveProjection(sessionId, instance).state
        }
      }

      const summaryState = await this.apply(
        sessionId,
        intent,
        { signal: compactionAbortSignal },
        instance
      )
      throwIfAbortRequested(compactionAbortSignal)
      this.assertCurrent(sessionId, instance)
      const compacted = hasCompactionBoundaryAdvanced(intent.previousState, summaryState)
      return {
        compacted,
        state: this.resolveProjection(sessionId, instance).state
      }
    } finally {
      const stillOwnsLifecycle = this.deps.runLifecycle.canSettleOperation(
        scope,
        compactionAbortController
      )
      this.deps.runLifecycle.clearOperationController(scope, compactionAbortController)
      if (stillOwnsLifecycle) {
        this.deps.runLifecycle.transitionStatus(scope, 'idle')
      }
    }
  }

  async apply(
    sessionId: string,
    intent: CompactionIntent | null,
    options?: ApplyCompactionOptions,
    expectedInstance = this.instance(sessionId)
  ): Promise<SessionSummaryState> {
    const scope = this.deps.registry.scopeFor(toAppSessionId(sessionId), expectedInstance)
    scope.assertCurrent()
    if (!intent) {
      return this.deps.sessionStore.getSummaryState(sessionId)
    }

    const compactionMessageId =
      options?.compactionMessageId ??
      (options?.compactionMessageOrderSeq !== undefined
        ? this.deps.messageStore.createCompactionMessageAtOrderSeq(
            sessionId,
            Math.max(1, Math.floor(options.compactionMessageOrderSeq)),
            'compacting',
            intent.previousState.summaryUpdatedAt,
            {
              compactionAttemptId: intent.compactionAttemptId,
              shiftExistingMessages: options.shiftMessagesFromCompactionOrderSeq === true
            }
          )
        : this.deps.messageStore.createCompactionMessage(
            sessionId,
            this.deps.messageStore.getNextOrderSeq(sessionId),
            'compacting',
            intent.previousState.summaryUpdatedAt,
            { compactionAttemptId: intent.compactionAttemptId }
          ))

    if (!options?.startedExternally) {
      this.deps.messageProjection.refresh(sessionId, compactionMessageId)
      this.emit(
        sessionId,
        {
          status: 'compacting',
          cursorOrderSeq: intent.targetCursorOrderSeq,
          summaryUpdatedAt: intent.previousState.summaryUpdatedAt,
          boundaryReason: null
        },
        expectedInstance
      )
    }

    let result: Awaited<ReturnType<CompactionService['applyCompaction']>>
    try {
      result = await this.deps.compactionService.applyCompaction(
        intent,
        options?.signal,
        (observation) =>
          this.deps.messageStore.recordCompactionModelCall({
            ...observation,
            sessionId,
            compactionMessageId,
            compactionAttemptId: intent.compactionAttemptId
          })
      )
    } catch (error) {
      this.deps.messageStore.deleteMessage(compactionMessageId)
      this.deps.messageProjection.refresh(sessionId, compactionMessageId)
      if (scope.isCurrent()) {
        this.emit(
          sessionId,
          this.projectSummaryState(sessionId, intent.previousState),
          expectedInstance
        )
      }
      if (isAbortError(error) || options?.signal?.aborted) {
        throwIfAbortRequested(options?.signal)
      }
      throw error
    }

    const projectedState =
      result.outcome !== 'unchanged'
        ? this.projectSummaryState(sessionId, result.summaryState, 'compacted')
        : this.projectSummaryState(sessionId, result.summaryState)
    if (result.anchorCommitted && result.outcome !== 'unchanged') {
      this.deps.messageStore.updateCompactionMessage(
        compactionMessageId,
        'compacted',
        result.summaryState.summaryUpdatedAt,
        {
          compactionAttemptId: intent.compactionAttemptId,
          boundaryReason:
            result.outcome === 'boundary_only'
              ? this.resolveBoundaryReason(
                  this.deps.sessionStore.getReconstructionAnchorPromptStateByCompactionAttemptId(
                    sessionId,
                    intent.compactionAttemptId
                  )?.state.reason
                )
              : null
        }
      )
    } else {
      this.deps.messageStore.deleteMessage(compactionMessageId)
    }
    this.deps.messageProjection.refresh(sessionId, compactionMessageId)
    if (scope.isCurrent()) {
      this.emit(sessionId, projectedState, expectedInstance)
    }
    return result.summaryState
  }

  idleState(): SessionCompactionState {
    return {
      status: 'idle',
      cursorOrderSeq: 1,
      summaryUpdatedAt: null,
      boundaryReason: null
    }
  }

  fromSummary(
    summaryState: SessionSummaryState,
    preferredStatus?: 'compacted',
    persistedReason?: unknown
  ): SessionCompactionState {
    const hasPersistedSummary =
      Boolean(summaryState.summaryText?.trim()) && summaryState.summaryUpdatedAt !== null
    const hasPersistedBoundary = summaryState.summaryCursorOrderSeq > 1
    return preferredStatus === 'compacted' || hasPersistedSummary || hasPersistedBoundary
      ? {
          status: 'compacted',
          cursorOrderSeq: Math.max(1, summaryState.summaryCursorOrderSeq),
          summaryUpdatedAt: summaryState.summaryUpdatedAt,
          boundaryReason: this.resolveBoundaryReason(persistedReason)
        }
      : this.idleState()
  }

  private projectSummaryState(
    sessionId: string,
    summaryState: SessionSummaryState,
    preferredStatus?: 'compacted'
  ): SessionCompactionState {
    const anchor = this.deps.sessionStore.getReconstructionAnchorPromptState(sessionId)
    return this.fromSummary(summaryState, preferredStatus, anchor?.state.reason)
  }

  private resolveBoundaryReason(reason: unknown): SummaryGapReason | null {
    return isSummaryGapReason(reason) ? reason : null
  }

  isSame(left: SessionCompactionState, right: SessionCompactionState): boolean {
    return (
      left.status === right.status &&
      left.cursorOrderSeq === right.cursorOrderSeq &&
      left.summaryUpdatedAt === right.summaryUpdatedAt &&
      left.boundaryReason === right.boundaryReason
    )
  }

  private currentEmitSeq(sessionId: string): number {
    return this.emitSeqBySession.get(sessionId) ?? 0
  }

  private nextEmitSeq(sessionId: string): number {
    const next = this.currentEmitSeq(sessionId) + 1
    this.emitSeqBySession.set(sessionId, next)
    return next
  }

  emit(
    sessionId: string,
    state: SessionCompactionState,
    expectedInstance = this.instance(sessionId)
  ): void {
    this.assertCurrent(sessionId, expectedInstance)
    const reconstructionAnchor = this.deps.sessionStore.getReconstructionAnchorPromptState(sessionId)
    const projectedState = {
      ...state,
      boundaryReason:
        state.status === 'compacted'
          ? this.resolveBoundaryReason(reconstructionAnchor?.state.reason)
          : null
    }
    expectedInstance.setCompactionState(projectedState)
    this.deps.publishEvent('sessions.compaction.changed', {
      sessionId,
      status: projectedState.status,
      cursorOrderSeq: projectedState.cursorOrderSeq,
      summaryUpdatedAt: projectedState.summaryUpdatedAt,
      boundaryReason: projectedState.boundaryReason,
      emitSeq: this.nextEmitSeq(sessionId),
      latestAnchorEntryId: reconstructionAnchor?.entryId ?? null
    })
  }

  releaseSession(sessionId: string): void {
    this.emitSeqBySession.delete(sessionId)
  }

  reset(sessionId: string, expectedInstance = this.instance(sessionId)): void {
    this.assertCurrent(sessionId, expectedInstance)
    this.deps.sessionStore.resetSummaryState(sessionId)
    this.emit(sessionId, this.idleState(), expectedInstance)
  }

  invalidateIfNeeded(
    sessionId: string,
    orderSeq: number,
    expectedInstance = this.instance(sessionId)
  ): void {
    this.assertCurrent(sessionId, expectedInstance)
    if (orderSeq < this.deps.sessionStore.getSummaryState(sessionId).summaryCursorOrderSeq) {
      this.reset(sessionId, expectedInstance)
    }
  }
}
