import logger from '@shared/logger'
import type { DeepChatSessionState } from '@shared/types/agent-interface'
import type { AppSessionId } from '@/agent/shared/agentSessionIds'
import { toAppSessionId } from '@/agent/shared/agentSessionIds'
import type {
  DeepChatAgentInstance,
  DeepChatActiveGeneration
} from '@/agent/deepchat/instance/deepChatAgentInstance'
import type {
  DeepChatAgentRuntime,
  SessionRuntimeScope
} from '@/agent/deepchat/instance/deepChatAgentRuntime'
import type { LoopRun } from '@/agent/deepchat/loop/loopRun'
import type { SessionTranscript } from '@/session/data/transcript'
import { buildTerminalErrorBlocks } from '@/session/data/transcript'
import { parseMessageMetadata } from '@/session/usageStats'
import {
  collectPendingInteractionEntries,
  parseAssistantBlocks,
  reconcilePendingInteractionEntries,
  replacePendingInteractions,
  type PendingInteractionEntry
} from './interactionProjection'
import { resolveProviderPermissionSafely } from './providerPermissionResolution'
import { redactRuntimeErrorForLog } from './runtimeErrorLogging'
import { buildUsageFromMetadata, stampTerminalMetadata } from './runtimeMetadata'
import type { SessionStatusPublisher } from './sessionStatusPublisher'
import type { MessageProjectionService } from './messageProjectionService'
import { resolveStreamRequestId as resolveRegistryStreamRequestId } from './streamRequestId'
import type { ProcessResult } from './types'

export type PendingInputWakeReason = 'enqueue' | 'completed' | 'manual'

type RunLifecycleTranscript = Pick<
  SessionTranscript,
  'getMessage' | 'getMessages' | 'setMessageError'
>

export interface PendingInputWakeup {
  drain(sessionId: string, reason: PendingInputWakeReason): Promise<boolean>
}

export interface RunTerminalObserver {
  observeTerminal(
    sessionId: string,
    state: DeepChatSessionState | undefined,
    result: ProcessResult
  ): void
}

export interface RunLifecycleCoordinatorPorts {
  runtime: DeepChatAgentRuntime
  statusPublisher: SessionStatusPublisher
  transcript: RunLifecycleTranscript
  pendingInputWakeup: PendingInputWakeup
  terminalObserver: RunTerminalObserver
  messageProjection: Pick<MessageProjectionService, 'refresh'>
}

export class RunLifecycleCoordinator {
  constructor(private readonly ports: RunLifecycleCoordinatorPorts) {}

  getOrCreateScope(sessionId: string): SessionRuntimeScope {
    return this.ports.runtime.getOrHydrateScope(toAppSessionId(sessionId))
  }

  getHydratedScope(sessionId: string): SessionRuntimeScope | undefined {
    return this.ports.runtime.getHydratedScope(toAppSessionId(sessionId))
  }

  scopeFor(sessionId: string, instance: DeepChatAgentInstance): SessionRuntimeScope {
    return this.ports.runtime.scopeFor(toAppSessionId(sessionId), instance)
  }

  assertCurrentInstance(sessionId: string, instance: DeepChatAgentInstance): void {
    this.scopeFor(sessionId, instance).assertCurrent()
  }

  getAbortSignal(sessionId: string): AbortSignal | undefined {
    return this.getHydratedScope(sessionId)?.instance.getAbortSignal()
  }

  ensureOperationController(scope: SessionRuntimeScope): AbortController {
    scope.assertCurrent()
    const activeRun = scope.instance.getActiveGeneration()
    if (activeRun) {
      if (!activeRun.abortController.signal.aborted) {
        return activeRun.abortController
      }
      // A cancelled run may remain registered until its handler settles. A new operation must never
      // inherit its already-aborted controller.
      this.clearRun(scope, activeRun.runId)
    }

    const existing = scope.instance.getAbortController()
    existing?.abort()

    const controller = new AbortController()
    scope.instance.setAbortController(controller)
    return controller
  }

  clearOperationController(
    scope: SessionRuntimeScope,
    controller?: AbortController
  ): boolean {
    if (!controller || !scope.isCurrent()) {
      return false
    }
    return scope.instance.clearAbortController(controller)
  }

  canSettleOperation(scope: SessionRuntimeScope, controller: AbortController): boolean {
    if (!scope.isCurrent()) {
      return false
    }
    const current = scope.instance.getAbortController()
    return current === undefined || current === controller
  }

  registerRun<TStreamState>(
    scope: SessionRuntimeScope,
    run: LoopRun<TStreamState>
  ): LoopRun<TStreamState> {
    scope.assertCurrent()
    if (run.sessionId !== scope.sessionId) {
      throw new Error(
        `Loop run ${run.runId} belongs to session ${run.sessionId}, not ${scope.sessionId}`
      )
    }
    return scope.instance.registerActiveGeneration(run)
  }

  clearRun(scope: SessionRuntimeScope, runId: string): boolean {
    // Cleanup stays bound to the originating instance even after replacement. Status and terminal
    // projections use the independent current-scope and active-run fences.
    if (
      scope.instance.sessionId !== scope.sessionId ||
      !scope.instance.clearActiveGeneration(runId)
    ) {
      return false
    }
    this.cancelProviderPermissions(scope.instance)
    return true
  }

