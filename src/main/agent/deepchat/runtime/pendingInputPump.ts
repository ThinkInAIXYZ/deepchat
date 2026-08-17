import logger from '@shared/logger'
import type {
  DeepChatSessionState,
  PendingInputEnqueueSource,
  PendingSessionInputRecord,
  SendMessageInput
} from '@shared/types/agent-interface'
import type { SessionRuntimeScope } from '@/agent/deepchat/instance/deepChatAgentRuntime'
import type {
  DeepChatAgentInstance,
  PendingQueueDrainLease
} from '@/agent/deepchat/instance/deepChatAgentInstance'
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
import type { SessionStateResolver } from './sessionStateResolver'
import type {
  ClaimedInputDisposition,
  ClaimedInputSettlementResult,
  ClaimedPendingInputHandle,
  PendingInputTurnSource,
  TurnCompletion
} from './pendingInputContracts'

export type PendingInputPumpStorePort = Pick<
  SessionPendingInputs,
  | 'blockClaimedInput'
  | 'claimQueuedInput'
  | 'claimSteerInput'
  | 'consumeQueuedInput'
  | 'consumeSteerInput'
  | 'getInput'
  | 'getNextQueuedInput'
  | 'getNextSteerInput'
  | 'hasBlockingInput'
  | 'hasClaimedInput'
  | 'hasPendingTurnInput'
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

interface LaunchedPendingInputDrain {
  readonly instance: DeepChatAgentInstance
  readonly lease: PendingQueueDrainLease
  readonly claim: ClaimedPendingInputHandle
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
  pendingInputs: PendingInputPumpStorePort
  transcript: Pick<SessionTranscript, 'getMessages'>
  runLifecycle: PendingInputPumpLifecyclePort
  turnStarter: PendingInputTurnStarter
  sessionState: Pick<SessionStateResolver, 'get'>
  sessionSettings: Pick<SessionSettingsCoordinator, 'resolveProjectDir'>
}

class DurablePendingInputClaim implements ClaimedPendingInputHandle {
  private fencedDisposition: ClaimedInputDisposition | null = null

  constructor(
    private readonly pendingInputs: PendingInputPumpStorePort,
    private readonly sessionId: string,
    readonly id: string,
    readonly source: PendingInputTurnSource
  ) {}

  get disposition(): ClaimedInputDisposition | null {
    return this.fencedDisposition
  }

  get messageIds(): string[] {
    return this.requireRecord().messageIds
  }

  get assistantMessageId(): string | null {
    return this.requireRecord().assistantMessageId
  }

  settle<TDisposition extends ClaimedInputDisposition>(
    disposition: TDisposition
  ): ClaimedInputSettlementResult<TDisposition> {
    if (this.fencedDisposition) {
      throw new Error(
        `Pending input ${this.id} is already fenced as ${this.fencedDisposition.kind}`
      )
    }

    this.assertClaimed()
    try {
      const result = this.apply(disposition)
      this.fencedDisposition = disposition
      return result as ClaimedInputSettlementResult<TDisposition>
    } catch (error) {
      // SessionPendingInputs persists before publishing. If publication throws, remember the
      // durable outcome so Turn/Pump finalization never applies a second transition.
      let wasApplied = false
      try {
        wasApplied = this.wasApplied(disposition)
      } catch (verificationError) {
        // The persistence boundary was crossed but its outcome cannot be observed. Fence the claim
        // conservatively so no caller can apply a second, potentially conflicting transition.
        this.fencedDisposition = disposition
        logger.warn(
          `[DeepChatAgent] failed to verify pending input settlement session=${this.sessionId} item=${this.id}`,
          redactRuntimeErrorForLog(verificationError)
        )
      }
      if (wasApplied) {
        this.fencedDisposition = disposition
      }
      throw error
    }
  }

