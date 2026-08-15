import { Buffer } from 'node:buffer'
import { createHash } from 'node:crypto'
import { performance } from 'node:perf_hooks'
import { nanoid } from 'nanoid'
import { approximateTokenSize } from 'tokenx'
import { z } from 'zod'
import {
  LIVE_DELEGATION_HANDOFF_TOKEN_BUDGET,
  LIVE_DELEGATION_MAX_WAITS_PER_PARENT,
  LIVE_DELEGATION_MAX_HANDOFF_BYTES,
  LIVE_DELEGATION_WAIT_DEFAULT_TIMEOUT_MS,
  LIVE_DELEGATION_WAIT_MAX_TIMEOUT_MS,
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
import { BoundedObservationQueue } from '@/lib/boundedObservationQueue'
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
import type { DeepChatTaskContractContext } from '@shared/types/task-contract'
import { projectTaskEvaluationSummary } from '@/tape/domain/taskEvaluation'
import type { SessionRuntimeUpdate } from '@/session/runtimeEvents'
import type { SessionDeletionGatePort } from '@/session/deletionGate'
import { classifyToolEffect } from '@/tool/effectClassification'
import type { ToolEffectObservation } from '@/tool/effectObserver'
import { resolveToolPermissionMode } from '@/tool/permission/permissionMode'
import {
  LiveDelegationTaskContractError,
  type ActiveLiveDelegationTurn,
  type ActiveLiveDelegationTurnIdentity,
  type LiveDelegationRepository,
  type LiveDelegationWithTurn
} from './liveDelegationRepository'
import type {
  LiveDelegationSafetyPort,
  LiveDelegationTurnExecutionSnapshot
} from './liveDelegationSafety'
import { normalizeOrchestrationPolicy } from '@shared/orchestration/policy'
import type {
  LiveDelegationConsentReceipt,
  LiveDelegationConsentVerifier
} from './liveDelegationConsent'
import {
  createLegacyLiveDelegationTaskContractInput,
  createLiveDelegationTaskContractInput,
  LIVE_DELEGATION_REQUIRED_HANDOFF_SECTIONS
} from './liveDelegationTaskContract'
import { extractMarkdownLevelTwoSection } from '@shared/orchestration/liveDelegationMarkdown'

const MAX_WAITERS = 32
const MAX_MODEL_PREVIEW_BYTES = 2 * 1024
const MAX_MODEL_EVENT_BYTES = 16 * 1024
const MAX_MODEL_WAIT_CONTENT_BYTES = 32 * 1024
const MAX_MODEL_WAIT_RESPONSE_BYTES = 64 * 1024
const MAX_MODEL_EVENT_EVALUATION_EVIDENCE = 2
const MAX_MODEL_TURN_EVALUATION_EVIDENCE = 4
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
  observe?: (observation: LiveDelegationLifecycleObservation) => void | Promise<void>
  observationsEnabled?: () => boolean
  now?: () => number
}

interface LiveDelegationObservationIdentity {
  parentSessionId: string
  delegationId: string
  turnId: string
}

export type LiveDelegationFailureCategory = 'integrity' | 'persistence' | 'protocol' | 'unknown'

export type LiveDelegationLifecycleObservation =
  | (LiveDelegationObservationIdentity & {
      type: 'turn_queued'
      turnKind: 'initial' | 'follow_up'
    })
  | (LiveDelegationObservationIdentity & {
      type: 'child_bound'
      childSessionId: string
    })
  | (LiveDelegationObservationIdentity & {
      type: 'turn_started'
      childSessionId: string
      turnKind: 'initial' | 'follow_up'
    })
  | (LiveDelegationObservationIdentity & {
      type: 'turn_suspended'
      childSessionId: string
      reason: 'permission' | 'question'
    })
  | (LiveDelegationObservationIdentity & {
      type: 'turn_resumed'
      childSessionId: string
    })
  | (LiveDelegationObservationIdentity & {
      type: 'turn_terminal'
      childSessionId?: string
      durationMs?: number
    } & (
        | { status: 'completed' | 'cancelled' | 'interrupted' }
        | { status: 'failed'; errorCategory: LiveDelegationFailureCategory }
      ))
  | (LiveDelegationObservationIdentity & {
      type: 'reconciliation_terminal'
      childSessionId?: string
    } & (
        | { outcome: 'settled' }
        | {
            outcome: 'quarantined' | 'failed'
            errorCategory: LiveDelegationFailureCategory
          }
      ))
  | (LiveDelegationObservationIdentity & {
      type: 'stale_result_rejected'
      childSessionId: string
      reason: 'recovered_result_predates_turn'
    })
  | {
      type: 'observations_dropped'
      droppedCount: number
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
  settlement: LiveDelegationWithTurn | null
}

