import { app, safeStorage } from 'electron'
import ElectronStore from 'electron-store'
import fs from 'fs'
import path from 'path'
import Database from 'better-sqlite3-multiple-ciphers'
import type { IConfigPresenter } from '@shared/presenter'
import type { DatabaseSecurityStatus } from '@shared/contracts/routes'
import type { DatabaseUnlockReason } from '@shared/contracts/databaseSecurity'
import { openSQLiteDatabase, type SQLitePresenter } from '../sqlitePresenter'
import { configureSQLCipherCompatibility } from '../sqlitePresenter/connectionConfig'
import { shouldExcludeFromSqliteCopy } from '../sqlitePresenter/sqliteCopyExclusions'

type DatabaseSecurityMetadata = {
  version: 1
  enabled: boolean
  cipher: 'sqlcipher'
  passwordStorage: 'safeStorage' | 'manual' | 'none'
  wrappedPassword?: string
  safeStorageBackend?: string
  lastMigrationAt?: number
  lastMigrationDirection?: 'enable' | 'change-password' | 'disable'
}

type UnlockRequest = {
  reason: DatabaseUnlockReason
  safeStorageAvailable: boolean
}

type UnlockProvider = (request: UnlockRequest) => Promise<string | null>

type MigrationDirection = 'enable' | 'change-password' | 'disable'

const DEFAULT_METADATA: DatabaseSecurityMetadata = {
  version: 1,
  enabled: false,
  cipher: 'sqlcipher',
  passwordStorage: 'none'
}

const VALIDATION_TABLES = [
  'schema_versions',
  'new_sessions',
  'deepchat_sessions',
  'deepchat_tape_entries',
  'providers',
  'mcp_servers',
  'agents'
]

const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T

const sidecarPaths = (dbPath: string): string[] => [`${dbPath}-wal`, `${dbPath}-shm`]

const MIGRATION_TARGET_SCHEMA = 'migration_target'
const activeMigrationDbPaths = new Set<string>()

type SqliteSchemaRow = {
  type: 'table' | 'index' | 'trigger' | 'view'
  name: string
  sql: string
}

const quoteIdentifier = (value: string): string => `"${value.replace(/"/g, '""')}"`
const getMigrationLockPath = (dbPath: string): string => path.resolve(dbPath)

const FTS_SCHEMA_OBJECT_NAME_PATTERN = /(^|_)fts($|_)/i
const FTS_TRIGGER_NAME_PATTERN = /_(ai|ad|au)$/i

function isFtsMaintenanceSchemaObject(row: SqliteSchemaRow & { tbl_name?: string }): boolean {
  const sql = row.sql.toLowerCase()
  return (
    FTS_SCHEMA_OBJECT_NAME_PATTERN.test(row.name) ||
    (row.tbl_name ? FTS_SCHEMA_OBJECT_NAME_PATTERN.test(row.tbl_name) : false) ||
    /\b[a-z0-9_]+_fts\b/i.test(row.sql) ||
    /\busing\s+fts[345]?\b/i.test(row.sql) ||
    (row.type === 'trigger' &&
      FTS_TRIGGER_NAME_PATTERN.test(row.name) &&
      sql.includes('insert into'))
  )
}

export class DatabaseSecurityPresenter {
  private readonly store: ElectronStore<{ metadata: DatabaseSecurityMetadata }>
  private readonly dbPath: string
  private migrationInProgress = false

  constructor(options?: { dbPath?: string }) {
    const dbDir = path.join(app.getPath('userData'), 'app_db')
    this.dbPath = options?.dbPath ?? path.join(dbDir, 'agent.db')
    this.store = new ElectronStore<{ metadata: DatabaseSecurityMetadata }>({
      name: 'database-security',
      defaults: {
        metadata: DEFAULT_METADATA
      }
    })
    this.recoverInterruptedMigrationFiles()
  }

  getStatus(): DatabaseSecurityStatus {
    const metadata = this.getMetadata()
    const safeStorageAvailable = this.isSafeStorageAvailable()
    return {
      enabled: metadata.enabled,
      cipher: 'sqlcipher',
      safeStorageAvailable,
      safeStorageBackend: this.getSafeStorageBackend(),
      passwordStorage: metadata.passwordStorage,
      manualUnlockRequired:
        metadata.enabled &&
        (!safeStorageAvailable ||
          metadata.passwordStorage !== 'safeStorage' ||
          !metadata.wrappedPassword),
      migrationInProgress: this.isMigrationInProgress(),
      lastMigrationAt: metadata.lastMigrationAt
    }
  }

