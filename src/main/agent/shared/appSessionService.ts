import { nanoid } from 'nanoid'
import type { AppSessionId } from './agentSessionIds'
import { toAppSessionId } from './agentSessionIds'
import type { SessionDatabase } from '@/session/data/database'
import type { ProjectDatabase } from '@/project/data/database'
import type {
  DeepChatSubagentMeta,
  SessionKind,
  SessionMetadata,
  SessionPageCursor,
  SessionRecord
} from '@shared/types/agent-interface'
import type { SessionListPageCursor } from '@/session/data/tables/newSessions'
import { parseLiveDelegationSubagentContext } from '@shared/orchestration/liveDelegation'
import {
  normalizeOrchestrationPolicy,
  type OrchestrationPolicy
} from '@shared/orchestration/policy'
import { normalizeToolModeOverride, type ToolModeOverride } from '@shared/toolMode'

const parseSubagentMeta = (raw: string | null | undefined): DeepChatSubagentMeta | null => {
  if (!raw) {
    return null
  }

  try {
    const parsed = JSON.parse(raw) as Partial<DeepChatSubagentMeta>
    if (!parsed || typeof parsed !== 'object' || typeof parsed.slotId !== 'string') {
      return null
    }

    const liveDelegation = parseLiveDelegationSubagentContext(parsed.liveDelegation)
    return {
      slotId: parsed.slotId,
      displayName: typeof parsed.displayName === 'string' ? parsed.displayName : parsed.slotId,
      targetAgentId:
        parsed.targetAgentId === null || typeof parsed.targetAgentId === 'string'
          ? parsed.targetAgentId
          : undefined,
      ...(liveDelegation ? { liveDelegation } : {})
    }
  } catch {
    return null
  }
}

export interface AppSessionReadPort {
  get(id: string): SessionRecord | null
}

export class AppSessionService implements AppSessionReadPort {
  constructor(
    private readonly sqlitePresenter: ProjectDatabase,
    private readonly sessionDatabase: SessionDatabase,
    private readonly notifyEnvironmentProjectionChanged: () => void = () => undefined
  ) {}

  create(
    agentId: string,
    title: string,
    projectDir: string | null,
    options?: {
      isDraft?: boolean
      disabledAgentTools?: string[]
      orchestrationPolicy?: OrchestrationPolicy
      toolModeOverride?: ToolModeOverride
      sessionKind?: SessionKind
      parentSessionId?: string | null
      subagentMeta?: DeepChatSubagentMeta | null
      metadata?: SessionMetadata | null
    }
  ): AppSessionId {
    const id = nanoid()
    this.sessionDatabase.newSessionsTable.create(id, agentId, title, projectDir, {
      isDraft: options?.isDraft,
      disabledAgentTools: options?.disabledAgentTools,
      orchestrationPolicy: options?.orchestrationPolicy,
      toolModeOverride: options?.toolModeOverride,
      sessionKind: options?.sessionKind,
      parentSessionId: options?.parentSessionId,
      subagentMetaJson: options?.subagentMeta ? JSON.stringify(options.subagentMeta) : null
    })
    if (options?.metadata) {
      this.sessionDatabase.deepchatSessionMetadataTable.upsert(id, options.metadata)
    }
    this.sessionDatabase.deepchatSearchDocumentsTable.upsert({
      documentKey: `session:${id}`,
      sessionId: id,
      documentKind: 'session',
      title,
      content: '',
      updatedAt: Date.now()
    })
    this.sqlitePresenter.newEnvironmentsTable.syncPath(projectDir)
    this.notifyEnvironmentProjectionChanged()
    return toAppSessionId(id)
  }

  get(id: string): SessionRecord | null {
    const row = this.sessionDatabase.newSessionsTable.get(id)
    if (!row) return null
    return this.mapRowToRecord(row)
  }

