import { extractReasoningMiddleware } from 'ai'

export function createReasoningMiddleware(tagName = 'think') {
  return extractReasoningMiddleware({
    tagName
  })
}
