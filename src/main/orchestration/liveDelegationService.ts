import { Buffer } from 'node:buffer'
import { nanoid } from 'nanoid'
import {
  LIVE_DELEGATION_MAX_SUMMARY_BYTES,
  type LiveDelegation,
  type LiveDelegationDetail,
  type LiveDelegationEvent,
  type LiveDelegationEventSummary,
  type LiveDelegationSummary,
  type LiveDelegationTurn,
  type LiveDelegationTurnSummary
} from '@shared/orchestration/liveDelegation'
import type {
  AgentInvocationAdmissionPort,
  AgentInvocationAdmissionOptions
} from '@/agent/invocationAdmission'
import type {
  AgentSubagentToolPort,
  AgentToolSessionPort,
  ConversationSessionInfo
} from '@/tool/runtimePorts'
import type {
  DeepChatSubagentCapability,
  SubagentTapeLinkReceipt
} from '@shared/types/agent-interface'
import type { SessionRuntimeUpdate } from '@/session/runtimeEvents'
import { classifyToolEffect } from '@/tool/effectClassification'
import type { ToolEffectObservation } from '@/tool/effectObserver'
import type { ActiveLiveDelegationTurn, LiveDelegationRepository } from './liveDelegationRepository'

const MAX_ACTIVE_DELEGATIONS_PER_PARENT = 5
const MAX_WAITERS = 32
const DEFAULT_WAIT_TIMEOUT_MS = 30_000
const MAX_WAIT_TIMEOUT_MS = 60_000
const MAX_MODEL_PREVIEW_BYTES = 2 * 1024
const LIVE_DELEGATION_OWNER_LIMIT = 5

export interface SpawnLiveDelegationInput {
  slotId: string
  title: string
  prompt: string
}

export interface LiveDelegationWaitResult {
  events: LiveDelegationEventSummary[]
  cursor: number
  timedOut: boolean
}

export interface LiveDelegationServiceSessionPort
  extends AgentToolSessionPort, AgentSubagentToolPort {
  findDelegationChild(
    parentSessionId: string,
    delegationId: string
  ): Promise<ConversationSessionInfo | null>
  getLatestAssistantResponse(sessionId: string): Promise<string | null>
}

export interface LiveDelegationServiceOptions {
  repository: LiveDelegationRepository
  sessions: LiveDelegationServiceSessionPort
  admission: AgentInvocationAdmissionPort
  onChanged?: (parentSessionId: string, delegationId: string) => void
}

type ActiveTurn = {
  delegationId: string
  turnId: string
  parentSessionId: string
  childSessionId: string | null
  controller: AbortController
  completion: ReturnType<typeof createDeferred>
  responseMarkdown: string
  runtimeStatus: 'idle' | 'generating' | 'error' | null
  started: boolean
  settling: boolean
}

type MailboxWaiter = {
  parentSessionId: string
  delegationIds: ReadonlySet<string> | null
  resolve: () => void
}

type CapableParent = ConversationSessionInfo & {
  subagentCapability: Extract<DeepChatSubagentCapability, { available: true }>
}

export class LiveDelegationService {
  private readonly activeTurns = new Map<string, ActiveTurn>()
  private readonly childToTurn = new Map<string, string>()
  private readonly waiters = new Set<MailboxWaiter>()
  private unsubscribeRuntime: (() => void) | null = null
  private reconcilePromise: Promise<void> | null = null
  private started = false

  constructor(private readonly options: LiveDelegationServiceOptions) {}

  start(): void {
    if (this.started) return
    const activeRecords = this.options.repository.listActiveTurns()
    for (const record of activeRecords) {
      if (record.delegation.childSessionId) {
        this.childToTurn.set(record.delegation.childSessionId, record.turn.id)
      }
    }
    this.started = true
    this.unsubscribeRuntime = this.options.sessions.subscribeSessionRuntimeUpdates((update) => {
      try {
        this.handleRuntimeUpdate(update)
      } catch (error) {
        console.error('[LiveDelegationService] Failed to apply child runtime update:', error)
      }
    })
    this.reconcilePromise = this.reconcileActiveTurns(activeRecords).catch((error) => {
      console.error('[LiveDelegationService] Failed to reconcile active turns:', error)
    })
  }

