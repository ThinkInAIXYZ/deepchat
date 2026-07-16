import logger from '@shared/logger'
import type {
  AssistantMessageBlock,
  MessageFile,
  UserMessageContent
} from '@shared/types/agent-interface'

import type { SettingsDatabase } from '@/settings/data/database'
import type { SessionDatabase } from '@/session/data/database'
import type { DeepChatMessageRow } from '@/session/data/tables/deepchatMessages'
import type { StartupWorkloadTaskContext } from '@/app/startupWorkloadCoordinator'
import type { AgentSettingsPort } from '@/agent/settings'
import { BUILTIN_DEEPCHAT_AGENT_ID } from '@/agent/repository'
import { normalizeDisabledAgentTools } from '@/agent/shared/agentSessionNormalization'

export const SQLITE_MAINLINE_NORMALIZATION_KEY = 'sqlite-mainline-normalization-v1'
export const BUILTIN_MCP_ALLOWLIST_COMPATIBILITY_KEY = 'builtin-mcp-allowlist-compatibility-v1'
export const DISABLED_SEARCH_TOOL_CLEANUP_V1_KEY = 'agent-disabled-search-tool-cleanup-v1'
export const DISABLED_AGENT_TOOL_CAPABILITY_CLEANUP_KEY =
  'agent-disabled-tool-capability-cleanup-v2'

export type SessionDataMigrationSQLitePort = Pick<SettingsDatabase, 'appSettingsTable'> &
  Pick<
    SessionDatabase,
    | 'getDatabase'
    | 'newSessionsTable'
    | 'newSessionActiveSkillsTable'
    | 'newSessionDisabledAgentToolsTable'
    | 'deepchatSearchDocumentsTable'
    | 'deepchatUserMessagesTable'
    | 'deepchatUserMessageFilesTable'
    | 'deepchatUserMessageLinksTable'
    | 'deepchatAssistantBlocksTable'
  >

type SessionDataMigrationDependencies = {
  sqlitePresenter: SessionDataMigrationSQLitePort
}

type BuiltinMcpAllowlistMigrationDependencies = {
  sqlitePresenter: Pick<SettingsDatabase, 'appSettingsTable'>
  agentSettings: Pick<AgentSettingsPort, 'getDeepChatAgentConfig' | 'updateDeepChatAgent'>
}

type DisabledToolCleanupDependencies = SessionDataMigrationDependencies & {
  agentSettings: Pick<
    AgentSettingsPort,
    'listAgents' | 'getDeepChatAgentConfig' | 'updateDeepChatAgent'
  >
}

const yieldToEventLoop = async (): Promise<void> => {
  await new Promise<void>((resolve) => setTimeout(resolve, 0))
}

const extractSearchableMessageContent = (rawContent: string): string => {
  try {
    const parsed = JSON.parse(rawContent) as
      | { text?: string; content?: Array<{ type?: string; text?: string }> }
      | Array<{ type?: string; content?: string; text?: string; error?: string }>

    if (Array.isArray(parsed)) {
      const segments = parsed
        .flatMap((block) => {
          if (!block || typeof block !== 'object') return []
          return [block.content, block.text, block.error].filter(
            (value): value is string => typeof value === 'string' && !!value.trim()
          )
        })
        .map((value) => value.trim())
      if (segments.length > 0) return segments.join('\n')
    } else if (parsed && typeof parsed === 'object') {
      if (typeof parsed.text === 'string' && parsed.text.trim()) return parsed.text.trim()
      if (Array.isArray(parsed.content)) {
        const segments = parsed.content
          .filter(
            (item): item is { type?: string; text?: string } =>
              typeof item?.text === 'string' && item.text.trim().length > 0
          )
          .map((item) => item.text!.trim())
        if (segments.length > 0) return segments.join('\n')
      }
    }
  } catch {
    // Plain-text messages are expected here; fall through and return the raw content.
  }
  return rawContent
}

const normalizeActiveSkills = (activeSkills?: string[]): string[] => {
  if (!Array.isArray(activeSkills)) return []
  return Array.from(
    new Set(
      activeSkills
        .filter((item): item is string => typeof item === 'string')
        .map((item) => item.trim())
        .filter(Boolean)
    )
  )
}

const parseUserMessageContent = (rawContent: string): UserMessageContent | null => {
  try {
    const parsed = JSON.parse(rawContent) as Partial<UserMessageContent>
    if (!parsed || typeof parsed !== 'object') return null
    return {
      text: typeof parsed.text === 'string' ? parsed.text : '',
      files: Array.isArray(parsed.files) ? (parsed.files.filter(Boolean) as MessageFile[]) : [],
      links: Array.isArray(parsed.links)
        ? parsed.links.filter((item): item is string => typeof item === 'string')
        : [],
      search: parsed.search === true,
      think: parsed.think === true,
      activeSkills: normalizeActiveSkills(parsed.activeSkills)
    }
  } catch {
    return null
  }
}

