// These catalog tables still exist for legacy/manual repair, but fresh new-stack startup does not
// create them in SQLitePresenter.initTables(). Keep this list in sync with that fresh create path so
// startup diagnosis and repair do not materialize retired legacy tables automatically.
export const SCHEMA_TABLES_NOT_CREATED_ON_FRESH_INSTALL = [
  'conversations',
  'messages',
  'message_attachments'
] as const

const schemaTablesNotCreatedOnFreshInstall = new Set<string>(
  SCHEMA_TABLES_NOT_CREATED_ON_FRESH_INSTALL
)

export function isSchemaTableCreatedOnFreshInstall(tableName: string): boolean {
  return !schemaTablesNotCreatedOnFreshInstall.has(tableName)
}

export function getSchemaTablesNotCreatedOnFreshInstall(): string[] {
  return [...SCHEMA_TABLES_NOT_CREATED_ON_FRESH_INSTALL]
}
