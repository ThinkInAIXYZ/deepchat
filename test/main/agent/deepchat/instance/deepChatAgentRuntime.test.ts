import { describe, expect, it, vi } from 'vitest'
import {
  DeepChatAgentRuntime,
  isStaleDeepChatInstanceError
} from '@/agent/deepchat/instance/deepChatAgentRuntime'
import { toAppSessionId } from '@/agent/shared/agentSessionIds'
import { TOOL_EXECUTION, type MCPToolDefinition } from '@shared/types/core/mcp'
import { createLoopRun } from '@/agent/deepchat/loop/loopRun'
import { POSIX_COMMAND_SHELL } from '../../../../helpers/commandShell'
import { useHarnessControl } from '../helpers/control'

const control = useHarnessControl()

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
    resources: {
      toolDefinitions: [],
      activeSkillNames: [],
      commandShell: POSIX_COMMAND_SHELL,
      toolMode: { mode: 'agent', source: 'fallback' }
    }
  })
}

describe('DeepChatAgentRuntime', () => {
  it('aborts hydrated generations and deferred work without evicting or hydrating sessions', async () => {
    const runtime = new DeepChatAgentRuntime(control())
    const sessionId = toAppSessionId('running')
    const instance = runtime.getOrHydrate(sessionId)
    await instance.controlReady()
    const controller = await instance.ensureOperationController()
    const run = createRun(sessionId, 'run', 'message', controller)
    await instance.registerActiveGeneration(run)
    await instance.replacePendingInteractions(
      [{ messageId: 'message', toolCallId: 'tool', origin: 'pre-check-permission', order: 0 }],
      { kind: 'run', id: run.runId }
    )
    const lease = await instance.acquireInteraction('message', 'tool')
    if (!lease || lease === 'parked') throw new Error('Expected interaction lease')
    const deferred = await instance.registerDeferredToolAbortController('message', 'tool', lease, {
      kind: 'run',
      id: run.runId
    })
    runtime.abortGenerations()
    expect(controller.signal.aborted).toBe(true)
    expect(deferred.signal.aborted).toBe(true)
    expect(runtime.getHydrated(sessionId)).toBe(instance)
    expect(instance.getActiveGeneration()).toBe(run)
    expect(runtime.getHydrated(toAppSessionId('missing'))).toBeUndefined()
  })

  it('hydrates one stable instance per app session', async () => {
    const runtime = new DeepChatAgentRuntime(control())
    const sessionId = toAppSessionId('session')

    const first = runtime.getOrHydrate(sessionId)
    await first.controlReady()
    const second = runtime.getOrHydrate(sessionId)
    await second.controlReady()
    const other = runtime.getOrHydrate(toAppSessionId('other'))
    await other.controlReady()

    expect(first).toBe(second)
    expect(other).not.toBe(first)
    expect(first.sessionId).toBe(sessionId)
    expect(other.sessionId).toBe(toAppSessionId('other'))
  })

  it('creates a minimal current scope over the registered instance state', async () => {
    const runtime = new DeepChatAgentRuntime(control())
    const sessionId = toAppSessionId('session')

    expect(runtime.getHydratedScope(sessionId)).toBeUndefined()

    const scope = runtime.getOrHydrateScope(sessionId)
    await scope.instance.controlReady()
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

  it('fences evicted and mismatched scopes with the stable stale-instance identity', async () => {
    const runtime = new DeepChatAgentRuntime(control())
    const sessionId = toAppSessionId('session')
    const otherSessionId = toAppSessionId('other')
    const instance = runtime.getOrHydrate(sessionId)
    await instance.controlReady()
    const currentScope = runtime.scopeFor(sessionId, instance)
    const mismatchedScope = runtime.scopeFor(otherSessionId, instance)

    expect(mismatchedScope.isCurrent()).toBe(false)
    expect(() => mismatchedScope.assertCurrent()).toThrowError(
      expect.objectContaining({ name: 'StaleDeepChatAgentInstanceError' })
    )

    runtime.evict(sessionId)
    const replacementScope = runtime.getOrHydrateScope(sessionId)
    await replacementScope.instance.controlReady()

    expect(currentScope.isCurrent()).toBe(false)
    expect(replacementScope.isCurrent()).toBe(true)
    try {
      currentScope.assertCurrent()
      expect.unreachable('stale scope should throw')
    } catch (error) {
      expect(isStaleDeepChatInstanceError(error)).toBe(true)
    }
  })

  it('exposes runtime state only, with no orchestration surface on the instance', async () => {
    const runtime = new DeepChatAgentRuntime(control())
    const instance = runtime.getOrHydrate(toAppSessionId('session'))
    await instance.controlReady()

    for (const orchestration of ['send', 'cancel', 'snapshot', 'close']) {
      expect(instance).not.toHaveProperty(orchestration)
    }
  })

  it('replaces an evicted instance on the next hydration', async () => {
    const runtime = new DeepChatAgentRuntime(control())
    const sessionId = toAppSessionId('session')
    const instance = runtime.getOrHydrate(sessionId)
    await instance.controlReady()

    expect(runtime.evict(sessionId)).toBe(true)
    expect(runtime.evict(sessionId)).toBe(false)
    expect(runtime.getOrHydrate(sessionId)).not.toBe(instance)
  })

  it('reads only already hydrated instances without creating a shell', async () => {
    const runtime = new DeepChatAgentRuntime(control())
    const sessionId = toAppSessionId('session')

    expect(runtime.getHydrated(sessionId)).toBeUndefined()
    const instance = runtime.getOrHydrate(sessionId)
    await instance.controlReady()
    expect(runtime.getHydrated(sessionId)).toBe(instance)
    runtime.evict(sessionId)
    expect(runtime.getHydrated(sessionId)).toBeUndefined()
  })

  it('isolates identity, settings, status, project and readiness by session', async () => {
    const runtime = new DeepChatAgentRuntime(control())
    const first = runtime.getOrHydrate(toAppSessionId('first'))
    await first.controlReady()
    const second = runtime.getOrHydrate(toAppSessionId('second'))
    await second.controlReady()

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

    await first.transitionControlStatus({ kind: 'orphan' }, 'generating')
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
    const controller = await first.ensureOperationController()
    await first.registerActiveGeneration(createRun('first', 'ready-run', 'message', controller))
    await first.markFirstTurnReady('ready-run')
    await expect(first.waitForFirstTurnReady()).resolves.toBe(true)
  })

  it('keeps provider context observations runtime-local and model-scoped', async () => {
    const runtime = new DeepChatAgentRuntime(control())
    const sessionId = toAppSessionId('session')
    const instance = runtime.getOrHydrate(sessionId)
    await instance.controlReady()

    instance.recordContextWindowObservation({
      providerId: 'new-api',
      modelId: 'custom-model',
      confidence: 'explicit',
      limitTokens: 131072,
      limitScope: 'prompt'
    })
    instance.recordContextWindowObservation({
      providerId: 'new-api',
      modelId: 'custom-model',
      confidence: 'qualitative'
    })
    instance.recordContextWindowObservation({
      providerId: 'new-api',
      modelId: 'custom-model',
      confidence: 'explicit',
      limitTokens: 262144,
      limitScope: 'context'
    })
    instance.recordContextWindowObservation({
      providerId: 'openai',
      modelId: 'other-model',
      confidence: 'explicit',
      limitTokens: 8192,
      limitScope: 'context'
    })
    instance.recordContextWindowObservation({
      providerId: 'new-api',
      modelId: 'field-scoped-model',
      confidence: 'explicit',
      limitTokens: 4096
    })

    expect(instance.getContextWindowObservation('new-api', 'custom-model')).toEqual({
      providerId: 'new-api',
      modelId: 'custom-model',
      providerContextLimitTokens: 262144,
      providerPromptLimitTokens: 131072,
      metadataSuspect: true
    })
    expect(instance.getContextWindowObservation('openai', 'other-model')).toEqual({
      providerId: 'openai',
      modelId: 'other-model',
      providerContextLimitTokens: 8192,
      metadataSuspect: false
    })
    expect(instance.getContextWindowObservation('new-api', 'field-scoped-model')).toEqual({
      providerId: 'new-api',
      modelId: 'field-scoped-model',
      metadataSuspect: true
    })
    instance.clearContextWindowObservation('new-api', 'custom-model')
    expect(instance.getContextWindowObservation('new-api', 'custom-model')).toBeUndefined()
    instance.clearOwnedState()
    expect(instance.getContextWindowObservation('openai', 'other-model')).toBeUndefined()
  })

  it('aborts pre-stream work immediately but retains an active run until settlement', async () => {
    const runtime = new DeepChatAgentRuntime(control())
    const first = runtime.getOrHydrate(toAppSessionId('first'))
    await first.controlReady()
    const second = runtime.getOrHydrate(toAppSessionId('second'))
    await second.controlReady()
    const preStreamController = await first.ensureOperationController()
    const activeController = new AbortController()

    first.requestGenerationAbort()
    expect(preStreamController.signal.aborted).toBe(true)
    await vi.waitFor(() => expect(first.getAbortController()).toBeUndefined())

    await first.registerActiveGeneration(createRun('first', 'run-1', 'message-1', activeController))
    first.requestGenerationAbort()
    expect(activeController.signal.aborted).toBe(true)
    expect(first.getActiveGeneration()?.runId).toBe('run-1')
    expect(second.getAbortSignal()).toBeUndefined()

    first.abortAndClearGeneration()
    await vi.waitFor(() => expect(first.getActiveGeneration()).toBeUndefined())
    expect(first.getAbortController()).toBeUndefined()
  })

  it('owns isolated runtime skill selections and tool caches', async () => {
    const runtime = new DeepChatAgentRuntime(control())
    const first = runtime.getOrHydrate(toAppSessionId('first'))
    await first.controlReady()
    const second = runtime.getOrHydrate(toAppSessionId('second'))
    await second.controlReady()

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

  it('owns isolated compaction projections and stable legacy memory handles', async () => {
    const runtime = new DeepChatAgentRuntime(control())
    const sessionId = toAppSessionId('first')
    const first = runtime.getOrHydrate(sessionId)
    await first.controlReady()
    const second = runtime.getOrHydrate(toAppSessionId('second'))
    await second.controlReady()

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
    await replacement.controlReady()
    expect(replacement.getMemorySessionHandle()).not.toBe(first.getMemorySessionHandle())
    expect(replacement.getMemorySessionHandle().sessionId).toBe(sessionId)

    first.clearOwnedState()
    expect(first.getCompactionState()).toBeUndefined()
  })

  it('invalidates tool revisions and clears only the owning instance lifecycle', async () => {
    const runtime = new DeepChatAgentRuntime(control())
    const sessionId = toAppSessionId('session')
    const staleInstance = runtime.getOrHydrate(sessionId)
    await staleInstance.controlReady()
    const other = runtime.getOrHydrate(toAppSessionId('other'))
    await other.controlReady()

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
    await currentInstance.controlReady()
    currentInstance.replaceRuntimeActivatedSkills(['current-skill'])
    staleInstance.clearOwnedState()

    expect(currentInstance.getRuntimeActivatedSkills()).toEqual(['current-skill'])
    expect(staleInstance.getRuntimeActivatedSkills()).toEqual([])
  })
})
