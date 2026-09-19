import type {
  AssistantMessageBlock,
  ChatMessageRecord,
  MessageMetadata,
  SessionCompactionBoundaryReason,
  UserMessageContent
} from '@deepchat/shared/types/agent-interface'
import type { SearchResult } from '@deepchat/shared/types/core/search'
import type { DeepChatTapeEntryRow } from '../tape/domain/entry.js'
import type { TapeCompactionModelCallInput } from '../tape/domain/compactionUsage.js'
import type { TapeProjectionCursor } from '../tape/ports/capabilities.js'

/**
 * Options for compaction marker messages. Structurally identical to the host transcript's
 * private options type; both sides stay compiler-checked against each other through the
 * structural assertion suite.
 */
export type TranscriptCompactionMessageOptions = {
  compactionAttemptId: string
  boundaryReason?: SessionCompactionBoundaryReason | null
  error?: string
}

/**
 * Durable transcript surface the built-in kernel needs. Declared here so kernel modules depend on
 * this structural port instead of the SQLite-backed host store; the host class implements it with
 * the same transaction boundaries (each method is a complete transaction unit).
 */
export interface TranscriptStorePort {
  readProjectionCursor(sessionId: string): TapeProjectionCursor | null
  writeProjectionCursor(sessionId: string, cursor: TapeProjectionCursor): void
  applyTapeEntries(rows: readonly DeepChatTapeEntryRow[]): void
  createUserMessage(
    sessionId: string,
    orderSeq: number,
    content: UserMessageContent,
    options?: {
      status?: 'pending' | 'sent'
      metadata?: MessageMetadata
    }
  ): string
  createAssistantMessage(sessionId: string, orderSeq: number): string
  createCompactionMessage(
    sessionId: string,
    orderSeq: number,
    status: 'compacting' | 'compacted',
    summaryUpdatedAt: number | null,
    options: TranscriptCompactionMessageOptions
  ): string
  createCompactionMessageAtOrderSeq(
    sessionId: string,
    orderSeq: number,
    status: 'compacting' | 'compacted',
    summaryUpdatedAt: number | null,
    options: TranscriptCompactionMessageOptions & { shiftExistingMessages?: boolean }
  ): string
  updateAssistantContent(
    messageId: string,
    blocks: AssistantMessageBlock[],
    metadata?: string
  ): void
  updateAssistantMetadata(messageId: string, metadata: string): void
  updateMessageStatus(messageId: string, status: 'pending'): void
  finalizeAssistantMessage(
    messageId: string,
    blocks: AssistantMessageBlock[],
    metadata: string
  ): void
  updateCompactionMessage(
    messageId: string,
    status: 'compacting' | 'compacted' | 'failed',
    summaryUpdatedAt: number | null,
    options: TranscriptCompactionMessageOptions
  ): void
  recordCompactionModelCall(input: TapeCompactionModelCallInput): void
  setMessageError(messageId: string, blocks: AssistantMessageBlock[], metadata?: string): void
  getMessages(sessionId: string): ChatMessageRecord[]
  getPendingAssistantMessages(sessionId: string): ChatMessageRecord[]
  getMessagesUpToOrderSeq(sessionId: string, maxOrderSeq: number): ChatMessageRecord[]
  getMessage(messageId: string): ChatMessageRecord | null
  getLastUserMessageBeforeOrAt(sessionId: string, orderSeq: number): ChatMessageRecord | null
  getNextOrderSeq(sessionId: string): number
  deleteBySession(sessionId: string): void
  deleteMessage(messageId: string): void
  deleteFromOrderSeq(sessionId: string, fromOrderSeq: number): void
  addSearchResult(row: {
    sessionId: string
    messageId: string
    searchId?: string | null
    rank?: number | null
    result: SearchResult
  }): void
  insertMessageTrace(row: {
    id: string
    messageId: string
    sessionId: string
    providerId: string
    modelId: string
    endpoint: string
    headersJson: string
    bodyJson: string
    truncated: boolean
    createdAt?: number
    requestSeq?: number
    logicalRound?: number | null
    physicalAttempt?: number | null
  }): number
  getMaxMessageTraceRequestSeq(messageId: string): number
  recoverPendingMessages(options?: {
    forceRecoverMessagesBySession?: ReadonlyMap<string, ReadonlySet<string>>
  }): number
  reconcileCompactionMessages(): { compacted: number; retracted: number; failed: number }
}
