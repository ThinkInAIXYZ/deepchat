import { Buffer } from 'node:buffer'
import { createHash } from 'node:crypto'
import { nanoid } from 'nanoid'
import { approximateTokenSize } from 'tokenx'
import { z } from 'zod'
import {
  LIVE_DELEGATION_HANDOFF_TOKEN_BUDGET,
  LIVE_DELEGATION_MAX_WAITS_PER_PARENT,
  LIVE_DELEGATION_MAX_HANDOFF_BYTES,
  LIVE_DELEGATION_RESULT_CURSOR_MAX_LENGTH,
  LIVE_DELEGATION_RESULT_PAGE_DEFAULT_TOKENS,
  LIVE_DELEGATION_RESULT_PAGE_MAX_BYTES,
  LIVE_DELEGATION_RESULT_PAGE_MAX_TOKENS,
  type LiveDelegation,
  type LiveDelegationDetail,
  type LiveDelegationEvent,
  type LiveDelegationEventSummary,
  type LiveDelegationResultPage,
  type LiveDelegationResultRef,
  type LiveDelegationSummary,
  type LiveDelegationTurn,
  type LiveDelegationTurnSummary
} from '@shared/orchestration/liveDelegation'
import { projectFinalAnswerFromDeliverySegments } from '@shared/lib/assistantDeliverySegments'
import type {
  AgentInvocationAdmissionPort,
  AgentInvocationLease
} from '@/agent/invocationAdmission'
import { awaitWithAbort } from '@/lib/awaitWithAbort'
import type {
  AgentSubagentToolPort,
  AgentToolSessionPort,
  CreateSubagentSessionInput,
  ConversationSessionInfo
} from '@/tool/runtimePorts'
import type {
  DeepChatSubagentCapability,
  PermissionMode,
  SubagentTapeLinkReceipt
} from '@shared/types/agent-interface'
import type { SessionRuntimeUpdate } from '@/session/runtimeEvents'
import type { SessionDeletionGatePort } from '@/session/deletionGate'
import { classifyToolEffect } from '@/tool/effectClassification'
import type { ToolEffectObservation } from '@/tool/effectObserver'
import { resolveToolPermissionMode } from '@/tool/permission/permissionMode'
import type { ActiveLiveDelegationTurn, LiveDelegationRepository } from './liveDelegationRepository'
import type {
  LiveDelegationSafetyPort,
  LiveDelegationTurnExecutionSnapshot
} from './liveDelegationSafety'
import { normalizeOrchestrationPolicy } from '@shared/orchestration/policy'
import type {
  LiveDelegationConsentReceipt,
  LiveDelegationConsentVerifier
} from './liveDelegationConsent'

const MAX_WAITERS = 32
const DEFAULT_WAIT_TIMEOUT_MS = 30_000
const MAX_WAIT_TIMEOUT_MS = 60_000
const MAX_MODEL_PREVIEW_BYTES = 2 * 1024
const MAX_MODEL_EVENT_BYTES = 16 * 1024
const MAX_MODEL_WAIT_BYTES = 32 * 1024
const LIVE_DELEGATION_OWNER_LIMIT = 5
const HANDOFF_TRUNCATION_NOTICE =
  '[Handoff truncated. Use deepchat_subagents read_result for the complete child answer.]'
const UNREFERENCED_HANDOFF_TRUNCATION_NOTICE =
  '[Handoff truncated. The complete answer is available only in the child Session.]'

const ResultCursorSchema = z
  .object({
    v: z.literal(1),
    turnId: z.string().trim().min(1).max(256),
    answerSha256: z.string().regex(/^[0-9a-f]{64}$/u),
    offset: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER)
  })
  .strict()
const ResultPageTokenBudgetSchema = z
  .number()
  .int()
  .min(1)
  .max(LIVE_DELEGATION_RESULT_PAGE_MAX_TOKENS)

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

export interface LiveDelegationAssistantResult {
  messageId: string
  answerMarkdown: string
  updatedAt: number
}

export interface LiveDelegationServiceSessionPort
  extends AgentToolSessionPort, AgentSubagentToolPort {
  findDelegationChild(
    parentSessionId: string,
    delegationId: string
  ): Promise<ConversationSessionInfo | null>
  getAssistantResult(
    sessionId: string,
    messageId?: string
  ): Promise<LiveDelegationAssistantResult | null>
}

export interface LiveDelegationServiceOptions {
  repository: LiveDelegationRepository
  sessions: LiveDelegationServiceSessionPort
  admission: AgentInvocationAdmissionPort
  deletionGate: Pick<SessionDeletionGatePort, 'runWithSessionOperation'>
  safety: LiveDelegationSafetyPort
  consent: LiveDelegationConsentVerifier
  onChanged?: (parentSessionId: string, delegationId: string) => void
}

type ActiveTurn = {
  delegationId: string
  turnId: string
  parentSessionId: string
  childSessionId: string | null
  childAcquisition: Promise<AcquiredChild> | null
  childHandoff: Promise<void> | null
  controller: AbortController
  admissionLease: AgentInvocationLease
  completion: ReturnType<typeof createDeferred>
  answerMarkdown: string
  childMessageId: string | null
  runtimeStatus: 'idle' | 'generating' | 'error' | null
  started: boolean
  settling: boolean
}

type AcquiredChild = {
  child: ConversationSessionInfo
  delegation: LiveDelegation
}

