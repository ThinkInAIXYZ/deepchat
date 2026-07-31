import type { AcpAgentConfig, AcpAgentInstallState } from '@shared/types/acp'
import type {
  MessageStartResult,
  PendingSessionInputRecord,
  SendMessageInput
} from '@shared/types/agent-interface'
import type { AcpAgentDescriptor } from '@/agent/shared/agentDescriptors'
import type { AppSessionId } from '@/agent/shared/agentSessionIds'
import type { AcpClientRuntime, AcpRuntimeOwner } from '@/agent/acp/client'
import type { SessionPendingInputRuntimePort } from '@/session/data/contracts'
import { AcpAgentInstance, type AcpAgentInstanceDependencies } from './acpAgentInstance'
import type { AcpAgentSnapshot, AcpInstanceScope } from './ports'

export interface AcpAgentRuntimeSessionInput {
  sessionId: AppSessionId
  descriptor: AcpAgentDescriptor
  agent: AcpAgentConfig
  scope: AcpInstanceScope
  workdir: string
}

export type AcpAgentInstanceDependencyFactory = (input: {
  runtime: AcpClientRuntime
  session: AcpAgentRuntimeSessionInput
}) => Omit<
  AcpAgentInstanceDependencies,
  'sessions' | 'promptController' | 'onProcessExit' | 'onClosed'
>

interface RuntimeEntry {
  identity: string
  agentId: string
  instance: AcpAgentInstance
}

interface HydrationEntry {
  promise: Promise<AcpAgentInstance>
}

function toRuntimeInstallState(
  installState: AcpAgentInstallState | null | undefined
): AcpAgentInstallState | null | undefined {
  if (!installState) return installState
  const identity = { ...installState }
  delete identity.installedAt
  delete identity.lastCheckedAt
  return identity
}

export class AcpAgentRuntime {
  private readonly instances = new Map<AppSessionId, RuntimeEntry>()
  private readonly hydrations = new Map<AppSessionId, HydrationEntry>()
  private readonly operations = new Map<AppSessionId, Set<Promise<unknown>>>()
  private readonly draining = new Set<AppSessionId>()
  private readonly steering = new Set<AppSessionId>()
  private readonly detachOwnerLifecycle: () => void
  private accepting = true
  private closeAllPromise?: Promise<void>

  constructor(
    private readonly owner: AcpRuntimeOwner,
    private readonly createDependencies: AcpAgentInstanceDependencyFactory,
    private readonly pendingInputs: SessionPendingInputRuntimePort
  ) {
    this.detachOwnerLifecycle = owner.registerDirectRuntime({
      closeAll: () => this.closeAll(),
      closeByAgent: (agentId) => this.closeByAgent(agentId)
    })
  }

  async getOrHydrate(input: AcpAgentRuntimeSessionInput): Promise<AcpAgentInstance> {
    this.assertAccepting()
    this.assertInput(input)
    const previous = this.hydrations.get(input.sessionId)?.promise
    const hydration = (async () => {
      if (previous) {
        try {
          await previous
        } catch {
          // A later hydration still gets an independent attempt after the prior one settles.
        }
      }
      this.assertAccepting()
      return await this.hydrateNow(input)
    })()
    const entry = { promise: hydration }
    this.hydrations.set(input.sessionId, entry)
    try {
      return await hydration
    } finally {
      if (this.hydrations.get(input.sessionId) === entry) {
        this.hydrations.delete(input.sessionId)
      }
    }
  }

  private async hydrateNow(input: AcpAgentRuntimeSessionInput): Promise<AcpAgentInstance> {
    const identity = this.buildIdentity(input)
    const current = this.instances.get(input.sessionId)
    if (current?.identity === identity) {
      if (current.instance.getWorkdir() !== input.workdir) {
        await current.instance.updateWorkdir(input.workdir)
        this.assertAccepting()
      }
      return current.instance
    }
    if (current) {
      throw new Error(`ACP session identity mismatch for ${input.sessionId}`)
    }

    const runtime = this.owner.getOrCreate()
    let instance: AcpAgentInstance
    instance = new AcpAgentInstance(
      {
        sessionId: input.sessionId,
        agent: input.agent,
        workdir: input.workdir,
        scope: input.scope
      },
      {
        ...this.createDependencies({ runtime, session: input }),
        sessions: runtime.sessionController,
        promptController: runtime.promptController,
        onProcessExit: (exited) => this.evictOnProcessExit(input.sessionId, exited),
        onClosed: (closed) => this.evictClosed(input.sessionId, closed)
      }
    )
    this.instances.set(input.sessionId, {
      identity,
      agentId: input.descriptor.id,
      instance
    })
    return instance
  }

