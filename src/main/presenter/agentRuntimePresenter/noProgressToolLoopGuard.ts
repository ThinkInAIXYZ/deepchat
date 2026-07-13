import { createHash } from 'node:crypto'
import type { AgentNoProgressToolLoopMetadata } from '@shared/types/agent-interface'
import type { ChatMessage } from '@shared/types/core/chat-message'
import type { ToolCallResult } from './types'

export const NO_PROGRESS_TERMINAL_ERROR =
  'Agent stopped after four identical tool batches produced no progress.'

const CORRECTION_BATCH_COUNT = 2
const TERMINAL_BATCH_COUNT = 4

const NO_PROGRESS_CORRECTION = {
  type: 'agent_no_progress',
  repeatedBatchCount: CORRECTION_BATCH_COUNT,
  instruction:
    'The same tool batch returned exactly the same results. Change strategy or finalize with the available evidence; do not repeat the same calls.'
} as const

export interface ToolBatchProgressObservation {
  repeatedBatchCount: number
  correctionAppended: boolean
  shouldTerminate: boolean
  snapshot: AgentNoProgressToolLoopMetadata
}

export type ResumableToolBatch = {
  toolCalls: ToolCallResult[]
  batchMessages: ChatMessage[]
}

const WEAK_ACKNOWLEDGEMENTS = new Set(['ok', 'success', 'succeeded', 'done', 'true', 'completed'])
const ISO_TIMESTAMP_PATTERN =
  /\b\d{4}-\d{2}-\d{2}[tT]\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:[zZ]|[+-]\d{2}:?\d{2})\b/g
const VOLATILE_UUID_LABEL_PATTERN = [
  'request(?:[\\s_-]?id)?',
  'tool[\\s_-]?call(?:[\\s_-]?id)?',
  'trace(?:[\\s_-]?id)?',
  'run(?:[\\s_-]?id)?',
  'call(?:[\\s_-]?id)?',
  'invocation(?:[\\s_-]?id)?',
  'execution(?:[\\s_-]?id)?',
  'event(?:[\\s_-]?id)?',
  'nonce'
].join('|')
const UUID_TOKEN_PATTERN = '[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}'
const LABELED_VOLATILE_UUID_PATTERN = new RegExp(
  `\\b(${VOLATILE_UUID_LABEL_PATTERN})\\b\\s*[:=#-]?\\s*(${UUID_TOKEN_PATTERN})\\b`,
  'gi'
)
const VOLATILE_RESULT_KEYS = new Set([
  'timestamp',
  'time',
  'createdat',
  'updatedat',
  'completedat',
  'startedat',
  'finishedat',
  'requestid',
  'toolcallid',
  'traceid',
  'runid',
  'callid',
  'invocationid',
  'executionid',
  'eventid',
  'nonce'
])

function stableJsonStringify(value: unknown): string {
  if (value === null || typeof value !== 'object') {
    return JSON.stringify(value) ?? 'null'
  }
  if (Array.isArray(value)) {
    return `[${value.map((item) => stableJsonStringify(item)).join(',')}]`
  }

  return `{${Object.entries(value as Record<string, unknown>)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, entry]) => `${JSON.stringify(key)}:${stableJsonStringify(entry)}`)
    .join(',')}}`
}

function normalizeVolatileString(value: string): string {
  return value
    .replace(ISO_TIMESTAMP_PATTERN, '<timestamp>')
    .replace(LABELED_VOLATILE_UUID_PATTERN, '$1 <generated-id>')
}

function normalizeResultValue(value: unknown, key?: string): unknown {
  const normalizedKey = key?.replace(/[_-]/g, '').toLowerCase()
  if (normalizedKey && VOLATILE_RESULT_KEYS.has(normalizedKey)) {
    return '<volatile>'
  }
  if (typeof value === 'string') {
    return normalizeVolatileString(value)
  }
  if (Array.isArray(value)) {
    return value.map((item) => normalizeResultValue(item))
  }
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([entryKey, entryValue]) => [
        entryKey,
        normalizeResultValue(entryValue, entryKey)
      ])
    )
  }
  return value
}

function normalizeToolResult(content: ChatMessage['content']): unknown {
  if (typeof content !== 'string') {
    return normalizeResultValue(content ?? null)
  }

  try {
    const parsed = JSON.parse(content) as unknown
    return typeof parsed === 'string'
      ? normalizeVolatileString(parsed)
      : normalizeResultValue(parsed)
  } catch {
    return normalizeVolatileString(content.trim())
  }
}