  getMany(ids: string[]): SessionRecord[] {
    return this.sessionDatabase.newSessionsTable.getMany(ids).map((row) => this.mapRowToRecord(row))
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
    const page = this.sessionDatabase.newSessionsTable.listPage({
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
    const rows = this.sessionDatabase.newSessionsTable.list(filters)
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
        | 'subagentMeta'
        | 'orchestrationPolicy'
        | 'toolModeOverride'
      >
    >
  ): void {
    const current = this.sessionDatabase.newSessionsTable.get(id)
    if (!current) {
      return
    }

    const affectedPaths = new Set(this.sqlitePresenter.newEnvironmentsTable.listPathsForSession(id))

    const dbFields: {
      title?: string
      project_dir?: string | null
      is_pinned?: number
      is_draft?: number
      session_kind?: SessionKind
      parent_session_id?: string | null
      subagent_meta_json?: string | null
      orchestration_policy?: OrchestrationPolicy
      tool_mode_override?: ToolModeOverride
    } = {}
    if (fields.title !== undefined) dbFields.title = fields.title
    if (fields.projectDir !== undefined) dbFields.project_dir = fields.projectDir
    if (fields.isPinned !== undefined) dbFields.is_pinned = fields.isPinned ? 1 : 0
    if (fields.isDraft !== undefined) dbFields.is_draft = fields.isDraft ? 1 : 0
    if (fields.sessionKind !== undefined) dbFields.session_kind = fields.sessionKind
    if (fields.parentSessionId !== undefined) {
      dbFields.parent_session_id = fields.parentSessionId
    }
    if (fields.subagentMeta !== undefined) {
      dbFields.subagent_meta_json = fields.subagentMeta ? JSON.stringify(fields.subagentMeta) : null
    }
    if (fields.orchestrationPolicy !== undefined) {
      dbFields.orchestration_policy = normalizeOrchestrationPolicy(fields.orchestrationPolicy)
    }
    if (fields.toolModeOverride !== undefined) {
      dbFields.tool_mode_override = normalizeToolModeOverride(fields.toolModeOverride)
    }
    this.sessionDatabase.newSessionsTable.update(id, dbFields)
    if (fields.title !== undefined) {
      this.sessionDatabase.deepchatSearchDocumentsTable.refreshSessionTitle(id, fields.title)
    }

    for (const path of this.sqlitePresenter.newEnvironmentsTable.listPathsForSession(id)) {
      affectedPaths.add(path)
    }

    for (const path of affectedPaths) {
      this.sqlitePresenter.newEnvironmentsTable.syncPath(path)
    }
    this.notifyEnvironmentProjectionChanged()
  }

  delete(id: string): void {
    const affectedPaths = this.sqlitePresenter.newEnvironmentsTable.listPathsForSession(id)
    this.sessionDatabase.deepchatSessionMetadataTable?.delete(id)
    this.sessionDatabase.deepchatSearchDocumentsTable.deleteBySession(id)
    this.sessionDatabase.newSessionsTable.delete(id)
    for (const path of affectedPaths) {
      this.sqlitePresenter.newEnvironmentsTable.syncPath(path)
    }
    this.notifyEnvironmentProjectionChanged()
  }

  getDisabledAgentTools(id: string): string[] {
    return this.sessionDatabase.newSessionsTable.getDisabledAgentTools(id)
  }

  updateDisabledAgentTools(id: string, disabledAgentTools: string[]): void {
    this.sessionDatabase.newSessionsTable.updateDisabledAgentTools(id, disabledAgentTools)
    this.sqlitePresenter.newEnvironmentsTable.syncForSession(id)
    this.notifyEnvironmentProjectionChanged()
  }

  getOrchestrationPolicy(id: string): OrchestrationPolicy {
    return this.sessionDatabase.newSessionsTable.getOrchestrationPolicy(id)
  }

  updateOrchestrationPolicy(id: string, policy: OrchestrationPolicy): void {
    this.sessionDatabase.newSessionsTable.updateOrchestrationPolicy(id, policy)
    this.sqlitePresenter.newEnvironmentsTable.syncForSession(id)
    this.notifyEnvironmentProjectionChanged()
  }

  updateToolModeOverride(id: string, override: ToolModeOverride): void {
    this.sessionDatabase.newSessionsTable.updateToolModeOverride(id, override)
    this.sqlitePresenter.newEnvironmentsTable.syncForSession(id)
    this.notifyEnvironmentProjectionChanged()
  }

  updateAgentId(id: string, agentId: string): void {
    const current = this.sessionDatabase.newSessionsTable.get(id)
    if (!current || current.agent_id === agentId) {
      return
    }

    this.sessionDatabase.newSessionsTable.updateAgentId(id, agentId)
    this.sqlitePresenter.newEnvironmentsTable.syncForSession(id)
    this.notifyEnvironmentProjectionChanged()
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
    subagent_meta_json: string | null
    orchestration_policy: string
    tool_mode_override: unknown
    created_at: number
    updated_at: number
    revision: number
  }): SessionRecord {
    const metadata = this.sessionDatabase.deepchatSessionMetadataTable?.get(row.id) ?? null
    return {
      id: row.id,
      agentId: row.agent_id,
      title: row.title,
      projectDir: row.project_dir,
      isPinned: row.is_pinned === 1,
      isDraft: row.is_draft === 1,
      sessionKind: row.session_kind === 'subagent' ? 'subagent' : 'regular',
      parentSessionId: row.parent_session_id ?? null,
      subagentMeta: parseSubagentMeta(row.subagent_meta_json),
      orchestrationPolicy: normalizeOrchestrationPolicy(row.orchestration_policy),
      toolModeOverride: normalizeToolModeOverride(row.tool_mode_override),
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      revision: row.revision,
      ...(metadata ? { metadata } : {})
    }
  }
}
