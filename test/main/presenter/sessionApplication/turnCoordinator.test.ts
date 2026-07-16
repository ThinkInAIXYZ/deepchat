import { describe, expect, it, vi } from 'vitest'
import type {
  ChatMessageRecord,
  PendingSessionInputRecord,
  SessionRecord
} from '@shared/types/agent-interface'
import {
  SessionTurnCoordinator,
  type SessionTurnCoordinatorDependencies
} from '@/presenter/sessionApplication/turnCoordinator'

const createSession = (overrides: Partial<SessionRecord> = {}): SessionRecord => ({
  id: 's1',
  agentId: 'deepchat',
  title: 'Session',
  projectDir: '/repo',
  isPinned: false,
  isDraft: false,
  sessionKind: 'regular',
  parentSessionId: null,
  subagentMeta: null,
  createdAt: 100,
  updatedAt: 200,
  ...overrides
})

const createPending = (overrides: Partial<PendingSessionInputRecord> = {}) => ({
  id: 'pending-1',
  sessionId: 's1',
  mode: 'queue' as const,
  state: 'pending' as const,
  payload: { text: 'Pending', files: [] },
  queueOrder: 1,
  claimedAt: null,
  consumedAt: null,
  createdAt: 100,
  updatedAt: 100,
  ...overrides
})

const createMessage = (overrides: Partial<ChatMessageRecord> = {}): ChatMessageRecord => ({
  id: 'message-1',
  sessionId: 's1',
  orderSeq: 1,
  role: 'user',
  content: JSON.stringify({ text: 'Edited', files: [] }),
  status: 'sent',
  isContextEdge: 0,
  metadata: '{}',
  createdAt: 100,
  updatedAt: 100,
  ...overrides
})

function createHarness(
  options: {
    kind?: 'deepchat' | 'acp'
    providerId?: string
    sessions?: SessionRecord[]
    hasMessages?: boolean
  } = {}
) {
  const records = new Map(
    (options.sessions ?? [createSession()]).map((session) => [session.id, session])
  )
  const pendingRecord = createPending()
  const pending = {
    steerActiveTurn: vi.fn().mockResolvedValue(undefined),
    list: vi.fn().mockResolvedValue([pendingRecord]),
    queue: vi.fn().mockResolvedValue(pendingRecord),
    update: vi.fn().mockResolvedValue(pendingRecord),
    move: vi.fn().mockResolvedValue([pendingRecord]),
    convertToSteer: vi.fn().mockResolvedValue({ ...pendingRecord, mode: 'steer' }),
    steer: vi.fn().mockResolvedValue({ ...pendingRecord, mode: 'steer', state: 'claimed' }),
    delete: vi.fn().mockResolvedValue(undefined)
  }
  const toolInteractions = {
    respond: vi.fn().mockResolvedValue({ resumed: true })
  }
  const send = vi.fn().mockResolvedValue({ requestId: 'request-1', messageId: 'message-1' })
  const cancel = vi.fn().mockResolvedValue(undefined)
  const snapshot = vi.fn().mockResolvedValue({
    status: 'idle',
    providerId: options.providerId ?? (options.kind === 'acp' ? 'acp' : 'openai'),
    modelId: 'model-1',
    permissionMode: 'full_access'
  })
  const compaction = {
    getState: vi.fn().mockResolvedValue({
      status: 'idle',
      cursorOrderSeq: 3,
      summaryUpdatedAt: null
    }),
    compact: vi.fn().mockResolvedValue({
      compacted: true,
      state: { status: 'idle', cursorOrderSeq: 4, summaryUpdatedAt: 200 }
    })
  }
  const runtimeSession =
    options.kind === 'acp'
      ? ({ kind: 'acp', pending, toolInteractions, send, cancel, snapshot } as const)
      : ({
          kind: 'deepchat',
          pending,
          toolInteractions,
          send,
          cancel,
          snapshot,
          compaction
        } as const)
  const resolveSession = vi.fn(() => runtimeSession)
  const sessions = {
    get: vi.fn((sessionId: string) => records.get(sessionId) ?? null),
    update: vi.fn((sessionId: string, fields: Partial<SessionRecord>) => {
      const session = records.get(sessionId)
      if (session) records.set(sessionId, { ...session, ...fields })
    })
  }
  const transcript = {
    hasMessages: vi.fn().mockResolvedValue(options.hasMessages ?? false),
    clearMessages: vi.fn().mockResolvedValue(undefined),
    prepareRetryMessage: vi.fn().mockResolvedValue({
      content: { text: 'Retry', files: [] },
      projectDir: '/retry'
    }),
    deleteMessage: vi.fn().mockResolvedValue(undefined),
    editUserMessage: vi.fn().mockResolvedValue(createMessage())
  }
  const workdir = {
    assertAcpSessionHasWorkdir: vi.fn(),
    syncAcpSessionWorkdir: vi.fn().mockResolvedValue(undefined),
    prepareDirectAcpSession: vi.fn().mockResolvedValue(undefined),
    clearCompatibilityAcpSession: vi.fn().mockResolvedValue(undefined)
  }
  const projection = {
    notify: vi.fn(),
    scheduleTitleGeneration: vi.fn()
  }
  const dependencies: SessionTurnCoordinatorDependencies = {
    sessions,
    runtime: { resolveSession },
    transcript,
    workdir,
    projection
  }

  return {
    coordinator: new SessionTurnCoordinator(dependencies),
    records,
    sessions,
    resolveSession,
    pending,
    toolInteractions,
    send,
    cancel,
    snapshot,
    compaction,
    transcript,
    workdir,
    projection
  }
}