  getHydrated(sessionId: AppSessionId): AcpAgentInstance | undefined {
    return this.instances.get(sessionId)?.instance
  }

  async prepare(input: AcpAgentRuntimeSessionInput): Promise<AcpAgentInstance> {
    const instance = await this.getOrHydrate(input)
    this.assertAccepting()
    const operation = (async () => {
      try {
        await instance.prepare()
        if (this.pendingInputs.hasPendingTurnInput(input.sessionId)) {
          void this.drainPendingInputs(input.sessionId, 'completed')
        }
        return instance
      } catch (error) {
        try {
          await instance.close()
        } catch (closeError) {
          console.warn('[ACP] Failed to close instance after preparation error:', closeError)
        }
        throw error
      }
    })()
    return await this.trackOperation(input.sessionId, operation)
  }

  async send(
    input: AcpAgentRuntimeSessionInput,
    content: SendMessageInput
  ): Promise<MessageStartResult> {
    const instance = await this.getOrHydrate(input)
    this.assertAccepting()
    const operation = (async () => {
      try {
        return await instance.send(content)
      } finally {
        if (this.pendingInputs.hasPendingTurnInput(input.sessionId)) {
          void this.drainPendingInputs(input.sessionId, 'completed')
        }
      }
    })()
    return await this.trackOperation(input.sessionId, operation)
  }

  async cancel(sessionId: AppSessionId): Promise<void> {
    await this.instances.get(sessionId)?.instance.cancel()
  }

  async close(sessionId: AppSessionId): Promise<void> {
    await this.instances.get(sessionId)?.instance.close()
  }

  async cleanupSession(sessionId: AppSessionId): Promise<void> {
    let instance = this.instances.get(sessionId)?.instance
    if (!instance) {
      try {
        instance = await this.hydrations.get(sessionId)?.promise
      } catch {
        // Failed hydration leaves no live instance to close.
      }
    }
    try {
      if (instance) {
        await instance.close()
      } else {
        await this.owner.peek()?.sessionController.clear(sessionId)
      }
    } finally {
      const current = this.instances.get(sessionId)
      if (!instance || current?.instance === instance) this.instances.delete(sessionId)
      this.draining.delete(sessionId)
      this.steering.delete(sessionId)
    }
  }

  async closeByAgent(agentId: string): Promise<void> {
    await Promise.allSettled(Array.from(this.hydrations.values(), (entry) => entry.promise))
    const instances = Array.from(this.instances.values())
      .filter((entry) => entry.agentId === agentId)
      .map((entry) => entry.instance)
    await Promise.allSettled(instances.map((instance) => instance.close()))
  }

  async closeAll(): Promise<void> {
    if (this.closeAllPromise) return await this.closeAllPromise
    this.accepting = false
    this.closeAllPromise = (async () => {
      await this.closeInstances()
      await Promise.allSettled(Array.from(this.hydrations.values(), ({ promise }) => promise))
      await this.closeInstances()
      await Promise.allSettled(
        Array.from(this.operations.values()).flatMap((operations) => [...operations])
      )
      const instances = Array.from(this.instances.values(), (entry) => entry.instance)
      await Promise.allSettled(instances.map((instance) => instance.close()))
      this.instances.clear()
      this.draining.clear()
      this.steering.clear()
    })()
    return await this.closeAllPromise
  }

  dispose(): void {
    this.accepting = false
    this.detachOwnerLifecycle()
  }

  listPendingInputs(sessionId: AppSessionId): PendingSessionInputRecord[] {
    return this.pendingInputs.listPendingInputs(sessionId)
  }

  async resumePendingInputs(input: AcpAgentRuntimeSessionInput): Promise<boolean> {
    await this.getOrHydrate(input)
    return await this.drainPendingInputs(input.sessionId, 'enqueue')
  }

