import type {
  DeepChatTapeViewManifestIntegrity,
  DeepChatTapeViewManifestRecord
} from './tape-view-manifest'

export interface DeepChatTapeReplayExportOptions {
  requestSeq?: number
  includeTapePayloads?: boolean
  includeTracePayload?: boolean
}

export type DeepChatCausalObservationRuntimeStatus = 'idle' | 'generating' | 'error'

export interface DeepChatCausalObservationReadOptions extends DeepChatTapeReplayExportOptions {
  currentRuntimeStatus?: DeepChatCausalObservationRuntimeStatus
}

export interface DeepChatTapeReplayTraceSnapshot {
  id: string
  requestSeq: number
  logicalRound: number | null
  physicalAttempt: number | null
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
  skillContextEntryIds?: number[]
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

export type DeepChatCausalObservationRequest =
  | {
      state: 'manifest_bound'
      requestSeq: number
      replay: DeepChatTapeReplaySlice
    }
  | {
      state: 'manifest_missing' | 'manifest_malformed'
      requestSeq: number
      trace: DeepChatTapeReplayTraceSnapshot | null
    }
  | {
      state: 'request_unavailable'
      requestSeq: null
      trace: null
    }

export interface DeepChatCausalObservationTerminalMessage {
  status: 'sent' | 'error'
  orderSeq: number
  createdAt: number
  updatedAt: number
  contentHash: string
  metadataHash: string
}

export interface DeepChatCausalObservationOutput {
  correlation: 'message_only'
  entries: DeepChatTapeReplayEntrySnapshot[]
  terminalMessage: DeepChatCausalObservationTerminalMessage | null
}

export type DeepChatCausalObservationRuntime =
  | {
      scope: 'current_only'
      status: DeepChatCausalObservationRuntimeStatus
      eventHistory: 'not_persisted'
    }
  | {
      scope: 'unavailable'
      status: null
      eventHistory: 'not_persisted'
    }

export interface DeepChatCausalObservationSlice {
  schemaVersion: 1
  sessionId: string
  messageId: string
  request: DeepChatCausalObservationRequest
  output: DeepChatCausalObservationOutput
  runtime: DeepChatCausalObservationRuntime
}
