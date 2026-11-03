import logger from '@shared/logger'
import type {
  HarnessControlOwner,
  HarnessControlPort,
  HarnessInputSnapshot,
  HarnessBeginInputResult,
  HarnessClaimEffectGrant
} from '@shared/harness/control'
import { createAbortError } from './abortErrors'
import type {
  DeepChatSessionState,
  PendingInputEnqueueSource,
  PendingSessionInputRecord,
  SendMessageInput
} from '@shared/types/agent-interface'
import type { SessionRuntimeScope } from '@/agent/deepchat/instance/deepChatAgentRuntime'
import type { SessionPendingInputs } from '@/session/data/pendingInputs'
import type { SessionTranscript } from '@/session/data/transcript'
import {
  collectPendingInteractionEntries,
  parseAssistantBlocks,
  type PendingInteractionEntry
} from './interactionProjection'
import type { PendingInputWakeReason } from './runLifecycleCoordinator'
import type { RunLifecycleCoordinator } from './runLifecycleCoordinator'
import { redactRuntimeErrorForLog } from './runtimeErrorLogging'
import type { SessionSettingsCoordinator } from './sessionSettingsCoordinator'
import type {
  ClaimedInputDisposition,
  ClaimedInputSettlementResult,
  ClaimedPendingInputHandle,
  PendingInputTurnSource,
  TurnCompletion
} from './pendingInputContracts'

export type PendingInputPumpStorePort = Pick<
  SessionPendingInputs,
  | 'updateQueuedInput'
  | 'promoteQueuedInputToSteerMessage'
  | 'acceptSteerMessage'
  | 'queuePendingInput'
  | 'blockClaimedInput'
  | 'claimQueuedInput'
  | 'claimSteerInput'
  | 'consumeQueuedInput'
  | 'consumeSteerInput'
  | 'getInput'
  | 'hasBlockingInput'
  | 'hasClaimedInput'
  | 'listPendingInputs'
  | 'releaseClaimedInput'
  | 'releaseClaimedQueueInput'
  | 'releaseClaimedQueueInputForRetry'
>

type PendingInputPumpLifecyclePort = Pick<
  RunLifecycleCoordinator,
  'getHydratedScope' | 'reconcilePendingInteractions'
>

interface PendingInputGateSnapshot {
  awaitingQuestionFollowUp: boolean
  pendingInteractions: PendingInteractionEntry[]
}

export interface PendingInputTurnStarter {
  start(
    sessionId: string,
    content: SendMessageInput,
    context: PendingInputTurnContext
  ): Promise<TurnCompletion>
}

export interface PendingInputTurnContext {
  projectDir: string | null
  claimedInput: ClaimedPendingInputHandle
  consumeClaimBeforeProviderStream: boolean
}

export interface PendingInputPumpPorts {
  control: HarnessControlPort
  pendingInputs: PendingInputPumpStorePort
  transcript: Pick<SessionTranscript, 'getMessages'>
  runLifecycle: PendingInputPumpLifecyclePort
  turnStarter: PendingInputTurnStarter
  sessionSettings: Pick<SessionSettingsCoordinator, 'resolveProjectDir'>
}

class DurablePendingInputClaim implements ClaimedPendingInputHandle {
  private owner: HarnessControlOwner = { kind: 'orphan' }
  private controller?: AbortController
  private terminalProjection: ClaimedInputDisposition | null = null
  private pendingOutcome: Promise<void> = Promise.resolve()
  private prepared?: HarnessClaimEffectGrant & { attempted: boolean; revoked: boolean }
  private fenced = false

  constructor(
    private readonly pendingInputs: PendingInputPumpStorePort,
    private readonly scope: SessionRuntimeScope,
    private readonly claimId: string,
    readonly id: string,
    readonly source: PendingInputTurnSource,
    private readonly onTerminal: () => void
  ) {}

  get sessionId(): string {
    return this.scope.sessionId
  }

  get disposition(): ClaimedInputDisposition | null {
    return this.terminalProjection
  }
  get messageIds(): string[] {
    return this.requireRecord().messageIds
  }
  get assistantMessageId(): string | null {
    return this.requireRecord().assistantMessageId
  }

  bindOwner(controller: AbortController, owner: HarnessControlOwner): void {
    this.controller = controller
    this.owner = owner
  }

