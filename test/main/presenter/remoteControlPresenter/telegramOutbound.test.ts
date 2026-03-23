import { describe, expect, it } from 'vitest'
import {
  buildTelegramFinalText,
  chunkTelegramText,
  extractTelegramStreamText
} from '@/presenter/remoteControlPresenter/telegram/telegramOutbound'

describe('telegramOutbound', () => {
  it('extracts streaming text from content blocks', () => {
    expect(
      extractTelegramStreamText([
        {
          type: 'content',
          content: 'Hello',
          status: 'success',
          timestamp: 1
        },
        {
          type: 'content',
          content: 'World',
          status: 'success',
          timestamp: 2
        }
      ])
    ).toBe('Hello\n\nWorld')
  })

  it('appends desktop confirmation notice for pending approval blocks', () => {
    const text = buildTelegramFinalText([
      {
        type: 'content',
        content: 'Need your approval',
        status: 'success',
        timestamp: 1
      },
      {
        type: 'action',
        action_type: 'tool_call_permission',
        content: 'Permission requested',
        status: 'pending',
        timestamp: 2,
        extra: {
          needsUserAction: true
        }
      }
    ])

    expect(text).toContain('Need your approval')
    expect(text).toContain('Desktop confirmation is required')
  })

  it('chunks long text within the Telegram limit', () => {
    const chunks = chunkTelegramText('A'.repeat(25), 10)

    expect(chunks).toHaveLength(3)
    expect(chunks.every((chunk) => chunk.length <= 10)).toBe(true)
  })
})
