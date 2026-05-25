/**
 * Markdown -> Telegram HTML conversion for remote-control outbound messages.
 *
 * Telegram Bot API accepts a small HTML subset (`parse_mode: 'HTML'`).
 * AI replies arriving as Markdown were previously sent verbatim, so
 * `**bold**`, `# heading`, and fenced code blocks rendered as raw symbols.
 *
 * Reference: https://core.telegram.org/bots/api#html-style
 *
 * Supported conversions:
 * - Fenced code blocks ``` lang\n...``` -> `<pre><code class="language-...">...</code></pre>`
 * - Inline code `code` -> `<code>code</code>`
 * - Bold `**text**` / `__text__` -> `<b>text</b>`
 * - Italic `*text*` (word-bounded) -> `<i>text</i>`
 * - Strikethrough `~~text~~` -> `<s>text</s>`
 * - Links `[label](url)` -> `<a href="url">label</a>`
 * - Headings `# … ######` -> `<b>text</b>`
 * - Unordered list markers `- / * / +` -> `• `
 * - Blockquote lines `> ` -> grouped into `<blockquote>...</blockquote>`
 * - Horizontal rules `---` / `***` -> `———`
 *
 * Chunk-safety: dangling fenced code blocks (when a chunk boundary lands
 * inside ``` … ```) are auto-closed so each emitted message still parses.
 */

const PLACEHOLDER_PREFIX = '⁣CB⁣'
const INLINE_PLACEHOLDER_PREFIX = '⁣CI⁣'
const PLACEHOLDER_SUFFIX = '⁣'

const HTML_ESCAPE_MAP: Record<string, string> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;'
}

const escapeHtml = (value: string): string =>
  value.replace(/[&<>]/g, (char) => HTML_ESCAPE_MAP[char] ?? char)

