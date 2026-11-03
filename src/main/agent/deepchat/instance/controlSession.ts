import { randomUUID } from 'node:crypto'
import { createAbortError } from '../runtime/abortErrors'
import logger from '@shared/logger'
import { resolveProviderPermissionSafely } from '../runtime/providerPermissionResolution'
import { redactRuntimeErrorForLog } from '../runtime/runtimeErrorLogging'
import type { DeepChatActiveProviderPermission } from './deepChatAgentInstance'
import {
  HarnessPermissionDecisionSchema,
  HarnessBeginInputResultSchema,
  HarnessQueryInputResultSchema,
  HarnessClaimEffectGrantSchema,
  HarnessEndInputResultSchema
} from '@shared/harness/control'
import type { LoopRun } from '@/agent/deepchat/loop/loopRun'
import type { PersistedToolBatchState } from '@/agent/deepchat/loop/ports'
import type {
  HarnessControlCommand,
  HarnessAcceptanceLane,
  HarnessControlLease,
  HarnessControlLeaseTarget,
  HarnessControlOwner,
  HarnessControlPort,
  HarnessControlReceipt,
  HarnessControlScope,
  HarnessInputSnapshot,
  HarnessPendingInteraction,
  HarnessInteractionUpdate
} from '@shared/harness/control'

export interface PendingInteractionProjection {
  interactions: readonly HarnessPendingInteraction[]
  batch?: PersistedToolBatchState
  reconcile?: boolean
}

export const STALE_DEEPCHAT_INSTANCE_ERROR_NAME = 'StaleDeepChatAgentInstanceError'

export function createStaleDeepChatInstanceError(sessionId: string): Error {
  const error = new Error(`DeepChat agent instance was replaced: ${sessionId}`)
  error.name = STALE_DEEPCHAT_INSTANCE_ERROR_NAME
  return error
}

export function isStaleDeepChatInstanceError(error: unknown): boolean {
  return error instanceof Error && error.name === STALE_DEEPCHAT_INSTANCE_ERROR_NAME
}

interface ControllerHandle {
  id: string
  controller: AbortController
  detach(): void
  parentId?: string
}

export interface ProviderPermissionTakeInput {
  requestId: string
  messageId: string
  toolCallId: string
  runId: string | null
  leaseId: string
  granted: boolean
  expected?: DeepChatActiveProviderPermission
}

export type ProviderPermissionTakeResult =
  | { kind: 'callback'; permission: DeepChatActiveProviderPermission }
  | { kind: 'direct' | 'conflict' | 'spent' | 'stale' }

export class DeepChatControlSession {
  readonly id = randomUUID()
  readonly ready: Promise<void>
  private state: HarnessControlScope | undefined
  private revision = 0
  private retired = false
  private readonly controllers = new Map<string, ControllerHandle>()
  private readonly controllerIds = new WeakMap<AbortController, string>()
  private readonly deferredLeases = new WeakMap<AbortController, HarnessControlLease>()
  private readonly runs = new Map<string, LoopRun<unknown>>()
  private readonly fencedRuns = new Set<string>()
  private readonly batchContracts = new Map<
    string,
    NonNullable<PersistedToolBatchState['executionContract']>
  >()
  private readonly pendingBatches = new Set<string>()
  private readonly permissions = new Map<
    string,
    { permission: DeepChatActiveProviderPermission; runId: string }
  >()
  private readonly permissionIds = new WeakMap<DeepChatActiveProviderPermission, string>()
  private readonly detach: () => void
  private readonly detachGrants: () => void
  private readonly acceptanceWaiters = new Map<
    string,
    ReturnType<typeof Promise.withResolvers<void>>
  >()

  constructor(
    readonly sessionId: string,
    private readonly port: HarnessControlPort,
    private readonly changed: (state: HarnessControlScope | undefined, current: boolean) => void
  ) {
    if (port.closed) throw new Error('Harness control stopped')
    this.detachGrants = port.onGrant(this.id, (leaseId) => {
      if (this.current) this.acceptanceWaiters.get(leaseId)?.resolve()
    })
    this.detach = port.onClose(() => this.fenceLocal())
    this.ready = port
      .send({ method: 'open', sessionId, scopeId: this.id }, (receipt) => {
        this.receive(receipt)
      })
      .then((receipt) => {
        if (!this.current || receipt.outcome !== 'accepted') {
          throw createStaleDeepChatInstanceError(sessionId)
        }
      })
    void this.ready.catch(() => {})
  }

