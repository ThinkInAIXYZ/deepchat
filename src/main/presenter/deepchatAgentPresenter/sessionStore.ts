import { SQLitePresenter } from '../sqlitePresenter'
import type { PermissionMode, SessionGenerationSettings } from '@shared/types/agent-interface'

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
}