  async flushEffects(): Promise<void> {
    await this.pendingOutcome
  }

  fence(): void {
    this.fenced = true
    this.controller?.abort()
    const ticket = this.prepared
    if (ticket && !ticket.attempted && !ticket.revoked) {
      ticket.revoked = true
      this.pendingOutcome = this.pendingOutcome.then(() =>
        this.scope.instance.ackInputEffect({
          claimId: this.claimId,
          effectId: ticket.effectId,
          outcome: 'rejected'
        })
      )
      void this.pendingOutcome.catch(() => {})
    }
  }

  async prepareUserFact(): Promise<(effect: () => string) => string> {
    const ticket = await this.prepare('user-fact')
    return (effect) => this.perform(ticket, effect)
  }

  async prepareConsume(): Promise<() => void> {
    const ticket = await this.prepare('consume')
    return () => {
      this.perform(ticket, () => this.apply({ kind: 'consume' }), { kind: 'consume' })
    }
  }

  async rollback(effect: () => void): Promise<void> {
    const ticket = await this.prepare('rollback')
    this.perform(ticket, effect)
    await this.flushEffects()
  }

  async settle<TDisposition extends ClaimedInputDisposition>(
    disposition: TDisposition
  ): Promise<ClaimedInputSettlementResult<TDisposition>> {
    const ticket = await this.prepare(disposition.kind)
    let value: PendingSessionInputRecord | null
    try {
      value = this.perform(ticket, () => this.apply(disposition), disposition)
    } catch (error) {
      await this.flushEffects().catch((ackError) => this.logAckError(ackError))
      throw error
    }
    await this.flushEffects()
    return value as ClaimedInputSettlementResult<TDisposition>
  }

  private async prepare(action: HarnessClaimEffectGrant['action']) {
    await this.flushEffects()
    if (this.fenced || this.scope.instance.inputEffectsFenced)
      throw new Error('Input effect owner was retired')
    if (this.terminalProjection) throw new Error(`Pending input ${this.id} is already settled.`)
    if (this.prepared && !this.prepared.attempted && !this.prepared.revoked) {
      this.prepared.revoked = true
      await this.scope.instance.ackInputEffect({
        claimId: this.claimId,
        effectId: this.prepared.effectId,
        outcome: 'rejected'
      })
    }
    const grant = await this.scope.instance.prepareClaimEffect(this.claimId, this.owner, action)
    const ticket = { ...grant, attempted: false, revoked: false }
    if (this.fenced || this.scope.instance.inputEffectsFenced) {
      await this.scope.instance.ackInputEffect({
        claimId: this.claimId,
        effectId: grant.effectId,
        outcome: 'rejected'
      })
      throw new Error('Input effect owner was retired')
    }
    this.prepared = ticket
    return ticket
  }

  private perform<T>(
    ticket: NonNullable<DurablePendingInputClaim['prepared']>,
    effect: () => T,
    disposition?: ClaimedInputDisposition
  ): T {
    if (this.fenced || this.scope.instance.inputEffectsFenced || ticket.attempted || ticket.revoked)
      throw new Error(`Pending input effect is already spent: ${this.id}`)
    let attempted = false
    let outcome: 'applied' | 'rejected' | 'unknown' = 'rejected'
    let value: T | undefined
    let appliedMessageId: string | undefined
    try {
      if (
        ticket.action === 'user-fact' ||
        ticket.action === 'rollback' ||
        ticket.action === 'block' ||
        ticket.action === 'release-for-mutation'
      ) {
        this.scope.assertCurrent()
        if (ticket.action === 'user-fact' && this.controller?.signal.aborted)
          throw createAbortError()
      }
      this.assertClaimed()
      ticket.attempted = true
      attempted = true
      value = effect()
      if (ticket.action === 'user-fact' && typeof value === 'string') appliedMessageId = value
      outcome = 'applied'
      return value
    } catch (error) {
      if (attempted) {
        try {
          if (disposition) outcome = this.settlementOutcome(disposition)
          else if (ticket.action === 'user-fact') {
            appliedMessageId = this.requireRecord().messageIds.at(-1)
            outcome = appliedMessageId ? 'applied' : 'rejected'
          } else outcome = 'unknown'
        } catch (verificationError) {
          outcome = 'unknown'
          logger.warn(
            `[DeepChatAgent] failed to verify input effect item=${this.id}`,
            redactRuntimeErrorForLog(verificationError)
          )
        }
      }
      throw error
    } finally {
      ticket.revoked = true
      // A spent or indeterminate effect only narrows the already granted Root ticket.
      if (disposition && outcome !== 'rejected') this.terminalProjection = disposition
      const acknowledgement = this.scope.instance.ackInputEffect({
        claimId: this.claimId,
        effectId: ticket.effectId,
        outcome,
        ...(appliedMessageId ? { messageId: appliedMessageId } : {})
      })
      this.pendingOutcome = acknowledgement.then(() => {
        if (disposition && outcome !== 'rejected') this.onTerminal()
      })
      void this.pendingOutcome.catch(() => {})
      void acknowledgement.catch(() => {})
    }
  }