  private apply(disposition: ClaimedInputDisposition): PendingSessionInputRecord | null {
    switch (disposition.kind) {
      case 'consume':
        if (this.source === 'steer') {
          this.pendingInputs.consumeSteerInput(this.sessionId, this.id)
        } else {
          this.pendingInputs.consumeQueuedInput(this.sessionId, this.id)
        }
        return null
      case 'block':
        return this.pendingInputs.blockClaimedInput(
          this.sessionId,
          this.id,
          disposition.attachmentPreparation
        )
      case 'release-for-mutation':
        return this.source === 'steer'
          ? this.pendingInputs.releaseClaimedInput(this.sessionId, this.id)
          : this.pendingInputs.releaseClaimedQueueInput(this.sessionId, this.id)
      case 'release-before-user-fact':
      case 'release-after-rollback':
        return this.source === 'steer'
          ? this.pendingInputs.releaseClaimedInput(this.sessionId, this.id)
          : this.pendingInputs.releaseClaimedQueueInputForRetry(this.sessionId, this.id)
    }
  }

  private assertClaimed(): void {
    const record = this.requireRecord()
    const expectedMode = this.source === 'steer' ? 'steer' : 'queue'
    if (record.mode !== expectedMode) {
      throw new Error(`Pending input ${this.id} changed mode before settlement.`)
    }
    if (record.state !== 'claimed') {
      throw new Error(`Pending input ${this.id} is not claimed.`)
    }
  }

  private requireRecord(): PendingSessionInputRecord {
    const record = this.pendingInputs.getInput(this.sessionId, this.id)
    if (!record) {
      throw new Error(`Pending input not found: ${this.id}`)
    }
    return record
  }

  private wasApplied(disposition: ClaimedInputDisposition): boolean {
    const record = this.pendingInputs.getInput(this.sessionId, this.id)
    const expectedMode = this.source === 'steer' ? 'steer' : 'queue'
    switch (disposition.kind) {
      case 'consume':
        return this.source === 'steer'
          ? record?.mode === expectedMode && record.state === 'consumed'
          : record === null
      case 'block':
        return record?.mode === expectedMode && record.state === 'blocked'
      case 'release-for-mutation':
        return record?.mode === expectedMode && record.state === 'pending'
      case 'release-before-user-fact':
      case 'release-after-rollback':
        return (
          record?.mode === expectedMode &&
          record.state === (this.source === 'queue' ? 'retry_required' : 'pending')
        )
    }
  }
}

export class PendingInputPump {
  private readonly launchedDrains = new Map<string, LaunchedPendingInputDrain>()
  private readonly deferredWakeups = new Map<string, PendingInputWakeReason>()
  private readonly restartHeldQueueInputIds = new Set<string>()
  private readonly manuallyResumedQueueInputIds = new Set<string>()

  constructor(private readonly ports: PendingInputPumpPorts) {}

  holdRestartedQueueInputs(inputIds: Iterable<string>): void {
    for (const inputId of inputIds) {
      this.restartHeldQueueInputIds.add(inputId)
    }
  }

  replaceRestartedQueueInputs(inputIds: Iterable<string>): void {
    this.restartHeldQueueInputIds.clear()
    this.manuallyResumedQueueInputIds.clear()
    this.holdRestartedQueueInputs(inputIds)
  }

  releaseRestartHoldForInput(itemId: string): void {
    this.restartHeldQueueInputIds.delete(itemId)
    this.manuallyResumedQueueInputIds.delete(itemId)
  }

  releaseRestartHoldForSession(sessionId: string): boolean {
    const queueInputs = this.ports.pendingInputs
      .listPendingInputs(sessionId)
      .filter((input) => input.mode === 'queue')
      .sort((left, right) => (left.queueOrder ?? 0) - (right.queueOrder ?? 0))
    const resumedHead = queueInputs[0]
    if (
      !resumedHead ||
      resumedHead.state !== 'pending' ||
      !this.restartHeldQueueInputIds.has(resumedHead.id)
    ) {
      return false
    }
    for (const input of queueInputs) {
      if (this.restartHeldQueueInputIds.has(input.id)) {
        this.restartHeldQueueInputIds.delete(input.id)
      }
    }
    this.manuallyResumedQueueInputIds.add(resumedHead.id)
    return true
  }

