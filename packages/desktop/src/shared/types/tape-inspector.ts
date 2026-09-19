import type { JsonValue } from '../contracts/json'

export type TapeInspectorEntryKind =
  | 'event'
  | 'anchor'
  | 'message'
  | 'tool_call'
  | 'tool_result'
  | 'context'

export type TapeInspectorSourceType =
  | 'session'
  | 'message'
  | 'assistant_block'
  | 'tool_call'
  | 'tool_result'
  | 'runtime_event'
  | 'migration'
  | 'summary'
  | 'fork'
  | 'subagent'

export type TapeInspectorFactFamily =
  | 'context'
  | 'journal'
  | 'contract'
  | 'view'
  | 'attempt'
  | 'anchor'
  | 'message'
  | 'lineage'
  | 'tool'
  | 'other'

export interface TapeInspectorUsageFacts {
  inputTokens: number
  outputTokens: number
  totalTokens: number
  cacheReadTokens?: number
  cacheWriteTokens?: number
}

export interface TapeInspectorFacts {
  toolName?: string
  toolSource?: 'agent' | 'mcp'
  targetServer?: string
  contentPreview?: string
  providerId?: string
  modelId?: string
  status?: string
  outcome?: string
  stopReason?: string
  retryDecision?: string
  errorCode?: string
  isError?: boolean
  selectedCount?: number
  droppedCount?: number
  tokenBudget?: number
  estimatedTokens?: number
  usage?: TapeInspectorUsageFacts
}

export interface TapeInspectorFactRecord {
  recordType: 'fact'
  key: `entry:${number}`
  entryId: number
  kind: TapeInspectorEntryKind
  family: TapeInspectorFactFamily
  name: string | null
  sourceType?: TapeInspectorSourceType
  sourceId?: string
  sourceSeq?: number
  createdAt: number
  runId?: string
  messageId?: string
  requestSeq?: number
  logicalRound?: number
  physicalAttempt?: number
  providerToolCallId?: string
  childOrdinal?: number
  facts?: TapeInspectorFacts
  hashes?: {
    payloadHash?: string
    metaHash?: string
    manifestHash?: string
  }
  integrity?: 'valid' | 'invalid' | 'unverified'
  traceEvidenceCount?: number
}

export type TapeInspectorPageMode = 'tail' | 'older' | 'newer'

export type TapeInspectorSort =
  | { column: 'entryId'; direction: 'asc' }
  | { column: 'name' | 'kind' | 'createdAt'; direction: 'asc' | 'desc' }

export type TapeInspectorEntryCursor =
  | { sort: 'entryId'; entryId: number }
  | {
      sort: 'name'
      direction: 'asc' | 'desc'
      nameHash: string
      entryId: number
      snapshotMaxEntryId: number
    }
  | {
      sort: 'kind'
      direction: 'asc' | 'desc'
      kind: TapeInspectorEntryKind
      entryId: number
      snapshotMaxEntryId: number
    }
  | {
      sort: 'createdAt'
      direction: 'asc' | 'desc'
      createdAt: number
      entryId: number
      snapshotMaxEntryId: number
    }

export interface TapeInspectorHead {
  tapeIncarnationId: string
  maxEntryId: number
}

export interface TapeInspectorHeadPulse extends TapeInspectorHead {
  sessionId: string
}

export interface TapeInspectorFactFilters {
  kinds?: TapeInspectorEntryKind[]
  families?: TapeInspectorFactFamily[]
  name?: string
  namePrefix?: string
  factStatus?: string
  errorsOnly?: boolean
  messageId?: string
  requestSeq?: number
}

interface ListTapeInspectorPageInputBase {
  sessionId: string
  expectedTapeIncarnationId?: string
  limit?: number
  filters?: TapeInspectorFactFilters
  sort?: TapeInspectorSort
}

export type ListTapeInspectorPageInput =
  | (ListTapeInspectorPageInputBase & {
      mode: 'tail'
      cursor?: never
    })
  | (ListTapeInspectorPageInputBase & {
      expectedTapeIncarnationId: string
      mode: Exclude<TapeInspectorPageMode, 'tail'>
      cursor: TapeInspectorEntryCursor
    })

export type ListTapeInspectorPageOutput =
  | {
      status: 'ok'
      tapeIncarnationId: string
      snapshotMaxEntryId: number
      records: TapeInspectorFactRecord[]
      nextCursor: TapeInspectorEntryCursor | null
    }
  | {
      status: 'reset'
      tapeIncarnationId: string
      snapshotMaxEntryId: number
    }

