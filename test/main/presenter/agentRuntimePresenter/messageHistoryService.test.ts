import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { ChatMessageRecord, DeepChatSessionState } from '@shared/types/agent-interface'
import type { DeepChatMessageStore } from '@/presenter/agentRuntimePresenter/messageStore'
import {
  MessageHistoryService,
  type MessageHistoryRuntime
} from '@/presenter/agentRuntimePresenter/messageHistoryService'

function createMessage(overrides: Partial<ChatMessageRecord> = {}): ChatMessageRecord {
  return {
    id: 'user-1',
    sessionId: 's1',
    orderSeq: 3,
    role: 'user',
    content: JSON.stringify({ text: 'hello', files: [], links: [], search: false, think: false }),
    status: 'sent',
    isContextEdge: 0,
    metadata: '{}',
    createdAt: 1,
    updatedAt: 1,
    ...overrides
  }
}

function createMessageStore() {
  return {
    getMessage: vi.fn(),
    getLastUserMessageBeforeOrAt: vi.fn(),
    deleteBySession: vi.fn(),
    deleteFromOrderSeq: vi.fn(),
    updateMessageContent: vi.fn(),
    cloneSentMessagesToSession: vi.fn()
  }
}

function createRuntime(state: DeepChatSessionState | null = createSessionState()) {
  return {
    getSessionState: vi.fn(async () => state),
    cancelGeneration: vi.fn(async () => undefined),
    deletePendingInputs: vi.fn(),
    clearFirstTurnReady: vi.fn(),
    resetMemoryExtractionCursor: vi.fn(),
    clearMemoryIngestionProjectionRetry: vi.fn(),
    resetTape: vi.fn(),
    resetSummaryState: vi.fn(),
    setSessionStatus: vi.fn(),
    hasPendingInteractions: vi.fn(() => false),
    assertNoActiveInputs: vi.fn(),
    invalidateSummaryIfNeeded: vi.fn(),
    invalidateMemoryExtractionFromOrderSeq: vi.fn(),
    resolveProjectDir: vi.fn(() => '/workspace'),
    processMessage: vi.fn(async () => undefined)
  }
}

function createSessionState(overrides: Partial<DeepChatSessionState> = {}): DeepChatSessionState {
  return {
    status: 'idle',
    providerId: 'openai',
    modelId: 'gpt-4',
    permissionMode: 'full_access',
    ...overrides
  }
}

function expectCalledBefore(first: ReturnType<typeof vi.fn>, second: ReturnType<typeof vi.fn>) {
  expect(first.mock.invocationCallOrder[0]).toBeLessThan(second.mock.invocationCallOrder[0])
}

