import { SQLitePresenter } from '../sqlitePresenter'
import type { PermissionMode } from '@shared/types/agent-interface'

export class DeepChatSessionStore {
  private sqlitePresenter: SQLitePresenter

  constructor(sqlitePresenter: SQLitePresenter) {
    this.sqlitePresenter = sqlitePresenter
  }

  create(
    id: string,
    providerId: string,
    modelId: string,
    permissionMode: PermissionMode = 'full_access'
  ): void {
    this.sqlitePresenter.deepchatSessionsTable.create(id, providerId, modelId, permissionMode)
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
}
