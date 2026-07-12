import { describe, expect, it, vi } from 'vitest'
import { DeepChatAgentRuntime } from '@/agent/deepchat/instance/deepChatAgentRuntime'
import { toAppSessionId } from '@/agent/shared/agentSessionIds'

const createDelegate = () => ({
  compatibilityImplementation: {} as never,
  send: vi.fn().mockResolvedValue({ requestId: 'request', messageId: 'message' }),
  cancel: vi.fn().mockResolvedValue(undefined),
  snapshot: vi.fn().mockResolvedValue({ status: 'idle' }),
  close: vi.fn().mockResolvedValue(undefined)
})

describe('DeepChatAgentRuntime', () => {
  it('hydrates one stable instance per app session', () => {
    const hydrate = vi.fn(() => createDelegate())
    const runtime = new DeepChatAgentRuntime(hydrate)
    const sessionId = toAppSessionId('session')

    const first = runtime.getOrHydrate(sessionId)
    const second = runtime.getOrHydrate(sessionId)
    const other = runtime.getOrHydrate(toAppSessionId('other'))

    expect(first).toBe(second)
    expect(other).not.toBe(first)
    expect(hydrate).toHaveBeenCalledTimes(2)
  })

  it('delegates the legacy façade and rehydrates only after close', async () => {
    const delegates: ReturnType<typeof createDelegate>[] = []
    const runtime = new DeepChatAgentRuntime(() => {
      const delegate = createDelegate()
      delegates.push(delegate)
      return delegate
    })
    const sessionId = toAppSessionId('session')
    const instance = runtime.getOrHydrate(sessionId)

    await expect(instance.send({ content: 'hello' })).resolves.toEqual({
      requestId: 'request',
      messageId: 'message'
    })
    await instance.cancel()
    await expect(instance.snapshot({ lightweight: true })).resolves.toEqual({ status: 'idle' })
    await instance.close()

    expect(delegates[0].send).toHaveBeenCalledWith({ content: 'hello' })
    expect(delegates[0].cancel).toHaveBeenCalledTimes(1)
    expect(delegates[0].snapshot).toHaveBeenCalledWith({ lightweight: true })
    expect(delegates[0].close).toHaveBeenCalledTimes(1)
    expect(runtime.getOrHydrate(sessionId)).not.toBe(instance)
    expect(delegates).toHaveLength(2)
  })

  it('supports explicit eviction and disposal without creating an instance', async () => {
    const delegate = createDelegate()
    const hydrate = vi.fn(() => delegate)
    const runtime = new DeepChatAgentRuntime(hydrate)
    const sessionId = toAppSessionId('session')

    await runtime.dispose(sessionId)
    expect(hydrate).not.toHaveBeenCalled()

    runtime.getOrHydrate(sessionId)
    expect(runtime.evict(sessionId)).toBe(true)
    expect(delegate.close).not.toHaveBeenCalled()
  })

  it('reads only already hydrated instances without creating a shell', () => {
    const runtime = new DeepChatAgentRuntime(() => createDelegate())
    const sessionId = toAppSessionId('session')

    expect(runtime.getHydrated(sessionId)).toBeUndefined()
    const instance = runtime.getOrHydrate(sessionId)
    expect(runtime.getHydrated(sessionId)).toBe(instance)
    runtime.evict(sessionId)
    expect(runtime.getHydrated(sessionId)).toBeUndefined()
  })

  it('isolates identity, settings, status, project and readiness by session', async () => {
    const runtime = new DeepChatAgentRuntime(() => createDelegate())
    const first = runtime.getOrHydrate(toAppSessionId('first'))
    const second = runtime.getOrHydrate(toAppSessionId('second'))

    first.setAgentId('agent-a')
    first.setProjectDir('/workspace/a')
    first.setGenerationSettings({
      systemPrompt: '',
      temperature: 0.2,
      contextLength: 8192,
      maxTokens: 1024,
      timeout: 600000
    })
    first.setRuntimeState({
      status: 'generating',
      providerId: 'openai',
      modelId: 'model',
      permissionMode: 'default'
    })

    expect(first.getAgentId()).toBe('agent-a')
    expect(first.hasProjectDir()).toBe(true)
    expect(first.getProjectDir()).toBe('/workspace/a')
    expect(first.getGenerationSettings()?.temperature).toBe(0.2)
    expect(first.getRuntimeState()?.status).toBe('generating')
    expect(second.getAgentId()).toBeUndefined()
    expect(second.hasProjectDir()).toBe(false)
    expect(second.getGenerationSettings()).toBeUndefined()
    expect(second.getRuntimeState()).toBeUndefined()

    const canceledWait = first.waitForFirstTurnReady()
    first.clearFirstTurnReady()
    await expect(canceledWait).resolves.toBe(false)
    first.markFirstTurnReady()
    await expect(first.waitForFirstTurnReady()).resolves.toBe(true)
  })

  it('owns pre-stream and active generation state without stale-run clears', () => {
    const runtime = new DeepChatAgentRuntime(() => createDelegate())
    const instance = runtime.getOrHydrate(toAppSessionId('session'))
    const controller = new AbortController()

    instance.setAbortController(controller)
    expect(instance.getAbortSignal()).toBe(controller.signal)

    const generation = instance.registerActiveGeneration('run-1', 'message-1', controller)
    expect(instance.getActiveGeneration()).toBe(generation)
    expect(instance.clearActiveGeneration('stale-run')).toBe(false)
    expect(instance.isActiveRun('run-1')).toBe(true)
    expect(instance.clearActiveGeneration('run-1')).toBe(true)
    expect(instance.getActiveGeneration()).toBeUndefined()
    expect(instance.getAbortController()).toBeUndefined()
  })

  it('aborts pre-stream work immediately but retains an active run until settlement', () => {
    const runtime = new DeepChatAgentRuntime(() => createDelegate())
    const first = runtime.getOrHydrate(toAppSessionId('first'))
    const second = runtime.getOrHydrate(toAppSessionId('second'))
    const preStreamController = new AbortController()
    const activeController = new AbortController()

    first.setAbortController(preStreamController)
    first.requestGenerationAbort()
    expect(preStreamController.signal.aborted).toBe(true)
    expect(first.getAbortController()).toBeUndefined()

    first.registerActiveGeneration('run-1', 'message-1', activeController)
    first.requestGenerationAbort()
    expect(activeController.signal.aborted).toBe(true)
    expect(first.getActiveGeneration()?.runId).toBe('run-1')
    expect(second.getAbortSignal()).toBeUndefined()

    first.abortAndClearGeneration()
    expect(first.getActiveGeneration()).toBeUndefined()
    expect(first.getAbortController()).toBeUndefined()
  })

  it('isolates pending drain and steer merge state by instance', () => {
    const runtime = new DeepChatAgentRuntime(() => createDelegate())
    const first = runtime.getOrHydrate(toAppSessionId('first'))
    const second = runtime.getOrHydrate(toAppSessionId('second'))

    first.setActiveSteerPendingInputId('steer-1')
    first.markPendingQueueDrainStarted()

    expect(first.getActiveSteerPendingInputId()).toBe('steer-1')
    expect(first.isPendingQueueDraining()).toBe(true)
    expect(second.getActiveSteerPendingInputId()).toBeUndefined()
    expect(second.isPendingQueueDraining()).toBe(false)
    expect(first.clearActiveSteerPendingInputId('stale-steer')).toBe(false)
    expect(first.clearActiveSteerPendingInputId('steer-1')).toBe(true)

    first.clearOwnedState()
    expect(first.isPendingQueueDraining()).toBe(false)
  })

  it('does not let a stale drain completion clear a rehydrated instance', () => {
    const runtime = new DeepChatAgentRuntime(() => createDelegate())
    const sessionId = toAppSessionId('session')
    const staleInstance = runtime.getOrHydrate(sessionId)
    staleInstance.markPendingQueueDrainStarted()

    runtime.evict(sessionId)
    const currentInstance = runtime.getOrHydrate(sessionId)
    currentInstance.markPendingQueueDrainStarted()
    staleInstance.markPendingQueueDrainFinished()

    expect(currentInstance.isPendingQueueDraining()).toBe(true)
  })
})
