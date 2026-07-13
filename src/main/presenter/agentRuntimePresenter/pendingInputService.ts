import type {
  DeepChatSessionState,
  PendingInputEnqueueSource,
  PendingSessionInputRecord,
  QueuePendingInputOptions,
  SendMessageInput
} from '@shared/types/agent-interface'
import type { GenerationActivity } from './generationControlService'
import type { PendingInputCoordinator } from './pendingInputCoordinator'
import type { RuntimeSharedState } from './runtimeSharedState'

export type ProcessPendingInputSource = PendingInputEnqueueSource | 'steer'

type PendingInputRuntimePort = {
  getSessionState: (sessionId: string) => Promise<DeepChatSessionState | null>
  resolveProjectDir: (sessionId: string, incoming?: string | null) => string | null
  normalizeInput: (input: string | SendMessageInput) => SendMessageInput
  isAwaitingToolQuestionFollowUp: (sessionId: string) => boolean
  hasPendingInteractions: (sessionId: string) => boolean
  getGenerationActivity: (sessionId: string) => GenerationActivity
  cancelGeneration: (sessionId: string) => void
  processMessage: (
    sessionId: string,
    input: SendMessageInput,
    context: {
      projectDir: string | null
      pendingQueueItemId: string
      pendingQueueItemSource: ProcessPendingInputSource
    }
  ) => Promise<unknown>
  rollbackPersistedTurn: (sessionId: string, userMessageId: string | null) => void
}

export class PendingInputService {
  private readonly drainTokens = new Map<string, symbol>()

  constructor(
    private readonly coordinator: PendingInputCoordinator,
    private readonly runtimeSharedState: RuntimeSharedState,
    private readonly runtime: PendingInputRuntimePort
  ) {}

  async listPendingInputs(sessionId: string): Promise<PendingSessionInputRecord[]> {
    return this.coordinator.listPendingInputs(sessionId)
  }

  async queuePendingInput(
    sessionId: string,
    content: string | SendMessageInput,
    options?: QueuePendingInputOptions
  ): Promise<PendingSessionInputRecord> {
    const state = await this.requireSessionState(sessionId)
    const projectDir =
      options && Object.prototype.hasOwnProperty.call(options, 'projectDir')
        ? this.runtime.resolveProjectDir(sessionId, options.projectDir)
        : this.runtime.resolveProjectDir(sessionId)
    const normalizedInput = this.runtime.normalizeInput(content)
    if (!normalizedInput.text.trim() && (normalizedInput.files?.length ?? 0) === 0) {
      throw new Error('Message cannot be empty.')
    }

    const pendingInputSource = options?.source ?? 'send'
    const shouldClaimImmediately =
      (pendingInputSource === 'send' &&
        this.runtime.isAwaitingToolQuestionFollowUp(sessionId) &&
        !this.runtime.hasPendingInteractions(sessionId)) ||
      this.shouldStartQueuedInputImmediately(sessionId, state.status)
    const record = this.coordinator.queuePendingInput(sessionId, content, {
      state: shouldClaimImmediately ? 'claimed' : 'pending'
    })

    if (record.state === 'claimed') {
      void this.runtime.processMessage(sessionId, record.payload, {
        projectDir,
        pendingQueueItemId: record.id,
        pendingQueueItemSource: pendingInputSource
      })
      return record
    }

    void this.drainPendingQueueIfPossible(sessionId, 'enqueue')
    return record
  }

  async steerActiveTurn(sessionId: string, content: string | SendMessageInput): Promise<void> {
    const state = await this.requireSessionState(sessionId)
    this.assertCanSteer(sessionId)

    const normalizedInput = this.runtime.normalizeInput(content)
    if (!normalizedInput.text.trim() && (normalizedInput.files?.length ?? 0) === 0) return

    const generationActivity = this.runtime.getGenerationActivity(sessionId)
    if (generationActivity === 'active') {
      this.queueVisibleSteerInput(sessionId, normalizedInput)
      this.runtime.cancelGeneration(sessionId)
      return
    }

    if (generationActivity === 'preparing') {
      this.queueVisibleSteerInput(sessionId, normalizedInput)
      return
    }

    if (!this.canStartPendingQueueDrain(sessionId, state.status, 'enqueue')) {
      if (
        this.runtimeSharedState.drainingPendingQueues.has(sessionId) ||
        state.status === 'generating'
      ) {
        this.queueVisibleSteerInput(sessionId, normalizedInput)
        return
      }
      throw new Error('Unable to start the steered input.')
    }

    const record = this.queueVisibleSteerInput(sessionId, normalizedInput)
    const started = await this.drainPendingQueueIfPossible(sessionId, 'enqueue')
    if (started) return

    const latestState = await this.runtime.getSessionState(sessionId)
    if (
      this.runtimeSharedState.drainingPendingQueues.has(sessionId) ||
      latestState?.status === 'generating'
    ) {
      return
    }

    try {
      this.coordinator.deletePendingInput(sessionId, record.id)
      if (this.runtimeSharedState.activeSteerPendingInputIds.get(sessionId) === record.id) {
        this.runtimeSharedState.activeSteerPendingInputIds.delete(sessionId)
      }
    } catch (error) {
      console.error('[AgentRuntime] Failed to delete unstarted steer input:', error)
    }
    throw new Error('Unable to start the steered input.')
  }