  hasRestartHeldQueueInputs(sessionId: string): boolean {
    const head = this.ports.pendingInputs
      .listPendingInputs(sessionId)
      .filter((input) => input.mode === 'queue')
      .sort((left, right) => (left.queueOrder ?? 0) - (right.queueOrder ?? 0))[0]
    return Boolean(
      head?.state === 'pending' && this.restartHeldQueueInputIds.has(head.id)
    )
  }

  hasOnlyRestartHeldQueueInputs(sessionId: string): boolean {
    if (
      this.ports.pendingInputs.hasBlockingInput(sessionId) ||
      this.ports.pendingInputs.hasClaimedInput(sessionId)
    ) {
      return false
    }
    const inputs = this.ports.pendingInputs.listPendingInputs(sessionId)
    return (
      inputs.length > 0 &&
      inputs.every(
        (input) => input.mode === 'queue' && this.restartHeldQueueInputIds.has(input.id)
      )
    )
  }

  hasInteractionBlocker(sessionId: string): boolean {
    const snapshot = this.readGateSnapshot(sessionId)
    return (
      snapshot.awaitingQuestionFollowUp ||
      this.ports.runLifecycle.reconcilePendingInteractions(
        sessionId,
        snapshot.pendingInteractions
      )
    )
  }

  shouldClaimImmediately(
    sessionId: string,
    status: DeepChatSessionState['status'],
    source: PendingInputEnqueueSource
  ): boolean {
    if (source !== 'send' && !this.canDrainFromStatus(status, 'enqueue')) {
      return false
    }
    const instance = this.ports.runLifecycle.getHydratedScope(sessionId)?.instance
    const snapshot = this.readGateSnapshot(sessionId)
    const isUnclaimedQuestionFollowUp =
      source === 'send' &&
      snapshot.awaitingQuestionFollowUp &&
      !this.ports.pendingInputs.hasBlockingInput(sessionId) &&
      !this.ports.pendingInputs.hasClaimedInput(sessionId) &&
      !instance?.isPendingQueueDraining()
    const hasRetryRequiredInput = this.ports.pendingInputs
      .listPendingInputs(sessionId)
      .some((input) => input.mode === 'queue' && input.state === 'retry_required')

    if (isUnclaimedQuestionFollowUp && !hasRetryRequiredInput) {
      return true
    }
    if (!this.canDrainWithSnapshot(sessionId, status, 'enqueue', snapshot)) {
      return false
    }
    const hasWaitingTurnInput =
      hasRetryRequiredInput ||
      (source === 'send'
        ? this.hasExecutablePendingTurnInput(sessionId)
        : this.ports.pendingInputs.hasPendingTurnInput(sessionId))
    return (
      !hasWaitingTurnInput &&
      !this.ports.pendingInputs.hasBlockingInput(sessionId) &&
      !this.ports.pendingInputs.hasClaimedInput(sessionId)
    )
  }

  canDrain(
    sessionId: string,
    status: DeepChatSessionState['status'],
    reason: PendingInputWakeReason
  ): boolean {
    if (!this.canDrainFromStatus(status, reason)) {
      return false
    }
    return this.canDrainWithSnapshot(
      sessionId,
      status,
      reason,
      this.readGateSnapshot(sessionId)
    )
  }

  private canDrainWithSnapshot(
    sessionId: string,
    status: DeepChatSessionState['status'],
    reason: PendingInputWakeReason,
    snapshot: PendingInputGateSnapshot
  ): boolean {
    if (!this.meetsDrainPreconditions(sessionId, status, reason, snapshot)) {
      return false
    }
    return !this.ports.runLifecycle
      .getHydratedScope(sessionId)
      ?.instance.isPendingQueueDraining()
  }