type AcquiredChild = {
  child: ConversationSessionInfo
  delegation: LiveDelegation
}

type CurrentDelegationSafety = {
  parent: CapableParent
  projectDir: string | null
}

type PersistedResultResolution =
  | { status: 'found'; result: LiveDelegationAssistantResult }
  | { status: 'missing' | 'lookup_failed'; result: null }

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
  private readonly quarantinedTurns = new Set<string>()
  private readonly turnObservedAt = new Map<string, number>()
  private readonly quarantineCancellations = new Set<Promise<void>>()
  private readonly childSafetyTails = new Map<string, Promise<void>>()
  private readonly waiters = new Set<MailboxWaiter>()
  private readonly observationQueue: BoundedObservationQueue<LiveDelegationLifecycleObservation>
  private readonly now: () => number
  private unsubscribeRuntime: (() => void) | null = null
  private reconcilePromise: Promise<void> | null = null
  private stopPromise: Promise<void> | null = null
  private started = false

  constructor(private readonly options: LiveDelegationServiceOptions) {
    this.observationQueue = new BoundedObservationQueue<LiveDelegationLifecycleObservation>({
      observe: options.observe ?? (() => undefined),
      enabled: options.observe ? (options.observationsEnabled ?? (() => true)) : () => false,
      createDroppedObservation: (droppedCount) => ({
        type: 'observations_dropped',
        droppedCount
      })
    })
    this.now = options.now ?? performance.now.bind(performance)
  }

  start(): void {
    if (this.started || this.stopPromise) return
    const activeRecords = this.options.repository.listActiveTurnIdentities()
    this.childToTurn.clear()
    this.quarantinedTurns.clear()
    this.turnObservedAt.clear()
    for (const record of activeRecords) {
      if (record.childSessionId) {
        this.childToTurn.set(record.childSessionId, record.turnId)
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

  prepareTaskContractContext(childSessionId: string): DeepChatTaskContractContext | null {
    const admittedTurnId = this.childToTurn.get(childSessionId)
    if (admittedTurnId && this.quarantinedTurns.has(admittedTurnId)) {
      throw new LiveDelegationTaskContractError(
        `Child Session ${childSessionId} is quarantined after TaskContract reconciliation failed.`
      )
    }
    const context = this.options.repository.prepareActiveTaskContractContext(childSessionId)
    if (context === null) {
      if (admittedTurnId === undefined) return null
    } else if (admittedTurnId === context.contract.taskDescription.turnId) {
      return context
    }
    throw new LiveDelegationTaskContractError(
      `Child Session ${childSessionId} has no admitted live-delegation runtime matching its TaskContract.`
    )
  }

  stop(): Promise<void> {
    if (this.stopPromise) return this.stopPromise
    const stopPromise = this.stopOnce()
    this.stopPromise = stopPromise
    const clearStopPromise = () => {
      if (this.stopPromise === stopPromise) this.stopPromise = null
    }
    void stopPromise.then(clearStopPromise, clearStopPromise)
    return stopPromise
  }

  private async stopOnce(): Promise<void> {
    if (!this.started) {
      await this.flushObservations()
      return
    }
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
    await Promise.allSettled([
      ...cancellationWork,
      ...pendingChildWork,
      ...this.quarantineCancellations
    ])
    await Promise.allSettled(
      active.map((turn) =>
        this.settle(turn, {
          status: 'interrupted',
          error: 'Live delegation service stopped.'
        })
      )
    )
    this.activeTurns.clear()
    for (const [childSessionId, turnId] of this.childToTurn) {
      if (!this.quarantinedTurns.has(turnId)) this.childToTurn.delete(childSessionId)
    }
    this.turnObservedAt.clear()
    this.childSafetyTails.clear()
    for (const waiter of this.waiters) waiter.resolve()
    this.waiters.clear()
    await this.flushObservations()
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
    const projectDir = await this.resolveParentProjectDir(parent)
    const created = this.runAuthorizedStartMutation(parent, 'spawn', authorization, () =>
      this.options.repository.create(
        {
          id: delegationId,
          initialTurnId: turnId,
          parentSessionId: parent.sessionId,
          slotId: slot.id,
          targetAgentId,
          title: input.title,
          prompt: input.prompt,
          taskContract: createLiveDelegationTaskContractInput(projectDir)
        },
        beforeMutation
      )
    )
    this.observeQueuedTurn(created.delegation, created.turn)
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
        const currentSafety = await this.resolveCurrentSafety(delegation)
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
        const created = this.runAuthorizedStartMutation(
          currentSafety.parent,
          'follow_up',
          authorization,
          () =>
            this.options.repository.createFollowUp(
              currentSafety.parent.sessionId,
              delegation.id,
              nanoid(),
              task,
              createLiveDelegationTaskContractInput(currentSafety.projectDir),
              undefined,
              beforeMutation
            )
        )
        this.observeQueuedTurn(created.delegation, created.turn)
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
      evaluation:
        turn.evaluation && turn.evaluationRef
          ? projectTaskEvaluationSummary(turn.evaluation, turn.evaluationRef)
          : null,
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
    for (const record of this.options.repository.listActiveTurnIdentities()) {
      if (
        record.parentSessionId === normalizedSessionId ||
        record.childSessionId === normalizedSessionId
      ) {
        delegationIds.add(record.delegationId)
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
      Math.max(0, Math.floor(options?.timeoutMs ?? LIVE_DELEGATION_WAIT_DEFAULT_TIMEOUT_MS)),
      LIVE_DELEGATION_WAIT_MAX_TIMEOUT_MS
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
        this.observeTerminalTurn(settled)
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
        this.quarantinedTurns.delete(turn.id)
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
      if (error instanceof LiveDelegationTaskContractError) {
        this.parkTaskContractBoundary(active, error)
        return
      }
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

  private parkTaskContractBoundary(active: ActiveTurn, error: unknown): void {
    console.error('[LiveDelegationService] TaskContract boundary remains recoverable:', {
      delegationId: active.delegationId,
      turnId: active.turnId,
      error
    })
    active.admissionLease.release()
    if (active.childSessionId) this.childToTurn.delete(active.childSessionId)
    this.activeTurns.delete(active.turnId)
    active.completion.resolve()
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
        signal: controller.signal,
        correlation: {
          kind: 'live_delegation',
          parentSessionId: delegation.parentSessionId,
          delegationId: delegation.id,
          turnId: turn.id
        }
      }),
      completion: createDeferred(),
      answerMarkdown: '',
      childMessageId: null,
      runtimeStatus: null,
      started: false,
      settling: false,
      settlement: null
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
    this.options.repository.ensureInheritedTaskContract(turn.id, child.sessionId)
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
      if (!delegation.childSessionId) {
        this.notifyObserver({
          type: 'child_bound',
          parentSessionId: bound.parentSessionId,
          childSessionId: child.sessionId,
          delegationId: bound.id,
          turnId: turn.id
        })
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
      this.notifyObserver({
        type: 'turn_started',
        parentSessionId: started.delegation.parentSessionId,
        childSessionId,
        delegationId: started.delegation.id,
        turnId: started.turn.id,
        turnKind: started.turn.kind
      })
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
          const waiting = this.options.repository.markTurnWaiting(
            active.turnId,
            waitingStatus,
            update.updatedAt
          )
          this.notifyObserver({
            type: 'turn_suspended',
            parentSessionId: waiting.delegation.parentSessionId,
            childSessionId: active.childSessionId!,
            delegationId: waiting.delegation.id,
            turnId: waiting.turn.id,
            reason: waitingStatus === 'waiting_permission' ? 'permission' : 'question'
          })
          this.publishChanged(waiting.delegation)
        }
      } else if (
        active.started &&
        active.runtimeStatus === 'generating' &&
        active.admissionLease.state === 'active'
      ) {
        const turn = this.options.repository.requireTurn(active.turnId)
        if (turn.status === 'waiting_permission' || turn.status === 'waiting_question') {
          const resumed = this.options.repository.markTurnStarted(active.turnId, update.updatedAt)
          this.notifyObserver({
            type: 'turn_resumed',
            parentSessionId: resumed.delegation.parentSessionId,
            childSessionId: active.childSessionId!,
            delegationId: resumed.delegation.id,
            turnId: resumed.turn.id
          })
          this.publishChanged(resumed.delegation)
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
        const started = this.options.repository.markTurnStarted(active.turnId)
        this.notifyObserver({
          type: 'turn_started',
          parentSessionId: started.delegation.parentSessionId,
          childSessionId: active.childSessionId!,
          delegationId: started.delegation.id,
          turnId: started.turn.id,
          turnKind: started.turn.kind
        })
        this.publishChanged(started.delegation)
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
    if (this.quarantinedTurns.has(turnId)) {
      throw new LiveDelegationTaskContractError(
        `Child Session ${childSessionId} is quarantined after TaskContract reconciliation failed.`
      )
    }
    let active = this.activeTurns.get(turnId)
    if (!active && this.reconcilePromise) {
      await awaitWithAbort(this.reconcilePromise, signal)
      turnId = this.childToTurn.get(childSessionId)
      active = turnId ? this.activeTurns.get(turnId) : undefined
    }
    if (turnId && this.quarantinedTurns.has(turnId)) {
      throw new LiveDelegationTaskContractError(
        `Child Session ${childSessionId} is quarantined after TaskContract reconciliation failed.`
      )
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
  ): Promise<LiveDelegationWithTurn | null> {
    if (active.settling) {
      await active.completion.promise
      return active.settlement
    }
    active.settling = true
    active.admissionLease.release()
    let fallbackSummary: string | null = null
    let fallbackTapeReceipt: SubagentTapeLinkReceipt | null = null
    let failureCategory: LiveDelegationFailureCategory = 'unknown'
    let terminalSettlement: LiveDelegationWithTurn | null = null
    try {
      const delegation = this.options.repository.require(active.delegationId)
      const persistedResultResolution = await this.resolvePersistedResult(active)
      const persistedResult = persistedResultResolution.result
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
        failureCategory =
          persistedResultResolution.status === 'lookup_failed' ? 'persistence' : 'protocol'
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
          failureCategory = 'persistence'
        }
      }
      fallbackTapeReceipt = tapeReceipt
      error = error
        ? truncateUtf8(sanitizeDelegationText(error), LIVE_DELEGATION_MAX_HANDOFF_BYTES)
        : null
      terminalSettlement = this.options.repository.finishTurn({
        turnId: active.turnId,
        status,
        summary: summary || null,
        error,
        resultRef,
        tapeReceipt,
        candidateResult: persistedResult?.answerMarkdown.trim() || null
      })
      active.settlement = terminalSettlement
      const settled = terminalSettlement
      this.observeTerminalTurn(settled, failureCategory)
      this.publishChanged(settled.delegation)
      this.notifyMailbox(settled.delegation.parentSessionId, settled.delegation.id)
    } catch (error) {
      if (terminalSettlement) return terminalSettlement
      console.error('[LiveDelegationService] Failed to settle child turn:', {
        delegationId: active.delegationId,
        turnId: active.turnId,
        error
      })
      try {
        const turn = this.options.repository.getTurn(active.turnId)
        if (turn?.taskContract) {
          console.error(
            '[LiveDelegationService] Contract-bearing settlement remains recoverable:',
            {
              delegationId: active.delegationId,
              turnId: active.turnId,
              error
            }
          )
          return null
        }
        if (turn && isActiveTurnStatus(turn.status)) {
          terminalSettlement = this.options.repository.finishTurn({
            turnId: active.turnId,
            status: 'failed',
            summary: fallbackSummary,
            error: truncateUtf8(
              sanitizeDelegationText(`Failed to persist child result: ${errorMessage(error)}`),
              LIVE_DELEGATION_MAX_HANDOFF_BYTES
            ),
            tapeReceipt: fallbackTapeReceipt
          })
          active.settlement = terminalSettlement
          const settled = terminalSettlement
          this.observeTerminalTurn(settled, 'persistence')
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
            terminalSettlement = this.options.repository.finishTurn({
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
            active.settlement = terminalSettlement
            const settled = terminalSettlement
            this.observeTerminalTurn(settled, 'persistence')
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
    return terminalSettlement
  }

  private async resolvePersistedResult(active: ActiveTurn): Promise<PersistedResultResolution> {
    if (!active.childSessionId) return { status: 'missing', result: null }
    try {
      const result = await this.options.sessions.getAssistantResult(
        active.childSessionId,
        active.childMessageId ?? undefined
      )
      if (!result) return { status: 'missing', result: null }
      if (active.childMessageId) return { status: 'found', result }
      const turn = this.options.repository.getTurn(active.turnId)
      if (
        turn?.startedAt !== null &&
        turn?.startedAt !== undefined &&
        result.updatedAt < turn.startedAt
      ) {
        this.notifyObserver({
          type: 'stale_result_rejected',
          parentSessionId: active.parentSessionId,
          childSessionId: active.childSessionId,
          delegationId: active.delegationId,
          turnId: active.turnId,
          reason: 'recovered_result_predates_turn'
        })
        console.warn('[LiveDelegationService] Ignored a stale recovered child result:', {
          delegationId: active.delegationId,
          turnId: active.turnId,
          childSessionId: active.childSessionId,
          childMessageId: result.messageId
        })
        return { status: 'missing', result: null }
      }
      return { status: 'found', result }
    } catch (error) {
      console.warn('[LiveDelegationService] Failed to resolve persisted child result:', {
        delegationId: active.delegationId,
        turnId: active.turnId,
        childSessionId: active.childSessionId,
        childMessageId: active.childMessageId,
        error
      })
      return { status: 'lookup_failed', result: null }
    }
  }

  private async reconcileActiveTurns(records: ActiveLiveDelegationTurnIdentity[]): Promise<void> {
    for (const record of records) {
      if (!this.started) return
      try {
        await this.reconcileActiveTurn({
          delegation: this.options.repository.require(record.delegationId),
          turn: this.options.repository.requireTurn(record.turnId)
        })
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
    let turn = this.options.repository.getTurn(record.turn.id)
    if (!turn || !isActiveTurnStatus(turn.status)) {
      if (record.delegation.childSessionId) {
        this.childToTurn.delete(record.delegation.childSessionId)
      }
      return
    }
    let delegation = this.options.repository.require(record.delegation.id)
    if (child && !delegation.childSessionId) {
      delegation = this.options.repository.bindChild(delegation.id, child.sessionId)
      this.notifyObserver({
        type: 'child_bound',
        parentSessionId: delegation.parentSessionId,
        childSessionId: child.sessionId,
        delegationId: delegation.id,
        turnId: turn.id
      })
    }
    if (!child) {
      const settled = this.options.repository.finishTurn({
        turnId: turn.id,
        status: 'interrupted',
        error: 'Host restarted before the child session could be recovered.'
      })
      this.observeTerminalTurn(settled)
      this.observeReconciliation(settled.delegation, settled.turn, { outcome: 'settled' })
      this.publishChanged(settled.delegation)
      this.notifyMailbox(settled.delegation.parentSessionId, settled.delegation.id)
      if (delegation.childSessionId) this.childToTurn.delete(delegation.childSessionId)
      return
    }

    if (child.status === 'generating' || turn.startedAt !== null) {
      if (!turn.taskContract) {
        const projectDir = await this.options.sessions.resolveConversationWorkdir(
          delegation.parentSessionId
        )
        if (!this.started) return
        turn = this.options.repository.freezeLegacyTaskContract(
          turn.id,
          createLegacyLiveDelegationTaskContractInput(projectDir)
        ).turn
      }
      this.options.repository.ensureInheritedTaskContract(turn.id, child.sessionId)
    }

    const active = this.createActiveTurn(delegation, turn)
    active.childSessionId = child.sessionId
    active.started = turn.startedAt !== null || child.status === 'generating'
    active.runtimeStatus = child.status
    this.childToTurn.set(child.sessionId, turn.id)
    if (child.status === 'generating') {
      if (turn.status === 'waiting_permission' || turn.status === 'waiting_question') {
        return
      }
      if (turn.startedAt === null) {
        const started = this.options.repository.markTurnStarted(turn.id)
        turn = started.turn
        this.notifyObserver({
          type: 'turn_started',
          parentSessionId: started.delegation.parentSessionId,
          childSessionId: child.sessionId,
          delegationId: started.delegation.id,
          turnId: started.turn.id,
          turnKind: started.turn.kind
        })
      }
      void this.runWithAdmission(active, async () => await active.completion.promise)
      return
    }
    if (turn.startedAt === null) {
      if (turn.taskContract) {
        active.runtimeStatus = null
        this.scheduleTurn(delegation, turn, createTurnExecutionSnapshot(child))
        return
      }
      const settled = this.options.repository.finishTurn({
        turnId: turn.id,
        status: 'interrupted',
        error: 'Host restarted before child handoff dispatch was recorded.'
      })
      this.observeTerminalTurn(settled)
      this.observeReconciliation(settled.delegation, settled.turn, { outcome: 'settled' })
      this.publishChanged(settled.delegation)
      this.notifyMailbox(settled.delegation.parentSessionId, settled.delegation.id)
      this.childToTurn.delete(child.sessionId)
      this.activeTurns.delete(turn.id)
      active.completion.resolve()
      return
    }
    const settled = await this.settle(active, {
      status: child.status === 'error' ? 'failed' : 'completed',
      ...(child.status === 'error' ? { error: 'Child session was in an error state.' } : {})
    })
    if (settled) {
      this.observeReconciliation(settled.delegation, settled.turn, { outcome: 'settled' })
    } else {
      this.observeReconciliation(delegation, turn, {
        outcome: 'failed',
        errorCategory: 'persistence'
      })
    }
  }

  private failReconciliation(record: ActiveLiveDelegationTurnIdentity, error: unknown): void {
    console.error('[LiveDelegationService] Failed to reconcile child turn:', {
      delegationId: record.delegationId,
      turnId: record.turnId,
      error
    })
    if (!this.started) return
    if (error instanceof LiveDelegationTaskContractError) {
      let turnId = record.turnId
      let childSessionId = record.childSessionId
      try {
        const current = this.options.repository.getTurn(record.turnId)
        if (!current || !isActiveTurnStatus(current.status)) {
          if (childSessionId) this.childToTurn.delete(childSessionId)
          return
        }
        turnId = current.id
        childSessionId =
          this.options.repository.get(record.delegationId)?.childSessionId ?? childSessionId
      } catch (lookupError) {
        console.error('[LiveDelegationService] Failed to resolve reconciliation quarantine:', {
          delegationId: record.delegationId,
          turnId,
          error: lookupError
        })
      }
      this.quarantinedTurns.add(turnId)
      this.notifyObserver({
        type: 'reconciliation_terminal',
        parentSessionId: record.parentSessionId,
        ...(childSessionId ? { childSessionId } : {}),
        delegationId: record.delegationId,
        turnId,
        outcome: 'quarantined',
        errorCategory: 'integrity'
      })
      if (childSessionId) {
        this.childToTurn.set(childSessionId, turnId)
        const cancellation = this.options.sessions
          .cancelConversation(childSessionId)
          .catch((cancelError) => {
            console.warn('[LiveDelegationService] Failed to cancel quarantined child session:', {
              childSessionId,
              turnId,
              error: cancelError
            })
          })
          .finally(() => this.quarantineCancellations.delete(cancellation))
        this.quarantineCancellations.add(cancellation)
      }
      return
    }
    try {
      const current = this.options.repository.getTurn(record.turnId)
      if (!current || !isActiveTurnStatus(current.status)) {
        if (record.childSessionId) {
          this.childToTurn.delete(record.childSessionId)
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
      this.observeTerminalTurn(settled)
      this.observeReconciliation(settled.delegation, settled.turn, {
        outcome: 'failed',
        errorCategory: 'unknown'
      })
      if (record.childSessionId) {
        this.childToTurn.delete(record.childSessionId)
      }
      this.publishChanged(settled.delegation)
      this.notifyMailbox(settled.delegation.parentSessionId, settled.delegation.id)
    } catch (settleError) {
      this.notifyObserver({
        type: 'reconciliation_terminal',
        parentSessionId: record.parentSessionId,
        ...(record.childSessionId ? { childSessionId: record.childSessionId } : {}),
        delegationId: record.delegationId,
        turnId: record.turnId,
        outcome: 'failed',
        errorCategory: 'persistence'
      })
      console.error('[LiveDelegationService] Failed to persist reconciliation error:', {
        delegationId: record.delegationId,
        turnId: record.turnId,
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
      (await this.options.sessions.resolveConversationWorkdir(parent.sessionId)) ||
      parent.projectDir ||
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

  private async resolveParentProjectDir(parent: CapableParent): Promise<string | null> {
    const runtimeWorkdir = await this.options.sessions.resolveConversationWorkdir(parent.sessionId)
    return runtimeWorkdir || parent.projectDir || null
  }

  private observeQueuedTurn(delegation: LiveDelegation, turn: LiveDelegationTurn): void {
    const observedAt = this.readMonotonicNow()
    if (observedAt === undefined) this.turnObservedAt.delete(turn.id)
    else this.turnObservedAt.set(turn.id, observedAt)
    this.notifyObserver({
      type: 'turn_queued',
      parentSessionId: delegation.parentSessionId,
      delegationId: delegation.id,
      turnId: turn.id,
      turnKind: turn.kind
    })
  }

  private observeTerminalTurn(
    settled: { delegation: LiveDelegation; turn: LiveDelegationTurn },
    errorCategory: LiveDelegationFailureCategory = 'unknown'
  ): void {
    const { delegation, turn } = settled
    if (
      turn.status !== 'completed' &&
      turn.status !== 'failed' &&
      turn.status !== 'cancelled' &&
      turn.status !== 'interrupted'
    ) {
      return
    }
    const durationMs = this.finishTurnObservation(turn.id)
    const identity = {
      type: 'turn_terminal' as const,
      parentSessionId: delegation.parentSessionId,
      ...(delegation.childSessionId ? { childSessionId: delegation.childSessionId } : {}),
      delegationId: delegation.id,
      turnId: turn.id,
      ...(durationMs === undefined ? {} : { durationMs })
    }
    if (turn.status === 'failed') {
      this.notifyObserver({ ...identity, status: 'failed', errorCategory })
      return
    }
    this.notifyObserver({ ...identity, status: turn.status })
  }

  private observeReconciliation(
    delegation: LiveDelegation,
    turn: LiveDelegationTurn,
    outcome:
      | { outcome: 'settled' }
      | {
          outcome: 'quarantined' | 'failed'
          errorCategory: LiveDelegationFailureCategory
        }
  ): void {
    this.notifyObserver({
      type: 'reconciliation_terminal',
      parentSessionId: delegation.parentSessionId,
      ...(delegation.childSessionId ? { childSessionId: delegation.childSessionId } : {}),
      delegationId: delegation.id,
      turnId: turn.id,
      ...outcome
    })
  }

  private finishTurnObservation(turnId: string): number | undefined {
    const observedAt = this.turnObservedAt.get(turnId)
    this.turnObservedAt.delete(turnId)
    if (observedAt === undefined) return undefined
    const completedAt = this.readMonotonicNow()
    if (completedAt === undefined) return undefined
    const elapsed = completedAt - observedAt
    return Number.isFinite(elapsed) && elapsed >= 0 ? elapsed : undefined
  }

  private readMonotonicNow(): number | undefined {
    try {
      const value = this.now()
      return Number.isFinite(value) && value >= 0 ? value : undefined
    } catch {
      return undefined
    }
  }

  private notifyObserver(observation: LiveDelegationLifecycleObservation): void {
    this.observationQueue.enqueue(observation)
  }

  private flushObservations(): Promise<void> {
    return this.observationQueue.flush()
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
  const [handoffSection, ...remainingSections] = LIVE_DELEGATION_REQUIRED_HANDOFF_SECTIONS
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
    `## ${handoffSection}`,
    'A self-contained conclusion for the parent Agent, limited to about 2,000 tokens. Include the',
    'decision, critical evidence, changed files, validation, and unresolved risks needed next.',
    ...remainingSections.map((section) => `## ${section}`),
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
  const handoff = extractMarkdownLevelTwoSection(normalized, 'Handoff')
  const handoffSection = handoff?.body ? handoff.markdown : null
  const result = handoffSection ? null : extractMarkdownLevelTwoSection(normalized, 'Result')
  const resultSection = handoffSection ? null : result?.body ? result.markdown : null
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
    Math.max(1, Math.floor(MAX_MODEL_WAIT_CONTENT_BYTES / Math.max(1, events.length)))
  )
  const projected: LiveDelegationEventSummary[] = []
  for (const event of events) {
    const candidate = projectEventSummary(event, maxBytesPerEvent)
    const next = [...projected, candidate]
    if (
      projected.length > 0 &&
      Buffer.byteLength(JSON.stringify({ events: next, cursor: candidate.id, timedOut }), 'utf8') >
        MAX_MODEL_WAIT_RESPONSE_BYTES
    ) {
      break
    }
    projected.push(candidate)
  }
  return {
    events: projected,
    cursor: projected.at(-1)?.id ?? priorCursor,
    timedOut
  }
}

function projectEventSummary(
  event: LiveDelegationEvent,
  maxBytes: number
): LiveDelegationEventSummary {
  const { content, evaluation, evaluationRef, ...identity } = event
  return {
    ...identity,
    contentPreview: truncateUtf8(content, maxBytes),
    contentTruncated: Buffer.byteLength(content, 'utf8') > maxBytes,
    evaluation:
      evaluation && evaluationRef
        ? projectTaskEvaluationSummary(
            evaluation,
            evaluationRef,
            MAX_MODEL_EVENT_EVALUATION_EVIDENCE
          )
        : null
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
  const {
    prompt,
    resultSummary,
    error,
    taskContract: _taskContract,
    taskContractRef: _taskContractRef,
    inheritedTaskContractRef: _inheritedTaskContractRef,
    evaluation,
    evaluationRef,
    ...identity
  } = turn
  return {
    ...identity,
    promptPreview: truncateUtf8(prompt, MAX_MODEL_PREVIEW_BYTES),
    resultPreview: resultSummary ? truncateUtf8(resultSummary, MAX_MODEL_PREVIEW_BYTES) : null,
    errorPreview: error ? truncateUtf8(error, MAX_MODEL_PREVIEW_BYTES) : null,
    evaluation:
      evaluation && evaluationRef
        ? projectTaskEvaluationSummary(
            evaluation,
            evaluationRef,
            MAX_MODEL_TURN_EVALUATION_EVIDENCE
          )
        : null
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
