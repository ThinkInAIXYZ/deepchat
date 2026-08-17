import type {
  DeepChatTapeEntryKind,
  DeepChatTapeReadSource,
  DeepChatTapeSearchInput,
  DeepChatTapeSourceType
} from '../domain/entry'
import type {
  CompactionUsagePersistenceStore,
  ExecutionJournalPersistenceStore,
  ProviderAttemptPersistenceStore,
  TapeBootstrapStore,
  TapeBootstrapIncarnationReader,
  TapeEntryLifecycleStore,
  TapeEntryStore,
  ToolSurfacePersistenceStore,
  TapeTransactionRunner
} from './storage'
import type { SkillMaterializationPersistenceStore } from './storage'

export interface TapeSearchProjectionInput {
  sessionId: string
  entryId: number
  kind: DeepChatTapeEntryKind
  name: string | null
  sourceType: DeepChatTapeSourceType | null
  sourceId: string | null
  sourceSeq: number | null
  searchText: string
  summaryText: string
  refs: Record<string, unknown>
  createdAt: number
}

export interface TapeSearchProjectionRow {
  session_id: string
  entry_id: number
  kind: DeepChatTapeEntryKind
  name: string | null
  source_type: DeepChatTapeSourceType | null
  source_id: string | null
  source_seq: number | null
  search_text: string
  summary_text: string
  refs_json: string
  created_at: number
}

export interface TapeSearchProjectionResultRow extends TapeSearchProjectionRow {
  score: number | null
}

export interface TapeSearchProjectionMeta {
  projectionVersion: number
  maxEntryId: number
}

export interface TapeSearchProjectionReadResult {
  rows: TapeSearchProjectionResultRow[]
  coveredSources: DeepChatTapeReadSource[]
}

export interface TapeSearchProjectionStore {
  getSessionMeta(sessionId: string): TapeSearchProjectionMeta | null
  isCurrent(sessionId: string, maxEntryId: number, projectionVersion?: number): boolean
  getProjectedEntryIds(sessionId: string): number[]
  appendSession(
    sessionId: string,
    rows: TapeSearchProjectionInput[],
    maxEntryId: number,
    projectionVersion?: number
  ): void
  replaceSession(
    sessionId: string,
    rows: TapeSearchProjectionInput[],
    maxEntryId: number,
    projectionVersion?: number
  ): void
  getByEntryIdsIfCurrent(
    sessionId: string,
    maxEntryId: number,
    entryIds: number[],
    projectionVersion?: number
  ): TapeSearchProjectionRow[]
  searchSourcesReadOnly(
    sources: readonly DeepChatTapeReadSource[],
    query: string,
    options?: DeepChatTapeSearchInput
  ): TapeSearchProjectionReadResult
  search(
    sessionId: string,
    query: string,
    options?: DeepChatTapeSearchInput
  ): TapeSearchProjectionResultRow[]
  deleteBySession(sessionId: string): void
}

export interface TapeLineageSessionRow {
  id: string
  session_kind: 'regular' | 'subagent'
  parent_session_id: string | null
}

export interface TapeLineageSessionReader {
  get(sessionId: string): TapeLineageSessionRow | undefined
  getMany(sessionIds: string[]): TapeLineageSessionRow[]
}

export interface TapeLegacySummaryState {
  summary_text: string | null
  summary_cursor_order_seq: number | null
  summary_updated_at: number | null
}

export interface TapeLegacySummaryReader {
  getSummaryState(sessionId: string): TapeLegacySummaryState | null
}

export interface TapeMessageTraceRow {
  id: string
  message_id: string
  session_id: string
  provider_id: string
  model_id: string
  request_seq: number
  logical_round: number | null
  physical_attempt: number | null
  endpoint: string
  headers_json: string
  body_json: string
  truncated: number
  created_at: number
}

export interface TapeMessageTraceReader {
  listByMessageId(messageId: string): TapeMessageTraceRow[]
  listInspectorMetadata(input: TapeInspectorTraceMetadataPageInput): TapeInspectorTraceMetadataPage
  countInspectorBindings(
    sessionId: string,
    bindings: readonly TapeInspectorTraceBinding[]
  ): TapeInspectorTraceBindingCount[]
}