  startAcceptedInput(
    record: PendingSessionInputRecord,
    source: PendingInputEnqueueSource,
    projectDir: string | null
  ): void {
    if (record.mode !== 'queue' || record.state !== 'claimed') {
      throw new Error(`Accepted pending input ${record.id} is not a claimed queue input.`)
    }
    const scope = this.ports.runLifecycle.getHydratedScope(record.sessionId)
    const claim = this.createClaim(record.sessionId, record.id, source)
    const drainLease = scope?.instance.tryAcquirePendingQueueDrain() ?? null
    if (!scope || !drainLease) {
      const released = this.tryRelease(claim)
      logger.error(
        `[DeepChatAgent] pending input start rejected session=${record.sessionId} stage=adopt-claim`
      )
      if (released) {
        this.schedule(record.sessionId, 'enqueue')
      }
      return
    }

    this.launch(scope, record, claim, projectDir, 'enqueue', drainLease)
  }

  claimQueuedInputForPreparation(
    sessionId: string,
    itemId: string
  ): ClaimedPendingInputHandle {
    const claim = this.createClaim(sessionId, itemId, 'queue')
    try {
      this.ports.pendingInputs.claimQueuedInput(sessionId, itemId)
      return claim
    } catch (error) {
      this.tryRelease(claim)
      throw error
    }
  }

  async drain(sessionId: string, reason: PendingInputWakeReason): Promise<boolean> {
    const scope = this.ports.runLifecycle.getHydratedScope(sessionId)
    if (!scope) {
      return false
    }
    const drainLease = scope.instance.tryAcquirePendingQueueDrain()
    if (!drainLease) {
      if (this.shouldDeferWakeup(scope, reason)) {
        this.rememberDeferredWakeup(sessionId, reason)
      }
      return false
    }

    let launchOwnsLease = false
    try {
      const state = await this.ports.sessionState.get(sessionId)
      if (!state || !scope.isCurrent()) {
        return false
      }
      const snapshot = this.readGateSnapshot(sessionId)
      if (!this.meetsDrainPreconditions(sessionId, state.status, reason, snapshot)) {
        return false
      }
      if (
        this.ports.pendingInputs.hasBlockingInput(sessionId) ||
        this.ports.pendingInputs.hasClaimedInput(sessionId)
      ) {
        return false
      }

      const nextSteerInput = this.ports.pendingInputs.getNextSteerInput(sessionId)
      const nextQueuedInput = nextSteerInput
        ? null
        : this.ports.pendingInputs.getNextQueuedInput(sessionId)
      if (nextQueuedInput && this.restartHeldQueueInputIds.has(nextQueuedInput.id)) {
        return false
      }
      const nextPendingInput = nextSteerInput ?? nextQueuedInput
      if (!nextPendingInput) {
        return false
      }

      let projectDir: string | null
      try {
        projectDir = this.ports.sessionSettings.resolveProjectDir(sessionId)
      } catch (error) {
        this.logDrainError(sessionId, reason, 'resolve-project-dir', error)
        return false
      }

      const source: PendingInputTurnSource = nextSteerInput ? 'steer' : 'queue'
      const claim = this.createClaim(sessionId, nextPendingInput.id, source)

      let claimedInput: PendingSessionInputRecord
      try {
        scope.assertCurrent()
        claimedInput =
          source === 'steer'
            ? this.ports.pendingInputs.claimSteerInput(sessionId, nextPendingInput.id)
            : this.ports.pendingInputs.claimQueuedInput(sessionId, nextPendingInput.id)
      } catch (error) {
        const persisted = this.ports.pendingInputs.getInput(sessionId, nextPendingInput.id)
        if (
          source !== 'steer' ||
          persisted?.state !== 'claimed' ||
          !persisted.assistantMessageId
        ) {
          this.tryRelease(claim)
          this.logDrainError(sessionId, reason, 'claim-input', error)
          return false
        }
        claimedInput = persisted
      }

      if (!scope.isCurrent() && source === 'queue') {
        this.tryRelease(claim)
        return false
      }

      if (source === 'steer') {
        scope.instance.clearActiveSteerPendingInputId(claimedInput.id)
      }

      this.launch(scope, claimedInput, claim, projectDir, reason, drainLease)
      launchOwnsLease = true
      return true
    } finally {
      if (!launchOwnsLease) {
        scope.instance.releasePendingQueueDrain(drainLease)
        this.flushDeferredWakeup(sessionId)
      }
    }
  }

