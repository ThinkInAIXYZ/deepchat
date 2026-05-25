import type { AssistantMessageBlock } from '@shared/types/agent-interface'
import { splitHtmlForTelegram, telegramFormat } from 'telegram-markdown-formatter'
import { TELEGRAM_OUTBOUND_TEXT_LIMIT } from '../types'

const EMPTY_TELEGRAM_TEXT = '(No text output)'
const TELEGRAM_HTML_PARSE_MODE = 'HTML'

export type TelegramFormattedTextChunk = {
  text: string
  parseMode?: typeof TELEGRAM_HTML_PARSE_MODE
  fallbackText: string
}

export const createTelegramDraftId = (): number =>
  Math.max(1, Math.trunc(Math.random() * 2_000_000_000))

export const safeParseAssistantBlocks = (content: string): AssistantMessageBlock[] => {
  try {
    const parsed = JSON.parse(content) as AssistantMessageBlock[] | string
    if (typeof parsed === 'string') {
      return [
        {
          type: 'content',
          content: parsed,
          status: 'success',
          timestamp: Date.now()
        }
      ]
    }
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return content.trim()
      ? [
          {
            type: 'content',
            content: content.trim(),
            status: 'success',
            timestamp: Date.now()
          }
        ]
      : []
  }
}

const collectText = (
  blocks: AssistantMessageBlock[],
  predicate: (block: AssistantMessageBlock) => boolean
): string =>
  blocks
    .filter(predicate)
    .map((block) => block.content?.trim() ?? '')
    .filter(Boolean)
    .join('\n\n')
    .trim()

export const extractTelegramDraftText = (blocks: AssistantMessageBlock[]): string =>
  collectText(blocks, (block) => block.type === 'content' && typeof block.content === 'string')

export const shouldSendTelegramDraft = (blocks: AssistantMessageBlock[]): boolean =>
  Boolean(extractTelegramDraftText(blocks))

export const extractTelegramStreamText = (blocks: AssistantMessageBlock[]): string => {
  const preferred = extractTelegramDraftText(blocks)

  if (preferred) {
    return preferred
  }

  return collectText(
    blocks,
    (block) =>
      typeof block.content === 'string' &&
      (block.type === 'content' ||
        (block.type === 'action' &&
          (block.action_type === 'tool_call_permission' ||
            block.action_type === 'question_request')))
  )
}

export const buildTelegramFinalText = (blocks: AssistantMessageBlock[]): string => {
  return extractTelegramStreamText(blocks) || EMPTY_TELEGRAM_TEXT
}

export const chunkTelegramText = (
  text: string,
  limit: number = TELEGRAM_OUTBOUND_TEXT_LIMIT
): string[] => {
  const normalized = text?.trim() || EMPTY_TELEGRAM_TEXT
  if (normalized.length <= limit) {
    return [normalized]
  }

  const chunks: string[] = []
  let remaining = normalized

  while (remaining.length > limit) {
    const window = remaining.slice(0, limit)
    const splitIndex = Math.max(
      window.lastIndexOf('\n\n'),
      window.lastIndexOf('\n'),
      window.lastIndexOf(' ')
    )
    const nextIndex = splitIndex > Math.floor(limit * 0.55) ? splitIndex : limit
    const chunk = remaining.slice(0, nextIndex).trim()
    if (!chunk) {
      chunks.push(remaining.slice(0, limit))
      remaining = remaining.slice(limit).trim()
      continue
    }
    chunks.push(chunk)
    remaining = remaining.slice(nextIndex).trim()
  }

  if (remaining) {
    chunks.push(remaining)
  }

  return chunks
}

const parseMarkdownTableRow = (line: string): string[] | null => {
  const trimmed = line.trim()
  if (!trimmed.includes('|')) {
    return null
  }

  const withoutOuterPipes =
    trimmed.startsWith('|') && trimmed.endsWith('|') ? trimmed.slice(1, -1) : trimmed
  const cells = withoutOuterPipes.split('|').map((cell) => cell.trim())

  return cells.length >= 2 ? cells : null
}

const isMarkdownTableSeparator = (cells: string[]): boolean =>
  cells.length >= 2 &&
  cells.every((cell) => {
    const normalized = cell.replace(/\s/g, '')
    return /^:?-{3,}:?$/.test(normalized)
  })

const getCellWidth = (cell: string): number => Array.from(cell).length

const padCell = (cell: string, width: number): string =>
  `${cell}${' '.repeat(Math.max(0, width - getCellWidth(cell)))}`

