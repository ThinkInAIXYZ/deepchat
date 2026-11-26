import { effectScope, nextTick, ref, shallowReactive } from 'vue'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useToolInteraction } from '@/features/chat-page/composables/useToolInteraction'
import { createDeferred } from '../../../utils/deferred'

function createAssistantMessage(id: string, blocks: unknown[], status = 'pending') {
  return {
    id,
    sessionId: 's1',
    role: 'assistant',
    status,
    content: JSON.stringify(blocks)
  }
}

function createHarness(
  messages: Array<Record<string, unknown>>,
  onResponseFailed?: any,
  interactionState = {
    acknowledgedInteractions: shallowReactive(new Map()),
    inFlightInteractions: shallowReactive(new Map())
  }
) {
  const sessionId = ref('s1')
  const sessionKind = ref('regular')
  const messageRecords = ref(messages)
  const messageStore = {
    ...interactionState,
    get committedSession() {
      return { id: sessionId.value, sessionKind: sessionKind.value }
    },
    get messages() {
      return messageRecords.value
    },
    getAssistantMessageBlocks: vi.fn((message: { content: string }) => JSON.parse(message.content))
  }
  const chatClient = {
    respondToolInteraction: vi.fn().mockResolvedValue({ handledInline: false })
  }
  const loadMessagesForSession = vi.fn().mockResolvedValue({ id: 'restored' })
  const applyRestoredSessionSummary = vi.fn()
  const restoreRequestId = ref(0)
  const canWriteSessionView = vi.fn(
    (id: string, requestId: number) =>
      id === sessionId.value && requestId === restoreRequestId.value
  )
  const scope = effectScope()
  let toolInteraction!: ReturnType<typeof useToolInteraction>

  scope.run(() => {
    toolInteraction = useToolInteraction({
      sessionId: () => sessionId.value,
      messageStore: messageStore as any,
      chatClient,
      loadMessagesForSession,
      applyRestoredSessionSummary,
      currentRestoreRequestId: () => restoreRequestId.value,
      canWriteSessionView,
      ...(onResponseFailed ? { onResponseFailed } : {})
    })
  })

  return {
    toolInteraction,
    interactionState,
    sessionKind,
    sessionId,
    messageRecords,
    chatClient,
    loadMessagesForSession,
    applyRestoredSessionSummary,
    restoreRequestId,
    canWriteSessionView,
    stop: () => scope.stop()
  }
}

