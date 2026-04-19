import { beforeEach, describe, expect, it, vi } from 'vitest'
import { SchemaInspector } from '../../../../src/main/presenter/sqlitePresenter/schemaRepair'
import type { SchemaTableSpec } from '../../../../src/main/presenter/sqlitePresenter/schemaTypes'

describe('SchemaInspector table snapshot quoting', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
  })

  it('quotes special table names before issuing PRAGMA table_info', () => {
    const tableName = `agent's notes`
    const quotedTableName = `'agent''s notes'`
    const prepare = vi.fn((sql: string) => {
      if (sql.includes('FROM sqlite_master') && sql.includes("WHERE type = 'table'")) {
        return {
          all: () => [{ name: tableName }]
        }
      }

      if (sql === 'SELECT quote(?)') {
        return {
          pluck: () => ({
            get: (value: string) => {
              expect(value).toBe(tableName)
              return quotedTableName
            }
          })
        }
      }

      if (sql === `PRAGMA table_info(${quotedTableName})`) {
        return {
          all: () => [
            {
              name: 'id',
              type: 'TEXT'
            }
          ]
        }
      }

      if (sql.includes('FROM sqlite_master') && sql.includes("WHERE type = 'index'")) {
        return {
          all: (value: string) => {
            expect(value).toBe(tableName)
            return []
          }
        }
      }

      throw new Error(`Unexpected SQL: ${sql}`)
    })

    const db = { prepare } as any
    const catalog: SchemaTableSpec[] = [
      {
        name: tableName,
        createSql: '',
        columns: [
          {
            name: 'id',
            declaredType: 'TEXT',
            checkType: true
          }
        ],
        indexes: []
      }
    ]

    const diagnosis = new SchemaInspector(db, catalog).diagnose()

    expect(diagnosis.isHealthy).toBe(true)
    expect(prepare).toHaveBeenCalledWith('SELECT quote(?)')
    expect(prepare).toHaveBeenCalledWith(`PRAGMA table_info(${quotedTableName})`)
    expect(prepare).not.toHaveBeenCalledWith(`PRAGMA table_info(${tableName})`)
  })

  it('reports a type mismatch when the actual column type is empty', () => {
    const tableName = 'typed_table'
    const quotedTableName = `'typed_table'`
    const prepare = vi.fn((sql: string) => {
      if (sql.includes('FROM sqlite_master') && sql.includes("WHERE type = 'table'")) {
        return {
          all: () => [{ name: tableName }]
        }
      }

      if (sql === 'SELECT quote(?)') {
        return {
          pluck: () => ({
            get: () => quotedTableName
          })
        }
      }

      if (sql === `PRAGMA table_info(${quotedTableName})`) {
        return {
          all: () => [
            {
              name: 'id',
              type: ''
            }
          ]
        }
      }

      if (sql.includes('FROM sqlite_master') && sql.includes("WHERE type = 'index'")) {
        return {
          all: () => []
        }
      }

      throw new Error(`Unexpected SQL: ${sql}`)
    })

    const db = { prepare } as any
    const catalog: SchemaTableSpec[] = [
      {
        name: tableName,
        createSql: '',
        columns: [
          {
            name: 'id',
            declaredType: 'TEXT',
            checkType: true
          }
        ],
        indexes: []
      }
    ]

    const diagnosis = new SchemaInspector(db, catalog).diagnose()

    expect(diagnosis.isHealthy).toBe(false)
    expect(diagnosis.issues).toEqual([
      expect.objectContaining({
        kind: 'column_type_mismatch',
        table: tableName,
        name: 'id',
        expectedType: 'TEXT',
        actualType: null
      })
    ])
  })
})