  async stop(): Promise<void> {
    if (!this.started) return
    this.started = false
    this.unsubscribeRuntime?.()
    this.unsubscribeRuntime = null
    await this.reconcilePromise
    this.reconcilePromise = null
    const active = [...this.activeTurns.values()]
    for (const turn of active) {
      turn.controller.abort('Live delegation service stopped.')
    }
    await Promise.allSettled(
      active.map(async (turn) => {
        if (turn.childSessionId) {
          await this.options.sessions.cancelConversation(turn.childSessionId).catch(() => undefined)
        }
        await this.settle(turn, {
          status: 'interrupted',
          error: 'Live delegation service stopped.'
        })
      })
    )
    this.activeTurns.clear()
    this.childToTurn.clear()
    for (const waiter of this.waiters) waiter.resolve()
    this.waiters.clear()
  }

  async spawn(
    parentSessionId: string,
    input: SpawnLiveDelegationInput
  ): Promise<LiveDelegationDetail> {
    this.assertStarted()
    const parent = await this.requireCapableParent(parentSessionId)
    if (
      this.options.repository.countActiveByParent(parent.sessionId) >=
      MAX_ACTIVE_DELEGATIONS_PER_PARENT
    ) {
      throw new Error(
        `A parent session can have at most ${MAX_ACTIVE_DELEGATIONS_PER_PARENT} active live delegations.`
      )
    }
    const slot = parent.subagentCapability.slots.find((candidate) => candidate.id === input.slotId)
    if (!slot) throw new Error(`Subagent slot not found or not enabled: ${input.slotId}`)
    const targetAgentId =
      slot.targetType === 'self' ? parent.agentId : (slot.targetAgentId?.trim() ?? '')
    if (!targetAgentId) throw new Error(`Subagent slot is missing a target agent: ${slot.id}`)

    const delegationId = nanoid()
    const turnId = nanoid()
    const created = this.options.repository.create({
      id: delegationId,
      initialTurnId: turnId,
      parentSessionId: parent.sessionId,
      slotId: slot.id,
      targetAgentId,
      title: input.title,
      prompt: input.prompt
    })
    this.publishChanged(created.delegation)
    this.scheduleTurn(created.delegation, created.turn, parent)
    return this.inspect(parent.sessionId, delegationId)
  }

  send(parentSessionId: string, delegationId: string, message: string): LiveDelegationDetail {
    this.assertStarted()
    const event = this.options.repository.createMessage(parentSessionId, delegationId, message)
    this.publishChanged(this.options.repository.require(event.delegationId))
    return this.inspect(parentSessionId, delegationId)
  }

  async followUp(
    parentSessionId: string,
    delegationId: string,
    task: string
  ): Promise<LiveDelegationDetail> {
    this.assertStarted()
    const parent = await this.requireCapableParent(parentSessionId)
    const delegation = this.options.repository.requireOwned(parent.sessionId, delegationId)
    const child = delegation.childSessionId
      ? await this.options.sessions.resolveConversationSessionInfo(delegation.childSessionId)
      : await this.options.sessions.findDelegationChild(parent.sessionId, delegation.id)
    if (!child) {
      throw new Error(
        `Cannot continue delegation ${delegation.id} because its child is unavailable.`
      )
    }
    if (child.status === 'generating') {
      throw new Error(
        `Cannot continue delegation ${delegation.id} while child session is ${child.status}.`
      )
    }
    const created = this.options.repository.createFollowUp(
      parent.sessionId,
      delegation.id,
      nanoid(),
      task
    )
    this.publishChanged(created.delegation)
    this.scheduleTurn(created.delegation, created.turn, parent)
    return this.inspect(parent.sessionId, delegationId)
  }

