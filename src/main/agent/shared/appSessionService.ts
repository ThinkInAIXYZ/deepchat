import { nanoid } from 'nanoid'
import type { AppSessionId } from './agentSessionIds'
import { toAppSessionId } from './agentSessionIds'
import type { SQLitePresenter } from '@/presenter/sqlitePresenter'
import type {
  DeepChatSubagentMeta,
  SessionKind,
  SessionMetadata,
  SessionPageCursor,
  SessionRecord
} from '@shared/types/agent-interface'
import type { SessionListPageCursor } from '@/presenter/sqlitePresenter/tables/newSessions'

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

export interface AppSessionServiceDependencies {
  newSessionsTable: SQLitePresenter['newSessionsTable']
  deepchatSessionMetadataTable: SQLitePresenter['deepchatSessionMetadataTable']
  deepchatSearchDocumentsTable: SQLitePresenter['deepchatSearchDocumentsTable']
  newEnvironmentsTable: SQLitePresenter['newEnvironmentsTable']
}

export interface AppSessionReadPort {
  get(id: string): SessionRecord | null
}

export class AppSessionService implements AppSessionReadPort {
  private dependencies: AppSessionServiceDependencies
  // webContentsId → sessionId
  private windowBindings: Map<number, AppSessionId | null> = new Map()

  constructor(dependencies: AppSessionServiceDependencies) {
    this.dependencies = dependencies
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
      metadata?: SessionMetadata | null
    }
  ): AppSessionId {
    const id = nanoid()
    this.dependencies.newSessionsTable.create(id, agentId, title, projectDir, {
      isDraft: options?.isDraft,
      disabledAgentTools: options?.disabledAgentTools,
      subagentEnabled: options?.subagentEnabled,
      sessionKind: options?.sessionKind,
      parentSessionId: options?.parentSessionId,
      subagentMetaJson: options?.subagentMeta ? JSON.stringify(options.subagentMeta) : null
    })
    if (options?.metadata) {
      this.dependencies.deepchatSessionMetadataTable.upsert(id, options.metadata)
    }
    this.dependencies.deepchatSearchDocumentsTable.upsert({
      documentKey: `session:${id}`,
      sessionId: id,
      documentKind: 'session',
      title,
      content: '',
      updatedAt: Date.now()
    })
    this.dependencies.newEnvironmentsTable.syncPath(projectDir)
    return toAppSessionId(id)
  }

  get(id: string): SessionRecord | null {
    const row = this.dependencies.newSessionsTable.get(id)
    if (!row) return null
    return this.mapRowToRecord(row)
  }

  getMany(ids: string[]): SessionRecord[] {
    return this.dependencies.newSessionsTable.getMany(ids).map((row) => this.mapRowToRecord(row))
  }

  listPage(options?: {
    limit?: number
    cursor?: SessionPageCursor | null
    agentId?: string
    includeSubagents?: boolean
    parentSessionId?: string
  }): {
    records: SessionRecord[]
    nextCursor: SessionPageCursor | null
    hasMore: boolean
  } {
    const page = this.dependencies.newSessionsTable.listPage({
      limit: options?.limit,
      cursor: options?.cursor as SessionListPageCursor | null | undefined,
      agentId: options?.agentId,
      includeSubagents: options?.includeSubagents,
      parentSessionId: options?.parentSessionId
    })
    const records = page.rows.map((row) => this.mapRowToRecord(row))
    const lastRecord = records.at(-1)

    return {
      records,
      nextCursor:
        page.hasMore && lastRecord ? { updatedAt: lastRecord.updatedAt, id: lastRecord.id } : null,
      hasMore: page.hasMore
    }
  }

  list(filters?: {
    agentId?: string
    projectDir?: string
    includeSubagents?: boolean
    parentSessionId?: string
  }): SessionRecord[] {
    const rows = this.dependencies.newSessionsTable.list(filters)
    return rows.map((row) => this.mapRowToRecord(row))
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
    const current = this.dependencies.newSessionsTable.get(id)
    if (!current) {
      return
    }

    const affectedPaths = new Set(this.dependencies.newEnvironmentsTable.listPathsForSession(id))

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
    this.dependencies.newSessionsTable.update(id, dbFields)
    if (fields.title !== undefined) {
      this.dependencies.deepchatSearchDocumentsTable.refreshSessionTitle(id, fields.title)
    }

    for (const path of this.dependencies.newEnvironmentsTable.listPathsForSession(id)) {
      affectedPaths.add(path)
    }

    for (const path of affectedPaths) {
      this.dependencies.newEnvironmentsTable.syncPath(path)
    }
  }

  delete(id: string): void {
    const affectedPaths = this.dependencies.newEnvironmentsTable.listPathsForSession(id)
    this.dependencies.deepchatSessionMetadataTable?.delete(id)
    this.dependencies.deepchatSearchDocumentsTable.deleteBySession(id)
    this.dependencies.newSessionsTable.delete(id)
    for (const path of affectedPaths) {
      this.dependencies.newEnvironmentsTable.syncPath(path)
    }
  }

  getDisabledAgentTools(id: string): string[] {
    return this.dependencies.newSessionsTable.getDisabledAgentTools(id)
  }

  updateDisabledAgentTools(id: string, disabledAgentTools: string[]): void {
    this.dependencies.newSessionsTable.updateDisabledAgentTools(id, disabledAgentTools)
    this.dependencies.newEnvironmentsTable.syncForSession(id)
  }

  updateAgentId(id: string, agentId: string): void {
    const current = this.dependencies.newSessionsTable.get(id)
    if (!current || current.agent_id === agentId) {
      return
    }

    this.dependencies.newSessionsTable.updateAgentId(id, agentId)
    this.dependencies.newEnvironmentsTable.syncForSession(id)
  }

  // Window binding management
  bindWindow(webContentsId: number, sessionId: AppSessionId): void {
    this.windowBindings.set(webContentsId, sessionId)
  }

  unbindWindow(webContentsId: number): void {
    this.windowBindings.set(webContentsId, null)
  }

  getActiveSessionId(webContentsId: number): AppSessionId | null {
    return this.windowBindings.get(webContentsId) ?? null
  }

  private mapRowToRecord(row: {
    id: string
    agent_id: string
    title: string
    project_dir: string | null
    is_pinned: number
    is_draft: number
    session_kind: string
    parent_session_id: string | null
    subagent_enabled: number
    subagent_meta_json: string | null
    created_at: number
    updated_at: number
  }): SessionRecord {
    const metadata = this.dependencies.deepchatSessionMetadataTable?.get(row.id) ?? null
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
      updatedAt: row.updated_at,
      ...(metadata ? { metadata } : {})
    }
  }
}