  isRunCurrent(sessionId: AppSessionId | string, runId: string): boolean {
    return (
      this.ports.runtime
        .getHydratedScope(toAppSessionId(sessionId))
        ?.instance.isActiveRun(runId) ?? false
    )
  }

  isRunCurrentForScope(scope: SessionRuntimeScope, runId: string): boolean {
    return scope.isCurrent() && scope.instance.isActiveRun(runId)
  }

  isMessageAssociatedWithRun(
    run: DeepChatActiveGeneration | undefined,
    messageId: string
  ): boolean {
    return run?.messageId === messageId
  }

  markFirstTurnReady(scope: SessionRuntimeScope, runId: string): boolean {
    const run = scope.instance.getActiveGeneration()
    if (
      !this.isRunCurrentForScope(scope, runId) ||
      !run ||
      run.abortController.signal.aborted
    ) {
      return false
    }
    scope.instance.markFirstTurnReady()
    return true
  }

  clearFirstTurnReady(sessionId: string): void {
    this.getHydratedScope(sessionId)?.instance.clearFirstTurnReady()
  }

  transitionCurrentStatus(
    sessionId: string,
    status: DeepChatSessionState['status'],
    usage?: Record<string, number>
  ): boolean {
    const scope = this.getHydratedScope(sessionId)
    return scope ? this.ports.statusPublisher.transition(scope, status, usage) : false
  }

  transitionStatus(
    scope: SessionRuntimeScope,
    status: DeepChatSessionState['status'],
    usage?: Record<string, number>
  ): boolean {
    return this.ports.statusPublisher.transition(scope, status, usage)
  }

  refreshPendingInteractions(sessionId: string): boolean {
    const pendingEntries: PendingInteractionEntry[] = []
    for (const message of this.ports.transcript.getMessages(sessionId)) {
      if (message.role !== 'assistant') {
        continue
      }
      pendingEntries.push(
        ...collectPendingInteractionEntries(
          message.id,
          parseAssistantBlocks(message.content),
          pendingEntries.length
        )
      )
    }
    return this.reconcilePendingInteractions(sessionId, pendingEntries)
  }

  reconcilePendingInteractions(
    sessionId: string,
    pendingEntries: PendingInteractionEntry[]
  ): boolean {
    const scope = this.getHydratedScope(sessionId)
    if (!scope) {
      return pendingEntries.length > 0
    }
    replacePendingInteractions(
      scope.instance,
      reconcilePendingInteractionEntries(scope.instance, pendingEntries)
    )
    return scope.instance.hasPendingInteractions()
  }

  hasPendingInteractions(sessionId: string): boolean {
    return this.refreshPendingInteractions(sessionId)
  }

  registerDeferredToolController(sessionId: string, toolCallId: string): AbortController {
    return this.getOrCreateScope(sessionId).instance.registerDeferredToolAbortController(toolCallId)
  }

  clearDeferredToolController(
    sessionId: string,
    toolCallId: string,
    controller?: AbortController
  ): boolean {
    const scope = this.getHydratedScope(sessionId)
    return scope?.instance.clearDeferredToolAbortController(toolCallId, controller) ?? false
  }

  getActiveGeneration(sessionId: string): { eventId: string; runId: string } | null {
    const activeRun = this.getHydratedScope(sessionId)?.instance.getActiveGeneration()
    return activeRun ? { eventId: activeRun.messageId, runId: activeRun.runId } : null
  }

  resolveStreamRequestId(sessionId: string, messageId: string): string {
    return resolveRegistryStreamRequestId(this.ports.runtime, sessionId, messageId)
  }

  async cancel(sessionId: string): Promise<void> {
    const scope = this.getHydratedScope(sessionId)
    if (!scope) {
      return
    }

    const { instance } = scope
    if (!instance.hasPendingInteractions()) {
      this.refreshPendingInteractions(sessionId)
    }
    const pendingInteractions = instance.getPendingInteractions()
    const hasDeferredHandler = pendingInteractions.some((interaction) =>
      instance.hasDeferredToolAbortController(interaction.toolCallId)
    )
    const hasAsyncSettlementOwner = Boolean(
      instance.getActiveGeneration() || instance.getAbortController() || hasDeferredHandler
    )

    instance.requestGenerationAbort()
    instance.abortDeferredToolCalls()
    this.cancelProviderPermissions(instance)

    if (hasAsyncSettlementOwner || pendingInteractions.length === 0) {
      return
    }

    const terminalMessages = Array.from(
      new Set(pendingInteractions.map(({ messageId }) => messageId))
    ).map((messageId) => {
      const metadata = parseMessageMetadata(
        this.ports.transcript.getMessage(messageId)?.metadata ?? '{}'
      )
      return {
        messageId,
        terminalMetadata: stampTerminalMetadata(metadata, 'aborted', 'user_stop')
      }
    })
    for (const { messageId, terminalMetadata } of terminalMessages) {
      this.writeCanceledTerminalBlock(sessionId, messageId, JSON.stringify(terminalMetadata))
    }
    instance.replacePendingInteractions([])
    const primaryTerminal = terminalMessages[0]
    this.observeAbortedTurn(
      sessionId,
      primaryTerminal.terminalMetadata.runId,
      JSON.stringify(primaryTerminal.terminalMetadata)
    )
    this.schedulePendingInputDrain(sessionId, 'completed')
  }