  async queuePendingInput(
    input: AcpAgentRuntimeSessionInput,
    content: SendMessageInput
  ): Promise<PendingSessionInputRecord> {
    const instance = await this.getOrHydrate(input)
    this.assertAccepting()
    const pending = this.pendingInputs
    const snapshot = await instance.snapshot()
    const claimImmediately =
      !snapshot.active &&
      snapshot.status !== 'initializing' &&
      snapshot.status !== 'closed' &&
      !this.draining.has(input.sessionId) &&
      !pending.hasPendingTurnInput(input.sessionId)
    const record = pending.queuePendingInput(input.sessionId, content, {
      state: claimImmediately ? 'claimed' : 'pending'
    })
    if (claimImmediately) {
      this.draining.add(input.sessionId)
      this.startClaimedInput(input.sessionId, instance, pending, record)
    } else {
      void this.drainPendingInputs(input.sessionId, 'enqueue')
    }
    return record
  }

  async steer(input: AcpAgentRuntimeSessionInput, content: SendMessageInput) {
    const instance = await this.getOrHydrate(input)
    this.assertAccepting()
    const snapshot = await instance.snapshot()
    if (snapshot.status === 'initializing') {
      throw new Error('Wait for the assistant response to start before steering.')
    }
    const pending = this.pendingInputs
    const existingSteer = pending.getNextSteerInput(input.sessionId)
    const accepted = pending.acceptSteerMessage(input.sessionId, content, {
      mergeItemId: existingSteer?.id ?? null,
      ...(snapshot.active && !instance.getActiveGeneration()
        ? { preStreamAnchorMessageId: null }
        : {})
    })
    const handoff = (async () => {
      if (snapshot.active) await instance.cancel('pending_input')
      await this.drainPendingInputs(input.sessionId, 'enqueue')
    })()
    void this.trackOperation(input.sessionId, handoff).catch((error) => {
      console.error('[ACP] Steer handoff failed:', error)
    })
    return accepted
  }

  updateQueuedInput(
    sessionId: AppSessionId,
    itemId: string,
    content: SendMessageInput
  ): PendingSessionInputRecord {
    return this.pendingInputs.updateQueuedInput(sessionId, itemId, content)
  }

  moveQueuedInput(
    sessionId: AppSessionId,
    itemId: string,
    toIndex: number
  ): PendingSessionInputRecord[] {
    return this.pendingInputs.moveQueuedInput(sessionId, itemId, toIndex)
  }

  async steerPendingInput(
    sessionId: AppSessionId,
    itemId: string
  ): Promise<PendingSessionInputRecord> {
    const pending = this.pendingInputs
    const instance = this.instances.get(sessionId)?.instance
    if (!instance) {
      throw new Error(`ACP session ${sessionId} is not initialized`)
    }
    const snapshot: AcpAgentSnapshot = await instance.snapshot()
    if (snapshot.status === 'initializing') {
      throw new Error('Wait for the assistant response to start before steering.')
    }
    const record = pending.promoteQueuedInputToSteerMessage(
      sessionId,
      itemId,
      snapshot.active && !instance.getActiveGeneration()
        ? { preStreamAnchorMessageId: null }
        : undefined
    ).pendingInput
    let activeOperations: Promise<unknown>[] = []
    try {
      if (snapshot.active || this.draining.has(sessionId)) {
        this.steering.add(sessionId)
        activeOperations = this.getOperations(sessionId)
        if (snapshot.active) await instance.cancel('pending_input')
        await Promise.allSettled(activeOperations)
      }
    } finally {
      this.steering.delete(sessionId)
    }
    const started = await this.drainPendingInputs(sessionId, 'enqueue')
    if (!started) {
      void this.drainPendingInputs(sessionId, 'enqueue')
    }
    return record
  }

  deletePendingInput(sessionId: AppSessionId, itemId: string): void {
    this.pendingInputs.deletePendingInput(sessionId, itemId)
  }

  private async drainPendingInputs(
    sessionId: AppSessionId,
    reason: 'enqueue' | 'completed'
  ): Promise<boolean> {
    if (!this.accepting || this.draining.has(sessionId) || this.steering.has(sessionId))
      return false
    const instance = this.instances.get(sessionId)?.instance
    const pending = this.pendingInputs
    if (!instance) return false
    const snapshot = await instance.snapshot()
    if (
      snapshot.active ||
      snapshot.status === 'initializing' ||
      snapshot.status === 'closed' ||
      (snapshot.status === 'error' && reason === 'completed')
    ) {
      return false
    }

    const nextSteer = pending.getNextSteerInput(sessionId)
    const nextQueue = nextSteer ? null : pending.getNextQueuedInput(sessionId)
    const next = nextSteer ?? nextQueue
    if (!next) return false

    this.draining.add(sessionId)
    let claimed: PendingSessionInputRecord
    try {
      claimed = nextSteer
        ? pending.claimSteerInput(sessionId, next.id)
        : pending.claimQueuedInput(sessionId, next.id)
    } catch (error) {
      this.draining.delete(sessionId)
      throw error
    }

    this.startClaimedInput(sessionId, instance, pending, claimed)
    return true
  }

