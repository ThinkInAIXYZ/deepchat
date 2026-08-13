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
import type { ContractTapeEventName } from '../domain/contractFacts'
import type { TapeSkillMaterializationPayload } from '../domain/skillMaterialization'

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
  getBySessionExcludingContext(sessionId: string): DeepChatTapeEntryRow[]
  getByEntryIds(sessionId: string, entryIds: readonly number[]): DeepChatTapeEntryRow[]
  getMessageSourceEntries(sessionId: string, messageId: string): DeepChatTapeEntryRow[]
  getViewManifestEventsByMessage(sessionId: string, messageId: string): DeepChatTapeEntryRow[]
  getMaxEventSourceSeq(
    sessionId: string,
    name: string,
    sourceType: DeepChatTapeSourceType,
    sourceId: string
  ): number
  getSubagentLineageEvents(sessionId: string): DeepChatTapeEntryRow[]
  getFirstEntriesBySessions(sessionIds: string[]): DeepChatTapeEntryRow[]
  getBySessionUpToEntryIdExcludingContext(
    sessionId: string,
    maxEntryId: number
  ): DeepChatTapeEntryRow[]
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
  getMaxEntryIdExcludingContext(sessionId: string): number
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

export interface TapeBootstrapIncarnationReader {
  getBootstrapIncarnation(sessionId: string): string | undefined
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

/** Strict contract facts share the caller's host transaction and have their own namespace gate. */
export interface ContractPersistenceStore extends TapeTransactionRunner, TapeBootstrapStore {
  appendContractEvent(
    input: TapeEventAppendInput & { name: ContractTapeEventName }
  ): DeepChatTapeEntryRow
  getByProvenanceKey(sessionId: string, provenanceKey: string): DeepChatTapeEntryRow | undefined
  getFirstEntriesBySessions(sessionIds: string[]): DeepChatTapeEntryRow[]
}

/** The reserved Skill context namespace is writable only through the strict materialization path. */
export interface SkillMaterializationPersistenceStore
  extends TapeTransactionRunner, TapeBootstrapStore, TapeBootstrapIncarnationReader {
  appendSkillMaterialization(input: {
    sessionId: string
    sourceId: string
    provenanceKey: string
    payload: TapeSkillMaterializationPayload
    payloadHash: string
  }): DeepChatTapeEntryRow
  getByProvenanceKey(sessionId: string, provenanceKey: string): DeepChatTapeEntryRow | undefined
  getByEntryId(sessionId: string, entryId: number): DeepChatTapeEntryRow | undefined
}

export interface TapeEntryLifecycleStore {
  deleteBySession(sessionId: string): void
}