  private logAckError(error: unknown): void {
    logger.warn(
      `[DeepChatAgent] input effect acknowledgement failed item=${this.id}`,
      redactRuntimeErrorForLog(error)
    )
  }

  private apply(disposition: ClaimedInputDisposition): PendingSessionInputRecord | null {
    const sessionId = this.scope.sessionId
    switch (disposition.kind) {
      case 'consume':
        if (this.source === 'steer') this.pendingInputs.consumeSteerInput(sessionId, this.id)
        else this.pendingInputs.consumeQueuedInput(sessionId, this.id)
        return null
      case 'block':
        return this.pendingInputs.blockClaimedInput(
          sessionId,
          this.id,
          disposition.attachmentPreparation
        )
      case 'release-for-mutation':
        return this.source === 'steer'
          ? this.pendingInputs.releaseClaimedInput(sessionId, this.id)
          : this.pendingInputs.releaseClaimedQueueInput(sessionId, this.id)
      case 'release-before-user-fact':
      case 'release-after-rollback':
        return this.source === 'steer'
          ? this.pendingInputs.releaseClaimedInput(sessionId, this.id)
          : this.pendingInputs.releaseClaimedQueueInputForRetry(sessionId, this.id)
    }
  }

  private assertClaimed(): void {
    const record = this.requireRecord()
    if (record.mode !== (this.source === 'steer' ? 'steer' : 'queue') || record.state !== 'claimed')
      throw new Error(`Pending input ${this.id} is not the originating claimed input.`)
  }

  private requireRecord(): PendingSessionInputRecord {
    const record = this.pendingInputs.getInput(this.scope.sessionId, this.id)
    if (!record) throw new Error(`Pending input not found: ${this.id}`)
    return record
  }

  private settlementOutcome(
    disposition: ClaimedInputDisposition
  ): 'applied' | 'rejected' | 'unknown' {
    const record = this.pendingInputs.getInput(this.scope.sessionId, this.id)
    const expectedMode = this.source === 'steer' ? 'steer' : 'queue'
    let applied: boolean
    switch (disposition.kind) {
      case 'consume':
        applied =
          this.source === 'steer'
            ? record?.mode === expectedMode && record.state === 'consumed'
            : record === null
        break
      case 'block':
        applied = record?.mode === expectedMode && record.state === 'blocked'
        break
      case 'release-for-mutation':
        applied = record?.mode === expectedMode && record.state === 'pending'
        break
      case 'release-before-user-fact':
      case 'release-after-rollback':
        applied =
          record?.mode === expectedMode &&
          record.state === (this.source === 'queue' ? 'retry_required' : 'pending')
        break
    }
    if (applied) return 'applied'
    return record?.mode === expectedMode && record.state === 'claimed' ? 'rejected' : 'unknown'
  }
}

export class PendingInputPump {
  private recovery: Promise<void> = Promise.resolve()
  private epoch = 0
  private suspended = false
  private readonly turns = new Set<Promise<void>>()
  private readonly effectHandles = new Set<DurablePendingInputClaim>()

  constructor(private readonly ports: PendingInputPumpPorts) {}

  fenceSessionInputEffects(sessionId: string): void {
    const handles = [...this.effectHandles]
    for (const handle of handles) {
      if (handle.sessionId === sessionId) handle.fence()
    }
  }

  fenceInputEffectsForRecovery(): Promise<void> {
    this.epoch++
    this.suspended = true
    const handles = [...this.effectHandles]
    for (const handle of handles) handle.fence()
    return Promise.all(handles.map((handle) => handle.flushEffects())).then(() => {})
  }

