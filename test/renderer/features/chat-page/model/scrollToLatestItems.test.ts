import { describe, expect, it } from 'vitest'
import { buildScrollToLatestItems } from '@/features/chat-page/model/scrollToLatestItems'
import type { DisplayMessage } from '@/features/chat-page/model/displayMessage'

function userMessage(id: string, text: string): DisplayMessage {
  return {
    id,
    role: 'user',
    status: 'sent',
    content: { files: [], links: [], think: false, search: false, text }
  } as unknown as DisplayMessage
}

function assistantMessage(
  id: string,
  text: string,
  status: 'pending' | 'success' | 'error' = 'success'
) {
  return {
    id,
    role: 'assistant',
    status: status === 'error' ? 'error' : 'sent',
    content: [{ type: 'content', content: text, status, timestamp: 1 }]
  } as unknown as DisplayMessage
}

describe('buildScrollToLatestItems', () => {
  it('projects role and text for each pending message, oldest first', () => {
    const items = buildScrollToLatestItems({
      messages: [userMessage('m1', 'first question'), assistantMessage('m2', 'first answer')],
      streamingMessageId: null
    })

    expect(items).toEqual([
      { id: 'm1', role: 'user', text: 'first question', streaming: false, failed: false },
      { id: 'm2', role: 'assistant', text: 'first answer', streaming: false, failed: false }
    ])
  })

  it('marks the streaming and failed rows', () => {
    const items = buildScrollToLatestItems({
      messages: [
        assistantMessage('m1', 'growing', 'pending'),
        assistantMessage('m2', 'boom', 'error')
      ],
      streamingMessageId: 'm1'
    })

    expect(items[0]).toMatchObject({ id: 'm1', streaming: true, failed: false })
    expect(items[1]).toMatchObject({ id: 'm2', streaming: false, failed: true })
  })

  it('lists the reply that is still being generated', () => {
    // The generating row is an optimistic placeholder. Hiding it meant the newest message — the one
    // the user just triggered — never showed up in the preview.
    const items = buildScrollToLatestItems({
      messages: [
        assistantMessage('m8', 'earlier answer'),
        assistantMessage('__pending_assistant_1700000000000_ab', 'partial answer')
      ],
      streamingMessageId: '__pending_assistant_1700000000000_ab'
    })

    expect(items.map((item) => item.id)).toEqual(['m8', '__pending_assistant_1700000000000_ab'])
    expect(items[1]).toMatchObject({ streaming: true, text: 'partial answer' })
  })

  it('keeps the newest rows when the pending set exceeds the limit', () => {
    const messages = Array.from({ length: 120 }, (_, index) =>
      userMessage(`m${index}`, `text ${index}`)
    )

    const items = buildScrollToLatestItems({ messages, streamingMessageId: null, limit: 50 })

    expect(items).toHaveLength(50)
    expect(items[0]?.id).toBe('m70')
    expect(items.at(-1)?.id).toBe('m119')
  })

  it('truncates long previews', () => {
    const items = buildScrollToLatestItems({
      messages: [userMessage('m1', 'x'.repeat(500))],
      streamingMessageId: null
    })

    expect(items[0]?.text).toHaveLength(141)
    expect(items[0]?.text.endsWith('…')).toBe(true)
  })
})
