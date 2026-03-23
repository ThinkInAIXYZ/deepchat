import type { AssistantMessageBlock } from '@shared/types/agent-interface'
import { TELEGRAM_OUTBOUND_TEXT_LIMIT } from '../types'

const EMPTY_TELEGRAM_TEXT = '(No text output)'
const TELEGRAM_DESKTOP_CONFIRMATION_NOTICE =
  'Desktop confirmation is required to continue this action.'

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

export const blocksRequireDesktopConfirmation = (blocks: AssistantMessageBlock[]): boolean =>
  blocks.some(
    (block) =>
      block.type === 'action' &&
      (block.action_type === 'tool_call_permission' || block.action_type === 'question_request') &&
      block.extra?.needsUserAction !== false
  )

export const extractTelegramStreamText = (blocks: AssistantMessageBlock[]): string => {
  const preferred = blocks
    .filter((block) => block.type === 'content' && typeof block.content === 'string')
    .map((block) => block.content?.trim() ?? '')
    .filter(Boolean)

  if (preferred.length > 0) {
    return preferred.join('\n\n').trim()
  }

  return blocks
    .filter((block) => block.type !== 'tool_call' && typeof block.content === 'string')
    .map((block) => block.content?.trim() ?? '')
    .filter(Boolean)
    .join('\n\n')
    .trim()
}

export const buildTelegramFinalText = (blocks: AssistantMessageBlock[]): string => {
  const text = extractTelegramStreamText(blocks) || EMPTY_TELEGRAM_TEXT
  if (!blocksRequireDesktopConfirmation(blocks)) {
    return text
  }

  return `${text}\n\n${TELEGRAM_DESKTOP_CONFIRMATION_NOTICE}`.trim()
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
