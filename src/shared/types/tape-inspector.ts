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
  providerId?: string
  modelId?: string
  status?: string
  outcome?: string
  stopReason?: string
  retryDecision?: string
  errorCode?: string
  isError?: boolean
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

export interface TapeInspectorEntryCursor {
  sort: 'entryId'
  entryId: number
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

export interface ListTapeInspectorEvidenceInput {
  sessionId: string
  cursor?: TapeInspectorEvidenceCursor
  limit?: number
  messageId?: string
  requestSeq?: number
  physicalAttempt?: number | null
}

export interface ListTapeInspectorEvidenceOutput {
  records: TapeInspectorEvidenceRecord[]
  nextCursor: TapeInspectorEvidenceCursor | null
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
