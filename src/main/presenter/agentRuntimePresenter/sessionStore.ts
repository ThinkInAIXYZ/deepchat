import { SQLitePresenter } from '../sqlitePresenter'
import type { PermissionMode, SessionGenerationSettings } from '@shared/types/agent-interface'
import type { DeepChatSessionSummaryRow } from '../sqlitePresenter/tables/deepchatSessions'
import type { DeepChatTapeEntryRow } from '../sqlitePresenter/tables/deepchatTapeEntries'

export type SessionSummaryState = {
  summaryText: string | null
  summaryCursorOrderSeq: number
  summaryUpdatedAt: number | null
}

export type ReconstructionAnchorPromptState = {
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

function normalizeSummaryState(row: DeepChatSessionSummaryRow | null): SessionSummaryState {
  return {
    summaryText: row?.summary_text ?? null,
    summaryCursorOrderSeq: Math.max(1, row?.summary_cursor_order_seq ?? 1),
    summaryUpdatedAt: row?.summary_updated_at ?? null
  }
}

function parseJsonObject(value: string): Record<string, unknown> | null {
  try {
    const parsed = JSON.parse(value) as unknown
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>
    }
  } catch {}

  return null
}

function resolveAnchorState(row: DeepChatTapeEntryRow): Record<string, unknown> | null {
  const payload = parseJsonObject(row.payload_json)
  const state = payload?.state
  if (state && typeof state === 'object' && !Array.isArray(state)) {
    return state as Record<string, unknown>
  }
  return null
}

function normalizeCursorOrderSeq(value: unknown): number {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return Math.max(1, Math.floor(value))
  }
  return 1
}

function summaryStateFromTapeAnchor(
  row: DeepChatTapeEntryRow | undefined
): SessionSummaryState | null {
  if (!row) {
    return null
  }

  if (row.name === 'summary/reset') {
    return {
      summaryText: null,
      summaryCursorOrderSeq: 1,
      summaryUpdatedAt: null
    }
  }

  const state = resolveAnchorState(row)
  const summary =
    typeof state?.summary === 'string'
      ? state.summary
      : typeof state?.summaryText === 'string'
        ? state.summaryText
        : null
  const cursorOrderSeq = normalizeCursorOrderSeq(
    state?.cursorOrderSeq ?? state?.summaryCursorOrderSeq
  )

  if (!summary?.trim()) {
    return {
      summaryText: null,
      summaryCursorOrderSeq: cursorOrderSeq,
      summaryUpdatedAt: null
    }
  }

  return {
    summaryText: summary,
    summaryCursorOrderSeq: cursorOrderSeq,
    summaryUpdatedAt: row.created_at
  }
}

function reconstructionAnchorPromptStateFromRow(
  row: DeepChatTapeEntryRow | undefined
): ReconstructionAnchorPromptState | null {
  if (!row?.name) {
    return null
  }

  const state = resolveAnchorState(row)
  if (!state) {
    return null
  }

  return {
    name: row.name,
    state,
    createdAt: row.created_at
  }
}

function summaryStatesEqual(left: SessionSummaryState, right: SessionSummaryState): boolean {
  return (
    (left.summaryText ?? null) === (right.summaryText ?? null) &&
    Math.max(1, left.summaryCursorOrderSeq) === Math.max(1, right.summaryCursorOrderSeq) &&
    (left.summaryUpdatedAt ?? null) === (right.summaryUpdatedAt ?? null)
  )
}

export class DeepChatSessionStore {
  private sqlitePresenter: SQLitePresenter

  constructor(sqlitePresenter: SQLitePresenter) {
    this.sqlitePresenter = sqlitePresenter
  }

  create(
    id: string,
    providerId: string,
    modelId: string,
    permissionMode: PermissionMode = 'full_access',
    generationSettings?: Partial<SessionGenerationSettings>
  ): void {
    this.sqlitePresenter.deepchatSessionsTable.create(
      id,
      providerId,
      modelId,
      permissionMode,
      generationSettings
    )
    this.sqlitePresenter.deepchatTapeEntriesTable?.ensureBootstrapAnchor(id)
  }

  get(id: string) {
    return this.sqlitePresenter.deepchatSessionsTable.get(id)
  }

