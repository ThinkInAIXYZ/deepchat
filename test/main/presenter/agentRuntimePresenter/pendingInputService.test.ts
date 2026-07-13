import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { DeepChatSessionState, PendingSessionInputRecord } from '@shared/types/agent-interface'
import type { PendingInputCoordinator } from '@/presenter/agentRuntimePresenter/pendingInputCoordinator'
import { PendingInputService } from '@/presenter/agentRuntimePresenter/pendingInputService'
import { RuntimeSharedState } from '@/presenter/agentRuntimePresenter/runtimeSharedState'

function createRecord(
  id: string,
  mode: PendingSessionInputRecord['mode'],
  state: PendingSessionInputRecord['state'] = 'pending'
): PendingSessionInputRecord {
  return {
    id,
    sessionId: 's1',
    mode,
    state,
    payload: { text: id, files: [] },
    queueOrder: mode === 'queue' ? 1 : null,
    claimedAt: state === 'claimed' ? 1 : null,
    consumedAt: null,
    createdAt: 1,
    updatedAt: 1
  }
}

function createCoordinator() {
  return {
    listPendingInputs: vi.fn(() => []),
    queuePendingInput: vi.fn(),
    queueSteerInput: vi.fn(),
    updateQueuedInput: vi.fn(),
    moveQueuedInput: vi.fn(),
    convertPendingInputToSteer: vi.fn(),
    restoreSteerInputToQueue: vi.fn(),
    deletePendingInput: vi.fn(),
    getNextSteerInput: vi.fn(() => null),
    getNextQueuedInput: vi.fn(() => null),
    hasPendingTurnInput: vi.fn(() => false),
    claimSteerInput: vi.fn(),
    claimQueuedInput: vi.fn(),
    consumeSteerInput: vi.fn(),
    consumeQueuedInput: vi.fn(),
    releaseClaimedInput: vi.fn(),
    releaseClaimedQueueInput: vi.fn(),
    hasActiveInputs: vi.fn(() => false),
    recoverClaimedInputsAfterRestart: vi.fn(() => 0),
    deleteBySession: vi.fn()
  }
}