  list(parentSessionId: string, limit = 20): LiveDelegationSummary[] {
    return this.options.repository
      .listByParent(parentSessionId, limit)
      .map(projectDelegationSummary)
  }

  inspect(parentSessionId: string, delegationId: string): LiveDelegationDetail {
    const delegation = this.options.repository.requireOwned(parentSessionId, delegationId)
    return {
      delegation: projectDelegationSummary(delegation),
      turns: this.options.repository.listTurns(delegation.id, 20).map(projectTurnSummary)
    }
  }

  getSummary(parentSessionId: string, delegationId: string): LiveDelegationSummary {
    return projectDelegationSummary(
      this.options.repository.requireOwned(parentSessionId, delegationId)
    )
  }

  beforeToolExecution(observation: ToolEffectObservation): void {
    const mappedTurnId = this.childToTurn.get(observation.conversationId)
    if (!mappedTurnId) return
    const turn = this.options.repository.getTurn(mappedTurnId)
    if (!turn) {
      throw new Error(
        `Live delegation effect context is unavailable for child ${observation.conversationId}.`
      )
    }
    if (!this.started) {
      throw new Error(
        'Live delegation effect evidence is unavailable while the service is stopped.'
      )
    }
    this.childToTurn.set(observation.conversationId, turn.id)
    const evidence = classifyToolEffect(observation)
    const changed = this.options.repository.recordEffectIntent(
      turn.id,
      evidence.classification,
      evidence
    )
    if (changed) this.publishChanged(changed.delegation)
  }

  async wait(
    parentSessionId: string,
    options?: {
      after?: number
      timeoutMs?: number
      delegationIds?: string[]
      signal?: AbortSignal
    }
  ): Promise<LiveDelegationWaitResult> {
    this.assertStarted()
    const after = options?.after ?? 0
    const delegationIds = options?.delegationIds
    const readEvents = () =>
      this.options.repository.listEvents(parentSessionId, {
        after,
        limit: 50,
        ...(delegationIds?.length ? { delegationIds } : {})
      })
    const existing = readEvents()
    if (existing.length > 0) return createWaitResult(existing, after, false)

    if (this.waiters.size >= MAX_WAITERS) {
      throw new Error('Too many live delegation waits are active.')
    }
    const timeoutMs = Math.min(
      Math.max(0, Math.floor(options?.timeoutMs ?? DEFAULT_WAIT_TIMEOUT_MS)),
      MAX_WAIT_TIMEOUT_MS
    )
    if (timeoutMs === 0) return createWaitResult([], after, true)
    options?.signal?.throwIfAborted()

    let timedOut = false
    await new Promise<void>((resolve, reject) => {
      let settled = false
      const finish = (error?: unknown) => {
        if (settled) return
        settled = true
        clearTimeout(timer)
        this.waiters.delete(waiter)
        options?.signal?.removeEventListener('abort', onAbort)
        if (error) reject(error)
        else resolve()
      }
      const waiter: MailboxWaiter = {
        parentSessionId,
        delegationIds: delegationIds?.length ? new Set(delegationIds) : null,
        resolve: () => finish()
      }
      const timer = setTimeout(() => {
        timedOut = true
        finish()
      }, timeoutMs)
      const onAbort = () => finish(createAbortError())
      this.waiters.add(waiter)
      options?.signal?.addEventListener('abort', onAbort, { once: true })
      if (options?.signal?.aborted) onAbort()
    })
    const events = readEvents()
    return createWaitResult(events, after, timedOut && events.length === 0)
  }

