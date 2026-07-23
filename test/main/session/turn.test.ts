import { describe, expect, it, vi } from 'vitest'
import type {
  ChatMessageRecord,
  PendingSessionInputRecord,
  SessionRecord
} from '@shared/types/agent-interface'
import { SessionTurn, type SessionTurnDependencies } from '@/session/turn'

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
  blocking: null,
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
    steerActiveTurn: vi.fn().mockResolvedValue({ requestId: null, messageId: null }),
    list: vi.fn().mockResolvedValue([pendingRecord]),
    queue: vi.fn().mockResolvedValue(pendingRecord),
    update: vi.fn().mockResolvedValue(pendingRecord),
    move: vi.fn().mockResolvedValue([pendingRecord]),
    convertToSteer: vi.fn().mockResolvedValue({ ...pendingRecord, mode: 'steer' }),
    steer: vi.fn().mockResolvedValue({ ...pendingRecord, mode: 'steer', state: 'claimed' }),
    resolveBlocked: vi.fn().mockResolvedValue(pendingRecord),
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
      projectDir: '/retry',
      sourceOrderSeq: 3
    }),
    commitRetryMessage: vi.fn(),
    deleteMessage: vi.fn().mockResolvedValue(undefined),
    editUserMessage: vi.fn().mockResolvedValue(createMessage())
  }
  const workdir = {
    runWithSessionOperationGate: vi.fn(
      async <T>(_sessionId: string, operation: () => Promise<T>) => await operation()
    ),
    assertAcpSessionHasWorkdir: vi.fn(),
    syncAcpSessionWorkdir: vi.fn().mockResolvedValue(undefined),
    prepareDirectAcpSession: vi.fn().mockResolvedValue(undefined),
    clearCompatibilityAcpSession: vi.fn().mockResolvedValue(undefined)
  }
  const projection = {
    notify: vi.fn(),
    scheduleTitleGeneration: vi.fn()
  }
  const dependencies: SessionTurnDependencies = {
    sessions,
    runtime: { resolveSession },
    transcript,
    workdir,
    projection
  }

  return {
    coordinator: new SessionTurn(dependencies),
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

describe('SessionTurn', () => {
  it('propagates initial attachment cancellation instead of converting it to user action', async () => {
    const harness = createHarness()
    const controller = new AbortController()
    harness.send.mockImplementationOnce(async (input) => {
      controller.abort()
      input.context.signal.throwIfAborted()
    })

    await expect(
      harness.coordinator.startInitialTurn({
        sessionId: 's1',
        content: { text: '', files: [{ name: 'scan.png', mimeType: 'image/png' }] },
        projectDir: '/repo',
        initialTitle: 'Scan',
        fallbackProviderId: 'openai',
        fallbackModelId: 'model-1',
        signal: controller.signal
      })
    ).rejects.toMatchObject({ name: 'AbortError' })

    expect(harness.send).toHaveBeenCalledWith(
      expect.objectContaining({
        context: expect.objectContaining({ signal: controller.signal })
      })
    )
  })

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
    expect(harness.workdir.runWithSessionOperationGate).toHaveBeenCalledTimes(3)
    expect(harness.projection.scheduleTitleGeneration).toHaveBeenCalledWith({
      sessionId: 's1',
      initialTitle: 'Session',
      fallbackProviderId: 'openai',
      fallbackModelId: 'model-1'
    })
  })

  it.each([
    ['send', (coordinator: SessionTurn) => coordinator.sendMessage('s1', 'Send')],
    ['steer', (coordinator: SessionTurn) => coordinator.steerActiveTurn('s1', 'Steer')],
    ['queue', (coordinator: SessionTurn) => coordinator.queuePendingInput('s1', 'Queue')],
    ['retry', (coordinator: SessionTurn) => coordinator.retryMessage('s1', 'message-1')]
  ])('keeps %s session resolution inside the operation gate', async (_name, runOperation) => {
    const harness = createHarness()
    let releaseGate!: () => void
    let markGateStarted!: () => void
    const gate = new Promise<void>((resolve) => {
      releaseGate = resolve
    })
    const gateStarted = new Promise<void>((resolve) => {
      markGateStarted = resolve
    })
    harness.workdir.runWithSessionOperationGate.mockImplementation(
      async <T>(_sessionId: string, operation: () => Promise<T>) => {
        markGateStarted()
        await gate
        return await operation()
      }
    )

    const pendingOperation = runOperation(harness.coordinator)
    await gateStarted
    expect(harness.sessions.get).not.toHaveBeenCalled()
    expect(harness.resolveSession).not.toHaveBeenCalled()

    releaseGate()
    await pendingOperation
    expect(harness.resolveSession).toHaveBeenCalledOnce()
    if (_name === 'retry') {
      expect(harness.transcript.prepareRetryMessage).toHaveBeenCalledWith('s1', 'message-1')
    }
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

  it('does not roll back draft promotion when queue fails later', async () => {
    const harness = createHarness({ sessions: [createSession({ id: 'draft', isDraft: true })] })
    harness.resolveSession.mockImplementation(() => {
      throw new Error('runtime failed')
    })

    await expect(harness.coordinator.queuePendingInput('draft', 'Prompt')).rejects.toThrow(
      'runtime failed'
    )
    expect(harness.records.get('draft')).toMatchObject({ isDraft: false, title: 'Prompt' })
    expect(harness.projection.notify).toHaveBeenCalledWith({
      sessionIds: ['draft'],
      reason: 'updated'
    })
  })

  it('keeps a draft unchanged when send acceptance fails', async () => {
    const harness = createHarness({ sessions: [createSession({ id: 'draft', isDraft: true })] })
    harness.resolveSession.mockImplementation(() => {
      throw new Error('runtime failed')
    })

    await expect(harness.coordinator.sendMessage('draft', 'Prompt')).rejects.toThrow(
      'runtime failed'
    )
    expect(harness.records.get('draft')).toMatchObject({ isDraft: true, title: 'Session' })
    expect(harness.projection.notify).not.toHaveBeenCalled()
  })

  it('keeps a draft unchanged when steer acceptance fails', async () => {
    const harness = createHarness({ sessions: [createSession({ id: 'draft', isDraft: true })] })
    harness.resolveSession.mockImplementation(() => {
      throw new Error('runtime failed')
    })

    await expect(harness.coordinator.steerActiveTurn('draft', 'Prompt')).rejects.toThrow(
      'runtime failed'
    )
    expect(harness.records.get('draft')).toMatchObject({ isDraft: true, title: 'Session' })
    expect(harness.projection.notify).not.toHaveBeenCalled()
  })

  it('keeps a draft unchanged when attachment preflight needs user action', async () => {
    const harness = createHarness({ sessions: [createSession({ id: 'draft', isDraft: true })] })
    harness.send.mockResolvedValueOnce({
      requestId: null,
      messageId: null,
      attachmentPreparation: {
        status: 'needs_user_action',
        issues: [{ attachmentIndex: 0, reason: 'ocr_empty' }],
        suggestedActions: ['send_without_image_content']
      }
    })

    await expect(harness.coordinator.sendMessage('draft', 'Prompt')).resolves.toMatchObject({
      attachmentPreparation: { status: 'needs_user_action' }
    })
    expect(harness.records.get('draft')).toMatchObject({ isDraft: true, title: 'Session' })
    expect(harness.projection.notify).not.toHaveBeenCalled()
  })

  it('keeps a draft unchanged when steer attachment preflight needs user action', async () => {
    const harness = createHarness({ sessions: [createSession({ id: 'draft', isDraft: true })] })
    harness.pending.steerActiveTurn.mockResolvedValueOnce({
      requestId: null,
      messageId: null,
      attachmentPreparation: {
        status: 'needs_user_action',
        issues: [{ attachmentIndex: 0, reason: 'ocr_empty' }],
        suggestedActions: ['send_without_image_content']
      }
    })

    await expect(harness.coordinator.steerActiveTurn('draft', 'Prompt')).resolves.toMatchObject({
      attachmentPreparation: { status: 'needs_user_action' }
    })
    expect(harness.records.get('draft')).toMatchObject({ isDraft: true, title: 'Session' })
    expect(harness.projection.notify).not.toHaveBeenCalled()
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
      context: {
        projectDir: '/retry',
        emitRefreshBeforeStream: true,
        preserveResolvedRepresentations: true,
        beforeHistoryPreparation: expect.any(Function)
      }
    })
    const retryContext = harness.send.mock.calls[0][0].context
    retryContext?.beforeHistoryPreparation?.()
    expect(harness.transcript.commitRetryMessage).toHaveBeenCalledWith('s1', 3)
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

  it('applies an explicit metadata-only fallback to a retry without persisting the policy', async () => {
    const harness = createHarness()

    await harness.coordinator.retryMessage('s1', 'message-1', {
      attachmentFallbackPolicy: 'send_without_image_content'
    })

    expect(harness.send).toHaveBeenCalledWith({
      content: {
        text: 'Retry',
        files: [],
        attachmentFallbackPolicy: 'send_without_image_content'
      },
      context: expect.objectContaining({
        preserveResolvedRepresentations: true,
        beforeHistoryPreparation: expect.any(Function)
      })
    })
  })

  it('commits Direct ACP retry truncation before sending because ACP has no preflight hook', async () => {
    const harness = createHarness({
      kind: 'acp',
      sessions: [createSession({ agentId: 'acp-coder' })]
    })

    await harness.coordinator.retryMessage('s1', 'message-1')

    expect(harness.transcript.commitRetryMessage).toHaveBeenCalledWith('s1', 3)
    expect(harness.transcript.commitRetryMessage.mock.invocationCallOrder[0]).toBeLessThan(
      harness.send.mock.invocationCallOrder[0]
    )
    expect(harness.send).toHaveBeenCalledWith({
      content: { text: 'Retry', files: [] },
      context: { projectDir: '/retry', emitRefreshBeforeStream: true }
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

  it('awaits lifecycle initial-turn acceptance without awaiting provider generation', async () => {
    const harness = createHarness()
    const content = { text: 'Initial', files: [], activeSkills: ['review'] }
    harness.send.mockResolvedValueOnce({
      requestId: null,
      messageId: null,
      attachmentPreparation: { status: 'ready', issues: [], suggestedActions: [] }
    })

    await expect(
      harness.coordinator.startInitialTurn({
        sessionId: 's1',
        content,
        projectDir: '/repo',
        initialTitle: 'Initial',
        fallbackProviderId: 'openai',
        fallbackModelId: 'model-1'
      })
    ).resolves.toMatchObject({ attachmentPreparation: { status: 'ready' } })

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
  })

  it('preserves fire-and-forget lifecycle startup for Direct ACP sessions', async () => {
    const harness = createHarness({ kind: 'acp' })
    harness.send.mockReturnValue(new Promise(() => undefined))

    await expect(
      harness.coordinator.startInitialTurn({
        sessionId: 's1',
        content: { text: 'Initial', files: [] },
        projectDir: '/repo',
        initialTitle: 'Initial',
        fallbackProviderId: 'acp',
        fallbackModelId: 'acp-coder'
      })
    ).resolves.toEqual({ requestId: null, messageId: null })

    expect(harness.projection.scheduleTitleGeneration).toHaveBeenCalledOnce()
  })

  it('does not resolve runtime for an empty lifecycle initial turn', async () => {
    const harness = createHarness()

    await harness.coordinator.startInitialTurn({
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

  it('contains rejected DeepChat initial-turn acceptance', async () => {
    const harness = createHarness()
    const error = new Error('send failed')
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    harness.send.mockRejectedValue(error)

    await expect(
      harness.coordinator.startInitialTurn({
        sessionId: 's1',
        content: { text: 'Initial', files: [] },
        projectDir: '/repo',
        initialTitle: 'Initial',
        fallbackProviderId: 'openai',
        fallbackModelId: 'model-1'
      })
    ).resolves.toBeUndefined()

    expect(consoleError).toHaveBeenCalledWith('[SessionTurn] initial send failed:', error)
    expect(harness.projection.scheduleTitleGeneration).not.toHaveBeenCalled()
    consoleError.mockRestore()
  })

  it('contains synchronous runtime resolution failure during initial preflight', async () => {
    const harness = createHarness()
    const error = new Error('resolve failed')
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    harness.resolveSession.mockImplementation(() => {
      throw error
    })

    await expect(
      harness.coordinator.startInitialTurn({
        sessionId: 's1',
        content: { text: 'Initial', files: [] },
        projectDir: '/repo',
        initialTitle: 'Initial',
        fallbackProviderId: 'openai',
        fallbackModelId: 'model-1'
      })
    ).resolves.toBeUndefined()

    expect(consoleError).toHaveBeenCalledWith('[SessionTurn] initial send failed:', error)
    expect(harness.projection.scheduleTitleGeneration).not.toHaveBeenCalled()
    consoleError.mockRestore()
  })

  it('returns a recoverable result when initial attachment acceptance fails unexpectedly', async () => {
    const harness = createHarness()
    const error = new Error('attachment preflight failed')
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    harness.send.mockRejectedValueOnce(error)

    await expect(
      harness.coordinator.startInitialTurn({
        sessionId: 's1',
        content: {
          text: '',
          files: [{ name: 'receipt.png', path: '/tmp/receipt.png', mimeType: 'image/png' }]
        },
        projectDir: '/repo',
        initialTitle: 'New Chat',
        fallbackProviderId: 'openai',
        fallbackModelId: 'model-1'
      })
    ).resolves.toEqual({
      requestId: null,
      messageId: null,
      attachmentPreparation: {
        status: 'needs_user_action',
        issues: [],
        suggestedActions: ['retry', 'send_without_image_content']
      }
    })

    expect(consoleError).toHaveBeenCalledWith(
      '[SessionTurn] initial attachment acceptance failed:',
      error
    )
    expect(harness.send).toHaveBeenCalledOnce()
    expect(harness.projection.scheduleTitleGeneration).not.toHaveBeenCalled()
    consoleError.mockRestore()
  })

  it('contains synchronous send invocation failure during acceptance', async () => {
    const harness = createHarness()
    const error = new Error('send invocation failed')
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    harness.send.mockImplementation(() => {
      throw error
    })

    await expect(
      harness.coordinator.startInitialTurn({
        sessionId: 's1',
        content: { text: 'Initial', files: [] },
        projectDir: '/repo',
        initialTitle: 'Initial',
        fallbackProviderId: 'openai',
        fallbackModelId: 'model-1'
      })
    ).resolves.toBeUndefined()

    expect(consoleError).toHaveBeenCalledWith('[SessionTurn] initial send failed:', error)
    expect(harness.projection.scheduleTitleGeneration).not.toHaveBeenCalled()
    consoleError.mockRestore()
  })
})