  get current(): boolean {
    return !this.retired && !this.port.closed && this.state?.current === true
  }

  get firstTurnReady(): boolean {
    return this.current && this.state?.firstTurnReady === true
  }

  get status(): HarnessControlScope['status'] {
    return this.state?.status ?? 'idle'
  }

  get draining(): boolean {
    return this.current && this.state?.drainLeaseId != null
  }

  get interactions(): HarnessPendingInteraction[] {
    return this.current ? (this.state?.interactions.map((entry) => ({ ...entry })) ?? []) : []
  }

  get batch(): PersistedToolBatchState | undefined {
    const state = this.current ? this.state?.batch : undefined
    if (!state) return undefined
    const executionContract = this.batchContracts.get(state.id)
    return {
      callOrder: [...state.callOrder],
      invokedCallIds: [...state.invokedCallIds],
      committedResultCallIds: [...state.committedResultCallIds],
      pendingInteractionCallIds: [...state.pendingInteractionCallIds],
      ...(executionContract ? { executionContract } : {})
    }
  }

  private projectionOwner(): HarnessControlOwner {
    return this.state?.run
      ? { kind: 'run', id: this.state.run.id }
      : this.state?.operation
        ? { kind: 'operation', id: this.state.operation.id }
        : { kind: 'orphan' }
  }

  private prepareProjection(projection: PendingInteractionProjection): {
    update: HarnessInteractionUpdate
    finish(): void
  } {
    const batch = projection.batch
    const batchId = batch && randomUUID()
    if (batchId) {
      this.pendingBatches.add(batchId)
      if (batch?.executionContract) this.batchContracts.set(batchId, batch.executionContract)
    }
    return {
      update: {
        interactions: projection.interactions.map(({ messageId, toolCallId, origin, order }) => ({
          messageId,
          toolCallId,
          origin,
          order
        })),
        ...(projection.reconcile === undefined ? {} : { reconcile: projection.reconcile }),
        ...(batch && batchId
          ? {
              batch: {
                id: batchId,
                callOrder: [...batch.callOrder],
                invokedCallIds: [...batch.invokedCallIds],
                committedResultCallIds: [...batch.committedResultCallIds],
                pendingInteractionCallIds: [...batch.pendingInteractionCallIds]
              }
            }
          : {})
      },
      finish: () => {
        if (!batchId) return
        this.pendingBatches.delete(batchId)
        if (this.state?.batch?.id !== batchId) this.batchContracts.delete(batchId)
      }
    }
  }

  async replaceInteractions(
    projection: PendingInteractionProjection,
    owner: HarnessControlOwner = this.projectionOwner()
  ): Promise<boolean> {
    const pending = this.prepareProjection(projection)
    try {
      const receipt = await this.send({
        method: 'updateInteractions',
        scopeId: this.id,
        owner,
        update: pending.update
      })
      return receipt.result === true && this.current
    } finally {
      pending.finish()
    }
  }

  async advanceBatch(
    input: { invokedCallId?: string; committedResultCallId?: string },
    owner: HarnessControlOwner = this.projectionOwner()
  ): Promise<void> {
    await this.send({
      method: 'advanceBatch',
      scopeId: this.id,
      owner,
      ...(input.invokedCallId ? { invokedCallId: input.invokedCallId } : {}),
      ...(input.committedResultCallId ? { committedResultCallId: input.committedResultCallId } : {})
    })
  }

  async transitionInteractionOrigin(
    messageId: string,
    toolCallId: string,
    origin: HarnessPendingInteraction['origin'],
    owner: HarnessControlOwner = this.projectionOwner()
  ): Promise<boolean> {
    const receipt = await this.send({
      method: 'interactionOrigin',
      scopeId: this.id,
      owner,
      messageId,
      toolCallId,
      origin
    })
    return receipt.result === true && this.current
  }

  async checkInteraction(lease: HarnessControlLease, owner: HarnessControlOwner): Promise<boolean> {
    if (lease.target.kind !== 'interaction') return false
    const receipt = await this.send({
      method: 'checkInteraction',
      scopeId: this.id,
      owner,
      leaseId: lease.id,
      messageId: lease.target.messageId,
      toolCallId: lease.target.toolCallId
    })
    return receipt.result === true && this.current
  }

