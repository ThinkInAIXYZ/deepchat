import { describe, expect, it, vi } from 'vitest'
import { createDirectAcpAgentBackend } from '@/agent/manager/directAcpAgentBackend'
import { AgentManager } from '@/agent/manager/agentManager'
import { toAppSessionId } from '@/agent/shared/agentSessionIds'
import type { AcpAgentDescriptor } from '@/agent/shared/agentDescriptors'

const descriptor: AcpAgentDescriptor = {
  id: 'agent',
  kind: 'acp',
  source: 'manual',
  name: 'Agent',
  enabled: true,
  protected: false,
  description: null,
  icon: null,
  avatar: null,
  launch: { command: 'agent', args: [], env: {} }
}

const sessionId = toAppSessionId('session')

function createHarness() {
  const instance = {
    snapshot: vi.fn().mockResolvedValue({ status: 'idle' }),
    waitForFirstTurnReady: vi.fn().mockResolvedValue(true),
    getWorkdir: vi.fn().mockReturnValue('/workspace'),
    getModes: vi.fn().mockReturnValue({ current: 'code', available: [] }),
    setMode: vi.fn().mockResolvedValue(undefined),
    getConfigOptions: vi.fn().mockReturnValue(null),
    setConfigOption: vi.fn().mockResolvedValue(null),
    getCommands: vi.fn().mockReturnValue([]),
    resolvePermissionRequest: vi.fn().mockReturnValue(true),
    getActiveGeneration: vi.fn().mockReturnValue({ eventId: 'message', runId: 'request' }),
    cancelGenerationByEventId: vi.fn().mockResolvedValue(true)
  }
  const runtime = {
    getOrHydrate: vi.fn().mockResolvedValue(instance),
    getHydrated: vi.fn().mockReturnValue(instance),
    send: vi.fn().mockResolvedValue({ requestId: 'request', messageId: 'message' }),
    prepare: vi.fn().mockResolvedValue(instance),
    cancel: vi.fn().mockResolvedValue(undefined),
    close: vi.fn().mockResolvedValue(undefined),
    cleanupSession: vi.fn().mockResolvedValue(undefined),
    listPendingInputs: vi.fn().mockReturnValue([]),
    resumePendingInputs: vi.fn().mockResolvedValue(true),
    queuePendingInput: vi.fn().mockResolvedValue({ id: 'pending' }),
    steer: vi.fn().mockResolvedValue({ id: 'steer' }),
    updateQueuedInput: vi.fn().mockReturnValue({ id: 'pending' }),
    moveQueuedInput: vi.fn().mockReturnValue([]),
    steerPendingInput: vi.fn().mockResolvedValue({ id: 'pending' }),
    deletePendingInput: vi.fn()
  }
  const sessionState = {
    initSession: vi.fn().mockResolvedValue(undefined),
    destroySession: vi.fn().mockResolvedValue(undefined),
    getSessionState: vi.fn().mockResolvedValue({ status: 'idle' }),
    getSessionListState: vi.fn().mockResolvedValue({
      status: 'idle',
      providerId: 'openai',
      modelId: 'stale-model',
      permissionMode: 'full_access'
    }),
    getPermissionMode: vi.fn().mockResolvedValue('full_access'),
    setPermissionMode: vi.fn().mockResolvedValue(undefined),
    getGenerationSettings: vi.fn().mockResolvedValue(null),
    updateGenerationSettings: vi.fn().mockResolvedValue({}),
    setSessionProjectDir: vi.fn().mockResolvedValue(undefined)
  }
  const transcript = {
    hasMessages: vi.fn().mockResolvedValue(true),
    getMessage: vi.fn().mockResolvedValue({
      id: 'assistant',
      sessionId,
      role: 'assistant',
      content: JSON.stringify([
        {
          type: 'action',
          action_type: 'tool_call_permission',
          tool_call: { id: 'tool-call' },
          extra: { permissionRequestId: 'permission-request' }
        }
      ])
    }),
    updateAssistantContent: vi.fn()
  }
  const tape = {
    linkSubagentTape: vi.fn().mockImplementation(async (input) => ({
      linkEntry: { sessionId: input.parentSessionId, entryId: 1 },
      childSessionId: input.childSessionId,
      childHeadEntryId: 2,
      childEntryCount: 2,
      outcome: input.outcome
    }))
  }
  const deleteDurableSession = vi.fn().mockResolvedValue(undefined)
  const resolveInput = vi.fn().mockResolvedValue({
    sessionId,
    descriptor,
    agent: {
      id: descriptor.id,
      name: descriptor.name,
      command: 'agent',
      source: descriptor.source
    },
    scope: 'regular',
    workdir: '/workspace'
  })
  const backend = createDirectAcpAgentBackend({
    runtime: runtime as never,
    sessionState: sessionState as never,
    transcript: transcript as never,
    tape,
    deleteDurableSession,
    resolveInput
  })
  return {
    backend,
    instance,
    runtime,
    sessionState,
    transcript,
    tape,
    deleteDurableSession,
    resolveInput
  }
}