  delete(id: string): void {
    this.sqlitePresenter.deepchatTapeEntriesTable?.deleteBySession(id)
    this.sqlitePresenter.deepchatTapeSearchProjectionTable?.deleteBySession(id)
    this.sqlitePresenter.deepchatSessionsTable.delete(id)
  }

  updatePermissionMode(id: string, mode: PermissionMode): void {
    this.sqlitePresenter.deepchatSessionsTable.updatePermissionMode(id, mode)
  }

  updateSessionModel(id: string, providerId: string, modelId: string): void {
    this.sqlitePresenter.deepchatSessionsTable.updateSessionModel(id, providerId, modelId)
  }

  getGenerationSettings(id: string): Partial<SessionGenerationSettings> | null {
    return this.sqlitePresenter.deepchatSessionsTable.getGenerationSettings(id)
  }

  updateGenerationSettings(id: string, settings: Partial<SessionGenerationSettings>): void {
    this.sqlitePresenter.deepchatSessionsTable.updateGenerationSettings(id, settings)
  }

  getSummaryState(id: string): SessionSummaryState {
    const tapeTable = this.sqlitePresenter.deepchatTapeEntriesTable
    const tapeState = summaryStateFromTapeAnchor(
      tapeTable?.getLatestReconstructionAnchor?.(id) ?? tapeTable?.getLatestSummaryAnchor(id)
    )
    if (tapeState) {
      return tapeState
    }

    return normalizeSummaryState(this.sqlitePresenter.deepchatSessionsTable.getSummaryState(id))
  }

  getReconstructionAnchorPromptState(id: string): ReconstructionAnchorPromptState | null {
    return reconstructionAnchorPromptStateFromRow(
      this.sqlitePresenter.deepchatTapeEntriesTable?.getLatestReconstructionAnchor?.(id)
    )
  }

  updateSummaryState(id: string, state: SessionSummaryState): void {
    this.sqlitePresenter.deepchatSessionsTable.updateSummaryState(id, state)
  }

  compareAndSetSummaryState(
    id: string,
    expectedState: SessionSummaryState,
    nextState: SessionSummaryState,
    tapeAnchor?: SummaryTapeAnchorInput
  ): SummaryStateCompareAndSetResult {
    const applyUpdate = (): boolean => {
      const tapeTable = this.sqlitePresenter.deepchatTapeEntriesTable
      const latestTapeAnchor =
        tapeTable?.getLatestReconstructionAnchor?.(id) ?? tapeTable?.getLatestSummaryAnchor(id)
      const currentState = this.getSummaryState(id)
      if (!summaryStatesEqual(currentState, expectedState)) {
        return false
      }
      if (!tapeAnchor && latestTapeAnchor) {
        return false
      }

      this.sqlitePresenter.deepchatSessionsTable.updateSummaryState(id, nextState)
      if (tapeAnchor && tapeTable) {
        tapeTable.appendAnchor({
          sessionId: id,
          name: tapeAnchor.name,
          state: tapeAnchor.state,
          meta: tapeAnchor.meta,
          createdAt: nextState.summaryUpdatedAt ?? undefined
        })
      }
      return true
    }

    const db = this.sqlitePresenter.getDatabase?.()
    const applied = db ? (db.transaction(applyUpdate)() as boolean) : applyUpdate()

    if (applied) {
      return {
        applied: true,
        currentState: this.getSummaryState(id)
      }
    }

    return {
      applied: false,
      currentState: this.getSummaryState(id)
    }
  }

  resetSummaryState(id: string): void {
    const reset = (): void => {
      this.sqlitePresenter.deepchatSessionsTable.resetSummaryState(id)
      this.sqlitePresenter.deepchatTapeEntriesTable?.appendAnchor({
        sessionId: id,
        name: 'summary/reset',
        state: {
          cursorOrderSeq: 1,
          reason: 'summary_reset'
        }
      })
    }
    const db = this.sqlitePresenter.getDatabase?.()
    if (db) {
      db.transaction(reset)()
      return
    }
    reset()
  }

  resetTape(id: string): void {
    this.sqlitePresenter.deepchatTapeEntriesTable?.deleteBySession(id)
    this.sqlitePresenter.deepchatTapeSearchProjectionTable?.deleteBySession(id)
    this.sqlitePresenter.deepchatTapeEntriesTable?.ensureBootstrapAnchor(id)
  }
}