  async interrupt(parentSessionId: string, delegationId: string): Promise<LiveDelegationDetail> {
    this.assertStarted()
    const delegation = this.options.repository.requireOwned(parentSessionId, delegationId)
    const active = [...this.activeTurns.values()].find(
      (candidate) => candidate.delegationId === delegation.id
    )
    if (!active) {
      const turn = this.options.repository.listTurns(delegation.id, 1)[0]
      if (turn && isActiveTurnStatus(turn.status)) {
        const settled = this.options.repository.finishTurn({
          turnId: turn.id,
          status: 'interrupted',
          error: 'Interrupted by the parent session.'
        })
        this.publishChanged(settled.delegation)
        this.notifyMailbox(delegation.parentSessionId, delegation.id)
        const childSessionId = delegation.childSessionId
        if (childSessionId) {
          await this.options.sessions.cancelConversation(childSessionId).catch((error) => {
            console.warn('[LiveDelegationService] Failed to cancel child session:', {
              childSessionId,
              error
            })
          })
          this.childToTurn.delete(childSessionId)
        }
      }
      return this.inspect(parentSessionId, delegationId)
    }

    active.controller.abort('Interrupted by the parent session.')
    if (active.childSessionId) {
      await this.options.sessions.cancelConversation(active.childSessionId).catch((error) => {
        console.warn('[LiveDelegationService] Failed to cancel child session:', {
          childSessionId: active.childSessionId,
          error
        })
      })
    }
    await this.settle(active, {
      status: 'interrupted',
      error: 'Interrupted by the parent session.'
    })
    await active.completion.promise
    return this.inspect(parentSessionId, delegationId)
  }

  private scheduleTurn(
    delegation: LiveDelegation,
    turn: LiveDelegationTurn,
    parentSnapshot?: ConversationSessionInfo
  ): void {
    const active = this.createActiveTurn(delegation, turn)
    void this.options.admission
      .run(this.admissionOptions(active), async () => {
        await this.executeTurn(active, parentSnapshot)
      })
      .catch(async (error) => {
        await this.settle(active, {
          status: active.controller.signal.aborted ? 'interrupted' : 'failed',
          error: errorMessage(error)
        })
      })
  }

  private createActiveTurn(delegation: LiveDelegation, turn: LiveDelegationTurn): ActiveTurn {
    const existing = this.activeTurns.get(turn.id)
    if (existing) return existing
    const active: ActiveTurn = {
      delegationId: delegation.id,
      turnId: turn.id,
      parentSessionId: delegation.parentSessionId,
      childSessionId: delegation.childSessionId,
      controller: new AbortController(),
      completion: createDeferred(),
      responseMarkdown: '',
      runtimeStatus: null,
      started: false,
      settling: false
    }
    this.activeTurns.set(turn.id, active)
    if (active.childSessionId) this.childToTurn.set(active.childSessionId, turn.id)
    return active
  }

  private admissionOptions(active: ActiveTurn): AgentInvocationAdmissionOptions {
    return {
      ownerId: `live-delegation:${active.parentSessionId}`,
      maxActiveForOwner: LIVE_DELEGATION_OWNER_LIMIT,
      signal: active.controller.signal
    }
  }