export interface TapeInspectorEvidenceRecord {
  recordType: 'evidence'
  key: `trace:${string}`
  traceId: string
  messageId: string
  /** Zero is the persisted sentinel for diagnostic evidence without a request identity. */
  requestSeq: number
  logicalRound?: number
  physicalAttempt?: number
  providerId: string
  modelId: string
  createdAt: number
  truncated: boolean
}

export interface TapeInspectorEvidenceCursor {
  createdAt: number
  traceId: string
}

export interface TapeInspectorEvidenceAppendCursor {
  rowId: number
}

interface ListTapeInspectorEvidenceBaseInput {
  sessionId: string
  limit?: number
  messageId?: string
  requestSeq?: number
  physicalAttempt?: number | null
}

export type ListTapeInspectorEvidenceInput = ListTapeInspectorEvidenceBaseInput &
  (
    | { mode: 'older'; cursor?: TapeInspectorEvidenceCursor }
    | { mode: 'newer'; cursor?: TapeInspectorEvidenceAppendCursor }
  )

export interface ListTapeInspectorEvidenceOutput {
  records: TapeInspectorEvidenceRecord[]
  nextCursor: TapeInspectorEvidenceCursor | null
  newerCursor: TapeInspectorEvidenceAppendCursor | null
}

export interface TapeInspectorEvidenceEntryIdentity {
  messageId: string
  requestSeq: number
  physicalAttempt: number
}

export interface TapeInspectorEvidenceEntryResolution extends TapeInspectorEvidenceEntryIdentity {
  entryId: number | null
}

export interface ResolveTapeInspectorEvidenceEntriesInput {
  sessionId: string
  expectedTapeIncarnationId: string
  identities: TapeInspectorEvidenceEntryIdentity[]
}

export type ResolveTapeInspectorEvidenceEntriesOutput =
  | {
      status: 'ok'
      tapeIncarnationId: string
      resolutions: TapeInspectorEvidenceEntryResolution[]
    }
  | {
      status: 'reset'
      tapeIncarnationId: string
    }

export interface TapeInspectorRecordDetail {
  record: TapeInspectorFactRecord
  disclosure: 'structured' | 'metadata_only'
  provenance: {
    sourceType?: TapeInspectorSourceType
    sourceId?: string
    sourceSeq?: number
    provenanceKey?: string
  }
  hashes: {
    payloadHash: string
    metaHash: string
  }
  sizes: {
    payloadBytes: number
    metaBytes: number
  }
  data?: JsonValue
}

export interface GetTapeInspectorRecordDetailInput {
  sessionId: string
  expectedTapeIncarnationId: string
  entryId: number
}

export type GetTapeInspectorRecordDetailOutput =
  | {
      status: 'ok'
      tapeIncarnationId: string
      detail: TapeInspectorRecordDetail
    }
  | {
      status: 'not_found'
      tapeIncarnationId: string
    }
  | {
      status: 'reset'
      tapeIncarnationId: string
    }

export const TAPE_INSPECTOR_SUPPORT_FACT_LIMIT = 200
export const TAPE_INSPECTOR_SUPPORT_EVIDENCE_LIMIT = 200
export const TAPE_INSPECTOR_SUPPORT_DETAIL_DATA_BYTES = 256 * 1024

export interface ExportTapeInspectorSupportFactsInput {
  sessionId: string
  expectedTapeIncarnationId: string
}

export type ExportTapeInspectorSupportFactsOutput =
  | {
      status: 'ok'
      tapeIncarnationId: string
      snapshotMaxEntryId: number
      facts: TapeInspectorRecordDetail[]
      factsTruncated: boolean
      detailDataTruncated: boolean
    }
  | {
      status: 'reset'
      tapeIncarnationId: string
      snapshotMaxEntryId: number
    }

export interface TapeInspectorSupportTrace {
  schemaVersion: 1
  exportedAt: number
  sessionId: string
  tapeIncarnationId: string
  snapshotMaxEntryId: number
  facts: TapeInspectorRecordDetail[]
  evidence: TapeInspectorEvidenceRecord[]
  truncated: {
    facts: boolean
    evidence: boolean
    detailData: boolean
  }
}

export type ExportTapeInspectorSupportTraceInput = ExportTapeInspectorSupportFactsInput

export type ExportTapeInspectorSupportTraceOutput =
  | {
      status: 'ok'
      trace: TapeInspectorSupportTrace
    }
  | {
      status: 'reset'
      tapeIncarnationId: string
      snapshotMaxEntryId: number
    }