type CurrentDelegationSafety = {
  parent: CapableParent
  projectDir: string | null
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
  private readonly childSafetyTails = new Map<string, Promise<void>>()
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
    await Promise.allSettled(this.childSafetyTails.values())
    const pendingChildWork = active.flatMap((turn) =>
      [turn.childAcquisition, turn.childHandoff].filter(
        (work): work is Promise<AcquiredChild> | Promise<void> => work !== null
      )
    )
    const cancellationWork = active
      .filter((turn) => turn.childSessionId)
      .map((turn) => this.cancelActiveChild(turn, 'service stop'))
    await Promise.allSettled([...cancellationWork, ...pendingChildWork])
    await Promise.allSettled(
      active.map((turn) =>
        this.settle(turn, {
          status: 'interrupted',
          error: 'Live delegation service stopped.'
        })
      )
    )
    this.activeTurns.clear()
    this.childToTurn.clear()
    this.childSafetyTails.clear()
    for (const waiter of this.waiters) waiter.resolve()
    this.waiters.clear()
  }

  async spawn(
    parentSessionId: string,
    input: SpawnLiveDelegationInput,
    authorization?: LiveDelegationConsentReceipt,
    beforeMutation?: () => void
  ): Promise<LiveDelegationDetail> {
    return await this.options.deletionGate.runWithSessionOperation(
      parentSessionId,
      async () =>
        await this.spawnUnderDeletionGate(parentSessionId, input, authorization, beforeMutation)
    )
  }

  private async spawnUnderDeletionGate(
    parentSessionId: string,
    input: SpawnLiveDelegationInput,
    authorization?: LiveDelegationConsentReceipt,
    beforeMutation?: () => void
  ): Promise<LiveDelegationDetail> {
    this.assertStarted()
    const parent = await this.requireCapableParent(parentSessionId)
    this.assertStartAuthorized(parent, 'spawn', authorization)
    const slot = parent.subagentCapability.slots.find((candidate) => candidate.id === input.slotId)
    if (!slot) throw new Error(`Subagent slot not found or not enabled: ${input.slotId}`)
    const targetAgentId =
      slot.targetType === 'self' ? parent.agentId : (slot.targetAgentId?.trim() ?? '')
    if (!targetAgentId) throw new Error(`Subagent slot is missing a target agent: ${slot.id}`)

    const delegationId = nanoid()
    const turnId = nanoid()
    const executionSnapshot = createTurnExecutionSnapshot(parent)
    const created = this.runAuthorizedStartMutation(parent, 'spawn', authorization, () =>
      this.options.repository.create(
        {
          id: delegationId,
          initialTurnId: turnId,
          parentSessionId: parent.sessionId,
          slotId: slot.id,
          targetAgentId,
          title: input.title,
          prompt: input.prompt
        },
        beforeMutation
      )
    )
    this.publishChanged(created.delegation)
    this.scheduleTurn(created.delegation, created.turn, executionSnapshot)
    return this.inspect(parent.sessionId, delegationId)
  }

  send(
    parentSessionId: string,
    delegationId: string,
    message: string,
    beforeMutation?: () => void
  ): LiveDelegationDetail {
    this.assertStarted()
    this.options.repository.requireOwned(parentSessionId, delegationId)
    const event = this.options.repository.createMessage(
      parentSessionId,
      delegationId,
      message,
      beforeMutation
    )
    this.publishChanged(this.options.repository.require(event.delegationId))
    return this.inspect(parentSessionId, delegationId)
  }

  async followUp(
    parentSessionId: string,
    delegationId: string,
    task: string,
    authorization?: LiveDelegationConsentReceipt,
    beforeMutation?: () => void
  ): Promise<LiveDelegationDetail> {
    return await this.options.deletionGate.runWithSessionOperation(
      parentSessionId,
      async () =>
        await this.followUpUnderParentGate(
          parentSessionId,
          delegationId,
          task,
          authorization,
          beforeMutation
        )
    )
  }

  private async followUpUnderParentGate(
    parentSessionId: string,
    delegationId: string,
    task: string,
    authorization?: LiveDelegationConsentReceipt,
    beforeMutation?: () => void
  ): Promise<LiveDelegationDetail> {
    this.assertStarted()
    const parent = await this.requireCapableParent(parentSessionId)
    this.assertStartAuthorized(parent, 'follow_up', authorization)
    const delegation = this.options.repository.requireOwned(parent.sessionId, delegationId)
    const discoveredChild = delegation.childSessionId
      ? await this.options.sessions.resolveConversationSessionInfo(delegation.childSessionId)
      : await this.options.sessions.findDelegationChild(parent.sessionId, delegation.id)
    if (!discoveredChild) {
      throw new Error(
        `Cannot continue delegation ${delegation.id} because its child is unavailable.`
      )
    }
    return await this.options.deletionGate.runWithSessionOperation(
      discoveredChild.sessionId,
      async () => {
        await this.resolveCurrentSafety(delegation)
        const child = await this.options.sessions.resolveConversationSessionInfo(
          discoveredChild.sessionId
        )
        if (!child) {
          throw new Error(
            `Cannot continue delegation ${delegation.id} because its child is unavailable.`
          )
        }
        assertDelegationChildLineage(child, delegation)
        if (child.status === 'generating') {
          throw new Error(
            `Cannot continue delegation ${delegation.id} while child session is ${child.status}.`
          )
        }
        const currentParent = await this.requireCapableParent(parent.sessionId)
        const created = this.runAuthorizedStartMutation(
          currentParent,
          'follow_up',
          authorization,
          () =>
            this.options.repository.createFollowUp(
              currentParent.sessionId,
              delegation.id,
              nanoid(),
              task,
              undefined,
              beforeMutation
            )
        )
        this.publishChanged(created.delegation)
        this.scheduleTurn(created.delegation, created.turn, createTurnExecutionSnapshot(child))
        return this.inspect(parent.sessionId, delegationId)
      }
    )
  }

  private assertStartAuthorized(
    parent: CapableParent,
    operation: 'spawn' | 'follow_up',
    authorization: LiveDelegationConsentReceipt | undefined
  ): void {
    const expectation = { parentSessionId: parent.sessionId, operation }
    if (authorization) {
      if (this.options.consent.isValid(authorization, expectation)) return
      throw new Error(`Live delegation authorization is invalid for ${operation}.`)
    }
    if (normalizeOrchestrationPolicy(parent.orchestrationPolicy) === 'proactive') return
    throw new Error(
      `Explicit collaboration requires current user confirmation before ${operation}.`
    )
  }

  private runAuthorizedStartMutation<T>(
    parent: CapableParent,
    operation: 'spawn' | 'follow_up',
    authorization: LiveDelegationConsentReceipt | undefined,
    mutation: () => T
  ): T {
    const expectation = { parentSessionId: parent.sessionId, operation }
    if (authorization) {
      const result = this.options.consent.runAuthorizedMutation(
        authorization,
        expectation,
        mutation
      )
      if (result.authorized) return result.value
      throw new Error(`Live delegation authorization is invalid for ${operation}.`)
    }
    if (normalizeOrchestrationPolicy(parent.orchestrationPolicy) === 'proactive') {
      return mutation()
    }
    throw new Error(
      `Explicit collaboration requires current user confirmation before ${operation}.`
    )
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

  async readResult(
    parentSessionId: string,
    delegationId: string,
    options?: { turnId?: string; cursor?: string; maxTokens?: number }
  ): Promise<LiveDelegationResultPage> {
    this.assertStarted()
    const delegation = this.options.repository.requireOwned(parentSessionId, delegationId)
    const cursor = options?.cursor ? decodeResultCursor(options.cursor) : null
    const requestedTurnId = options?.turnId?.trim() || null
    if (requestedTurnId && cursor && requestedTurnId !== cursor.turnId) {
      throw new Error('Live delegation result cursor belongs to another turn.')
    }
    const turnId = requestedTurnId ?? cursor?.turnId ?? null
    const turn = turnId
      ? this.options.repository.getTurn(turnId)
      : this.options.repository.listTurns(delegation.id, 1)[0]
    if (!turn || turn.delegationId !== delegation.id) {
      throw new Error('Live delegation result turn does not belong to the requested delegation.')
    }
    const resultRef = turn.resultRef
    if (!resultRef) {
      throw new Error(
        `Turn ${turn.id} has no durable full-result reference. Use its bounded result preview instead.`
      )
    }
    if (cursor && cursor.answerSha256 !== resultRef.answerSha256) {
      throw new Error('Live delegation result cursor no longer matches the stored result.')
    }

    const result = await this.options.sessions.getAssistantResult(
      resultRef.childSessionId,
      resultRef.childMessageId
    )
    if (!result || result.messageId !== resultRef.childMessageId) {
      throw new Error(`Referenced child result is unavailable for turn ${turn.id}.`)
    }
    const answer = result.answerMarkdown.trim()
    const answerSha256 = hashAnswer(answer)
    const answerBytes = Buffer.byteLength(answer, 'utf8')
    if (answerSha256 !== resultRef.answerSha256 || answerBytes !== resultRef.answerBytes) {
      throw new Error(`Referenced child result failed integrity verification for turn ${turn.id}.`)
    }

    const maxTokens = ResultPageTokenBudgetSchema.parse(
      options?.maxTokens ?? LIVE_DELEGATION_RESULT_PAGE_DEFAULT_TOKENS
    )
    const offset = cursor?.offset ?? 0
    const page = takeResultPage(answer, offset, maxTokens)
    return {
      schemaVersion: 1,
      delegationId: delegation.id,
      turnId: turn.id,
      turnSeq: turn.seq,
      childSessionId: resultRef.childSessionId,
      childMessageId: resultRef.childMessageId,
      answerSha256,
      answerBytes,
      answerEstimatedTokens: resultRef.answerEstimatedTokens,
      text: page.text,
      nextCursor:
        page.nextOffset === null
          ? null
          : encodeResultCursor({
              v: 1,
              turnId: turn.id,
              answerSha256,
              offset: page.nextOffset
            }),
      done: page.nextOffset === null
    }
  }

  getSummary(parentSessionId: string, delegationId: string): LiveDelegationSummary {
    return projectDelegationSummary(
      this.options.repository.requireOwned(parentSessionId, delegationId)
    )
  }

  async prepareSessionDeletion(sessionId: string): Promise<void> {
    const normalizedSessionId = sessionId.trim()
    if (!normalizedSessionId) throw new Error('Session deletion requires a Session ID.')
    if (!this.started) return

    const delegationIds = new Set<string>()
    for (const record of this.options.repository.listActiveTurns()) {
      if (
        record.delegation.parentSessionId === normalizedSessionId ||
        record.delegation.childSessionId === normalizedSessionId
      ) {
        delegationIds.add(record.delegation.id)
      }
    }
    for (const active of this.activeTurns.values()) {
      if (
        active.parentSessionId === normalizedSessionId ||
        active.childSessionId === normalizedSessionId
      ) {
        delegationIds.add(active.delegationId)
      }
    }

    const failures: unknown[] = []
    for (const delegationId of delegationIds) {
      const delegation = this.options.repository.get(delegationId)
      if (!delegation) continue
      try {
        await this.interruptDelegation(
          delegation,
          'Interrupted because a related Session was deleted.'
        )
      } catch (error) {
        failures.push(error)
      }
    }
    if (failures.length > 0) {
      throw new AggregateError(
        failures,
        `Failed to interrupt ${failures.length} live delegation(s) before Session deletion.`
      )
    }
  }

  async beforeToolExecution(
    observation: ToolEffectObservation,
    signal?: AbortSignal
  ): Promise<void> {
    const mappedTurnId = this.childToTurn.get(observation.conversationId)
    if (!mappedTurnId) return
    const admission = await this.prepareChildBoundary(observation.conversationId, signal)
    if (
      observation.authorizedPermissionMode &&
      observation.authorizedPermissionMode !==
        resolveToolPermissionMode(admission.child.permissionMode)
    ) {
      const error = new Error(
        `Permission mode changed before tool dispatch for child ${observation.conversationId}.`
      )
      await this.interruptUnverifiedTurn(admission.active, error)
      throw error
    }
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
    if (admission.active.admissionLease.state !== 'active') {
      throw new Error(
        `Live delegation child ${observation.conversationId} has no active invocation permit.`
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

  async beforeToolAuthorization(
    observation: ToolEffectObservation,
    signal?: AbortSignal
  ): Promise<PermissionMode | null> {
    if (!this.childToTurn.has(observation.conversationId)) return null
    const { child } = await this.prepareChildBoundary(observation.conversationId, signal)
    return resolveToolPermissionMode(child.permissionMode)
  }

  async beforeInteractionContinuation(
    childSessionId: string,
    signal?: AbortSignal
  ): Promise<boolean> {
    if (!this.childToTurn.has(childSessionId)) return false
    const admission = await this.prepareChildBoundary(childSessionId, signal)
    return admission?.resumed === true
  }

  suspendInteractionContinuation(childSessionId: string): void {
    const turnId = this.childToTurn.get(childSessionId)
    const active = turnId ? this.activeTurns.get(turnId) : null
    if (!active || active.settling) return
    const turn = this.options.repository.getTurn(active.turnId)
    if (turn?.status === 'waiting_permission' || turn?.status === 'waiting_question') {
      active.admissionLease.suspend()
    }
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

    const timeoutMs = Math.min(
      Math.max(0, Math.floor(options?.timeoutMs ?? DEFAULT_WAIT_TIMEOUT_MS)),
      MAX_WAIT_TIMEOUT_MS
    )
    if (timeoutMs === 0) return createWaitResult([], after, true)
    options?.signal?.throwIfAborted()
    if (this.waiters.size >= MAX_WAITERS) {
      throw new Error('Too many live delegation waits are active.')
    }
    const parentWaiters = [...this.waiters].filter(
      (waiter) => waiter.parentSessionId === parentSessionId
    ).length
    if (parentWaiters >= LIVE_DELEGATION_MAX_WAITS_PER_PARENT) {
      throw new Error('Too many live delegation waits are active for this session.')
    }

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
      if (!settled) {
        try {
          if (readEvents().length > 0) finish()
        } catch (error) {
          finish(error)
        }
      }
    })
    const events = readEvents()
    return createWaitResult(events, after, timedOut && events.length === 0)
  }

  async interrupt(
    parentSessionId: string,
    delegationId: string,
    beforeMutation?: () => void
  ): Promise<LiveDelegationDetail> {
    this.assertStarted()
    const delegation = this.options.repository.requireOwned(parentSessionId, delegationId)
    return await this.interruptDelegation(
      delegation,
      'Interrupted by the parent session.',
      beforeMutation
    )
  }

  private async interruptDelegation(
    delegation: LiveDelegation,
    reason: string,
    beforeMutation?: () => void
  ): Promise<LiveDelegationDetail> {
    const active = [...this.activeTurns.values()].find(
      (candidate) => candidate.delegationId === delegation.id
    )
    if (!active) {
      const turn = this.options.repository.listTurns(delegation.id, 1)[0]
      if (turn && isActiveTurnStatus(turn.status)) {
        const settled = this.options.repository.finishTurn({
          turnId: turn.id,
          status: 'interrupted',
          error: reason,
          beforeMutation
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
      return this.inspect(delegation.parentSessionId, delegation.id)
    }

    beforeMutation?.()
    active.controller.abort(reason)
    const pendingChildAcquisition = active.childAcquisition
    const pendingChildHandoff = active.childHandoff
    const cancellation = active.childSessionId ? this.cancelActiveChild(active, reason) : null
    await Promise.allSettled(
      [pendingChildAcquisition, pendingChildHandoff, cancellation].filter(
        (work): work is Promise<AcquiredChild> | Promise<void> => work !== null
      )
    )
    await this.settle(active, {
      status: 'interrupted',
      error: reason
    })
    await active.completion.promise
    return this.inspect(delegation.parentSessionId, delegation.id)
  }

  private scheduleTurn(
    delegation: LiveDelegation,
    turn: LiveDelegationTurn,
    executionSnapshot: LiveDelegationTurnExecutionSnapshot
  ): void {
    const active = this.createActiveTurn(delegation, turn)
    void this.runWithAdmission(active, async () => {
      await this.executeTurn(active, executionSnapshot)
    })
  }

  private async runWithAdmission(active: ActiveTurn, task: () => Promise<void>): Promise<void> {
    try {
      await active.admissionLease.resume()
      await task()
    } catch (error) {
      if (
        active.admissionLease.state === 'suspended' &&
        !active.controller.signal.aborted &&
        !active.settling
      ) {
        return
      }
      await this.settle(active, {
        status: active.controller.signal.aborted ? 'interrupted' : 'failed',
        error: errorMessage(error)
      })
    }
  }

  private createActiveTurn(delegation: LiveDelegation, turn: LiveDelegationTurn): ActiveTurn {
    const existing = this.activeTurns.get(turn.id)
    if (existing) return existing
    const controller = new AbortController()
    const active: ActiveTurn = {
      delegationId: delegation.id,
      turnId: turn.id,
      parentSessionId: delegation.parentSessionId,
      childSessionId: delegation.childSessionId,
      childAcquisition: null,
      childHandoff: null,
      controller,
      admissionLease: this.options.admission.createLease({
        ownerId: `live-delegation:${delegation.parentSessionId}`,
        maxActiveForOwner: LIVE_DELEGATION_OWNER_LIMIT,
        signal: controller.signal
      }),
      completion: createDeferred(),
      answerMarkdown: '',
      childMessageId: null,
      runtimeStatus: null,
      started: false,
      settling: false
    }
    this.activeTurns.set(turn.id, active)
    if (active.childSessionId) this.childToTurn.set(active.childSessionId, turn.id)
    return active
  }

  private async executeTurn(
    active: ActiveTurn,
    executionSnapshot: LiveDelegationTurnExecutionSnapshot
  ): Promise<void> {
    active.controller.signal.throwIfAborted()
    const delegation = this.options.repository.require(active.delegationId)
    const turn = this.options.repository.requireTurn(active.turnId)
    const safety = await this.resolveCurrentSafety(delegation)
    active.controller.signal.throwIfAborted()
    const acquired = await this.acquireAndBindChild(
      active,
      delegation,
      turn,
      executionSnapshot,
      safety
    )
    const { delegation: bound } = acquired
    const child = await this.synchronizeChildSafety(
      active,
      bound,
      turn.kind === 'follow_up' ? executionSnapshot : null
    )
    this.childToTurn.set(child.sessionId, active.turnId)
    active.controller.signal.throwIfAborted()

    await this.sendChildHandoff(active, turn, child.sessionId, buildTurnHandoff(bound, turn))
    if (active.controller.signal.aborted) {
      await this.settle(active, {
        status: 'interrupted',
        error: abortReason(active.controller.signal)
      })
      return
    }
    await this.applyRuntimeStatus(active)
    await active.completion.promise
  }

  private async acquireAndBindChild(
    active: ActiveTurn,
    delegation: LiveDelegation,
    turn: LiveDelegationTurn,
    executionSnapshot: LiveDelegationTurnExecutionSnapshot,
    safety: CurrentDelegationSafety
  ): Promise<AcquiredChild> {
    const acquisition = (async () => {
      let child = delegation.childSessionId
        ? await this.options.sessions.resolveConversationSessionInfo(delegation.childSessionId)
        : await this.options.sessions.findDelegationChild(delegation.parentSessionId, delegation.id)
      if (!child) {
        active.controller.signal.throwIfAborted()
        const input: CreateSubagentSessionInput = {
          parentSessionId: safety.parent.sessionId,
          agentId: delegation.targetAgentId,
          parentAgentId: safety.parent.agentId,
          slotId: delegation.slotId,
          displayName: delegation.title,
          targetAgentId: delegation.targetAgentId,
          projectDir: safety.projectDir,
          providerId: executionSnapshot.providerId,
          modelId: executionSnapshot.modelId,
          permissionMode: safety.parent.permissionMode,
          generationSettings: executionSnapshot.generationSettings ?? undefined,
          disabledAgentTools: safety.parent.disabledAgentTools,
          activeSkills: safety.parent.activeSkills,
          liveDelegationContext: { delegationId: delegation.id }
        }
        child = await this.options.sessions.createSubagentSession(input)
      }
      if (!child) {
        throw new Error(`Failed to create child session for delegation ${delegation.id}.`)
      }
      if (turn.kind === 'follow_up' && child.status === 'generating') {
        throw new Error(
          `Cannot continue delegation ${delegation.id} while child session is ${child.status}.`
        )
      }
      active.childSessionId = child.sessionId
      let bound: LiveDelegation
      try {
        bound = this.options.repository.bindChild(delegation.id, child.sessionId)
      } catch (error) {
        await this.cancelActiveChild(active, 'child binding failure')
        throw error
      }
      this.publishChanged(bound)
      if (active.controller.signal.aborted) {
        await this.cancelActiveChild(active, 'aborted child acquisition')
        active.controller.signal.throwIfAborted()
      }
      return { child, delegation: bound }
    })()
    active.childAcquisition = acquisition
    try {
      return await acquisition
    } finally {
      if (active.childAcquisition === acquisition) active.childAcquisition = null
    }
  }

  private async sendChildHandoff(
    active: ActiveTurn,
    turn: LiveDelegationTurn,
    childSessionId: string,
    handoff: string
  ): Promise<void> {
    // Write the dispatch intent before crossing the delivery boundary so restart recovery can
    // correlate a child answer even if the host exits immediately after the child accepts it.
    const started = this.options.repository.markTurnStarted(turn.id)
    this.publishChanged(started.delegation)
    const delivery = (async () => {
      await this.options.sessions.sendConversationMessage(childSessionId, handoff)
      active.started = true
      if (active.controller.signal.aborted) {
        await this.cancelActiveChild(active, 'aborted child handoff')
      }
    })()
    active.childHandoff = delivery
    try {
      await delivery
    } finally {
      if (active.childHandoff === delivery) active.childHandoff = null
    }
  }

  private async cancelActiveChild(active: ActiveTurn, reason: string): Promise<void> {
    const childSessionId = active.childSessionId
    if (!childSessionId) return
    await this.options.sessions.cancelConversation(childSessionId).catch((error) => {
      console.warn('[LiveDelegationService] Failed to cancel active child session:', {
        childSessionId,
        reason,
        error
      })
    })
  }

  private handleRuntimeUpdate(update: SessionRuntimeUpdate): void {
    const turnId = this.childToTurn.get(update.sessionId)
    if (!turnId) return
    const active = this.activeTurns.get(turnId)
    if (!active || active.settling) return

    if (update.kind === 'blocks') {
      if (update.messageId?.trim()) active.childMessageId = update.messageId.trim()
      if (update.deliverySegments) {
        active.answerMarkdown = projectFinalAnswerFromDeliverySegments(update.deliverySegments)
      }
      const waitingStatus =
        update.waitingInteraction?.type === 'permission'
          ? 'waiting_permission'
          : update.waitingInteraction?.type === 'question'
            ? 'waiting_question'
            : null
      if (waitingStatus) {
        active.admissionLease.suspend()
        const turn = this.options.repository.requireTurn(active.turnId)
        if (turn.status !== waitingStatus) {
          this.options.repository.markTurnWaiting(active.turnId, waitingStatus, update.updatedAt)
          this.publishChanged(this.options.repository.require(active.delegationId))
        }
      } else if (
        active.started &&
        active.runtimeStatus === 'generating' &&
        active.admissionLease.state === 'active'
      ) {
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
      try {
        await this.synchronizeChildSafety(
          active,
          this.options.repository.require(active.delegationId)
        )
      } catch (error) {
        await this.interruptUnverifiedTurn(active, error)
        return
      }
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

  private async prepareChildBoundary(
    childSessionId: string,
    signal?: AbortSignal
  ): Promise<{ active: ActiveTurn; child: ConversationSessionInfo; resumed: boolean }> {
    const candidate = await this.resolveActiveChildTurn(childSessionId, signal)
    if (!candidate) {
      throw new Error(
        `Live delegation admission context is unavailable for child ${childSessionId}.`
      )
    }
    try {
      const initialDelegation = this.options.repository.require(candidate.delegationId)
      if (candidate.admissionLease.state !== 'active') {
        await this.synchronizeChildSafety(candidate, initialDelegation)
      }
      const admission = await this.resumeChildAdmission(childSessionId, signal)
      if (!admission) {
        throw new Error(
          `Live delegation admission context is unavailable for child ${childSessionId}.`
        )
      }
      const delegation = this.options.repository.require(admission.active.delegationId)
      const child = await this.synchronizeChildSafety(admission.active, delegation)
      signal?.throwIfAborted()
      admission.active.controller.signal.throwIfAborted()
      return { ...admission, child }
    } catch (error) {
      await this.interruptUnverifiedTurn(candidate, error)
      throw error
    }
  }

  private async interruptUnverifiedTurn(active: ActiveTurn, error: unknown): Promise<void> {
    if (active.settling) return await active.completion.promise
    const reason = `Live delegation could not continue safely: ${errorMessage(error)}`
    active.controller.abort(reason)
    await this.cancelActiveChild(active, reason)
    await this.settle(active, { status: 'interrupted', error: reason })
  }

  private async resumeChildAdmission(
    childSessionId: string,
    signal?: AbortSignal
  ): Promise<{ active: ActiveTurn; resumed: boolean } | null> {
    const active = await this.resolveActiveChildTurn(childSessionId, signal)
    if (!active) return null
    signal?.throwIfAborted()
    active.controller.signal.throwIfAborted()
    const previousState = active.admissionLease.state
    await active.admissionLease.resume({ signal })
    signal?.throwIfAborted()
    active.controller.signal.throwIfAborted()
    const turn = this.options.repository.getTurn(active.turnId)
    if (!turn || !isActiveTurnStatus(turn.status) || active.settling) {
      active.admissionLease.release()
      return null
    }
    return { active, resumed: previousState !== 'active' }
  }

  private async resolveActiveChildTurn(
    childSessionId: string,
    signal?: AbortSignal
  ): Promise<ActiveTurn | null> {
    let turnId = this.childToTurn.get(childSessionId)
    if (!turnId) return null
    let active = this.activeTurns.get(turnId)
    if (!active && this.reconcilePromise) {
      await awaitWithAbort(this.reconcilePromise, signal)
      turnId = this.childToTurn.get(childSessionId)
      active = turnId ? this.activeTurns.get(turnId) : undefined
    }
    if (!active || active.settling) return null
    signal?.throwIfAborted()
    active.controller.signal.throwIfAborted()
    return active
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
    active.admissionLease.release()
    let fallbackSummary: string | null = null
    let fallbackTapeReceipt: SubagentTapeLinkReceipt | null = null
    try {
      const delegation = this.options.repository.require(active.delegationId)
      const persistedResult = await this.resolvePersistedResult(active)
      const answer = persistedResult?.answerMarkdown.trim() || active.answerMarkdown.trim()
      const handoff = answer
        ? buildResultHandoff(answer, Boolean(persistedResult && active.childSessionId))
        : null
      const summary = handoff?.text ?? ''
      fallbackSummary = summary || null
      const resultRef =
        persistedResult && answer && active.childSessionId && handoff
          ? createResultRef(active.childSessionId, persistedResult, answer, handoff)
          : null
      let status = active.controller.signal.aborted ? 'interrupted' : outcome.status
      let error = outcome.error?.trim() || null
      if (status === 'completed' && !answer) {
        status = 'failed'
        error = 'Child session completed without a final answer.'
      }
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
      fallbackTapeReceipt = tapeReceipt
      error = error
        ? truncateUtf8(sanitizeDelegationText(error), LIVE_DELEGATION_MAX_HANDOFF_BYTES)
        : null
      const settled = this.options.repository.finishTurn({
        turnId: active.turnId,
        status,
        summary: summary || null,
        error,
        resultRef,
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
      try {
        const turn = this.options.repository.getTurn(active.turnId)
        if (turn && isActiveTurnStatus(turn.status)) {
          const settled = this.options.repository.finishTurn({
            turnId: active.turnId,
            status: 'failed',
            summary: fallbackSummary,
            error: truncateUtf8(
              sanitizeDelegationText(`Failed to persist child result: ${errorMessage(error)}`),
              LIVE_DELEGATION_MAX_HANDOFF_BYTES
            ),
            tapeReceipt: fallbackTapeReceipt
          })
          this.publishChanged(settled.delegation)
          this.notifyMailbox(settled.delegation.parentSessionId, settled.delegation.id)
        }
      } catch (fallbackError) {
        console.error('[LiveDelegationService] Failed to persist terminal settlement error:', {
          delegationId: active.delegationId,
          turnId: active.turnId,
          error: fallbackError
        })
        try {
          const turn = this.options.repository.getTurn(active.turnId)
          if (turn && isActiveTurnStatus(turn.status)) {
            const settled = this.options.repository.finishTurn({
              turnId: active.turnId,
              status: 'failed',
              error: truncateUtf8(
                sanitizeDelegationText(
                  `Failed to persist child result: ${errorMessage(error)}; ` +
                    `artifact fallback failed: ${errorMessage(fallbackError)}`
                ),
                LIVE_DELEGATION_MAX_HANDOFF_BYTES
              )
            })
            this.publishChanged(settled.delegation)
            this.notifyMailbox(settled.delegation.parentSessionId, settled.delegation.id)
          }
        } catch (terminalError) {
          console.error('[LiveDelegationService] Failed to persist bare terminal state:', {
            delegationId: active.delegationId,
            turnId: active.turnId,
            error: terminalError
          })
        }
      }
    } finally {
      active.admissionLease.release()
      if (active.childSessionId) this.childToTurn.delete(active.childSessionId)
      this.activeTurns.delete(active.turnId)
      active.completion.resolve()
    }
  }

  private async resolvePersistedResult(
    active: ActiveTurn
  ): Promise<LiveDelegationAssistantResult | null> {
    if (!active.childSessionId) return null
    try {
      const result = await this.options.sessions.getAssistantResult(
        active.childSessionId,
        active.childMessageId ?? undefined
      )
      if (!result || active.childMessageId) return result
      const turn = this.options.repository.getTurn(active.turnId)
      if (
        turn?.startedAt !== null &&
        turn?.startedAt !== undefined &&
        result.updatedAt < turn.startedAt
      ) {
        console.warn('[LiveDelegationService] Ignored a stale recovered child result:', {
          delegationId: active.delegationId,
          turnId: active.turnId,
          childSessionId: active.childSessionId,
          childMessageId: result.messageId
        })
        return null
      }
      return result
    } catch (error) {
      console.warn('[LiveDelegationService] Failed to resolve persisted child result:', {
        delegationId: active.delegationId,
        turnId: active.turnId,
        childSessionId: active.childSessionId,
        childMessageId: active.childMessageId,
        error
      })
      return null
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
      if (turn.status === 'waiting_permission' || turn.status === 'waiting_question') return
      if (turn.startedAt === null) {
        this.options.repository.markTurnStarted(turn.id)
      }
      void this.runWithAdmission(active, async () => await active.completion.promise)
      return
    }
    if (turn.startedAt === null) {
      const settled = this.options.repository.finishTurn({
        turnId: turn.id,
        status: 'interrupted',
        error: 'Host restarted before child handoff dispatch was recorded.'
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
          sanitizeDelegationText(`Failed to reconcile after restart: ${errorMessage(error)}`),
          LIVE_DELEGATION_MAX_HANDOFF_BYTES
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

  private async resolveCurrentSafety(delegation: LiveDelegation): Promise<CurrentDelegationSafety> {
    const parent = await this.requireCapableParent(delegation.parentSessionId)
    const slot = parent.subagentCapability.slots.find(
      (candidate) => candidate.id === delegation.slotId
    )
    if (!slot) {
      throw new Error(`Subagent slot was disabled or removed: ${delegation.slotId}`)
    }
    const targetAgentId =
      slot.targetType === 'self' ? parent.agentId : (slot.targetAgentId?.trim() ?? '')
    if (!targetAgentId || targetAgentId !== delegation.targetAgentId) {
      throw new Error(`Subagent slot target changed for delegation ${delegation.id}.`)
    }
    const projectDir =
      (await this.options.sessions.resolveConversationWorkdir(parent.sessionId))?.trim() ||
      parent.projectDir?.trim() ||
      null
    return { parent, projectDir }
  }

  private async synchronizeChildSafety(
    active: ActiveTurn,
    delegation: LiveDelegation,
    executionSnapshot: LiveDelegationTurnExecutionSnapshot | null = null
  ): Promise<ConversationSessionInfo> {
    const childSessionId = active.childSessionId?.trim()
    if (!childSessionId) {
      throw new Error(`Delegation ${delegation.id} has no bound child Session.`)
    }
    return await this.runSerializedChildSafety(childSessionId, async () => {
      return await this.options.deletionGate.runWithSessionOperation(
        delegation.parentSessionId,
        async () =>
          await this.options.deletionGate.runWithSessionOperation(childSessionId, async () => {
            const safety = await this.resolveCurrentSafety(delegation)
            active.controller.signal.throwIfAborted()
            const child = await this.options.safety.prepareTurn({
              parentSessionId: safety.parent.sessionId,
              parentAgentId: safety.parent.agentId,
              parentPermissionMode: safety.parent.permissionMode,
              childSessionId,
              targetAgentId: delegation.targetAgentId,
              slotId: delegation.slotId,
              delegationId: delegation.id,
              projectDir: safety.projectDir,
              executionSnapshot
            })
            if (!child) {
              throw new Error(`Child session is unavailable: ${childSessionId}`)
            }
            assertDelegationChildLineage(child, delegation)
            return child
          })
      )
    })
  }

  private async runSerializedChildSafety<T>(
    childSessionId: string,
    operation: () => Promise<T>
  ): Promise<T> {
    const previous = this.childSafetyTails.get(childSessionId) ?? Promise.resolve()
    const next = previous.then(operation, operation)
    const tail = next.then(
      () => undefined,
      () => undefined
    )
    this.childSafetyTails.set(childSessionId, tail)
    try {
      return await next
    } finally {
      if (this.childSafetyTails.get(childSessionId) === tail) {
        this.childSafetyTails.delete(childSessionId)
      }
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
    'Return markdown with these sections in this order:',
    '## Handoff',
    'A self-contained conclusion for the parent Agent, limited to about 2,000 tokens. Include the',
    'decision, critical evidence, changed files, validation, and unresolved risks needed next.',
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
    '- Ask for permission or clarification through the normal tool flow.',
    '- Put supporting detail after Handoff; the complete answer remains available in this child.'
  ].join('\n')
}

function createResultRef(
  childSessionId: string,
  result: LiveDelegationAssistantResult,
  answer: string,
  handoff: ReturnType<typeof buildResultHandoff>
): LiveDelegationResultRef {
  return {
    schemaVersion: 1,
    childSessionId,
    childMessageId: result.messageId,
    answerSha256: hashAnswer(answer),
    answerBytes: Buffer.byteLength(answer, 'utf8'),
    answerEstimatedTokens: estimateTokens(answer),
    handoffSource: handoff.source,
    handoffTruncated: handoff.truncated
  }
}

function createTurnExecutionSnapshot(
  session: ConversationSessionInfo
): LiveDelegationTurnExecutionSnapshot {
  return {
    providerId: session.providerId,
    modelId: session.modelId,
    generationSettings: session.generationSettings
      ? structuredClone(session.generationSettings)
      : null
  }
}

function assertDelegationChildLineage(
  child: ConversationSessionInfo,
  delegation: LiveDelegation
): void {
  if (
    child.sessionKind !== 'subagent' ||
    child.parentSessionId !== delegation.parentSessionId ||
    child.subagentMeta?.slotId !== delegation.slotId ||
    child.subagentMeta.liveDelegation?.delegationId !== delegation.id
  ) {
    throw new Error(`Child session lineage changed for delegation ${delegation.id}.`)
  }
}

function buildResultHandoff(
  answer: string,
  resultIsReferenced: boolean
): {
  text: string
  source: LiveDelegationResultRef['handoffSource']
  truncated: boolean
} {
  const normalized = sanitizeDelegationText(answer.trim())
  const handoffSection = extractMarkdownSection(normalized, 'Handoff')
  const resultSection = handoffSection ? null : extractMarkdownSection(normalized, 'Result')
  const source: LiveDelegationResultRef['handoffSource'] = handoffSection
    ? 'handoff_section'
    : resultSection
      ? 'result_section'
      : 'final_answer'
  const selected = handoffSection ?? resultSection ?? normalized
  const bounded = truncateToBudgets(
    selected,
    LIVE_DELEGATION_MAX_HANDOFF_BYTES,
    LIVE_DELEGATION_HANDOFF_TOKEN_BUDGET,
    resultIsReferenced ? HANDOFF_TRUNCATION_NOTICE : UNREFERENCED_HANDOFF_TRUNCATION_NOTICE
  )
  return { text: bounded.text, source, truncated: bounded.truncated }
}

function extractMarkdownSection(markdown: string, title: string): string | null {
  const lines = markdown.replace(/\r\n/g, '\n').split('\n')
  const escapedTitle = title.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&')
  const target = new RegExp(`^ {0,3}##\\s+${escapedTitle}\\s*#*\\s*$`, 'iu')
  const nextSection = /^ {0,3}#{1,2}\s+\S/u
  const fencePattern = /^ {0,3}(`{3,}|~{3,})/u
  let fence: { marker: '`' | '~'; length: number } | null = null
  let start = -1
  let end = lines.length
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index] ?? ''
    if (fence) {
      if (isClosingFence(line, fence)) fence = null
      continue
    }
    const fenceMatch = line.match(fencePattern)?.[1]
    if (fenceMatch) {
      const marker = fenceMatch[0] as '`' | '~'
      fence = { marker, length: fenceMatch.length }
      continue
    }
    if (start < 0) {
      if (target.test(line)) start = index
      continue
    }
    if (nextSection.test(line)) {
      end = index
      break
    }
  }
  if (start < 0) return null
  const body = lines
    .slice(start + 1, end)
    .join('\n')
    .trim()
  return body ? lines.slice(start, end).join('\n').trim() : null
}

function isClosingFence(line: string, fence: { marker: '`' | '~'; length: number }): boolean {
  const candidate = line.replace(/^ {0,3}/u, '').trimEnd()
  return (
    candidate.length >= fence.length &&
    [...candidate].every((character) => character === fence.marker)
  )
}

function truncateToBudgets(
  value: string,
  maxBytes: number,
  maxTokens: number,
  notice: string
): { text: string; truncated: boolean } {
  if (fitsBudgets(value, maxBytes, maxTokens)) return { text: value, truncated: false }

  const suffix = `\n\n${notice}`
  let low = 0
  let high = value.length
  let best = 0
  while (low <= high) {
    const midpoint = Math.floor((low + high) / 2)
    const end = previousCodePointBoundary(value, midpoint, 0)
    const candidate = `${value.slice(0, end).trimEnd()}${suffix}`
    if (fitsBudgets(candidate, maxBytes, maxTokens)) {
      best = Math.max(best, end)
      low = midpoint + 1
    } else {
      high = midpoint - 1
    }
  }
  return { text: `${value.slice(0, best).trimEnd()}${suffix}`.trim(), truncated: true }
}

function takeResultPage(
  answer: string,
  offset: number,
  maxTokens: number
): { text: string; nextOffset: number | null } {
  if (!Number.isSafeInteger(offset) || offset < 0 || offset > answer.length) {
    throw new Error('Live delegation result cursor has an invalid offset.')
  }
  if (
    offset > 0 &&
    offset < answer.length &&
    isLowSurrogate(answer.charCodeAt(offset)) &&
    isHighSurrogate(answer.charCodeAt(offset - 1))
  ) {
    throw new Error('Live delegation result cursor splits a Unicode code point.')
  }
  if (offset === answer.length) return { text: '', nextOffset: null }

  let low = offset + 1
  let high = Math.min(answer.length, offset + LIVE_DELEGATION_RESULT_PAGE_MAX_BYTES)
  let best = offset
  while (low <= high) {
    const midpoint = Math.floor((low + high) / 2)
    const end = previousCodePointBoundary(answer, midpoint, offset)
    const candidate = answer.slice(offset, end)
    if (
      Buffer.byteLength(candidate, 'utf8') <= LIVE_DELEGATION_RESULT_PAGE_MAX_BYTES &&
      estimateTokens(candidate) <= maxTokens
    ) {
      best = Math.max(best, end)
      low = midpoint + 1
    } else {
      high = midpoint - 1
    }
  }
  if (best === offset) {
    best = nextCodePointBoundary(answer, offset)
  }
  return {
    text: answer.slice(offset, best),
    nextOffset: best < answer.length ? best : null
  }
}

function fitsBudgets(value: string, maxBytes: number, maxTokens: number): boolean {
  return Buffer.byteLength(value, 'utf8') <= maxBytes && estimateTokens(value) <= maxTokens
}

function sanitizeDelegationText(value: string): string {
  return value.replaceAll('\0', '\uFFFD')
}

function estimateTokens(value: string): number {
  try {
    const estimated = approximateTokenSize(value)
    if (Number.isFinite(estimated) && estimated >= 0) {
      return Math.min(Number.MAX_SAFE_INTEGER, Math.ceil(estimated))
    }
  } catch {
    // Byte-based fallback keeps result delivery available if token estimation fails.
  }
  return Math.ceil(Buffer.byteLength(value, 'utf8') / 4)
}

function previousCodePointBoundary(value: string, offset: number, floor: number): number {
  if (
    offset > floor &&
    offset < value.length &&
    isLowSurrogate(value.charCodeAt(offset)) &&
    isHighSurrogate(value.charCodeAt(offset - 1))
  ) {
    return offset - 1
  }
  return offset
}

function nextCodePointBoundary(value: string, offset: number): number {
  const first = value.charCodeAt(offset)
  return isHighSurrogate(first) && isLowSurrogate(value.charCodeAt(offset + 1))
    ? offset + 2
    : offset + 1
}

function isHighSurrogate(value: number): boolean {
  return value >= 0xd800 && value <= 0xdbff
}

function isLowSurrogate(value: number): boolean {
  return value >= 0xdc00 && value <= 0xdfff
}

function hashAnswer(answer: string): string {
  return createHash('sha256').update(answer, 'utf8').digest('hex')
}

function encodeResultCursor(cursor: z.infer<typeof ResultCursorSchema>): string {
  const encoded = Buffer.from(JSON.stringify(ResultCursorSchema.parse(cursor)), 'utf8').toString(
    'base64url'
  )
  if (encoded.length > LIVE_DELEGATION_RESULT_CURSOR_MAX_LENGTH) {
    throw new Error('Live delegation result cursor exceeds its encoded limit.')
  }
  return encoded
}

function decodeResultCursor(value: string): z.infer<typeof ResultCursorSchema> {
  const normalized = value.trim()
  if (
    !normalized ||
    normalized.length > LIVE_DELEGATION_RESULT_CURSOR_MAX_LENGTH ||
    !/^[A-Za-z0-9_-]+$/u.test(normalized)
  ) {
    throw new Error('Invalid live delegation result cursor.')
  }
  try {
    const decoded = Buffer.from(normalized, 'base64url')
    if (decoded.toString('base64url') !== normalized) {
      throw new Error('Non-canonical cursor encoding.')
    }
    return ResultCursorSchema.parse(JSON.parse(decoded.toString('utf8')))
  } catch {
    throw new Error('Invalid live delegation result cursor.')
  }
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
  const maxBytesPerEvent = Math.min(
    MAX_MODEL_EVENT_BYTES,
    Math.max(1, Math.floor(MAX_MODEL_WAIT_BYTES / Math.max(1, events.length)))
  )
  return {
    events: events.map((event) => projectEventSummary(event, maxBytesPerEvent)),
    cursor: events.at(-1)?.id ?? priorCursor,
    timedOut
  }
}

function projectEventSummary(
  event: LiveDelegationEvent,
  maxBytes: number
): LiveDelegationEventSummary {
  const { content, ...identity } = event
  return {
    ...identity,
    contentPreview: truncateUtf8(content, maxBytes),
    contentTruncated: Buffer.byteLength(content, 'utf8') > maxBytes
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