  private async executeTurn(
    active: ActiveTurn,
    parentSnapshot?: ConversationSessionInfo
  ): Promise<void> {
    active.controller.signal.throwIfAborted()
    const delegation = this.options.repository.require(active.delegationId)
    const turn = this.options.repository.requireTurn(active.turnId)
    const parent = parentSnapshot ?? (await this.requireCapableParent(delegation.parentSessionId))
    let child = delegation.childSessionId
      ? await this.options.sessions.resolveConversationSessionInfo(delegation.childSessionId)
      : await this.options.sessions.findDelegationChild(delegation.parentSessionId, delegation.id)

    if (!child) {
      const inheritedWorkspace =
        (await this.options.sessions.resolveConversationWorkdir(parent.sessionId))?.trim() ||
        parent.projectDir?.trim() ||
        null
      child = await this.options.sessions.createSubagentSession({
        parentSessionId: parent.sessionId,
        agentId: delegation.targetAgentId,
        parentAgentId: parent.agentId,
        slotId: delegation.slotId,
        displayName: delegation.title,
        targetAgentId: delegation.targetAgentId,
        projectDir: inheritedWorkspace,
        providerId: parent.providerId,
        modelId: parent.modelId,
        permissionMode: parent.permissionMode,
        generationSettings: parent.generationSettings ?? undefined,
        disabledAgentTools: parent.disabledAgentTools,
        activeSkills: parent.activeSkills,
        liveDelegationContext: { delegationId: delegation.id }
      })
    }
    if (!child) throw new Error(`Failed to create child session for delegation ${delegation.id}.`)
    active.controller.signal.throwIfAborted()
    if (turn.kind === 'follow_up' && child.status === 'generating') {
      throw new Error(
        `Cannot continue delegation ${delegation.id} while child session is ${child.status}.`
      )
    }
    const bound = this.options.repository.bindChild(delegation.id, child.sessionId)
    active.childSessionId = child.sessionId
    this.childToTurn.set(child.sessionId, active.turnId)
    this.publishChanged(bound)
    active.controller.signal.throwIfAborted()

    await this.options.sessions.sendConversationMessage(
      child.sessionId,
      buildTurnHandoff(bound, turn)
    )
    this.options.repository.markTurnStarted(turn.id)
    active.started = true
    this.publishChanged(this.options.repository.require(active.delegationId))
    if (active.controller.signal.aborted) {
      await this.options.sessions.cancelConversation(child.sessionId).catch(() => undefined)
      await this.settle(active, {
        status: 'interrupted',
        error: abortReason(active.controller.signal)
      })
      return
    }
    await this.applyRuntimeStatus(active)
    await active.completion.promise
  }

  private handleRuntimeUpdate(update: SessionRuntimeUpdate): void {
    const turnId = this.childToTurn.get(update.sessionId)
    if (!turnId) return
    const active = this.activeTurns.get(turnId)
    if (!active || active.settling) return

    if (update.kind === 'blocks') {
      if (update.responseMarkdown?.trim()) {
        active.responseMarkdown = truncateUtf8(
          update.responseMarkdown.trim(),
          LIVE_DELEGATION_MAX_SUMMARY_BYTES
        )
      }
      if (update.waitingInteraction?.type === 'permission') {
        this.options.repository.markTurnWaiting(
          active.turnId,
          'waiting_permission',
          update.updatedAt
        )
        this.publishChanged(this.options.repository.require(active.delegationId))
      } else if (update.waitingInteraction?.type === 'question') {
        this.options.repository.markTurnWaiting(active.turnId, 'waiting_question', update.updatedAt)
        this.publishChanged(this.options.repository.require(active.delegationId))
      } else if (active.started && active.runtimeStatus === 'generating') {
        const turn = this.options.repository.requireTurn(active.turnId)
        if (turn.status === 'waiting_permission' || turn.status === 'waiting_question') {
          this.options.repository.markTurnStarted(active.turnId, update.updatedAt)
          this.publishChanged(this.options.repository.require(active.delegationId))
        }
      }
      return
    }
    if (update.status) active.runtimeStatus = update.status
    void this.applyRuntimeStatus(active).catch((error) => {
      console.error('[LiveDelegationService] Failed to apply child status:', {
        delegationId: active.delegationId,
        turnId: active.turnId,
        error
      })
    })
  }

  private async applyRuntimeStatus(active: ActiveTurn): Promise<void> {
    if (!active.started || active.settling) return
    if (active.controller.signal.aborted) {
      await this.settle(active, {
        status: 'interrupted',
        error: abortReason(active.controller.signal)
      })
      return
    }
    if (active.runtimeStatus === 'error') {
      await this.settle(active, { status: 'failed', error: 'Child session failed.' })
    } else if (active.runtimeStatus === 'idle') {
      await this.settle(active, { status: 'completed' })
    } else if (active.runtimeStatus === 'generating') {
      const turn = this.options.repository.requireTurn(active.turnId)
      if (turn.status === 'waiting_permission' || turn.status === 'waiting_question') return
      if (turn.status === 'queued') {
        this.options.repository.markTurnStarted(active.turnId)
        this.publishChanged(this.options.repository.require(active.delegationId))
      }
    }
  }