  async resolveStartupPassword(unlockProvider: UnlockProvider): Promise<string | undefined> {
    const metadata = this.getMetadata()
    if (!metadata.enabled) {
      return undefined
    }

    const safeStorageAvailable = this.isSafeStorageAvailable()
    let safeStorageUnlockFailed = false
    if (
      safeStorageAvailable &&
      metadata.passwordStorage === 'safeStorage' &&
      metadata.wrappedPassword
    ) {
      try {
        const password = this.unwrapPassword(metadata.wrappedPassword)
        this.validatePassword(password)
        return password
      } catch {
        safeStorageUnlockFailed = true
        console.warn('[DatabaseSecurity] safeStorage unlock failed; manual unlock required.')
      }
    }

    let reason: UnlockRequest['reason'] = safeStorageUnlockFailed
      ? 'system-key-missing'
      : safeStorageAvailable
        ? 'manual-required'
        : 'safe-storage-unavailable'

    while (true) {
      const password = await unlockProvider({ reason, safeStorageAvailable })
      if (password === null) {
        app.quit()
        throw new Error('Database unlock canceled')
      }

      try {
        this.validatePassword(password)
        if (safeStorageAvailable) {
          this.persistMetadata({
            ...metadata,
            passwordStorage: 'safeStorage',
            wrappedPassword: this.wrapPassword(password),
            safeStorageBackend: this.getSafeStorageBackend()
          })
        }
        return password
      } catch {
        reason = 'invalid'
      }
    }
  }

  async enableEncryption(input: {
    password: string
    sqlitePresenter: SQLitePresenter
    configPresenter: IConfigPresenter
  }): Promise<DatabaseSecurityStatus> {
    this.assertPassword(input.password)
    const metadata = this.getMetadata()
    if (metadata.enabled) {
      throw new Error('Database encryption is already enabled')
    }

    this.cleanupLegacyProviderJson(input.configPresenter)
    await this.migrateDatabase({
      sqlitePresenter: input.sqlitePresenter,
      configPresenter: input.configPresenter,
      sourcePassword: undefined,
      targetPassword: input.password,
      direction: 'enable'
    })
    this.persistUnlockedMetadata(input.password, 'enable')
    return this.getStatus()
  }

  async changePassword(input: {
    currentPassword: string
    newPassword: string
    sqlitePresenter: SQLitePresenter
    configPresenter: IConfigPresenter
  }): Promise<DatabaseSecurityStatus> {
    this.assertEnabled()
    this.assertPassword(input.currentPassword)
    this.assertPassword(input.newPassword)
    if (input.currentPassword === input.newPassword) {
      throw new Error('New SQLite password must differ from the current password')
    }
    this.validatePassword(input.currentPassword)

    this.cleanupLegacyProviderJson(input.configPresenter)
    await this.migrateDatabase({
      sqlitePresenter: input.sqlitePresenter,
      configPresenter: input.configPresenter,
      sourcePassword: input.currentPassword,
      targetPassword: input.newPassword,
      direction: 'change-password'
    })
    this.persistUnlockedMetadata(input.newPassword, 'change-password')
    return this.getStatus()
  }

  async disableEncryption(input: {
    currentPassword: string
    sqlitePresenter: SQLitePresenter
    configPresenter: IConfigPresenter
  }): Promise<DatabaseSecurityStatus> {
    this.assertEnabled()
    this.assertPassword(input.currentPassword)
    this.validatePassword(input.currentPassword)

    await this.migrateDatabase({
      sqlitePresenter: input.sqlitePresenter,
      configPresenter: input.configPresenter,
      sourcePassword: input.currentPassword,
      targetPassword: undefined,
      direction: 'disable'
    })
    this.persistMetadata({
      ...DEFAULT_METADATA,
      lastMigrationAt: Date.now(),
      lastMigrationDirection: 'disable'
    })
    return this.getStatus()
  }

  validatePassword(password: string): void {
    const db = openSQLiteDatabase(this.dbPath, password)
    try {
      db.prepare('SELECT name FROM sqlite_master LIMIT 1').get()
    } finally {
      db.close()
    }
  }

