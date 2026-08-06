import logger from '@shared/logger'
import type Database from 'better-sqlite3-multiple-ciphers'
import fs from 'fs'
import type { DatabaseRepairReport, DatabaseSchemaDiagnosis } from '@shared/types/databaseSchema'
import { DatabaseRepairService, SchemaInspector } from '@/data/schemaRepair'
import type { SchemaTableSpec } from '@/data/schemaTypes'
import { openSQLiteDatabase } from '@/data/databaseConnection'
import { createMainSchemaCatalog, type MainSchemaCatalog } from '@/data/schemaCatalog'

export { openSQLiteDatabase } from '@/data/databaseConnection'

const DESTRUCTIVE_DATABASE_ERROR_PATTERNS = [
  /database disk image is malformed/i,
  /file is not a database/i,
  /SQLITE_CORRUPT/i,
  /SQLITE_NOTADB/i
]

function getErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message
  }

  if (typeof error === 'object' && error && 'message' in error) {
    return String((error as { message?: unknown }).message ?? '')
  }

  return String(error ?? '')
}

export function isDestructiveDatabaseError(error: unknown): boolean {
  const message = getErrorMessage(error)
  return DESTRUCTIVE_DATABASE_ERROR_PATTERNS.some((pattern) => pattern.test(message))
}

export function repairSQLiteDatabaseFile(
  dbPath: string,
  password?: string,
  options?: {
    catalog?: SchemaTableSpec[]
  }
): DatabaseRepairReport {
  const db = openSQLiteDatabase(dbPath, password)

  try {
    return new DatabaseRepairService(db, dbPath, options?.catalog).repair()
  } finally {
    db.close()
  }
}

function stripLeadingSqlComments(statement: string): string {
  return statement.replace(/^\s*(--[^\n]*(?:\r?\n|$))+/g, '').trim()
}

function splitSqlStatements(sql: string): string[] {
  const statements: string[] = []
  let current = ''
  let inSingleQuote = false
  let inDoubleQuote = false

  for (let index = 0; index < sql.length; index += 1) {
    const char = sql[index]
    const next = sql[index + 1]

    if (!inSingleQuote && !inDoubleQuote) {
      if (char === '-' && next === '-') {
        while (index + 1 < sql.length && sql[index + 1] !== '\n' && sql[index + 1] !== '\r') {
          index += 1
        }
        continue
      }

      if (char === '/' && next === '*') {
        if (current.length > 0 && !/\s$/.test(current)) {
          current += ' '
        }

        index += 2
        while (index < sql.length && !(sql[index] === '*' && sql[index + 1] === '/')) {
          index += 1
        }

        if (index >= sql.length) {
          break
        }

        index += 1
        continue
      }
    }

    if (char === "'" && !inDoubleQuote) {
      current += char
      if (inSingleQuote && next === "'") {
        current += next
        index += 1
        continue
      }
      inSingleQuote = !inSingleQuote
      continue
    }

    if (char === '"' && !inSingleQuote) {
      inDoubleQuote = !inDoubleQuote
      current += char
      continue
    }

    if (char === ';' && !inSingleQuote && !inDoubleQuote) {
      const trimmed = current.trim()
      if (trimmed) {
        statements.push(trimmed)
      }
      current = ''
      continue
    }

    current += char
  }

  const trailing = current.trim()
  if (trailing) {
    statements.push(trailing)
  }

  return statements
}

function shouldIgnoreMigrationStatementError(statement: string, error: unknown): boolean {
  const normalizedStatement = stripLeadingSqlComments(statement).toUpperCase()
  const message = getErrorMessage(error)

  if (
    /^ALTER TABLE\b[\s\S]*\bADD COLUMN\b/.test(normalizedStatement) &&
    /duplicate column name/i.test(message)
  ) {
    return true
  }

  if (/^CREATE(?: UNIQUE)? INDEX\b/.test(normalizedStatement) && /already exists/i.test(message)) {
    return true
  }

  if (
    /^ALTER TABLE\b[\s\S]*\bDROP COLUMN\b/.test(normalizedStatement) &&
    /no such column/i.test(message)
  ) {
    return true
  }

  return false
}

