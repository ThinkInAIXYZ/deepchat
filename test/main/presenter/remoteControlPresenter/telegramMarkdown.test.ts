import { describe, expect, it } from 'vitest'
import { convertMarkdownToTelegramHtml } from '@/presenter/remoteControlPresenter/telegram/telegramMarkdown'

describe('convertMarkdownToTelegramHtml', () => {
  it('returns an empty string for empty input', () => {
    expect(convertMarkdownToTelegramHtml('')).toBe('')
  })

  it('escapes HTML-sensitive characters in plain text', () => {
    expect(convertMarkdownToTelegramHtml('1 < 2 & 3 > 0')).toBe('1 &lt; 2 &amp; 3 &gt; 0')
  })

  it('converts bold, italic, and strikethrough markers', () => {
    expect(convertMarkdownToTelegramHtml('**bold** _italic_ ~~gone~~')).toBe(
      '<b>bold</b> <i>italic</i> <s>gone</s>'
    )
  })

  it('demotes Markdown headings to bold', () => {
    expect(convertMarkdownToTelegramHtml('# Title')).toBe('<b>Title</b>')
    expect(convertMarkdownToTelegramHtml('### Section')).toBe('<b>Section</b>')
  })

  it('renders inline code with HTML escaping', () => {
    expect(convertMarkdownToTelegramHtml('use `<div>` here')).toBe(
      'use <code>&lt;div&gt;</code> here'
    )
  })

  it('renders fenced code blocks with language class and escapes contents', () => {
    const input = '```ts\nconst a = 1 < 2\n```'
    expect(convertMarkdownToTelegramHtml(input)).toBe(
      '<pre><code class="language-ts">const a = 1 &lt; 2</code></pre>'
    )
  })

  it('renders fenced code blocks without a language as plain <pre>', () => {
    const input = '```\nhello\n```'
    expect(convertMarkdownToTelegramHtml(input)).toBe('<pre>hello</pre>')
  })

  it('renders GFM pipe tables as preformatted fixed-width text', () => {
    const input = '| Name | Value |\n| --- | ---: |\n| Alpha | 1 |\n| Beta | 22 |'
    expect(convertMarkdownToTelegramHtml(input)).toBe(
      '<pre>Name  | Value\n------|------\nAlpha | 1\nBeta  | 22</pre>'
    )
  })

  it('does not convert pipe table text inside fenced code blocks', () => {
    const input = '```\n| A | B |\n| --- | --- |\n| 1 | 2 |\n```'
    expect(convertMarkdownToTelegramHtml(input)).toBe(
      '<pre>| A | B |\n| --- | --- |\n| 1 | 2 |</pre>'
    )
  })

  it('auto-closes a dangling fenced block at a chunk boundary', () => {
    const input = '```ts\nconst a = 1'
    expect(convertMarkdownToTelegramHtml(input)).toBe(
      '<pre><code class="language-ts">const a = 1</code></pre>'
    )
  })

  it('rewrites Markdown links into Telegram-safe <a> tags', () => {
    expect(convertMarkdownToTelegramHtml('see [docs](https://example.com)')).toBe(
      'see <a href="https://example.com">docs</a>'
    )
  })

  it('normalizes unordered list markers to bullet points', () => {
    expect(convertMarkdownToTelegramHtml('- one\n* two\n+ three')).toBe('• one\n• two\n• three')
  })

  it('groups consecutive blockquote lines into a single <blockquote>', () => {
    expect(convertMarkdownToTelegramHtml('> first\n> second\nplain')).toBe(
      '<blockquote>\nfirst\nsecond\n</blockquote>\nplain'
    )
  })

  it('returns escaped text when conversion throws', () => {
    expect(convertMarkdownToTelegramHtml('plain <tag>')).toBe('plain &lt;tag&gt;')
  })
})
