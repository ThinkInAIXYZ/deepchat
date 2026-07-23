import Database from 'better-sqlite3-multiple-ciphers'
import { ConversationsTable } from '@/session/data/tables/conversations'
import { MessagesTable } from '@/session/data/tables/messages'
import { MessageAttachmentsTable } from '@/session/data/tables/messageAttachments'
import { AcpSessionsTable } from '@/agent/data/tables/acpSessions'
import { AcpTurnsTable } from '@/agent/data/tables/acpTurns'
import { NewEnvironmentsTable } from '@/project/data/tables/newEnvironments'
import { NewEnvironmentPreferencesTable } from '@/project/data/tables/newEnvironmentPreferences'
import { NewSessionsTable } from '@/session/data/tables/newSessions'
import { NewProjectsTable } from '@/project/data/tables/newProjects'
import { DeepChatSessionsTable } from '@/session/data/tables/deepchatSessions'
import { DeepChatMessagesTable } from '@/session/data/tables/deepchatMessages'
import { DeepChatUserMessagesTable } from '@/session/data/tables/deepchatUserMessages'
import { DeepChatUserMessageFilesTable } from '@/session/data/tables/deepchatUserMessageFiles'
import { DeepChatUserMessageLinksTable } from '@/session/data/tables/deepchatUserMessageLinks'
import { DeepChatAssistantBlocksTable } from '@/session/data/tables/deepchatAssistantBlocks'
import { DeepChatMessageTracesTable } from '@/session/data/tables/deepchatMessageTraces'
import { DeepChatMessageSearchResultsTable } from '@/session/data/tables/deepchatMessageSearchResults'
import { DeepChatSearchDocumentsTable } from '@/session/data/tables/deepchatSearchDocuments'
import { DeepChatPendingInputsTable } from '@/session/data/tables/deepchatPendingInputs'
import { DeepChatUsageStatsTable } from '@/session/data/tables/deepchatUsageStats'
import { DeepChatTapeEntriesTable } from '@/tape/infrastructure/sqlite/tapeEntryStore'
import { DeepChatMemoryIngestionProjectionTable } from '@/memory/data/tables/deepchatMemoryIngestionProjection'
import { DeepChatTapeSearchProjectionTable } from '@/tape/infrastructure/sqlite/tapeSearchProjectionStore'
import { DeepChatSessionMetadataTable } from '@/session/data/tables/deepchatSessionMetadata'
import { LegacyImportStatusTable } from '@/app/data/tables/legacyImportStatus'
import { AgentsTable } from '@/agent/data/tables/agents'
import { AgentMemoryTable } from '@/memory/data/tables/agentMemory'
import { AgentMemoryAuditTable } from '@/memory/data/tables/agentMemoryAudit'
import { AppSettingsTable } from '@/settings/data/tables/appSettingsTable'
import { ProviderSettingsTable } from '@/provider/data/settingsTable'
import { McpSettingsTable } from '@/mcp/data/settingsTable'
import { AgentCatalogSettingsTable } from '@/agent/acp/catalog/data/settingsTable'
import { NewSessionActiveSkillsTable } from '@/session/data/tables/newSessionActiveSkills'
import { NewSessionDisabledAgentToolsTable } from '@/session/data/tables/newSessionDisabledAgentTools'
import { SettingsActivityTable } from '@/settings/data/tables/settingsActivity'
import { CronJobsTable } from '@/scheduler/data/tables/cronJobs'
import { CronJobRunsTable } from '@/scheduler/data/tables/cronJobRuns'
import { CronJobDeliveriesTable } from '@/scheduler/data/tables/cronJobDeliveries'
import type { BaseTable } from '@/data/baseTable'
import type { SchemaTableSpec } from './schemaTypes'
import { isSchemaTableCreatedOnFreshInstall } from './schemaCatalogMetadata'

interface CatalogDefinition {
  name: string
  createTable: (db: Database.Database) => BaseTable
  // Per-table override for exceptional cases. When omitted, schemaCatalogMetadata.ts decides
  // whether the table belongs to the fresh startup catalog.
  createdOnFreshInstall?: boolean
  repairableColumns?: Record<string, string>
  typeCheckedColumns?: string[]
  afterRepair?: (db: Database.Database, addedColumns: ReadonlySet<string>) => void
}

function normalizeDeclaredType(type: string | null | undefined): string | null {
  const normalized = type?.trim().toUpperCase()
  return normalized ? normalized : null
}

