import type {
  DeepChatSessionState,
  MessageStartResult,
  PendingSessionInputRecord,
  PermissionMode,
  QueuePendingInputOptions,
  SendMessageInput,
  SessionAgentContextUpdate,
  SessionCompactionSnapshot,
  SessionCompactionState,
  SessionContextOccupancySnapshot,
  SessionGenerationSettings,
  ToolInteractionResponse,
  ToolInteractionResult
} from '@shared/types/agent-interface'
import type { AcpAgentInstanceDependencyFactory } from '@/agent/acp/instance'
import type { DeepChatAgentRuntime } from '@/agent/deepchat/instance/deepChatAgentRuntime'
import type { MemoryIngestionObserver } from '@/agent/deepchat/memory/memoryIngestionObserver'
import { resolveDeepChatToolProfileKind } from '@/agent/deepchat/runtime/toolResolver'
import type { ToolSurfaceShadowDiagnosticsSnapshot } from '@/agent/deepchat/runtime/toolSurfaceDiagnostics'
import type { ToolSurfaceCanaryDiagnosticsSnapshot } from '@/agent/deepchat/runtime/toolSurfaceCanaryDiagnostics'
import type { TurnStartContext } from '@/agent/deepchat/runtime/turnCoordinator'
import type { AgentSessionSendInput } from '@/agent/shared/agentSessionHandle'
import { toAppSessionId } from '@/agent/shared/agentSessionIds'
import type { DeepChatAgentBackendPort } from '@/agent/manager/deepChatAgentBackend'
import type { SessionStatePort } from '@/session/data/contracts'
import type { SessionTranscriptRuntimePort } from '@/session/transcriptMutations'
import type { DeepChatRuntimeServices } from './runtimeServices'

/**
 * Public boundary of the DeepChat agent runtime. Every method delegates to exactly one owner; the
 * harness holds no phase, queue, cache, subscription, or derived fact of its own.
 */
