import { createHash } from 'node:crypto'
import type {
  ChatMessageRecord,
  MessageMetadata,
  PendingSessionInputRecord
} from '@shared/types/agent-interface'
import type { JsonValue } from '@shared/contracts/json'
import type { DimSessionBinding } from '@/session/data/tables/dimSessionBindings'
import type { DimEvent } from './sessionConnection'
import { parseAssistantBlocks, parseUserContent } from '@/session/data/messageContent'

export interface DimHistorySnapshot {
  formatVersion: 1
  productSessionId: string
  messages: ChatMessageRecord[]
  summary: string | null
  contextFromOrderSeq?: number
  pendingInputs?: PendingSessionInputRecord[]
  images?: Record<string, JsonValue[]>
  source?: JsonValue
}
export interface DimHistoryPlan {
  migrationId: string
  productSessionId: string
  digest: string
  chunks: string[]
}

export const dimHistoryHash = (payload: string): string =>
  createHash('sha256').update(payload).digest('hex')

/** Chunks preserve exact JSON bytes, including surrogate pairs; Rust verifies each and the whole. */
export function dimHistoryPlan(snapshot: DimHistorySnapshot): DimHistoryPlan {
  const payload = JSON.stringify(snapshot)
  const digest = dimHistoryHash(payload)
  const chunks: string[] = []
  for (let start = 0; start < payload.length; ) {
    let end = Math.min(start + 256 * 1024, payload.length)
    if (
      end < payload.length &&
      payload.charCodeAt(end - 1) >= 0xd800 &&
      payload.charCodeAt(end - 1) <= 0xdbff
    )
      end--
    chunks.push(payload.slice(start, end))
    start = end
  }
  return { migrationId: digest, productSessionId: snapshot.productSessionId, digest, chunks }
}

/** Old pending UI is history; only new dim facts can establish a live interaction or turn. */
export function normalizeDimImportedMessage(message: ChatMessageRecord): ChatMessageRecord {
  let content = message.content
  if (message.role === 'assistant') {
    let blocks = parseAssistantBlocks(content)
    if (!blocks.length && content.trim() !== '[]')
      blocks = [
        {
          id: `legacy:${message.id}`,
          type: 'content',
          content,
          status: message.status === 'error' ? 'error' : 'success',
          timestamp: message.createdAt
        }
      ]
    for (const block of blocks) {
      if (block.status === 'pending' || block.status === 'loading') block.status = 'error'
      if (block.type === 'action')
        block.extra = {
          ...block.extra,
          needsUserAction: false,
          ...(block.action_type === 'question_request' ? { questionResolution: 'rejected' } : {})
        }
    }
    content = JSON.stringify(blocks)
  } else if (!parseUserContent(content)) {
    let text = content
    try {
      const parsed = JSON.parse(content)
      if (typeof parsed === 'string') text = parsed
    } catch {
      /* Legacy plain-text messages remain text. */
    }
    content = JSON.stringify({ text, files: [], links: [], search: false, think: false })
  }
  let metadata: MessageMetadata = {}
  try {
    const parsed = JSON.parse(message.metadata)
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) metadata = parsed
  } catch {
    /* Preserve readable legacy content without treating malformed metadata as authority. */
  }
  if (message.status === 'pending' && message.role === 'assistant') metadata.runOutcome = 'aborted'
  return {
    ...message,
    content,
    metadata: JSON.stringify(metadata),
    status: message.status === 'pending' ? 'error' : message.status
  }
}

/** Rebuild a sealed imported view solely from namespaced native facts. */
export function projectDimHistory(
  binding: DimSessionBinding,
  seal: DimEvent,
  read: (key: string) => DimEvent | null
): { messages: ChatMessageRecord[]; keys: string[] } {
  const { snapshot, keys } = readDimImportedSnapshot(binding, seal, read)
  const ids = new Set<string>()
  let previous = 0
  const messages = snapshot.messages.map((message) => {
    if (
      !message.id ||
      ids.has(message.id) ||
      message.sessionId !== binding.sessionId ||
      !Number.isSafeInteger(message.orderSeq) ||
      message.orderSeq <= previous
    )
      throw new Error('Invalid native imported message identity')
    ids.add(message.id)
    previous = message.orderSeq
    const metadata = JSON.parse(message.metadata) as MessageMetadata
    return {
      ...message,
      metadata: JSON.stringify({
        ...metadata,
        dim: {
          sessionId: binding.dimSessionId,
          branchId: binding.branchId,
          eventId: seal.id,
          sequence: String(seal.sequence),
          revision: 0,
          imported: true,
          ...(metadata.dim
            ? {
                source: {
                  sessionId: (metadata.dim.source ?? metadata.dim).sessionId,
                  branchId: (metadata.dim.source ?? metadata.dim).branchId,
                  eventId: (metadata.dim.source ?? metadata.dim).eventId,
                  sequence: (metadata.dim.source ?? metadata.dim).sequence
                }
              }
            : {})
        }
      })
    }
  })
  return { messages, keys }
}

export function readDimImportedSnapshot(
  binding: DimSessionBinding,
  seal: DimEvent,
  read: (key: string) => DimEvent | null
): { snapshot: DimHistorySnapshot; keys: string[] } {
  const { migrationId, chunks, digest, productSessionId } = seal.data
  if (
    typeof migrationId !== 'string' ||
    typeof chunks !== 'number' ||
    !Number.isInteger(chunks) ||
    chunks < 1 ||
    chunks > 2048 ||
    productSessionId !== binding.sessionId
  )
    throw new Error('Invalid native history seal')
  const keys = Array.from({ length: chunks }, (_, index) => `history:${migrationId}:${index}`)
  const payload = keys
    .map((key) => {
      const chunk = read(key)
      if (typeof chunk?.data.payload !== 'string')
        throw new Error('Native history projection is missing a chunk')
      return chunk.data.payload
    })
    .join('')
  if (dimHistoryHash(payload) !== digest)
    throw new Error('Native history projection digest mismatch')
  const snapshot = JSON.parse(payload) as DimHistorySnapshot
  if (
    snapshot.formatVersion !== 1 ||
    snapshot.productSessionId !== binding.sessionId ||
    !Array.isArray(snapshot.messages) ||
    snapshot.messages.length !== seal.data.messages
  )
    throw new Error('Invalid native imported history')
  return { snapshot, keys }
}
