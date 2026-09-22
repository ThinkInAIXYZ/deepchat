import { SYNC_PORTABLE_SETTINGS } from '@shared/types/syncPortableSettings'
import type { SyncRow } from '@shared/contracts/syncReplica'

export interface SyncTable {
  table: string
  key: string
  messageChild?: boolean
  local?: string[]
}
export interface SyncUnitDefinition {
  kind: string
  tables: SyncTable[]
  keys?: readonly string[]
}

// Only these domain-owned records cross devices. Jobs, approvals, local paths and indexes do not.
export const SYNC_UNITS: SyncUnitDefinition[] = [
  {
    kind: 'session',
    tables: [
      { table: 'new_sessions', key: 'id', local: ['project_dir'] },
      { table: 'deepchat_sessions', key: 'id' },
      { table: 'deepchat_session_metadata', key: 'session_id' },
      { table: 'new_session_active_skills', key: 'session_id' },
      { table: 'new_session_disabled_agent_tools', key: 'session_id' },
      { table: 'deepchat_tape_entries', key: 'session_id' },
      { table: 'deepchat_messages', key: 'session_id' },
      { table: 'deepchat_user_messages', key: 'message_id', messageChild: true },
      { table: 'deepchat_user_message_files', key: 'message_id', messageChild: true },
      { table: 'deepchat_user_message_links', key: 'message_id', messageChild: true },
      { table: 'deepchat_assistant_blocks', key: 'message_id', messageChild: true },
      { table: 'deepchat_message_traces', key: 'session_id' },
      { table: 'deepchat_message_search_results', key: 'session_id' }
    ]
  },
  {
    kind: 'provider',
    tables: [
      { table: 'providers', key: 'id', local: ['last_used_at'] },
      { table: 'provider_models', key: 'provider_id' },
      { table: 'model_status', key: 'provider_id' },
      { table: 'model_configs', key: 'provider_id' }
    ]
  },
  { kind: 'agent', tables: [{ table: 'agents', key: 'id', local: ['state_json'] }] },
  { kind: 'memory-tombstone', tables: [{ table: 'agent_memory_tombstone', key: 'identity_hash' }] },
  { kind: 'mcp', tables: [{ table: 'mcp_servers', key: 'name' }] },
  {
    kind: 'setting',
    tables: [{ table: 'app_settings', key: 'key' }],
    keys: ['customPrompts', 'systemPrompts', ...SYNC_PORTABLE_SETTINGS]
  },
  {
    kind: 'memory',
    tables: [
      {
        table: 'agent_memory',
        key: 'id',
        local: [
          'embedding_id',
          'embedding_dim',
          'embedding_model',
          'embedding_state',
          'last_accessed',
          'access_count',
          'decay_score'
        ]
      }
    ]
  }
]

export function quoteIdentifier(value: string): string {
  if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(value)) throw new Error('Invalid sync column')
  return `"${value}"`
}

export function sessionIdForRow(
  table: SyncTable,
  row: SyncRow,
  messages: SyncRow[]
): string | null {
  const value = table.messageChild
    ? messages.find((message) => message.id === row.message_id)?.session_id
    : row[table.key]
  return typeof value === 'string' ? value : null
}