const CATALOG_DEFINITIONS: CatalogDefinition[] = [
  {
    name: 'conversations',
    createTable: (db) => new ConversationsTable(db),
    repairableColumns: {
      is_new: 'ALTER TABLE conversations ADD COLUMN is_new INTEGER DEFAULT 1;',
      artifacts: 'ALTER TABLE conversations ADD COLUMN artifacts INTEGER DEFAULT 0;',
      enabled_mcp_tools:
        "ALTER TABLE conversations ADD COLUMN enabled_mcp_tools TEXT DEFAULT '[]';",
      thinking_budget: 'ALTER TABLE conversations ADD COLUMN thinking_budget INTEGER DEFAULT NULL;',
      reasoning_effort: 'ALTER TABLE conversations ADD COLUMN reasoning_effort TEXT DEFAULT NULL;',
      verbosity: 'ALTER TABLE conversations ADD COLUMN verbosity TEXT DEFAULT NULL;',
      enable_search: 'ALTER TABLE conversations ADD COLUMN enable_search INTEGER DEFAULT NULL;',
      forced_search: 'ALTER TABLE conversations ADD COLUMN forced_search INTEGER DEFAULT NULL;',
      search_strategy: 'ALTER TABLE conversations ADD COLUMN search_strategy TEXT DEFAULT NULL;',
      agent_workspace_path:
        'ALTER TABLE conversations ADD COLUMN agent_workspace_path TEXT DEFAULT NULL;',
      acp_workdir_map: 'ALTER TABLE conversations ADD COLUMN acp_workdir_map TEXT DEFAULT NULL;',
      parent_conversation_id:
        'ALTER TABLE conversations ADD COLUMN parent_conversation_id TEXT DEFAULT NULL;',
      parent_message_id:
        'ALTER TABLE conversations ADD COLUMN parent_message_id TEXT DEFAULT NULL;',
      parent_selection: 'ALTER TABLE conversations ADD COLUMN parent_selection TEXT DEFAULT NULL;',
      active_skills: "ALTER TABLE conversations ADD COLUMN active_skills TEXT DEFAULT '[]';"
    }
  },
  {
    name: 'messages',
    createTable: (db) => new MessagesTable(db)
  },
  {
    name: 'message_attachments',
    createTable: (db) => new MessageAttachmentsTable(db)
  },
  {
    name: 'acp_sessions',
    createTable: (db) => new AcpSessionsTable(db)
  },
  {
    name: 'acp_turns',
    createTable: (db) => new AcpTurnsTable(db)
  },
  {
    name: 'new_environments',
    createTable: (db) => new NewEnvironmentsTable(db),
    afterRepair: (db) => {
      new NewEnvironmentsTable(db).rebuildFromSessions()
    }
  },
  {
    name: 'new_environment_preferences',
    createTable: (db) => new NewEnvironmentPreferencesTable(db)
  },
  {
    name: 'new_sessions',
    createTable: (db) => new NewSessionsTable(db),
    repairableColumns: {
      is_draft: 'ALTER TABLE new_sessions ADD COLUMN is_draft INTEGER NOT NULL DEFAULT 0;',
      active_skills:
        "ALTER TABLE new_sessions ADD COLUMN active_skills TEXT NOT NULL DEFAULT '[]';",
      disabled_agent_tools:
        "ALTER TABLE new_sessions ADD COLUMN disabled_agent_tools TEXT NOT NULL DEFAULT '[]';",
      subagent_enabled:
        'ALTER TABLE new_sessions ADD COLUMN subagent_enabled INTEGER NOT NULL DEFAULT 0;',
      session_kind:
        "ALTER TABLE new_sessions ADD COLUMN session_kind TEXT NOT NULL DEFAULT 'regular';",
      parent_session_id: 'ALTER TABLE new_sessions ADD COLUMN parent_session_id TEXT;',
      subagent_meta_json: 'ALTER TABLE new_sessions ADD COLUMN subagent_meta_json TEXT;'
    },
    typeCheckedColumns: ['subagent_enabled', 'session_kind']
  },
  {
    name: 'new_projects',
    createTable: (db) => new NewProjectsTable(db)
  },
  {
    name: 'deepchat_sessions',
    createTable: (db) => new DeepChatSessionsTable(db),
    repairableColumns: {
      system_prompt: 'ALTER TABLE deepchat_sessions ADD COLUMN system_prompt TEXT;',
      temperature: 'ALTER TABLE deepchat_sessions ADD COLUMN temperature REAL;',
      top_p: 'ALTER TABLE deepchat_sessions ADD COLUMN top_p REAL;',
      context_length: 'ALTER TABLE deepchat_sessions ADD COLUMN context_length INTEGER;',
      max_tokens: 'ALTER TABLE deepchat_sessions ADD COLUMN max_tokens INTEGER;',
      thinking_budget: 'ALTER TABLE deepchat_sessions ADD COLUMN thinking_budget INTEGER;',
      reasoning_effort: 'ALTER TABLE deepchat_sessions ADD COLUMN reasoning_effort TEXT;',
      verbosity: 'ALTER TABLE deepchat_sessions ADD COLUMN verbosity TEXT;',
      summary_text: 'ALTER TABLE deepchat_sessions ADD COLUMN summary_text TEXT;',
      summary_cursor_order_seq:
        'ALTER TABLE deepchat_sessions ADD COLUMN summary_cursor_order_seq INTEGER NOT NULL DEFAULT 1;',
      summary_updated_at: 'ALTER TABLE deepchat_sessions ADD COLUMN summary_updated_at INTEGER;',
      timeout_ms: 'ALTER TABLE deepchat_sessions ADD COLUMN timeout_ms INTEGER;',
      force_interleaved_thinking_compat:
        'ALTER TABLE deepchat_sessions ADD COLUMN force_interleaved_thinking_compat INTEGER;',
      reasoning_visibility: 'ALTER TABLE deepchat_sessions ADD COLUMN reasoning_visibility TEXT;',
      image_generation_options_json:
        'ALTER TABLE deepchat_sessions ADD COLUMN image_generation_options_json TEXT;',
      video_generation_options_json:
        'ALTER TABLE deepchat_sessions ADD COLUMN video_generation_options_json TEXT;',
      memory_cursor_order_seq:
        'ALTER TABLE deepchat_sessions ADD COLUMN memory_cursor_order_seq INTEGER;'
    },
    typeCheckedColumns: [
      'summary_cursor_order_seq',
      'force_interleaved_thinking_compat',
      'reasoning_visibility'
    ]
  },
  {
    name: 'deepchat_messages',
    createTable: (db) => new DeepChatMessagesTable(db)
  },
  {
    name: 'deepchat_user_messages',
    createTable: (db) => new DeepChatUserMessagesTable(db)
  },
  {
    name: 'deepchat_user_message_files',
    createTable: (db) => new DeepChatUserMessageFilesTable(db)
  },
  {
    name: 'deepchat_user_message_links',
    createTable: (db) => new DeepChatUserMessageLinksTable(db)
  },
  {
    name: 'deepchat_assistant_blocks',
    createTable: (db) => new DeepChatAssistantBlocksTable(db)
  },
  {
    name: 'deepchat_message_traces',
    createTable: (db) => new DeepChatMessageTracesTable(db)
  },
  {
    name: 'deepchat_message_search_results',
    createTable: (db) => new DeepChatMessageSearchResultsTable(db)
  },
  {
    name: 'deepchat_search_documents',
    createTable: (db) => new DeepChatSearchDocumentsTable(db)
  },
  {
    name: 'deepchat_pending_inputs',
    createTable: (db) => new DeepChatPendingInputsTable(db),
    repairableColumns: {
      blocking_json: 'ALTER TABLE deepchat_pending_inputs ADD COLUMN blocking_json TEXT;'
    },
    typeCheckedColumns: ['blocking_json']
  },
  {
    name: 'deepchat_usage_stats',
    createTable: (db) => new DeepChatUsageStatsTable(db),
    repairableColumns: {
      cache_write_input_tokens:
        'ALTER TABLE deepchat_usage_stats ADD COLUMN cache_write_input_tokens INTEGER NOT NULL DEFAULT 0;'
    },
    typeCheckedColumns: ['cache_write_input_tokens']
  },
  {
    name: 'deepchat_tape_entries',
    createTable: (db) => new DeepChatTapeEntriesTable(db)
  },
  {
    name: 'deepchat_memory_ingestion_projection',
    createTable: (db) => new DeepChatMemoryIngestionProjectionTable(db)
  },
  {
    name: 'deepchat_memory_ingestion_projection_meta',
    createTable: (db) => new DeepChatMemoryIngestionProjectionTable(db)
  },
  {
    name: 'deepchat_tape_search_projection',
    createTable: (db) => new DeepChatTapeSearchProjectionTable(db)
  },
  {
    name: 'deepchat_tape_search_projection_meta',
    createTable: (db) => new DeepChatTapeSearchProjectionTable(db)
  },
  {
    name: 'deepchat_tape_search_fts_meta',
    createTable: (db) => new DeepChatTapeSearchProjectionTable(db)
  },
  {
    name: 'deepchat_session_metadata',
    createTable: (db) => new DeepChatSessionMetadataTable(db)
  },
  {
    name: 'legacy_import_status',
    createTable: (db) => new LegacyImportStatusTable(db)
  },
  {
    name: 'agents',
    createTable: (db) => new AgentsTable(db)
  },
  {
    name: 'agent_memory',
    createTable: (db) => new AgentMemoryTable(db),
    repairableColumns: {
      source_entry_ids: 'ALTER TABLE agent_memory ADD COLUMN source_entry_ids TEXT;',
      embedding_model: 'ALTER TABLE agent_memory ADD COLUMN embedding_model TEXT;',
      confidence: 'ALTER TABLE agent_memory ADD COLUMN confidence REAL;',
      last_consolidated_at: 'ALTER TABLE agent_memory ADD COLUMN last_consolidated_at INTEGER;',
      conflict_state: 'ALTER TABLE agent_memory ADD COLUMN conflict_state TEXT;',
      conflict_with: 'ALTER TABLE agent_memory ADD COLUMN conflict_with TEXT;',
      persona_state: 'ALTER TABLE agent_memory ADD COLUMN persona_state TEXT;',
      category: 'ALTER TABLE agent_memory ADD COLUMN category TEXT;',
      decision_revision:
        'ALTER TABLE agent_memory ADD COLUMN decision_revision INTEGER NOT NULL DEFAULT 1;',
      lifecycle_state:
        "ALTER TABLE agent_memory ADD COLUMN lifecycle_state TEXT NOT NULL DEFAULT 'active' CHECK (lifecycle_state IN ('active', 'archived', 'conflicted'));",
      embedding_state:
        "ALTER TABLE agent_memory ADD COLUMN embedding_state TEXT NOT NULL DEFAULT 'pending' CHECK (embedding_state IN ('pending', 'ready', 'error', 'fts_only', 'not_applicable'));"
    },
    afterRepair: (db, addedColumns) => {
      new AgentMemoryTable(db).repairCanonicalStateAfterSchemaRepair(addedColumns)
    }
  },
  {
    name: 'agent_memory_audit',
    createTable: (db) => new AgentMemoryAuditTable(db),
    repairableColumns: {
      memory_ref_id: 'ALTER TABLE agent_memory_audit ADD COLUMN memory_ref_id TEXT;'
    },
    afterRepair: (db) => {
      new AgentMemoryAuditTable(db).backfillMemoryRefIds()
    }
  },
  {
    name: 'new_session_active_skills',
    createTable: (db) => new NewSessionActiveSkillsTable(db)
  },
  {
    name: 'new_session_disabled_agent_tools',
    createTable: (db) => new NewSessionDisabledAgentToolsTable(db)
  },
  {
    name: 'settings_activity',
    createTable: (db) => new SettingsActivityTable(db)
  },
  {
    name: 'cron_jobs',
    createTable: (db) => new CronJobsTable(db)
  },
  {
    name: 'cron_job_runs',
    createTable: (db) => new CronJobRunsTable(db)
  },
  {
    name: 'cron_job_deliveries',
    createTable: (db) => new CronJobDeliveriesTable(db)
  }
]