  get activeSteerInputId(): string | undefined {
    return this.current ? (this.state?.input.activeSteerId ?? undefined) : undefined
  }

  async queryInput(snapshot: HarnessInputSnapshot, reason?: 'enqueue' | 'completed' | 'manual') {
    await this.ready
    let result!: ReturnType<typeof HarnessQueryInputResultSchema.parse>
    const receipt = await this.port.send(
      { method: 'queryInput', scopeId: this.id, snapshot, ...(reason ? { reason } : {}) },
      (receipt) => {
        this.receive(receipt)
        if (receipt.outcome === 'accepted')
          result = HarnessQueryInputResultSchema.parse(receipt.result)
      }
    )
    this.assertReceipt(receipt)
    return result
  }

  async beginInput(
    input: Omit<
      Extract<HarnessControlCommand, { method: 'beginInput' }>,
      'method' | 'scopeId' | 'requestId'
    >
  ) {
    await this.ready
    const requestId = randomUUID()
    let result!: ReturnType<typeof HarnessBeginInputResultSchema.parse>
    const receipt = await this.port.send(
      { method: 'beginInput', scopeId: this.id, requestId, ...input },
      (receipt) => {
        this.receive(receipt)
        if (receipt.outcome !== 'accepted') return
        result = HarnessBeginInputResultSchema.parse(receipt.result)
        const claim = result.action === 'claim' || result.action === 'prepare'
        const allowed =
          input.intent === 'enqueue'
            ? ['pending', 'claim', 'busy', 'blocked']
            : input.intent === 'drain'
              ? ['claim', 'busy', 'blocked']
              : input.intent === 'prepare'
                ? ['prepare', 'busy', 'blocked']
                : ['steer', 'busy', 'blocked']
        if (
          !allowed.includes(result.action) ||
          (!claim && result.claimId !== undefined) ||
          (!claim && result.action !== 'steer' && result.effectId !== undefined) ||
          (result.action !== 'claim' && result.drainLeaseId !== undefined) ||
          (result.consumeBeforeProviderStream && result.source !== 'queue') ||
          (result.wakeReason && (input.intent !== 'enqueue' || result.action !== 'pending'))
        )
          throw new Error('Invalid input effect decision')
        if (
          (claim &&
            (result.claimId !== requestId || result.effectId !== requestId || !result.source)) ||
          (result.action === 'claim' && result.drainLeaseId !== requestId) ||
          (result.action === 'steer' && result.effectId !== requestId) ||
          (input.intent === 'drain' && result.action === 'claim' && !result.inputId) ||
          (result.action === 'prepare' && result.inputId !== input.itemId)
        )
          throw new Error('Invalid input effect grant identity')
      }
    )
    if (!this.current && receipt.outcome === 'accepted' && result.effectId) {
      await this.ackInputEffect({
        effectId: result.effectId,
        ...(result.claimId ? { claimId: result.claimId } : {}),
        outcome: 'rejected'
      })
      if (result.drainLeaseId) await this.endInput(result.drainLeaseId)
    }
    this.assertReceipt(receipt)
    return result
  }

  async prepareClaimEffect(
    claimId: string,
    owner: HarnessControlOwner,
    action: Extract<HarnessControlCommand, { method: 'prepareClaimEffect' }>['action']
  ) {
    const effectId = randomUUID()
    let result!: ReturnType<typeof HarnessClaimEffectGrantSchema.parse>
    const receipt = await this.port.send(
      { method: 'prepareClaimEffect', scopeId: this.id, claimId, owner, action, effectId },
      (receipt) => {
        this.receive(receipt)
        if (receipt.outcome !== 'accepted') return
        result = HarnessClaimEffectGrantSchema.parse(receipt.result)
        if (result.effectId !== effectId || result.action !== action)
          throw new Error('Invalid claimed input effect identity')
      }
    )
    if (receipt.outcome !== 'accepted') throw createStaleDeepChatInstanceError(this.sessionId)
    return result
  }

  async ackInputEffect(
    input: Omit<Extract<HarnessControlCommand, { method: 'ackInputEffect' }>, 'method' | 'scopeId'>
  ): Promise<void> {
    const receipt = await this.port.send(
      { method: 'ackInputEffect', scopeId: this.id, ...input },
      (receipt) => {
        this.receive(receipt)
        if (receipt.outcome === 'accepted' && receipt.result !== true)
          throw new Error('Invalid input effect acknowledgement')
      }
    )
    if (receipt.outcome !== 'accepted') throw createStaleDeepChatInstanceError(this.sessionId)
  }

