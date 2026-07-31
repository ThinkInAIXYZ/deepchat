import type { ProviderModelResolutionPort } from '@/provider/settings'
import logger from '@shared/logger'
import type {
  DeepChatSessionState,
  ChatMessageRecord,
  MessageStartResult,
  PendingInputEnqueueSource,
  PendingSessionInputRecord,
  QueuePendingInputOptions,
  SendMessageInput
} from '@shared/types/agent-interface'
import {
  createStaleDeepChatInstanceError,
  type SessionScopeRegistry
} from '@/agent/deepchat/instance/deepChatAgentRuntime'
import { toAppSessionId } from '@/agent/shared/agentSessionIds'
import type { SessionPendingInputs } from '@/session/data/pendingInputs'
import type { SessionTranscript } from '@/session/data/transcript'
import type {
  AttachmentCapabilityRouter,
  AttachmentPreparationResult
} from '@/ocr/attachmentCapabilityRouter'
import { awaitWithAbort } from '@/lib/awaitWithAbort'
import { createAbortError, PENDING_INPUT_ABORT_REASON } from './abortErrors'
import { supportsProviderVision } from './providerInputCapabilities'
import type { ClaimedPendingInputHandle } from './pendingInputContracts'
import type { PendingInputWakeReason } from './runLifecycleCoordinator'
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
  | 'isAtCapacity'
  | 'listPendingInputs'
  | 'moveQueuedInput'
  | 'acceptSteerMessage'
  | 'promoteQueuedInputToSteerMessage'
  | 'queuePendingInput'
  | 'retryBlockedInput'
  | 'updateQueuedInput'
>

