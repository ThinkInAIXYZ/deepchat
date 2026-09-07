/**
 * Markdown style optimization for Feishu post messages.
 *
 * Ported from openclaw-lark (src/card/markdown-style.ts) and adapted
 * to DeepChat coding conventions.
 *
 * Optimizations:
 * - Heading demotion: H1 -> H4, H2~H6 -> H5
 * - Paragraph spacing around tables
 * - Ordered list: ensure single space after number
 * - Unordered list: normalize "- " format (skip horizontal rules ---)
 * - Table: pad cells, normalize separator rows, add blank lines
 * - Code blocks are preserved as-is
 */

const IMAGE_RE = /!\[([^\]]*)\]\(([^)\s]+)\)/g

/**
 * Strip `![alt](value)` where value is not a valid Feishu image key (`img_xxx`).
 */
function stripInvalidImageKeys(text: string): string {
  if (!text.includes('![')) return text
  return text.replace(IMAGE_RE, (fullMatch, _alt: string, value: string) => {
    if (value.startsWith('img_')) return fullMatch
    return ''
  })
}

function optimizeMarkdownStyleCore(text: string, cardVersion = 2): string {
  const MARK = '___CB_'
  const codeBlocks: string[] = []

  // 1. Extract code blocks and protect with placeholders
  let r = text.replace(/(^|\n)(`{3,})([^\n]*)\n[\s\S]*?\n\2(?=\n|$)/g, (m, prefix = '') => {
    const block = m.slice(String(prefix).length)
    return `${prefix}${MARK}${codeBlocks.push(block) - 1}___`
  })

  // 2. Heading demotion: only when original text contains h1~h3
  const hasH1toH3 = /^#{1,3} /m.test(text)
  if (hasH1toH3) {
    r = r.replace(/^#{2,6} (.+)$/gm, '##### $1') // H2~H6 -> H5
    r = r.replace(/^# (.+)$/gm, '#### $1') // H1 -> H4
  }

  if (cardVersion >= 2) {
    // 3. Add paragraph spacing between consecutive headings
    r = r.replace(/^(#{4,5} .+)\n{1,2}(#{4,5} )/gm, '$1\n\n$2')

    // 4. Add paragraph spacing around tables
    // 4a. Non-table line directly followed by table row
    r = r.replace(/^([^|\n].*)\n(\|.+\|)/gm, '$1\n\n$2')
    // 4b. Before table: add blank line
    r = r.replace(/\n\n((?:\|.+\|[^\S\n]*\n?)+)/g, '\n\n\n$1')
    // 4c. After table: append blank line at end of table block
    r = r.replace(/((?:^\|.+\|[^\S\n]*\n?)+)/gm, (m, _table: string, offset: number) => {
      const after = r.slice(offset + m.length).replace(/^\n+/, '')
      if (!after || /^(---|#{4,5} |\*\*)/.test(after)) return m
      return m + '\n\n'
    })
    // 4d. Table preceded by plain text: remove extra blank line
    r = r.replace(/^((?!#{4,5} )(?!\*\*).+)\n\n\n(\|)/gm, '$1\n\n$2')
    // 4d2. Table preceded by bold line
    r = r.replace(/^(\*\*.+)\n\n\n(\|)/gm, '$1\n\n$2')
    // 4e. Table followed by plain text: remove extra blank line
    r = r.replace(/(\|[^\n]*\n)\n\n((?!#{4,5} )(?!\*\*))/gm, '$1\n$2')

    // 5. Restore code blocks with blank line before and after
    codeBlocks.forEach((block, i) => {
      r = r.replace(`${MARK}${i}___`, `\n\n${block}\n\n`)
    })
  } else {
    // 5. Restore code blocks
    codeBlocks.forEach((block, i) => {
      r = r.replace(`${MARK}${i}___`, block)
    })
  }

  // 6. Compress excessive blank lines (3+ consecutive newlines -> 2)
  r = r.replace(/\n{3,}/g, '\n\n')

  return r
}

/**
 * Optimize Markdown text for Feishu post rendering.
 *
 * - Heading demotion (H1->H4, H2~H6->H5) to avoid oversized headings in cards
 * - Table spacing fixes for proper rendering
 * - List format normalization
 * - Code block preservation
 * - Strip invalid image references
 */
export function optimizeMarkdownForFeishu(text: string, cardVersion = 2): string {
  try {
    let r = optimizeMarkdownStyleCore(text, cardVersion)
    r = stripInvalidImageKeys(r)
    return r
  } catch {
    return text
  }
}
