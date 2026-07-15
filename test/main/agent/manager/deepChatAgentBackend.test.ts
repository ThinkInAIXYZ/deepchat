import { describe, expect, it, vi } from 'vitest'
import type { DeepChatAgentBackendPort } from '@/agent/manager/deepChatAgentBackend'
import { toAppSessionId } from '@/agent/shared/agentSessionIds'
import { createDeepChatAgentBackendFixture } from './deepChatAgentBackendFixture'

const createPort = (): DeepChatAgentBackendPort => ({
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
  waitForFirstTurnReady: vi.fn().mockResolvedValue(true),
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
  linkSubagentTape: vi.fn().mockImplementation(async (input) => ({
    linkEntry: { sessionId: input.parentSessionId, entryId: 1 },
    childSessionId: input.childSessionId,
    childHeadEntryId: 2,
    childEntryCount: 2,
    outcome: input.outcome
  })),
  getActiveGeneration: vi.fn().mockReturnValue({ eventId: 'message', runId: 'run' }),
  cancelGenerationByEventId: vi.fn().mockResolvedValue(true)
})

describe('DeepChatAgentBackend', () => {
  it('routes opens through one lazy instance runtime', () => {
    const backend = createDeepChatAgentBackendFixture(createPort())
    const sessionId = toAppSessionId('session')

    expect(backend.open(sessionId)).toBe(backend.open(sessionId))
    expect(backend.open(toAppSessionId('other'))).not.toBe(backend.open(sessionId))
  })

  it('preserves direct and queued send results', async () => {
    const port = createPort()
    const handle = createDeepChatAgentBackendFixture(port).open(toAppSessionId('session'))

    expect(await handle.send({ content: { text: 'direct', files: [] } })).toEqual({
      requestId: 'request',
      messageId: 'message'
    })
    expect(
      await handle.send({
        content: { text: 'queued', files: [] },
        queue: { source: 'send', projectDir: '/tmp' }
      })
    ).toEqual({ requestId: null, messageId: null })
    expect(port.processMessage).toHaveBeenCalledTimes(1)
    expect(port.queuePendingInput).toHaveBeenCalledWith(
      'session',
      { text: 'queued', files: [] },
      {
        source: 'send',
        projectDir: '/tmp'
      }
    )
  })

  it('uses lightweight snapshots and delegates cancel and close exactly once', async () => {
    const port = createPort()
    const handle = createDeepChatAgentBackendFixture(port).open(toAppSessionId('session'))

    expect((await handle.snapshot({ lightweight: true }))?.status).toBe('generating')
    expect((await handle.snapshot())?.status).toBe('idle')
    await handle.cancel()
    await handle.close()

    expect(handle.kind).toBe('deepchat')
    expect(port.getSessionListState).toHaveBeenCalledWith('session')
    expect(port.getSessionState).toHaveBeenCalledWith('session')
    expect(port.cancelGeneration).toHaveBeenCalledTimes(1)
    expect(port.destroySession).toHaveBeenCalledTimes(1)
  })

  it('exposes required transfer, subagent, and generation facets', async () => {
    const port = createPort()
    const deepchat = createDeepChatAgentBackendFixture(port)
    const parent = toAppSessionId('parent')
    const child = toAppSessionId('child')
    const linkInput = {
      parentSessionId: parent,
      childSessionId: child,
      runId: 'run',
      taskId: 'task',
      slotId: 'reviewer',
      taskTitle: 'Review',
      outcome: 'completed' as const,
      resultSummary: 'Done'
    }

    await deepchat.transferSource.hasMessages(parent)
    await deepchat.transferSource.listPendingInputs(parent)
    await deepchat.transferTarget.setSessionAgentContext(parent, {
      agentId: 'deepchat',
      providerId: 'openai',
      modelId: 'model',
      permissionMode: 'full_access'
    })
    await deepchat.subagent.linkTape(linkInput)
    expect(deepchat.generationControl.getActiveGeneration(parent)).toEqual({
      eventId: 'message',
      runId: 'run'
    })
    await deepchat.generationControl.cancelGenerationByEventId(parent, 'message')

    expect(port.hasMessages).toHaveBeenCalledWith('parent')
    expect(port.listPendingInputs).toHaveBeenCalledWith('parent')
    expect(port.setSessionAgentContext).toHaveBeenCalledWith('parent', {
      agentId: 'deepchat',
      providerId: 'openai',
      modelId: 'model',
      permissionMode: 'full_access'
    })
    expect(port.linkSubagentTape).toHaveBeenCalledWith(linkInput)
    expect(port.getActiveGeneration).toHaveBeenCalledWith('parent')
    expect(port.cancelGenerationByEventId).toHaveBeenCalledWith('parent', 'message')
  })
})