  private async settle(
    active: ActiveTurn,
    outcome: {
      status: 'completed' | 'failed' | 'cancelled' | 'interrupted'
      error?: string | null
    }
  ): Promise<void> {
    if (active.settling) return await active.completion.promise
    active.settling = true
    try {
      const delegation = this.options.repository.require(active.delegationId)
      let summary = active.responseMarkdown.trim()
      if (!summary && active.childSessionId) {
        summary =
          (await this.options.sessions.getLatestAssistantResponse(active.childSessionId))?.trim() ||
          ''
      }
      summary = truncateUtf8(summary, LIVE_DELEGATION_MAX_SUMMARY_BYTES)
      let status = active.controller.signal.aborted ? 'interrupted' : outcome.status
      let error = outcome.error?.trim() || null
      let tapeReceipt: SubagentTapeLinkReceipt | null = null
      if (active.childSessionId && active.started) {
        try {
          tapeReceipt = await this.options.sessions.linkSubagentTape({
            parentSessionId: delegation.parentSessionId,
            childSessionId: active.childSessionId,
            runId: delegation.id,
            taskId: active.turnId,
            slotId: delegation.slotId,
            taskTitle: delegation.title,
            outcome:
              status === 'completed' ? 'completed' : status === 'failed' ? 'error' : 'cancelled',
            resultSummary: summary || null
          })
        } catch (tapeError) {
          status = 'failed'
          error = `Failed to freeze child Tape lineage: ${errorMessage(tapeError)}`
        }
      }
      error = error ? truncateUtf8(error, LIVE_DELEGATION_MAX_SUMMARY_BYTES) : null
      const settled = this.options.repository.finishTurn({
        turnId: active.turnId,
        status,
        summary: summary || null,
        error,
        tapeReceipt
      })
      this.publishChanged(settled.delegation)
      this.notifyMailbox(settled.delegation.parentSessionId, settled.delegation.id)
    } catch (error) {
      console.error('[LiveDelegationService] Failed to settle child turn:', {
        delegationId: active.delegationId,
        turnId: active.turnId,
        error
      })
    } finally {
      if (active.childSessionId) this.childToTurn.delete(active.childSessionId)
      this.activeTurns.delete(active.turnId)
      active.completion.resolve()
    }
  }

  private async reconcileActiveTurns(records: ActiveLiveDelegationTurn[]): Promise<void> {
    for (const record of records) {
      if (!this.started) return
      try {
        await this.reconcileActiveTurn(record)
      } catch (error) {
        this.failReconciliation(record, error)
      }
    }
  }