const escapeAttribute = (value: string): string =>
  escapeHtml(value).replace(/"/g, '&quot;').replace(/\n/g, ' ')

const sanitizeLanguage = (value: string): string => value.replace(/[^a-zA-Z0-9_+\-.]/g, '')

const renderCodeBlock = (lang: string, body: string): string => {
  const escapedBody = escapeHtml(body.replace(/\n+$/g, ''))
  const language = sanitizeLanguage(lang)
  if (language) {
    return `<pre><code class="language-${language}">${escapedBody}</code></pre>`
  }
  return `<pre>${escapedBody}</pre>`
}

const renderInlineCode = (body: string): string => `<code>${escapeHtml(body)}</code>`

const extractFencedCodeBlocks = (
  text: string,
  store: Array<{ lang: string; body: string }>
): string => {
  let result = text.replace(
    /(^|\n)```([^\n`]*)\n([\s\S]*?)\n```(?=\n|$)/g,
    (_match, prefix: string, lang: string, body: string) => {
      const index = store.push({ lang: lang.trim(), body }) - 1
      return `${prefix}${PLACEHOLDER_PREFIX}${index}${PLACEHOLDER_SUFFIX}`
    }
  )

  // Auto-close a dangling fenced block so chunk boundaries stay renderable.
  const dangling = result.match(/(^|\n)```([^\n`]*)\n([\s\S]*)$/)
  if (dangling) {
    const [, prefix = '', lang = '', body = ''] = dangling
    const index = store.push({ lang: lang.trim(), body }) - 1
    result =
      result.slice(0, dangling.index ?? 0) +
      `${prefix}${PLACEHOLDER_PREFIX}${index}${PLACEHOLDER_SUFFIX}`
  }

  return result
}

const extractInlineCode = (text: string, store: string[]): string =>
  text.replace(/`([^`\n]+)`/g, (_match, body: string) => {
    const index = store.push(body) - 1
    return `${INLINE_PLACEHOLDER_PREFIX}${index}${PLACEHOLDER_SUFFIX}`
  })

const renderLine = (line: string): { content: string; isBlockquote: boolean } => {
  let working = line
  let isBlockquote = false

  const bqMatch = working.match(/^(\s*)>\s?(.*)$/)
  if (bqMatch) {
    isBlockquote = true
    working = bqMatch[2]
  }

  if (/^\s*(?:---+|\*\*\*+|___+)\s*$/.test(working)) {
    return { content: escapeHtml('———'), isBlockquote }
  }

  const headingMatch = working.match(/^(\s*)#{1,6}\s+(.+?)\s*#*\s*$/)
  if (headingMatch) {
    working = `${headingMatch[1]}**${headingMatch[2]}**`
  }

  working = working.replace(/^(\s*)[-*+]\s+/, '$1• ')

  let escaped = escapeHtml(working)

  escaped = escaped.replace(
    /\[([^\]\n]+)\]\(([^)\s]+?)\)/g,
    (_match, label: string, url: string) => {
      return `<a href="${escapeAttribute(url)}">${label}</a>`
    }
  )

  escaped = escaped.replace(/\*\*([^\s*][^*\n]*?[^\s*]|[^\s*])\*\*/g, '<b>$1</b>')
  escaped = escaped.replace(/__([^\s_][^_\n]*?[^\s_]|[^\s_])__/g, '<b>$1</b>')

  escaped = escaped.replace(
    /(^|[\s([{"'>])\*([^\s*][^*\n]*?[^\s*]|[^\s*])\*(?=[\s).,;:!?\]}"'<]|$)/g,
    '$1<i>$2</i>'
  )

  escaped = escaped.replace(
    /(^|[\s([{"'>])_([^\s_][^_\n]*?[^\s_]|[^\s_])_(?=[\s).,;:!?\]}"'<]|$)/g,
    '$1<i>$2</i>'
  )

  escaped = escaped.replace(/~~([^~\n]+)~~/g, '<s>$1</s>')

  return { content: escaped, isBlockquote }
}

const restoreCodeBlocks = (
  text: string,
  blocks: Array<{ lang: string; body: string }>,
  inlines: string[]
): string => {
  const blockPattern = new RegExp(`${PLACEHOLDER_PREFIX}(\\d+)${PLACEHOLDER_SUFFIX}`, 'g')
  const inlinePattern = new RegExp(`${INLINE_PLACEHOLDER_PREFIX}(\\d+)${PLACEHOLDER_SUFFIX}`, 'g')

  let result = text.replace(blockPattern, (_, indexValue: string) => {
    const block = blocks[Number(indexValue)]
    if (!block) {
      return ''
    }
    return renderCodeBlock(block.lang, block.body)
  })

  result = result.replace(inlinePattern, (_, indexValue: string) => {
    const body = inlines[Number(indexValue)]
    if (body === undefined) {
      return ''
    }
    return renderInlineCode(body)
  })

  return result
}

const collapseExcessNewlines = (text: string): string => text.replace(/\n{3,}/g, '\n\n')

/**
 * Convert Markdown text into the Telegram HTML subset accepted by
 * `parse_mode: 'HTML'`. Safe for chunked streaming — partial Markdown
 * left at a chunk boundary degrades to escaped text rather than
 * breaking Telegram's parser.
 */
export const convertMarkdownToTelegramHtml = (input: string): string => {
  if (!input) {
    return ''
  }

  try {
    const normalized = input.replace(/\r\n/g, '\n').replace(/\r/g, '\n')

    const codeBlocks: Array<{ lang: string; body: string }> = []
    const codeInlines: string[] = []

    const withoutFenced = extractFencedCodeBlocks(normalized, codeBlocks)
    const withoutInline = extractInlineCode(withoutFenced, codeInlines)

    const lines = withoutInline.split('\n')
    const out: string[] = []
    let openBlockquote = false

    for (const rawLine of lines) {
      const { content, isBlockquote } = renderLine(rawLine)

      if (isBlockquote && !openBlockquote) {
        out.push('<blockquote>')
        openBlockquote = true
      } else if (!isBlockquote && openBlockquote) {
        out.push('</blockquote>')
        openBlockquote = false
      }

      out.push(content)
    }

    if (openBlockquote) {
      out.push('</blockquote>')
    }

    const joined = collapseExcessNewlines(out.join('\n'))
    return restoreCodeBlocks(joined, codeBlocks, codeInlines)
  } catch {
    return escapeHtml(input)
  }
}