  async updateQueuedInput(
    sessionId: string,
    itemId: string,
    content: string | SendMessageInput
  ): Promise<PendingSessionInputRecord> {
    await this.requireSessionState(sessionId)
    return this.coordinator.updateQueuedInput(sessionId, itemId, content)
  }

  async moveQueuedInput(
    sessionId: string,
    itemId: string,
    toIndex: number
  ): Promise<PendingSessionInputRecord[]> {
    await this.requireSessionState(sessionId)
    return this.coordinator.moveQueuedInput(sessionId, itemId, toIndex)
  }

  async convertPendingInputToSteer(
    sessionId: string,
    itemId: string
  ): Promise<PendingSessionInputRecord> {
    await this.requireSessionState(sessionId)
    return this.coordinator.convertPendingInputToSteer(sessionId, itemId)
  }

  async steerPendingInput(sessionId: string, itemId: string): Promise<PendingSessionInputRecord> {
    await this.requireSessionState(sessionId)
    this.assertCanSteer(sessionId)

    const record = this.coordinator.convertPendingInputToSteer(sessionId, itemId)
    const generationActivity = this.runtime.getGenerationActivity(sessionId)
    if (generationActivity === 'active') {
      this.runtime.cancelGeneration(sessionId)
      return record
    }
    if (generationActivity === 'preparing') return record

    const started = await this.drainPendingQueueIfPossible(sessionId, 'enqueue')
    if (!started) {
      try {
        this.coordinator.restoreSteerInputToQueue(sessionId, itemId)
      } catch (error) {
        console.error('[AgentRuntime] Failed to restore steered input to queue:', error)
      }
      throw new Error('Unable to start the steered input.')
    }
    return record
  }

  async deletePendingInput(sessionId: string, itemId: string): Promise<void> {
    await this.requireSessionState(sessionId)
    this.coordinator.deletePendingInput(sessionId, itemId)
  }

  async drainPendingQueueIfPossible(
    sessionId: string,
    reason: 'enqueue' | 'completed'
  ): Promise<boolean> {
    const state = await this.runtime.getSessionState(sessionId)
    if (!state || !this.canStartPendingQueueDrain(sessionId, state.status, reason)) return false

    const nextSteerInput = this.coordinator.getNextSteerInput(sessionId)
    const nextQueuedInput = nextSteerInput ? null : this.coordinator.getNextQueuedInput(sessionId)
    const nextPendingInput = nextSteerInput ?? nextQueuedInput
    if (!nextPendingInput) return false

    const pendingInputSource: ProcessPendingInputSource = nextSteerInput ? 'steer' : 'queue'
    const drainToken = Symbol(sessionId)
    this.drainTokens.set(sessionId, drainToken)
    this.runtimeSharedState.drainingPendingQueues.add(sessionId)

    let claimedInput: PendingSessionInputRecord
    try {
      claimedInput =
        pendingInputSource === 'steer'
          ? this.coordinator.claimSteerInput(sessionId, nextPendingInput.id)
          : this.coordinator.claimQueuedInput(sessionId, nextPendingInput.id)
    } catch (error) {
      this.releaseDrainToken(sessionId, drainToken)
      console.error('[DeepChatAgent] drainPendingQueueIfPossible error:', error)
      return false
    }

    if (pendingInputSource === 'steer') {
      this.runtimeSharedState.activeSteerPendingInputIds.delete(sessionId)
    }

    void this.runtime
      .processMessage(sessionId, claimedInput.payload, {
        projectDir: this.runtime.resolveProjectDir(sessionId),
        pendingQueueItemId: claimedInput.id,
        pendingQueueItemSource: pendingInputSource
      })
      .catch((error) => {
        console.error('[DeepChatAgent] drainPendingQueueIfPossible error:', error)
      })
      .finally(async () => {
        if (!this.releaseDrainToken(sessionId, drainToken)) return
        try {
          if (
            this.coordinator.hasPendingTurnInput(sessionId) &&
            (await this.runtime.getSessionState(sessionId))?.status === 'idle' &&
            !this.runtime.hasPendingInteractions(sessionId)
          ) {
            void this.drainPendingQueueIfPossible(sessionId, 'completed')
          }
        } catch (error) {
          console.error('[DeepChatAgent] drainPendingQueueIfPossible cleanup error:', error)
        }
      })

    return true
  }

