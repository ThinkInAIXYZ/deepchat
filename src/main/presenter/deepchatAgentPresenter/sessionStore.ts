import { SQLitePresenter } from '../sqlitePresenter'

export class DeepChatSessionStore {
  private sqlitePresenter: SQLitePresenter

  constructor(sqlitePresenter: SQLitePresenter) {
    this.sqlitePresenter = sqlitePresenter
  }

  create(id: string, providerId: string, modelId: string): void {
    this.sqlitePresenter.deepchatSessionsTable.create(id, providerId, modelId)
  }

  get(id: string) {
    return this.sqlitePresenter.deepchatSessionsTable.get(id)
  }

  delete(id: string): void {
    this.sqlitePresenter.deepchatSessionsTable.delete(id)
  }
}
