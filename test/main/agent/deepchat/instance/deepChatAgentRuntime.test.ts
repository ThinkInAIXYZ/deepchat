import { describe, expect, it, vi } from 'vitest'
import { DeepChatAgentRuntime } from '@/agent/deepchat/instance/deepChatAgentRuntime'
import { toAppSessionId } from '@/agent/shared/agentSessionIds'
import type { MCPToolDefinition } from '@shared/types/core/mcp'
import { createLoopRun } from '@/agent/deepchat/loop/loopRun'

const TOOL_DEFINITION: MCPToolDefinition = {
  type: 'function',
  source: 'agent',
  function: {
    name: 'read',
    description: 'Read a file',
    parameters: { type: 'object', properties: {} }
  },
  server: { name: 'agent-filesystem', icons: '', description: '' }
}

const createDelegate = () => ({
  send: vi.fn().mockResolvedValue({ requestId: 'request', messageId: 'message' }),
  cancel: vi.fn().mockResolvedValue(undefined),
  snapshot: vi.fn().mockResolvedValue({ status: 'idle' }),
  close: vi.fn().mockResolvedValue(undefined)
})

function createRun(
  sessionId: string,
  runId: string,
  messageId: string,
  abortController: AbortController
) {
  return createLoopRun({
    runId,
    sessionId: toAppSessionId(sessionId),
    messageId,
    abortController,
    messages: [],
    streamState: {},
    resources: { toolDefinitions: [], activeSkillNames: [] }
  })
}

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

  it('cleans only an already hydrated instance without invoking its shared-state close', async () => {
    const delegate = createDelegate()
    const hydrate = vi.fn(() => delegate)
    const runtime = new DeepChatAgentRuntime(hydrate)
    const sessionId = toAppSessionId('session')

    await runtime.cleanupSession(sessionId)
    expect(hydrate).not.toHaveBeenCalled()

    const instance = runtime.getOrHydrate(sessionId)
    instance.setRuntimeState({
      status: 'idle',
      providerId: 'openai',
      modelId: 'gpt-5',
      permissionMode: 'full_access'
    })
    await runtime.cleanupSession(sessionId)

    expect(delegate.cancel).toHaveBeenCalledOnce()
    expect(delegate.close).not.toHaveBeenCalled()
    expect(instance.getRuntimeState()).toBeUndefined()
    expect(runtime.getHydrated(sessionId)).toBeUndefined()
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

  it('reuses an owned preparation controller for the active generation', () => {
    const runtime = new DeepChatAgentRuntime(() => createDelegate())
    const instance = runtime.getOrHydrate(toAppSessionId('session'))
    const controller = new AbortController()

    instance.setAbortController(controller)
    expect(instance.getAbortSignal()).toBe(controller.signal)

    const run = createRun('session', 'run-1', 'message-1', controller)
    const generation = instance.registerActiveGeneration(run)
    expect(generation).toBe(run)
    expect(controller.signal.aborted).toBe(false)
    expect(instance.getActiveGeneration()).toBe(generation)
    expect(instance.clearActiveGeneration('stale-run')).toBe(false)
    expect(instance.isActiveRun('run-1')).toBe(true)
    expect(instance.clearActiveGeneration('run-1')).toBe(true)
    expect(instance.getActiveGeneration()).toBeUndefined()
    expect(instance.getAbortController()).toBeUndefined()
  })

  it('aborts the previous active generation before replacing it', () => {
    const runtime = new DeepChatAgentRuntime(() => createDelegate())
    const instance = runtime.getOrHydrate(toAppSessionId('session'))
    const firstController = new AbortController()
    const replacementController = new AbortController()
    const replacement = createRun('session', 'run-2', 'message-2', replacementController)

    instance.registerActiveGeneration(createRun('session', 'run-1', 'message-1', firstController))
    instance.registerActiveGeneration(replacement)

    expect(firstController.signal.aborted).toBe(true)
    expect(replacementController.signal.aborted).toBe(false)
    expect(instance.getActiveGeneration()).toBe(replacement)
    expect(instance.getAbortController()).toBe(replacementController)
  })

  it('aborts an owned preparation controller when a different active run replaces it', () => {
    const runtime = new DeepChatAgentRuntime(() => createDelegate())
    const instance = runtime.getOrHydrate(toAppSessionId('session'))
    const preparationController = new AbortController()
    const activeController = new AbortController()
    const run = createRun('session', 'run-1', 'message-1', activeController)

    instance.setAbortController(preparationController)
    instance.registerActiveGeneration(run)

    expect(preparationController.signal.aborted).toBe(true)
    expect(activeController.signal.aborted).toBe(false)
    expect(instance.getActiveGeneration()).toBe(run)
    expect(instance.getAbortController()).toBe(activeController)
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

    first.registerActiveGeneration(createRun('first', 'run-1', 'message-1', activeController))
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

  it('owns ordered interactions and per-session response guards', () => {
    const runtime = new DeepChatAgentRuntime(() => createDelegate())
    const first = runtime.getOrHydrate(toAppSessionId('first'))
    const second = runtime.getOrHydrate(toAppSessionId('second'))

    first.replacePendingToolBatch(
      [
        {
          messageId: 'message',
          toolCallId: 'tool-1',
          origin: 'pre-check-permission',
          order: 0
        },
        {
          messageId: 'message',
          toolCallId: 'tool-2',
          origin: 'pre-check-permission',
          order: 1
        }
      ],
      {
        callOrder: ['tool-1', 'tool-2'],
        invokedCallIds: [],
        committedResultCallIds: [],
        pendingInteractionCallIds: ['tool-1', 'tool-2']
      }
    )

    expect(first.getFirstPendingInteraction()).toEqual({
      messageId: 'message',
      toolCallId: 'tool-1',
      origin: 'pre-check-permission',
      order: 0
    })
    expect(first.hasPendingInteractions()).toBe(true)
    expect(first.getPendingToolBatchState()).toEqual({
      callOrder: ['tool-1', 'tool-2'],
      invokedCallIds: [],
      committedResultCallIds: [],
      pendingInteractionCallIds: ['tool-1', 'tool-2']
    })
    expect(
      first.transitionPendingInteractionOrigin('message', 'tool-1', 'post-call-permission')
    ).toBe(true)
    expect(first.getFirstPendingInteraction()?.origin).toBe('post-call-permission')
    expect(second.hasPendingInteractions()).toBe(false)
    expect(first.tryLockInteraction('message', 'tool-1')).toBe(true)
    expect(first.tryLockInteraction('message', 'tool-1')).toBe(false)
    expect(second.tryLockInteraction('message', 'tool-1')).toBe(true)
    expect(first.tryBeginResume('message')).toBe(true)
    expect(first.tryBeginResume('message')).toBe(false)

    first.unlockInteraction('message', 'tool-1')
    first.finishResume('message')
    expect(first.tryLockInteraction('message', 'tool-1')).toBe(true)
    expect(first.tryBeginResume('message')).toBe(true)

    first.replacePendingInteractions([
      { messageId: 'message', toolCallId: 'acp-tool', origin: 'acp-permission', order: 0 }
    ])
    expect(first.hasPendingInteractions()).toBe(true)
    expect(first.getPendingToolBatchState()).toBeUndefined()
  })

  it('owns deferred tool cancellation and live provider permissions', () => {
    const runtime = new DeepChatAgentRuntime(() => createDelegate())
    const first = runtime.getOrHydrate(toAppSessionId('first'))
    const second = runtime.getOrHydrate(toAppSessionId('second'))
    const staleController = first.registerDeferredToolAbortController('tool')
    const currentController = first.registerDeferredToolAbortController('tool')
    const resolve = vi.fn().mockResolvedValue(undefined)

    first.registerActiveProviderPermission({
      requestId: 'request',
      messageId: 'message',
      toolCallId: 'tool',
      providerId: 'acp',
      permissionType: 'command',
      resolve
    })

    expect(staleController.signal.aborted).toBe(true)
    expect(currentController.signal.aborted).toBe(false)
    expect(first.clearDeferredToolAbortController('tool', staleController)).toBe(false)
    expect(first.hasDeferredToolAbortController('tool')).toBe(true)
    expect(first.hasActiveProviderPermission('request')).toBe(true)
    expect(second.hasActiveProviderPermission('request')).toBe(false)
    expect(first.takeActiveProviderPermissions()).toEqual([
      expect.objectContaining({ requestId: 'request', resolve })
    ])

    first.abortDeferredToolCalls()
    expect(currentController.signal.aborted).toBe(true)
    expect(first.hasDeferredToolAbortController('tool')).toBe(false)
    expect(first.hasActiveProviderPermission('request')).toBe(false)
  })

  it('owns isolated runtime skill selections and tool caches', () => {
    const runtime = new DeepChatAgentRuntime(() => createDelegate())
    const first = runtime.getOrHydrate(toAppSessionId('first'))
    const second = runtime.getOrHydrate(toAppSessionId('second'))

    first.replaceRuntimeActivatedSkills(['skill-b', 'skill-a', 'skill-a', ' '])
    first.setToolProfileCache({
      profile: 'code',
      fingerprint: 'tools-v1',
      tools: [TOOL_DEFINITION]
    })

    expect(first.getRuntimeActivatedSkills()).toEqual(['skill-a', 'skill-b'])
    expect(first.getToolProfileCache()?.tools).toEqual([TOOL_DEFINITION])
    expect(second.getRuntimeActivatedSkills()).toEqual([])
    expect(second.getToolProfileCache()).toBeUndefined()

    expect(first.activateRuntimeSkill('skill-c')).toEqual(['skill-a', 'skill-b', 'skill-c'])
    expect(first.getToolProfileCache()).toBeUndefined()
  })

  it('owns isolated compaction projections and stable legacy memory handles', () => {
    const runtime = new DeepChatAgentRuntime(() => createDelegate())
    const sessionId = toAppSessionId('first')
    const first = runtime.getOrHydrate(sessionId)
    const second = runtime.getOrHydrate(toAppSessionId('second'))

    first.setCompactionState({
      status: 'compacting',
      cursorOrderSeq: 5,
      summaryUpdatedAt: 123
    })
    const firstSnapshot = first.getCompactionState()
    if (firstSnapshot) firstSnapshot.status = 'idle'

    expect(first.getCompactionState()).toEqual({
      status: 'compacting',
      cursorOrderSeq: 5,
      summaryUpdatedAt: 123
    })
    expect(second.getCompactionState()).toBeUndefined()
    expect(first.getMemorySessionHandle()).toBe(first.getMemorySessionHandle())
    expect(second.getMemorySessionHandle()).not.toBe(first.getMemorySessionHandle())

    runtime.evict(sessionId)
    const replacement = runtime.getOrHydrate(sessionId)
    expect(replacement.getMemorySessionHandle()).not.toBe(first.getMemorySessionHandle())
    expect(replacement.getMemorySessionHandle().sessionId).toBe(sessionId)

    first.clearOwnedState()
    expect(first.getCompactionState()).toBeUndefined()
  })

  it('invalidates tool revisions and clears only the owning instance lifecycle', () => {
    const runtime = new DeepChatAgentRuntime(() => createDelegate())
    const sessionId = toAppSessionId('session')
    const staleInstance = runtime.getOrHydrate(sessionId)
    const other = runtime.getOrHydrate(toAppSessionId('other'))

    for (const instance of [staleInstance, other]) {
      instance.setToolProfileCache({
        profile: 'code',
        fingerprint: 'tools-v1',
        tools: [TOOL_DEFINITION]
      })
    }

    runtime.markToolRegistryChanged()

    expect(runtime.getToolRegistryRevision()).toBe(1)
    expect(staleInstance.getToolProfileCache()).toBeUndefined()
    expect(other.getToolProfileCache()).toBeUndefined()

    runtime.evict(sessionId)
    const currentInstance = runtime.getOrHydrate(sessionId)
    currentInstance.replaceRuntimeActivatedSkills(['current-skill'])
    staleInstance.clearOwnedState()

    expect(currentInstance.getRuntimeActivatedSkills()).toEqual(['current-skill'])
    expect(staleInstance.getRuntimeActivatedSkills()).toEqual([])
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