  consumeQueuedInput(sessionId: string, pendingInputId: string): void {
    this.coordinator.consumeQueuedInput(sessionId, pendingInputId)
  }

  consumeClaimedInput(
    sessionId: string,
    pendingInputId: string,
    pendingInputSource: ProcessPendingInputSource
  ): void {
    if (pendingInputSource === 'steer') {
      this.coordinator.consumeSteerInput(sessionId, pendingInputId)
      return
    }
    this.coordinator.consumeQueuedInput(sessionId, pendingInputId)
  }

  releaseClaimedInput(
    sessionId: string,
    pendingInputId: string,
    pendingInputSource: ProcessPendingInputSource
  ): void {
    if (pendingInputSource === 'steer') {
      this.coordinator.releaseClaimedInput(sessionId, pendingInputId)
      return
    }
    this.coordinator.releaseClaimedQueueInput(sessionId, pendingInputId)
  }

  rollbackClaimedInputTurn(
    sessionId: string,
    pendingInputId: string,
    pendingInputSource: ProcessPendingInputSource,
    userMessageId: string | null
  ): void {
    this.runtime.rollbackPersistedTurn(sessionId, userMessageId)
    this.releaseClaimedInput(sessionId, pendingInputId, pendingInputSource)
  }

  hasPendingSteerInput(sessionId: string): boolean {
    return Boolean(this.coordinator.getNextSteerInput(sessionId))
  }

  assertNoActiveInputs(sessionId: string): void {
    if (this.coordinator.hasActiveInputs(sessionId)) {
      throw new Error('Please clear the waiting lane before mutating chat history.')
    }
  }

  recoverClaimedInputsAfterRestart(): number {
    return this.coordinator.recoverClaimedInputsAfterRestart()
  }

  deleteBySession(sessionId: string): void {
    this.coordinator.deleteBySession(sessionId)
  }

  destroySession(sessionId: string): void {
    this.coordinator.deleteBySession(sessionId)
    this.runtimeSharedState.activeSteerPendingInputIds.delete(sessionId)
    this.drainTokens.delete(sessionId)
    this.runtimeSharedState.drainingPendingQueues.delete(sessionId)
  }

  private releaseDrainToken(sessionId: string, drainToken: symbol): boolean {
    if (this.drainTokens.get(sessionId) !== drainToken) return false
    this.drainTokens.delete(sessionId)
    this.runtimeSharedState.drainingPendingQueues.delete(sessionId)
    return true
  }

  private async requireSessionState(sessionId: string): Promise<DeepChatSessionState> {
    const state = await this.runtime.getSessionState(sessionId)
    if (!state) throw new Error(`Session ${sessionId} not found`)
    return state
  }

  private assertCanSteer(sessionId: string): void {
    if (
      this.runtime.isAwaitingToolQuestionFollowUp(sessionId) ||
      this.runtime.hasPendingInteractions(sessionId)
    ) {
      throw new Error('Please resolve pending tool interactions before steering.')
    }
  }

  private queueVisibleSteerInput(
    sessionId: string,
    input: SendMessageInput
  ): PendingSessionInputRecord {
    const mergeItemId = this.runtimeSharedState.activeSteerPendingInputIds.get(sessionId) ?? null
    try {
      const record = this.coordinator.queueSteerInput(sessionId, input, { mergeItemId })
      this.runtimeSharedState.activeSteerPendingInputIds.set(sessionId, record.id)
      return record
    } catch (error) {
      if (!mergeItemId) throw error
      this.runtimeSharedState.activeSteerPendingInputIds.delete(sessionId)
      const record = this.coordinator.queueSteerInput(sessionId, input)
      this.runtimeSharedState.activeSteerPendingInputIds.set(sessionId, record.id)
      return record
    }
  }

  private shouldStartQueuedInputImmediately(
    sessionId: string,
    status: DeepChatSessionState['status']
  ): boolean {
    return (
      this.canStartPendingQueueDrain(sessionId, status, 'enqueue') &&
      !this.coordinator.hasPendingTurnInput(sessionId)
    )
  }

  private canStartPendingQueueDrain(
    sessionId: string,
    status: DeepChatSessionState['status'],
    reason: 'enqueue' | 'completed'
  ): boolean {
    if (!this.canDrainPendingQueueFromStatus(status, reason)) return false
    if (this.runtime.isAwaitingToolQuestionFollowUp(sessionId)) return false
    if (this.runtime.hasPendingInteractions(sessionId)) return false
    return !this.runtimeSharedState.drainingPendingQueues.has(sessionId)
  }

  private canDrainPendingQueueFromStatus(
    status: DeepChatSessionState['status'],
    reason: 'enqueue' | 'completed'
  ): boolean {
    return status === 'idle' || (reason === 'enqueue' && status === 'error')
  }
}