function isWeakAcknowledgement(value: unknown): boolean {
  if (typeof value === 'boolean') return value
  if (typeof value === 'string') {
    return WEAK_ACKNOWLEDGEMENTS.has(value.trim().toLowerCase())
  }
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false

  const meaningfulEntries = Object.entries(value as Record<string, unknown>).filter(
    ([key]) => !VOLATILE_RESULT_KEYS.has(key.replace(/[_-]/g, '').toLowerCase())
  )
  if (meaningfulEntries.length === 0) return true
  if (meaningfulEntries.length > 2) return false

  return meaningfulEntries.every(([key, entryValue]) => {
    const normalizedKey = key.replace(/[_-]/g, '').toLowerCase()
    return (
      (normalizedKey === 'ok' ||
        normalizedKey === 'success' ||
        normalizedKey === 'status' ||
        normalizedKey === 'result') &&
      isWeakAcknowledgement(entryValue)
    )
  })
}

function canonicalizeToolArguments(rawArguments: string): string {
  try {
    return stableJsonStringify(JSON.parse(rawArguments))
  } catch {
    return rawArguments.trim()
  }
}

function buildToolBatchFingerprint(
  toolCalls: ToolCallResult[],
  messages: ChatMessage[]
): {
  fingerprint: string
  evidence: AgentNoProgressToolLoopMetadata['evidence']
} {
  const calls = toolCalls.map((toolCall) => ({
    name: toolCall.name.trim(),
    arguments: canonicalizeToolArguments(toolCall.arguments)
  }))
  const results = messages
    .filter((message) => message.role === 'tool')
    .map((message) => normalizeToolResult(message.content))
  const fingerprint = createHash('sha256')
    .update(stableJsonStringify({ calls, results }))
    .digest('hex')
    .slice(0, 24)

  return {
    fingerprint,
    evidence: results.length > 0 && results.every(isWeakAcknowledgement) ? 'weak' : 'strong'
  }
}

function appendCorrection(messages: ChatMessage[]): boolean {
  const lastToolMessageIndex = messages.findLastIndex((message) => message.role === 'tool')
  if (lastToolMessageIndex < 0) {
    return false
  }

  const lastToolMessage = messages[lastToolMessageIndex]
  const correction = JSON.stringify(NO_PROGRESS_CORRECTION)
  const content =
    typeof lastToolMessage.content === 'string'
      ? `${lastToolMessage.content}\n\n${correction}`
      : [...(lastToolMessage.content ?? []), { type: 'text' as const, text: correction }]
  messages[lastToolMessageIndex] = { ...lastToolMessage, content }
  return true
}

export class NoProgressToolLoopGuard {
  private previousFingerprint: string | null = null
  private repeatedBatchCount = 0

  constructor(snapshot?: AgentNoProgressToolLoopMetadata) {
    if (
      snapshot &&
      typeof snapshot.fingerprint === 'string' &&
      snapshot.fingerprint.length > 0 &&
      Number.isInteger(snapshot.repeatedBatchCount) &&
      snapshot.repeatedBatchCount > 0 &&
      (snapshot.evidence === 'strong' || snapshot.evidence === 'weak')
    ) {
      this.previousFingerprint = snapshot.fingerprint
      this.repeatedBatchCount = snapshot.repeatedBatchCount
    }
  }

  observe(toolCalls: ToolCallResult[], batchMessages: ChatMessage[]): ToolBatchProgressObservation {
    const { fingerprint, evidence } = buildToolBatchFingerprint(toolCalls, batchMessages)
    if (fingerprint === this.previousFingerprint) {
      this.repeatedBatchCount += 1
    } else {
      this.previousFingerprint = fingerprint
      this.repeatedBatchCount = 1
    }

    const correctionAppended =
      this.repeatedBatchCount === CORRECTION_BATCH_COUNT && appendCorrection(batchMessages)

    return {
      repeatedBatchCount: this.repeatedBatchCount,
      correctionAppended,
      shouldTerminate: evidence === 'strong' && this.repeatedBatchCount >= TERMINAL_BATCH_COUNT,
      snapshot: {
        fingerprint,
        repeatedBatchCount: this.repeatedBatchCount,
        evidence
      }
    }
  }
}

export function extractLatestCompletedToolBatch(
  messages: ChatMessage[]
): ResumableToolBatch | null {
  const lastUserIndex = messages.findLastIndex((message) => message.role === 'user')
  for (let index = messages.length - 1; index > lastUserIndex; index -= 1) {
    const message = messages[index]
    if (message.role !== 'assistant' || !message.tool_calls?.length) continue

    const followingMessages = messages.slice(index + 1)
    if (followingMessages.some((entry) => entry.role !== 'tool')) return null

    const toolMessagesById = new Map(
      followingMessages
        .filter((entry) => entry.role === 'tool' && entry.tool_call_id)
        .map((entry) => [entry.tool_call_id!, entry])
    )
    if (message.tool_calls.some((toolCall) => !toolMessagesById.has(toolCall.id))) return null

    return {
      toolCalls: message.tool_calls.map((toolCall) => ({
        id: toolCall.id,
        name: toolCall.function.name,
        arguments: toolCall.function.arguments,
        ...(toolCall.provider_options ? { providerOptions: toolCall.provider_options } : {})
      })),
      batchMessages: message.tool_calls.map((toolCall) => toolMessagesById.get(toolCall.id)!)
    }
  }

  return null
}