  private startClaimedInput(
    sessionId: AppSessionId,
    instance: AcpAgentInstance,
    pending: SessionPendingInputRuntimePort,
    claimed: PendingSessionInputRecord
  ): void {
    const projectionContext =
      claimed.mode === 'steer'
        ? {
            userMessageIds: claimed.messageIds,
            assistantMessageId: claimed.assistantMessageId!
          }
        : undefined
    const operation = instance
      .send(claimed.payload, projectionContext)
      .then(async () => {
        const completed = await instance.snapshot()
        if (claimed.mode === 'steer') {
          pending.consumeSteerInput(sessionId, claimed.id)
        } else if (completed.status === 'error') {
          pending.releaseClaimedInput(sessionId, claimed.id)
        } else {
          pending.consumeQueuedInput(sessionId, claimed.id)
        }
      })
      .catch((error) => {
        if (claimed.mode === 'steer') {
          pending.consumeSteerInput(sessionId, claimed.id)
        } else {
          pending.releaseClaimedInput(sessionId, claimed.id)
        }
        console.error('[ACP] Pending input failed:', error)
      })
      .finally(() => {
        this.draining.delete(sessionId)
        if (pending.hasPendingTurnInput(sessionId)) {
          void this.drainPendingInputs(sessionId, 'completed')
        }
      })
    void this.trackOperation(sessionId, operation)
  }

  private trackOperation<T>(sessionId: AppSessionId, operation: Promise<T>): Promise<T> {
    let operations = this.operations.get(sessionId)
    if (!operations) {
      operations = new Set()
      this.operations.set(sessionId, operations)
    }
    operations.add(operation)
    const remove = () => {
      operations?.delete(operation)
      if (operations?.size === 0) this.operations.delete(sessionId)
    }
    operation.then(remove, remove)
    return operation
  }

  private getOperations(sessionId: AppSessionId): Promise<unknown>[] {
    return [...(this.operations.get(sessionId) ?? [])]
  }

  private async closeInstances(): Promise<void> {
    const instances = Array.from(this.instances.values(), (entry) => entry.instance)
    await Promise.allSettled(instances.map((instance) => instance.close()))
  }

  private evictOnProcessExit(sessionId: AppSessionId, instance: AcpAgentInstance): void {
    const current = this.instances.get(sessionId)
    if (current?.instance === instance) this.instances.delete(sessionId)
  }

  private evictClosed(sessionId: AppSessionId, instance: AcpAgentInstance): void {
    const current = this.instances.get(sessionId)
    if (current?.instance === instance) this.instances.delete(sessionId)
  }

  private buildIdentity(input: AcpAgentRuntimeSessionInput): string {
    const descriptor =
      input.descriptor.source === 'registry'
        ? {
            ...input.descriptor,
            installState: toRuntimeInstallState(input.descriptor.installState)
          }
        : input.descriptor
    return JSON.stringify({
      descriptor,
      agent: {
        ...input.agent,
        installState: toRuntimeInstallState(input.agent.installState)
      },
      scope: input.scope
    })
  }

  private assertInput(input: AcpAgentRuntimeSessionInput): void {
    if (!input.sessionId.trim()) {
      throw new Error('ACP session id is required')
    }
    if (input.descriptor.kind !== 'acp') {
      throw new Error(`Agent "${input.descriptor.id}" is not an ACP descriptor`)
    }
    if (input.descriptor.id !== input.agent.id) {
      throw new Error(`ACP descriptor/config mismatch: ${input.descriptor.id} != ${input.agent.id}`)
    }
    if (input.descriptor.source !== input.agent.source || !input.agent.command.trim()) {
      throw new Error(`ACP descriptor/config mismatch for agent "${input.descriptor.id}"`)
    }
    if (input.scope !== 'regular' && input.scope !== 'subagent') {
      throw new Error(`Invalid ACP session scope: ${String(input.scope)}`)
    }
  }

  private assertAccepting(): void {
    if (!this.accepting) throw new Error('[ACP] Direct runtime is closed')
  }
}
