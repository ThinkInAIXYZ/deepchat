import Database from 'better-sqlite3-multiple-ciphers'
import { ConversationsTable } from './tables/conversations'
import { MessagesTable } from './tables/messages'
import { MessageAttachmentsTable } from './tables/messageAttachments'
import { AcpSessionsTable } from './tables/acpSessions'
import { AcpTurnsTable } from './tables/acpTurns'
import { NewEnvironmentsTable } from './tables/newEnvironments'
import { NewEnvironmentPreferencesTable } from './tables/newEnvironmentPreferences'
import { NewSessionsTable } from './tables/newSessions'
import { NewProjectsTable } from './tables/newProjects'
import { DeepChatSessionsTable } from './tables/deepchatSessions'
import { DeepChatMessagesTable } from './tables/deepchatMessages'
import { DeepChatUserMessagesTable } from './tables/deepchatUserMessages'
import { DeepChatUserMessageFilesTable } from './tables/deepchatUserMessageFiles'
import { DeepChatUserMessageLinksTable } from './tables/deepchatUserMessageLinks'
import { DeepChatAssistantBlocksTable } from './tables/deepchatAssistantBlocks'
import { DeepChatMessageTracesTable } from './tables/deepchatMessageTraces'
import { DeepChatMessageSearchResultsTable } from './tables/deepchatMessageSearchResults'
import { DeepChatSearchDocumentsTable } from './tables/deepchatSearchDocuments'
import { DeepChatPendingInputsTable } from './tables/deepchatPendingInputs'
import { DeepChatUsageStatsTable } from './tables/deepchatUsageStats'
import { DeepChatTapeEntriesTable } from './tables/deepchatTapeEntries'
import { DeepChatTapeSearchProjectionTable } from './tables/deepchatTapeSearchProjection'
import { LegacyImportStatusTable } from './tables/legacyImportStatus'
import { AgentsTable } from './tables/agents'
import { AgentMemoryTable } from './tables/agentMemory'
import { AgentMemoryAuditTable } from './tables/agentMemoryAudit'
import { NewSessionActiveSkillsTable } from './tables/newSessionActiveSkills'
import { NewSessionDisabledAgentToolsTable } from './tables/newSessionDisabledAgentTools'
import { SettingsActivityTable } from './tables/settingsActivity'
import type { BaseTable } from './tables/baseTable'
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
  afterRepair?: (db: Database.Database) => void
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
    createTable: (db) => new DeepChatPendingInputsTable(db)
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
      category: 'ALTER TABLE agent_memory ADD COLUMN category TEXT;'
    }
  },
  {
    name: 'agent_memory_audit',
    createTable: (db) => new AgentMemoryAuditTable(db)
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