const parseAssistantBlocks = (rawContent: string): AssistantMessageBlock[] => {
  try {
    const parsed = JSON.parse(rawContent) as AssistantMessageBlock[]
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return []
  }
}

const backfillNormalizedMessageRow = (
  sqlitePresenter: SessionDataMigrationSQLitePort,
  row: DeepChatMessageRow
): void => {
  if (row.role === 'user') {
    const content = parseUserMessageContent(row.content)
    if (content) {
      sqlitePresenter.deepchatUserMessagesTable.upsert({
        messageId: row.id,
        text: content.text,
        searchEnabled: content.search === true,
        thinkEnabled: content.think === true
      })
      sqlitePresenter.deepchatUserMessageFilesTable.replaceForMessage(
        row.id,
        content.files.map((file) => ({
          name: file.name,
          path: file.path,
          mimeType: file.mimeType ?? file.type,
          size: file.size,
          metadataJson: JSON.stringify({
            type: file.type,
            content: file.content,
            token: file.token,
            thumbnail: file.thumbnail,
            metadata: file.metadata
          })
        }))
      )
      sqlitePresenter.deepchatUserMessageLinksTable.replaceForMessage(row.id, content.links)
    }
  } else {
    sqlitePresenter.deepchatAssistantBlocksTable.replaceForMessage(
      row.id,
      parseAssistantBlocks(row.content)
    )
  }

  if (row.status === 'sent' || row.status === 'error') {
    const title = sqlitePresenter.newSessionsTable.get(row.session_id)?.title ?? ''
    sqlitePresenter.deepchatSearchDocumentsTable.upsert({
      documentKey: `message:${row.id}`,
      sessionId: row.session_id,
      messageId: row.id,
      documentKind: 'message',
      role: row.role,
      title,
      content: extractSearchableMessageContent(row.content),
      updatedAt: row.updated_at
    })
  }
}

export async function runMainlineNormalizationMigration(
  { sqlitePresenter }: SessionDataMigrationDependencies,
  taskContext?: StartupWorkloadTaskContext
): Promise<void> {
  const current =
    sqlitePresenter.appSettingsTable.getAppSetting<{ status?: 'running' | 'completed' | 'failed' }>(
      SQLITE_MAINLINE_NORMALIZATION_KEY
    ) ?? null
  if (current?.status === 'completed') return

  const startedAt = Date.now()
  const batchSize = 50
  sqlitePresenter.appSettingsTable.setAppSetting(SQLITE_MAINLINE_NORMALIZATION_KEY, {
    status: 'running',
    startedAt,
    finishedAt: null,
    updatedAt: startedAt,
    processedCount: 0
  })

  try {
    const db = sqlitePresenter.getDatabase()
    let processedCount = 0
    let batchCount = 0
    const yieldForBatch = async (): Promise<void> => {
      sqlitePresenter.appSettingsTable.setAppSetting(SQLITE_MAINLINE_NORMALIZATION_KEY, {
        status: 'running',
        startedAt,
        finishedAt: null,
        updatedAt: Date.now(),
        processedCount
      })
      await (taskContext?.yield() ?? yieldToEventLoop())
    }

    let sessionCursor: { updatedAt: number; id: string } | null = null
    while (true) {
      const sessionRows = sessionCursor
        ? db
            .prepare<
              [number, number, string, number],
              { id: string; title: string; updated_at: number }
            >(
              `SELECT id, title, updated_at
               FROM new_sessions
               WHERE updated_at > ? OR (updated_at = ? AND id > ?)
               ORDER BY updated_at ASC, id ASC
               LIMIT ?`
            )
            .all(sessionCursor.updatedAt, sessionCursor.updatedAt, sessionCursor.id, batchSize)
        : db
            .prepare<[number], { id: string; title: string; updated_at: number }>(
              `SELECT id, title, updated_at
               FROM new_sessions
               ORDER BY updated_at ASC, id ASC
               LIMIT ?`
            )
            .all(batchSize)

      if (sessionRows.length === 0) break
      for (const sessionRow of sessionRows) {
        const activeSkills = sqlitePresenter.newSessionsTable.getActiveSkills(sessionRow.id)
        const disabledAgentTools = sqlitePresenter.newSessionsTable.getDisabledAgentTools(
          sessionRow.id
        )
        sqlitePresenter.newSessionActiveSkillsTable.replaceForSession(sessionRow.id, activeSkills)
        sqlitePresenter.newSessionDisabledAgentToolsTable.replaceForSession(
          sessionRow.id,
          disabledAgentTools
        )
        sqlitePresenter.deepchatSearchDocumentsTable.upsert({
          documentKey: `session:${sessionRow.id}`,
          sessionId: sessionRow.id,
          documentKind: 'session',
          title: sessionRow.title,
          content: '',
          updatedAt: sessionRow.updated_at
        })
        sessionCursor = { updatedAt: sessionRow.updated_at, id: sessionRow.id }
        processedCount += 1
        batchCount += 1
        if (batchCount >= batchSize) {
          batchCount = 0
          await yieldForBatch()
        }
      }
    }

    let messageCursor: { createdAt: number; id: string } | null = null
    while (true) {
      const messageRows = messageCursor
        ? db
            .prepare<[number, number, string, number], DeepChatMessageRow>(
              `SELECT id, session_id, role, status, content, updated_at, created_at
               FROM deepchat_messages
               WHERE created_at > ? OR (created_at = ? AND id > ?)
               ORDER BY created_at ASC, id ASC
               LIMIT ?`
            )
            .all(messageCursor.createdAt, messageCursor.createdAt, messageCursor.id, batchSize)
        : db
            .prepare<[number], DeepChatMessageRow>(
              `SELECT id, session_id, role, status, content, updated_at, created_at
               FROM deepchat_messages
               ORDER BY created_at ASC, id ASC
               LIMIT ?`
            )
            .all(batchSize)
      if (messageRows.length === 0) break
      for (const row of messageRows) {
        backfillNormalizedMessageRow(sqlitePresenter, row)
        messageCursor = { createdAt: row.created_at, id: row.id }
        processedCount += 1
        batchCount += 1
        if (batchCount >= batchSize) {
          batchCount = 0
          await yieldForBatch()
        }
      }
    }

    const finishedAt = Date.now()
    const durationMs = finishedAt - startedAt
    sqlitePresenter.appSettingsTable.setAppSetting(SQLITE_MAINLINE_NORMALIZATION_KEY, {
      status: 'completed',
      startedAt,
      finishedAt,
      updatedAt: finishedAt,
      processedCount,
      durationMs
    })
    logger.info('[SQLiteMainlineNormalization] Backfill completed', {
      processedCount,
      durationMs
    })
  } catch (error) {
    const finishedAt = Date.now()
    sqlitePresenter.appSettingsTable.setAppSetting(SQLITE_MAINLINE_NORMALIZATION_KEY, {
      status: 'failed',
      startedAt,
      finishedAt,
      updatedAt: finishedAt,
      error: error instanceof Error ? error.message : String(error),
      durationMs: finishedAt - startedAt
    })
    throw error
  }
}