  async inputHold(
    input: Omit<Extract<HarnessControlCommand, { method: 'inputHold' }>, 'method' | 'scopeId'>
  ): Promise<boolean> {
    await this.ready
    const receipt = await this.port.send(
      { method: 'inputHold', scopeId: this.id, ...input },
      (receipt) => {
        this.receive(receipt)
        if (receipt.outcome === 'accepted' && typeof receipt.result !== 'boolean')
          throw new Error('Invalid input hold acknowledgement')
      }
    )
    return receipt.outcome === 'accepted' && receipt.result === true && this.current
  }

  async endInput(drainLeaseId: string) {
    let result = { released: false, nextWake: null } as ReturnType<
      typeof HarnessEndInputResultSchema.parse
    >
    await this.port.send({ method: 'endInput', scopeId: this.id, drainLeaseId }, (receipt) => {
      this.receive(receipt)
      if (receipt.outcome === 'accepted') result = HarnessEndInputResultSchema.parse(receipt.result)
    })
    return result
  }

  getPermission(requestId: string): DeepChatActiveProviderPermission | undefined {
    const selected = this.state?.permissions.find(
      (permission) => permission.requestId === requestId
    )
    return selected ? this.permissions.get(selected.id)?.permission : undefined
  }

  async registerDeferred(
    messageId: string,
    toolCallId: string,
    lease: HarnessControlLease,
    owner: HarnessControlOwner
  ): Promise<AbortController> {
    if (this.retired || this.port.closed) throw createStaleDeepChatInstanceError(this.sessionId)
    const parent =
      owner.kind === 'operation'
        ? this.controllers.get(owner.id)?.controller
        : owner.kind === 'run'
          ? this.runs.get(owner.id)?.abortController
          : undefined
    const parentId = parent && this.controllerIds.get(parent)
    if (!parent || !parentId) throw createStaleDeepChatInstanceError(this.sessionId)
    const handle = this.attachController(new AbortController(), parentId)
    const child: HarnessControlLease = {
      id: handle.id,
      target: { kind: 'deferred', messageId, toolCallId, parentLeaseId: lease.id, owner }
    }
    this.deferredLeases.set(handle.controller, child)
    if (parent.signal.aborted) handle.controller.abort()
    try {
      await this.ready
      const receipt = await this.send({
        method: 'acquireLease',
        scopeId: this.id,
        leaseId: child.id,
        target: child.target
      })
      if (receipt.result !== 'granted' || !this.current)
        throw createStaleDeepChatInstanceError(this.sessionId)
      if (parent.signal.aborted) handle.controller.abort()
      return handle.controller
    } catch (error) {
      handle.controller.abort()
      await this.releaseLease(child).catch(() => {})
      this.dropController(child.id)
      throw error
    }
  }

  async clearDeferred(controller: AbortController): Promise<boolean> {
    const lease = this.deferredLeases.get(controller)
    if (!lease) return false
    const cleared = await this.releaseLease(lease)
    this.dropController(lease.id)
    return cleared
  }

  hasDeferred(toolCallId: string): boolean {
    return (
      this.current &&
      this.state?.deferred.some(
        (entry) => entry.toolCallId === toolCallId && this.controllers.has(entry.id)
      ) === true
    )
  }

  abortDeferred(): void {
    void this.send({ method: 'abortDeferred', scopeId: this.id }).catch(() => {})
    const handles = [...this.controllers.values()]
    for (const handle of handles)
      if (handle.parentId) {
        handle.controller.abort()
        this.dropController(handle.id)
      }
  }

  async registerPermission(
    permission: DeepChatActiveProviderPermission,
    runId: string
  ): Promise<void> {
    if (this.retired || this.port.closed) throw createStaleDeepChatInstanceError(this.sessionId)
    const id = randomUUID()
    this.permissions.set(id, { permission, runId })
    this.permissionIds.set(permission, id)
    try {
      await this.ready
      const receipt = await this.send({
        method: 'registerPermission',
        scopeId: this.id,
        permissionId: id,
        requestId: permission.requestId,
        messageId: permission.messageId,
        toolCallId: permission.toolCallId,
        runId
      })
      if (
        receipt.result !== true ||
        !this.current ||
        this.runs.get(runId)?.abortController.signal.aborted
      ) {
        throw createStaleDeepChatInstanceError(this.sessionId)
      }
    } catch (error) {
      this.denyPermission(id)
      throw error
    }
  }