describe('useToolInteraction', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('collects eligible top-level and subagent pending interactions only', () => {
    const harness = createHarness([
      createAssistantMessage('m1', [
        {
          type: 'action',
          action_type: 'question_request',
          status: 'pending',
          tool_call: { id: 'question-1', name: 'ask', params: '{"question":"Continue?"}' }
        },
        {
          type: 'action',
          action_type: 'tool_call_permission',
          status: 'pending',
          extra: { needsUserAction: false },
          tool_call: { id: 'ignored-user-action', name: 'write', params: '{}' }
        },
        {
          type: 'action',
          action_type: 'question_request',
          status: 'success',
          tool_call: { id: 'ignored-status', name: 'ask', params: '{}' }
        },
        {
          type: 'tool_call',
          tool_call: { name: 'subagent_orchestrator' },
          extra: {
            subagentProgress: JSON.stringify({
              tasks: [
                {
                  sessionId: 'subagent-1',
                  waitingInteraction: {
                    type: 'permission',
                    messageId: 'subagent-message',
                    toolCallId: 'subagent-tool',
                    actionBlock: {
                      type: 'action',
                      action_type: 'tool_call_permission',
                      status: 'pending',
                      tool_call: { name: 'read_file', params: '{"path":"README.md"}' }
                    }
                  }
                }
              ]
            })
          }
        },
        {
          type: 'tool_call',
          tool_call: { name: 'subagent_orchestrator' },
          extra: { subagentProgress: '{invalid json' }
        }
      ])
    ])

    expect(harness.toolInteraction.pendingInteractions.value).toMatchObject([
      {
        sessionId: 's1',
        messageId: 'm1',
        toolCallId: 'question-1',
        actionType: 'question_request',
        toolName: 'ask'
      },
      {
        sessionId: 'subagent-1',
        messageId: 'subagent-message',
        toolCallId: 'subagent-tool',
        actionType: 'tool_call_permission',
        toolName: 'read_file'
      }
    ])
    expect(harness.toolInteraction.activePendingInteraction.value).toBe(
      harness.toolInteraction.pendingInteractions.value[0]
    )
    harness.stop()
  })

  it.each(['parent', 'child'] as const)(
    'keeps the same child approval acknowledged when submitted from %s',
    async (source) => {
      const snapshot = (view: 'parent' | 'child', permissionRequestId: string) => {
        const actionBlock = {
          type: 'action',
          action_type: 'tool_call_permission',
          status: 'pending',
          tool_call: { id: 'shared-call', name: 'agent', params: '{}' },
          extra: { permissionRequestId }
        }
        const waitingInteraction = {
          type: 'permission',
          messageId: 'CM',
          toolCallId: 'shared-call',
          actionBlock
        }
        const progress = {
          type: 'tool_call',
          tool_call: { name: 'subagent_orchestrator' },
          extra: {
            subagentProgress: JSON.stringify({
              tasks: [{ sessionId: 'child', waitingInteraction }]
            })
          }
        }
        const row =
          view === 'child'
            ? createAssistantMessage('CM', [actionBlock])
            : createAssistantMessage('PM', [progress])
        return { ...row, sessionId: view }
      }
      const first = snapshot(source, 'original')
      const other = source === 'parent' ? 'child' : 'parent'
      const harness = createHarness([first])
      harness.sessionId.value = source
      harness.sessionKind.value = source === 'parent' ? 'regular' : 'subagent'
      const allow = { kind: 'permission', granted: true } as const
      harness.chatClient.respondToolInteraction.mockImplementationOnce(async () => {
        // The submitting view can settle before the other projection is refreshed.
        harness.messageRecords.value = [{ ...first, content: '[]', status: 'sent' }]
        return { handledInline: true }
      })
      await harness.toolInteraction.onToolInteractionRespond(allow)
      harness.stop()
      const mirrored = snapshot(other, 'original')
      const next = createHarness([mirrored], undefined, harness.interactionState)
      next.sessionId.value = other
      next.sessionKind.value = other === 'parent' ? 'regular' : 'subagent'
      next.messageRecords.value = [
        mirrored,
        { ...createAssistantMessage('unrelated', [], 'sent'), sessionId: other }
      ]
      await nextTick()
      expect(next.toolInteraction.activePendingInteraction.value).toBeNull()
      await next.toolInteraction.onToolInteractionRespond(allow)
      expect(next.chatClient.respondToolInteraction).not.toHaveBeenCalled()
      next.messageRecords.value = [snapshot(other, 'next')]
      await next.toolInteraction.onToolInteractionRespond(allow)
      expect(next.chatClient.respondToolInteraction).toHaveBeenCalledExactlyOnceWith({
        sessionId: 'child',
        messageId: 'CM',
        toolCallId: 'shared-call',
        response: { ...allow, permissionRequestId: 'next' }
      })
      next.stop()
    }
  )

  it('submits one decision across navigation while the first response is in flight', async () => {
    const response = createDeferred<{ handledInline?: boolean }>()
    const harness = createHarness([
      createAssistantMessage('in-flight', [
        {
          type: 'action',
          action_type: 'tool_call_permission',
          status: 'pending',
          tool_call: { id: 'tool-1', name: 'write_file', params: '{}' }
        }
      ])
    ])
    harness.chatClient.respondToolInteraction.mockReturnValue(response.promise)

    const firstResponse = harness.toolInteraction.onToolInteractionRespond({
      kind: 'permission',
      granted: true
    } as any)
    await vi.waitFor(() => expect(harness.toolInteraction.isHandlingInteraction.value).toBe(true))

    await harness.toolInteraction.onToolInteractionRespond({
      kind: 'permission',
      granted: false
    } as any)
    expect(harness.chatClient.respondToolInteraction).toHaveBeenCalledTimes(1)

    harness.sessionId.value = 's2'
    harness.stop()
    const restored = createHarness(
      harness.messageRecords.value,
      undefined,
      harness.interactionState
    )
    expect(restored.toolInteraction.isHandlingInteraction.value).toBe(true)
    await restored.toolInteraction.onToolInteractionRespond({ kind: 'permission', granted: false })
    expect(restored.chatClient.respondToolInteraction).not.toHaveBeenCalled()

    response.resolve({ handledInline: true })
    await firstResponse

    expect(harness.chatClient.respondToolInteraction).toHaveBeenCalledWith({
      sessionId: 's1',
      messageId: 'in-flight',
      toolCallId: 'tool-1',
      response: { kind: 'permission', granted: true }
    })
    expect(harness.loadMessagesForSession).not.toHaveBeenCalled()
    expect(harness.applyRestoredSessionSummary).not.toHaveBeenCalled()
    expect(restored.toolInteraction.isHandlingInteraction.value).toBe(false)
    expect(restored.toolInteraction.activePendingInteraction.value).toBeNull()
    restored.stop()
  })

  it('ignores an old response after a session is removed and restored with the same IDs', async () => {
    const messages = [
      createAssistantMessage('restored', [
        {
          type: 'action',
          action_type: 'tool_call_permission',
          status: 'pending',
          tool_call: { id: 'tool', name: 'agent', params: '{}' }
        }
      ])
    ]
    const original = createHarness(messages)
    const allow = { kind: 'permission', granted: true } as const
    const first = createDeferred<{ resumed: boolean }>()
    original.chatClient.respondToolInteraction.mockReturnValue(first.promise)
    const oldResponse = original.toolInteraction.onToolInteractionRespond(allow)
    original.stop()
    original.interactionState.inFlightInteractions.clear()
    const restored = createHarness(messages, undefined, original.interactionState)
    const second = createDeferred<{ resumed: boolean }>()
    restored.chatClient.respondToolInteraction.mockReturnValue(second.promise)
    const newResponse = restored.toolInteraction.onToolInteractionRespond(allow)

    first.resolve({ resumed: true })
    await oldResponse
    expect(original.loadMessagesForSession).not.toHaveBeenCalled()
    expect(restored.toolInteraction.isHandlingInteraction.value).toBe(true)
    expect(restored.toolInteraction.activePendingInteraction.value?.toolCallId).toBe('tool')
    second.resolve({ resumed: false })
    await newResponse
    expect(restored.toolInteraction.isHandlingInteraction.value).toBe(false)
    expect(restored.toolInteraction.activePendingInteraction.value?.toolCallId).toBe('tool')
    restored.stop()
  })

  it('keeps an approval retryable when the response fails', async () => {
    const error = new Error('response failed')
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    const harness = createHarness([
      createAssistantMessage('m1', [
        {
          type: 'action',
          action_type: 'tool_call_permission',
          status: 'pending',
          tool_call: { id: 'tool-1', name: 'write_file', params: '{}' }
        }
      ])
    ])
    harness.chatClient.respondToolInteraction.mockRejectedValue(error)

    await harness.toolInteraction.onToolInteractionRespond({
      kind: 'permission',
      granted: true
    } as any)

    expect(harness.loadMessagesForSession).toHaveBeenCalledWith('s1')
    expect(harness.toolInteraction.activePendingInteraction.value?.toolCallId).toBe('tool-1')
    expect(harness.toolInteraction.isHandlingInteraction.value).toBe(false)
    expect(consoleError).toHaveBeenCalledWith('[ChatPage] respond tool interaction failed:', error)
    consoleError.mockRestore()
    harness.stop()
  })

  it('keeps a rejected answer retryable and advances through sibling questions after acceptance', async () => {
    const error = new Error('answer was not accepted')
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    const onResponseFailed = vi.fn()
    const pendingQuestion = {
      type: 'action',
      action_type: 'question_request',
      status: 'pending',
      extra: { dimRequestId: 'request-1' },
      tool_call: { id: 'tool-1', name: 'ask_user', params: '{}' }
    }
    const sibling = {
      ...pendingQuestion,
      tool_call: { ...pendingQuestion.tool_call, id: 'tool-2' }
    }
    const harness = createHarness(
      [createAssistantMessage('m1', [pendingQuestion, sibling])],
      onResponseFailed
    )
    const response = { kind: 'question_option', optionLabel: 'Yes' } as const
    harness.chatClient.respondToolInteraction
      .mockRejectedValueOnce(error)
      .mockResolvedValueOnce({ resumed: true })

    await harness.toolInteraction.onToolInteractionRespond(response)
    expect(onResponseFailed).toHaveBeenCalledWith(
      expect.objectContaining({ actionType: 'question_request' }),
      error
    )
    expect(harness.toolInteraction.activePendingInteraction.value?.toolCallId).toBe('tool-1')
    expect(harness.toolInteraction.isHandlingInteraction.value).toBe(false)

    await harness.toolInteraction.onToolInteractionRespond(response)
    expect(harness.toolInteraction.activePendingInteraction.value?.toolCallId).toBe('tool-2')
    expect(harness.toolInteraction.isHandlingInteraction.value).toBe(false)
    await harness.toolInteraction.onToolInteractionRespond(response)
    expect(harness.chatClient.respondToolInteraction).toHaveBeenCalledTimes(3)
    expect(harness.chatClient.respondToolInteraction).toHaveBeenLastCalledWith(
      expect.objectContaining({ toolCallId: 'tool-2', response })
    )
    expect(harness.toolInteraction.activePendingInteraction.value).toBeNull()

    harness.messageRecords.value = [
      createAssistantMessage(
        'm1',
        [pendingQuestion, sibling].map((block) => ({ ...block, status: 'success' })),
        'sent'
      )
    ]
    await nextTick()
    consoleError.mockRestore()
    harness.stop()
  })

  it.each(['question_request', 'tool_call_permission'] as const)(
    'releases a %s from a replaced scope without declining on the host',
    async (actionType) => {
      const error = new Error(
        "Error invoking remote method 'deepchat:route:invoke': Error: Native interaction belongs to a replaced session scope"
      )
      const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined)
      const onResponseFailed = vi.fn()
      const harness = createHarness(
        [
          createAssistantMessage('m1', [
            {
              type: 'action',
              action_type: actionType,
              status: 'pending',
              extra: actionType === 'question_request' ? { dimRequestId: 'replaced-request' } : {},
              tool_call: {
                id: 'replaced-tool',
                name: actionType === 'question_request' ? 'ask_user' : 'agent',
                params: '{}'
              }
            }
          ])
        ],
        onResponseFailed
      )
      harness.chatClient.respondToolInteraction.mockRejectedValueOnce(error)

      await harness.toolInteraction.onToolInteractionRespond(
        actionType === 'question_request'
          ? { kind: 'question_option', optionLabel: 'Yes' }
          : { kind: 'permission', granted: true }
      )

      expect(onResponseFailed).toHaveBeenCalledWith(expect.objectContaining({ actionType }), error)
      expect(harness.toolInteraction.activePendingInteraction.value).toBeNull()
      expect(harness.toolInteraction.isHandlingInteraction.value).toBe(false)
      consoleError.mockRestore()
      harness.stop()
    }
  )

  it('reports a rejected response to the page instead of only dropping the interaction', async () => {
    const error = new Error('response failed')
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    const onResponseFailed = vi.fn()
    const harness = createHarness(
      [
        createAssistantMessage('m1', [
          {
            type: 'action',
            action_type: 'tool_call_permission',
            status: 'pending',
            tool_call: { id: 'tool-1', name: 'process', params: '{"action":"kill"}' }
          }
        ])
      ],
      onResponseFailed
    )
    harness.chatClient.respondToolInteraction.mockRejectedValue(error)

    await harness.toolInteraction.onToolInteractionRespond({
      kind: 'permission',
      granted: true
    } as any)

    expect(onResponseFailed).toHaveBeenCalledWith(
      expect.objectContaining({ messageId: 'm1', toolCallId: 'tool-1' }),
      error
    )
    consoleError.mockRestore()
    harness.stop()
  })

  it('retries an unacknowledged Allow in its owning session and advances once acknowledged', async () => {
    const harness = createHarness([
      createAssistantMessage('delegation', [
        {
          type: 'action',
          action_type: 'tool_call_permission',
          status: 'pending',
          extra: { permissionRequestId: 'acp-request' },
          tool_call: { id: 'tool-1', name: 'agent', params: '{}' }
        }
      ]),
      createAssistantMessage('m2', [
        {
          type: 'action',
          action_type: 'question_request',
          status: 'pending',
          tool_call: { id: 'tool-2', name: 'ask', params: '{}' }
        }
      ])
    ])
    harness.chatClient.respondToolInteraction
      .mockResolvedValueOnce({ resumed: false })
      .mockResolvedValueOnce({ resumed: true })
    const allow = { kind: 'permission', granted: true } as const

    harness.sessionId.value = 's2'
    expect(harness.toolInteraction.activePendingInteraction.value).toBeNull()
    harness.sessionId.value = 's1'
    await harness.toolInteraction.onToolInteractionRespond(allow)
    expect(harness.loadMessagesForSession).toHaveBeenCalledWith('s1')
    expect(harness.toolInteraction.activePendingInteraction.value?.toolCallId).toBe('tool-1')
    await harness.toolInteraction.onToolInteractionRespond(allow)
    expect(harness.chatClient.respondToolInteraction).toHaveBeenCalledTimes(2)
    expect(harness.chatClient.respondToolInteraction).toHaveBeenLastCalledWith({
      sessionId: 's1',
      messageId: 'delegation',
      toolCallId: 'tool-1',
      response: { ...allow, permissionRequestId: 'acp-request' }
    })
    expect(harness.toolInteraction.pendingInteractions.value).toMatchObject([
      { messageId: 'm2', toolCallId: 'tool-2', actionType: 'question_request' }
    ])
    expect(harness.toolInteraction.activePendingInteraction.value).toMatchObject({
      messageId: 'm2',
      toolCallId: 'tool-2'
    })
    harness.stop()
  })

  it('keeps a responded interaction when the main process resolved its block', async () => {
    const harness = createHarness([
      createAssistantMessage('m1', [
        {
          type: 'action',
          action_type: 'tool_call_permission',
          status: 'pending',
          tool_call: { id: 'tool-1', name: 'write_file', params: '{}' }
        }
      ])
    ])
    harness.chatClient.respondToolInteraction.mockResolvedValue({ resumed: true })
    // Simulate the main process persisting a resolved block before the reload.
    harness.loadMessagesForSession.mockImplementation(async () => {
      harness.messageRecords.value = [
        createAssistantMessage('m1', [
          {
            type: 'action',
            action_type: 'tool_call_permission',
            status: 'granted',
            extra: { needsUserAction: false },
            tool_call: { id: 'tool-1', name: 'write_file', params: '{}' }
          }
        ])
      ]
      return { id: 'restored' }
    })

    await harness.toolInteraction.onToolInteractionRespond({
      kind: 'permission',
      granted: true
    } as any)

    expect(harness.toolInteraction.pendingInteractions.value).toEqual([])
    expect(harness.toolInteraction.activePendingInteraction.value).toBeNull()
    expect(harness.loadMessagesForSession).toHaveBeenCalledWith('s1')
    harness.stop()
  })
})