  private async migrateDatabase(input: {
    sqlitePresenter: SQLitePresenter
    configPresenter: IConfigPresenter
    sourcePassword: string | undefined
    targetPassword: string | undefined
    direction: MigrationDirection
  }): Promise<void> {
    const dbPath = input.sqlitePresenter.getDatabasePath()
    this.acquireMigrationLock(dbPath)
    this.migrationInProgress = true
    const tempPath = this.getTempPath(dbPath)
    const rollbackPath = this.getRollbackPath(dbPath)

    try {
      this.removeIfExists(tempPath)
      this.removeSidecars(tempPath)
      this.removeIfExists(rollbackPath)
      this.removeSidecars(rollbackPath)
      this.checkpointAndClose(input.sqlitePresenter)

      const expectedCounts = this.collectValidationCounts(dbPath, input.sourcePassword)
      this.exportDatabaseToTemp(dbPath, tempPath, input.sourcePassword, input.targetPassword)
      this.verifyMigratedDatabase(tempPath, input.targetPassword, expectedCounts)

      this.replaceDatabaseWithRollback(dbPath, tempPath, rollbackPath)

      try {
        input.sqlitePresenter.reopenWithPassword(input.targetPassword)
        ;(
          input.configPresenter as IConfigPresenter & {
            setSQLitePresenter?: (sqlitePresenter: SQLitePresenter) => void
          }
        ).setSQLitePresenter?.(input.sqlitePresenter)
      } catch (error) {
        input.sqlitePresenter.close()
        this.restoreRollbackDatabase(dbPath, rollbackPath)
        input.sqlitePresenter.reopenWithPassword(input.sourcePassword)
        throw error
      }

      this.removeIfExists(rollbackPath)
      this.removeSidecars(rollbackPath)
    } catch (error) {
      this.removeIfExists(tempPath)
      this.removeSidecars(tempPath)
      if (!fs.existsSync(dbPath) && fs.existsSync(rollbackPath)) {
        fs.renameSync(rollbackPath, dbPath)
      }
      if (!input.sqlitePresenter.getDatabase().open) {
        try {
          input.sqlitePresenter.reopenWithPassword(input.sourcePassword)
        } catch (reopenError) {
          console.error('[DatabaseSecurity] Failed to reopen original database:', reopenError)
        }
      }
      throw error
    } finally {
      this.migrationInProgress = false
      this.releaseMigrationLock(dbPath)
    }
  }

  private checkpointAndClose(sqlitePresenter: SQLitePresenter): void {
    const db = sqlitePresenter.getDatabase()
    if (db.open) {
      db.pragma('wal_checkpoint(TRUNCATE)')
    }
    sqlitePresenter.close()
  }

  private exportDatabaseToTemp(
    sourcePath: string,
    tempPath: string,
    sourcePassword: string | undefined,
    targetPassword: string | undefined
  ): void {
    const sourceDb = openSQLiteDatabase(sourcePath, sourcePassword)
    try {
      sourceDb.pragma('wal_checkpoint(TRUNCATE)')
      sourceDb.pragma('journal_mode = DELETE')
      this.attachMigrationTarget(sourceDb, tempPath, sourcePassword, targetPassword)
      this.copySchemaAndData(sourceDb)
      sourceDb.prepare(`DETACH DATABASE ${MIGRATION_TARGET_SCHEMA}`).run()
    } finally {
      sourceDb.close()
    }
  }

  private attachMigrationTarget(
    db: Database.Database,
    tempPath: string,
    sourcePassword: string | undefined,
    targetPassword: string | undefined
  ): void {
    if (targetPassword) {
      configureSQLCipherCompatibility(db)
      db.prepare(`ATTACH DATABASE ? AS ${MIGRATION_TARGET_SCHEMA} KEY ?`).run(
        tempPath,
        targetPassword
      )
      return
    }

    if (sourcePassword) {
      db.prepare(`ATTACH DATABASE ? AS ${MIGRATION_TARGET_SCHEMA} KEY ?`).run(tempPath, '')
      return
    }

    db.prepare(`ATTACH DATABASE ? AS ${MIGRATION_TARGET_SCHEMA}`).run(tempPath)
  }

