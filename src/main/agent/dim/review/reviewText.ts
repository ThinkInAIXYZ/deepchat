import type { ChatMessage } from '@shared/types/core/chat-message'

/**
 * Text shaping shared by both permission-review paths. It lives in its own module so the System One
 * state builder can use it without importing the reviewer that calls the builder.
 */

export const AUTO_APPROVE_REVIEW_MAX_CONTENT_CHARS = 2_000

/**
 * `head` keeps the leading characters only, which is the generative path's existing behaviour.
 * `head-and-tail` also keeps the trailing characters, because an instruction that tries to steer the
 * decision often sits at the end of a long tool result and head-only truncation would hide exactly
 * the content the injection question exists to see.
 */
export type ReviewTextTruncation = 'head' | 'head-and-tail'

export const HEAD_AND_TAIL_MARKER = '...[truncated]...'

const isHighSurrogate = (code: number): boolean => code >= 0xd800 && code <= 0xdbff
const isLowSurrogate = (code: number): boolean => code >= 0xdc00 && code <= 0xdfff

export function truncateReviewText(
  value: string,
  maxChars = AUTO_APPROVE_REVIEW_MAX_CONTENT_CHARS,
  truncation: ReviewTextTruncation = 'head'
): string {
  if (value.length <= maxChars) return value

  if (truncation === 'head-and-tail') {
    // The marker counts against the budget, and neither cut may land inside a surrogate pair.
    const budget = Math.max(0, maxChars - HEAD_AND_TAIL_MARKER.length)
    const headBudget = Math.ceil(budget / 2)

    let headEnd = headBudget
    if (headEnd > 0 && isHighSurrogate(value.charCodeAt(headEnd - 1))) headEnd -= 1

    let tailStart = value.length - (budget - headBudget)
    if (tailStart > 0 && isLowSurrogate(value.charCodeAt(tailStart))) tailStart += 1

    return `${value.slice(0, headEnd)}${HEAD_AND_TAIL_MARKER}${value.slice(tailStart)}`
  }

  return `${value.slice(0, maxChars)}...[truncated]`
}

export function chatMessageContentToReviewText(
  content: ChatMessage['content'],
  maxChars = AUTO_APPROVE_REVIEW_MAX_CONTENT_CHARS,
  truncation: ReviewTextTruncation = 'head'
): string {
  if (typeof content === 'string') {
    return truncateReviewText(content, maxChars, truncation)
  }
  if (!Array.isArray(content)) {
    return ''
  }

  const parts = content.map((item) => {
    if (item.type === 'text') {
      return item.text
    }
    if (item.type === 'image_url') {
      return '[image]'
    }
    if (item.type === 'input_audio') {
      return `[audio:${item.input_audio.filename || 'attachment'}]`
    }
    return '[attachment]'
  })
  return truncateReviewText(parts.join('\n'), maxChars, truncation)
}
