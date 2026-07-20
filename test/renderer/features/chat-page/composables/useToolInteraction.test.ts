import { computed, effectScope, ref } from 'vue'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useToolInteraction } from '@/features/chat-page/composables/useToolInteraction'
import { createDeferred } from '../../../utils/deferred'

function createAssistantMessage(id: string, blocks: unknown[]) {
  return {
    id,
    role: 'assistant',
    content: JSON.stringify(blocks)
  }
}

function createHarness(messages: Array<Record<string, unknown>>) {
  const sessionId = ref('s1')
  const isReadOnlySession = computed(() => false)
  const messageStore = {
    messages,
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
      isReadOnlySession,
      chatClient,
      loadMessagesForSession,
      applyRestoredSessionSummary,
      currentRestoreRequestId: () => restoreRequestId.value,
      canWriteSessionView
    })
  })

  return {
    toolInteraction,
    sessionId,
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

  it('submits one response at a time and refreshes the current page session afterwards', async () => {
    const response = createDeferred<{ handledInline?: boolean }>()
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
    response.resolve({ handledInline: true })
    await firstResponse

    expect(harness.chatClient.respondToolInteraction).toHaveBeenCalledWith({
      sessionId: 's1',
      messageId: 'm1',
      toolCallId: 'tool-1',
      response: { kind: 'permission', granted: true }
    })
    expect(harness.loadMessagesForSession).not.toHaveBeenCalled()
    expect(harness.applyRestoredSessionSummary).not.toHaveBeenCalled()
    expect(harness.toolInteraction.isHandlingInteraction.value).toBe(false)
    harness.stop()
  })

  it('releases the response lock without refreshing when the client rejects', async () => {
    const error = new Error('response failed')
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    const harness = createHarness([
      createAssistantMessage('m1', [
        {
          type: 'action',
          action_type: 'question_request',
          status: 'pending',
          tool_call: { id: 'tool-1', name: 'question', params: '{}' }
        }
      ])
    ])
    harness.chatClient.respondToolInteraction.mockRejectedValue(error)

    await harness.toolInteraction.onToolInteractionRespond({
      kind: 'permission',
      granted: true
    } as any)

    expect(harness.loadMessagesForSession).not.toHaveBeenCalled()
    expect(harness.toolInteraction.isHandlingInteraction.value).toBe(false)
    expect(consoleError).toHaveBeenCalledWith('[ChatPage] respond tool interaction failed:', error)
    consoleError.mockRestore()
    harness.stop()
  })
})
