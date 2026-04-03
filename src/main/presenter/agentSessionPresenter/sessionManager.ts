import { nanoid } from 'nanoid'
import type { SQLitePresenter } from '../sqlitePresenter'
import type {
  DeepChatSubagentMeta,
  SessionKind,
  SessionRecord
} from '@shared/types/agent-interface'

const parseSubagentMeta = (raw: string | null | undefined): DeepChatSubagentMeta | null => {
  if (!raw) {
    return null
  }

  try {
    const parsed = JSON.parse(raw) as Partial<DeepChatSubagentMeta>
    if (!parsed || typeof parsed !== 'object' || typeof parsed.slotId !== 'string') {
      return null
    }

    return {
      slotId: parsed.slotId,
      displayName: typeof parsed.displayName === 'string' ? parsed.displayName : parsed.slotId,
      targetAgentId:
        parsed.targetAgentId === null || typeof parsed.targetAgentId === 'string'
          ? parsed.targetAgentId
          : undefined
    }
  } catch {
    return null
  }
}

export class NewSessionManager {
  private sqlitePresenter: SQLitePresenter
  // webContentsId → sessionId
  private windowBindings: Map<number, string | null> = new Map()

  constructor(sqlitePresenter: SQLitePresenter) {
    this.sqlitePresenter = sqlitePresenter
  }

  create(
    agentId: string,
    title: string,
    projectDir: string | null,
    options?: {
      isDraft?: boolean
      disabledAgentTools?: string[]
      subagentEnabled?: boolean
      sessionKind?: SessionKind
      parentSessionId?: string | null
      subagentMeta?: DeepChatSubagentMeta | null
    }
  ): string {
    const id = nanoid()
    this.sqlitePresenter.newSessionsTable.create(id, agentId, title, projectDir, {
      isDraft: options?.isDraft,
      disabledAgentTools: options?.disabledAgentTools,
      subagentEnabled: options?.subagentEnabled,
      sessionKind: options?.sessionKind,
      parentSessionId: options?.parentSessionId,
      subagentMetaJson: options?.subagentMeta ? JSON.stringify(options.subagentMeta) : null
    })
    this.sqlitePresenter.newEnvironmentsTable.syncPath(projectDir)
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
      isDraft: row.is_draft === 1,
      sessionKind: row.session_kind === 'subagent' ? 'subagent' : 'regular',
      parentSessionId: row.parent_session_id ?? null,
      subagentEnabled: row.subagent_enabled === 1,
      subagentMeta: parseSubagentMeta(row.subagent_meta_json),
      createdAt: row.created_at,
      updatedAt: row.updated_at
    }
  }

  list(filters?: {
    agentId?: string
    projectDir?: string
    includeSubagents?: boolean
    parentSessionId?: string
  }): SessionRecord[] {
    const rows = this.sqlitePresenter.newSessionsTable.list(filters)
    return rows.map((row) => ({
      id: row.id,
      agentId: row.agent_id,
      title: row.title,
      projectDir: row.project_dir,
      isPinned: row.is_pinned === 1,
      isDraft: row.is_draft === 1,
      sessionKind: row.session_kind === 'subagent' ? 'subagent' : 'regular',
      parentSessionId: row.parent_session_id ?? null,
      subagentEnabled: row.subagent_enabled === 1,
      subagentMeta: parseSubagentMeta(row.subagent_meta_json),
      createdAt: row.created_at,
      updatedAt: row.updated_at
    }))
  }

  update(
    id: string,
    fields: Partial<
      Pick<
        SessionRecord,
        | 'title'
        | 'projectDir'
        | 'isPinned'
        | 'isDraft'
        | 'sessionKind'
        | 'parentSessionId'
        | 'subagentEnabled'
        | 'subagentMeta'
      >
    >
  ): void {
    const current = this.sqlitePresenter.newSessionsTable.get(id)
    if (!current) {
      return
    }

    const affectedPaths = new Set(this.sqlitePresenter.newEnvironmentsTable.listPathsForSession(id))

    const dbFields: {
      title?: string
      project_dir?: string | null
      is_pinned?: number
      is_draft?: number
      subagent_enabled?: number
      session_kind?: SessionKind
      parent_session_id?: string | null
      subagent_meta_json?: string | null
    } = {}
    if (fields.title !== undefined) dbFields.title = fields.title
    if (fields.projectDir !== undefined) dbFields.project_dir = fields.projectDir
    if (fields.isPinned !== undefined) dbFields.is_pinned = fields.isPinned ? 1 : 0
    if (fields.isDraft !== undefined) dbFields.is_draft = fields.isDraft ? 1 : 0
    if (fields.subagentEnabled !== undefined) {
      dbFields.subagent_enabled = fields.subagentEnabled ? 1 : 0
    }
    if (fields.sessionKind !== undefined) dbFields.session_kind = fields.sessionKind
    if (fields.parentSessionId !== undefined) {
      dbFields.parent_session_id = fields.parentSessionId
    }
    if (fields.subagentMeta !== undefined) {
      dbFields.subagent_meta_json = fields.subagentMeta ? JSON.stringify(fields.subagentMeta) : null
    }
    this.sqlitePresenter.newSessionsTable.update(id, dbFields)

    for (const path of this.sqlitePresenter.newEnvironmentsTable.listPathsForSession(id)) {
      affectedPaths.add(path)
    }

    for (const path of affectedPaths) {
      this.sqlitePresenter.newEnvironmentsTable.syncPath(path)
    }
  }

  delete(id: string): void {
    const affectedPaths = this.sqlitePresenter.newEnvironmentsTable.listPathsForSession(id)
    this.sqlitePresenter.newSessionsTable.delete(id)
    for (const path of affectedPaths) {
      this.sqlitePresenter.newEnvironmentsTable.syncPath(path)
    }
  }

  getDisabledAgentTools(id: string): string[] {
    return this.sqlitePresenter.newSessionsTable.getDisabledAgentTools(id)
  }

  updateDisabledAgentTools(id: string, disabledAgentTools: string[]): void {
    this.sqlitePresenter.newSessionsTable.updateDisabledAgentTools(id, disabledAgentTools)
    this.sqlitePresenter.newEnvironmentsTable.syncForSession(id)
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
}