  replaceRestartedQueueInputs(
    sessions: Array<{ sessionId: string; heldInputIds: string[] }>,
    retiredEffects: Promise<void> = Promise.resolve()
  ): Promise<void> {
    this.recovery = retiredEffects
      .then(() => this.ports.control.send({ method: 'inputRecovery', sessions }))
      .then((receipt) => {
        if (receipt.outcome !== 'accepted') throw new Error('Input recovery was rejected')
        this.suspended = false
      })
    void this.recovery.catch(() => {})
    return this.recovery
  }

  async drainForMaintenance(): Promise<void> {
    const effects = this.fenceInputEffectsForRecovery()
    let timer: ReturnType<typeof setTimeout> | undefined
    try {
      await Promise.race([
        Promise.all([effects, ...this.turns]),
        new Promise<never>((_, reject) => {
          timer = setTimeout(
            () => reject(new Error('Timed out waiting for pending input turns (30000ms)')),
            30_000
          )
        })
      ])
    } finally {
      clearTimeout(timer)
    }
  }

  async releaseRestartHoldForInput(sessionId: string, itemId: string): Promise<void> {
    await this.recovery
    const scope = this.ports.runLifecycle.getHydratedScope(sessionId)
    if (scope) await scope.instance.inputHold({ action: 'release-item', itemId })
  }

  async releaseRestartHoldForSession(sessionId: string): Promise<boolean> {
    await this.recovery
    const scope = this.ports.runLifecycle.getHydratedScope(sessionId)
    if (!scope) return false
    const observed = this.capture(sessionId)
    const head = observed.snapshot.queue[0]
    if (head?.state !== 'pending') return false
    return await scope.instance.inputHold({
      action: 'resume',
      headId: head.id,
      queueIds: observed.snapshot.queue.map(({ id }) => id)
    })
  }

  async hasRestartHeldQueueInputs(sessionId: string): Promise<boolean> {
    return (await this.query(sessionId))?.hasRestartHeld ?? false
  }

  async hasOnlyRestartHeldQueueInputs(sessionId: string): Promise<boolean> {
    return (await this.query(sessionId))?.onlyRestartHeld ?? false
  }

  async hasInteractionBlocker(sessionId: string): Promise<boolean> {
    await this.recovery
    const gate = this.readGateSnapshot(sessionId)
    return (
      gate.awaitingQuestionFollowUp ||
      (await this.ports.runLifecycle.reconcilePendingInteractions(
        sessionId,
        gate.pendingInteractions
      ))
    )
  }

  async canDrain(
    sessionId: string,
    _status: DeepChatSessionState['status'],
    reason: PendingInputWakeReason
  ): Promise<boolean> {
    return (await this.query(sessionId, reason))?.canDrain ?? false
  }

  async enqueue(
    sessionId: string,
    input: SendMessageInput,
    source: PendingInputEnqueueSource,
    projectDir: string | null,
    expectedScope?: SessionRuntimeScope,
    signal?: AbortSignal
  ): Promise<PendingSessionInputRecord> {
    const epoch = this.epoch
    await this.recovery
    const scope = expectedScope ?? this.ports.runLifecycle.getHydratedScope(sessionId)
    if (!scope) throw new Error(`Session ${sessionId} is not hydrated`)
    while (true) {
      if (signal?.aborted) throw createAbortError()
      const observed = await this.observe(scope, epoch)
      const grant = await scope.instance.beginInput({
        intent: 'enqueue',
        source,
        snapshot: observed.snapshot
      })
      if (grant.action !== 'pending' && grant.action !== 'claim')
        throw new Error('Pending input acceptance is unavailable')
      if (!this.matches(scope, observed)) {
        await this.rejectGrant(scope, grant)
        continue
      }
      let transferred = false
      try {
        let record: PendingSessionInputRecord
        let attempted = false
        try {
          scope.assertCurrent()
          if (signal?.aborted) throw createAbortError()
          attempted = true
          record = this.ports.pendingInputs.queuePendingInput(sessionId, input, {
            state: grant.action === 'claim' ? 'claimed' : 'pending'
          })
        } catch (error) {
          if (grant.effectId)
            await scope.instance.ackInputEffect({
              claimId: grant.claimId,
              effectId: grant.effectId,
              outcome: attempted ? 'unknown' : 'rejected'
            })
          throw error
        }
        if (grant.action === 'pending') {
          if (grant.wakeReason) this.schedule(sessionId, grant.wakeReason)
          return record
        }
        this.requireClaimGrant(grant)
        await scope.instance.ackInputEffect({
          claimId: grant.claimId,
          effectId: grant.effectId!,
          outcome: 'applied',
          inputId: record.id
        })
        const claim = this.createClaim(scope, record.id, source, grant.claimId!)
        if (!scope.isCurrent()) {
          await this.tryRelease(claim)
          this.effectHandles.delete(claim)
          return record
        }
        this.launch(scope, record, claim, projectDir, 'enqueue', grant)
        transferred = true
        return record
      } finally {
        if (!transferred && grant.drainLeaseId) await this.end(scope, grant.drainLeaseId)
      }
    }
  }

