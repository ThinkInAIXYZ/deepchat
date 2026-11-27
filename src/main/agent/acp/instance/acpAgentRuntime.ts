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
import type { AcpSessionOpenOptions } from '@/agent/acp/runtime'
import { AcpAgentInstance, type AcpAgentInstanceDependencies } from './acpAgentInstance'
import type { AcpAgentSnapshot, AcpInstanceScope } from './ports'
import { isAcpAuthenticationRequiredError } from '../runtime/acpAuthentication'
import { SessionBusyError } from '@/session/turn'

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
  private readonly pendingOpenOptions = new Map<
    string,
    { sessionId: AppSessionId; options: AcpSessionOpenOptions }
  >()
  private readonly submissionItems = new Map<string, { sessionId: AppSessionId; itemId: string }>()
  private readonly detachOwnerLifecycle: () => void
  private accepting = true
  private closeAllPromise?: Promise<void>

  constructor(
    private readonly owner: AcpRuntimeOwner,
    private readonly createDependencies: AcpAgentInstanceDependencyFactory,
    private readonly pendingInputs: SessionPendingInputRuntimePort,
    private readonly onSessionIdle?: (sessionId: AppSessionId) => void
  ) {
    this.detachOwnerLifecycle = owner.registerDirectRuntime({
      closeAll: () => this.closeAll(),
      closeByAgent: (agentId) => this.closeByAgent(agentId)
    })
  }

  async getOrHydrate(
    input: AcpAgentRuntimeSessionInput,
    openOptions?: AcpSessionOpenOptions
  ): Promise<AcpAgentInstance> {
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
      return await this.hydrateNow(input, openOptions)
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

  private async hydrateNow(
    input: AcpAgentRuntimeSessionInput,
    openOptions?: AcpSessionOpenOptions
  ): Promise<AcpAgentInstance> {
    const identity = this.buildIdentity(input)
    const current = this.instances.get(input.sessionId)
    if (current?.identity === identity) {
      if (current.instance.getWorkdir() !== input.workdir) {
        await current.instance.updateWorkdir(input.workdir, openOptions)
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

  async prepare(
    input: AcpAgentRuntimeSessionInput,
    openOptions?: AcpSessionOpenOptions
  ): Promise<AcpAgentInstance> {
    if (openOptions?.requireIdle && (await this.isBusy(input.sessionId))) {
      throw new SessionBusyError(input.sessionId)
    }
    const instance = await this.getOrHydrate(input, openOptions)
    this.assertAccepting()
    if (openOptions?.requireIdle && (await this.isBusy(input.sessionId))) {
      throw new SessionBusyError(input.sessionId)
    }
    const operation = (async () => {
      try {
        await instance.prepare(openOptions)
        if (this.pendingInputs.hasPendingTurnInput(input.sessionId)) {
          void this.drainPendingInputs(input.sessionId, 'completed').then((started) => {
            if (!started) void this.notifyIdleIfReady(input.sessionId)
          })
        } else {
          void this.notifyIdleIfReady(input.sessionId)
        }
        return instance
      } catch (error) {
        if (isAcpAuthenticationRequiredError(error)) throw error
        if (
          openOptions?.requireIdle &&
          error instanceof Error &&
          /already (?:generating|preparing)/.test(error.message)
        ) {
          throw new SessionBusyError(input.sessionId)
        }
        try {
          await instance.close()
        } catch (closeError) {
          console.warn('[ACP] Failed to close instance after preparation error:', closeError)
        }
        void this.notifyIdleIfReady(input.sessionId)
        throw error
      }
    })()
    return await this.trackOperation(input.sessionId, operation)
  }

  async send(
    input: AcpAgentRuntimeSessionInput,
    content: SendMessageInput,
    openOptions?: AcpSessionOpenOptions
  ): Promise<MessageStartResult> {
    if (openOptions?.requireIdle && (await this.isBusy(input.sessionId))) {
      throw new SessionBusyError(input.sessionId)
    }
    const instance = await this.getOrHydrate(input, openOptions)
    this.assertAccepting()
    if (openOptions?.requireIdle && (await this.isBusy(input.sessionId))) {
      throw new SessionBusyError(input.sessionId)
    }
    const operation = (async () => {
      try {
        return await instance.send(content, undefined, openOptions)
      } catch (error) {
        if (
          openOptions?.requireIdle &&
          error instanceof Error &&
          error.message.includes('is already generating')
        ) {
          throw new SessionBusyError(input.sessionId)
        }
        throw error
      } finally {
        if (this.pendingInputs.hasPendingTurnInput(input.sessionId)) {
          void this.drainPendingInputs(input.sessionId, 'completed').then((started) => {
            if (!started) void this.notifyIdleIfReady(input.sessionId)
          })
        } else {
          void this.notifyIdleIfReady(input.sessionId)
        }
      }
    })()
    return await this.trackOperation(input.sessionId, operation)
  }

  async isBusy(sessionId: AppSessionId): Promise<boolean> {
    if (
      this.draining.has(sessionId) ||
      this.steering.has(sessionId) ||
      this.pendingInputs.hasPendingTurnInput(sessionId)
    ) {
      return true
    }
    const instance = this.instances.get(sessionId)?.instance
    if (!instance) return false
    const snapshot = await instance.snapshot()
    return (
      snapshot.active ||
      snapshot.remoteOperation === true ||
      snapshot.status === 'generating' ||
      snapshot.status === 'initializing'
    )
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
      for (const [submissionId, entry] of this.submissionItems) {
        if (entry.sessionId === sessionId) this.submissionItems.delete(submissionId)
      }
      for (const [itemId, entry] of this.pendingOpenOptions) {
        if (entry.sessionId === sessionId) this.pendingOpenOptions.delete(itemId)
      }
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
      this.pendingOpenOptions.clear()
      this.submissionItems.clear()
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
    content: SendMessageInput,
    openOptions?: AcpSessionOpenOptions
  ): Promise<PendingSessionInputRecord> {
    const instance = await this.getOrHydrate(input, openOptions)
    this.assertAccepting()
    const pending = this.pendingInputs
    const snapshot = await instance.snapshot()
    const claimImmediately =
      !snapshot.active &&
      snapshot.remoteOperation !== true &&
      snapshot.status !== 'initializing' &&
      snapshot.status !== 'closed' &&
      !this.draining.has(input.sessionId) &&
      !this.steering.has(input.sessionId) &&
      !pending.hasPendingTurnInput(input.sessionId)
    if (!claimImmediately && openOptions?.requireIdle) {
      throw new SessionBusyError(input.sessionId)
    }
    const record = pending.queuePendingInput(input.sessionId, content, {
      state: claimImmediately ? 'claimed' : 'pending'
    })
    if (openOptions) {
      this.pendingOpenOptions.set(record.id, { sessionId: input.sessionId, options: openOptions })
      if (openOptions.submissionId) {
        this.submissionItems.set(openOptions.submissionId, {
          sessionId: input.sessionId,
          itemId: record.id
        })
      }
    }
    if (claimImmediately) {
      this.draining.add(input.sessionId)
      this.startClaimedInput(input.sessionId, instance, pending, record)
    } else {
      void this.drainPendingInputs(input.sessionId, 'enqueue')
    }
    return record
  }

  async readHistory(sessionId: AppSessionId) {
    const instance = this.instances.get(sessionId)?.instance
    if (!instance) throw new Error('ACP session is not initialized')
    return this.trackOperation(
      sessionId,
      instance
        .runIdleOperation(() => this.owner.getOrCreate().sessionController.readHistory(sessionId))
        .finally(() => {
          if (this.pendingInputs.hasPendingTurnInput(sessionId)) {
            void this.drainPendingInputs(sessionId, 'completed').then((started) => {
              if (!started) void this.notifyIdleIfReady(sessionId)
            })
          } else {
            void this.notifyIdleIfReady(sessionId)
          }
        })
    )
  }

  async forkSession(
    sourceId: AppSessionId,
    targetId: AppSessionId,
    turnId: string,
    operationId: string
  ) {
    const instance = this.instances.get(sourceId)?.instance
    if (!instance) throw new Error('ACP session is not initialized')
    return this.trackOperation(
      sourceId,
      instance
        .runIdleOperation(() =>
          this.owner
            .getOrCreate()
            .sessionController.forkSession(sourceId, targetId, turnId, operationId)
        )
        .finally(() => {
          if (this.pendingInputs.hasPendingTurnInput(sourceId)) {
            void this.drainPendingInputs(sourceId, 'completed').then((started) => {
              if (!started) void this.notifyIdleIfReady(sourceId)
            })
          } else {
            void this.notifyIdleIfReady(sourceId)
          }
        })
    )
  }

  async controlGoal(
    sessionId: AppSessionId,
    action: 'set' | 'resume' | 'pause' | 'clear',
    objective?: string
  ): Promise<void> {
    const instance = this.instances.get(sessionId)?.instance
    if (!instance) throw new Error('ACP session is not initialized')
    instance.assertGoalAction(action, objective)
    if (action === 'pause' || action === 'clear') {
      await instance.controlGoal(action)
      return
    }
    const operation = instance.controlGoal(action, objective).finally(() => {
      if (this.pendingInputs.hasPendingTurnInput(sessionId)) {
        void this.drainPendingInputs(sessionId, 'completed').then((started) => {
          if (!started) void this.notifyIdleIfReady(sessionId)
        })
      } else {
        void this.notifyIdleIfReady(sessionId)
      }
    })
    void this.trackOperation(sessionId, operation).catch(() =>
      console.warn('[ACP] Goal prompt failed')
    )
  }

  private injectSteer(
    sessionId: AppSessionId,
    instance: AcpAgentInstance,
    record: PendingSessionInputRecord
  ): void {
    const generation = instance.getActiveGeneration()
    if (!generation) throw new Error('ACP active turn is unavailable')
    this.pendingInputs.claimSteerInput(sessionId, record.id, {
      activeAssistantMessageId: generation.eventId
    })
    const operation = instance
      .steer(record.payload, record.id, (outcome) =>
        this.pendingInputs.settleSteerInputReceipt(sessionId, record.id, outcome)
      )
      .catch(() => this.pendingInputs.settleSteerInputReceipt(sessionId, record.id, 'unknown'))
    void this.trackOperation(sessionId, operation)
  }

  async steer(input: AcpAgentRuntimeSessionInput, content: SendMessageInput) {
    const instance = await this.getOrHydrate(input)
    this.assertAccepting()
    const snapshot = await instance.snapshot()
    if (snapshot.status === 'initializing') {
      throw new Error('Wait for the assistant response to start before steering.')
    }
    const pending = this.pendingInputs
    if (snapshot.active && instance.canSteer()) {
      const accepted = pending.acceptSteerMessage(input.sessionId, content)
      this.injectSteer(input.sessionId, instance, accepted.pendingInput)
      return accepted
    }
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
    if (snapshot.active && instance.canSteer()) {
      this.injectSteer(sessionId, instance, record)
      return record
    }
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
    const openOptions = this.pendingOpenOptions.get(itemId)?.options
    this.pendingOpenOptions.delete(itemId)
    if (openOptions?.submissionId) {
      this.submissionItems.delete(openOptions.submissionId)
    }
    this.pendingInputs.deletePendingInput(sessionId, itemId)
    void this.notifyIdleIfReady(sessionId)
  }

  async cancelSubmission(sessionId: AppSessionId, submissionId: string): Promise<boolean> {
    const instance = this.instances.get(sessionId)?.instance
    if (instance && (await instance.cancelGenerationBySubmissionId(submissionId))) {
      return true
    }
    const tracked = this.submissionItems.get(submissionId)
    if (!tracked || tracked.sessionId !== sessionId) return false
    const pendingItem = this.pendingInputs
      .listPendingInputs(sessionId)
      .find((item) => item.id === tracked.itemId)
    if (pendingItem && pendingItem.state === 'pending') {
      this.deletePendingInput(sessionId, tracked.itemId)
      return true
    }
    return false
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
      snapshot.remoteOperation === true ||
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
    const openOptions = this.pendingOpenOptions.get(claimed.id)?.options
    this.pendingOpenOptions.delete(claimed.id)
    let releasedOnBusy = false
    const operation = instance
      .send(claimed.payload, projectionContext, openOptions)
      .then(async () => {
        const completed = await instance.snapshot()
        if (claimed.mode === 'steer') {
          pending.consumeSteerInput(sessionId, claimed.id)
        } else if (completed.status === 'error') {
          if (openOptions?.discardOnFailure) {
            pending.consumeQueuedInput(sessionId, claimed.id)
          } else {
            pending.releaseClaimedInput(sessionId, claimed.id)
          }
        } else {
          pending.consumeQueuedInput(sessionId, claimed.id)
        }
      })
      .catch((error) => {
        const busyRejection =
          error instanceof SessionBusyError ||
          (error instanceof Error &&
            (error.message.includes('already generating') ||
              error.message.includes('busy with another operation')))
        if (claimed.mode === 'steer') {
          pending.consumeSteerInput(sessionId, claimed.id)
        } else if (busyRejection && !openOptions?.requireIdle) {
          releasedOnBusy = true
          if (openOptions) {
            this.pendingOpenOptions.set(claimed.id, { sessionId, options: openOptions })
          }
          pending.releaseClaimedInput(sessionId, claimed.id)
        } else if (openOptions?.discardOnFailure || (busyRejection && openOptions?.requireIdle)) {
          pending.consumeQueuedInput(sessionId, claimed.id)
        } else {
          pending.releaseClaimedInput(sessionId, claimed.id)
        }
        console.error('[ACP] Pending input failed:', error)
      })
      .finally(() => {
        if (!releasedOnBusy && openOptions?.submissionId) {
          this.submissionItems.delete(openOptions.submissionId)
        }
        this.draining.delete(sessionId)
        if (pending.hasPendingTurnInput(sessionId)) {
          void this.drainPendingInputs(sessionId, 'completed').then((started) => {
            if (!started) void this.notifyIdleIfReady(sessionId)
          })
        } else {
          void this.notifyIdleIfReady(sessionId)
        }
      })
    void this.trackOperation(sessionId, operation)
  }

  private async notifyIdleIfReady(sessionId: AppSessionId): Promise<void> {
    if (!this.onSessionIdle || !this.accepting) return
    if (await this.isBusy(sessionId)) return
    this.onSessionIdle(sessionId)
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
