import type {
  DeepChatTapeEntryKind,
  DeepChatTapeReadSource,
  DeepChatTapeSearchInput,
  DeepChatTapeSourceType
} from '../domain/entry'
import type {
  TapeBootstrapStore,
  TapeEntryLifecycleStore,
  TapeEntryStore,
  TapeTransactionRunner
} from './storage'

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
  endpoint: string
  headers_json: string
  body_json: string
  truncated: number
  created_at: number
}

export interface TapeMessageTraceReader {
  listByMessageId(messageId: string): TapeMessageTraceRow[]
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

export type TapeApplicationEntryStore = TapeEntryStore & TapeTransactionRunner & TapeBootstrapStore

export interface TapeApplicationDatabase {
  readonly deepchatTapeEntriesTable: TapeApplicationEntryStore
  readonly tapeLifecycle: TapeEntryLifecycleStore
  readonly deepchatTapeSearchProjectionTable: TapeSearchProjectionStore
  readonly newSessionsTable: TapeLineageSessionReader
  readonly deepchatSessionsTable: TapeLegacySummaryReader
  readonly deepchatMessageTracesTable: TapeMessageTraceReader
  readonly deepchatMessagesTable: TapeTerminalMessageReader
}

export interface TapeApplicationProviders {
  getEntryStore(): TapeApplicationEntryStore
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
    getEntryLifecycleStore: () => database.tapeLifecycle,
    getSearchProjectionStore: () => database.deepchatTapeSearchProjectionTable,
    getLineageSessionReader: () => database.newSessionsTable,
    getLegacySummaryReader: () => database.deepchatSessionsTable,
    getMessageTraceReader: () => database.deepchatMessageTracesTable,
    getTerminalMessageReader: () => database.deepchatMessagesTable
  }
}
