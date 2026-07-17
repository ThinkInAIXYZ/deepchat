import type { AgentTapeAnchorResult, ChatMessageRecord } from '@shared/types/agent-interface'

export type TapeMigrationState = 'none' | 'ready'

export type TapeBackfillResult = {
  sessionId: string
  migrationState: TapeMigrationState
  messageCount: number
  maxOrderSeq: number
  appendedFactCount: number
  historyRecords: ChatMessageRecord[]
}

export type TapeInfo = {
  sessionId: string
  entries: number
  anchors: number
  lastAnchor: string | null
  lastAnchorEntryId: number | null
  entriesSinceLastAnchor: number
  lastTokenUsage: number | null
  migrationState: TapeMigrationState
}

export type TapeSearchResult = {
  sessionId: string
  entryId: number
  kind: string
  name: string | null
  createdAt: number
  summary?: string
  refs?: Record<string, unknown>
  score?: number
}

export type TapeAnchorResult = AgentTapeAnchorResult

export type TapeForkHandle = {
  parentSessionId: string
  forkId: string
  forkSessionId: string
  parentHeadEntryId: number
}

export type TapeViewManifestSourceMaps = {
  latestEntryId: number
  anchorEntryIds: number[]
  reconstructionAnchorEntryIds: number[]
  reconstructionAnchorEntryId: number | null
  entryIdByMessageId: Map<string, number>
  toolCallEntryIdByToolId: Map<string, number>
  toolResultEntryIdByToolId: Map<string, number>
}
