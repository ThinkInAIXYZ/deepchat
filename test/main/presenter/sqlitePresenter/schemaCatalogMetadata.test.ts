import path from 'path'
import { fileURLToPath } from 'url'
import { describe, expect, it, vi } from 'vitest'
import {
  getSchemaTablesNotCreatedOnFreshInstall,
  isSchemaTableCreatedOnFreshInstall
} from '@/presenter/sqlitePresenter/schemaCatalogMetadata'

const fs = await vi.importActual<typeof import('fs')>('fs')
const sourceDir = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../../../../src/main/presenter/sqlitePresenter'
)

function readSource(relativePath: string): string {
  return fs.readFileSync(path.join(sourceDir, relativePath), 'utf8')
}

function readInitTablesSource(): string {
  const source = readSource('index.ts')
  const start = source.indexOf('  private initTables()')
  const end = source.indexOf('  private initVersionTable()', start)

  expect(start).toBeGreaterThanOrEqual(0)
  expect(end).toBeGreaterThan(start)

  return source.slice(start, end)
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
    const catalogSource = readSource('schemaCatalog.ts')

    for (const tableName of tablesNotCreatedOnFreshInstall) {
      expect(catalogSource).toContain(`name: '${tableName}'`)
    }
  })

  it('keeps excluded tables out of the fresh initTables creation path', () => {
    const initTablesSource = readInitTablesSource()
    const excludedCreateCalls = [
      'this.conversationsTable.createTable()',
      'this.messagesTable.createTable()',
      'this.messageAttachmentsTable.createTable()'
    ]

    for (const createCall of excludedCreateCalls) {
      expect(initTablesSource).not.toContain(createCall)
    }

    expect(initTablesSource).toContain('this.newSessionsTable.createTable()')
    expect(initTablesSource).toContain('this.deepchatSessionsTable.createTable()')
  })
})