  async claimQueuedInputForPreparation(
    sessionId: string,
    itemId: string
  ): Promise<ClaimedPendingInputHandle> {
    const epoch = this.epoch
    await this.recovery
    const scope = this.ports.runLifecycle.getHydratedScope(sessionId)
    if (!scope) throw new Error(`Session ${sessionId} is not hydrated`)
    const observed = await this.observe(scope, epoch)
    const grant = await scope.instance.beginInput({
      intent: 'prepare',
      source: 'queue',
      itemId,
      snapshot: observed.snapshot
    })
    this.requireClaimGrant(grant)
    if (!this.matches(scope, observed)) {
      await this.rejectGrant(scope, grant)
      throw new Error('Queued input changed before preparation')
    }
    const claim = this.createClaim(scope, itemId, 'queue', grant.claimId!)
    let record: PendingSessionInputRecord
    try {
      scope.assertCurrent()
      record = this.ports.pendingInputs.claimQueuedInput(sessionId, itemId)
    } catch (error) {
      const outcome = this.claimOutcome(sessionId, itemId)
      await scope.instance.ackInputEffect({
        claimId: grant.claimId,
        effectId: grant.effectId!,
        outcome,
        ...(outcome === 'applied' ? { inputId: itemId } : {})
      })
      if (outcome === 'applied') await this.tryRelease(claim)
      this.effectHandles.delete(claim)
      throw error
    }
    await scope.instance.ackInputEffect({
      claimId: grant.claimId,
      effectId: grant.effectId!,
      outcome: 'applied',
      inputId: record.id
    })
    return claim
  }

  async acceptVisibleSteerInput(
    scope: SessionRuntimeScope,
    input: SendMessageInput,
    options?: { preStreamAnchorMessageId?: string | null }
  ) {
    const epoch = this.epoch
    await this.recovery
    while (true) {
      const observed = await this.observe(scope, epoch)
      const grant = await scope.instance.beginInput({
        intent: 'steer',
        source: 'steer',
        snapshot: observed.snapshot
      })
      if (grant.action !== 'steer' || !grant.effectId)
        throw new Error('Steer acceptance is unavailable')
      if (!this.matches(scope, observed)) {
        await this.rejectGrant(scope, grant)
        continue
      }
      let accepted: ReturnType<SessionPendingInputs['acceptSteerMessage']>
      let attempted = false
      try {
        scope.assertCurrent()
        attempted = true
        accepted = this.ports.pendingInputs.acceptSteerMessage(scope.sessionId, input, {
          mergeItemId: grant.mergeItemId ?? null,
          ...(options ? { preStreamAnchorMessageId: options.preStreamAnchorMessageId ?? null } : {})
        })
      } catch (error) {
        await scope.instance
          .ackInputEffect({ effectId: grant.effectId, outcome: attempted ? 'unknown' : 'rejected' })
          .catch((ackError) =>
            this.logDrainError(scope.sessionId, 'enqueue', 'acknowledge-steer', ackError)
          )
        throw error
      }
      await scope.instance.ackInputEffect({
        effectId: grant.effectId,
        outcome: 'applied',
        inputId: accepted.pendingInput.id
      })
      return accepted
    }
  }

