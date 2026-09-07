export const SQLITE_COPY_EXCLUDED_OBJECTS = new Set([
  'agent_memory_dirty',
  'agent_memory_dirty_ai',
  'agent_memory_dirty_au',
  'agent_memory_dirty_ad',
  'agent_memory_fts_meta',
  'deepchat_tape_search_fts_meta'
])

export function shouldExcludeFromSqliteCopy(objectName: string): boolean {
  return SQLITE_COPY_EXCLUDED_OBJECTS.has(objectName)
}