export class MainDatabase {
  private db!: Database.Database
  private schemaCatalog!: MainSchemaCatalog
  private currentVersion: number = 0
  private dbPath: string
  private password?: string
  private destructiveInitializationRetryCount = 0
  private databaseFileExistedBeforeOpen = false

  constructor(dbPath: string, password?: string) {
    this.dbPath = dbPath
    this.password = password
    try {
      this.initializeDatabase()
    } catch (error) {
      this.handleInitializationError(error)
    }
  }

  public getDatabase(): Database.Database {
    return this.db
  }

  public openDatabaseConnection(dbPath = this.dbPath): Database.Database {
    return openSQLiteDatabase(dbPath, this.password)
  }

  public getDatabasePath(): string {
    return this.dbPath
  }

  public getDatabasePassword(): string | undefined {
    return this.password
  }

  public getLatestSchemaVersion(): number {
    return this.schemaCatalog.migrationTables.reduce((maxVersion, table) => {
      const tableMaxVersion = table.getLatestVersion()
      return Math.max(maxVersion, tableMaxVersion)
    }, 0)
  }

  public reopenWithPassword(password?: string): void {
    this.password = password
    this.reopen()
  }

  public async diagnoseSchema(catalog?: SchemaTableSpec[]): Promise<DatabaseSchemaDiagnosis> {
    return new SchemaInspector(this.db, catalog).diagnose()
  }

  public async repairSchema(): Promise<DatabaseRepairReport> {
    return new DatabaseRepairService(this.db, this.dbPath).repair()
  }

  private initializeDatabase(): void {
    this.databaseFileExistedBeforeOpen = fs.existsSync(this.dbPath)

    const openStart = performance.now()
    this.db = openSQLiteDatabase(this.dbPath, this.password)
    this.db.prepare('SELECT 1').get()
    logger.info(`MainDatabase: phase=open duration=${(performance.now() - openStart).toFixed(2)}ms`)

    const initTablesStart = performance.now()
    this.schemaCatalog = createMainSchemaCatalog(this.db)
    this.schemaCatalog.createTables()
    this.initVersionTable()
    logger.info(
      `MainDatabase: phase=initTables duration=${(performance.now() - initTablesStart).toFixed(2)}ms`
    )

    const migrateStart = performance.now()
    this.migrate()
    this.schemaCatalog.finalize({
      backupBeforeMemoryRecovery: () => this.createDatabaseBackup('memory-state-repair')
    })
    logger.info(
      `MainDatabase: phase=migrate duration=${(performance.now() - migrateStart).toFixed(2)}ms`
    )
  }

  private handleInitializationError(error: unknown): void {
    console.error('Database initialization failed:', error)

    if (isDestructiveDatabaseError(error)) {
      if (this.destructiveInitializationRetryCount > 0) {
        console.error('Destructive database recovery was already attempted once; aborting retry.')
        this.closeDatabaseSilently()
        throw error
      }

      this.destructiveInitializationRetryCount += 1
      this.backupDatabase()
      this.closeDatabaseSilently()
      this.cleanupDatabaseFiles()
      try {
        this.initializeDatabase()
      } catch (retryError) {
        this.handleInitializationError(retryError)
      }
      return
    }

    this.closeDatabaseSilently()
    throw error
  }

  private closeDatabaseSilently(): void {
    if (!this.db) {
      return
    }

    try {
      this.db.close()
    } catch (error) {
      console.error('Error closing database:', error)
    }
  }

  private backupDatabase(): void {
    this.createDatabaseBackup()
  }

