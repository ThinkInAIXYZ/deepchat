import type {
  ChatMessageRecord,
  PendingSessionInputRecord,
  SendMessageInput
} from '@shared/types/agent-interface'
import type { JsonValue } from '@shared/contracts/json'
import type { SessionDatabase } from '@/session/data/database'
import type { DeepChatTapeEntryRow } from '@/tape/domain/entry'
import { buildEffectiveTapeView } from '@/tape/domain/effectiveView'
import { readTapeMessageRetractionId } from '@/tape/domain/effectiveSemantics'
import type { SessionSummaryState } from '@/session/data/contracts'
import { normalizeDimImportedMessage, type DimHistorySnapshot } from './historyImport'
import { parseAssistantBlocks, parseUserContent } from '@/session/data/messageContent'
import { readLegacyPluginHooks } from './legacyPluginHooks'
import { buildUserMessageContent } from '@/agent/shared/inputContent'
import { dimContentBlocks } from './auxiliaryModels'

interface LegacySourceOptions {
  database: SessionDatabase
  transcript: { getMessages(sessionId: string): ChatMessageRecord[] }
  tape: { getEffectiveViewInputRows(sessionId: string): DeepChatTapeEntryRow[] }
  summary: { getSummaryState(sessionId: string): SessionSummaryState }
  pending: {
    listPendingInputs(sessionId: string): PendingSessionInputRecord[]
    listMigrationInputs?(sessionId: string): PendingSessionInputRecord[]
  }
  images?(messages: ChatMessageRecord[]): Promise<Record<string, JsonValue[]>>
}

/** Convert persisted legacy user image representations to native image blocks. */
export function legacyImageBlocks(messages: ChatMessageRecord[]): Record<string, JsonValue[]> {
  const images: Record<string, JsonValue[]> = {}
  for (const message of messages) {
    if (message.role !== 'user') continue
    let input: SendMessageInput
    try {
      const parsed: unknown = JSON.parse(message.content)
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) continue
      input = parsed as SendMessageInput
    } catch {
      continue
    }
    try {
      const content = buildUserMessageContent(input, true, false, {
        includeImageData: true,
        includeFileContent: true
      })
      if (typeof content === 'string') continue
      const blocks = dimContentBlocks(content).filter((block) => block.type === 'image')
      if (blocks.length) images[message.id] = blocks
    } catch {
      // A malformed historical attachment must not block migration of the conversation.
    }
  }
  return images
}

/** Readable historical data only; original content remains available to the transcript/archive. */
export function legacyContextText(message: ChatMessageRecord): string {
  const normalized = normalizeDimImportedMessage(message)
  if (message.role === 'user') {
    const input = parseUserContent(normalized.content)
    if (!input) throw new Error(`Invalid legacy user content: ${message.id}`)
    // The canonical formatter retains non-data-URL audio content as a transcript. Old imports
    // can also contain bare base64 there, so keep historical audio metadata only.
    const files = input.files.map((file) =>
      [file.mimeType, file.type].some((type) => type?.startsWith('audio/')) ||
      /\.(mp3|wav|flac|m4a|mp4|ogg)$/i.test(file.path || file.name || '')
        ? { ...file, content: undefined }
        : file
    )
    const content = buildUserMessageContent({ ...input, files }, false, false, {
      includeImageData: false,
      includeAudioData: false,
      includeFileContent: false
    })
    if (typeof content !== 'string') throw new Error('Invalid legacy text projection')
    return content
  }
  return parseAssistantBlocks(normalized.content)
    .flatMap((block) => {
      if (block.type === 'action') return []
      if (block.type === 'tool_call' && block.tool_call) {
        const tool = block.tool_call
        return [
          [
            'Historical tool call/result (not executable):',
            `name: ${tool.name ?? ''}`,
            `id: ${tool.id ?? ''}`,
            `params: ${tool.params ?? ''}`,
            `response: ${tool.response ?? ''}`
          ].join('\n')
        ]
      }
      return ['content', 'reasoning_content', 'error'].includes(block.type) && block.content
        ? [`${block.type}: ${block.content}`]
        : []
    })
    .join('\n\n')
}

/** Read-only legacy conversion source. Browsing and startup never call this boundary. */
export class DimLegacySource {
  constructor(private readonly options: LegacySourceOptions) {}

  pendingInputs(sessionId: string): PendingSessionInputRecord[] {
    const records =
      this.options.pending.listMigrationInputs?.(sessionId) ??
      this.options.pending.listPendingInputs(sessionId)
    if (records.some((record) => record.sessionId !== sessionId))
      throw new Error('Legacy pending input belongs to another session')
    return records
  }

  async snapshot(sessionId: string): Promise<DimHistorySnapshot> {
    const snapshot = this.options.database.getDatabase().transaction((): DimHistorySnapshot => {
      const rows = this.options.tape.getEffectiveViewInputRows(sessionId)
      const effective = buildEffectiveTapeView(rows, { includePending: true }).messageRecords
      const removed = new Set(rows.map(readTapeMessageRetractionId).filter((id) => id !== null))
      const messages = new Map(effective.map((message) => [message.id, message]))
      // Pending assistants and pre-Tape rows may only exist in the old transcript. Explicit
      // retractions must still win over a stale cache; canonical Tape edits win over that cache.
      for (const message of this.options.transcript.getMessages(sessionId))
        if (!messages.has(message.id) && !removed.has(message.id)) messages.set(message.id, message)
      const summary = this.options.summary.getSummaryState(sessionId)
      const text = summary.summaryText?.trim() || null
      const contextFromOrderSeq = text ? Math.max(1, summary.summaryCursorOrderSeq) : 1
      if (!Number.isSafeInteger(contextFromOrderSeq))
        throw new Error('Invalid legacy conversation summary boundary')
      const ordered = [...messages.values()].sort((left, right) => left.orderSeq - right.orderSeq)
      if (ordered.some((message) => message.sessionId !== sessionId))
        throw new Error('Legacy content belongs to another session')
      const pendingInputs = this.pendingInputs(sessionId)
      if (pendingInputs.some((item) => item.sessionId !== sessionId))
        throw new Error('Legacy pending input belongs to another session')
      return {
        formatVersion: 1,
        productSessionId: sessionId,
        messages: ordered,
        contextText: Object.fromEntries(
          ordered.map((message) => [message.id, legacyContextText(message)])
        ),
        summary: text,
        contextFromOrderSeq,
        pendingInputs,
        pluginHookState: readLegacyPluginHooks(this.options.database, sessionId).map(
          (invocation) => ({
            name: invocation.hookId === '$session' ? 'plugin-hook-session' : 'plugin-hook',
            data:
              invocation.hookId === '$session'
                ? {
                    observationId: invocation.invocationId,
                    pluginId: invocation.pluginId,
                    digest: invocation.digest,
                    launchId: invocation.launchId,
                    legacy: invocation.legacy!
                  }
                : (invocation as unknown as JsonValue)
          })
        ),
        excludedContextMessageIds: ordered
          .filter(
            (message) =>
              message.role === 'user' &&
              pendingInputs.some((item) => item.messageIds.includes(message.id))
          )
          .map((message) => message.id),
        source: {
          kind: 'legacy',
          tapeHead: rows.reduce((head, row) => Math.max(head, row.entry_id), 0),
          summaryUpdatedAt: summary.summaryUpdatedAt
        }
      }
    })()
    // Selected inline image representations become part of the import digest. Path-only images
    // degrade to metadata; this boundary does not read arbitrary historical paths.
    if (this.options.images) snapshot.images = await this.options.images(snapshot.messages)
    return snapshot
  }
}
