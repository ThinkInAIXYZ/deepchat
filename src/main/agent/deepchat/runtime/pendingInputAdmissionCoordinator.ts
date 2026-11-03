import type { ProviderModelResolutionPort } from '@/provider/settings'
import logger from '@shared/logger'
import type {
  MessageStartResult,
  PendingSessionInputRecord,
  QueuePendingInputOptions,
  SendMessageInput
} from '@shared/types/agent-interface'
import {
  type SessionScopeRegistry,
  type SessionRuntimeScope
} from '@/agent/deepchat/instance/deepChatAgentRuntime'
import { toAppSessionId } from '@/agent/shared/agentSessionIds'
import { isSendMessageInputEmpty } from '@/agent/shared/agentSessionNormalization'
import type { SessionPendingInputs } from '@/session/data/pendingInputs'
import type { SessionTranscript } from '@/session/data/transcript'
import type {
  AttachmentCapabilityRouter,
  AttachmentPreparationResult
} from '@/ocr/attachmentCapabilityRouter'
import { createAbortError, PENDING_INPUT_ABORT_REASON } from './abortErrors'
import { supportsProviderVision } from './providerInputCapabilities'
import type { ClaimedPendingInputHandle } from './pendingInputContracts'
import type { PendingInputPump } from './pendingInputPump'
import { redactRuntimeErrorForLog } from './runtimeErrorLogging'
import type { SessionSettingsCoordinator } from './sessionSettingsCoordinator'
import type { SessionStateResolver } from './sessionStateResolver'

export type PendingInputAdmissionStorePort = Pick<
  SessionPendingInputs,
  | 'degradeBlockedInput'
  | 'deletePendingInput'
  | 'getInput'
  | 'hasActiveInputs'
  | 'hasBlockingInput'
  | 'hasClaimedInput'
  | 'isAtCapacity'
  | 'listPendingInputs'
  | 'moveQueuedInput'
  | 'retryBlockedInput'
  | 'retryReleasedQueueInput'
  | 'updateQueuedInput'
>

export type PendingInputAdmissionPumpPort = Pick<
  PendingInputPump,
  | 'enqueue'
  | 'acceptVisibleSteerInput'
  | 'promoteQueuedInput'
  | 'schedule'
  | 'hasInteractionBlocker'
  | 'canDrain'
  | 'drain'
  | 'claimQueuedInputForPreparation'
  | 'releaseRestartHoldForInput'
  | 'releaseRestartHoldForSession'
  | 'hasRestartHeldQueueInputs'
  | 'hasOnlyRestartHeldQueueInputs'
>

export interface PendingInputAdmissionCoordinatorPorts {
  providerSettings: Pick<ProviderModelResolutionPort, 'getModelConfig'>
  pendingInputs: PendingInputAdmissionStorePort
  pump: PendingInputAdmissionPumpPort
  transcript: Pick<SessionTranscript, 'getMessage'>
  attachmentRouter: Pick<AttachmentCapabilityRouter, 'prepare'>
  sessionState: Pick<SessionStateResolver, 'get'>
  registry: SessionScopeRegistry
  sessionSettings: Pick<SessionSettingsCoordinator, 'resolveProjectDir'>
}

export class PendingInputAdmissionCoordinator {
  constructor(private readonly ports: PendingInputAdmissionCoordinatorPorts) {}

  list(sessionId: string): PendingSessionInputRecord[] {
    return this.ports.pendingInputs.listPendingInputs(sessionId)
  }

  async isPendingQueueResumeAvailable(sessionId: string): Promise<boolean> {
    await this.ports.registry.getOrHydrateScope(toAppSessionId(sessionId)).instance.controlReady()
    return await this.ports.pump.hasRestartHeldQueueInputs(sessionId)
  }

