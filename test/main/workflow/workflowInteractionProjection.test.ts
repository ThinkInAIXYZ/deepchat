import { describe, expect, it, vi } from 'vitest'
import type { ChatMessageRecord } from '@shared/types/agent-interface'
import { WORKFLOW_WAITING_INTERACTIONS_MAX_ITEMS } from '@shared/workflow/projection'
import { projectWorkflowWaitingInteractions } from '@/workflow/interactionProjection'

function assistantMessage(id: string, orderSeq: number, blocks: unknown[]): ChatMessageRecord {
  return {
    id,
    sessionId: 'child-1',
    orderSeq,
    role: 'assistant',
    content: JSON.stringify(blocks),
    status: 'sent',
    isContextEdge: 0,
    metadata: '{}',
    createdAt: orderSeq,
    updatedAt: orderSeq
  }
}

describe('workflow waiting interaction projection', () => {
  it('projects only bounded pending permission and question facts from the latest child page', () => {
    const listMessagesPage = vi.fn(() => ({
      messages: [
        assistantMessage('message-1', 1, [
          {
            type: 'action',
            status: 'pending',
            timestamp: 1,
            action_type: 'tool_call_permission',
            tool_call: {
              id: 'permission-1',
              name: 'write_file',
              params: 'private args must not be projected'
            },
            extra: {
              needsUserAction: true,
              permissionRequest: 'Allow the child to update this file?'
            }
          }
        ]),
        assistantMessage('message-2', 2, [
          {
            type: 'action',
            status: 'pending',
            timestamp: 2,
            action_type: 'question_request',
            tool_call: {
              id: 'question-1',
              name: 'ask_user'
            },
            extra: {
              needsUserAction: true,
              questionText: 'Which implementation should be used?'
            }
          },
          {
            type: 'action',
            status: 'success',
            timestamp: 2,
            action_type: 'question_request',
            tool_call: {
              id: 'resolved-question'
            }
          }
        ])
      ],
      nextCursor: null,
      hasMore: true
    }))

    const projected = projectWorkflowWaitingInteractions({ listMessagesPage }, 'child-1')

    expect(listMessagesPage).toHaveBeenCalledWith('child-1', { limit: 100 })
    expect(projected).toEqual([
      {
        kind: 'question',
        messageId: 'message-2',
        toolCallId: 'question-1',
        toolName: 'ask_user',
        label: 'Which implementation should be used?'
      },
      {
        kind: 'permission',
        messageId: 'message-1',
        toolCallId: 'permission-1',
        toolName: 'write_file',
        label: 'Allow the child to update this file?'
      }
    ])
    expect(JSON.stringify(projected)).not.toContain('private args')
  })

  it('fails closed on malformed transcript blocks and invalid identifiers', () => {
    const projected = projectWorkflowWaitingInteractions(
      {
        listMessagesPage: () => ({
          messages: [
            {
              ...assistantMessage('message-1', 1, []),
              content: 'not-json'
            },
            assistantMessage('message-2', 2, [
              null,
              'invalid block',
              {
                type: 'action',
                status: 'pending',
                timestamp: 2,
                action_type: 'tool_call_permission',
                tool_call: {
                  id: 'x'.repeat(300),
                  name: 'write_file'
                }
              }
            ])
          ],
          nextCursor: null,
          hasMore: false
        })
      },
      'child-1'
    )

    expect(projected).toEqual([])
  })

  it('caps interaction summaries at the shared projection limit', () => {
    const projected = projectWorkflowWaitingInteractions(
      {
        listMessagesPage: () => ({
          messages: [
            assistantMessage(
              'message-1',
              1,
              Array.from({ length: WORKFLOW_WAITING_INTERACTIONS_MAX_ITEMS + 8 }, (_, index) => ({
                type: 'action',
                status: 'pending',
                timestamp: index,
                action_type: 'question_request',
                tool_call: {
                  id: `question-${index}`,
                  name: 'ask_user'
                }
              }))
            )
          ],
          nextCursor: null,
          hasMore: false
        })
      },
      'child-1'
    )

    expect(projected).toHaveLength(WORKFLOW_WAITING_INTERACTIONS_MAX_ITEMS)
  })
})
