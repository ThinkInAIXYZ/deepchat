import type Database from 'better-sqlite3-multiple-ciphers'

export interface SchemaColumnSpec {
  name: string
  declaredType: string | null
  addColumnSql?: string
  checkType?: boolean
}

export interface SchemaIndexSpec {
  name: string
  createSql: string
}

export interface SchemaTableSpec {
  name: string
  createSql: string
  columns: SchemaColumnSpec[]
  indexes: SchemaIndexSpec[]
  afterRepair?: (db: Database.Database) => void
}