  async queue(
    sessionId: string,
    content: string | SendMessageInput,
    options?: QueuePendingInputOptions,
    expectedScope?: SessionRuntimeScope
  ): Promise<PendingSessionInputRecord> {
    const scope = expectedScope ?? this.ports.registry.getOrHydrateScope(toAppSessionId(sessionId))
    expectedScope?.assertCurrent()
    const state = await this.ports.sessionState.get(sessionId)
    if (!state) {
      throw new Error(`Session ${sessionId} not found`)
    }
    scope.assertCurrent()
    const projectDir =
      options && Object.prototype.hasOwnProperty.call(options, 'projectDir')
        ? this.ports.sessionSettings.resolveProjectDir(sessionId, options.projectDir)
        : this.ports.sessionSettings.resolveProjectDir(sessionId)
    const input = typeof content === 'string' ? { text: content, files: [] } : content
    if (options?.signal?.aborted) throw createAbortError()
    if (isSendMessageInputEmpty(input)) {
      throw new Error('Message cannot be empty.')
    }

    return await this.ports.pump.enqueue(
      sessionId,
      input,
      options?.source ?? 'send',
      projectDir,
      scope,
      options?.signal
    )
  }

  async sendQueuedMessage(
    sessionId: string,
    content: SendMessageInput,
    options: QueuePendingInputOptions,
    context?: { signal?: AbortSignal }
  ): Promise<MessageStartResult> {
    if ((options.source ?? 'send') !== 'send') {
      await this.queue(sessionId, content, {
        ...options,
        signal: context?.signal
      })
      return { requestId: null, messageId: null }
    }

    const { release: releaseAcceptanceLane, scope } = await this.acquireAttachmentAcceptanceLane(
      sessionId,
      'send',
      context?.signal
    )
    try {
      if (this.ports.pendingInputs.isAtCapacity(sessionId)) {
        throw new Error('Pending input limit reached for this session.')
      }

      const prepared = await this.prepareMessageInputNow(sessionId, content, {
        signal: context?.signal
      })
      scope.assertCurrent()
      if (prepared.summary.status === 'needs_user_action') {
        return {
          requestId: null,
          messageId: null,
          attachmentPreparation: prepared.summary
        }
      }

      if (context?.signal?.aborted) throw createAbortError()

      await this.queue(
        sessionId,
        prepared.content,
        {
          ...options,
          signal: context?.signal
        },
        scope
      )
      return {
        requestId: null,
        messageId: null,
        attachmentPreparation: prepared.summary
      }
    } finally {
      await releaseAcceptanceLane()
    }
  }

