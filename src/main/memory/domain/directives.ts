import { createHash } from 'node:crypto'
import {
  AGENT_MEMORY_DIRECTIVE_CONTENT_MAX_CHARS,
  AGENT_MEMORY_DIRECTIVE_CJK_TOPIC_MIN_VISIBLE_CHARS,
  AGENT_MEMORY_DIRECTIVE_TOPIC_MAX_CHARS,
  type AgentMemoryDirectiveKind,
  type AgentMemoryDirectiveSource,
  type AgentMemoryDirectiveStatus
} from '@shared/types/agent-memory'
import { isMemoryDirectiveTopicSpecificEnough } from '@shared/lib/memoryDirectiveTopic'
import { unicodeCodePointLength } from '@shared/lib/unicodeText'

export type { AgentMemoryDirectiveKind, AgentMemoryDirectiveSource, AgentMemoryDirectiveStatus }
export type ExplicitMemoryDirectiveSource = Extract<
  AgentMemoryDirectiveSource,
  'explicit_user' | 'manual'
>

export interface AgentMemoryDirectiveRow {
  agent_id: string
  id: string
  kind: AgentMemoryDirectiveKind
  status: AgentMemoryDirectiveStatus
  source: AgentMemoryDirectiveSource
  content: string
  normalized_topic: string | null
  identity_hash: string
  created_at: number
  updated_at: number
}

export type MemoryDirectiveInput =
  | {
      kind: 'instruction'
      content: string
      topic?: null
    }
  | {
      kind: 'suppress_topic'
      content: string
      topic: string
    }

export interface MemoryDirectiveListOptions {
  statuses?: readonly AgentMemoryDirectiveStatus[]
  limit?: number
}

export interface NormalizedMemoryDirective {
  kind: AgentMemoryDirectiveKind
  content: string
  normalizedTopic: string | null
  identityHash: string
}

export interface MemoryDirectiveWriteInput extends NormalizedMemoryDirective {
  agentId: string
  id: string
  source: AgentMemoryDirectiveSource
  status: AgentMemoryDirectiveStatus
  createdAt: number
  updatedAt: number
}

export type MemoryDirectiveWriteResult =
  | {
      action: 'created' | 'updated' | 'unchanged'
      row: AgentMemoryDirectiveRow
    }
  | {
      action: 'capacity'
      row: null
    }

export interface MemoryDirectiveInsertResult {
  inserted: boolean
  row: AgentMemoryDirectiveRow
}

export type MemoryDirectiveTransitionResult =
  | {
      action: 'transitioned'
      row: AgentMemoryDirectiveRow
    }
  | {
      action: 'capacity' | 'not-found'
      row: null
    }

export interface MemoryDirectiveCounts {
  draft: number
  active: number
  rejected: number
}

export function isMemoryDirectiveRuntimeEligible(
  row: Pick<AgentMemoryDirectiveRow, 'kind' | 'normalized_topic'>
): boolean {
  return (
    row.kind !== 'suppress_topic' ||
    (typeof row.normalized_topic === 'string' &&
      isMemoryDirectiveTopicSpecificEnough(row.normalized_topic))
  )
}

export type MemoryDirectiveCommandResult =
  | { action: 'applied'; directive: AgentMemoryDirectiveRow }
  | {
      action: 'rejected'
      directive: null
      reason: 'capacity' | 'not-found' | 'unavailable'
    }

const INVISIBLE_DIRECTIVE_CONTROL_PATTERN = /[\p{Cc}\p{Cf}]+/gu

function sanitizeDirectiveDisplayText(value: string): string {
  return value.replace(INVISIBLE_DIRECTIVE_CONTROL_PATTERN, ' ')
}

function normalizeWhitespace(value: string): string {
  return sanitizeDirectiveDisplayText(value.normalize('NFKC')).trim().replace(/\s+/gu, ' ')
}

export function normalizeDirectiveMatchText(value: string): string {
  return normalizeWhitespace(value).toLowerCase()
}

function assertBoundedText(value: string, label: string, maxChars: number): string {
  const trimmed = sanitizeDirectiveDisplayText(value).trim()
  if (!trimmed) throw new Error(`[Memory] directive ${label} must not be empty`)
  if (unicodeCodePointLength(trimmed) > maxChars) {
    throw new Error(`[Memory] directive ${label} exceeds ${maxChars} Unicode code points`)
  }
  return trimmed
}

export function normalizeMemoryDirective(input: MemoryDirectiveInput): NormalizedMemoryDirective {
  const content = assertBoundedText(
    input.content,
    'content',
    AGENT_MEMORY_DIRECTIVE_CONTENT_MAX_CHARS
  )
  let normalizedTopic: string | null = null
  if (input.kind === 'instruction') {
    if (input.topic != null) {
      throw new Error('[Memory] instruction directives cannot define a suppression topic')
    }
  } else {
    const topic = assertBoundedText(input.topic, 'topic', AGENT_MEMORY_DIRECTIVE_TOPIC_MAX_CHARS)
    normalizedTopic = assertBoundedText(
      normalizeDirectiveMatchText(topic),
      'topic',
      AGENT_MEMORY_DIRECTIVE_TOPIC_MAX_CHARS
    )
    if (!isMemoryDirectiveTopicSpecificEnough(normalizedTopic)) {
      throw new Error(
        `[Memory] directive CJK topic requires at least ${AGENT_MEMORY_DIRECTIVE_CJK_TOPIC_MIN_VISIBLE_CHARS} visible characters`
      )
    }
  }

  const identity =
    input.kind === 'suppress_topic' ? normalizedTopic! : normalizeDirectiveMatchText(content)
  const identityHash = createHash('sha256')
    .update('deepchat-memory-directive-v1\0')
    .update(input.kind)
    .update('\0')
    .update(identity)
    .digest('hex')

  return {
    kind: input.kind,
    content,
    normalizedTopic,
    identityHash
  }
}
