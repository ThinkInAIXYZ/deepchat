import { describe, expect, it, vi } from 'vitest'
import { DeepChatAgentRuntime } from '@/agent/deepchat/instance/deepChatAgentRuntime'
import { toAppSessionId } from '@/agent/shared/agentSessionIds'
import {
  TranscriptMutationCoordinator,
  type TranscriptMutationCoordinatorDependencies
} from '@/agent/deepchat/runtime/transcriptMutationCoordinator'

const SESSION_ID = 'session'

const IDLE_STATE = {
  status: 'idle' as const,
  providerId: 'openai',
  modelId: 'gpt-5',
  permissionMode: 'full_access' as const
}

function createHarness(state: unknown = IDLE_STATE) {
  const order: string[] = []
  const runtime = new DeepChatAgentRuntime()
  const record = (label: string) => () => {
    order.push(label)
  }
  const deps = {
    registry: runtime,
    sessionState: { get: vi.fn(async () => state) },
    sessionSettings: { resolveProjectDir: vi.fn(() => '/workspace') },
    admission: { assertNoActiveInputs: vi.fn(record('admission.assertNoActiveInputs')) },
    compaction: { reset: vi.fn(record('compaction.reset')), invalidateIfNeeded: vi.fn() },
    memory: {
      resetExtractionCursor: vi.fn(record('memory.resetExtractionCursor')),
      clearProjectionRetry: vi.fn(record('memory.clearProjectionRetry')),
      invalidateFromOrderSeq: vi.fn()
    },
    runLifecycle: {
      assertCurrentInstance: vi.fn((sessionId: string, instance: unknown) =>
        runtime.scopeFor(toAppSessionId(sessionId), instance as never).assertCurrent()
      ),
      cancel: vi.fn(async () => order.push('runLifecycle.cancel')),
      clearFirstTurnReady: vi.fn(record('runLifecycle.clearFirstTurnReady')),
      hasPendingInteractions: vi.fn(() => false),
      refreshPendingInteractions: vi.fn(record('runLifecycle.refreshPendingInteractions')),
      scopeFor: vi.fn((sessionId: string, instance: unknown) =>
        runtime.scopeFor(toAppSessionId(sessionId), instance as never)
      ),
      transitionCurrentStatus: vi.fn(record('runLifecycle.transitionCurrentStatus')),
      transitionStatus: vi.fn(record('runLifecycle.transitionStatus'))
    }
  } as unknown as TranscriptMutationCoordinatorDependencies

  return { coordinator: new TranscriptMutationCoordinator(deps), deps, order, runtime }
}

describe('TranscriptMutationCoordinator', () => {
  it('cancels before releasing readiness and memory cursors when clearing messages', async () => {
    const { coordinator, order } = createHarness()

    await coordinator.prepareClearMessages(SESSION_ID)

    expect(order).toEqual([
      'runLifecycle.cancel',
      'runLifecycle.clearFirstTurnReady',
      'memory.resetExtractionCursor',
      'memory.clearProjectionRetry'
    ])
  })

  it('rejects clearing an unknown session before touching any owner', async () => {
    const { coordinator, order } = createHarness(null)

    await expect(coordinator.prepareClearMessages(SESSION_ID)).rejects.toThrow(
      `Session ${SESSION_ID} not found`
    )
    expect(order).toEqual([])
  })

  it('resets pending interactions, compaction, and status when clearing finishes', () => {
    const { coordinator, order, runtime } = createHarness()
    const instance = runtime.getOrHydrate(toAppSessionId(SESSION_ID))
    instance.replacePendingInteractions([
      { messageId: 'm1', toolCallId: 'tc1', origin: 'permission', order: 0 }
    ])

    coordinator.finishClearMessages(SESSION_ID)

    expect(instance.hasPendingInteractions()).toBe(false)
    expect(order).toEqual(['compaction.reset', 'runLifecycle.transitionStatus'])
  })

  it('refuses retry while generating, while interactions are pending, or with active inputs', async () => {
    const generating = createHarness({ ...IDLE_STATE, status: 'generating' })
    await expect(generating.coordinator.prepareRetry(SESSION_ID)).rejects.toThrow(
      'Cannot retry while session is generating.'
    )

    const interacting = createHarness()
    vi.mocked(interacting.deps.runLifecycle.hasPendingInteractions).mockReturnValueOnce(true)
    await expect(interacting.coordinator.prepareRetry(SESSION_ID)).rejects.toThrow(
      'Please resolve pending tool interactions before retrying.'
    )

    const blocked = createHarness()
    vi.mocked(blocked.deps.admission.assertNoActiveInputs).mockImplementationOnce(() => {
      throw new Error('Please clear the waiting lane before mutating chat history.')
    })
    await expect(blocked.coordinator.prepareRetry(SESSION_ID)).rejects.toThrow(
      'Please clear the waiting lane before mutating chat history.'
    )
  })

  it('returns the resolved project directory for an accepted retry', async () => {
    const { coordinator, deps } = createHarness()

    await expect(coordinator.prepareRetry(SESSION_ID)).resolves.toEqual({
      projectDir: '/workspace'
    })
    expect(deps.sessionSettings.resolveProjectDir).toHaveBeenCalledWith(
      SESSION_ID,
      undefined,
      expect.anything()
    )
  })

  it('forwards the narrow restart-held Queue retry exception to admission', async () => {
    const { coordinator, deps } = createHarness()

    await coordinator.prepareRetry(SESSION_ID, { allowRestartHeldQueue: true })

    expect(deps.admission.assertNoActiveInputs).toHaveBeenCalledWith(SESSION_ID, {
      allowRestartHeldQueue: true
    })
  })

  it('fences transcript mutation cancel against a replaced runtime instance', async () => {
    const { coordinator, deps, runtime } = createHarness()
    vi.mocked(deps.runLifecycle.cancel).mockImplementationOnce(async () => {
      runtime.evict(toAppSessionId(SESSION_ID))
      runtime.getOrHydrate(toAppSessionId(SESSION_ID))
    })

    await expect(coordinator.cancelForTranscriptMutation(SESSION_ID)).rejects.toMatchObject({
      name: 'StaleDeepChatAgentInstanceError'
    })
  })

  it('refreshes pending interactions before projecting idle after a truncate', () => {
    const { coordinator, order } = createHarness()

    coordinator.finishTranscriptTruncate(SESSION_ID)

    expect(order).toEqual([
      'runLifecycle.refreshPendingInteractions',
      'runLifecycle.transitionCurrentStatus'
    ])
  })

  it('invalidates compaction and memory for the same order sequence', () => {
    const { coordinator, deps } = createHarness()

    coordinator.invalidateTranscriptFrom(SESSION_ID, 7)

    expect(deps.compaction.invalidateIfNeeded).toHaveBeenCalledWith(
      SESSION_ID,
      7,
      expect.anything()
    )
    expect(deps.memory.invalidateFromOrderSeq).toHaveBeenCalledWith(SESSION_ID, 7)
  })

  it('resets compaction on the fork target instance', () => {
    const { coordinator, deps, runtime } = createHarness()

    coordinator.resetForkTarget('target')

    expect(deps.compaction.reset).toHaveBeenCalledWith(
      'target',
      runtime.getHydrated(toAppSessionId('target'))
    )
  })
})