  async steerActiveTurn(
    sessionId: string,
    content: string | SendMessageInput,
    options?: { signal?: AbortSignal }
  ): Promise<MessageStartResult> {
    const input = typeof content === 'string' ? { text: content, files: [] } : content
    const { release: releaseAcceptanceLane, scope } = await this.acquireAttachmentAcceptanceLane(
      sessionId,
      'steer',
      options?.signal
    )
    try {
      const state = await this.ports.sessionState.get(sessionId)
      scope.assertCurrent()
      if (!state) {
        throw new Error(`Session ${sessionId} not found`)
      }
      if (await this.ports.pump.hasInteractionBlocker(sessionId)) {
        throw new Error('Please resolve pending tool interactions before steering.')
      }
      if (isSendMessageInputEmpty(input)) {
        throw new Error('Message cannot be empty.')
      }

      const prepared: AttachmentPreparationResult = input.files?.length
        ? await this.prepareMessageInputNow(sessionId, input, { signal: options?.signal })
        : {
            content: input,
            summary: { status: 'ready', issues: [], suggestedActions: [] }
          }
      scope.assertCurrent()
      if (prepared.summary.status === 'needs_user_action') {
        return {
          requestId: null,
          messageId: null,
          attachmentPreparation: prepared.summary
        }
      }
      if (options?.signal?.aborted) throw createAbortError()
      const preparedResult: MessageStartResult = {
        requestId: null,
        messageId: null,
        attachmentPreparation: prepared.summary
      }

      const instance = scope.instance
      const activeGeneration = instance?.getActiveGeneration()
      const preStreamController = instance?.getAbortController()

      if (activeGeneration) {
        this.requireActiveAssistantMessage(sessionId, activeGeneration.messageId)
        const accepted = await this.acceptVisibleSteerInput(scope, prepared.content)
        return { ...preparedResult, userMessage: accepted.message }
      }

      if (
        instance &&
        preStreamController &&
        (!preStreamController.signal.aborted ||
          preStreamController.signal.reason === PENDING_INPUT_ABORT_REASON)
      ) {
        const accepted = await this.acceptVisibleSteerInput(scope, prepared.content, {
          preStreamAnchorMessageId: instance.getPreStreamTranscriptAnchorId() ?? null
        })
        if (accepted.sourceMessage) {
          instance.setPreStreamTranscriptAnchorId(accepted.sourceMessage.id)
        }
        if (!preStreamController.signal.aborted) {
          preStreamController.abort(PENDING_INPUT_ABORT_REASON)
        }
        return { ...preparedResult, userMessage: accepted.message }
      }

      const openSteerInputId = instance?.getActiveSteerPendingInputId()
      const openSteerInput = openSteerInputId
        ? this.ports.pendingInputs.getInput(sessionId, openSteerInputId)
        : null
      if (openSteerInput?.mode === 'steer' && openSteerInput.state === 'pending') {
        const accepted = await this.acceptVisibleSteerInput(scope, prepared.content)
        this.ports.pump.schedule(sessionId, 'enqueue')
        return { ...preparedResult, userMessage: accepted.message }
      }

      if (!(await this.ports.pump.canDrain(sessionId, state.status, 'enqueue'))) {
        throw new Error('Unable to start the steered input.')
      }

      const accepted = await this.acceptVisibleSteerInput(scope, prepared.content)
      await releaseAcceptanceLane()
      const started = await this.ports.pump.drain(sessionId, 'enqueue')
      if (!started) {
        this.ports.pump.schedule(sessionId, 'enqueue')
      }
      return { ...preparedResult, userMessage: accepted.message }
    } finally {
      await releaseAcceptanceLane()
    }
  }

  async updateQueuedInput(
    sessionId: string,
    itemId: string,
    content: string | SendMessageInput
  ): Promise<PendingSessionInputRecord> {
    await this.ensureSessionReady(sessionId)
    const input = typeof content === 'string' ? { text: content, files: [] } : content
    if (isSendMessageInputEmpty(input)) {
      throw new Error('Message cannot be empty.')
    }
    const record = this.ports.pendingInputs.updateQueuedInput(sessionId, itemId, input)
    this.ports.pump.schedule(sessionId, 'enqueue')
    return record
  }

  async moveQueuedInput(
    sessionId: string,
    itemId: string,
    toIndex: number
  ): Promise<PendingSessionInputRecord[]> {
    await this.ensureSessionReady(sessionId)
    return this.ports.pendingInputs.moveQueuedInput(sessionId, itemId, toIndex)
  }

