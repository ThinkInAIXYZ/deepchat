import { nanoid } from 'nanoid'
import type { SQLitePresenter } from '../sqlitePresenter'
import type { SessionRecord } from '@shared/types/agent-interface'

export class NewSessionManager {
  private sqlitePresenter: SQLitePresenter
  // webContentsId → sessionId
  private windowBindings: Map<number, string | null> = new Map()

  constructor(sqlitePresenter: SQLitePresenter) {
    this.sqlitePresenter = sqlitePresenter
  }

  create(agentId: string, title: string, projectDir: string | null): string {
    const id = nanoid()
    this.sqlitePresenter.newSessionsTable.create(id, agentId, title, projectDir)
    return id
  }

  get(id: string): SessionRecord | null {
    const row = this.sqlitePresenter.newSessionsTable.get(id)
    if (!row) return null
    return {
      id: row.id,
      agentId: row.agent_id,
      title: row.title,
      projectDir: row.project_dir,
      isPinned: row.is_pinned === 1,
      createdAt: row.created_at,
      updatedAt: row.updated_at
    }
  }

  list(filters?: { agentId?: string; projectDir?: string }): SessionRecord[] {
    const rows = this.sqlitePresenter.newSessionsTable.list(filters)
    return rows.map((row) => ({
      id: row.id,
      agentId: row.agent_id,
      title: row.title,
      projectDir: row.project_dir,
      isPinned: row.is_pinned === 1,
      createdAt: row.created_at,
      updatedAt: row.updated_at
    }))
  }

  update(
    id: string,
    fields: Partial<Pick<SessionRecord, 'title' | 'projectDir' | 'isPinned'>>
  ): void {
    const dbFields: { title?: string; project_dir?: string | null; is_pinned?: number } = {}
    if (fields.title !== undefined) dbFields.title = fields.title
    if (fields.projectDir !== undefined) dbFields.project_dir = fields.projectDir
    if (fields.isPinned !== undefined) dbFields.is_pinned = fields.isPinned ? 1 : 0
    this.sqlitePresenter.newSessionsTable.update(id, dbFields)
  }

  delete(id: string): void {
    this.sqlitePresenter.newSessionsTable.delete(id)
  }

  // Window binding management
  bindWindow(webContentsId: number, sessionId: string): void {
    this.windowBindings.set(webContentsId, sessionId)
  }

  unbindWindow(webContentsId: number): void {
    this.windowBindings.set(webContentsId, null)
  }

  getActiveSessionId(webContentsId: number): string | null {
    return this.windowBindings.get(webContentsId) ?? null
  }

  generateId(): string {
    return nanoid()
  }
}