describe('SessionTurnCoordinator', () => {
  it('forwards send, steer, and queue metadata through workdir preparation', async () => {
    const harness = createHarness({ hasMessages: false })

    await expect(
      harness.coordinator.sendMessage('s1', 'Send', { maxProviderRounds: 4 })
    ).resolves.toEqual({ requestId: 'request-1', messageId: 'message-1' })
    await harness.coordinator.steerActiveTurn('s1', 'Steer')
    await harness.coordinator.queuePendingInput('s1', 'Queue')

    expect(harness.send).toHaveBeenCalledWith({
      content: { text: 'Send', files: [] },
      context: { projectDir: '/repo', maxProviderRounds: 4 },
      queue: { source: 'send', projectDir: '/repo' }
    })
    expect(harness.pending.steerActiveTurn).toHaveBeenCalledWith({ text: 'Steer', files: [] })
    expect(harness.pending.queue).toHaveBeenCalledWith(
      { text: 'Queue', files: [] },
      { source: 'queue', projectDir: '/repo' }
    )
    expect(harness.workdir.assertAcpSessionHasWorkdir).toHaveBeenCalledTimes(3)
    expect(harness.workdir.syncAcpSessionWorkdir).toHaveBeenCalledTimes(3)
    expect(harness.projection.scheduleTitleGeneration).toHaveBeenCalledWith({
      sessionId: 's1',
      initialTitle: 'Session',
      fallbackProviderId: 'openai',
      fallbackModelId: 'model-1'
    })
  })

  it('canonicalizes structured live send and steer input at the application boundary', async () => {
    const harness = createHarness({ hasMessages: true })
    const file = { name: 'brief.md', path: '/repo/brief.md' }
    const inlineItem = {
      type: 'file' as const,
      offset: 3,
      fileName: file.name,
      filePath: file.path
    }

    await harness.coordinator.sendMessage('s1', {
      text: 'Send',
      files: [file],
      activeSkills: [' review ', 'review'],
      inlineItems: [inlineItem]
    })
    await harness.coordinator.steerActiveTurn('s1', {
      text: 'Steer',
      files: [file],
      activeSkills: [' review ', 'review'],
      inlineItems: [inlineItem]
    })

    const canonicalInput = {
      files: [file],
      activeSkills: ['review'],
      inlineItems: [inlineItem]
    }
    expect(harness.send).toHaveBeenCalledWith(
      expect.objectContaining({ content: { text: 'Send', ...canonicalInput } })
    )
    expect(harness.pending.steerActiveTurn).toHaveBeenCalledWith({
      text: 'Steer',
      ...canonicalInput
    })
  })

  it.each([
    ['send', (coordinator: SessionTurnCoordinator) => coordinator.sendMessage('draft', 'Prompt')],
    [
      'steer',
      (coordinator: SessionTurnCoordinator) => coordinator.steerActiveTurn('draft', 'Prompt')
    ],
    [
      'queue',
      (coordinator: SessionTurnCoordinator) => coordinator.queuePendingInput('draft', 'Prompt')
    ]
  ])('does not roll back draft promotion when %s fails later', async (_name, invoke) => {
    const harness = createHarness({ sessions: [createSession({ id: 'draft', isDraft: true })] })
    harness.resolveSession.mockImplementation(() => {
      throw new Error('runtime failed')
    })

    await expect(invoke(harness.coordinator)).rejects.toThrow('runtime failed')
    expect(harness.records.get('draft')).toMatchObject({ isDraft: false, title: 'Prompt' })
    expect(harness.projection.notify).toHaveBeenCalledWith({
      sessionIds: ['draft'],
      reason: 'updated'
    })
  })

  it('owns pending mutations and preserves missing-session behavior', async () => {
    const harness = createHarness()

    await expect(harness.coordinator.listPendingInputs('s1')).resolves.toHaveLength(1)
    await harness.coordinator.updateQueuedInput('s1', 'pending-1', 'Updated')
    await harness.coordinator.moveQueuedInput('s1', 'pending-1', 2)
    await harness.coordinator.convertPendingInputToSteer('s1', 'pending-1')
    await harness.coordinator.steerPendingInput('s1', 'pending-1')
    await harness.coordinator.deletePendingInput('s1', 'pending-1')

    expect(harness.pending.update).toHaveBeenCalledWith('pending-1', {
      text: 'Updated',
      files: []
    })
    expect(harness.pending.move).toHaveBeenCalledWith('pending-1', 2)
    expect(harness.pending.convertToSteer).toHaveBeenCalledWith('pending-1')
    expect(harness.pending.steer).toHaveBeenCalledWith('pending-1')
    expect(harness.pending.delete).toHaveBeenCalledWith('pending-1')

    harness.resolveSession.mockClear()
    await expect(harness.coordinator.listPendingInputs('missing')).resolves.toEqual([])
    await expect(harness.coordinator.cancelGeneration('missing')).resolves.toBeUndefined()
    const missingMutations = [
      () => harness.coordinator.sendMessage('missing', 'Send'),
      () => harness.coordinator.steerActiveTurn('missing', 'Steer'),
      () => harness.coordinator.queuePendingInput('missing', 'Queue'),
      () => harness.coordinator.updateQueuedInput('missing', 'pending-1', 'Updated'),
      () => harness.coordinator.moveQueuedInput('missing', 'pending-1', 1),
      () => harness.coordinator.convertPendingInputToSteer('missing', 'pending-1'),
      () => harness.coordinator.steerPendingInput('missing', 'pending-1'),
      () => harness.coordinator.deletePendingInput('missing', 'pending-1'),
      () => harness.coordinator.retryMessage('missing', 'message-1'),
      () => harness.coordinator.deleteMessage('missing', 'message-1'),
      () => harness.coordinator.editUserMessage('missing', 'message-1', 'Edited'),
      () => harness.coordinator.getSessionCompactionState('missing'),
      () => harness.coordinator.compactSession('missing'),
      () => harness.coordinator.clearSessionMessages('missing'),
      () =>
        harness.coordinator.respondToolInteraction('missing', 'message-1', 'tool-1', {
          kind: 'permission',
          granted: true
        })
    ]
    for (const mutate of missingMutations) {
      await expect(mutate()).rejects.toThrow('Session not found: missing')
    }
    expect(harness.resolveSession).not.toHaveBeenCalled()
  })

  it('preserves retry metadata and message mutation cancellation ordering', async () => {
    const harness = createHarness()

    await harness.coordinator.retryMessage('s1', 'message-1')
    expect(harness.send).toHaveBeenCalledWith({
      content: { text: 'Retry', files: [] },
      context: { projectDir: '/retry', emitRefreshBeforeStream: true }
    })
    expect(harness.cancel).not.toHaveBeenCalled()

    await harness.coordinator.deleteMessage('s1', 'message-1')
    expect(harness.cancel.mock.invocationCallOrder[0]).toBeLessThan(
      harness.transcript.deleteMessage.mock.invocationCallOrder[0]
    )

    harness.cancel.mockClear()
    await harness.coordinator.editUserMessage('s1', 'message-1', 'Edited')
    expect(harness.transcript.editUserMessage).toHaveBeenCalledWith('s1', 'message-1', 'Edited')
    expect(harness.cancel).not.toHaveBeenCalled()

    await harness.coordinator.clearSessionMessages('s1')
    expect(harness.cancel.mock.invocationCallOrder[0]).toBeLessThan(
      harness.transcript.clearMessages.mock.invocationCallOrder[0]
    )
    expect(harness.projection.notify).toHaveBeenCalledWith({
      sessionIds: ['s1'],
      reason: 'updated'
    })
  })

  it('stops delete and clear mutations when cancellation fails', async () => {
    const harness = createHarness()
    harness.cancel.mockRejectedValue(new Error('cancel failed'))

    await expect(harness.coordinator.deleteMessage('s1', 'message-1')).rejects.toThrow(
      'cancel failed'
    )
    await expect(harness.coordinator.clearSessionMessages('s1')).rejects.toThrow('cancel failed')

    expect(harness.transcript.deleteMessage).not.toHaveBeenCalled()
    expect(harness.transcript.clearMessages).not.toHaveBeenCalled()
  })

  it('uses direct ACP tool interaction while rejecting ACP manual compaction', async () => {
    const harness = createHarness({
      kind: 'acp',
      sessions: [createSession({ agentId: 'acp-coder' })]
    })
    const response = { kind: 'permission' as const, granted: true }

    await expect(
      harness.coordinator.respondToolInteraction('s1', 'message-1', 'tool-1', response)
    ).resolves.toEqual({ resumed: true })
    expect(harness.toolInteractions.respond).toHaveBeenCalledWith('message-1', 'tool-1', response)
    await expect(harness.coordinator.getSessionCompactionState('s1')).resolves.toEqual({
      status: 'idle',
      cursorOrderSeq: 1,
      summaryUpdatedAt: null
    })
    await expect(harness.coordinator.compactSession('s1')).rejects.toThrow(
      'Agent acp-coder does not support manual compaction.'
    )
  })

  it('keeps compatibility ACP sessions out of DeepChat manual compaction', async () => {
    const harness = createHarness({ providerId: 'acp' })

    await expect(harness.coordinator.compactSession('s1')).rejects.toThrow(
      'Manual compaction is only available for DeepChat agent sessions.'
    )
    expect(harness.compaction.compact).not.toHaveBeenCalled()
  })

  it('delegates DeepChat compaction state and mutation', async () => {
    const harness = createHarness()

    await expect(harness.coordinator.getSessionCompactionState('s1')).resolves.toMatchObject({
      cursorOrderSeq: 3
    })
    await expect(harness.coordinator.compactSession('s1')).resolves.toMatchObject({
      compacted: true
    })
  })

  it('starts the lifecycle initial turn without awaiting it and schedules title generation', () => {
    const harness = createHarness()
    const content = { text: 'Initial', files: [], activeSkills: ['review'] }
    let resolveSend: (() => void) | undefined
    harness.send.mockReturnValue(
      new Promise((resolve) => {
        resolveSend = () => resolve({ requestId: null, messageId: null })
      })
    )

    expect(
      harness.coordinator.startInitialTurn({
        sessionId: 's1',
        content,
        projectDir: '/repo',
        initialTitle: 'Initial',
        fallbackProviderId: 'openai',
        fallbackModelId: 'model-1'
      })
    ).toBeUndefined()

    expect(harness.send).toHaveBeenCalledWith({
      content,
      context: { projectDir: '/repo' },
      queue: { source: 'send', projectDir: '/repo' }
    })
    expect(harness.projection.scheduleTitleGeneration).toHaveBeenCalledWith({
      sessionId: 's1',
      initialTitle: 'Initial',
      fallbackProviderId: 'openai',
      fallbackModelId: 'model-1'
    })
    resolveSend?.()
  })

  it('does not resolve runtime for an empty lifecycle initial turn', () => {
    const harness = createHarness()

    harness.coordinator.startInitialTurn({
      sessionId: 's1',
      content: { text: '  ', files: [] },
      projectDir: '/repo',
      initialTitle: 'New Chat',
      fallbackProviderId: 'openai',
      fallbackModelId: 'model-1'
    })

    expect(harness.resolveSession).not.toHaveBeenCalled()
    expect(harness.projection.scheduleTitleGeneration).not.toHaveBeenCalled()
  })

  it('contains lifecycle initial-turn rejection after creation returns', async () => {
    const harness = createHarness()
    const error = new Error('send failed')
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    harness.send.mockRejectedValue(error)

    expect(() =>
      harness.coordinator.startInitialTurn({
        sessionId: 's1',
        content: { text: 'Initial', files: [] },
        projectDir: '/repo',
        initialTitle: 'Initial',
        fallbackProviderId: 'openai',
        fallbackModelId: 'model-1'
      })
    ).not.toThrow()
    await Promise.resolve()

    expect(consoleError).toHaveBeenCalledWith(
      '[SessionTurnCoordinator] initial send failed:',
      error
    )
    expect(harness.projection.scheduleTitleGeneration).toHaveBeenCalledOnce()
    consoleError.mockRestore()
  })

  it('contains synchronous runtime resolution failure after creation returns', () => {
    const harness = createHarness()
    const error = new Error('resolve failed')
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    harness.resolveSession.mockImplementation(() => {
      throw error
    })

    expect(() =>
      harness.coordinator.startInitialTurn({
        sessionId: 's1',
        content: { text: 'Initial', files: [] },
        projectDir: '/repo',
        initialTitle: 'Initial',
        fallbackProviderId: 'openai',
        fallbackModelId: 'model-1'
      })
    ).not.toThrow()

    expect(consoleError).toHaveBeenCalledWith(
      '[SessionTurnCoordinator] initial send failed:',
      error
    )
    expect(harness.projection.scheduleTitleGeneration).toHaveBeenCalledOnce()
    consoleError.mockRestore()
  })

  it('contains synchronous send invocation failure after creation returns', () => {
    const harness = createHarness()
    const error = new Error('send invocation failed')
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    harness.send.mockImplementation(() => {
      throw error
    })

    expect(() =>
      harness.coordinator.startInitialTurn({
        sessionId: 's1',
        content: { text: 'Initial', files: [] },
        projectDir: '/repo',
        initialTitle: 'Initial',
        fallbackProviderId: 'openai',
        fallbackModelId: 'model-1'
      })
    ).not.toThrow()

    expect(consoleError).toHaveBeenCalledWith(
      '[SessionTurnCoordinator] initial send failed:',
      error
    )
    expect(harness.projection.scheduleTitleGeneration).toHaveBeenCalledOnce()
    consoleError.mockRestore()
  })
})