  async steerPendingInput(sessionId: string, itemId: string): Promise<PendingSessionInputRecord> {
    const { release: releaseAcceptanceLane, scope } = await this.acquireAttachmentAcceptanceLane(
      sessionId,
      'steer'
    )
    try {
      await this.ensureSessionReady(sessionId)
      scope.assertCurrent()
      if (await this.ports.pump.hasInteractionBlocker(sessionId)) {
        throw new Error('Please resolve pending tool interactions before steering.')
      }

      const pendingInput = this.ports.pendingInputs
        .listPendingInputs(sessionId)
        .find((item) => item.id === itemId)
      if (!pendingInput) {
        throw new Error(`Pending input not found: ${itemId}`)
      }
      if (pendingInput.mode !== 'queue' || pendingInput.state !== 'pending') {
        throw new Error('Only a pending queue input can be steered.')
      }
      if (this.ports.pendingInputs.hasBlockingInput(sessionId)) {
        throw new Error('Resolve the blocked attachment input before steering another item.')
      }

      const claim = await this.ports.pump.claimQueuedInputForPreparation(sessionId, itemId)
      let prepared: AttachmentPreparationResult
      try {
        prepared = await this.prepareMessageInputNow(sessionId, pendingInput.payload)
        scope.assertCurrent()
      } catch (error) {
        await this.releaseClaimAfterFailure(claim)
        throw error
      }
      if (prepared.summary.status === 'needs_user_action') {
        try {
          return await claim.settle({
            kind: 'block',
            attachmentPreparation: prepared.summary
          })
        } catch (error) {
          await this.releaseClaimAfterFailure(claim)
          throw error
        }
      }

      const instance = scope.instance
      const activeGeneration = instance?.getActiveGeneration()
      const preStreamController = instance?.getAbortController()

      if (activeGeneration) {
        this.requireActiveAssistantMessage(sessionId, activeGeneration.messageId)
        const promoted = (
          await this.ports.pump.promoteQueuedInput(scope, itemId, prepared.content, claim)
        ).pendingInput
        return promoted
      }

      if (
        instance &&
        preStreamController &&
        (!preStreamController.signal.aborted ||
          preStreamController.signal.reason === PENDING_INPUT_ABORT_REASON)
      ) {
        const accepted = await this.ports.pump.promoteQueuedInput(
          scope,
          itemId,
          prepared.content,
          claim,
          {
            preStreamAnchorMessageId: instance.getPreStreamTranscriptAnchorId() ?? null
          }
        )
        if (accepted.sourceMessage) {
          instance.setPreStreamTranscriptAnchorId(accepted.sourceMessage.id)
        }
        if (!preStreamController.signal.aborted) {
          preStreamController.abort(PENDING_INPUT_ABORT_REASON)
        }
        return accepted.pendingInput
      }

      const record = (
        await this.ports.pump.promoteQueuedInput(scope, itemId, prepared.content, claim)
      ).pendingInput
      await releaseAcceptanceLane()
      const started = await this.ports.pump.drain(sessionId, 'enqueue')
      if (!started) {
        this.ports.pump.schedule(sessionId, 'enqueue')
      }
      return record
    } finally {
      await releaseAcceptanceLane()
    }
  }

  async deletePendingInput(sessionId: string, itemId: string): Promise<void> {
    await this.ensureSessionReady(sessionId)
    this.ports.pendingInputs.deletePendingInput(sessionId, itemId)
    await this.ports.pump.releaseRestartHoldForInput(sessionId, itemId)
    this.ports.pump.schedule(sessionId, 'enqueue')
  }

  async resolveBlockedPendingInput(
    sessionId: string,
    itemId: string,
    action: 'retry' | 'send_without_image_content'
  ): Promise<PendingSessionInputRecord> {
    await this.ensureSessionReady(sessionId)
    const record =
      action === 'retry'
        ? this.ports.pendingInputs.retryBlockedInput(sessionId, itemId)
        : this.ports.pendingInputs.degradeBlockedInput(sessionId, itemId)
    this.ports.pump.schedule(sessionId, 'enqueue')
    return record
  }

  async retryPendingQueueInput(
    sessionId: string,
    itemId: string
  ): Promise<{ accepted: boolean; started: boolean }> {
    await this.ensureSessionReady(sessionId)
    const input = this.ports.pendingInputs.getInput(sessionId, itemId)
    if (!input) {
      throw new Error(`Pending input not found: ${itemId}`)
    }
    if (input.mode !== 'queue') {
      throw new Error('Only a released queue input can be retried.')
    }
    if (input.state !== 'retry_required') {
      return { accepted: false, started: false }
    }

    try {
      this.ports.pendingInputs.retryReleasedQueueInput(sessionId, itemId)
    } catch (error) {
      const persisted = this.ports.pendingInputs.getInput(sessionId, itemId)
      if (persisted?.mode !== 'queue' || persisted.state !== 'pending') {
        throw error
      }
      logger.error(
        `[DeepChatAgent] retry pending queue publication failed session=${sessionId}`,
        redactRuntimeErrorForLog(error)
      )
    }
    let started = false
    try {
      started = await this.ports.pump.drain(sessionId, 'manual')
    } catch (error) {
      logger.error(
        `[DeepChatAgent] retry pending queue drain failed session=${sessionId}`,
        redactRuntimeErrorForLog(error)
      )
    }
    if (!started) {
      this.ports.pump.schedule(sessionId, 'enqueue')
    }
    return { accepted: true, started }
  }