describe('PendingInputService', () => {
  let state: DeepChatSessionState
  let coordinator: ReturnType<typeof createCoordinator>
  let runtimeSharedState: RuntimeSharedState
  let runtime: {
    getSessionState: ReturnType<typeof vi.fn>
    resolveProjectDir: ReturnType<typeof vi.fn>
    normalizeInput: ReturnType<typeof vi.fn>
    isAwaitingToolQuestionFollowUp: ReturnType<typeof vi.fn>
    hasPendingInteractions: ReturnType<typeof vi.fn>
    getGenerationActivity: ReturnType<typeof vi.fn>
    cancelGeneration: ReturnType<typeof vi.fn>
    processMessage: ReturnType<typeof vi.fn>
    rollbackPersistedTurn: ReturnType<typeof vi.fn>
  }
  let service: PendingInputService

  beforeEach(() => {
    state = {
      status: 'idle',
      providerId: 'openai',
      modelId: 'gpt-4',
      permissionMode: 'full_access'
    }
    coordinator = createCoordinator()
    runtimeSharedState = new RuntimeSharedState()
    runtime = {
      getSessionState: vi.fn(async () => state),
      resolveProjectDir: vi.fn(() => '/workspace'),
      normalizeInput: vi.fn((input: string | { text: string }) =>
        typeof input === 'string' ? { text: input, files: [] } : { ...input, files: [] }
      ),
      isAwaitingToolQuestionFollowUp: vi.fn(() => false),
      hasPendingInteractions: vi.fn(() => false),
      getGenerationActivity: vi.fn(() => 'idle'),
      cancelGeneration: vi.fn(),
      processMessage: vi.fn().mockResolvedValue(undefined),
      rollbackPersistedTurn: vi.fn()
    }
    service = new PendingInputService(
      coordinator as unknown as PendingInputCoordinator,
      runtimeSharedState,
      runtime
    )
  })

  it('claims a send input immediately while waiting for a tool follow-up', async () => {
    const claimed = createRecord('q1', 'queue', 'claimed')
    runtime.isAwaitingToolQuestionFollowUp.mockReturnValue(true)
    coordinator.queuePendingInput.mockReturnValue(claimed)

    await expect(
      service.queuePendingInput('s1', 'Continue', { projectDir: '/requested' })
    ).resolves.toBe(claimed)

    expect(coordinator.queuePendingInput).toHaveBeenCalledWith('s1', 'Continue', {
      state: 'claimed'
    })
    expect(runtime.resolveProjectDir).toHaveBeenCalledWith('s1', '/requested')
    expect(runtime.processMessage).toHaveBeenCalledWith('s1', claimed.payload, {
      projectDir: '/workspace',
      pendingQueueItemId: 'q1',
      pendingQueueItemSource: 'send'
    })
  })

  it('does not claim a follow-up input while another interaction is still pending', async () => {
    const pending = createRecord('q1', 'queue')
    runtime.isAwaitingToolQuestionFollowUp.mockReturnValue(true)
    runtime.hasPendingInteractions.mockReturnValue(true)
    coordinator.queuePendingInput.mockReturnValue(pending)

    await expect(service.queuePendingInput('s1', 'Continue')).resolves.toBe(pending)

    expect(coordinator.queuePendingInput).toHaveBeenCalledWith('s1', 'Continue', {
      state: 'pending'
    })
    expect(runtime.processMessage).not.toHaveBeenCalled()
  })

  it('queues steer input before requesting active generation cancellation', async () => {
    const steer = createRecord('steer-1', 'steer')
    runtime.getGenerationActivity.mockReturnValue('active')
    coordinator.queueSteerInput.mockReturnValue(steer)

    await service.steerActiveTurn('s1', 'Refine')

    expect(coordinator.queueSteerInput).toHaveBeenCalledWith(
      's1',
      { text: 'Refine', files: [] },
      { mergeItemId: null }
    )
    expect(runtime.cancelGeneration).toHaveBeenCalledWith('s1')
    expect(coordinator.queueSteerInput.mock.invocationCallOrder[0]).toBeLessThan(
      runtime.cancelGeneration.mock.invocationCallOrder[0]
    )
    expect(runtimeSharedState.activeSteerPendingInputIds.get('s1')).toBe('steer-1')
  })

  it('merges rapid steer input into the active pending steer record', async () => {
    const first = createRecord('steer-1', 'steer')
    const merged = { ...first, payload: { text: 'First\n\nSecond', files: [] } }
    runtime.getGenerationActivity.mockReturnValue('preparing')
    coordinator.queueSteerInput.mockReturnValueOnce(first).mockReturnValueOnce(merged)

    await service.steerActiveTurn('s1', 'First')
    await service.steerActiveTurn('s1', 'Second')

    expect(coordinator.queueSteerInput).toHaveBeenLastCalledWith(
      's1',
      { text: 'Second', files: [] },
      { mergeItemId: 'steer-1' }
    )
    expect(runtime.cancelGeneration).not.toHaveBeenCalled()
  })

  it('claims steer input first and holds the single drain guard until the turn settles', async () => {
    const pendingSteer = createRecord('steer-1', 'steer')
    const claimedSteer = createRecord('steer-1', 'steer', 'claimed')
    let settleTurn: () => void = () => {}
    runtime.processMessage.mockReturnValue(
      new Promise<void>((resolve) => {
        settleTurn = resolve
      })
    )
    coordinator.getNextSteerInput.mockReturnValue(pendingSteer)
    coordinator.getNextQueuedInput.mockReturnValue(createRecord('queue-1', 'queue'))
    coordinator.claimSteerInput.mockReturnValue(claimedSteer)
    runtimeSharedState.activeSteerPendingInputIds.set('s1', 'steer-1')

    await expect(service.drainPendingQueueIfPossible('s1', 'enqueue')).resolves.toBe(true)

    expect(coordinator.claimSteerInput).toHaveBeenCalledWith('s1', 'steer-1')
    expect(coordinator.claimQueuedInput).not.toHaveBeenCalled()
    expect(runtimeSharedState.drainingPendingQueues.has('s1')).toBe(true)
    expect(runtimeSharedState.activeSteerPendingInputIds.has('s1')).toBe(false)

    await expect(service.drainPendingQueueIfPossible('s1', 'enqueue')).resolves.toBe(false)
    settleTurn()
    await vi.waitFor(() => {
      expect(runtimeSharedState.drainingPendingQueues.has('s1')).toBe(false)
    })
  })

  it('releases the drain guard when claiming fails so the queue can be retried', async () => {
    const pending = createRecord('queue-1', 'queue')
    const claimed = createRecord('queue-1', 'queue', 'claimed')
    const claimError = new Error('claim failed')
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})
    coordinator.getNextQueuedInput.mockReturnValue(pending)
    coordinator.claimQueuedInput.mockImplementationOnce(() => {
      throw claimError
    })
    coordinator.claimQueuedInput.mockReturnValueOnce(claimed)

    try {
      await expect(service.drainPendingQueueIfPossible('s1', 'enqueue')).resolves.toBe(false)

      expect(runtimeSharedState.drainingPendingQueues.has('s1')).toBe(false)
      expect(runtime.processMessage).not.toHaveBeenCalled()

      await expect(service.drainPendingQueueIfPossible('s1', 'enqueue')).resolves.toBe(true)

      expect(coordinator.claimQueuedInput).toHaveBeenCalledTimes(2)
      expect(runtime.processMessage).toHaveBeenCalledWith('s1', claimed.payload, {
        projectDir: '/workspace',
        pendingQueueItemId: 'queue-1',
        pendingQueueItemSource: 'queue'
      })
      await vi.waitFor(() => {
        expect(runtimeSharedState.drainingPendingQueues.has('s1')).toBe(false)
      })
    } finally {
      consoleError.mockRestore()
    }
  })

  it('automatically drains the next pending input after the current turn settles', async () => {
    const firstPending = createRecord('queue-1', 'queue')
    const secondPending = createRecord('queue-2', 'queue')
    const firstClaimed = createRecord('queue-1', 'queue', 'claimed')
    const secondClaimed = createRecord('queue-2', 'queue', 'claimed')
    let settleFirst: () => void = () => {}
    let settleSecond: () => void = () => {}
    coordinator.getNextQueuedInput
      .mockReturnValueOnce(firstPending)
      .mockReturnValueOnce(secondPending)
      .mockReturnValue(null)
    coordinator.claimQueuedInput
      .mockReturnValueOnce(firstClaimed)
      .mockReturnValueOnce(secondClaimed)
    coordinator.hasPendingTurnInput.mockReturnValueOnce(true).mockReturnValue(false)
    runtime.processMessage
      .mockReturnValueOnce(new Promise<void>((resolve) => (settleFirst = resolve)))
      .mockReturnValueOnce(new Promise<void>((resolve) => (settleSecond = resolve)))

    await expect(service.drainPendingQueueIfPossible('s1', 'enqueue')).resolves.toBe(true)

    settleFirst()
    await vi.waitFor(() => {
      expect(runtime.processMessage).toHaveBeenCalledTimes(2)
    })

    expect(coordinator.claimQueuedInput).toHaveBeenNthCalledWith(1, 's1', 'queue-1')
    expect(coordinator.claimQueuedInput).toHaveBeenNthCalledWith(2, 's1', 'queue-2')
    expect(runtime.processMessage).toHaveBeenNthCalledWith(2, 's1', secondClaimed.payload, {
      projectDir: '/workspace',
      pendingQueueItemId: 'queue-2',
      pendingQueueItemSource: 'queue'
    })
    expect(runtimeSharedState.drainingPendingQueues.has('s1')).toBe(true)

    settleSecond()
    await vi.waitFor(() => {
      expect(runtimeSharedState.drainingPendingQueues.has('s1')).toBe(false)
    })
  })

  it('restores a promoted steer item when an idle drain cannot start', async () => {
    const queue = createRecord('q1', 'queue')
    const steer = { ...queue, mode: 'steer' as const, queueOrder: null }
    coordinator.convertPendingInputToSteer.mockReturnValue(steer)
    coordinator.restoreSteerInputToQueue.mockReturnValue(queue)
    vi.spyOn(service, 'drainPendingQueueIfPossible').mockResolvedValue(false)

    await expect(service.steerPendingInput('s1', 'q1')).rejects.toThrow(
      'Unable to start the steered input.'
    )
    expect(coordinator.restoreSteerInputToQueue).toHaveBeenCalledWith('s1', 'q1')
  })

  it('rolls back persisted turn state before releasing the source claim', () => {
    service.rollbackClaimedInputTurn('s1', 'steer-1', 'steer', 'user-1')

    expect(runtime.rollbackPersistedTurn).toHaveBeenCalledWith('s1', 'user-1')
    expect(coordinator.releaseClaimedInput).toHaveBeenCalledWith('s1', 'steer-1')
    expect(coordinator.releaseClaimedQueueInput).not.toHaveBeenCalled()
  })

  it('clears shared queue ownership when deleting a session', () => {
    runtimeSharedState.activeSteerPendingInputIds.set('s1', 'steer-1')
    runtimeSharedState.drainingPendingQueues.add('s1')

    service.destroySession('s1')

    expect(coordinator.deleteBySession).toHaveBeenCalledWith('s1')
    expect(runtimeSharedState.activeSteerPendingInputIds.has('s1')).toBe(false)
    expect(runtimeSharedState.drainingPendingQueues.has('s1')).toBe(false)
  })

  it('does not let an old drain release a replacement drain after session reuse', async () => {
    const oldPending = createRecord('old', 'queue')
    const newPending = createRecord('new', 'queue')
    let settleOld: () => void = () => {}
    let settleNew: () => void = () => {}
    coordinator.getNextQueuedInput.mockReturnValueOnce(oldPending).mockReturnValue(newPending)
    coordinator.claimQueuedInput
      .mockReturnValueOnce({ ...oldPending, state: 'claimed' })
      .mockReturnValue({ ...newPending, state: 'claimed' })
    runtime.processMessage
      .mockReturnValueOnce(new Promise<void>((resolve) => (settleOld = resolve)))
      .mockReturnValueOnce(new Promise<void>((resolve) => (settleNew = resolve)))

    await expect(service.drainPendingQueueIfPossible('s1', 'enqueue')).resolves.toBe(true)
    service.destroySession('s1')
    await expect(service.drainPendingQueueIfPossible('s1', 'enqueue')).resolves.toBe(true)

    settleOld()
    await Promise.resolve()
    await Promise.resolve()

    expect(runtimeSharedState.drainingPendingQueues.has('s1')).toBe(true)
    await expect(service.drainPendingQueueIfPossible('s1', 'enqueue')).resolves.toBe(false)

    settleNew()
    await vi.waitFor(() => {
      expect(runtimeSharedState.drainingPendingQueues.has('s1')).toBe(false)
    })
  })

  it('rejects history mutation while pending inputs remain active', () => {
    coordinator.hasActiveInputs.mockReturnValue(true)
    expect(() => service.assertNoActiveInputs('s1')).toThrow(
      'Please clear the waiting lane before mutating chat history.'
    )
  })
})