  async promoteQueuedInput(
    scope: SessionRuntimeScope,
    itemId: string,
    content: SendMessageInput,
    claim: ClaimedPendingInputHandle,
    options?: { preStreamAnchorMessageId?: string | null }
  ) {
    const epoch = this.epoch
    let grant: HarnessBeginInputResult | undefined
    let promotionAttempted = false
    let acknowledgementStarted = false
    try {
      await this.recovery
      if (claim.id !== itemId || claim.source !== 'queue')
        throw new Error('Invalid prepared input claim')
      const observed = await this.observe(scope, epoch)
      grant = await scope.instance.beginInput({
        intent: 'steer',
        source: 'steer',
        itemId,
        snapshot: observed.snapshot
      })
      if (grant.action !== 'steer' || !grant.effectId)
        throw new Error('Steer promotion is unavailable')
      if (!this.matches(scope, observed)) throw new Error('Queued input changed before promotion')
      await claim.settle({ kind: 'release-for-mutation' })
      this.assertInputOwner(scope, epoch)
      this.ports.pendingInputs.updateQueuedInput(scope.sessionId, itemId, content)
      this.assertInputOwner(scope, epoch)
      promotionAttempted = true
      const accepted = this.ports.pendingInputs.promoteQueuedInputToSteerMessage(
        scope.sessionId,
        itemId,
        options
      )
      acknowledgementStarted = true
      await scope.instance.ackInputEffect({
        effectId: grant.effectId,
        outcome: 'applied',
        inputId: itemId
      })
      return accepted
    } catch (error) {
      if (grant?.effectId && !acknowledgementStarted) {
        let outcome: 'applied' | 'rejected' | 'unknown' = 'rejected'
        if (promotionAttempted) {
          try {
            const record = this.ports.pendingInputs.getInput(scope.sessionId, itemId)
            outcome =
              record?.mode === 'steer'
                ? 'applied'
                : record?.mode === 'queue'
                  ? 'rejected'
                  : 'unknown'
          } catch {
            outcome = 'unknown'
          }
        }
        await scope.instance
          .ackInputEffect({
            effectId: grant.effectId,
            outcome,
            ...(outcome === 'applied' ? { inputId: itemId } : {})
          })
          .catch((ackError) =>
            this.logDrainError(scope.sessionId, 'enqueue', 'acknowledge-promotion', ackError)
          )
      }
      await this.tryRelease(claim)
      throw error
    }
  }

  async drain(sessionId: string, reason: PendingInputWakeReason): Promise<boolean> {
    const epoch = this.epoch
    await this.recovery
    if (this.suspended) return false
    const scope = this.ports.runLifecycle.getHydratedScope(sessionId)
    if (!scope) return false
    const observed = await this.observe(scope, epoch)
    const projectDir = this.ports.sessionSettings.resolveProjectDir(sessionId)
    const grant = await scope.instance.beginInput({
      intent: 'drain',
      source: 'queue',
      reason,
      snapshot: observed.snapshot
    })
    if (grant.action !== 'claim') return false
    this.requireClaimGrant(grant)
    let transferred = false
    try {
      if (!this.matches(scope, observed)) {
        await this.rejectGrant(scope, { ...grant, drainLeaseId: undefined })
        return false
      }
      const itemId = grant.inputId!
      const source = grant.source!
      const claim = this.createClaim(scope, itemId, source, grant.claimId!)
      let record: PendingSessionInputRecord
      let acknowledged = false
      try {
        scope.assertCurrent()
        record =
          source === 'steer'
            ? this.ports.pendingInputs.claimSteerInput(sessionId, itemId)
            : this.ports.pendingInputs.claimQueuedInput(sessionId, itemId)
      } catch (error) {
        const outcome = this.claimOutcome(sessionId, itemId)
        await scope.instance.ackInputEffect({
          claimId: grant.claimId,
          effectId: grant.effectId!,
          outcome,
          ...(outcome === 'applied' ? { inputId: itemId } : {})
        })
        acknowledged = true
        const persisted =
          outcome === 'applied' ? this.ports.pendingInputs.getInput(sessionId, itemId) : null
        if (source !== 'steer' || !persisted?.assistantMessageId) {
          if (outcome === 'applied') await this.tryRelease(claim)
          this.effectHandles.delete(claim)
          this.logDrainError(sessionId, reason, 'claim-input', error)
          return false
        }
        record = persisted
      }
      if (!acknowledged) {
        await scope.instance.ackInputEffect({
          claimId: grant.claimId,
          effectId: grant.effectId!,
          outcome: 'applied',
          inputId: record.id
        })
      }
      if (!scope.isCurrent() && source === 'queue') {
        await this.tryRelease(claim)
        this.effectHandles.delete(claim)
        return false
      }
      this.launch(scope, record, claim, projectDir, reason, grant)
      transferred = true
      return true
    } finally {
      if (!transferred) await this.end(scope, grant.drainLeaseId!)
    }
  }

