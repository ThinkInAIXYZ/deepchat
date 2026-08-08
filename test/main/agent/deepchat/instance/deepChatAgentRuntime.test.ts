import { describe, expect, it, vi } from 'vitest'
import {
  DeepChatAgentRuntime,
  isStaleDeepChatInstanceError
} from '@/agent/deepchat/instance/deepChatAgentRuntime'
import { toAppSessionId } from '@/agent/shared/agentSessionIds'
import { TOOL_EXECUTION, type MCPToolDefinition } from '@shared/types/core/mcp'
import { createLoopRun } from '@/agent/deepchat/loop/loopRun'
import { POSIX_COMMAND_SHELL } from '../../../../helpers/commandShell'

const TOOL_DEFINITION: MCPToolDefinition = {
  execution: TOOL_EXECUTION.read.parallel,
  type: 'function',
  source: 'agent',
  function: {
    name: 'read',
    description: 'Read a file',
    parameters: { type: 'object', properties: {} }
  },
  server: { name: 'agent-filesystem', icons: '', description: '' }
}

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
    resources: { toolDefinitions: [], activeSkillNames: [], commandShell: POSIX_COMMAND_SHELL }
  })
}

describe('DeepChatAgentRuntime', () => {
  it('hydrates one stable instance per app session', () => {
    const runtime = new DeepChatAgentRuntime()
    const sessionId = toAppSessionId('session')

    const first = runtime.getOrHydrate(sessionId)
    const second = runtime.getOrHydrate(sessionId)
    const other = runtime.getOrHydrate(toAppSessionId('other'))

    expect(first).toBe(second)
    expect(other).not.toBe(first)
    expect(first.sessionId).toBe(sessionId)
    expect(other.sessionId).toBe(toAppSessionId('other'))
  })

  it('creates a minimal current scope over the registered instance state', () => {
    const runtime = new DeepChatAgentRuntime()
    const sessionId = toAppSessionId('session')

    expect(runtime.getHydratedScope(sessionId)).toBeUndefined()

    const scope = runtime.getOrHydrateScope(sessionId)
    scope.instance.setRuntimeState({
      status: 'idle',
      providerId: 'openai',
      modelId: 'gpt-5',
      permissionMode: 'full_access'
    })

    expect(Object.isFrozen(scope)).toBe(false)
    expect(scope.sessionId).toBe(sessionId)
    expect(scope.instance).toBe(runtime.getHydrated(sessionId))
    expect(scope.state()).toBe(scope.instance.getRuntimeState())
    expect(scope.isCurrent()).toBe(true)
    expect(() => scope.assertCurrent()).not.toThrow()
    expect(runtime.getHydratedScope(sessionId)).toBe(scope)
    expect(runtime.scopeFor(sessionId, scope.instance)).toBe(scope)
  })

  it('fences evicted and mismatched scopes with the stable stale-instance identity', () => {
    const runtime = new DeepChatAgentRuntime()
    const sessionId = toAppSessionId('session')
    const otherSessionId = toAppSessionId('other')
    const instance = runtime.getOrHydrate(sessionId)
    const currentScope = runtime.scopeFor(sessionId, instance)
    const mismatchedScope = runtime.scopeFor(otherSessionId, instance)

    expect(mismatchedScope.isCurrent()).toBe(false)
    expect(() => mismatchedScope.assertCurrent()).toThrowError(
      expect.objectContaining({ name: 'StaleDeepChatAgentInstanceError' })
    )

    runtime.evict(sessionId)
    const replacementScope = runtime.getOrHydrateScope(sessionId)

    expect(currentScope.isCurrent()).toBe(false)
    expect(replacementScope.isCurrent()).toBe(true)
    try {
      currentScope.assertCurrent()
      expect.unreachable('stale scope should throw')
    } catch (error) {
      expect(isStaleDeepChatInstanceError(error)).toBe(true)
    }
  })

  it('exposes runtime state only, with no orchestration surface on the instance', () => {
    const runtime = new DeepChatAgentRuntime()
    const instance = runtime.getOrHydrate(toAppSessionId('session'))

    for (const orchestration of ['send', 'cancel', 'snapshot', 'close']) {
      expect(instance).not.toHaveProperty(orchestration)
    }
  })

  it('replaces an evicted instance on the next hydration', () => {
    const runtime = new DeepChatAgentRuntime()
    const sessionId = toAppSessionId('session')
    const instance = runtime.getOrHydrate(sessionId)

    expect(runtime.evict(sessionId)).toBe(true)
    expect(runtime.evict(sessionId)).toBe(false)
    expect(runtime.getOrHydrate(sessionId)).not.toBe(instance)
  })

  it('reads only already hydrated instances without creating a shell', () => {
    const runtime = new DeepChatAgentRuntime()
    const sessionId = toAppSessionId('session')

    expect(runtime.getHydrated(sessionId)).toBeUndefined()
    const instance = runtime.getOrHydrate(sessionId)
    expect(runtime.getHydrated(sessionId)).toBe(instance)
    runtime.evict(sessionId)
    expect(runtime.getHydrated(sessionId)).toBeUndefined()
  })

  it('isolates identity, settings, status, project and readiness by session', async () => {
    const runtime = new DeepChatAgentRuntime()
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
    const runtime = new DeepChatAgentRuntime()
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
    const runtime = new DeepChatAgentRuntime()
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
    const runtime = new DeepChatAgentRuntime()
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
    const runtime = new DeepChatAgentRuntime()
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
    const runtime = new DeepChatAgentRuntime()
    const first = runtime.getOrHydrate(toAppSessionId('first'))
    const second = runtime.getOrHydrate(toAppSessionId('second'))

    first.setActiveSteerPendingInputId('steer-1')
    const drainLease = first.tryAcquirePendingQueueDrain()

    expect(first.getActiveSteerPendingInputId()).toBe('steer-1')
    expect(drainLease).not.toBeNull()
    expect(first.tryAcquirePendingQueueDrain()).toBeNull()
    expect(first.isPendingQueueDraining()).toBe(true)
    expect(second.getActiveSteerPendingInputId()).toBeUndefined()
    expect(second.isPendingQueueDraining()).toBe(false)
    expect(first.clearActiveSteerPendingInputId('stale-steer')).toBe(false)
    expect(first.clearActiveSteerPendingInputId('steer-1')).toBe(true)
    expect(first.releasePendingQueueDrain(Symbol('not-owner'))).toBe(false)
    expect(first.isPendingQueueDraining()).toBe(true)

    first.clearOwnedState()
    expect(first.isPendingQueueDraining()).toBe(false)
  })

  it('owns ordered interactions and per-session response guards', () => {
    const runtime = new DeepChatAgentRuntime()
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
    const runtime = new DeepChatAgentRuntime()
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
    const runtime = new DeepChatAgentRuntime()
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
    const runtime = new DeepChatAgentRuntime()
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
    const runtime = new DeepChatAgentRuntime()
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
    const runtime = new DeepChatAgentRuntime()
    const sessionId = toAppSessionId('session')
    const staleInstance = runtime.getOrHydrate(sessionId)
    const staleLease = staleInstance.tryAcquirePendingQueueDrain()
    if (!staleLease) throw new Error('Expected stale instance to acquire the drain')

    runtime.evict(sessionId)
    const currentInstance = runtime.getOrHydrate(sessionId)
    const currentLease = currentInstance.tryAcquirePendingQueueDrain()
    if (!currentLease) throw new Error('Expected current instance to acquire the drain')
    staleInstance.releasePendingQueueDrain(staleLease)

    expect(currentInstance.isPendingQueueDraining()).toBe(true)
    expect(currentInstance.releasePendingQueueDrain(currentLease)).toBe(true)
  })
})