  private copySchemaAndData(db: Database.Database): void {
    const tables = this.listMigratableTables(db)
    db.exec('BEGIN')
    try {
      for (const table of tables) {
        db.exec(this.qualifyCreateTableSql(table.sql))
      }

      for (const table of tables) {
        const tableName = quoteIdentifier(table.name)
        db.exec(
          `INSERT INTO ${MIGRATION_TARGET_SCHEMA}.${tableName}
           SELECT * FROM main.${tableName}`
        )
      }

      this.copySchemaObjects(db)
      this.copySqliteSequence(db)
      db.exec('COMMIT')
    } catch (error) {
      db.exec('ROLLBACK')
      throw error
    }
  }

  private copySchemaObjects(db: Database.Database): void {
    for (const object of this.listMigratableSchemaObjects(db)) {
      db.exec(this.qualifyCreateSchemaObjectSql(object))
    }
  }

  private listMigratableSchemaObjects(db: Database.Database): SqliteSchemaRow[] {
    const virtualTableNames = new Set(
      (
        db
          .prepare(
            `SELECT name, sql FROM sqlite_master
             WHERE type = 'table'
               AND sql IS NOT NULL
               AND name NOT LIKE 'sqlite_%'`
          )
          .all() as SqliteSchemaRow[]
      )
        .filter((row) => /^CREATE\s+VIRTUAL\s+TABLE\s+/i.test(row.sql))
        .map((row) => row.name)
    )
    const rows = db
      .prepare(
        `SELECT type, name, tbl_name, sql FROM sqlite_master
         WHERE type IN ('index', 'trigger', 'view')
           AND sql IS NOT NULL
           AND name NOT LIKE 'sqlite_%'
         ORDER BY CASE type WHEN 'index' THEN 0 WHEN 'trigger' THEN 1 ELSE 2 END, name ASC`
      )
      .all() as Array<SqliteSchemaRow & { tbl_name?: string }>
    return rows.filter((row) => {
      if (shouldExcludeFromSqliteCopy(row.name)) return false
      if (row.tbl_name && shouldExcludeFromSqliteCopy(row.tbl_name)) return false
      if (isFtsMaintenanceSchemaObject(row)) return false
      for (const virtualTableName of virtualTableNames) {
        if (
          row.name === virtualTableName ||
          row.name.startsWith(`${virtualTableName}_`) ||
          row.tbl_name === virtualTableName ||
          row.sql.includes(virtualTableName)
        ) {
          return false
        }
      }
      return true
    })
  }

  private listMigratableTables(db: Database.Database): SqliteSchemaRow[] {
    const rows = db
      .prepare(
        `SELECT type, name, sql FROM sqlite_master
         WHERE type = 'table'
           AND sql IS NOT NULL
           AND name NOT LIKE 'sqlite_%'
         ORDER BY name ASC`
      )
      .all() as SqliteSchemaRow[]
    const virtualTableNames = new Set(
      rows.filter((row) => /^CREATE\s+VIRTUAL\s+TABLE\s+/i.test(row.sql)).map((row) => row.name)
    )

    return rows.filter((row) => {
      if (shouldExcludeFromSqliteCopy(row.name)) {
        return false
      }
      for (const virtualTableName of virtualTableNames) {
        if (row.name === virtualTableName || row.name.startsWith(`${virtualTableName}_`)) {
          return false
        }
      }
      return !/^CREATE\s+VIRTUAL\s+TABLE\s+/i.test(row.sql)
    })
  }

  private qualifyCreateTableSql(sql: string): string {
    return sql.replace(
      /^CREATE\s+TABLE\s+(IF\s+NOT\s+EXISTS\s+)?/i,
      (_match, ifNotExists: string | undefined) =>
        `CREATE TABLE ${ifNotExists ?? ''}${MIGRATION_TARGET_SCHEMA}.`
    )
  }

