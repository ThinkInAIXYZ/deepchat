import { describe, expect, it, vi } from 'vitest'
import { createLegacyAgentBackend } from '@/agent/manager/legacyAgentBackends'
import { toAppSessionId } from '@/agent/shared/agentSessionIds'
import type { IAgentImplementation } from '@shared/types/agent-interface'

const createImplementation = () =>
  ({
    initSession: vi.fn().mockResolvedValue(undefined),
    processMessage: vi.fn().mockResolvedValue({ requestId: 'request', messageId: 'message' }),
    queuePendingInput: vi.fn().mockResolvedValue({}),
    cancelGeneration: vi.fn().mockResolvedValue(undefined),
    destroySession: vi.fn().mockResolvedValue(undefined),
    getSessionState: vi
      .fn()
      .mockResolvedValue({ status: 'idle', providerId: 'openai', modelId: 'model' }),
    getSessionListState: vi
      .fn()
      .mockResolvedValue({ status: 'generating', providerId: 'openai', modelId: 'model' }),
    hasMessages: vi.fn().mockResolvedValue(true),
    listPendingInputs: vi.fn().mockResolvedValue([]),
    steerActiveTurn: vi.fn().mockResolvedValue(undefined),
    updateQueuedInput: vi.fn().mockResolvedValue({}),
    moveQueuedInput: vi.fn().mockResolvedValue([]),
    convertPendingInputToSteer: vi.fn().mockResolvedValue({}),
    steerPendingInput: vi.fn().mockResolvedValue({}),
    deletePendingInput: vi.fn().mockResolvedValue(undefined),
    getPermissionMode: vi.fn().mockResolvedValue('full_access'),
    setPermissionMode: vi.fn().mockResolvedValue(undefined),
    getGenerationSettings: vi.fn().mockResolvedValue(null),
    updateGenerationSettings: vi.fn().mockResolvedValue({}),
    setSessionProjectDir: vi.fn().mockResolvedValue(undefined),
    respondToolInteraction: vi.fn().mockResolvedValue({ resumed: false }),
    setSessionAgentContext: vi.fn().mockResolvedValue(undefined),
    setSessionModel: vi.fn().mockResolvedValue(undefined),
    getSessionCompactionState: vi.fn().mockResolvedValue({}),
    compactSession: vi.fn().mockResolvedValue({ compacted: false, state: {} }),
    invalidateSessionSystemPromptCache: vi.fn(),
    mergeSubagentTape: vi.fn().mockResolvedValue(undefined),
    discardSubagentTape: vi.fn().mockResolvedValue(undefined),
    getActiveGeneration: vi.fn().mockReturnValue({ eventId: 'message', runId: 'run' }),
    cancelGenerationByEventId: vi.fn().mockResolvedValue(true)
  }) as unknown as IAgentImplementation