  async takePermission(input: ProviderPermissionTakeInput): Promise<ProviderPermissionTakeResult> {
    const permissionId = input.expected ? this.permissionIds.get(input.expected) : null
    if (input.expected && !permissionId) return { kind: 'conflict' }
    const decision: { kind: ProviderPermissionTakeResult['kind'] } = { kind: 'stale' }
    await this.port.send(
      {
        method: 'takePermission',
        scopeId: this.id,
        permissionId: permissionId ?? null,
        requestId: input.requestId,
        messageId: input.messageId,
        toolCallId: input.toolCallId,
        runId: input.runId,
        leaseId: input.leaseId,
        granted: input.granted,
        resolutionId: randomUUID()
      },
      (receipt) => {
        this.receive(receipt)
        if (receipt.outcome !== 'accepted') return
        decision.kind = HarnessPermissionDecisionSchema.parse(receipt.result)
        if (decision.kind === 'callback' && permissionId) this.permissions.delete(permissionId)
      }
    )
    if (
      !this.current ||
      (input.runId && this.runs.get(input.runId)?.abortController.signal.aborted)
    ) {
      return { kind: 'stale' }
    }
    const { kind } = decision
    if (kind === 'callback' && input.expected) return { kind, permission: input.expected }
    if (kind === 'callback') throw new Error('Rust permission grant has no callback handle')
    return { kind }
  }

  private denyPermission(id: string): void {
    const handle = this.permissions.get(id)
    if (!handle) return
    this.permissions.delete(id)
    void resolveProviderPermissionSafely(() => handle.permission.resolve(false)).catch((error) => {
      logger.warn(
        '[DeepChatAgent] Failed to cancel ACP permission:',
        redactRuntimeErrorForLog(error)
      )
    })
  }

  private denyPermissions(runId?: string): void {
    const handles = [...this.permissions]
    for (const [id, handle] of handles)
      if (!runId || handle.runId === runId) this.denyPermission(id)
  }

  async acquireAcceptance(
    lane: HarnessAcceptanceLane,
    signal?: AbortSignal
  ): Promise<() => Promise<void>> {
    if (signal?.aborted) throw createAbortError()
    const leaseId = randomUUID()
    const granted = Promise.withResolvers<void>()
    void granted.promise.catch(() => {})
    this.acceptanceWaiters.set(leaseId, granted)
    const abort = () => granted.reject(createAbortError())
    signal?.addEventListener('abort', abort, { once: true })
    let submitted = false
    let released = false
    const release = async () => {
      if (released || !submitted) return
      released = true
      await this.send({ method: 'releaseAcceptance', scopeId: this.id, lane, leaseId })
    }
    try {
      await Promise.race([this.ready, granted.promise])
      if (!this.current) throw createStaleDeepChatInstanceError(this.sessionId)
      if (signal?.aborted) throw createAbortError()
      submitted = true
      const receipt = await this.send({
        method: 'queueAcceptance',
        scopeId: this.id,
        lane,
        leaseId
      })
      if (receipt.result === 'granted') granted.resolve()
      else if (receipt.result !== 'queued') throw createStaleDeepChatInstanceError(this.sessionId)
      await granted.promise
      if (!this.current) throw createStaleDeepChatInstanceError(this.sessionId)
      if (signal?.aborted) throw createAbortError()
      return release
    } catch (error) {
      await release().catch(() => {})
      throw error
    } finally {
      signal?.removeEventListener('abort', abort)
      this.acceptanceWaiters.delete(leaseId)
    }
  }

  async acquireLease(
    target: HarnessControlLeaseTarget
  ): Promise<HarnessControlLease | 'parked' | null> {
    await this.ready
    if (!this.current) return null
    const lease = { id: randomUUID(), target }
    const receipt = await this.send({
      method: 'acquireLease',
      scopeId: this.id,
      leaseId: lease.id,
      target
    })
    if (receipt.result === 'granted') {
      if (this.current) return lease
      await this.releaseLease(lease)
      return null
    }
    return receipt.result === 'parked' ? 'parked' : null
  }