  private async reconcileActiveTurn(record: ActiveLiveDelegationTurn): Promise<void> {
    const child = record.delegation.childSessionId
      ? await this.options.sessions.resolveConversationSessionInfo(record.delegation.childSessionId)
      : await this.options.sessions.findDelegationChild(
          record.delegation.parentSessionId,
          record.delegation.id
        )
    if (!this.started) return
    const turn = this.options.repository.getTurn(record.turn.id)
    if (!turn || !isActiveTurnStatus(turn.status)) {
      if (record.delegation.childSessionId) {
        this.childToTurn.delete(record.delegation.childSessionId)
      }
      return
    }
    let delegation = this.options.repository.require(record.delegation.id)
    if (child && !delegation.childSessionId) {
      delegation = this.options.repository.bindChild(delegation.id, child.sessionId)
    }
    if (!child) {
      const settled = this.options.repository.finishTurn({
        turnId: turn.id,
        status: 'interrupted',
        error: 'Host restarted before the child session could be recovered.'
      })
      this.publishChanged(settled.delegation)
      this.notifyMailbox(settled.delegation.parentSessionId, settled.delegation.id)
      if (delegation.childSessionId) this.childToTurn.delete(delegation.childSessionId)
      return
    }

    const active = this.createActiveTurn(delegation, turn)
    active.childSessionId = child.sessionId
    active.started = turn.startedAt !== null || child.status === 'generating'
    active.runtimeStatus = child.status
    this.childToTurn.set(child.sessionId, turn.id)
    if (child.status === 'generating') {
      if (turn.startedAt === null) {
        this.options.repository.markTurnStarted(turn.id)
      }
      void this.options.admission
        .run(this.admissionOptions(active), async () => await active.completion.promise)
        .catch(async (error) => {
          await this.settle(active, {
            status: active.controller.signal.aborted ? 'interrupted' : 'failed',
            error: errorMessage(error)
          })
        })
      return
    }
    if (turn.startedAt === null) {
      const settled = this.options.repository.finishTurn({
        turnId: turn.id,
        status: 'interrupted',
        error: 'Host restarted before child handoff acceptance was recorded.'
      })
      this.publishChanged(settled.delegation)
      this.notifyMailbox(settled.delegation.parentSessionId, settled.delegation.id)
      this.childToTurn.delete(child.sessionId)
      this.activeTurns.delete(turn.id)
      active.completion.resolve()
      return
    }
    await this.settle(active, {
      status: child.status === 'error' ? 'failed' : 'completed',
      ...(child.status === 'error' ? { error: 'Child session was in an error state.' } : {})
    })
  }

  private failReconciliation(record: ActiveLiveDelegationTurn, error: unknown): void {
    console.error('[LiveDelegationService] Failed to reconcile child turn:', {
      delegationId: record.delegation.id,
      turnId: record.turn.id,
      error
    })
    if (!this.started) return
    try {
      const current = this.options.repository.getTurn(record.turn.id)
      if (!current || !isActiveTurnStatus(current.status)) {
        if (record.delegation.childSessionId) {
          this.childToTurn.delete(record.delegation.childSessionId)
        }
        return
      }
      const settled = this.options.repository.finishTurn({
        turnId: current.id,
        status: 'interrupted',
        error: truncateUtf8(
          `Failed to reconcile after restart: ${errorMessage(error)}`,
          LIVE_DELEGATION_MAX_SUMMARY_BYTES
        )
      })
      if (record.delegation.childSessionId) {
        this.childToTurn.delete(record.delegation.childSessionId)
      }
      this.publishChanged(settled.delegation)
      this.notifyMailbox(settled.delegation.parentSessionId, settled.delegation.id)
    } catch (settleError) {
      console.error('[LiveDelegationService] Failed to persist reconciliation error:', {
        delegationId: record.delegation.id,
        turnId: record.turn.id,
        error: settleError
      })
    }
  }

  private async requireCapableParent(parentSessionId: string): Promise<CapableParent> {
    const parent = await this.options.sessions.resolveConversationSessionInfo(parentSessionId)
    if (!parent) throw new Error(`Conversation not found: ${parentSessionId}`)
    if (
      parent.agentType !== 'deepchat' ||
      parent.sessionKind !== 'regular' ||
      !parent.subagentCapability.available
    ) {
      const reason = parent.subagentCapability.available
        ? 'unsupported_session'
        : parent.subagentCapability.reason
      throw new Error(`Live delegation is unavailable for the current session (${reason}).`)
    }
    return parent as CapableParent
  }

  private publishChanged(delegation: LiveDelegation): void {
    try {
      this.options.onChanged?.(delegation.parentSessionId, delegation.id)
    } catch (error) {
      console.warn('[LiveDelegationService] Failed to publish delegation update:', error)
    }
  }