  schedule(sessionId: string, reason: PendingInputWakeReason): void {
    void this.drain(sessionId, reason).catch((error) =>
      this.logDrainError(sessionId, reason, 'drain', error)
    )
  }

  private async query(sessionId: string, reason?: PendingInputWakeReason) {
    await this.recovery
    const scope = this.ports.runLifecycle.getHydratedScope(sessionId)
    if (!scope) return undefined
    const observed = await this.observe(scope)
    return await scope.instance.queryInput(observed.snapshot, reason)
  }

  private capture(sessionId: string) {
    const gate = this.readGateSnapshot(sessionId)
    const inputs = this.ports.pendingInputs.listPendingInputs(sessionId)
    const queue = inputs
      .filter((input) => input.mode === 'queue')
      .sort((left, right) => (left.queueOrder ?? 0) - (right.queueOrder ?? 0))
      .map(({ id, state }) => ({ id, state: state as 'pending' | 'blocked' | 'retry_required' }))
    const steer = inputs
      .filter((input) => input.mode === 'steer')
      .sort((left, right) => left.createdAt - right.createdAt)[0]
    const snapshot: HarnessInputSnapshot = {
      queue,
      steerHead: steer ? { id: steer.id, state: steer.state as 'pending' | 'blocked' } : null,
      hasClaimed: this.ports.pendingInputs.hasClaimedInput(sessionId),
      hasBlocking: this.ports.pendingInputs.hasBlockingInput(sessionId),
      awaitingFollowUp: gate.awaitingQuestionFollowUp
    }
    return {
      snapshot,
      gate,
      epoch: this.epoch,
      key: JSON.stringify({
        snapshot,
        refs: gate.pendingInteractions.map(({ interaction }) => ({
          messageId: interaction.messageId,
          toolCallId: interaction.toolCallId,
          origin: interaction.origin,
          order: interaction.order
        }))
      })
    }
  }

  private matches(
    scope: SessionRuntimeScope,
    observed: ReturnType<PendingInputPump['capture']>
  ): boolean {
    return (
      !this.suspended &&
      !scope.instance.inputEffectsFenced &&
      this.epoch === observed.epoch &&
      this.capture(scope.sessionId).key === observed.key
    )
  }

  private assertInputOwner(scope: SessionRuntimeScope, epoch: number): void {
    scope.assertCurrent()
    if (this.suspended || scope.instance.inputEffectsFenced || epoch !== this.epoch)
      throw new Error('Input effect owner was retired')
  }

  private async observe(scope: SessionRuntimeScope, epoch = this.epoch) {
    await scope.instance.controlReady()
    this.assertInputOwner(scope, epoch)
    const observed = this.capture(scope.sessionId)
    await this.ports.runLifecycle.reconcilePendingInteractions(
      scope.sessionId,
      observed.gate.pendingInteractions
    )
    scope.assertCurrent()
    return observed
  }

  private requireClaimGrant(grant: HarnessBeginInputResult): void {
    if (
      !grant.claimId ||
      !grant.effectId ||
      (grant.action === 'claim' && !grant.drainLeaseId) ||
      (grant.action !== 'claim' && grant.action !== 'prepare')
    )
      throw new Error('Pending input claim was not granted')
  }

  private claimOutcome(sessionId: string, itemId: string): 'applied' | 'rejected' | 'unknown' {
    try {
      const record = this.ports.pendingInputs.getInput(sessionId, itemId)
      return record?.state === 'claimed'
        ? 'applied'
        : record?.state === 'pending'
          ? 'rejected'
          : 'unknown'
    } catch {
      return 'unknown'
    }
  }

  private createClaim(
    scope: SessionRuntimeScope,
    itemId: string,
    source: PendingInputTurnSource,
    claimId: string
  ): DurablePendingInputClaim {
    const handle = new DurablePendingInputClaim(
      this.ports.pendingInputs,
      scope,
      claimId,
      itemId,
      source,
      () => this.effectHandles.delete(handle)
    )
    this.effectHandles.add(handle)
    return handle
  }

