import type {
  DeepChatTapeAppendInput,
  DeepChatTapeEntryRow,
  DeepChatTapeReadSource,
  DeepChatTapeSearchInput,
  DeepChatTapeSourceType,
  TapeAnchorAppendInput,
  TapeEventAppendInput
} from '../domain/entry'
import type { ExecutionJournalEventName } from '../domain/executionJournal'

export interface TapeMutationProjection {
  applyAppendedEntry(row: DeepChatTapeEntryRow, previousSessionMaxEntryId: number): boolean
  invalidateSession(sessionId: string): void
  deleteBySession(sessionId: string): void
}

/** Append/read/query persistence only. Physical deletion belongs to TapeEntryLifecycleStore. */
export interface TapeEntryStore {
  append(input: DeepChatTapeAppendInput): DeepChatTapeEntryRow
  appendAnchor(input: TapeAnchorAppendInput): DeepChatTapeEntryRow
  appendEvent(input: TapeEventAppendInput): DeepChatTapeEntryRow
  getBySession(sessionId: string): DeepChatTapeEntryRow[]
  getMaxEventSourceSeq(
    sessionId: string,
    name: string,
    sourceType: DeepChatTapeSourceType,
    sourceId: string
  ): number
  getSubagentLineageEvents(sessionId: string): DeepChatTapeEntryRow[]
  getFirstEntriesBySessions(sessionIds: string[]): DeepChatTapeEntryRow[]
  getBySessionUpToEntryId(sessionId: string, maxEntryId: number): DeepChatTapeEntryRow[]
  listMemoryViewManifestAnchorsByAgent(
    agentId: string,
    options?: { sessionId?: string; limit?: number; messageId?: string }
  ): DeepChatTapeEntryRow[]
  getLatestAnchor(sessionId: string): DeepChatTapeEntryRow | undefined
  getAnchors(sessionId: string, limit?: number): DeepChatTapeEntryRow[]
  getLatestSummaryAnchor(sessionId: string): DeepChatTapeEntryRow | undefined
  getLatestReconstructionAnchor(sessionId: string): DeepChatTapeEntryRow | undefined
  getByProvenanceKey(sessionId: string, provenanceKey: string): DeepChatTapeEntryRow | undefined
  getMaxEntryId(sessionId: string): number
  getMaxEntryIdsBySessions(sessionIds: string[]): Map<string, number>
  countAnchorsBySession(sessionId: string): number
  countEntriesAfter(sessionId: string, entryId: number): number
  countBySession(sessionId: string): number
  search(
    sessionId: string,
    query: string,
    options?: DeepChatTapeSearchInput
  ): DeepChatTapeEntryRow[]
  searchEffectiveSourcesAtHeads(
    sources: readonly DeepChatTapeReadSource[],
    query: string,
    options?: DeepChatTapeSearchInput
  ): DeepChatTapeEntryRow[]
  getEffectiveContextRowsAtHead(
    source: DeepChatTapeReadSource,
    entryIds: number[],
    options: { before: number; after: number; limit: number }
  ): DeepChatTapeEntryRow[]
}

export interface TapeTransactionRunner {
  runInTransaction<T>(operation: () => T): T
  isInTransaction(): boolean
}

/** Transitional bootstrap capability until bootstrap orchestration lives in application services. */
export interface TapeBootstrapStore {
  ensureBootstrapAnchor(sessionId: string): void
}

/** Strict Journal persistence is intentionally absent from the generic Context Tape store port. */
export interface ExecutionJournalPersistenceStore
  extends TapeTransactionRunner, TapeBootstrapStore {
  appendExecutionJournalEvent(
    input: TapeEventAppendInput & { name: ExecutionJournalEventName }
  ): DeepChatTapeEntryRow
  listUnterminatedRunEvents(): Iterable<DeepChatTapeEntryRow>
  getByProvenanceKey(sessionId: string, provenanceKey: string): DeepChatTapeEntryRow | undefined
}

export interface TapeEntryLifecycleStore {
  deleteBySession(sessionId: string): void
}
