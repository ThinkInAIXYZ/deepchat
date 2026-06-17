import type {
  DeepChatTapeViewManifestIntegrity,
  DeepChatTapeViewManifestRecord
} from './tape-view-manifest'

export interface DeepChatTapeReplayExportOptions {
  requestSeq?: number
  includeTapePayloads?: boolean
  includeTracePayload?: boolean
}

export interface DeepChatTapeReplayTraceSnapshot {
  id: string
  requestSeq: number
  providerId: string
  modelId: string
  endpoint: string
  headersHash: string
  bodyHash: string
  truncated: boolean
  createdAt: number
  headersJson?: string
  bodyJson?: string
}

export interface DeepChatTapeReplayEntrySnapshot {
  entryId: number
  kind: string
  name: string | null
  sourceType: string | null
  sourceId: string | null
  sourceSeq: number | null
  provenanceKey: string | null
  payloadHash: string
  metaHash: string
  createdAt: number
  payload?: Record<string, unknown>
  meta?: Record<string, unknown>
}

export interface DeepChatTapeReplaySliceRefs {
  manifestEntryId: number
  includedEntryIds: number[]
  excludedEntryIds: number[]
  anchorEntryIds: number[]
}

export interface DeepChatTapeReplaySliceHashes {
  manifestHash: string
  sliceHash: string
}

export interface DeepChatTapeReplaySlice {
  schemaVersion: 1
  sliceId: string
  sessionId: string
  messageId: string
  requestSeq: number
  mode: 'manifest_only' | 'trace_bound'
  manifestRecord: DeepChatTapeViewManifestRecord
  trace: DeepChatTapeReplayTraceSnapshot | null
  entries: DeepChatTapeReplayEntrySnapshot[]
  refs: DeepChatTapeReplaySliceRefs
  hashes: DeepChatTapeReplaySliceHashes
  integrity?: DeepChatTapeViewManifestIntegrity
  createdAt: number
}
