import { extractDisplayContentText } from '@/lib/chatSearch'
import type { DisplayMessage } from './displayMessage'

/** One row of the "scroll to latest" preview. */
export interface ScrollToLatestItem {
  id: string
  role: 'user' | 'assistant'
  text: string
  streaming: boolean
  failed: boolean
}

const MAX_PREVIEW_CHARS = 140
const DEFAULT_ITEM_LIMIT = 50

/**
 * Optimistic placeholders use synthetic ids that disappear once the real record arrives, so they
 * must never become a jump target.
 */
function isSyntheticMessageId(id: string): boolean {
  return id.startsWith('__pending_assistant_') || id.startsWith('__rate_limit__')
}

function truncate(text: string): string {
  return text.length > MAX_PREVIEW_CHARS ? `${text.slice(0, MAX_PREVIEW_CHARS)}…` : text
}

/**
 * Builds the preview rows for messages below the viewport, oldest first.
 *
 * The list is bounded to the newest `limit` rows: the indicator exists to reach the bottom quickly,
 * and an unbounded list would render hundreds of rows for a long reading session. Callers show the
 * true total from the count, not from this list's length.
 */
export function buildScrollToLatestItems(input: {
  messages: readonly DisplayMessage[]
  streamingMessageId: string | null
  limit?: number
}): ScrollToLatestItem[] {
  const limit = input.limit ?? DEFAULT_ITEM_LIMIT
  const candidates = input.messages.filter((message) => !isSyntheticMessageId(message.id))
  const bounded =
    candidates.length > limit ? candidates.slice(candidates.length - limit) : candidates

  return bounded.map((message) => ({
    id: message.id,
    role: message.role === 'user' ? 'user' : 'assistant',
    text: truncate(extractDisplayContentText(message.content)),
    streaming: message.id === input.streamingMessageId,
    failed: message.status === 'error'
  }))
}
