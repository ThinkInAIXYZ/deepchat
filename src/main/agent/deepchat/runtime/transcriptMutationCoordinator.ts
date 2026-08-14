import { toAppSessionId } from '@/agent/shared/agentSessionIds'
import type { SessionScopeRegistry } from '@/agent/deepchat/instance/deepChatAgentRuntime'
import type { MemoryRuntimeCoordinator } from '@/agent/deepchat/memory/memoryRuntimeCoordinator'
import type { CompactionRuntimeCoordinator } from './compactionRuntimeCoordinator'
import type { PendingInputAdmissionCoordinator } from './pendingInputAdmissionCoordinator'
import type { RunLifecycleCoordinator } from './runLifecycleCoordinator'
import type { SessionSettingsCoordinator } from './sessionSettingsCoordinator'
import type { SessionStateResolver } from './sessionStateResolver'
import type { ToolSurfaceShadowDiagnosticsRegistryPort } from './toolSurfaceDiagnostics'

export interface TranscriptMutationCoordinatorDependencies {
  registry: SessionScopeRegistry
  sessionState: Pick<SessionStateResolver, 'get'>
  sessionSettings: Pick<SessionSettingsCoordinator, 'resolveProjectDir'>
  admission: Pick<PendingInputAdmissionCoordinator, 'assertNoActiveInputs'>
  compaction: Pick<CompactionRuntimeCoordinator, 'reset' | 'invalidateIfNeeded'>
  memory: Pick<
    MemoryRuntimeCoordinator,
    'resetExtractionCursor' | 'clearProjectionRetry' | 'invalidateFromOrderSeq'
  >
  runLifecycle: Pick<
    RunLifecycleCoordinator,
    | 'assertCurrentInstance'
    | 'cancel'
    | 'clearFirstTurnReady'
    | 'hasPendingInteractions'
    | 'refreshPendingInteractions'
    | 'scopeFor'
    | 'transitionCurrentStatus'
    | 'transitionStatus'
  >
  toolSurfaceDiagnostics: Pick<ToolSurfaceShadowDiagnosticsRegistryPort, 'cancelPending'>
}

export class TranscriptMutationCoordinator {
  constructor(private readonly deps: TranscriptMutationCoordinatorDependencies) {}

  async prepareClearMessages(sessionId: string): Promise<void> {
    const instance = this.deps.registry.getOrHydrateScope(toAppSessionId(sessionId)).instance
    const state = await this.deps.sessionState.get(sessionId)
    if (!state) {
      throw new Error(`Session ${sessionId} not found`)
    }
    this.deps.runLifecycle.assertCurrentInstance(sessionId, instance)

    try {
      this.deps.toolSurfaceDiagnostics.cancelPending(instance)
    } catch {}
    await this.deps.runLifecycle.cancel(sessionId)
    this.deps.runLifecycle.assertCurrentInstance(sessionId, instance)
    this.deps.runLifecycle.clearFirstTurnReady(sessionId)
    this.deps.memory.resetExtractionCursor(sessionId)
    this.deps.memory.clearProjectionRetry(sessionId)
  }

  finishClearMessages(sessionId: string): void {
    const instance = this.deps.registry.getOrHydrateScope(toAppSessionId(sessionId)).instance
    instance.replacePendingInteractions([])
    this.deps.compaction.reset(sessionId, instance)
    this.deps.runLifecycle.transitionStatus(
      this.deps.runLifecycle.scopeFor(sessionId, instance),
      'idle'
    )
  }

  async prepareRetry(
    sessionId: string,
    options?: { allowRestartHeldQueue?: boolean }
  ): Promise<{ projectDir: string | null }> {
    const instance = this.deps.registry.getOrHydrateScope(toAppSessionId(sessionId)).instance
    const state = await this.deps.sessionState.get(sessionId)
    if (!state) {
      throw new Error(`Session ${sessionId} not found`)
    }
    this.deps.runLifecycle.assertCurrentInstance(sessionId, instance)
    if (state.status === 'generating') {
      throw new Error('Cannot retry while session is generating.')
    }
    if (this.deps.runLifecycle.hasPendingInteractions(sessionId)) {
      throw new Error('Please resolve pending tool interactions before retrying.')
    }
    this.deps.admission.assertNoActiveInputs(sessionId, options)
    this.deps.runLifecycle.assertCurrentInstance(sessionId, instance)
    return {
      projectDir: this.deps.sessionSettings.resolveProjectDir(sessionId, undefined, instance)
    }
  }

  async cancelForTranscriptMutation(sessionId: string): Promise<void> {
    const instance = this.deps.registry.getOrHydrateScope(toAppSessionId(sessionId)).instance
    try {
      this.deps.toolSurfaceDiagnostics.cancelPending(instance)
    } catch {}
    await this.deps.runLifecycle.cancel(sessionId)
    this.deps.runLifecycle.assertCurrentInstance(sessionId, instance)
  }

  invalidateTranscriptFrom(sessionId: string, orderSeq: number): void {
    const instance = this.deps.registry.getOrHydrateScope(toAppSessionId(sessionId)).instance
    this.deps.compaction.invalidateIfNeeded(sessionId, orderSeq, instance)
    this.deps.memory.invalidateFromOrderSeq(sessionId, orderSeq)
  }

  finishTranscriptTruncate(sessionId: string): void {
    this.deps.runLifecycle.refreshPendingInteractions(sessionId)
    this.deps.runLifecycle.transitionCurrentStatus(sessionId, 'idle')
  }

  resetForkTarget(targetSessionId: string): void {
    const targetInstance = this.deps.registry.getOrHydrateScope(toAppSessionId(targetSessionId)).instance
    this.deps.compaction.reset(targetSessionId, targetInstance)
  }

  assertNoActivePendingInputs(sessionId: string): void {
    this.deps.admission.assertNoActiveInputs(sessionId)
  }
}