  private qualifyCreateSchemaObjectSql(row: SqliteSchemaRow): string {
    if (row.type === 'index') {
      return row.sql.replace(
        /^CREATE\s+(UNIQUE\s+)?INDEX\s+(IF\s+NOT\s+EXISTS\s+)?/i,
        (_match, unique: string | undefined, ifNotExists: string | undefined) =>
          `CREATE ${unique ?? ''}INDEX ${ifNotExists ?? ''}${MIGRATION_TARGET_SCHEMA}.`
      )
    }
    if (row.type === 'trigger') {
      return row.sql.replace(
        /^CREATE\s+(TEMP\s+|TEMPORARY\s+)?TRIGGER\s+(IF\s+NOT\s+EXISTS\s+)?/i,
        (_match, temp: string | undefined, ifNotExists: string | undefined) =>
          `CREATE ${temp ?? ''}TRIGGER ${ifNotExists ?? ''}${MIGRATION_TARGET_SCHEMA}.`
      )
    }
    return row.sql.replace(
      /^CREATE\s+(TEMP\s+|TEMPORARY\s+)?VIEW\s+(IF\s+NOT\s+EXISTS\s+)?/i,
      (_match, temp: string | undefined, ifNotExists: string | undefined) =>
        `CREATE ${temp ?? ''}VIEW ${ifNotExists ?? ''}${MIGRATION_TARGET_SCHEMA}.`
    )
  }

  private copySqliteSequence(db: Database.Database): void {
    const sourceSequence = db
      .prepare("SELECT 1 FROM main.sqlite_master WHERE type = 'table' AND name = 'sqlite_sequence'")
      .get()
    const targetSequence = db
      .prepare(
        `SELECT 1 FROM ${MIGRATION_TARGET_SCHEMA}.sqlite_master
         WHERE type = 'table' AND name = 'sqlite_sequence'`
      )
      .get()
    if (!sourceSequence || !targetSequence) {
      return
    }

    const rows = db.prepare('SELECT name, seq FROM main.sqlite_sequence').all() as Array<{
      name: string
      seq: number
    }>
    db.exec(`DELETE FROM ${MIGRATION_TARGET_SCHEMA}.sqlite_sequence`)
    const insert = db.prepare(
      `INSERT INTO ${MIGRATION_TARGET_SCHEMA}.sqlite_sequence (name, seq) VALUES (?, ?)`
    )
    for (const row of rows) {
      insert.run(row.name, row.seq)
    }
  }

  private verifyMigratedDatabase(
    tempPath: string,
    password: string | undefined,
    expectedCounts: Record<string, number>
  ): void {
    const db = openSQLiteDatabase(tempPath, password)
    try {
      const quickCheck = db.pragma('quick_check') as Array<Record<string, string>>
      const firstResult = Object.values(quickCheck[0] ?? {})[0]
      if (firstResult !== 'ok') {
        throw new Error('Migrated database failed PRAGMA quick_check')
      }

      const actualCounts = this.collectValidationCountsFromOpenDb(db)
      for (const [table, expected] of Object.entries(expectedCounts)) {
        if (actualCounts[table] !== expected) {
          throw new Error(`Migrated database row count mismatch for ${table}`)
        }
      }
    } finally {
      db.close()
    }
  }

  private collectValidationCounts(
    dbPath: string,
    password: string | undefined
  ): Record<string, number> {
    const db = openSQLiteDatabase(dbPath, password)
    try {
      return this.collectValidationCountsFromOpenDb(db)
    } finally {
      db.close()
    }
  }

  private collectValidationCountsFromOpenDb(db: Database.Database): Record<string, number> {
    const counts: Record<string, number> = {}
    for (const table of VALIDATION_TABLES) {
      const exists = db
        .prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?")
        .get(table) as { 1: number } | undefined
      if (!exists) {
        continue
      }
      const row = db.prepare(`SELECT COUNT(*) AS count FROM ${table}`).get() as
        | { count: number }
        | undefined
      counts[table] = row?.count ?? 0
    }
    return counts
  }

  private persistUnlockedMetadata(password: string, direction: MigrationDirection): void {
    const safeStorageAvailable = this.isSafeStorageAvailable()
    this.persistMetadata({
      version: 1,
      enabled: true,
      cipher: 'sqlcipher',
      passwordStorage: safeStorageAvailable ? 'safeStorage' : 'manual',
      wrappedPassword: safeStorageAvailable ? this.wrapPassword(password) : undefined,
      safeStorageBackend: this.getSafeStorageBackend(),
      lastMigrationAt: Date.now(),
      lastMigrationDirection: direction
    })
  }

