import type { AgentTapeAnchorResult } from '@shared/types/agent-interface'
import type { TapeMigrationState } from '../ports/capabilities'

export type {
  TapeBackfillResult,
  TapeMigrationState,
  TapeViewManifestAssemblySources
} from '../ports/capabilities'

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
