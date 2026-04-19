import fs from 'fs'
import type Database from 'better-sqlite3-multiple-ciphers'
import type {
  DatabaseRepairReport,
  DatabaseSchemaDiagnosis,
  DatabaseSchemaIssue
} from '@shared/presenter'
import { getSchemaCatalog } from './schemaCatalog'
import type { SchemaTableSpec } from './schemaTypes'

interface SchemaSnapshotTable {
  columns: Map<string, string | null>
  indexes: Set<string>
}

function normalizeDeclaredType(type: string | null | undefined): string | null {
  const normalized = type?.trim().toUpperCase()
  return normalized ? normalized : null
}

function createIssue(issue: DatabaseSchemaIssue): DatabaseSchemaIssue {
  return issue
}

function quotePragmaTableName(db: Database.Database, tableName: string): string {
  return db.prepare('SELECT quote(?)').pluck().get(tableName) as string
}

function readSchemaSnapshot(db: Database.Database): Map<string, SchemaSnapshotTable> {
  const tableRows = db
    .prepare(
      `SELECT name
       FROM sqlite_master
       WHERE type = 'table'
         AND name NOT LIKE 'sqlite_%'`
    )
    .all() as Array<{ name: string }>

  const snapshot = new Map<string, SchemaSnapshotTable>()

  for (const { name } of tableRows) {
    const quotedTableName = quotePragmaTableName(db, name)
    const columns = db.prepare(`PRAGMA table_info(${quotedTableName})`).all() as Array<{
      name: string
      type: string
    }>
    const indexes = db
      .prepare(
        `SELECT name
         FROM sqlite_master
         WHERE type = 'index'
           AND tbl_name = ?
           AND name NOT LIKE 'sqlite_%'`
      )
      .all(name) as Array<{ name: string }>

    snapshot.set(name, {
      columns: new Map(
        columns.map((column) => [column.name, normalizeDeclaredType(column.type)] as const)
      ),
      indexes: new Set(indexes.map((index) => index.name))
    })
  }

  return snapshot
}

export class SchemaInspector {
  constructor(
    private readonly db: Database.Database,
    private readonly catalog: SchemaTableSpec[] = getSchemaCatalog()
  ) {}

  diagnose(): DatabaseSchemaDiagnosis {
    const checkedAt = Date.now()
    const snapshot = readSchemaSnapshot(this.db)
    const issues: DatabaseSchemaIssue[] = []

    for (const table of this.catalog) {
      const actualTable = snapshot.get(table.name)

      if (!actualTable) {
        issues.push(
          createIssue({
            kind: 'missing_table',
            table: table.name,
            name: table.name,
            repairable: true,
            message: `Missing table "${table.name}".`
          })
        )
        continue
      }

      for (const column of table.columns) {
        const actualType = actualTable.columns.get(column.name)

        if (actualType === undefined) {
          issues.push(
            createIssue({
              kind: 'missing_column',
              table: table.name,
              name: column.name,
              repairable: Boolean(column.addColumnSql),
              message: `Missing column "${table.name}.${column.name}".`,
              expectedType: column.declaredType,
              actualType: null
            })
          )
          continue
        }

        if (
          column.checkType &&
          column.declaredType &&
          (actualType === null || actualType !== column.declaredType)
        ) {
          issues.push(
            createIssue({
              kind: 'column_type_mismatch',
              table: table.name,
              name: column.name,
              repairable: false,
              message: `Column "${table.name}.${column.name}" has type "${actualType}", expected "${column.declaredType}".`,
              expectedType: column.declaredType,
              actualType
            })
          )
        }
      }

      for (const index of table.indexes) {
        if (!actualTable.indexes.has(index.name)) {
          issues.push(
            createIssue({
              kind: 'missing_index',
              table: table.name,
              name: index.name,
              repairable: true,
              message: `Missing index "${index.name}" on table "${table.name}".`
            })
          )
        }
      }
    }

    const repairableIssues = issues.filter((issue) => issue.repairable)
    const manualIssues = issues.filter((issue) => !issue.repairable)

    return {
      checkedAt,
      isHealthy: issues.length === 0,
      issues,
      repairableIssues,
      manualIssues
    }
  }
}