  private async rejectGrant(
    scope: SessionRuntimeScope,
    grant: HarnessBeginInputResult
  ): Promise<void> {
    if (grant.effectId)
      await scope.instance.ackInputEffect({
        effectId: grant.effectId,
        ...(grant.claimId ? { claimId: grant.claimId } : {}),
        outcome: 'rejected'
      })
    if (grant.drainLeaseId) await this.end(scope, grant.drainLeaseId)
  }

  private launch(
    scope: SessionRuntimeScope,
    record: PendingSessionInputRecord,
    claim: ClaimedPendingInputHandle,
    projectDir: string | null,
    reason: PendingInputWakeReason,
    grant: HarnessBeginInputResult
  ): void {
    let turn: Promise<TurnCompletion>
    try {
      turn = this.ports.turnStarter.start(record.sessionId, record.payload, {
        projectDir,
        claimedInput: claim,
        consumeClaimBeforeProviderStream: grant.consumeBeforeProviderStream
      })
    } catch (error) {
      turn = Promise.reject(error)
    }
    const completion = turn
      .then(
        (result) => {
          if (!claim.disposition || result.claimedInputDisposition?.kind !== claim.disposition.kind)
            this.logDrainError(
              record.sessionId,
              reason,
              'claim-consistency',
              new Error('Pending input completion mismatch')
            )
        },
        (error) => this.logDrainError(record.sessionId, reason, 'process-message', error)
      )
      .finally(async () => {
        await claim.flushEffects()
        if (!claim.disposition)
          this.logDrainError(
            record.sessionId,
            reason,
            'unsettled-claim',
            new Error(`Turn left pending input ${record.id} unsettled.`)
          )
        await this.end(scope, grant.drainLeaseId!)
        const stillWaiting = this.ports.pendingInputs
          .listPendingInputs(record.sessionId)
          .some(
            ({ id, state }) =>
              id === record.id && (state === 'pending' || state === 'retry_required')
          )
        if (!stillWaiting) this.schedule(record.sessionId, 'completed')
      })
      .catch((error) => this.logDrainError(record.sessionId, reason, 'finalization', error))
      .finally(() => this.turns.delete(completion))
    this.turns.add(completion)
  }

  private async end(scope: SessionRuntimeScope, drainLeaseId: string): Promise<void> {
    const result = await scope.instance.endInput(drainLeaseId)
    if (result.nextWake) this.schedule(scope.sessionId, result.nextWake)
  }

  private async tryRelease(claim: ClaimedPendingInputHandle): Promise<void> {
    if (claim.disposition) return
    try {
      await claim.settle({ kind: 'release-before-user-fact' })
    } catch (error) {
      logger.warn(
        `[DeepChatAgent] failed to release pending input item=${claim.id}`,
        redactRuntimeErrorForLog(error)
      )
    }
  }

  private readGateSnapshot(sessionId: string): PendingInputGateSnapshot {
    const messages = this.ports.transcript.getMessages(sessionId)
    let latestUserOrderSeq = 0
    for (const message of messages) {
      if (message.role === 'user') {
        latestUserOrderSeq = Math.max(latestUserOrderSeq, message.orderSeq)
      }
    }

    let awaitingQuestionFollowUp = false
    const pendingInteractions: PendingInteractionEntry[] = []
    for (const message of messages) {
      if (message.role !== 'assistant') {
        continue
      }
      const blocks = parseAssistantBlocks(message.content)
      pendingInteractions.push(
        ...collectPendingInteractionEntries(message.id, blocks, pendingInteractions.length)
      )
      if (
        message.orderSeq > latestUserOrderSeq &&
        blocks.some(
          (block) =>
            block.type === 'action' &&
            block.action_type === 'question_request' &&
            block.status === 'success' &&
            block.extra?.needsUserAction === false &&
            block.extra?.questionResolution === 'replied' &&
            block.extra?.questionFollowUpPending === true
        )
      ) {
        awaitingQuestionFollowUp = true
      }
    }

    return { awaitingQuestionFollowUp, pendingInteractions }
  }

  private logDrainError(
    sessionId: string,
    reason: PendingInputWakeReason,
    stage: string,
    error: unknown
  ): void {
    logger.error(
      `[DeepChatAgent] drainPendingQueueIfPossible error session=${sessionId} reason=${reason} stage=${stage}`,
      redactRuntimeErrorForLog(error)
    )
  }
}