const areStringArraysEqual = (left: string[], right: string[]): boolean =>
  left.length === right.length && left.every((item, index) => item === right[index])

export async function runBuiltinMcpAllowlistCompatibilityMigration({
  sqlitePresenter,
  agentSettings
}: BuiltinMcpAllowlistMigrationDependencies): Promise<void> {
  const current =
    sqlitePresenter.appSettingsTable.getAppSetting<{
      status?: 'running' | 'completed' | 'failed'
    }>(BUILTIN_MCP_ALLOWLIST_COMPATIBILITY_KEY) ?? null
  if (current?.status === 'completed') return

  const startedAt = Date.now()
  sqlitePresenter.appSettingsTable.setAppSetting(BUILTIN_MCP_ALLOWLIST_COMPATIBILITY_KEY, {
    status: 'running',
    startedAt,
    finishedAt: null,
    migrated: false
  })

  try {
    const config = await agentSettings.getDeepChatAgentConfig(BUILTIN_DEEPCHAT_AGENT_ID)
    const shouldMigrate = config?.enabledMcpServerIds?.length === 0
    if (shouldMigrate) {
      const updated = await agentSettings.updateDeepChatAgent(BUILTIN_DEEPCHAT_AGENT_ID, {
        config: { enabledMcpServerIds: null }
      })
      if (!updated) throw new Error('Built-in DeepChat Agent not found')
    }

    const finishedAt = Date.now()
    sqlitePresenter.appSettingsTable.setAppSetting(BUILTIN_MCP_ALLOWLIST_COMPATIBILITY_KEY, {
      status: 'completed',
      startedAt,
      finishedAt,
      migrated: shouldMigrate,
      durationMs: finishedAt - startedAt
    })
  } catch (error) {
    const finishedAt = Date.now()
    sqlitePresenter.appSettingsTable.setAppSetting(BUILTIN_MCP_ALLOWLIST_COMPATIBILITY_KEY, {
      status: 'failed',
      startedAt,
      finishedAt,
      migrated: false,
      error: error instanceof Error ? error.message : String(error),
      durationMs: finishedAt - startedAt
    })
    throw error
  }
}

