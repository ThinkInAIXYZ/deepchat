import { describe, expect, it, vi } from 'vitest'
import { DeepChatAgentRuntime } from '@/agent/deepchat/instance/deepChatAgentRuntime'
import { toAppSessionId } from '@/agent/shared/agentSessionIds'
import {
  SessionLifecycleCoordinator,
  type SessionLifecycleCoordinatorDependencies
} from '@/agent/deepchat/runtime/sessionLifecycleCoordinator'

const SESSION_ID = 'session'

function createHarness() {
  const order: string[] = []
  const record =
    <TArgs extends unknown[], TResult>(label: string, result?: TResult) =>
    (..._args: TArgs): TResult => {
      order.push(label)
      return result as TResult
    }
  const runtime = new DeepChatAgentRuntime()
  const cancel = vi.fn(async () => undefined)
  const deps = {
    registry: runtime,
    providerSettings: {} as SessionLifecycleCoordinatorDependencies['providerSettings'],
    promptSettings: { getDefaultSystemPrompt: vi.fn(async () => '') },
    sessionStore: { create: vi.fn(), delete: vi.fn(record('sessionStore.delete')) },
    transcript: { deleteBySession: vi.fn(record('transcript.deleteBySession')) },
    pendingInputs: { deleteBySession: vi.fn(record('pendingInputs.deleteBySession')) },
    toolService: {
      clearConversationToolMapping: vi.fn(record('toolService.clearConversationToolMapping'))
    },
    identity: { getAgentId: vi.fn(() => 'deepchat') },
    sessionSettings: { normalizeProjectDir: vi.fn(() => null) },
    compaction: { idleState: vi.fn(() => ({ state: 'idle' })) },
    memory: {
      initializeSession: vi.fn(),
      beginSessionDestroy: vi.fn(record('memory.beginSessionDestroy')),
      finishSessionDestroy: vi.fn(record('memory.finishSessionDestroy'))
    },
    runLifecycle: {
      cancel,
      clearFirstTurnReady: vi.fn(record('runLifecycle.clearFirstTurnReady')),
      cancelScopeOperations: vi.fn(record('runLifecycle.cancelScopeOperations')),
      scopeFor: vi.fn()
    },
    interactionParking: { clearSession: vi.fn(record('interactionParking.clearSession')) }
  } as unknown as SessionLifecycleCoordinatorDependencies

  return { cancel, coordinator: new SessionLifecycleCoordinator(deps), deps, order, runtime }
}

describe('SessionLifecycleCoordinator', () => {
  it('cleans nothing and hydrates nothing when the session has no runtime instance', async () => {
    const { cancel, coordinator, runtime } = createHarness()

    await coordinator.cleanup(SESSION_ID)

    expect(cancel).not.toHaveBeenCalled()
    expect(runtime.getHydrated(toAppSessionId(SESSION_ID))).toBeUndefined()
  })

  it('cancels, clears owned state, and evicts an already hydrated instance', async () => {
    const { cancel, coordinator, runtime } = createHarness()
    const instance = runtime.getOrHydrate(toAppSessionId(SESSION_ID))
    instance.setRuntimeState({
      status: 'idle',
      providerId: 'openai',
      modelId: 'gpt-5',
      permissionMode: 'full_access'
    })

    await coordinator.cleanup(SESSION_ID)

    expect(cancel).toHaveBeenCalledOnce()
    expect(instance.getRuntimeState()).toBeUndefined()
    expect(runtime.getHydrated(toAppSessionId(SESSION_ID))).toBeUndefined()
  })

  it('keeps a replacement instance when cancellation replaced the cleaned one', async () => {
    const { cancel, coordinator, runtime } = createHarness()
    const original = runtime.getOrHydrate(toAppSessionId(SESSION_ID))
    let replacement = original
    cancel.mockImplementationOnce(async () => {
      runtime.evict(toAppSessionId(SESSION_ID))
      replacement = runtime.getOrHydrate(toAppSessionId(SESSION_ID))
    })

    await coordinator.cleanup(SESSION_ID)

    expect(replacement).not.toBe(original)
    expect(runtime.getHydrated(toAppSessionId(SESSION_ID))).toBe(replacement)
  })

  it('clears owned state even when cancellation fails', async () => {
    const { cancel, coordinator, runtime } = createHarness()
    const instance = runtime.getOrHydrate(toAppSessionId(SESSION_ID))
    instance.setAgentId('agent-a')
    cancel.mockRejectedValueOnce(new Error('cancel failed'))

    await expect(coordinator.cleanup(SESSION_ID)).rejects.toThrow('cancel failed')

    expect(instance.getAgentId()).toBeUndefined()
    expect(runtime.getHydrated(toAppSessionId(SESSION_ID))).toBeUndefined()
  })

  it('destroys a hydrated session in the documented owner order', async () => {
    const { coordinator, order, runtime } = createHarness()
    const instance = runtime.getOrHydrate(toAppSessionId(SESSION_ID))
    instance.setAgentId('agent-a')

    await coordinator.destroy(SESSION_ID)

    expect(order).toEqual([
      'memory.beginSessionDestroy',
      'runLifecycle.cancelScopeOperations',
      'runLifecycle.clearFirstTurnReady',
      'pendingInputs.deleteBySession',
      'transcript.deleteBySession',
      'sessionStore.delete',
      'interactionParking.clearSession',
      'memory.finishSessionDestroy',
      'toolService.clearConversationToolMapping'
    ])
    expect(instance.getAgentId()).toBeUndefined()
    expect(runtime.getHydrated(toAppSessionId(SESSION_ID))).toBeUndefined()
  })

  it('destroys durable session facts even when no runtime instance is hydrated', async () => {
    const { coordinator, order } = createHarness()

    await coordinator.destroy(SESSION_ID)

    expect(order).toEqual([
      'memory.beginSessionDestroy',
      'runLifecycle.clearFirstTurnReady',
      'pendingInputs.deleteBySession',
      'transcript.deleteBySession',
      'sessionStore.delete',
      'interactionParking.clearSession',
      'memory.finishSessionDestroy',
      'toolService.clearConversationToolMapping'
    ])
  })
})