  private createDatabaseBackup(reason?: string): string | null {
    // Bypass mocked node:fs so recovery always copies the real database file.
    const nativeFs = process.getBuiltinModule('fs')
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-')
    const suffix = reason ? `.${reason}.bak` : '.bak'
    const backupPath = `${this.dbPath}.${timestamp}${suffix}`

    try {
      if (nativeFs.existsSync(this.dbPath)) {
        if (this.db?.open) {
          this.db.pragma('wal_checkpoint(TRUNCATE)')
        }
        nativeFs.copyFileSync(this.dbPath, backupPath)
        logger.info(`Database backed up to: ${backupPath}`)
        return backupPath
      }
    } catch (error) {
      console.error('Error creating database backup:', error)
    }
    return null
  }

  private cleanupDatabaseFiles(): void {
    const filesToDelete = [this.dbPath, `${this.dbPath}-wal`, `${this.dbPath}-shm`]

    for (const file of filesToDelete) {
      try {
        if (fs.existsSync(file)) {
          fs.unlinkSync(file)
          logger.info(`Deleted file: ${file}`)
        }
      } catch (error) {
        console.error(`Error deleting file ${file}:`, error)
      }
    }
  }

  private initVersionTable() {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS schema_versions (
        version INTEGER PRIMARY KEY,
        applied_at INTEGER NOT NULL
      )
    `)

    const result = this.db.prepare('SELECT MAX(version) as version FROM schema_versions').get() as {
      version: number
      applied_at: number
    }
    this.currentVersion = result?.version || 0
  }

  private migrate() {
    // 获取所有表的迁移脚本
    const migrations = new Map<number, string[]>()
    const tables = this.schemaCatalog.migrationTables

    // 获取最新的迁移版本
    const latestVersion = this.getLatestSchemaVersion()

    if (!this.databaseFileExistedBeforeOpen && this.currentVersion === 0 && latestVersion > 0) {
      this.db
        .prepare('INSERT INTO schema_versions (version, applied_at) VALUES (?, ?)')
        .run(latestVersion, Date.now())
      this.currentVersion = latestVersion
      return
    }

    // 只迁移未执行的版本
    tables.forEach((table) => {
      for (let version = this.currentVersion + 1; version <= latestVersion; version++) {
        const sql = table.getMigrationSQL?.(version)
        if (sql) {
          if (!migrations.has(version)) {
            migrations.set(version, [])
          }
          migrations.get(version)?.push(sql)
        }
      }
    })

    // Schema versions are a monotonic high-water mark. Record intentionally empty versions too so
    // a removed or abandoned migration number can never be reused after a newer version ships.
    for (let version = this.currentVersion + 1; version <= latestVersion; version++) {
      const migrationSQLs = migrations.get(version) || []
      this.db.transaction(() => {
        if (migrationSQLs.length > 0) {
          logger.info(`Executing migration version ${version}`)
          migrationSQLs.forEach((sqlBlock) => {
            for (const statement of splitSqlStatements(sqlBlock)) {
              logger.info(`Executing SQL: ${statement}`)
              try {
                this.db.exec(statement)
              } catch (error) {
                if (shouldIgnoreMigrationStatementError(statement, error)) {
                  console.warn(`Ignoring migration statement error for: ${statement}`, error)
                  continue
                }

                throw error
              }
            }
          })
          tables.forEach((table) => table.finalizeMigration?.(version))
        }
        this.db
          .prepare('INSERT INTO schema_versions (version, applied_at) VALUES (?, ?)')
          .run(version, Date.now())
      })()
    }
  }

  // 关闭数据库连接
  public close() {
    try {
      this.db.close()
    } catch (error) {
      console.warn('Failed to close database:', error)
    }
  }

  public reopen() {
    try {
      this.close()
      this.initializeDatabase()
    } catch (error) {
      console.error('Failed to reopen database:', error)
      throw error
    }
  }

  public async runTransaction(operations: () => void): Promise<void> {
    await this.db.transaction(operations)()
  }
}