export interface PendingInputAdmissionPumpPort {
  shouldClaimImmediately(
    sessionId: string,
    status: DeepChatSessionState['status'],
    source: PendingInputEnqueueSource
  ): boolean
  startAcceptedInput(
    record: PendingSessionInputRecord,
    source: PendingInputEnqueueSource,
    projectDir: string | null
  ): void
  schedule(sessionId: string, reason: PendingInputWakeReason): void
  hasInteractionBlocker(sessionId: string): boolean
  canDrain(
    sessionId: string,
    status: DeepChatSessionState['status'],
    reason: PendingInputWakeReason
  ): boolean
  drain(sessionId: string, reason: PendingInputWakeReason): Promise<boolean>
  claimQueuedInputForPreparation(
    sessionId: string,
    itemId: string
  ): ClaimedPendingInputHandle
}

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
  private readonly attachmentAcceptanceTails = new Map<string, Promise<void>>()

  constructor(private readonly ports: PendingInputAdmissionCoordinatorPorts) {}

  list(sessionId: string): PendingSessionInputRecord[] {
    const inputs = this.ports.pendingInputs.listPendingInputs(sessionId)
    if (inputs.some((input) => input.mode === 'steer' && input.state === 'pending')) {
      this.ports.pump.schedule(sessionId, 'enqueue')
    }
    return inputs
  }

  async queue(
    sessionId: string,
    content: string | SendMessageInput,
    options?: QueuePendingInputOptions
  ): Promise<PendingSessionInputRecord> {
    const state = await this.ports.sessionState.get(sessionId)
    if (!state) {
      throw new Error(`Session ${sessionId} not found`)
    }
    const projectDir =
      options && Object.prototype.hasOwnProperty.call(options, 'projectDir')
        ? this.ports.sessionSettings.resolveProjectDir(sessionId, options.projectDir)
        : this.ports.sessionSettings.resolveProjectDir(sessionId)
    const input = typeof content === 'string' ? { text: content, files: [] } : content
    if (options?.signal?.aborted) throw createAbortError()
    if (!input.text.trim() && (input.files?.length ?? 0) === 0) {
      throw new Error('Message cannot be empty.')
    }

    const source = options?.source ?? 'send'
    const shouldClaimImmediately = this.ports.pump.shouldClaimImmediately(
      sessionId,
      state.status,
      source
    )
    const record = this.ports.pendingInputs.queuePendingInput(sessionId, input, {
      state: shouldClaimImmediately ? 'claimed' : 'pending'
    })

    if (record.state === 'claimed') {
      this.ports.pump.startAcceptedInput(record, source, projectDir)
    } else {
      this.ports.pump.schedule(sessionId, 'enqueue')
    }
    return record
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

    const releaseAcceptanceLane = await this.acquireAttachmentAcceptanceLane(
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
      if (prepared.summary.status === 'needs_user_action') {
        return {
          requestId: null,
          messageId: null,
          attachmentPreparation: prepared.summary
        }
      }

      if (context?.signal?.aborted) throw createAbortError()

      await this.queue(sessionId, prepared.content, {
        ...options,
        signal: context?.signal
      })
      return {
        requestId: null,
        messageId: null,
        attachmentPreparation: prepared.summary
      }
    } finally {
      releaseAcceptanceLane()
    }
  }

  async steerActiveTurn(
    sessionId: string,
    content: string | SendMessageInput,
    options?: { signal?: AbortSignal }
  ): Promise<MessageStartResult> {
    const input = typeof content === 'string' ? { text: content, files: [] } : content
    const hasPriorSteerAcceptance = this.attachmentAcceptanceTails.has(
      this.buildAttachmentAcceptanceLaneKey(sessionId, 'steer')
    )
    const releaseAcceptanceLane =
      input.files?.length || hasPriorSteerAcceptance
        ? await this.acquireAttachmentAcceptanceLane(sessionId, 'steer', options?.signal)
        : () => {}
    try {
      const state = await this.ports.sessionState.get(sessionId)
      if (!state) {
        throw new Error(`Session ${sessionId} not found`)
      }
      if (this.ports.pump.hasInteractionBlocker(sessionId)) {
        throw new Error('Please resolve pending tool interactions before steering.')
      }
      if (!input.text.trim() && (input.files?.length ?? 0) === 0) {
        throw new Error('Message cannot be empty.')
      }

      const prepared: AttachmentPreparationResult = input.files?.length
        ? await this.prepareMessageInputNow(sessionId, input, { signal: options?.signal })
        : {
            content: input,
            summary: { status: 'ready', issues: [], suggestedActions: [] }
          }
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

      const instance = this.ports.registry.getHydratedScope(toAppSessionId(sessionId))?.instance
      const activeGeneration = instance?.getActiveGeneration()
      const preStreamController = instance?.getAbortController()

      if (activeGeneration) {
        this.requireActiveAssistantMessage(sessionId, activeGeneration.messageId)
        const accepted = this.acceptVisibleSteerInput(sessionId, prepared.content)
        return { ...preparedResult, userMessage: accepted.message }
      }

      if (
        instance &&
        preStreamController &&
        (!preStreamController.signal.aborted ||
          preStreamController.signal.reason === PENDING_INPUT_ABORT_REASON)
      ) {
        const accepted = this.acceptVisibleSteerInput(sessionId, prepared.content, {
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
        const accepted = this.acceptVisibleSteerInput(sessionId, prepared.content)
        this.ports.pump.schedule(sessionId, 'enqueue')
        return { ...preparedResult, userMessage: accepted.message }
      }

      if (!this.ports.pump.canDrain(sessionId, state.status, 'enqueue')) {
        throw new Error('Unable to start the steered input.')
      }

      const accepted = this.acceptVisibleSteerInput(sessionId, prepared.content)
      releaseAcceptanceLane()
      const started = await this.ports.pump.drain(sessionId, 'enqueue')
      if (!started) {
        this.ports.pump.schedule(sessionId, 'enqueue')
      }
      return { ...preparedResult, userMessage: accepted.message }
    } finally {
      releaseAcceptanceLane()
    }
  }

  async updateQueuedInput(
    sessionId: string,
    itemId: string,
    content: string | SendMessageInput
  ): Promise<PendingSessionInputRecord> {
    await this.ensureSessionReady(sessionId)
    const input = typeof content === 'string' ? { text: content, files: [] } : content
    if (!input.text.trim() && (input.files?.length ?? 0) === 0) {
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
    const releaseAcceptanceLane = await this.acquireAttachmentAcceptanceLane(sessionId, 'steer')
    try {
      await this.ensureSessionReady(sessionId)
      if (this.ports.pump.hasInteractionBlocker(sessionId)) {
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

      const claim = this.ports.pump.claimQueuedInputForPreparation(sessionId, itemId)
      let prepared: AttachmentPreparationResult
      try {
        prepared = await this.prepareMessageInputNow(sessionId, pendingInput.payload)
      } catch (error) {
        this.releaseClaimAfterFailure(claim)
        throw error
      }
      if (prepared.summary.status === 'needs_user_action') {
        try {
          return claim.settle({
            kind: 'block',
            attachmentPreparation: prepared.summary
          })
        } catch (error) {
          this.releaseClaimAfterFailure(claim)
          throw error
        }
      }

      claim.settle({ kind: 'release-before-user-fact' })
      this.ports.pendingInputs.updateQueuedInput(sessionId, itemId, prepared.content)

      const instance = this.ports.registry.getHydratedScope(toAppSessionId(sessionId))?.instance
      const activeGeneration = instance?.getActiveGeneration()
      const preStreamController = instance?.getAbortController()

      if (activeGeneration) {
        this.requireActiveAssistantMessage(sessionId, activeGeneration.messageId)
        return this.ports.pendingInputs.promoteQueuedInputToSteerMessage(sessionId, itemId)
          .pendingInput
      }

      if (
        instance &&
        preStreamController &&
        (!preStreamController.signal.aborted ||
          preStreamController.signal.reason === PENDING_INPUT_ABORT_REASON)
      ) {
        const accepted = this.ports.pendingInputs.promoteQueuedInputToSteerMessage(
          sessionId,
          itemId,
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

      const record = this.ports.pendingInputs.promoteQueuedInputToSteerMessage(
        sessionId,
        itemId
      ).pendingInput
      releaseAcceptanceLane()
      const started = await this.ports.pump.drain(sessionId, 'enqueue')
      if (!started) {
        this.ports.pump.schedule(sessionId, 'enqueue')
      }
      return record
    } finally {
      releaseAcceptanceLane()
    }
  }

  async deletePendingInput(sessionId: string, itemId: string): Promise<void> {
    await this.ensureSessionReady(sessionId)
    this.ports.pendingInputs.deletePendingInput(sessionId, itemId)
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

  assertNoActiveInputs(sessionId: string): void {
    if (!this.ports.pendingInputs.hasActiveInputs(sessionId)) {
      return
    }
    throw new Error('Please clear the waiting lane before mutating chat history.')
  }

  private async acquireAttachmentAcceptanceLane(
    sessionId: string,
    lane: 'send' | 'steer',
    signal?: AbortSignal
  ): Promise<() => void> {
    const key = this.buildAttachmentAcceptanceLaneKey(sessionId, lane)
    const previous = this.attachmentAcceptanceTails.get(key) ?? Promise.resolve()
    let resolveSlot!: () => void
    const slot = new Promise<void>((resolve) => {
      resolveSlot = resolve
    })
    const tail = previous.then(
      () => slot,
      () => slot
    )
    this.attachmentAcceptanceTails.set(key, tail)

    let released = false
    const release = () => {
      if (released) return
      released = true
      resolveSlot()
      void tail.then(() => {
        if (this.attachmentAcceptanceTails.get(key) === tail) {
          this.attachmentAcceptanceTails.delete(key)
        }
      })
    }
    try {
      await awaitWithAbort(previous, signal)
      return release
    } catch (error) {
      release()
      throw error
    }
  }

  private buildAttachmentAcceptanceLaneKey(
    sessionId: string,
    lane: 'send' | 'steer'
  ): string {
    return `${lane}:${sessionId}`
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

  private acceptVisibleSteerInput(
    sessionId: string,
    input: SendMessageInput,
    options?: {
      preStreamAnchorMessageId?: string | null
    }
  ): {
    pendingInput: PendingSessionInputRecord
    message: ChatMessageRecord
    sourceMessage?: ChatMessageRecord
  } {
    const instance = this.ports.registry.getHydratedScope(toAppSessionId(sessionId))?.instance
    if (!instance) {
      throw createStaleDeepChatInstanceError(sessionId)
    }
    const activeItemId = instance.getActiveSteerPendingInputId() ?? null
    const activeItem = activeItemId
      ? this.ports.pendingInputs.getInput(sessionId, activeItemId)
      : null
    const mergeItemId =
      activeItem?.mode === 'steer' && activeItem.state === 'pending' ? activeItem.id : null
    if (activeItemId && !mergeItemId) {
      instance.clearActiveSteerPendingInputId()
    }
    const accepted = this.ports.pendingInputs.acceptSteerMessage(sessionId, input, {
      mergeItemId,
      ...(options ? { preStreamAnchorMessageId: options.preStreamAnchorMessageId ?? null } : {})
    })
    instance.setActiveSteerPendingInputId(accepted.pendingInput.id)
    return accepted
  }

  private requireActiveAssistantMessage(sessionId: string, messageId: string): void {
    const message = this.ports.transcript.getMessage(messageId)
    if (!message || message.sessionId !== sessionId || message.role !== 'assistant') {
      throw new Error('Wait for the assistant response to start before steering.')
    }
  }

  private releaseClaimAfterFailure(claim: ClaimedPendingInputHandle): void {
    if (claim.disposition) {
      return
    }
    try {
      claim.settle({ kind: 'release-before-user-fact' })
    } catch (releaseError) {
      logger.error(
        `[DeepChatAgent] failed to release pending input after admission failure item=${claim.id}`,
        redactRuntimeErrorForLog(releaseError)
      )
    }
  }
}