function buildIssueKey(issue: Pick<DatabaseSchemaIssue, 'kind' | 'table' | 'name'>): string {
  return `${issue.kind}:${issue.table}:${issue.name}`
}

export class DatabaseRepairService {
  private readonly inspector: SchemaInspector

  constructor(
    private readonly db: Database.Database,
    private readonly dbPath?: string,
    private readonly catalog: SchemaTableSpec[] = getSchemaCatalog()
  ) {
    this.inspector = new SchemaInspector(db, catalog)
  }

  diagnose(): DatabaseSchemaDiagnosis {
    return this.inspector.diagnose()
  }

  repair(): DatabaseRepairReport {
    const startedAt = Date.now()
    const diagnosisBeforeRepair = this.diagnose()

    if (diagnosisBeforeRepair.isHealthy) {
      return {
        startedAt,
        finishedAt: Date.now(),
        status: 'healthy',
        backupPath: null,
        diagnosisBeforeRepair,
        diagnosisAfterRepair: diagnosisBeforeRepair,
        repairedIssues: [],
        remainingIssues: []
      }
    }

    if (diagnosisBeforeRepair.repairableIssues.length === 0) {
      return {
        startedAt,
        finishedAt: Date.now(),
        status: 'manual-action-required',
        backupPath: null,
        diagnosisBeforeRepair,
        diagnosisAfterRepair: diagnosisBeforeRepair,
        repairedIssues: [],
        remainingIssues: diagnosisBeforeRepair.issues
      }
    }

    const backupPath = this.createBackup()
    const repairedIssueKeys = new Set<string>()
    const pendingAfterRepairTables = new Set<string>()

    this.db.transaction(() => {
      for (const table of this.catalog) {
        const tableIssues = diagnosisBeforeRepair.issues.filter(
          (issue) => issue.table === table.name
        )
        const missingTableIssue = tableIssues.find((issue) => issue.kind === 'missing_table')

        if (missingTableIssue) {
          this.db.exec(table.createSql)
          if (table.afterRepair) {
            pendingAfterRepairTables.add(table.name)
          }
          repairedIssueKeys.add(buildIssueKey(missingTableIssue))
          continue
        }

        for (const issue of tableIssues) {
          if (issue.kind !== 'missing_column' || !issue.repairable) {
            continue
          }

          const columnSpec = table.columns.find((column) => column.name === issue.name)
          if (!columnSpec?.addColumnSql) {
            continue
          }

          this.db.exec(columnSpec.addColumnSql)
          if (table.afterRepair) {
            pendingAfterRepairTables.add(table.name)
          }
          repairedIssueKeys.add(buildIssueKey(issue))
        }

        for (const issue of tableIssues) {
          if (issue.kind !== 'missing_index') {
            continue
          }

          const indexSpec = table.indexes.find((index) => index.name === issue.name)
          if (!indexSpec) {
            continue
          }

          this.db.exec(indexSpec.createSql)
          repairedIssueKeys.add(buildIssueKey(issue))
        }
      }

      for (const tableName of pendingAfterRepairTables) {
        this.catalog.find((table) => table.name === tableName)?.afterRepair?.(this.db)
      }
    })()

    const diagnosisAfterRepair = this.diagnose()
    const repairedIssues = diagnosisBeforeRepair.issues.filter((issue) =>
      repairedIssueKeys.has(buildIssueKey(issue))
    )
    const remainingIssues = diagnosisAfterRepair.issues

    const status = diagnosisAfterRepair.isHealthy
      ? repairedIssues.length > 0
        ? 'repaired'
        : 'healthy'
      : 'manual-action-required'

    return {
      startedAt,
      finishedAt: Date.now(),
      status,
      backupPath,
      diagnosisBeforeRepair,
      diagnosisAfterRepair,
      repairedIssues,
      remainingIssues
    }
  }

  private createBackup(): string | null {
    if (!this.dbPath || !fs.existsSync(this.dbPath)) {
      return null
    }

    const timestamp = new Date().toISOString().replace(/[:.]/g, '-')
    const backupPath = `${this.dbPath}.${timestamp}.repair.bak`
    this.db.pragma('wal_checkpoint(TRUNCATE)')
    fs.copyFileSync(this.dbPath, backupPath)
    return backupPath
  }
}