export type TapeInspectorTraceBinding =
  | {
      scope: 'request'
      messageId: string
      requestSeq: number
    }
  | {
      scope: 'attempt'
      messageId: string
      requestSeq: number
      physicalAttempt: number | null
    }

export type TapeInspectorTraceBindingCount = TapeInspectorTraceBinding & { count: number }

export type TapeInspectorTraceMetadataRow = Pick<
  TapeMessageTraceRow,
  | 'id'
  | 'message_id'
  | 'session_id'
  | 'provider_id'
  | 'model_id'
  | 'request_seq'
  | 'logical_round'
  | 'physical_attempt'
  | 'truncated'
  | 'created_at'
>

interface TapeInspectorTraceMetadataPageBaseInput {
  sessionId: string
  limit: number
  messageId?: string
  requestSeq?: number
  physicalAttempt?: number | null
}

export type TapeInspectorTraceMetadataPageInput = TapeInspectorTraceMetadataPageBaseInput &
  (
    | { mode: 'older'; cursor?: { createdAt: number; traceId: string } }
    | { mode: 'newer'; cursor?: { rowId: number } }
  )

export interface TapeInspectorTraceMetadataPage {
  rows: Array<TapeInspectorTraceMetadataRow & { row_id: number }>
  hasMore: boolean
  appendCursorRowId: number | null
}

export interface TapeTerminalMessageRow {
  session_id: string
  order_seq: number
  role: 'user' | 'assistant'
  content: string
  status: 'pending' | 'sent' | 'error'
  metadata: string
  created_at: number
  updated_at: number
}

export interface TapeTerminalMessageReader {
  get(messageId: string): TapeTerminalMessageRow | undefined
}

export type TapeApplicationEntryStore = TapeEntryStore &
  TapeTransactionRunner &
  TapeBootstrapStore &
  ToolSurfacePersistenceStore &
  TapeBootstrapIncarnationReader

export interface TapeApplicationDatabase {
  readonly deepchatTapeEntriesTable: TapeApplicationEntryStore &
    SkillMaterializationPersistenceStore &
    ProviderAttemptPersistenceStore &
    CompactionUsagePersistenceStore
  readonly deepchatExecutionJournalStore: ExecutionJournalPersistenceStore
  readonly tapeLifecycle: TapeEntryLifecycleStore
  readonly deepchatTapeSearchProjectionTable: TapeSearchProjectionStore
  readonly newSessionsTable: TapeLineageSessionReader
  readonly deepchatSessionsTable: TapeLegacySummaryReader
  readonly deepchatMessageTracesTable: TapeMessageTraceReader
  readonly deepchatMessagesTable: TapeTerminalMessageReader
}

export interface TapeApplicationProviders {
  getEntryStore(): TapeApplicationEntryStore
  getSkillMaterializationStore(): SkillMaterializationPersistenceStore
  getProviderAttemptStore(): ProviderAttemptPersistenceStore
  getCompactionUsageStore(): CompactionUsagePersistenceStore
  getEntryLifecycleStore(): TapeEntryLifecycleStore
  getSearchProjectionStore(): TapeSearchProjectionStore
  getLineageSessionReader(): TapeLineageSessionReader
  getLegacySummaryReader(): TapeLegacySummaryReader
  getMessageTraceReader(): TapeMessageTraceReader
  getTerminalMessageReader(): TapeTerminalMessageReader
}

export function createTapeApplicationProviders(
  database: TapeApplicationDatabase
): TapeApplicationProviders {
  return {
    getEntryStore: () => database.deepchatTapeEntriesTable,
    getSkillMaterializationStore: () => database.deepchatTapeEntriesTable,
    getProviderAttemptStore: () => database.deepchatTapeEntriesTable,
    getCompactionUsageStore: () => database.deepchatTapeEntriesTable,
    getEntryLifecycleStore: () => database.tapeLifecycle,
    getSearchProjectionStore: () => database.deepchatTapeSearchProjectionTable,
    getLineageSessionReader: () => database.newSessionsTable,
    getLegacySummaryReader: () => database.deepchatSessionsTable,
    getMessageTraceReader: () => database.deepchatMessageTracesTable,
    getTerminalMessageReader: () => database.deepchatMessagesTable
  }
}
