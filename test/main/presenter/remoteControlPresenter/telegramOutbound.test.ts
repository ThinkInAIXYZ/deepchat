import { describe, expect, it } from 'vitest'
import {
  buildTelegramFinalText,
  chunkTelegramMarkdownText,
  chunkTelegramText,
  convertMarkdownTablesToCodeBlocks,
  extractTelegramDraftText,
  extractTelegramStreamText,
  shouldSendTelegramDraft,
  stripTelegramHtmlForFallback
} from '@/presenter/remoteControlPresenter/telegram/telegramOutbound'
import { TELEGRAM_OUTBOUND_TEXT_LIMIT } from '@/presenter/remoteControlPresenter/types'

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

  it('formats common markdown as Telegram HTML chunks', () => {
    const chunks = chunkTelegramMarkdownText(
      '# Title\n\n**bold** _italic_ `x < y`\n\n```ts\nconst value = 1 < 2\n```'
    )

    expect(chunks).toHaveLength(1)
    expect(chunks[0]).toEqual(
      expect.objectContaining({
        parseMode: 'HTML'
      })
    )
    expect(chunks[0]?.text).toContain('<b>Title</b>')
    expect(chunks[0]?.text).toContain('<b>bold</b>')
    expect(chunks[0]?.text).toContain('<code>x &lt; y</code>')
    expect(chunks[0]?.text).toContain('<pre><code class="language-ts">')
  })

  it('converts GFM pipe tables to preformatted text before Telegram formatting', () => {
    const markdown = '| Name | Value |\n| --- | ---: |\n| Alpha | 1 |\n| Beta | 22 |'

    expect(convertMarkdownTablesToCodeBlocks(markdown)).toContain('Name  | Value')

    const chunks = chunkTelegramMarkdownText(markdown)
    expect(chunks[0]?.parseMode).toBe('HTML')
    expect(chunks[0]?.text).toContain('<pre><code>')
    expect(chunks[0]?.text).toContain('Name')
    expect(chunks[0]?.text).toContain('Alpha')
  })

  it('keeps complex HTML safe by sending it as escaped text', () => {
    const chunks = chunkTelegramMarkdownText('<div style="color:red">Hi</div><script>x()</script>')

    expect(chunks[0]?.parseMode).toBe('HTML')
    expect(chunks[0]?.text).toContain('&lt;div')
    expect(chunks[0]?.text).toContain('&lt;script&gt;')
    expect(chunks[0]?.text).not.toContain('<script>')
  })

  it('falls back to plain chunks when formatted output cannot be kept within the limit', () => {
    const chunks = chunkTelegramMarkdownText('A'.repeat(TELEGRAM_OUTBOUND_TEXT_LIMIT + 5))

    expect(chunks).toHaveLength(2)
    expect(chunks.every((chunk) => chunk.text.length <= TELEGRAM_OUTBOUND_TEXT_LIMIT)).toBe(true)
    expect(chunks.every((chunk) => chunk.parseMode === undefined)).toBe(true)
  })

  it('strips Telegram HTML into readable fallback text', () => {
    expect(
      stripTelegramHtmlForFallback('<b>Hello</b> <a href="https://example.com">site</a>')
    ).toBe('Hello site (https://example.com)')
  })
})
