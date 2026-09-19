import type {
  PermissionMode,
  SessionGenerationSettings
} from '@deepchat/shared/types/agent-interface'
import type { PersistedSessionGenerationRow } from '../runtime/generationSettings.js'

export type SessionSummaryState = {
  summaryText: string | null
  summaryCursorOrderSeq: number
  summaryUpdatedAt: number | null
}

export type ReconstructionAnchorPromptState = {
  entryId: number
  name: string
  state: Record<string, unknown>
  createdAt: number
}

export type SummaryStateCompareAndSetResult = {
  applied: boolean
  currentState: SessionSummaryState
}

export type SummaryTapeAnchorInput = {
  name: string
  state: Record<string, unknown>
  meta?: Record<string, unknown>
}

/**
 * Durable session settings surface the built-in kernel needs. Declared here so kernel modules
 * depend on this structural port instead of the SQLite-backed host store; the host class
 * implements it, and each method is a complete transaction unit.
 */
export interface SessionSettingsStorePort {
  create(
    id: string,
    providerId: string,
    modelId: string,
    permissionMode: PermissionMode,
    generationSettings?: Partial<SessionGenerationSettings>
  ): void
  get(id: string): PersistedSessionGenerationRow | undefined
  delete(id: string): void
  updatePermissionMode(id: string, mode: PermissionMode): void
  updateSessionModel(id: string, providerId: string, modelId: string): void
  getGenerationSettings(id: string): Partial<SessionGenerationSettings> | null
  updateGenerationSettings(id: string, settings: Partial<SessionGenerationSettings>): void
  updateSessionConfiguration(
    id: string,
    providerId: string,
    modelId: string,
    generationSettings: Partial<SessionGenerationSettings>,
    permissionMode?: PermissionMode
  ): void
  getSummaryState(id: string): SessionSummaryState
  getReconstructionAnchorPromptState(id: string): ReconstructionAnchorPromptState | null
  getReconstructionAnchorPromptStateByCompactionAttemptId(
    id: string,
    compactionAttemptId: string
  ): ReconstructionAnchorPromptState | null
  updateSummaryState(id: string, state: SessionSummaryState): void
  compareAndSetSummaryState(
    id: string,
    expectedState: SessionSummaryState,
    nextState: SessionSummaryState,
    tapeAnchor?: SummaryTapeAnchorInput
  ): SummaryStateCompareAndSetResult
  resetSummaryState(id: string): void
  resetTape(id: string): void
}