  schedule(sessionId: string, reason: PendingInputWakeReason): void {
    void this.drain(sessionId, reason).catch((error) => {
      logger.error(
        `[DeepChatAgent] drainPendingQueueIfPossible error session=${sessionId} reason=${reason}`,
        redactRuntimeErrorForLog(error)
      )
    })
  }

  private launch(
    scope: SessionRuntimeScope,
    claimedInput: PendingSessionInputRecord,
    claim: ClaimedPendingInputHandle,
    projectDir: string | null,
    reason: PendingInputWakeReason,
    drainLease: PendingQueueDrainLease
  ): void {
    this.launchedDrains.set(claimedInput.sessionId, {
      instance: scope.instance,
      lease: drainLease,
      claim
    })
    let turn: Promise<TurnCompletion>
    try {
      turn = this.ports.turnStarter.start(claimedInput.sessionId, claimedInput.payload, {
        projectDir,
        claimedInput: claim,
        consumeClaimBeforeProviderStream:
          claim.source === 'queue' && this.manuallyResumedQueueInputIds.has(claimedInput.id)
      })
    } catch (error) {
      turn = Promise.reject(error)
    }
    void turn
      .then(
        (completion) => {
          const mismatch = this.getCompletionMismatch(claimedInput.id, claim, completion)
          if (mismatch && claim.disposition) {
            this.logDrainError(
              claimedInput.sessionId,
              reason,
              'claim-consistency',
              mismatch
            )
          }
        },
        (error) => {
          this.logDrainError(claimedInput.sessionId, reason, 'process-message', error)
        }
      )
      .finally(async () => {
        if (!claim.disposition) {
          this.logDrainError(
            claimedInput.sessionId,
            reason,
            'unsettled-claim',
            new Error(`Turn left pending input ${claimedInput.id} unsettled.`)
          )
        }
        if (claim.disposition?.kind === 'consume') {
          this.manuallyResumedQueueInputIds.delete(claimedInput.id)
        }
        this.clearLaunchedDrain(claimedInput.sessionId, scope.instance, drainLease)
        scope.instance.releasePendingQueueDrain(drainLease)
        this.flushDeferredWakeup(claimedInput.sessionId)
        await this.scheduleNextIfReady(claimedInput.sessionId, claimedInput.id, reason)
      })
      .catch((error) => {
        this.logDrainError(claimedInput.sessionId, reason, 'finalization', error)
      })
  }

  private shouldDeferWakeup(
    scope: SessionRuntimeScope,
    reason: PendingInputWakeReason
  ): boolean {
    const launchedDrain = this.launchedDrains.get(scope.sessionId)
    const status = scope.state()?.status
    return (
      launchedDrain?.instance === scope.instance &&
      launchedDrain.claim.disposition !== null &&
      status !== undefined &&
      this.canDrainFromStatus(status, reason)
    )
  }

  private clearLaunchedDrain(
    sessionId: string,
    instance: DeepChatAgentInstance,
    lease: PendingQueueDrainLease
  ): void {
    const launchedDrain = this.launchedDrains.get(sessionId)
    if (launchedDrain?.instance === instance && launchedDrain.lease === lease) {
      this.launchedDrains.delete(sessionId)
    }
  }

