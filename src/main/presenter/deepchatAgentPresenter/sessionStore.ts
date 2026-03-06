import { SQLitePresenter } from '../sqlitePresenter'
import type { PermissionMode, SessionGenerationSettings } from '@shared/types/agent-interface'
import type { DeepChatSessionSummaryRow } from '../sqlitePresenter/tables/deepchatSessions'

export type SessionSummaryState = {
  summaryText: string | null
  summaryCursorOrderSeq: number
  summaryUpdatedAt: number | null
}

function normalizeSummaryState(row: DeepChatSessionSummaryRow | null): SessionSummaryState {
  return {
    summaryText: row?.summary_text ?? null,
    summaryCursorOrderSeq: Math.max(1, row?.summary_cursor_order_seq ?? 1),
    summaryUpdatedAt: row?.summary_updated_at ?? null
  }
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
  }

  get(id: string) {
    return this.sqlitePresenter.deepchatSessionsTable.get(id)
  }

  delete(id: string): void {
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
    return normalizeSummaryState(this.sqlitePresenter.deepchatSessionsTable.getSummaryState(id))
  }

  updateSummaryState(id: string, state: SessionSummaryState): void {
    this.sqlitePresenter.deepchatSessionsTable.updateSummaryState(id, state)
  }

  resetSummaryState(id: string): void {
    this.sqlitePresenter.deepchatSessionsTable.resetSummaryState(id)
  }
}