  private getMetadata(): DatabaseSecurityMetadata {
    const raw = this.store.get('metadata')
    return {
      ...DEFAULT_METADATA,
      ...clone(raw ?? DEFAULT_METADATA),
      cipher: 'sqlcipher',
      version: 1
    }
  }

  private persistMetadata(metadata: DatabaseSecurityMetadata): void {
    this.store.set('metadata', metadata)
  }

  private cleanupLegacyProviderJson(configPresenter: IConfigPresenter): void {
    const cleanup = (
      configPresenter as IConfigPresenter & {
        cleanupLegacyProviderJsonForDatabaseEncryption?: () => number
      }
    ).cleanupLegacyProviderJsonForDatabaseEncryption
    cleanup?.call(configPresenter)
  }

  private wrapPassword(password: string): string {
    return Buffer.from(safeStorage.encryptString(password)).toString('base64')
  }

  private unwrapPassword(wrappedPassword: string): string {
    return safeStorage.decryptString(Buffer.from(wrappedPassword, 'base64'))
  }

  private isSafeStorageAvailable(): boolean {
    try {
      return safeStorage.isEncryptionAvailable()
    } catch {
      return false
    }
  }

  private getSafeStorageBackend(): string | undefined {
    try {
      return process.platform === 'linux' ? safeStorage.getSelectedStorageBackend() : undefined
    } catch {
      return undefined
    }
  }

  private assertEnabled(): void {
    if (!this.getMetadata().enabled) {
      throw new Error('Database encryption is not enabled')
    }
  }

  private assertPassword(password: string): void {
    if (!password.trim()) {
      throw new Error('SQLite password is required')
    }
  }

  private getTempPath(dbPath = this.dbPath): string {
    return `${dbPath}.migration-tmp`
  }

  private getRollbackPath(dbPath = this.dbPath): string {
    return `${dbPath}.migration-rollback`
  }

  private isMigrationInProgress(dbPath?: string): boolean {
    if (this.migrationInProgress) {
      return true
    }
    if (!dbPath) {
      return activeMigrationDbPaths.size > 0
    }
    return activeMigrationDbPaths.has(getMigrationLockPath(dbPath))
  }

  private acquireMigrationLock(dbPath: string): void {
    const lockPath = getMigrationLockPath(dbPath)
    if (activeMigrationDbPaths.has(lockPath)) {
      throw new Error('Database migration is already in progress')
    }
    activeMigrationDbPaths.add(lockPath)
  }

  private releaseMigrationLock(dbPath: string): void {
    activeMigrationDbPaths.delete(getMigrationLockPath(dbPath))
  }

  private replaceDatabaseWithRollback(
    dbPath: string,
    tempPath: string,
    rollbackPath: string
  ): void {
    this.removeSidecars(dbPath)
    const hasOriginal = fs.existsSync(dbPath)
    if (hasOriginal) {
      fs.renameSync(dbPath, rollbackPath)
    }
    try {
      fs.renameSync(tempPath, dbPath)
    } catch (error) {
      if (hasOriginal && fs.existsSync(rollbackPath) && !fs.existsSync(dbPath)) {
        fs.renameSync(rollbackPath, dbPath)
      }
      throw error
    }
    this.removeSidecars(dbPath)
  }

  private restoreRollbackDatabase(dbPath: string, rollbackPath: string): void {
    this.removeSidecars(dbPath)
    this.removeIfExists(dbPath)
    if (fs.existsSync(rollbackPath)) {
      fs.renameSync(rollbackPath, dbPath)
    }
    this.removeSidecars(dbPath)
  }

  private removeSidecars(dbPath: string): void {
    for (const filePath of sidecarPaths(dbPath)) {
      this.removeIfExists(filePath)
    }
  }

  private removeIfExists(filePath: string): void {
    if (fs.existsSync(filePath)) {
      fs.rmSync(filePath, { force: true })
    }
  }

  private recoverInterruptedMigrationFiles(): void {
    const tempPath = this.getTempPath()
    const rollbackPath = this.getRollbackPath()
    this.removeIfExists(tempPath)
    if (!fs.existsSync(this.dbPath) && fs.existsSync(rollbackPath)) {
      fs.renameSync(rollbackPath, this.dbPath)
      return
    }
    if (fs.existsSync(this.dbPath) && fs.existsSync(rollbackPath)) {
      this.removeIfExists(rollbackPath)
    }
  }
}
