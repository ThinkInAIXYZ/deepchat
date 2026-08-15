import { describe, expect, it } from 'vitest'
import type { ChatMessageRecord } from '@shared/types/agent-interface'
import { projectTapeInspectorMessagePreview } from '@/components/tape-inspector/messagePreview'

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
})
