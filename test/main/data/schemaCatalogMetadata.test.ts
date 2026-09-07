import path from 'path'
import { fileURLToPath } from 'url'
import { describe, expect, it, vi } from 'vitest'
import {
  getSchemaTablesNotCreatedOnFreshInstall,
  isSchemaTableCreatedOnFreshInstall
} from '@/data/schemaCatalogMetadata'

const fs = await vi.importActual<typeof import('fs')>('fs')
const dataSourceDir = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../../../src/main/data'
)
function readSource(sourceDir: string, relativePath: string): string {
  return fs.readFileSync(path.join(sourceDir, relativePath), 'utf8')
}

function readCreateTablesSource(): string {
  const source = readSource(dataSourceDir, 'schemaCatalog.ts')
  const start = source.indexOf('export function createMainSchemaCatalog')

  expect(start).toBeGreaterThanOrEqual(0)

  return source.slice(start)
}

describe('schema catalog fresh install metadata', () => {
  const tablesNotCreatedOnFreshInstall = getSchemaTablesNotCreatedOnFreshInstall()

  it('excludes only retired legacy conversation tables from fresh startup schema checks', () => {
    expect(tablesNotCreatedOnFreshInstall).toEqual([
      'conversations',
      'messages',
      'message_attachments'
    ])

    for (const tableName of tablesNotCreatedOnFreshInstall) {
      expect(isSchemaTableCreatedOnFreshInstall(tableName)).toBe(false)
    }
  })

  it('keeps active session tables in fresh startup schema checks', () => {
    expect(isSchemaTableCreatedOnFreshInstall('new_sessions')).toBe(true)
    expect(isSchemaTableCreatedOnFreshInstall('deepchat_sessions')).toBe(true)
  })

  it('keeps excluded tables present in the full schema catalog definitions', () => {
    const catalogSource = readSource(dataSourceDir, 'schemaCatalog.ts')

    for (const tableName of tablesNotCreatedOnFreshInstall) {
      expect(catalogSource).toContain(`name: '${tableName}'`)
    }
  })

  it('keeps excluded tables out of the fresh initTables creation path', () => {
    const createTablesSource = readCreateTablesSource()
    const excludedConstructors = [
      'new ConversationsTable(',
      'new MessagesTable(',
      'new MessageAttachmentsTable('
    ]

    for (const constructor of excludedConstructors) {
      expect(createTablesSource).not.toContain(constructor)
    }

    expect(createTablesSource).toContain('new NewSessionsTable(')
    expect(createTablesSource).toContain('new DeepChatSessionsTable(')
  })
})
