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

function truncate(text: string): string {
  return text.length > MAX_PREVIEW_CHARS ? `${text.slice(0, MAX_PREVIEW_CHARS)}…` : text
}

/**
 * Builds the preview rows for messages below the viewport, oldest first.
 *
 * The list is bounded to the newest `limit` rows: the indicator exists to reach the bottom quickly,
 * and an unbounded list would render hundreds of rows for a long reading session. Callers show the
 * true total from the count, not from this list's length.
 *
 * Optimistic rows are included. A reply that is still generating is exactly such a row, and hiding
 * it meant the newest message — the one the user just triggered — never appeared in the preview.
 * Jumping to one is safe because the jump is issued immediately: the target is resolved from the
 * layout map at click time, and the row keeps its DOM node when the persisted record replaces it.
 */
export function buildScrollToLatestItems(input: {
  messages: readonly DisplayMessage[]
  streamingMessageId: string | null
  limit?: number
}): ScrollToLatestItem[] {
  const limit = input.limit ?? DEFAULT_ITEM_LIMIT
  const messages = input.messages
  const bounded = messages.length > limit ? messages.slice(messages.length - limit) : messages

  return bounded.map((message) => ({
    id: message.id,
    role: message.role === 'user' ? 'user' : 'assistant',
    text: truncate(extractDisplayContentText(message.content)),
    streaming: message.id === input.streamingMessageId,
    failed: message.status === 'error'
  }))
}