  async releaseLease(lease: HarnessControlLease): Promise<boolean> {
    const receipt = await this.send({
      method: 'releaseLease',
      scopeId: this.id,
      leaseId: lease.id,
      target: lease.target
    })
    return receipt.result === true
  }

  async parkInteraction(lease: HarnessControlLease): Promise<void> {
    if (lease.target.kind !== 'interaction') throw new Error('Expected interaction lease')
    const receipt = await this.send({
      method: 'parkInteraction',
      scopeId: this.id,
      leaseId: lease.id,
      messageId: lease.target.messageId,
      toolCallId: lease.target.toolCallId
    })
    if (receipt.result !== true) throw createStaleDeepChatInstanceError(this.sessionId)
  }

  get controller(): AbortController | undefined {
    const id = this.state?.operation?.id
    return id ? this.controllers.get(id)?.controller : undefined
  }

  get run(): LoopRun<unknown> | undefined {
    const id = this.state?.run?.id
    return id ? this.runs.get(id) : undefined
  }

  isRunCurrent(id: string): boolean {
    return this.current && this.state?.run?.id === id && !this.fencedRuns.has(id)
  }

  owner(controller: AbortController): { kind: 'operation'; id: string } {
    const id = this.controllerIds.get(controller)
    if (!id) throw new Error('Operation controller has no Rust control identity')
    return { kind: 'operation', id }
  }

  async prepareOperation(): Promise<AbortController> {
    if (this.retired || this.port.closed) throw createStaleDeepChatInstanceError(this.sessionId)
    const handle = this.attachController(new AbortController())
    await this.ready
    const receipt = await this.port.transition(
      { method: 'prepareOperation', scopeId: this.id, operationId: handle.id },
      (receipt) => {
        this.receive(receipt)
        return handle.controller.signal.aborted
      }
    )
    this.assertReceipt(receipt)
    const operationId = (receipt.result as { operationId?: string } | null)?.operationId
    const controller = operationId ? this.controllers.get(operationId)?.controller : undefined
    if (!controller) throw new Error('Rust control grant has no local controller')
    if (controller !== handle.controller) this.dropController(handle.id)
    return controller
  }

  async registerRun<T>(run: LoopRun<T>): Promise<LoopRun<T>> {
    if (this.retired || this.port.closed) throw createStaleDeepChatInstanceError(this.sessionId)
    const handle = this.attachController(run.abortController)
    this.runs.set(run.runId, run)
    await this.ready
    const receipt = await this.port.transition(
      {
        method: 'prepareRun',
        scopeId: this.id,
        operationId: handle.id,
        runId: run.runId,
        messageId: run.messageId
      },
      (receipt) => {
        this.receive(receipt)
        return run.abortController.signal.aborted
      }
    )
    this.assertReceipt(receipt)
    return run
  }

  async clearController(
    controller: AbortController,
    settled?: () => void,
    origin?: { operationId: string; runId?: string }
  ): Promise<boolean> {
    const id = origin?.operationId ?? this.controllerIds.get(controller)
    if (!id) return false
    const receipt = await this.port.send(
      { method: 'clearOperation', scopeId: this.id, operationId: id, runId: origin?.runId ?? null },
      (receipt) => {
        this.receive(receipt)
        if ((receipt.result as { settles?: boolean } | null)?.settles === true && this.current)
          settled?.()
      }
    )
    const cleared = (receipt.result as { cleared?: boolean } | null)?.cleared === true
    if (cleared || id !== this.state?.operation?.id) this.dropController(id)
    return cleared
  }

  async clearRun(runId: string): Promise<boolean> {
    const run = this.runs.get(runId)
    const receipt = await this.send({ method: 'clearRun', scopeId: this.id, runId })
    if (receipt.result === true || !this.isRunCurrent(runId)) {
      this.runs.delete(runId)
      this.fencedRuns.delete(runId)
      const id = run && this.controllerIds.get(run.abortController)
      if (id && id !== this.state?.operation?.id) this.dropController(id)
    }
    return receipt.result === true
  }

  abort(): void {
    void this.send({ method: 'abort', scopeId: this.id }).catch(() => {})
    // Abort listeners can create new work; cancel only the handles present at the request.
    const handles = [...this.controllers.values()]
    for (const handle of handles) handle.controller.abort()
    this.denyPermissions()
  }

