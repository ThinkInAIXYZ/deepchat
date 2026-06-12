import { describe, expect, it } from 'vitest'
import {
  buildTelegramFinalText,
  chunkTelegramText,
  extractTelegramDraftText,
  extractTelegramStreamText,
  shouldSendTelegramDraft
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

  it('keeps pending approval content without appending desktop confirmation notice', () => {
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
    expect(text).not.toContain('Desktop confirmation is required')
  })

  it('skips drafts for reasoning and action-only blocks', () => {
    const blocks = [
      {
        type: 'reasoning_content' as const,
        content: 'hidden reasoning',
        status: 'success' as const,
        timestamp: 1
      },
      {
        type: 'action' as const,
        action_type: 'question_request' as const,
        content: 'Need your answer',
        status: 'pending' as const,
        timestamp: 2,
        extra: {
          needsUserAction: true
        }
      }
    ]

    expect(extractTelegramDraftText(blocks)).toBe('')
    expect(shouldSendTelegramDraft(blocks)).toBe(false)
    expect(buildTelegramFinalText(blocks)).toContain('Need your answer')
  })

  it('chunks long text within the Telegram limit', () => {
    const chunks = chunkTelegramText('A'.repeat(25), 10)

    expect(chunks).toHaveLength(3)
    expect(chunks.every((chunk) => chunk.length <= 10)).toBe(true)
  })
})