const formatMarkdownTableAsText = (rows: string[][]): string => {
  const columnCount = rows.reduce((max, row) => Math.max(max, row.length), 0)
  const normalizedRows = rows.map((row) =>
    Array.from({ length: columnCount }, (_, index) => row[index] ?? '')
  )
  const widths = Array.from({ length: columnCount }, (_, index) =>
    Math.max(2, ...normalizedRows.map((row) => getCellWidth(row[index] ?? '')))
  )

  const formatRow = (row: string[]): string =>
    row
      .map((cell, index) => padCell(cell, widths[index] ?? 2))
      .join(' | ')
      .trimEnd()
  const separator = widths.map((width) => '-'.repeat(width)).join('-|-')

  return [formatRow(normalizedRows[0] ?? []), separator, ...normalizedRows.slice(1).map(formatRow)]
    .filter(Boolean)
    .join('\n')
}

export const convertMarkdownTablesToCodeBlocks = (text: string): string => {
  const lines = text.replace(/\r\n/g, '\n').split('\n')
  const output: string[] = []
  let index = 0
  let fenceMarker: string | null = null

  while (index < lines.length) {
    const line = lines[index] ?? ''
    const fenceMatch = line.match(/^\s*(`{3,}|~{3,})/)
    if (fenceMatch) {
      const marker = fenceMatch[1] ?? ''
      if (!fenceMarker) {
        fenceMarker = marker
      } else if (marker[0] === fenceMarker[0] && marker.length >= fenceMarker.length) {
        fenceMarker = null
      }
      output.push(line)
      index += 1
      continue
    }

    if (fenceMarker) {
      output.push(line)
      index += 1
      continue
    }

    const header = parseMarkdownTableRow(line)
    const separator = parseMarkdownTableRow(lines[index + 1] ?? '')

    if (header && separator && isMarkdownTableSeparator(separator)) {
      const rows: string[][] = [header]
      index += 2

      while (index < lines.length) {
        const row = parseMarkdownTableRow(lines[index] ?? '')
        if (!row || isMarkdownTableSeparator(row)) {
          break
        }
        rows.push(row)
        index += 1
      }

      output.push('```')
      output.push(formatMarkdownTableAsText(rows))
      output.push('```')
      continue
    }

    output.push(line)
    index += 1
  }

  return output.join('\n')
}

const decodeHtmlEntities = (text: string): string =>
  text
    .replace(/&#x([0-9a-f]+);/gi, (_match, value: string) =>
      String.fromCodePoint(Number.parseInt(value, 16))
    )
    .replace(/&#(\d+);/g, (_match, value: string) =>
      String.fromCodePoint(Number.parseInt(value, 10))
    )
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&')

export const stripTelegramHtmlForFallback = (html: string): string =>
  decodeHtmlEntities(
    html
      .replace(
        /<a\s+[^>]*href=(["'])(.*?)\1[^>]*>([\s\S]*?)<\/a>/gi,
        (_match, _quote: string, href: string, label: string) =>
          label.trim() && label.trim() !== href ? `${label} (${href})` : href
      )
      .replace(/<br\s*\/?>/gi, '\n')
      .replace(/<\/(?:pre|blockquote|p|div|h[1-6])>/gi, '\n')
      .replace(/<[^>]+>/g, '')
      .replace(/\n{3,}/g, '\n\n')
  ).trim()

export const chunkTelegramMarkdownText = (
  text: string,
  limit: number = TELEGRAM_OUTBOUND_TEXT_LIMIT
): TelegramFormattedTextChunk[] => {
  const normalized = text?.trim() || EMPTY_TELEGRAM_TEXT

  if (limit !== TELEGRAM_OUTBOUND_TEXT_LIMIT) {
    return chunkTelegramText(normalized, limit).map((chunk) => ({
      text: chunk,
      fallbackText: chunk
    }))
  }

  try {
    const markdown = convertMarkdownTablesToCodeBlocks(normalized)
    const formatted = telegramFormat(markdown).trim()

    if (formatted === normalized) {
      return chunkTelegramText(normalized, limit).map((chunk) => ({
        text: chunk,
        fallbackText: chunk
      }))
    }

    const formattedChunks = splitHtmlForTelegram(formatted).filter((chunk) => chunk.trim())

    if (
      formattedChunks.length > 0 &&
      formattedChunks.every((chunk) => chunk.length <= TELEGRAM_OUTBOUND_TEXT_LIMIT)
    ) {
      return formattedChunks.map((chunk) => ({
        text: chunk,
        parseMode: TELEGRAM_HTML_PARSE_MODE,
        fallbackText:
          formattedChunks.length === 1 && normalized.length <= TELEGRAM_OUTBOUND_TEXT_LIMIT
            ? normalized
            : stripTelegramHtmlForFallback(chunk) || normalized
      }))
    }
  } catch {
    // Fall back to plain text below.
  }

  return chunkTelegramText(normalized, limit).map((chunk) => ({
    text: chunk,
    fallbackText: chunk
  }))
}
