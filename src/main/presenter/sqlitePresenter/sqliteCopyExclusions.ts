export const SQLITE_COPY_EXCLUDED_TABLES = new Set([
  'agent_memory_fts_meta',
  'deepchat_tape_search_fts_meta'
])

export function shouldExcludeFromSqliteCopy(tableName: string): boolean {
  return SQLITE_COPY_EXCLUDED_TABLES.has(tableName)
}