  private async scheduleNextIfReady(
    sessionId: string,
    claimedInputId: string,
    reason: PendingInputWakeReason
  ): Promise<void> {
    try {
      const releasedInputIsStillWaiting = this.ports.pendingInputs
        .listPendingInputs(sessionId)
        .some(
          (item) =>
            item.id === claimedInputId &&
            (item.state === 'pending' || item.state === 'retry_required')
        )
      if (
        !releasedInputIsStillWaiting &&
        this.ports.pendingInputs.hasPendingTurnInput(sessionId) &&
        (await this.ports.sessionState.get(sessionId))?.status === 'idle' &&
        !this.hasInteractionBlocker(sessionId)
      ) {
        this.schedule(sessionId, 'completed')
      }
    } catch (error) {
      this.logDrainError(sessionId, reason, 'cleanup', error)
    }
  }

  private createClaim(
    sessionId: string,
    itemId: string,
    source: PendingInputTurnSource
  ): ClaimedPendingInputHandle {
    return new DurablePendingInputClaim(this.ports.pendingInputs, sessionId, itemId, source)
  }

  private rememberDeferredWakeup(sessionId: string, reason: PendingInputWakeReason): void {
    const current = this.deferredWakeups.get(sessionId)
    const priority: Record<PendingInputWakeReason, number> = {
      completed: 0,
      enqueue: 1,
      manual: 2
    }
    this.deferredWakeups.set(
      sessionId,
      !current || priority[reason] > priority[current] ? reason : current
    )
  }

  private flushDeferredWakeup(sessionId: string): void {
    const reason = this.deferredWakeups.get(sessionId)
    if (!reason) {
      return
    }
    const scope = this.ports.runLifecycle.getHydratedScope(sessionId)
    if (!scope) {
      this.deferredWakeups.delete(sessionId)
      return
    }
    if (scope.instance.isPendingQueueDraining()) {
      return
    }
    this.deferredWakeups.delete(sessionId)
    this.schedule(sessionId, reason)
  }

  private tryRelease(claim: ClaimedPendingInputHandle): boolean {
    if (claim.disposition) {
      return true
    }
    try {
      claim.settle({ kind: 'release-before-user-fact' })
      return true
    } catch (error) {
      logger.warn(
        `[DeepChatAgent] failed to release claimed pending input item=${claim.id}`,
        redactRuntimeErrorForLog(error)
      )
      return claim.disposition !== null
    }
  }

  private getCompletionMismatch(
    itemId: string,
    claim: ClaimedPendingInputHandle,
    completion: TurnCompletion
  ): Error | null {
    const settled = claim.disposition
    const reported = completion.claimedInputDisposition
    if (!settled || !reported || settled.kind !== reported.kind) {
      return new Error(`Turn completed without settling pending input ${itemId} consistently.`)
    }
    return null
  }

  private meetsDrainPreconditions(
    sessionId: string,
    status: DeepChatSessionState['status'],
    reason: PendingInputWakeReason,
    snapshot: PendingInputGateSnapshot
  ): boolean {
    if (!this.canDrainFromStatus(status, reason) || snapshot.awaitingQuestionFollowUp) {
      return false
    }
    return !this.ports.runLifecycle.reconcilePendingInteractions(
      sessionId,
      snapshot.pendingInteractions
    )
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

  private canDrainFromStatus(
    status: DeepChatSessionState['status'],
    reason: PendingInputWakeReason
  ): boolean {
    return status === 'idle' || (reason !== 'completed' && status === 'error')
  }

  private hasExecutablePendingTurnInput(sessionId: string): boolean {
    if (this.ports.pendingInputs.getNextSteerInput(sessionId)) {
      return true
    }
    const nextQueueInput = this.ports.pendingInputs.getNextQueuedInput(sessionId)
    return Boolean(nextQueueInput && !this.restartHeldQueueInputIds.has(nextQueueInput.id))
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
