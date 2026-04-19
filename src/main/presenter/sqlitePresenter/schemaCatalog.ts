import Database from 'better-sqlite3-multiple-ciphers'
import { ConversationsTable } from './tables/conversations'
import { MessagesTable } from './tables/messages'
import { MessageAttachmentsTable } from './tables/messageAttachments'
import { AcpSessionsTable } from './tables/acpSessions'
import { NewEnvironmentsTable } from './tables/newEnvironments'
import { NewSessionsTable } from './tables/newSessions'
import { NewProjectsTable } from './tables/newProjects'
import { DeepChatSessionsTable } from './tables/deepchatSessions'
import { DeepChatMessagesTable } from './tables/deepchatMessages'
import { DeepChatMessageTracesTable } from './tables/deepchatMessageTraces'
import { DeepChatMessageSearchResultsTable } from './tables/deepchatMessageSearchResults'
import { DeepChatPendingInputsTable } from './tables/deepchatPendingInputs'
import { DeepChatUsageStatsTable } from './tables/deepchatUsageStats'
import { LegacyImportStatusTable } from './tables/legacyImportStatus'
import { AgentsTable } from './tables/agents'
import type { BaseTable } from './tables/baseTable'
import type { SchemaTableSpec } from './schemaTypes'

interface CatalogDefinition {
  name: string
  createTable: (db: Database.Database) => BaseTable
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
    name: 'new_environments',
    createTable: (db) => new NewEnvironmentsTable(db),
    afterRepair: (db) => {
      new NewEnvironmentsTable(db).rebuildFromSessions()
    }
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
      context_length: 'ALTER TABLE deepchat_sessions ADD COLUMN context_length INTEGER;',
      max_tokens: 'ALTER TABLE deepchat_sessions ADD COLUMN max_tokens INTEGER;',
      thinking_budget: 'ALTER TABLE deepchat_sessions ADD COLUMN thinking_budget INTEGER;',
      reasoning_effort: 'ALTER TABLE deepchat_sessions ADD COLUMN reasoning_effort TEXT;',
      verbosity: 'ALTER TABLE deepchat_sessions ADD COLUMN verbosity TEXT;',
      summary_text: 'ALTER TABLE deepchat_sessions ADD COLUMN summary_text TEXT;',
      summary_cursor_order_seq:
        'ALTER TABLE deepchat_sessions ADD COLUMN summary_cursor_order_seq INTEGER NOT NULL DEFAULT 1;',
      summary_updated_at: 'ALTER TABLE deepchat_sessions ADD COLUMN summary_updated_at INTEGER;',
      force_interleaved_thinking_compat:
        'ALTER TABLE deepchat_sessions ADD COLUMN force_interleaved_thinking_compat INTEGER;',
      reasoning_visibility: 'ALTER TABLE deepchat_sessions ADD COLUMN reasoning_visibility TEXT;'
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
    name: 'deepchat_message_traces',
    createTable: (db) => new DeepChatMessageTracesTable(db)
  },
  {
    name: 'deepchat_message_search_results',
    createTable: (db) => new DeepChatMessageSearchResultsTable(db)
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
    name: 'legacy_import_status',
    createTable: (db) => new LegacyImportStatusTable(db)
  },
  {
    name: 'agents',
    createTable: (db) => new AgentsTable(db)
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