let cachedCatalog: SchemaTableSpec[] | null = null

export function getSchemaCatalog(): SchemaTableSpec[] {
  if (cachedCatalog) {
    return cachedCatalog
  }

  const catalogDb = new Database(':memory:')

  try {
    cachedCatalog = CATALOG_DEFINITIONS.map((definition) => {
      const table = definition.createTable(catalogDb)
      const createSql = table.getCreateTableSQL()
      catalogDb.exec(createSql)

      const columns = catalogDb.prepare(`PRAGMA table_info(${definition.name})`).all() as Array<{
        name: string
        type: string
      }>
      const indexes = catalogDb
        .prepare(
          `SELECT name, sql
           FROM sqlite_master
           WHERE type = 'index'
             AND tbl_name = ?
             AND sql IS NOT NULL
           ORDER BY name ASC`
        )
        .all(definition.name) as Array<{ name: string; sql: string }>

      return {
        name: definition.name,
        createSql,
        // Explicit catalog definitions win; otherwise the shared metadata supplies the startup
        // diagnosis/repair default.
        createdOnFreshInstall:
          definition.createdOnFreshInstall ?? isSchemaTableCreatedOnFreshInstall(definition.name),
        columns: columns.map((column) => ({
          name: column.name,
          declaredType: normalizeDeclaredType(column.type),
          addColumnSql: definition.repairableColumns?.[column.name],
          checkType: definition.typeCheckedColumns?.includes(column.name) ?? false
        })),
        indexes: indexes.map((index) => ({
          name: index.name,
          createSql: index.sql.endsWith(';') ? index.sql : `${index.sql};`
        })),
        afterRepair: definition.afterRepair
      }
    })

    return cachedCatalog
  } finally {
    catalogDb.close()
  }
}

