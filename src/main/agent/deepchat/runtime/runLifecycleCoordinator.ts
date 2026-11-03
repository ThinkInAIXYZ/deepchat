import type { HarnessControlLease, HarnessControlOwner } from '@shared/harness/control'
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
  type PendingInteractionEntry
} from './interactionProjection'
import { redactRuntimeErrorForLog } from './runtimeErrorLogging'
import { buildUsageFromMetadata, stampInteractionResolution } from './runtimeMetadata'
import type { SessionStatusPublisher } from './sessionStatusPublisher'
import type { MessageProjectionService } from './messageProjectionService'
import { resolveStreamRequestId as resolveRegistryStreamRequestId } from './streamRequestId'
import { revokeToolSurfaceDeferredDispatchesForSession } from './toolSurface'
import type { ProcessResult } from './types'
import type { AgentCliTokenAuthority } from '@/cli/agentTokenAuthority'

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
  programmaticAuthority: Pick<AgentCliTokenAuthority, 'revokeConversation'>
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

  async ensureOperationController(scope: SessionRuntimeScope): Promise<AbortController> {
    await scope.instance.controlReady()
    scope.assertCurrent()
    return await scope.instance.ensureOperationController()
  }

  async clearOperationController(
    scope: SessionRuntimeScope,
    controller?: AbortController,
    settled?: () => void,
    origin?: { operationId: string; runId?: string }
  ): Promise<boolean> {
    if (!controller || !scope.isCurrent()) return false
    return await scope.instance.clearAbortController(controller, settled, origin)
  }

  async registerRun<TStreamState>(
    scope: SessionRuntimeScope,
    run: LoopRun<TStreamState>
  ): Promise<LoopRun<TStreamState>> {
    await scope.instance.controlReady()
    scope.assertCurrent()
    if (run.sessionId !== scope.sessionId) {
      throw new Error(
        `Loop run ${run.runId} belongs to session ${run.sessionId}, not ${scope.sessionId}`
      )
    }
    return await scope.instance.registerActiveGeneration(run)
  }

  async clearRun(scope: SessionRuntimeScope, runId: string): Promise<boolean> {
    if (scope.instance.sessionId !== scope.sessionId) return false
    return await scope.instance.clearActiveGeneration(runId)
  }

  isRunCurrent(sessionId: AppSessionId | string, runId: string): boolean {
    return (
      this.ports.runtime.getHydratedScope(toAppSessionId(sessionId))?.instance.isActiveRun(runId) ??
      false
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

  async markFirstTurnReady(scope: SessionRuntimeScope, runId: string): Promise<boolean> {
    return await scope.instance.markFirstTurnReady(runId)
  }

  clearFirstTurnReady(sessionId: string): void {
    this.getHydratedScope(sessionId)?.instance.clearFirstTurnReady()
  }

  async transitionCurrentStatus(
    sessionId: string,
    status: DeepChatSessionState['status'],
    usage?: Record<string, number>
  ): Promise<boolean> {
    const scope = this.getHydratedScope(sessionId)
    return scope
      ? await this.ports.statusPublisher.transition(scope, status, { kind: 'orphan' }, usage)
      : false
  }

  async transitionStatus(
    scope: SessionRuntimeScope,
    status: DeepChatSessionState['status'],
    owner: HarnessControlOwner,
    usage?: Record<string, number>
  ): Promise<boolean> {
    return await this.ports.statusPublisher.transition(scope, status, owner, usage)
  }

  private readPendingInteractions(sessionId: string): PendingInteractionEntry[] {
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
    return pendingEntries
  }

  async refreshPendingInteractions(sessionId: string): Promise<boolean> {
    return await this.reconcilePendingInteractions(
      sessionId,
      this.readPendingInteractions(sessionId)
    )
  }

  async reconcilePendingInteractions(
    sessionId: string,
    pendingEntries: PendingInteractionEntry[]
  ): Promise<boolean> {
    const scope = this.getHydratedScope(sessionId)
    if (!scope) {
      return pendingEntries.length > 0
    }
    await scope.instance.controlReady()
    const deadline = performance.now() + 10_000
    while (true) {
      scope.assertCurrent()
      // Rebuild after readiness and rejected observations; never rebind captured entries.
      pendingEntries = this.readPendingInteractions(sessionId)
      const accepted = await scope.instance.replacePendingInteractions(
        pendingEntries.map(({ interaction }) => ({
          messageId: interaction.messageId,
          toolCallId: interaction.toolCallId,
          origin: interaction.origin,
          order: interaction.order
        })),
        undefined,
        { reconcile: true }
      )
      scope.assertCurrent()
      if (accepted) return scope.instance.hasPendingInteractions()
      if (performance.now() >= deadline)
        throw new Error('Pending interactions kept changing during reconciliation')
    }
  }

  async hasPendingInteractions(sessionId: string): Promise<boolean> {
    return await this.refreshPendingInteractions(sessionId)
  }

  async registerDeferredToolController(
    scope: SessionRuntimeScope,
    messageId: string,
    toolCallId: string,
    lease: HarnessControlLease,
    owner: HarnessControlOwner
  ): Promise<AbortController> {
    return await scope.instance.registerDeferredToolAbortController(
      messageId,
      toolCallId,
      lease,
      owner
    )
  }

  async clearDeferredToolController(
    scope: SessionRuntimeScope,
    controller: AbortController
  ): Promise<boolean> {
    return await scope.instance.clearDeferredToolAbortController(controller)
  }

  getActiveGeneration(sessionId: string): { eventId: string; runId: string } | null {
    const activeRun = this.getHydratedScope(sessionId)?.instance.getActiveGeneration()
    return activeRun ? { eventId: activeRun.messageId, runId: activeRun.runId } : null
  }

  resolveStreamRequestId(sessionId: string, messageId: string): string {
    return resolveRegistryStreamRequestId(this.ports.runtime, sessionId, messageId)
  }

  async cancel(sessionId: string): Promise<void> {
    this.ports.programmaticAuthority.revokeConversation(sessionId)
    revokeToolSurfaceDeferredDispatchesForSession(sessionId)
    const scope = this.getHydratedScope(sessionId)
    if (!scope) {
      return
    }

    const { instance } = scope
    const hasDeferredHandler = instance
      .getPendingInteractions()
      .some((interaction) => instance.hasDeferredToolAbortController(interaction.toolCallId))
    const hasAsyncSettlementOwner = Boolean(
      instance.getActiveGeneration() || instance.getAbortController() || hasDeferredHandler
    )

    instance.requestGenerationAbort()
    instance.abortDeferredToolCalls()

    if (hasAsyncSettlementOwner) {
      return
    }
    if (!instance.hasPendingInteractions()) await this.refreshPendingInteractions(sessionId)
    if (!scope.isCurrent()) return
    const pendingInteractions = instance.getPendingInteractions()
    if (pendingInteractions.length === 0) {
      // Nothing owns the turn and no approval can resume it. A session left `generating` here
      // cannot be ended by any other path, so publish the terminal state instead of reporting a
      // stop that changed nothing. An `error` session already has its terminal state; settling it
      // again would emit a second one and replace the error with `idle`.
      if (this.currentState(sessionId)?.status === 'generating') {
        await this.settleOrphanedInteraction(sessionId, null)
        this.schedulePendingInputDrain(sessionId, 'completed')
      }
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
        terminalMetadata: stampInteractionResolution(metadata, 'cancelled')
      }
    })
    for (const { messageId, terminalMetadata } of terminalMessages) {
      this.writeTerminalErrorBlock(
        sessionId,
        messageId,
        'common.error.userCanceledGeneration',
        JSON.stringify(terminalMetadata)
      )
    }
    await instance.replacePendingInteractions([])
    const primaryTerminal = terminalMessages[0]
    await this.settleInterruptedTurn(
      sessionId,
      {
        messageId: null,
        errorMessage: 'common.error.userCanceledGeneration',
        stopReason: 'user_stop',
        runId: primaryTerminal.terminalMetadata.runId,
        metadata: JSON.stringify(primaryTerminal.terminalMetadata)
      },
      { kind: 'orphan' }
    )
    this.schedulePendingInputDrain(sessionId, 'completed')
  }

  cancelScopeOperations(scope: SessionRuntimeScope): void {
    if (!scope.isCurrent()) {
      return
    }
    this.ports.programmaticAuthority.revokeConversation(scope.sessionId)
    revokeToolSurfaceDeferredDispatchesForSession(scope.sessionId)
    scope.instance.abortAndClearGeneration()
    scope.instance.abortDeferredToolCalls()
  }

  observeTerminal(sessionId: string, result: ProcessResult): void {
    this.ports.terminalObserver.observeTerminal(sessionId, this.currentState(sessionId), result)
  }

  async applyProcessResultStatus(
    sessionId: string,
    result: ProcessResult | null | undefined,
    runId?: string,
    owner: HarnessControlOwner = runId ? { kind: 'run', id: runId } : { kind: 'orphan' }
  ): Promise<void> {
    const scope = this.getHydratedScope(sessionId)
    if (!result?.status) {
      if (scope)
        await this.ports.statusPublisher.transition(scope, 'idle', owner, undefined, {
          interactions: []
        })
      return
    }
    if (result.status === 'paused') {
      if (scope)
        await this.ports.statusPublisher.transition(scope, 'generating', owner, undefined, {
          interactions: result.pendingInteractions ?? [],
          ...(result.toolBatchExecutionState ? { batch: result.toolBatchExecutionState } : {})
        })
      return
    }

    // Terminal observation describes the ended Run; Root separately authorizes current projection.
    this.observeTerminal(sessionId, result)
    if (scope)
      await this.ports.statusPublisher.transition(
        scope,
        result.status === 'error' ? 'error' : 'idle',
        owner,
        result.usage,
        { interactions: [] }
      )
  }

  async settleAbortedTurn(
    sessionId: string,
    messageId: string | null,
    runId?: string,
    metadata?: string,
    owner?: HarnessControlOwner
  ): Promise<void> {
    await this.settleInterruptedTurn(
      sessionId,
      {
        messageId,
        errorMessage: 'common.error.userCanceledGeneration',
        stopReason: 'user_stop',
        runId,
        metadata
      },
      owner
    )
  }

  /**
   * Settles a turn whose pending interaction was closed without a decision. The approval can no
   * longer resume the turn, so a session left non-idle here has no other way out: stop would be a
   * silent no-op and queued input would never drain. Declines to act while anything still owns the
   * turn, so a live run, a newer replacement operation, or another approval is never settled out
   * from under itself.
   */
  async settleOrphanedInteraction(
    sessionId: string,
    messageId: string | null,
    metadata?: string
  ): Promise<boolean> {
    const scope = this.getHydratedScope(sessionId)
    if (!scope) {
      return false
    }
    if (scope.instance.getActiveGeneration() || scope.instance.getAbortController()) {
      return false
    }

    // The caller may have closed one entry of a queue that is stale relative to the transcript.
    // Rebuild it before deciding, or another message's approval would be settled along with it.
    await this.refreshPendingInteractions(sessionId)
    if (scope.instance.getPendingInteractions().length > 0) {
      return false
    }

    return await this.settleInterruptedTurn(sessionId, {
      messageId,
      errorMessage: 'common.error.sessionInterrupted',
      stopReason: 'interaction',
      metadata
    })
  }

  private async settleInterruptedTurn(
    sessionId: string,
    input: {
      messageId: string | null
      errorMessage: string
      stopReason: string
      runId?: string
      metadata?: string
    },
    owner: HarnessControlOwner = input.runId ? { kind: 'run', id: input.runId } : { kind: 'orphan' }
  ): Promise<boolean> {
    this.writeTerminalErrorBlock(sessionId, input.messageId, input.errorMessage, input.metadata)
    const usage = input.metadata
      ? buildUsageFromMetadata(parseMessageMetadata(input.metadata))
      : undefined
    this.observeTerminal(sessionId, {
      status: 'aborted',
      stopReason: input.stopReason,
      errorMessage: input.errorMessage,
      usage
    })

    const scope = this.getHydratedScope(sessionId)
    if (scope) {
      return await this.ports.statusPublisher.transition(scope, 'idle', owner, usage)
    }
    return false
  }

  async requestPendingInputDrain(
    sessionId: string,
    reason: PendingInputWakeReason
  ): Promise<boolean> {
    return await this.ports.pendingInputWakeup.drain(sessionId, reason)
  }

  schedulePendingInputDrain(sessionId: string, reason: PendingInputWakeReason): void {
    void this.requestPendingInputDrain(sessionId, reason).catch((error) => {
      logger.error(
        `[DeepChatAgent] drainPendingQueueIfPossible error session=${sessionId} reason=${reason}`,
        redactRuntimeErrorForLog(error)
      )
    })
  }

  private currentState(sessionId: string): DeepChatSessionState | undefined {
    return this.getHydratedScope(sessionId)?.state()
  }

  private writeTerminalErrorBlock(
    sessionId: string,
    messageId: string | null,
    errorMessage: string,
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
      errorMessage
    )
    this.ports.transcript.setMessageError(messageId, blocks, metadata)
    this.ports.messageProjection.refresh(sessionId, messageId)
  }
}
