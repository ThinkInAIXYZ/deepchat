import {
  AGENT_MEMORY_DIRECTIVE_TOPIC_MAX_CHARS,
  type MemoryRetrievalPurpose
} from '@shared/types/agent-memory'
import {
  containsCjkScript,
  isMemoryDirectiveTopicSpecificEnough
} from '@shared/lib/memoryDirectiveTopic'
import { unicodeCodePointLength } from '@shared/lib/unicodeText'

import { normalizeDirectiveMatchText } from '../domain/directives'

const LETTER_OR_NUMBER_PATTERN = /[\p{L}\p{N}]/u

type TopicMatcher = (content: string) => boolean

export interface MemoryTopicSuppressionPolicy {
  readonly topics: readonly string[]
  suppresses(content: string): boolean
}

export function directiveSuppressionAppliesToPurpose(purpose: MemoryRetrievalPurpose): boolean {
  return purpose === 'recall' || purpose === 'injection'
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&')
}

function createTopicMatcher(topic: string): TopicMatcher {
  if (containsCjkScript(topic)) {
    return (content) => content.includes(topic)
  }

  const codePoints = Array.from(topic)
  const first = codePoints[0] ?? ''
  const last = codePoints.at(-1) ?? ''
  const leftBoundary = LETTER_OR_NUMBER_PATTERN.test(first) ? '(?:^|[^\\p{L}\\p{N}])' : ''
  const rightBoundary = LETTER_OR_NUMBER_PATTERN.test(last) ? '(?=$|[^\\p{L}\\p{N}])' : ''
  const pattern = new RegExp(`${leftBoundary}${escapeRegExp(topic)}${rightBoundary}`, 'u')
  return (content) => pattern.test(content)
}

export function createMemoryTopicSuppressionPolicy(
  rawTopics: readonly (string | null | undefined)[]
): MemoryTopicSuppressionPolicy {
  const topics = [
    ...new Set(
      rawTopics
        .map((topic) => (typeof topic === 'string' ? normalizeDirectiveMatchText(topic) : ''))
        .filter(
          (topic) =>
            topic.length > 0 &&
            unicodeCodePointLength(topic) <= AGENT_MEMORY_DIRECTIVE_TOPIC_MAX_CHARS &&
            isMemoryDirectiveTopicSpecificEnough(topic)
        )
    )
  ]
  const matchers = topics.map(createTopicMatcher)
  return {
    topics,
    suppresses(content: string): boolean {
      if (!matchers.length || !content) return false
      const normalized = normalizeDirectiveMatchText(content)
      return matchers.some((matches) => matches(normalized))
    }
  }
}
