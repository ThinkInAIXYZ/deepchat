import { describe, expect, it } from 'vitest'
import type { ChatMessageRecord } from '@shared/types/agent-interface'
import {
  projectTapeInspectorAssistantActivities,
  projectTapeInspectorMessagePreview,
  selectTapeInspectorRequestContext
} from '@/components/tape-inspector/messagePreview'

function message(
  role: ChatMessageRecord['role'],
  content: unknown,
  overrides: Partial<ChatMessageRecord> = {}
): ChatMessageRecord {
  return {
    id: 'message-1',
    sessionId: 'session-1',
    orderSeq: 1,
    role,
    content: typeof content === 'string' ? content : JSON.stringify(content),
    status: 'sent',
    isContextEdge: 0,
    metadata: '{}',
    createdAt: 100,
    updatedAt: 100,
    ...overrides
  }
}

describe('Tape Inspector message preview', () => {
  it('projects the same visible text represented by a user message', () => {
    const preview = projectTapeInspectorMessagePreview(
      message('user', {
        text: 'Forecast ',
        inlineItems: [{ type: 'file', offset: 9, fileName: 'sales.csv', filePath: '/sales.csv' }]
      })
    )

    expect(preview).toEqual({ role: 'user', text: 'Forecast sales.csv' })
  })

  it('includes assistant content while excluding reasoning, errors, and tool payloads', () => {
    const preview = projectTapeInspectorMessagePreview(
      message('assistant', [
        {
          type: 'reasoning_content',
          status: 'success',
          timestamp: 1,
          content: 'private reasoning'
        },
        { type: 'content', status: 'success', timestamp: 2, content: 'Visible answer' },
        { type: 'error', status: 'error', timestamp: 3, content: 'provider token abc' },
        {
          type: 'tool_call',
          status: 'success',
          timestamp: 4,
          tool_call: { name: 'query', params: '{"secret":true}', response: 'secret result' }
        }
      ])
    )

    expect(preview).toEqual({ role: 'assistant', text: 'Visible answer' })
  })

  it('fails closed for malformed or non-visible content', () => {
    expect(projectTapeInspectorMessagePreview(message('user', '{broken'))).toBeNull()
    expect(
      projectTapeInspectorMessagePreview(
        message('assistant', [
          { type: 'reasoning_content', status: 'success', timestamp: 1, content: 'hidden' }
        ])
      )
    ).toBeNull()
  })

  it('compacts and bounds long previews without splitting a surrogate pair', () => {
    const preview = projectTapeInspectorMessagePreview(
      message('user', { text: `${'word '.repeat(43)}😀${' tail'.repeat(100)}` })
    )

    expect(preview?.text.length).toBeLessThanOrEqual(221)
    expect(preview?.text.endsWith('…')).toBe(true)
    expect(preview?.text).not.toContain('\uFFFD')
    expect(preview?.text).not.toMatch(/[\uD800-\uDBFF]…$/u)
  })

  it('selects the latest visible block before a model request instead of the final message', () => {
    const assistant = message('assistant', [
      { type: 'content', status: 'success', timestamp: 150, content: 'First answer' },
      {
        id: 'tool-1',
        type: 'tool_call',
        status: 'success',
        timestamp: 250,
        tool_call: { server_name: 'files', name: 'read_file', response: 'private result' }
      },
      { type: 'reasoning_content', status: 'success', timestamp: 275, content: 'private' },
      { type: 'content', status: 'success', timestamp: 300, content: 'Ambiguous same tick' },
      { type: 'content', status: 'success', timestamp: 350, content: 'Final answer' }
    ])

    const context = selectTapeInspectorRequestContext({
      activities: projectTapeInspectorAssistantActivities(assistant),
      before: 300
    })

    expect(context.map(({ kind, preview }) => ({ kind, preview }))).toEqual([
      { kind: 'tool', preview: 'files / read_file' },
      { kind: 'assistant', preview: 'First answer' }
    ])
    expect(context.map((activity) => activity.preview)).not.toContain('Final answer')
    expect(context.map((activity) => activity.preview)).not.toContain('Ambiguous same tick')
    expect(context.map((activity) => activity.text)).not.toContain('private result')
  })

  it('uses the preceding user message when no assistant block predates the request', () => {
    const assistant = message(
      'assistant',
      [{ type: 'content', status: 'success', timestamp: 350, content: 'Later answer' }],
      { id: 'assistant-1', orderSeq: 2 }
    )
    const user = message('user', { text: 'Start this task' }, { id: 'user-1', orderSeq: 1 })

    expect(
      selectTapeInspectorRequestContext({
        activities: projectTapeInspectorAssistantActivities(assistant),
        before: 300,
        precedingUser: user
      })
    ).toMatchObject([{ kind: 'user', preview: 'Start this task' }])
    expect(
      selectTapeInspectorRequestContext({
        activities: [],
        before: 300,
        precedingUser: { ...user, createdAt: 300 }
      })
    ).toEqual([])
  })
})