  cancelScopeOperations(scope: SessionRuntimeScope): void {
    if (!scope.isCurrent()) {
      return
    }
    scope.instance.abortAndClearGeneration()
    scope.instance.abortDeferredToolCalls()
    this.cancelProviderPermissions(scope.instance)
  }

  observeTerminal(sessionId: string, result: ProcessResult): void {
    this.ports.terminalObserver.observeTerminal(sessionId, this.currentState(sessionId), result)
  }

  applyProcessResultStatus(
    sessionId: string,
    result: ProcessResult | null | undefined,
    runId?: string
  ): void {
    // Terminal observers describe the run that ended even if a newer run has replaced it. Mutable
    // Session projection is fenced by the active run identity below.
    const isActive = !runId || this.isRunCurrent(sessionId, runId)
    const scope = this.getHydratedScope(sessionId)
    if (!result?.status) {
      if (isActive && scope) {
        scope.instance.replacePendingInteractions([])
        this.transitionStatus(scope, 'idle')
      }
      return
    }
    if (result.status === 'paused') {
      if (isActive && scope) {
        if (result.toolBatchExecutionState) {
          scope.instance.replacePendingToolBatch(
            result.pendingInteractions ?? [],
            result.toolBatchExecutionState
          )
        } else {
          scope.instance.replacePendingInteractions(result.pendingInteractions ?? [])
        }
        this.transitionStatus(scope, 'generating')
      }
      return
    }

    this.observeTerminal(sessionId, result)
    if (!isActive || !scope) {
      return
    }
    scope.instance.replacePendingInteractions([])
    this.ports.statusPublisher.transition(
      scope,
      result.status === 'error' ? 'error' : 'idle',
      result.usage
    )
  }

  settleAbortedTurn(
    sessionId: string,
    messageId: string | null,
    runId?: string,
    metadata?: string
  ): void {
    this.writeCanceledTerminalBlock(sessionId, messageId, metadata)
    this.observeAbortedTurn(sessionId, runId, metadata)
  }

  private observeAbortedTurn(sessionId: string, runId?: string, metadata?: string): void {
    const usage = metadata ? buildUsageFromMetadata(parseMessageMetadata(metadata)) : undefined
    this.observeTerminal(sessionId, {
      status: 'aborted',
      stopReason: 'user_stop',
      errorMessage: 'common.error.userCanceledGeneration',
      usage
    })

    const scope = this.getHydratedScope(sessionId)
    if (scope && this.canSettleAbortedRun(scope, runId)) {
      this.ports.statusPublisher.transition(scope, 'idle', usage)
    }
  }

  async requestPendingInputDrain(
    sessionId: string,
    reason: PendingInputWakeReason
  ): Promise<boolean> {
    return await this.ports.pendingInputWakeup.drain(sessionId, reason)
  }

  schedulePendingInputDrain(sessionId: string, reason: PendingInputWakeReason): void {
    void this.requestPendingInputDrain(sessionId, reason).catch(() => undefined)
  }

  private canSettleAbortedRun(scope: SessionRuntimeScope, runId?: string): boolean {
    if (!scope.isCurrent()) {
      return false
    }
    const activeRun = scope.instance.getActiveGeneration()
    const controller = scope.instance.getAbortController()
    const hasReplacementController = Boolean(
      controller && (!activeRun || controller !== activeRun.abortController)
    )
    return runId
      ? activeRun?.runId === runId || (!activeRun && !hasReplacementController)
      : !hasReplacementController
  }

  private currentState(sessionId: string): DeepChatSessionState | undefined {
    return this.getHydratedScope(sessionId)?.state()
  }

  private writeCanceledTerminalBlock(
    sessionId: string,
    messageId: string | null,
    metadata?: string
  ): void {
    if (!messageId) {
      return
    }
    const assistantMessage = this.ports.transcript.getMessage(messageId)
    if (assistantMessage?.role !== 'assistant') {
      return
    }
    const blocks = buildTerminalErrorBlocks(
      parseAssistantBlocks(assistantMessage.content),
      'common.error.userCanceledGeneration'
    )
    this.ports.transcript.setMessageError(messageId, blocks, metadata)
    this.ports.messageProjection.refresh(sessionId, messageId)
  }

  private cancelProviderPermissions(instance: DeepChatAgentInstance): void {
    for (const permission of instance.takeActiveProviderPermissions()) {
      void resolveProviderPermissionSafely(() => permission.resolve(false)).catch((error) => {
        logger.warn(
          `[DeepChatAgent] Failed to cancel ACP permission request ${permission.requestId}:`,
          redactRuntimeErrorForLog(error)
        )
      })
    }
  }
}