describe('legacy agent backends', () => {
  it('routes DeepChat opens through the lazy instance runtime', () => {
    const backend = createLegacyAgentBackend('deepchat', createImplementation())
    const sessionId = toAppSessionId('session')

    expect(backend.open(sessionId)).toBe(backend.open(sessionId))
    expect(backend.open(toAppSessionId('other'))).not.toBe(backend.open(sessionId))
  })

  it('reuses an explicitly owned DeepChat runtime', () => {
    const implementation = createImplementation()
    const owner = createLegacyAgentBackend('deepchat', implementation)
    const backend = createLegacyAgentBackend('deepchat', implementation, owner.runtime)
    const sessionId = toAppSessionId('session')

    expect(backend.runtime).toBe(owner.runtime)
    expect(backend.open(sessionId)).toBe(owner.open(sessionId))
  })

  it('preserves direct and queued send results', async () => {
    const implementation = createImplementation()
    const handle = createLegacyAgentBackend('deepchat', implementation).open(
      toAppSessionId('session')
    )

    expect(await handle.send({ content: 'direct' })).toEqual({
      requestId: 'request',
      messageId: 'message'
    })
    expect(
      await handle.send({ content: 'queued', queue: { source: 'send', projectDir: '/tmp' } })
    ).toEqual({ requestId: null, messageId: null })
    expect(implementation.processMessage).toHaveBeenCalledTimes(1)
    expect(implementation.queuePendingInput).toHaveBeenCalledWith('session', 'queued', {
      source: 'send',
      projectDir: '/tmp'
    })
  })

  it('uses lightweight snapshots and delegates cancel and close exactly once', async () => {
    const implementation = createImplementation()
    const handle = createLegacyAgentBackend('acp', implementation).open(toAppSessionId('session'))

    expect((await handle.snapshot({ lightweight: true }))?.status).toBe('generating')
    expect((await handle.snapshot())?.status).toBe('idle')
    await handle.cancel()
    await handle.close()

    expect(handle.kind).toBe('acp')
    expect(implementation.getSessionListState).toHaveBeenCalledWith('session')
    expect(implementation.getSessionState).toHaveBeenCalledWith('session')
    expect(implementation.cancelGeneration).toHaveBeenCalledTimes(1)
    expect(implementation.destroySession).toHaveBeenCalledTimes(1)
  })

  it('exposes required transfer and kind-specific subagent facets', async () => {
    const implementation = createImplementation()
    const deepchat = createLegacyAgentBackend('deepchat', implementation)
    const acp = createLegacyAgentBackend('acp', implementation)
    const parent = toAppSessionId('parent')
    const child = toAppSessionId('child')

    await deepchat.transferSource.hasMessages(parent)
    await deepchat.transferSource.listPendingInputs(parent)
    await deepchat.transferTarget.setSessionAgentContext(parent, {
      providerId: 'openai',
      modelId: 'model'
    })
    await deepchat.subagent.mergeTape(parent, child, { outcome: 'merged' })
    await acp.subagent.discardTape(parent, child, { outcome: 'discarded' })
    expect(deepchat.generationControl.getActiveGeneration(parent)).toEqual({
      eventId: 'message',
      runId: 'run'
    })
    await acp.generationControl.cancelGenerationByEventId(parent, 'message')

    expect(implementation.hasMessages).toHaveBeenCalledWith('parent')
    expect(implementation.listPendingInputs).toHaveBeenCalledWith('parent')
    expect(implementation.setSessionAgentContext).toHaveBeenCalledWith('parent', {
      providerId: 'openai',
      modelId: 'model'
    })
    expect(implementation.mergeSubagentTape).toHaveBeenCalledWith('parent', 'child', {
      outcome: 'merged'
    })
    expect(implementation.discardSubagentTape).toHaveBeenCalledWith('parent', 'child', {
      outcome: 'discarded'
    })
    expect(implementation.getActiveGeneration).toHaveBeenCalledWith('parent')
    expect(implementation.cancelGenerationByEventId).toHaveBeenCalledWith('parent', 'message')
    expect('transferTarget' in acp).toBe(false)
  })

  it('fails fast when a required facet method is missing', () => {
    const implementation = createImplementation()
    implementation.mergeSubagentTape = undefined

    expect(() => createLegacyAgentBackend('acp', implementation)).toThrow(
      'Legacy agent implementation is missing required method: mergeSubagentTape'
    )
  })

  it('fails fast when remote generation control is missing', () => {
    const implementation = createImplementation()
    ;(implementation as any).cancelGenerationByEventId = undefined

    expect(() => createLegacyAgentBackend('deepchat', implementation)).toThrow(
      'Legacy agent implementation is missing required method: cancelGenerationByEventId'
    )
  })

  it('falls back to the full snapshot when no lightweight reader exists', async () => {
    const implementation = createImplementation()
    implementation.getSessionListState = undefined
    const handle = createLegacyAgentBackend('deepchat', implementation).open(
      toAppSessionId('session')
    )

    await handle.snapshot({ lightweight: true })

    expect(implementation.getSessionState).toHaveBeenCalledWith('session')
  })
})