export function getStartupSchemaCatalog(): SchemaTableSpec[] {
  return getSchemaCatalog().filter((table) => table.createdOnFreshInstall)
}

export interface MainSchemaCatalog {
  migrationTables: BaseTable[]
  createTables(): void
  finalize(options: { backupBeforeMemoryRecovery(): string | null }): void
}

export function createMainSchemaCatalog(db: Database.Database): MainSchemaCatalog {
  const acpSessions = new AcpSessionsTable(db)
  const acpTurns = new AcpTurnsTable(db)
  const environments = new NewEnvironmentsTable(db)
  const environmentPreferences = new NewEnvironmentPreferencesTable(db)
  const sessions = new NewSessionsTable(db)
  const projects = new NewProjectsTable(db)
  const deepchatSessions = new DeepChatSessionsTable(db)
  const messages = new DeepChatMessagesTable(db)
  const userMessages = new DeepChatUserMessagesTable(db)
  const userMessageFiles = new DeepChatUserMessageFilesTable(db)
  const userMessageLinks = new DeepChatUserMessageLinksTable(db)
  const assistantBlocks = new DeepChatAssistantBlocksTable(db)
  const messageTraces = new DeepChatMessageTracesTable(db)
  const messageSearchResults = new DeepChatMessageSearchResultsTable(db)
  const searchDocuments = new DeepChatSearchDocumentsTable(db)
  const pendingInputs = new DeepChatPendingInputsTable(db)
  const usageStats = new DeepChatUsageStatsTable(db)
  const memoryIngestionProjection = new DeepChatMemoryIngestionProjectionTable(db)
  const tapeEntries = new DeepChatTapeEntriesTable(db, memoryIngestionProjection)
  const tapeSearchProjection = new DeepChatTapeSearchProjectionTable(db)
  const sessionMetadata = new DeepChatSessionMetadataTable(db)
  const legacyImportStatus = new LegacyImportStatusTable(db)
  const agents = new AgentsTable(db)
  const memory = new AgentMemoryTable(db)
  const memoryAudit = new AgentMemoryAuditTable(db)
  const providerSettings = new ProviderSettingsTable(db)
  const mcpSettings = new McpSettingsTable(db)
  const agentCatalogSettings = new AgentCatalogSettingsTable(db)
  const config = new AppSettingsTable(db)
  const activeSkills = new NewSessionActiveSkillsTable(db)
  const disabledAgentTools = new NewSessionDisabledAgentToolsTable(db)
  const settingsActivity = new SettingsActivityTable(db)
  const cronJobs = new CronJobsTable(db)
  const cronJobRuns = new CronJobRunsTable(db)
  const cronJobDeliveries = new CronJobDeliveriesTable(db)

  const createTables: BaseTable[] = [
    acpSessions,
    acpTurns,
    environments,
    environmentPreferences,
    sessions,
    projects,
    deepchatSessions,
    messages,
    userMessages,
    userMessageFiles,
    userMessageLinks,
    assistantBlocks,
    messageTraces,
    messageSearchResults,
    searchDocuments,
    pendingInputs,
    usageStats,
    memoryIngestionProjection,
    tapeEntries,
    tapeSearchProjection,
    sessionMetadata,
    legacyImportStatus,
    agents,
    memory,
    memoryAudit,
    providerSettings,
    mcpSettings,
    agentCatalogSettings,
    config,
    activeSkills,
    disabledAgentTools,
    settingsActivity,
    cronJobs,
    cronJobRuns,
    cronJobDeliveries
  ]

  return {
    migrationTables: createTables.filter((table) => table !== acpTurns),
    createTables: () => {
      for (const table of createTables) table.createTable()
    },
    finalize: ({ backupBeforeMemoryRecovery }) => {
      memory.assertCurrentSchema({
        backupBeforeLegacyBridgeRecovery: backupBeforeMemoryRecovery
      })
    }
  }
}