  async resumePendingQueue(sessionId: string): Promise<boolean> {
    const state = await this.ports.sessionState.get(sessionId)
    if (!state) {
      throw new Error(`Session ${sessionId} not found`)
    }
    if (this.ports.pendingInputs.hasBlockingInput(sessionId)) {
      throw new Error('Resolve the blocked attachment input before resuming the queue.')
    }
    if (this.ports.pendingInputs.hasClaimedInput(sessionId)) {
      return false
    }
    if (!(await this.ports.pump.canDrain(sessionId, state.status, 'manual'))) {
      return false
    }
    if (!(await this.ports.pump.releaseRestartHoldForSession(sessionId))) {
      return false
    }
    return await this.ports.pump.drain(sessionId, 'manual')
  }

  async assertNoActiveInputs(
    sessionId: string,
    options?: { allowRestartHeldQueue?: boolean }
  ): Promise<void> {
    if (!this.ports.pendingInputs.hasActiveInputs(sessionId)) {
      return
    }
    if (
      options?.allowRestartHeldQueue === true &&
      (await this.ports.pump.hasOnlyRestartHeldQueueInputs(sessionId))
    ) {
      return
    }
    throw new Error('Please clear the waiting lane before mutating chat history.')
  }

  private async acquireAttachmentAcceptanceLane(
    sessionId: string,
    lane: 'send' | 'steer',
    signal?: AbortSignal
  ): Promise<{ release: () => Promise<void>; scope: SessionRuntimeScope }> {
    const scope = this.ports.registry.getOrHydrateScope(toAppSessionId(sessionId))
    const release = await scope.instance.acquireAttachmentAcceptance(lane, signal)
    return { release, scope }
  }

  private async prepareMessageInputNow(
    sessionId: string,
    content: SendMessageInput,
    options?: {
      preserveResolvedRepresentations?: boolean
      signal?: AbortSignal
    }
  ): Promise<AttachmentPreparationResult> {
    const state = await this.ports.sessionState.get(sessionId)
    if (!state) throw new Error(`Session ${sessionId} not found`)
    return await this.ports.attachmentRouter.prepare({
      content,
      supportsVision: supportsProviderVision(
        this.ports.providerSettings,
        state.providerId,
        state.modelId
      ),
      signal: options?.signal,
      preserveResolvedRepresentations: options?.preserveResolvedRepresentations,
      emitDiagnostics: false
    })
  }

  private async ensureSessionReady(sessionId: string): Promise<void> {
    const state = await this.ports.sessionState.get(sessionId)
    if (!state) {
      throw new Error(`Session ${sessionId} not found`)
    }
  }

  private async acceptVisibleSteerInput(
    scope: SessionRuntimeScope,
    input: SendMessageInput,
    options?: { preStreamAnchorMessageId?: string | null }
  ) {
    return await this.ports.pump.acceptVisibleSteerInput(scope, input, options)
  }

  private requireActiveAssistantMessage(sessionId: string, messageId: string): void {
    const message = this.ports.transcript.getMessage(messageId)
    if (!message || message.sessionId !== sessionId || message.role !== 'assistant') {
      throw new Error('Wait for the assistant response to start before steering.')
    }
  }

  private async releaseClaimAfterFailure(claim: ClaimedPendingInputHandle): Promise<void> {
    if (claim.disposition) {
      return
    }
    try {
      await claim.settle({ kind: 'release-before-user-fact' })
    } catch (releaseError) {
      logger.error(
        `[DeepChatAgent] failed to release pending input after admission failure item=${claim.id}`,
        redactRuntimeErrorForLog(releaseError)
      )
    }
  }
}