export async function runDisabledAgentToolCapabilityCleanupMigration(
  { sqlitePresenter, agentSettings }: DisabledToolCleanupDependencies,
  taskContext?: StartupWorkloadTaskContext
): Promise<void> {
  const current =
    sqlitePresenter.appSettingsTable.getAppSetting<{ status?: 'running' | 'completed' | 'failed' }>(
      DISABLED_AGENT_TOOL_CAPABILITY_CLEANUP_KEY
    ) ?? null
  if (current?.status === 'completed') return

  const startedAt = Date.now()
  const batchSize = 50
  let processedCount = 0
  let updatedCount = 0
  let configProcessedCount = 0
  let configUpdatedCount = 0
  const writeRunningState = (): void => {
    sqlitePresenter.appSettingsTable.setAppSetting(DISABLED_AGENT_TOOL_CAPABILITY_CLEANUP_KEY, {
      status: 'running',
      startedAt,
      finishedAt: null,
      updatedAt: Date.now(),
      processedCount,
      updatedCount,
      configProcessedCount,
      configUpdatedCount
    })
  }
  const yieldForBatch = async (): Promise<void> => {
    writeRunningState()
    await (taskContext?.yield() ?? yieldToEventLoop())
  }

  sqlitePresenter.appSettingsTable.setAppSetting(DISABLED_AGENT_TOOL_CAPABILITY_CLEANUP_KEY, {
    status: 'running',
    startedAt,
    finishedAt: null,
    updatedAt: startedAt,
    processedCount,
    updatedCount,
    configProcessedCount,
    configUpdatedCount
  })

  try {
    const db = sqlitePresenter.getDatabase()
    const firstSessionBatch = db.prepare<[number], { id: string }>(
      `SELECT id
       FROM new_sessions
       ORDER BY id ASC
       LIMIT ?`
    )
    const nextSessionBatch = db.prepare<[string, number], { id: string }>(
      `SELECT id
       FROM new_sessions
       WHERE id > ?
       ORDER BY id ASC
       LIMIT ?`
    )
    const updateSessionDisabledTools = db.prepare<[string, string]>(
      'UPDATE new_sessions SET disabled_agent_tools = ? WHERE id = ?'
    )
    const persistSessionDisabledTools = db.transaction(
      (sessionId: string, disabledAgentTools: string[]): boolean => {
        const result = updateSessionDisabledTools.run(JSON.stringify(disabledAgentTools), sessionId)
        if (result.changes === 0) return false
        sqlitePresenter.newSessionDisabledAgentToolsTable.replaceForSession(
          sessionId,
          disabledAgentTools
        )
        return true
      }
    )
    let sessionCursor: string | null = null
    while (true) {
      const sessionRows =
        sessionCursor === null
          ? firstSessionBatch.all(batchSize)
          : nextSessionBatch.all(sessionCursor, batchSize)
      if (sessionRows.length === 0) break

      for (const sessionRow of sessionRows) {
        const disabledAgentTools = sqlitePresenter.newSessionsTable.getDisabledAgentTools(
          sessionRow.id
        )
        const normalized = normalizeDisabledAgentTools(disabledAgentTools, {
          dropLegacySearchTools: true
        })
        if (!areStringArraysEqual(disabledAgentTools, normalized)) {
          if (persistSessionDisabledTools(sessionRow.id, normalized)) updatedCount += 1
        }
        sessionCursor = sessionRow.id
        processedCount += 1
      }

      await yieldForBatch()
    }

    const agents = await agentSettings.listAgents()
    for (const agent of agents) {
      if (agent.type !== 'deepchat') continue
      const config = await agentSettings.getDeepChatAgentConfig(agent.id)
      if (Array.isArray(config?.disabledAgentTools)) {
        const normalized = normalizeDisabledAgentTools(config.disabledAgentTools, {
          dropLegacySearchTools: true
        })
        if (!areStringArraysEqual(config.disabledAgentTools, normalized)) {
          await agentSettings.updateDeepChatAgent(agent.id, {
            config: { disabledAgentTools: normalized }
          })
          configUpdatedCount += 1
        }
      }
      configProcessedCount += 1
      if (configProcessedCount % batchSize === 0) await yieldForBatch()
    }

    const finishedAt = Date.now()
    sqlitePresenter.appSettingsTable.setAppSetting(DISABLED_AGENT_TOOL_CAPABILITY_CLEANUP_KEY, {
      status: 'completed',
      startedAt,
      finishedAt,
      updatedAt: finishedAt,
      processedCount,
      updatedCount,
      configProcessedCount,
      configUpdatedCount
    })
  } catch (error) {
    const finishedAt = Date.now()
    sqlitePresenter.appSettingsTable.setAppSetting(DISABLED_AGENT_TOOL_CAPABILITY_CLEANUP_KEY, {
      status: 'failed',
      startedAt,
      finishedAt,
      updatedAt: finishedAt,
      processedCount,
      updatedCount,
      configProcessedCount,
      configUpdatedCount,
      error: error instanceof Error ? error.message : String(error)
    })
    throw error
  }
}