  private notifyMailbox(parentSessionId: string, delegationId: string): void {
    for (const waiter of this.waiters) {
      if (
        waiter.parentSessionId === parentSessionId &&
        (!waiter.delegationIds || waiter.delegationIds.has(delegationId))
      ) {
        waiter.resolve()
      }
    }
  }

  private assertStarted(): void {
    if (!this.started) throw new Error('Live delegation service is not running.')
  }
}

function buildTurnHandoff(delegation: LiveDelegation, turn: LiveDelegationTurn): string {
  return [
    '# DeepChat Live Delegation',
    '',
    `Delegation: ${delegation.id}`,
    `Turn: ${turn.seq}`,
    `Task: ${delegation.title}`,
    '',
    turn.prompt,
    '',
    'Return concise markdown with these sections:',
    '## Result',
    '## Evidence',
    '## Changed Files',
    '## Validation',
    '## Unresolved',
    'Use `None` when a section has no entries.',
    '',
    'Rules:',
    '- You are a direct child Session with isolated context.',
    '- Do not assume access to the parent transcript.',
    '- Do not create additional Subagents.',
    '- Avoid writing files unless the delegated task requires it.',
    '- Ask for permission or clarification through the normal tool flow.'
  ].join('\n')
}

function createDeferred(): { promise: Promise<void>; resolve: () => void } {
  let resolve: () => void = () => undefined
  const promise = new Promise<void>((innerResolve) => {
    resolve = () => innerResolve()
  })
  return { promise, resolve }
}

function createWaitResult(
  events: LiveDelegationEvent[],
  priorCursor: number,
  timedOut: boolean
): LiveDelegationWaitResult {
  return {
    events: events.map(projectEventSummary),
    cursor: events.at(-1)?.id ?? priorCursor,
    timedOut
  }
}

function projectEventSummary(event: LiveDelegationEvent): LiveDelegationEventSummary {
  const { content, ...identity } = event
  return {
    ...identity,
    contentPreview: truncateUtf8(content, MAX_MODEL_PREVIEW_BYTES),
    contentTruncated: Buffer.byteLength(content, 'utf8') > MAX_MODEL_PREVIEW_BYTES
  }
}

function projectDelegationSummary(delegation: LiveDelegation): LiveDelegationSummary {
  const { lastSummary, lastError, ...identity } = delegation
  return {
    ...identity,
    summaryPreview: lastSummary ? truncateUtf8(lastSummary, MAX_MODEL_PREVIEW_BYTES) : null,
    errorPreview: lastError ? truncateUtf8(lastError, MAX_MODEL_PREVIEW_BYTES) : null
  }
}

function projectTurnSummary(turn: LiveDelegationTurn): LiveDelegationTurnSummary {
  const { prompt, resultSummary, error, ...identity } = turn
  return {
    ...identity,
    promptPreview: truncateUtf8(prompt, MAX_MODEL_PREVIEW_BYTES),
    resultPreview: resultSummary ? truncateUtf8(resultSummary, MAX_MODEL_PREVIEW_BYTES) : null,
    errorPreview: error ? truncateUtf8(error, MAX_MODEL_PREVIEW_BYTES) : null
  }
}

function truncateUtf8(value: string, maxBytes: number): string {
  const encoded = Buffer.from(value, 'utf8')
  if (encoded.byteLength <= maxBytes) return value
  return encoded
    .subarray(0, maxBytes)
    .toString('utf8')
    .replace(/\uFFFD$/u, '')
}

function createAbortError(): Error {
  const error = new Error('Live delegation wait was cancelled.')
  error.name = 'AbortError'
  return error
}

function abortReason(signal: AbortSignal): string {
  return typeof signal.reason === 'string' && signal.reason.trim()
    ? signal.reason.trim()
    : 'Live delegation was interrupted.'
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function isActiveTurnStatus(status: LiveDelegationTurn['status']): boolean {
  return (
    status === 'queued' ||
    status === 'running' ||
    status === 'waiting_permission' ||
    status === 'waiting_question'
  )
}