describe('MessageHistoryService', () => {
  let messageStore: ReturnType<typeof createMessageStore>
  let runtime: ReturnType<typeof createRuntime>
  let service: MessageHistoryService

  beforeEach(() => {
    messageStore = createMessageStore()
    runtime = createRuntime()
    service = new MessageHistoryService(
      messageStore as unknown as DeepChatMessageStore,
      runtime as MessageHistoryRuntime
    )
  })

  it('clears all history-owned state in the established order', async () => {
    await service.clearMessages('s1')

    expect(runtime.getSessionState).toHaveBeenCalledWith('s1')
    expect(runtime.cancelGeneration).toHaveBeenCalledWith('s1')
    expect(runtime.deletePendingInputs).toHaveBeenCalledWith('s1')
    expect(runtime.clearFirstTurnReady).toHaveBeenCalledWith('s1')
    expect(runtime.resetMemoryExtractionCursor).toHaveBeenCalledWith('s1')
    expect(runtime.clearMemoryIngestionProjectionRetry).toHaveBeenCalledWith('s1')
    expect(messageStore.deleteBySession).toHaveBeenCalledWith('s1')
    expect(runtime.resetTape).toHaveBeenCalledWith('s1')
    expect(runtime.resetSummaryState).toHaveBeenCalledWith('s1')
    expect(runtime.setSessionStatus).toHaveBeenCalledWith('s1', 'idle')

    expectCalledBefore(runtime.cancelGeneration, runtime.deletePendingInputs)
    expectCalledBefore(runtime.deletePendingInputs, runtime.clearFirstTurnReady)
    expectCalledBefore(runtime.clearFirstTurnReady, runtime.resetMemoryExtractionCursor)
    expectCalledBefore(
      runtime.resetMemoryExtractionCursor,
      runtime.clearMemoryIngestionProjectionRetry
    )
    expectCalledBefore(runtime.clearMemoryIngestionProjectionRetry, messageStore.deleteBySession)
    expectCalledBefore(messageStore.deleteBySession, runtime.resetTape)
    expectCalledBefore(runtime.resetTape, runtime.resetSummaryState)
    expectCalledBefore(runtime.resetSummaryState, runtime.setSessionStatus)
  })

  it('rejects clearing a missing session before mutating history', async () => {
    runtime.getSessionState.mockResolvedValue(null)

    await expect(service.clearMessages('missing')).rejects.toThrow('Session missing not found')
    expect(runtime.cancelGeneration).not.toHaveBeenCalled()
    expect(messageStore.deleteBySession).not.toHaveBeenCalled()
  })

  it('clears projection retry state before a later history deletion failure', async () => {
    messageStore.deleteBySession.mockImplementation(() => {
      throw new Error('delete failed')
    })

    await expect(service.clearMessages('s1')).rejects.toThrow('delete failed')

    expect(runtime.clearMemoryIngestionProjectionRetry).toHaveBeenCalledWith('s1')
    expect(runtime.resetTape).not.toHaveBeenCalled()
  })

  it('rolls back a persisted pending-input turn from its user message', () => {
    messageStore.getMessage.mockReturnValue(createMessage({ id: 'user-1', orderSeq: 7 }))

    service.rollbackPersistedPendingInputTurn('s1', 'user-1')

    expect(runtime.invalidateSummaryIfNeeded).toHaveBeenCalledWith('s1', 7)
    expect(runtime.invalidateMemoryExtractionFromOrderSeq).toHaveBeenCalledWith('s1', 7)
    expect(messageStore.deleteFromOrderSeq).toHaveBeenCalledWith('s1', 7)
  })

  it('does not mutate history when a pending-input turn has no persisted user message', () => {
    messageStore.getMessage.mockReturnValue(null)

    service.rollbackPersistedPendingInputTurn('s1', 'missing')

    expect(runtime.invalidateSummaryIfNeeded).not.toHaveBeenCalled()
    expect(runtime.invalidateMemoryExtractionFromOrderSeq).not.toHaveBeenCalled()
    expect(messageStore.deleteFromOrderSeq).not.toHaveBeenCalled()
  })

  it('retries an assistant message from its preceding user input', async () => {
    const assistant = createMessage({ id: 'assistant-1', role: 'assistant', orderSeq: 4 })
    const user = createMessage({
      content: JSON.stringify({
        text: 'retry this',
        files: [{ name: 'notes.txt', path: '/tmp/notes.txt' }],
        activeSkills: [' beta ', 'alpha', 'beta'],
        inlineItems: [{ type: 'text', content: 'inline' }]
      })
    })
    messageStore.getMessage.mockReturnValue(assistant)
    messageStore.getLastUserMessageBeforeOrAt.mockReturnValue(user)

    await service.retryMessage('s1', 'assistant-1')

    expect(messageStore.getLastUserMessageBeforeOrAt).toHaveBeenCalledWith('s1', 4)
    expect(runtime.invalidateSummaryIfNeeded).toHaveBeenCalledWith('s1', 3)
    expect(runtime.invalidateMemoryExtractionFromOrderSeq).toHaveBeenCalledWith('s1', 3)
    expect(messageStore.deleteFromOrderSeq).toHaveBeenCalledWith('s1', 3)
    expect(runtime.processMessage).toHaveBeenCalledWith(
      's1',
      {
        text: 'retry this',
        files: [{ name: 'notes.txt', path: '/tmp/notes.txt' }],
        activeSkills: ['alpha', 'beta'],
        inlineItems: [{ type: 'text', content: 'inline' }]
      },
      { projectDir: '/workspace', emitRefreshBeforeStream: true }
    )
    expectCalledBefore(
      runtime.invalidateSummaryIfNeeded,
      runtime.invalidateMemoryExtractionFromOrderSeq
    )
    expectCalledBefore(
      runtime.invalidateMemoryExtractionFromOrderSeq,
      messageStore.deleteFromOrderSeq
    )
    expectCalledBefore(messageStore.deleteFromOrderSeq, runtime.processMessage)
  })

  it('applies retry mutation guards before looking up the target message', async () => {
    runtime.getSessionState.mockResolvedValue(createSessionState({ status: 'generating' }))
    await expect(service.retryMessage('s1', 'm1')).rejects.toThrow(
      'Cannot retry while session is generating.'
    )

    runtime.getSessionState.mockResolvedValue(createSessionState())
    runtime.hasPendingInteractions.mockReturnValue(true)
    await expect(service.retryMessage('s1', 'm1')).rejects.toThrow(
      'Please resolve pending tool interactions before retrying.'
    )

    runtime.hasPendingInteractions.mockReturnValue(false)
    runtime.assertNoActiveInputs.mockImplementation(() => {
      throw new Error('waiting lane active')
    })
    await expect(service.retryMessage('s1', 'm1')).rejects.toThrow('waiting lane active')

    expect(messageStore.getMessage).not.toHaveBeenCalled()
  })

  it('validates retry ownership and source input before truncating history', async () => {
    messageStore.getMessage.mockReturnValueOnce(null)
    await expect(service.retryMessage('s1', 'missing')).rejects.toThrow('Message missing not found')

    messageStore.getMessage.mockReturnValueOnce(createMessage({ sessionId: 'other' }))
    await expect(service.retryMessage('s1', 'user-1')).rejects.toThrow(
      'Message user-1 does not belong to session s1'
    )

    messageStore.getMessage.mockReturnValueOnce(
      createMessage({ id: 'assistant-1', role: 'assistant' })
    )
    messageStore.getLastUserMessageBeforeOrAt.mockReturnValueOnce(null)
    await expect(service.retryMessage('s1', 'assistant-1')).rejects.toThrow(
      'No user message found for retry.'
    )

    messageStore.getMessage.mockReturnValueOnce(
      createMessage({ content: JSON.stringify({ text: '   ', files: [] }) })
    )
    await expect(service.retryMessage('s1', 'user-1')).rejects.toThrow(
      'Cannot retry an empty user message.'
    )

    expect(messageStore.deleteFromOrderSeq).not.toHaveBeenCalled()
    expect(runtime.processMessage).not.toHaveBeenCalled()
  })

  it('cancels, invalidates, and truncates when deleting history', async () => {
    messageStore.getMessage.mockReturnValue(createMessage({ id: 'm3', orderSeq: 3 }))

    await service.deleteMessage('s1', 'm3')

    expect(runtime.cancelGeneration).toHaveBeenCalledWith('s1')
    expect(runtime.invalidateSummaryIfNeeded).toHaveBeenCalledWith('s1', 3)
    expect(runtime.invalidateMemoryExtractionFromOrderSeq).toHaveBeenCalledWith('s1', 3)
    expect(messageStore.deleteFromOrderSeq).toHaveBeenCalledWith('s1', 3)
    expect(runtime.setSessionStatus).toHaveBeenCalledWith('s1', 'idle')
    expectCalledBefore(runtime.cancelGeneration, runtime.invalidateSummaryIfNeeded)
    expectCalledBefore(
      runtime.invalidateSummaryIfNeeded,
      runtime.invalidateMemoryExtractionFromOrderSeq
    )
    expectCalledBefore(
      runtime.invalidateMemoryExtractionFromOrderSeq,
      messageStore.deleteFromOrderSeq
    )
    expectCalledBefore(messageStore.deleteFromOrderSeq, runtime.setSessionStatus)
  })

  it('runs the pending-input guard before delete lookup', async () => {
    runtime.assertNoActiveInputs.mockImplementation(() => {
      throw new Error('waiting lane active')
    })

    await expect(service.deleteMessage('s1', 'm1')).rejects.toThrow('waiting lane active')
    expect(messageStore.getMessage).not.toHaveBeenCalled()
    expect(runtime.cancelGeneration).not.toHaveBeenCalled()
  })

  it('edits user content while preserving attachments and removing inline items', async () => {
    const target = createMessage({
      content: JSON.stringify({
        text: 'old',
        files: [{ path: '/tmp/a.txt' }],
        links: [{ url: 'https://example.com' }],
        search: true,
        think: true,
        inlineItems: [{ type: 'text', content: 'old' }],
        content: [
          { type: 'image', content: 'image-data' },
          { type: 'text', content: 'old' },
          { type: 'text', content: 'second' }
        ]
      })
    })
    const updated = createMessage({ content: 'updated-content' })
    messageStore.getMessage.mockReturnValueOnce(target).mockReturnValueOnce(updated)

    await expect(service.editUserMessage('s1', 'user-1', '  new text  ')).resolves.toBe(updated)

    const serialized = messageStore.updateMessageContent.mock.calls[0][1]
    expect(JSON.parse(serialized)).toEqual({
      text: 'new text',
      files: [{ path: '/tmp/a.txt' }],
      links: [{ url: 'https://example.com' }],
      search: true,
      think: true,
      content: [
        { type: 'image', content: 'image-data' },
        { type: 'text', content: 'new text' },
        { type: 'text', content: 'second' }
      ]
    })
    expect(runtime.invalidateSummaryIfNeeded).toHaveBeenCalledWith('s1', 3)
    expect(runtime.invalidateMemoryExtractionFromOrderSeq).toHaveBeenCalledWith('s1', 3)
    expect(runtime.cancelGeneration).not.toHaveBeenCalled()
  })

  it('validates user edits before mutating content', async () => {
    messageStore.getMessage.mockReturnValueOnce(createMessage({ role: 'assistant' }))
    await expect(service.editUserMessage('s1', 'assistant-1', 'new')).rejects.toThrow(
      'Only user messages can be edited.'
    )

    messageStore.getMessage.mockReturnValueOnce(createMessage())
    await expect(service.editUserMessage('s1', 'user-1', '   ')).rejects.toThrow(
      'Edited message cannot be empty.'
    )

    expect(messageStore.updateMessageContent).not.toHaveBeenCalled()
  })

  it('clones sent history through the selected message and resets the target summary', async () => {
    messageStore.getMessage.mockReturnValue(createMessage({ id: 'm5', orderSeq: 5 }))

    await service.forkSessionFromMessage('s1', 's2', 'm5')

    expect(messageStore.cloneSentMessagesToSession).toHaveBeenCalledWith('s1', 's2', 5)
    expect(runtime.resetSummaryState).toHaveBeenCalledWith('s2')
    expect(runtime.cancelGeneration).not.toHaveBeenCalled()
    expect(runtime.assertNoActiveInputs).not.toHaveBeenCalled()
  })
})
