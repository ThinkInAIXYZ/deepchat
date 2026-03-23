import { beforeEach, describe, expect, it, vi } from 'vitest'
import { LLMEventHandler } from '@/presenter/agentPresenter/streaming/llmEventHandler'
import type { AgentSessionRuntimePort } from '@/presenter/agentPresenter/session/sessionRuntimePort'
import type { MessageManager } from '@/presenter/sessionPresenter/managers/messageManager'
import type { GeneratingMessageState } from '@/presenter/agentPresenter/streaming/types'

const eventBusMock = vi.hoisted(() => ({
  sendToRenderer: vi.fn(),
  sendToMain: vi.fn()
}))

vi.mock('@/eventbus', () => ({
  eventBus: eventBusMock,
  SendTarget: {
    ALL_WINDOWS: 'ALL_WINDOWS'
  }
}))

function createState(eventId: string, blocks: any[] = []): GeneratingMessageState {
  return {
    message: {
      id: eventId,
      conversationId: 'conv-1',
      parentId: 'user-1',
      is_variant: false,
      content: blocks
    } as any,
    conversationId: 'conv-1',
    startTime: Date.now(),
    firstTokenTime: null,
    promptTokens: 0,
    reasoningStartTime: null,
    reasoningEndTime: null,
    lastReasoningTime: null
  }
}

function createHandler(state: GeneratingMessageState) {
  const generatingMessages = new Map([[state.message.id, state]])
  const messageManager = {
    updateMessageMetadata: vi.fn().mockResolvedValue(undefined),
    handleMessageError: vi.fn().mockResolvedValue(undefined),
    getMessage: vi.fn().mockResolvedValue(state.message),
    updateMessageStatus: vi.fn().mockResolvedValue(undefined),
    editMessage: vi.fn().mockResolvedValue(undefined)
  } as unknown as MessageManager
  const sessionRuntime = {
    incrementToolCallCount: vi.fn(),
    addPendingPermission: vi.fn(),
    setStatus: vi.fn(),
    updateRuntime: vi.fn(),
    clearPendingPermission: vi.fn(),
    clearPendingQuestion: vi.fn()
  } as unknown as AgentSessionRuntimePort
  const handler = new LLMEventHandler({
    generatingMessages,
    messageManager,
    contentBufferHandler: {
      cleanupContentBuffer: vi.fn(),
      flushAdaptiveBuffer: vi.fn().mockResolvedValue(undefined)
    } as any,
    toolCallHandler: {
      processToolCallStart: vi.fn().mockResolvedValue(undefined),
      processToolCallUpdate: vi.fn().mockResolvedValue(undefined),
      processToolCallPermission: vi.fn().mockResolvedValue(undefined),
      processQuestionRequest: vi.fn().mockResolvedValue(undefined),
      processToolCallError: vi.fn().mockResolvedValue(undefined),
      processToolCallEnd: vi.fn().mockResolvedValue(undefined),
      processSearchResultsFromToolCall: vi.fn().mockResolvedValue(undefined),
      processMcpUiResourcesFromToolCall: vi.fn().mockResolvedValue(undefined)
    } as any,
    streamUpdateScheduler: {
      enqueueDelta: vi.fn(),
      flushAll: vi.fn().mockResolvedValue(undefined)
    } as any,
    sessionRuntime
  })

  return {
    handler,
    generatingMessages,
    messageManager,
    sessionRuntime
  }
}

describe('LLMEventHandler session runtime wiring', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('stores pending permissions through injected session runtime', async () => {
    const state = createState('evt-permission')
    const { handler, sessionRuntime } = createHandler(state)

    await handler.handleLLMAgentResponse({
      eventId: state.message.id,
      tool_call: 'permission-required',
      tool_call_id: 'tool-1',
      permission_request: {
        permissionType: 'write'
      }
    } as any)

    expect(sessionRuntime.addPendingPermission).toHaveBeenCalledWith('conv-1', {
      messageId: state.message.id,
      toolCallId: 'tool-1',
      permissionType: 'write',
      payload: {
        permissionType: 'write'
      }
    })
    expect(sessionRuntime.setStatus).toHaveBeenCalledWith('conv-1', 'waiting_permission')
  })

  it('stores pending question through injected session runtime', async () => {
    const state = createState('evt-question')
    const { handler, sessionRuntime } = createHandler(state)

    await handler.handleLLMAgentResponse({
      eventId: state.message.id,
      tool_call: 'question-required',
      tool_call_id: 'tool-2'
    } as any)

    expect(sessionRuntime.updateRuntime).toHaveBeenCalledWith('conv-1', {
      pendingQuestion: {
        messageId: state.message.id,
        toolCallId: 'tool-2'
      }
    })
    expect(sessionRuntime.setStatus).toHaveBeenCalledWith('conv-1', 'waiting_question')
  })

  it('marks runtime as error through injected session runtime', async () => {
    const state = createState('evt-error')
    const { handler, generatingMessages, messageManager, sessionRuntime } = createHandler(state)

    await handler.handleLLMAgentError({
      eventId: state.message.id,
      error: 'boom'
    } as any)

    expect(messageManager.handleMessageError).toHaveBeenCalledWith(state.message.id, 'boom')
    expect(sessionRuntime.setStatus).toHaveBeenCalledWith('conv-1', 'error')
    expect(sessionRuntime.clearPendingPermission).toHaveBeenCalledWith('conv-1')
    expect(sessionRuntime.clearPendingQuestion).toHaveBeenCalledWith('conv-1')
    expect(generatingMessages.has(state.message.id)).toBe(false)
  })

  it('keeps waiting question status on end when pending question remains', async () => {
    const state = createState('evt-end', [
      {
        type: 'action',
        action_type: 'question_request',
        status: 'pending',
        timestamp: Date.now(),
        content: 'Need answer',
        tool_call: { id: 'tool-3', name: 'question', params: '{}' }
      }
    ])
    const { handler, messageManager, sessionRuntime } = createHandler(state)

    await handler.handleLLMAgentEnd({
      eventId: state.message.id
    } as any)

    expect(messageManager.updateMessageStatus).toHaveBeenCalledWith(state.message.id, 'sent')
    expect(sessionRuntime.setStatus).toHaveBeenCalledWith('conv-1', 'waiting_permission')
    expect(sessionRuntime.setStatus).toHaveBeenCalledWith('conv-1', 'waiting_question')
  })
})