export class DeepChatAgentHarness
  implements DeepChatAgentBackendPort, SessionStatePort, SessionTranscriptRuntimePort
{
  constructor(private readonly services: DeepChatRuntimeServices) {}

  get deepChatRuntime(): DeepChatAgentRuntime {
    return this.services.runtime
  }

  get memoryIngestionObserver(): MemoryIngestionObserver {
    return this.services.memoryIngestionObserver
  }

  /** Current-lineage main-process diagnostics only; no renderer or public IPC route exposes this. */
  getToolSurfaceShadowDiagnostics(sessionId: string): ToolSurfaceShadowDiagnosticsSnapshot | null {
    const scope = this.services.runtime.getHydratedScope(toAppSessionId(sessionId))
    const state = scope?.state()
    if (!scope || !state) return null
    return this.services.toolSurfaceDiagnostics.snapshot({
      instance: scope.instance,
      scope: {
        sessionId,
        providerId: state.providerId,
        modelId: state.modelId,
        toolProfile: resolveDeepChatToolProfileKind(scope.instance.getProjectDir())
      }
    })
  }

  /** Bounded actual-adapter canary metrics; no renderer or public IPC route exposes this. */
  getToolSurfaceCanaryDiagnostics(sessionId: string): ToolSurfaceCanaryDiagnosticsSnapshot | null {
    const state = this.services.runtime.getHydratedScope(toAppSessionId(sessionId))?.state()
    if (!state) return null
    return this.services.toolSurfaceCanaryDiagnostics.snapshot({
      providerId: state.providerId,
      modelId: state.modelId
    })
  }

  refreshToolRegistry(): void {
    this.services.runtime.markToolRegistryChanged()
  }

  readonly reconcileAfterDatabaseReopen = (): void => this.services.reconcileAfterDatabaseReopen()

  createAcpAgentInstanceDependencies(
    input: Parameters<AcpAgentInstanceDependencyFactory>[0]
  ): ReturnType<AcpAgentInstanceDependencyFactory> {
    return this.services.acpCompatibility(input)
  }

  initSession(
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
    return this.services.sessionLifecycle.init(sessionId, config)
  }

  destroySession(sessionId: string): Promise<void> {
    return this.services.sessionLifecycle.destroy(sessionId)
  }

  cleanupSession(sessionId: string): Promise<void> {
    return this.services.sessionLifecycle.cleanup(sessionId)
  }

  async getSessionState(sessionId: string): Promise<DeepChatSessionState | null> {
    return await this.services.sessionState.get(sessionId)
  }

  async getSessionListState(sessionId: string): Promise<DeepChatSessionState | null> {
    return await this.services.sessionState.getSummary(sessionId)
  }

  async waitForFirstTurnReady(
    sessionId: string,
    options?: { timeoutMs?: number }
  ): Promise<boolean> {
    return await this.services.runtime
      .getOrHydrateScope(toAppSessionId(sessionId))
      .instance.waitForFirstTurnReady(options)
  }

  async send(sessionId: string, input: AgentSessionSendInput): Promise<MessageStartResult> {
    if (input.queue) {
      return await this.services.pendingInputAdmission.sendQueuedMessage(
        sessionId,
        input.content,
        input.queue,
        input.context
      )
    }
    return await this.processMessage(sessionId, input.content, input.context)
  }

  async processMessage(
    sessionId: string,
    content: string | SendMessageInput,
    context?: TurnStartContext
  ): Promise<MessageStartResult> {
    const input = typeof content === 'string' ? { text: content, files: [] } : content
    const completion = await this.services.turnCoordinator.start(sessionId, input, context)
    return completion.messageStart
  }

  async listPendingInputs(sessionId: string): Promise<PendingSessionInputRecord[]> {
    return this.services.pendingInputAdmission.list(sessionId)
  }

  async isPendingQueueResumeAvailable(sessionId: string): Promise<boolean> {
    return this.services.pendingInputAdmission.isPendingQueueResumeAvailable(sessionId)
  }

  async resumePendingQueue(sessionId: string): Promise<boolean> {
    return await this.services.pendingInputAdmission.resumePendingQueue(sessionId)
  }

  async retryPendingQueueInput(
    sessionId: string,
    itemId: string
  ): Promise<{ accepted: boolean; started: boolean }> {
    return await this.services.pendingInputAdmission.retryPendingQueueInput(sessionId, itemId)
  }

  async queuePendingInput(
    sessionId: string,
    content: string | SendMessageInput,
    options?: QueuePendingInputOptions
  ): Promise<PendingSessionInputRecord> {
    return await this.services.pendingInputAdmission.queue(sessionId, content, options)
  }

  async steerActiveTurn(
    sessionId: string,
    content: string | SendMessageInput,
    options?: { signal?: AbortSignal }
  ): Promise<MessageStartResult> {
    return await this.services.pendingInputAdmission.steerActiveTurn(sessionId, content, options)
  }

  async updateQueuedInput(
    sessionId: string,
    itemId: string,
    content: string | SendMessageInput
  ): Promise<PendingSessionInputRecord> {
    return await this.services.pendingInputAdmission.updateQueuedInput(sessionId, itemId, content)
  }

  async moveQueuedInput(
    sessionId: string,
    itemId: string,
    toIndex: number
  ): Promise<PendingSessionInputRecord[]> {
    return await this.services.pendingInputAdmission.moveQueuedInput(sessionId, itemId, toIndex)
  }

  async steerPendingInput(sessionId: string, itemId: string): Promise<PendingSessionInputRecord> {
    return await this.services.pendingInputAdmission.steerPendingInput(sessionId, itemId)
  }

  async deletePendingInput(sessionId: string, itemId: string): Promise<void> {
    await this.services.pendingInputAdmission.deletePendingInput(sessionId, itemId)
  }

  async resolveBlockedPendingInput(
    sessionId: string,
    itemId: string,
    action: 'retry' | 'send_without_image_content'
  ): Promise<PendingSessionInputRecord> {
    return await this.services.pendingInputAdmission.resolveBlockedPendingInput(
      sessionId,
      itemId,
      action
    )
  }

  async respondToolInteraction(
    sessionId: string,
    messageId: string,
    toolCallId: string,
    response: ToolInteractionResponse
  ): Promise<ToolInteractionResult> {
    return await this.services.interactionCoordinator.respond(
      sessionId,
      messageId,
      toolCallId,
      response
    )
  }

  readonly dismissToolInteraction = (
    sessionId: string,
    messageId: string,
    toolCallId: string
  ): Promise<boolean> =>
    this.services.interactionCoordinator.dismiss(sessionId, messageId, toolCallId)

  async setPermissionMode(sessionId: string, mode: PermissionMode): Promise<void> {
    await this.services.sessionSettings.setPermissionMode(sessionId, mode)
  }

  async setSessionModel(sessionId: string, providerId: string, modelId: string): Promise<void> {
    await this.services.sessionSettings.setModel(sessionId, providerId, modelId)
  }

  async setSessionAgentContext(
    sessionId: string,
    config: SessionAgentContextUpdate
  ): Promise<void> {
    await this.services.sessionSettings.setAgentContext(sessionId, config)
  }

  async setSessionProjectDir(sessionId: string, projectDir: string | null): Promise<void> {
    this.services.sessionSettings.setProjectDir(sessionId, projectDir)
  }

  async getPermissionMode(sessionId: string): Promise<PermissionMode> {
    return this.services.sessionSettings.getPermissionMode(sessionId)
  }

  async getGenerationSettings(sessionId: string): Promise<SessionGenerationSettings | null> {
    return await this.services.sessionSettings.getGenerationSettings(sessionId)
  }

  async updateGenerationSettings(
    sessionId: string,
    settings: Partial<SessionGenerationSettings>
  ): Promise<SessionGenerationSettings> {
    return await this.services.sessionSettings.updateGenerationSettings(sessionId, settings)
  }

  async applyTurnExecutionSnapshot(
    sessionId: string,
    snapshot: {
      providerId: string
      modelId: string
      generationSettings: SessionGenerationSettings
    }
  ): Promise<void> {
    await this.services.sessionSettings.applyTurnExecutionSnapshot(sessionId, snapshot)
  }

  async cancelGeneration(sessionId: string): Promise<void> {
    const instance = this.services.runtime.getHydratedScope(toAppSessionId(sessionId))?.instance
    if (instance)
      try {
        this.services.toolSurfaceDiagnostics.cancelPending(instance)
      } catch {}
    await this.services.runLifecycle.cancel(sessionId)
  }

  getActiveGeneration(sessionId: string): { eventId: string; runId: string } | null {
    return this.services.runLifecycle.getActiveGeneration(sessionId)
  }

  async cancelGenerationByEventId(sessionId: string, eventId: string): Promise<boolean> {
    if (this.services.runLifecycle.getActiveGeneration(sessionId)?.eventId !== eventId) return false
    await this.cancelGeneration(sessionId)
    return true
  }

  async getSessionCompactionSnapshot(sessionId: string): Promise<SessionCompactionSnapshot> {
    return await this.services.compaction.getSnapshot(sessionId)
  }

  async getSessionContextOccupancy(sessionId: string): Promise<SessionContextOccupancySnapshot> {
    return await this.services.contextOccupancy.getSnapshot(sessionId)
  }

  async compactSession(
    sessionId: string
  ): Promise<{ compacted: boolean; state: SessionCompactionState }> {
    return await this.services.compaction.compact(sessionId)
  }

  prepareClearMessages(sessionId: string): Promise<void> {
    return this.services.transcriptMutation.prepareClearMessages(sessionId)
  }

  finishClearMessages(sessionId: string): void {
    this.services.transcriptMutation.finishClearMessages(sessionId)
  }

  prepareRetry(
    sessionId: string,
    options?: { allowRestartHeldQueue?: boolean }
  ): Promise<{ projectDir: string | null }> {
    return this.services.transcriptMutation.prepareRetry(sessionId, options)
  }

  cancelForTranscriptMutation(sessionId: string): Promise<void> {
    return this.services.transcriptMutation.cancelForTranscriptMutation(sessionId)
  }

  invalidateTranscriptFrom(sessionId: string, orderSeq: number): void {
    this.services.transcriptMutation.invalidateTranscriptFrom(sessionId, orderSeq)
  }

  finishTranscriptTruncate(sessionId: string): void {
    this.services.transcriptMutation.finishTranscriptTruncate(sessionId)
  }

  resetForkTarget(targetSessionId: string): void {
    this.services.transcriptMutation.resetForkTarget(targetSessionId)
  }

  assertNoActivePendingInputs(sessionId: string): void {
    this.services.transcriptMutation.assertNoActivePendingInputs(sessionId)
  }
}
