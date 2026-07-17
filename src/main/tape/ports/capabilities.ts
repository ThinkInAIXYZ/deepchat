import type { ChatMessageRecord } from '@shared/types/agent-interface'
import type { DeepChatTapeEntryRow, TapeAnchorAppendInput } from '../domain/entry'
import type { TapeEntryRef, TapeToolFactInput } from '../domain/facts'

export interface TapeToolFactWriter {
  appendToolFact(input: TapeToolFactInput): Promise<TapeEntryRef>
}

export interface TapeMessageFactWriter {
  appendMessageRecord(record: ChatMessageRecord): number
  appendMessageReplacement(record: ChatMessageRecord, reason: string): number
  appendMessageRetraction(record: ChatMessageRecord, reason: string): number
}

export interface TapeRawEntryReader {
  getBySession(sessionId: string): DeepChatTapeEntryRow[]
  getBySessionUpToEntryId(sessionId: string, maxEntryId: number): DeepChatTapeEntryRow[]
  getMaxEntryId(sessionId: string): number
}

export interface TapeAnchorReader {
  getLatestAnchor(sessionId: string): DeepChatTapeEntryRow | undefined
  getAnchors(sessionId: string, limit?: number): DeepChatTapeEntryRow[]
  getLatestSummaryAnchor(sessionId: string): DeepChatTapeEntryRow | undefined
  getLatestReconstructionAnchor(sessionId: string): DeepChatTapeEntryRow | undefined
}

export interface TapeAnchorWriter {
  appendAnchor(input: TapeAnchorAppendInput): DeepChatTapeEntryRow
}

export interface TapeInspectionReader {
  getBySession(sessionId: string): DeepChatTapeEntryRow[]
  listMemoryViewManifestAnchorsByAgent(
    agentId: string,
    options?: { sessionId?: string; limit?: number; messageId?: string }
  ): DeepChatTapeEntryRow[]
}

export interface TapeLifecycleAdmin {
  initializeSessionTape(sessionId: string): void
  deleteSessionTape(sessionId: string): void
  resetSessionTape(sessionId: string): void
}