describe('direct ACP agent backend', () => {
  it('initializes and sends exclusively through AcpAgentRuntime', async () => {
    const harness = createHarness()
    const handle = harness.backend.open(sessionId, descriptor)

    await handle.lifecycle.initialize({ providerId: 'acp', modelId: descriptor.id })
    await expect(handle.send({ content: { text: 'hello', files: [] } })).resolves.toEqual({
      requestId: 'request',
      messageId: 'message'
    })

    expect(handle.kind).toBe('acp')
    expect(harness.sessionState.initSession).toHaveBeenCalledWith(sessionId, {
      providerId: 'acp',
      modelId: descriptor.id
    })
    expect(harness.runtime.send).toHaveBeenCalledWith(
      expect.objectContaining({ sessionId, descriptor }),
      { text: 'hello', files: [] }
    )
  })

  it('does not steer after cancellation wins while ACP input is resolving', async () => {
    const harness = createHarness()
    const handle = harness.backend.open(sessionId, descriptor)
    let resolveInput!: (value: unknown) => void
    harness.resolveInput.mockImplementationOnce(
      async () =>
        await new Promise((resolve) => {
          resolveInput = resolve
        })
    )
    const controller = new AbortController()

    const pendingSteer = handle.pending.steerActiveTurn(
      { text: 'refine', files: [] },
      { signal: controller.signal }
    )
    await vi.waitFor(() => expect(harness.resolveInput).toHaveBeenCalledOnce())
    controller.abort()
    resolveInput({
      sessionId,
      descriptor,
      agent: { id: descriptor.id, name: descriptor.name, command: 'agent' },
      scope: 'regular',
      workdir: '/workspace'
    })

    await expect(pendingSteer).rejects.toMatchObject({ name: 'AbortError' })
    expect(harness.runtime.steer).not.toHaveBeenCalled()
  })

  it('does not send or queue after cancellation wins while ACP input is resolving', async () => {
    const harness = createHarness()
    const handle = harness.backend.open(sessionId, descriptor)
    let resolveInput!: (value: unknown) => void
    harness.resolveInput.mockImplementationOnce(
      async () =>
        await new Promise((resolve) => {
          resolveInput = resolve
        })
    )
    const controller = new AbortController()

    const pendingSend = handle.send({
      content: { text: 'send', files: [] },
      context: { signal: controller.signal },
      queue: { source: 'send' }
    })
    await vi.waitFor(() => expect(harness.resolveInput).toHaveBeenCalledOnce())
    controller.abort()
    resolveInput({
      sessionId,
      descriptor,
      agent: { id: descriptor.id, name: descriptor.name, command: 'agent' },
      scope: 'regular',
      workdir: '/workspace'
    })

    await expect(pendingSend).rejects.toMatchObject({ name: 'AbortError' })
    expect(harness.runtime.send).not.toHaveBeenCalled()
    expect(harness.runtime.queuePendingInput).not.toHaveBeenCalled()
  })

  it('rejects provider/model identity mismatches before state mutation', async () => {
    const harness = createHarness()
    const handle = harness.backend.open(sessionId, descriptor)

    await expect(
      handle.lifecycle.initialize({ providerId: 'openai', modelId: descriptor.id })
    ).rejects.toThrow('ACP session identity mismatch')
    expect(harness.sessionState.initSession).not.toHaveBeenCalled()
    expect(harness.runtime.getOrHydrate).not.toHaveBeenCalled()
  })

  it('reads lightweight state without hydrating the ACP runtime', async () => {
    const harness = createHarness()
    const handle = harness.backend.open(sessionId, descriptor)

    harness.runtime.getHydrated.mockReturnValueOnce(undefined)
    await expect(harness.backend.snapshotIfHydrated(sessionId, descriptor)).resolves.toBeNull()
    await expect(harness.backend.snapshotIfHydrated(sessionId, descriptor)).resolves.toEqual({
      status: 'idle',
      providerId: 'acp',
      modelId: descriptor.id,
      permissionMode: 'full_access'
    })

    await expect(handle.snapshot({ lightweight: true })).resolves.toEqual({
      status: 'idle',
      providerId: 'acp',
      modelId: descriptor.id,
      permissionMode: 'full_access'
    })
    expect(harness.sessionState.getSessionListState).toHaveBeenCalledWith(sessionId)
    expect(harness.resolveInput).not.toHaveBeenCalled()
    expect(harness.runtime.getOrHydrate).not.toHaveBeenCalled()
  })

  it('routes permission responses by persisted ACP request id', async () => {
    const harness = createHarness()
    const handle = harness.backend.open(sessionId, descriptor)

    await expect(
      handle.toolInteractions.respond('assistant', 'tool-call', {
        kind: 'permission',
        granted: true
      })
    ).resolves.toEqual({ resumed: false })
    expect(harness.instance.resolvePermissionRequest).toHaveBeenCalledWith(
      'permission-request',
      true
    )
  })

  it('rejects non-permission interactions before reading the transcript', async () => {
    const harness = createHarness()
    const handle = harness.backend.open(sessionId, descriptor)

    await expect(
      handle.toolInteractions.respond('assistant', 'tool-call', { kind: 'question_other' })
    ).rejects.toThrow('Direct ACP sessions only accept permission interactions.')

    expect(harness.transcript.getMessage).not.toHaveBeenCalled()
    expect(harness.instance.resolvePermissionRequest).not.toHaveBeenCalled()
  })

  it.each([
    ['a missing message', null],
    [
      'a message from another session',
      { id: 'assistant', sessionId: toAppSessionId('other'), role: 'assistant', content: '[]' }
    ],
    ['a non-assistant message', { id: 'user', sessionId, role: 'user', content: '[]' }]
  ])('rejects %s before resolving an ACP permission request', async (_caseName, message) => {
    const harness = createHarness()
    harness.transcript.getMessage.mockResolvedValueOnce(message)
    const handle = harness.backend.open(sessionId, descriptor)

    await expect(
      handle.toolInteractions.respond('assistant', 'tool-call', {
        kind: 'permission',
        granted: true
      })
    ).rejects.toThrow('Assistant message not found: assistant')

    expect(harness.instance.resolvePermissionRequest).not.toHaveBeenCalled()
  })

  it('requires a matching persisted tool-call permission request', async () => {
    const harness = createHarness()
    harness.transcript.getMessage.mockResolvedValueOnce({
      id: 'assistant',
      sessionId,
      role: 'assistant',
      content: JSON.stringify([
        {
          type: 'action',
          action_type: 'tool_call_permission',
          tool_call: { id: 'different-tool' },
          extra: { permissionRequestId: 'permission-request' }
        }
      ])
    })
    const handle = harness.backend.open(sessionId, descriptor)

    await expect(
      handle.toolInteractions.respond('assistant', 'tool-call', {
        kind: 'permission',
        granted: false
      })
    ).rejects.toThrow('ACP permission request not found for tool call: tool-call')

    expect(harness.instance.resolvePermissionRequest).not.toHaveBeenCalled()
  })

  it('rejects permission requests that are no longer hydrated', async () => {
    const harness = createHarness()
    harness.instance.resolvePermissionRequest.mockReturnValueOnce(false)
    const handle = harness.backend.open(sessionId, descriptor)

    await expect(
      handle.toolInteractions.respond('assistant', 'tool-call', {
        kind: 'permission',
        granted: false
      })
    ).rejects.toThrow('Unknown ACP permission request: permission-request')

    expect(harness.instance.resolvePermissionRequest).toHaveBeenCalledWith(
      'permission-request',
      false
    )
  })

  it('durably dismisses an ACP permission when the runtime is unavailable', async () => {
    const harness = createHarness()
    harness.runtime.getHydrated.mockReturnValue(undefined)
    const handle = harness.backend.open(sessionId, descriptor)

    await expect(handle.toolInteractions.dismiss('assistant', 'tool-call')).resolves.toBe(true)

    expect(harness.transcript.updateAssistantContent).toHaveBeenCalledTimes(1)
    const [messageId, blocks] = harness.transcript.updateAssistantContent.mock.calls[0] as [
      string,
      AssistantMessageBlock[]
    ]
    expect(messageId).toBe('assistant')
    const block = blocks.find(
      (candidate) => candidate.type === 'action' && candidate.action_type === 'tool_call_permission'
    )
    expect(block?.status).toBe('denied')
    expect(block?.extra?.needsUserAction).toBe(false)
  })

  it('exposes direct transfer, pending, subagent, generation, and close facets', async () => {
    const harness = createHarness()
    const handle = harness.backend.open(sessionId, descriptor)
    const pendingBeforeResume = { id: 'steer', mode: 'steer', state: 'pending' }
    const pendingAfterResume = { ...pendingBeforeResume, state: 'claimed' }
    harness.runtime.listPendingInputs
      .mockReturnValueOnce([pendingBeforeResume])
      .mockReturnValueOnce([pendingAfterResume])
    const childId = toAppSessionId('child')
    const linkInput = {
      parentSessionId: sessionId,
      childSessionId: childId,
      runId: 'run',
      taskId: 'task',
      slotId: 'reviewer',
      taskTitle: 'Review',
      outcome: 'completed' as const,
      resultSummary: 'Done'
    }

    await expect(harness.backend.transferSource.hasMessages(sessionId)).resolves.toBe(true)
    await expect(handle.pending.list()).resolves.toEqual([pendingAfterResume])
    await expect(harness.backend.subagent.linkTape(linkInput)).resolves.toMatchObject({
      linkEntry: { sessionId, entryId: 1 },
      childSessionId: childId,
      childHeadEntryId: 2,
      outcome: 'completed'
    })
    expect(harness.backend.generationControl.getActiveGeneration(sessionId)).toEqual({
      eventId: 'message',
      runId: 'request'
    })
    await expect(
      harness.backend.generationControl.cancelGenerationByEventId(sessionId, 'message')
    ).resolves.toBe(true)
    await handle.close()

    expect(harness.tape.linkSubagentTape).toHaveBeenCalledWith(linkInput)
    expect(harness.runtime.resumePendingInputs).toHaveBeenCalledWith(
      expect.objectContaining({ sessionId, descriptor })
    )
    expect(harness.runtime.cleanupSession).toHaveBeenCalledWith(sessionId)
    expect(harness.deleteDurableSession).toHaveBeenCalledWith(sessionId)
    expect(harness.sessionState.destroySession).toHaveBeenCalledWith(sessionId)
  })

  it('cleans runtime and durable ACP state without resolving or hydrating a descriptor', async () => {
    const harness = createHarness()

    await harness.backend.cleanupSession(sessionId)

    expect(harness.runtime.cleanupSession).toHaveBeenCalledWith(sessionId)
    expect(harness.deleteDurableSession).toHaveBeenCalledWith(sessionId)
    expect(harness.resolveInput).not.toHaveBeenCalled()
    expect(harness.runtime.getOrHydrate).not.toHaveBeenCalled()
    expect(harness.sessionState.destroySession).not.toHaveBeenCalled()
  })

  it('preserves runtime cleanup errors after durable and shared cleanup', async () => {
    const harness = createHarness()
    const error = new Error('runtime cleanup failed')
    harness.runtime.cleanupSession.mockRejectedValue(error)
    const handle = harness.backend.open(sessionId, descriptor)

    await expect(handle.close()).rejects.toBe(error)

    expect(harness.deleteDurableSession).toHaveBeenCalledWith(sessionId)
    expect(harness.sessionState.destroySession).toHaveBeenCalledWith(sessionId)
  })

  it('does not fall back to DeepChat when direct ACP input resolution fails', async () => {
    const harness = createHarness()
    harness.resolveInput.mockRejectedValue(new Error('ACP config missing'))
    const deepchatOpen = vi.fn()
    const manager = new AgentManager(
      { resolveExecutableDescriptor: () => descriptor },
      { get: () => ({ agentId: descriptor.id }) as never },
      {
        deepchat: {
          kind: 'deepchat',
          open: deepchatOpen
        } as never,
        acp: harness.backend
      }
    )

    const resolved = manager.resolveSessionHandle(sessionId)
    await expect(resolved.handle.send({ content: 'hello' })).rejects.toThrow('ACP config missing')
    expect(resolved.kind).toBe('acp')
    expect(deepchatOpen).not.toHaveBeenCalled()
  })

  it('keeps DeepChat providerId=acp sessions on the DeepChat backend', () => {
    const harness = createHarness()
    const deepchatHandle = { kind: 'deepchat' }
    const deepchatOpen = vi.fn().mockReturnValue(deepchatHandle)
    const manager = new AgentManager(
      {
        resolveExecutableDescriptor: () => ({
          id: 'deepchat-acp',
          kind: 'deepchat',
          source: 'manual',
          name: 'DeepChat ACP',
          enabled: true,
          protected: false,
          description: null,
          icon: null,
          avatar: null,
          config: { defaultModelPreset: { providerId: 'acp', modelId: descriptor.id } }
        })
      },
      { get: () => ({ agentId: 'deepchat-acp' }) as never },
      {
        deepchat: {
          kind: 'deepchat',
          open: deepchatOpen
        } as never,
        acp: harness.backend
      }
    )

    const resolved = manager.resolveSessionHandle(sessionId)

    expect(resolved.kind).toBe('deepchat')
    expect(resolved.handle).toBe(deepchatHandle)
    expect(deepchatOpen).toHaveBeenCalledWith(sessionId)
    expect(harness.resolveInput).not.toHaveBeenCalled()
  })
})
