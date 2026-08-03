import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  buildAssistantDeliverySegments,
  buildAssistantResponseMarkdown,
  extractWaitingInteraction
} from '@/agent/deepchat/runtime/sessionUpdates'
import { SessionRuntimeEvents } from '@/session/runtimeEvents'
import {
  projectFinalAnswerFromDeliverySegments,
  projectFinalAssistantAnswer
} from '@shared/lib/assistantDeliverySegments'

describe('SessionRuntimeEvents', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('isolates listener failures', () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})
    const events = new SessionRuntimeEvents()
    const unsubscribe = events.subscribe(() => {
      throw new Error('listener failed')
    })

    try {
      expect(() =>
        events.publish({
          sessionId: 'session-1',
          kind: 'status',
          status: 'idle',
          updatedAt: Date.now()
        })
      ).not.toThrow()

      expect(consoleError).toHaveBeenCalledWith(
        '[SessionRuntimeEvents] Failed to publish session update:',
        expect.any(Error)
      )
    } finally {
      unsubscribe()
    }
  })

  it('returns the earliest pending waiting interaction', () => {
    const waitingInteraction = extractWaitingInteraction(
      [
        {
          type: 'tool_call',
          status: 'pending',
          timestamp: 1,
          tool_call: { id: 'tc1', name: 'ask_one', params: '{}', response: '' }
        },
        {
          type: 'action',
          action_type: 'question_request',
          status: 'pending',
          timestamp: 2,
          content: 'First',
          tool_call: { id: 'tc1', name: 'ask_one', params: '{}' },
          extra: { needsUserAction: true, questionText: 'First' }
        },
        {
          type: 'tool_call',
          status: 'pending',
          timestamp: 3,
          tool_call: { id: 'tc2', name: 'ask_two', params: '{}', response: '' }
        },
        {
          type: 'action',
          action_type: 'question_request',
          status: 'pending',
          timestamp: 4,
          content: 'Second',
          tool_call: { id: 'tc2', name: 'ask_two', params: '{}' },
          extra: { needsUserAction: true, questionText: 'Second' }
        }
      ],
      'message-1'
    )

    expect(waitingInteraction).toEqual({
      type: 'question',
      messageId: 'message-1',
      toolCallId: 'tc1',
      actionBlock: {
        type: 'action',
        action_type: 'question_request',
        status: 'pending',
        timestamp: 2,
        content: 'First',
        tool_call: { id: 'tc1', name: 'ask_one', params: '{}' },
        extra: { needsUserAction: true, questionText: 'First' }
      }
    })
  })

  it('preserves indentation and blank lines in assistant response markdown', () => {
    const responseMarkdown = buildAssistantResponseMarkdown([
      {
        type: 'content',
        status: 'success',
        timestamp: 1,
        content: ['```yaml', 'items:', '  - name: foo', '', '  - name: bar', '```'].join('\n')
      }
    ])

    expect(responseMarkdown).toBe(
      ['```yaml', 'items:', '  - name: foo', '', '  - name: bar', '```'].join('\n')
    )
  })

  it('builds remote delivery segments from assistant blocks', () => {
    const segments = buildAssistantDeliverySegments('message-1', [
      {
        type: 'tool_call',
        status: 'success',
        timestamp: 1,
        tool_call: {
          id: 'tool-1',
          name: 'read_file',
          params: '{"path":"/tmp/a.md"}'
        },
        extra: {
          toolCallArgsComplete: true
        }
      },
      {
        type: 'content',
        status: 'success',
        timestamp: 2,
        content: 'Final answer'
      }
    ])

    expect(segments).toEqual([
      expect.objectContaining({
        kind: 'process',
        text: expect.stringContaining('read_file')
      }),
      expect.objectContaining({
        kind: 'answer',
        text: 'Final answer'
      })
    ])
  })

  it('projects only the trailing answer after process blocks', () => {
    const answer = projectFinalAssistantAnswer([
      {
        type: 'content',
        status: 'success',
        timestamp: 1,
        content: 'I will inspect the repository first.'
      },
      {
        type: 'tool_call',
        status: 'success',
        timestamp: 2,
        tool_call: {
          id: 'tool-1',
          name: 'exec',
          params: '{"command":"inspect"}',
          response: 'large process output that must not become the result'.repeat(4_096)
        },
        extra: { toolCallArgsComplete: true }
      },
      {
        type: 'content',
        status: 'success',
        timestamp: 3,
        content: '## Handoff\nThe final conclusion.'
      }
    ])

    expect(answer).toBe('## Handoff\nThe final conclusion.')
    expect(
      projectFinalAnswerFromDeliverySegments([
        {
          key: 'answer',
          kind: 'answer',
          text: 'I will inspect first.',
          sourceMessageId: 'message-1'
        },
        {
          key: 'process',
          kind: 'process',
          text: 'exec: inspect',
          sourceMessageId: 'message-1'
        }
      ])
    ).toBe('')
  })
})