  async setStatus(
    owner: HarnessControlOwner,
    status: HarnessControlScope['status'],
    interactions?: PendingInteractionProjection
  ): Promise<{ previousStatus: HarnessControlScope['status'] } | undefined> {
    let previousStatus = this.status
    const pending = interactions && this.prepareProjection(interactions)
    try {
      const receipt = await this.port.send(
        {
          method: 'status',
          scopeId: this.id,
          owner,
          status,
          ...(pending ? { interactions: pending.update } : {})
        },
        (receipt) => {
          previousStatus = this.status
          this.receive(receipt)
        }
      )
      return receipt.result === true && this.current && receipt.revision === this.revision
        ? { previousStatus }
        : undefined
    } finally {
      pending?.finish()
    }
  }

  async markReady(runId: string): Promise<boolean> {
    const receipt = await this.send({ method: 'ready', scopeId: this.id, runId })
    return receipt.result === true
  }

  async clearReady(): Promise<void> {
    await this.send({ method: 'clearReady', scopeId: this.id })
  }

  retire(): void {
    void this.send({ method: 'retire', scopeId: this.id }).catch(() => {})
    this.fenceLocal()
    this.detach()
  }

  release(): void {
    void this.send({ method: 'release', scopeId: this.id }).catch(() => {})
    this.fenceLocal()
    this.detach()
  }

  private send(command: HarnessControlCommand): Promise<HarnessControlReceipt> {
    return this.port.send(command, (receipt) => this.receive(receipt))
  }

  private attachController(controller: AbortController, parentId?: string): ControllerHandle {
    const existing = this.controllerIds.get(controller)
    if (existing) {
      const handle = this.controllers.get(existing)
      if (handle) return handle
    }
    const id = randomUUID()
    const aborted = () => {
      if (parentId) return
      void this.send({ method: 'operationAborted', scopeId: this.id, operationId: id }).catch(
        () => {}
      )
      const children = [...this.controllers.values()]
      for (const child of children) if (child.parentId === id) child.controller.abort()
      if (this.state?.run?.operationId === id) this.denyPermissions(this.state.run.id)
    }
    const handle = {
      id,
      parentId,
      controller,
      detach: () => controller.signal.removeEventListener('abort', aborted)
    }
    this.controllerIds.set(controller, id)
    this.controllers.set(id, handle)
    controller.signal.addEventListener('abort', aborted, { once: true })
    return handle
  }

  private dropController(id: string): void {
    this.controllers.get(id)?.detach()
    this.controllers.delete(id)
  }

  private receive(receipt: HarnessControlReceipt): void {
    if (receipt.scope?.id === this.id && receipt.revision >= this.revision) {
      const previousBatch = this.state?.batch?.id
      this.revision = receipt.revision
      this.state = receipt.scope
      if (
        previousBatch &&
        previousBatch !== this.state.batch?.id &&
        !this.pendingBatches.has(previousBatch)
      )
        this.batchContracts.delete(previousBatch)
      this.changed(this.state, this.current)
    }
    for (const fence of receipt.fences) {
      if (fence.kind === 'scope' && fence.id === this.id) this.fenceLocal()
      else if (fence.kind === 'operation') this.controllers.get(fence.id)?.controller.abort()
      else if (fence.kind === 'run') this.fencedRuns.add(fence.id)
      else if (fence.kind === 'permission') this.denyPermission(fence.id)
    }
    for (const id of this.fencedRuns) if (id !== this.state?.run?.id) this.fencedRuns.delete(id)
  }

  private assertReceipt(receipt: HarnessControlReceipt): void {
    if (!this.current || receipt.outcome === 'stale') {
      throw createStaleDeepChatInstanceError(this.sessionId)
    }
  }

  private fenceLocal(): void {
    this.retired = true
    this.batchContracts.clear()
    this.pendingBatches.clear()
    for (const waiter of this.acceptanceWaiters.values())
      waiter.reject(createStaleDeepChatInstanceError(this.sessionId))
    this.acceptanceWaiters.clear()
    this.detachGrants()
    this.denyPermissions()
    for (const handle of this.controllers.values()) handle.controller.abort()
    for (const id of this.runs.keys()) this.fencedRuns.add(id)
    this.changed(this.state, this.current)
  }
}
