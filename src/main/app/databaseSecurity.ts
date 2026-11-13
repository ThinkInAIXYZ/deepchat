import { randomUUID } from 'node:crypto'
import { app, safeStorage } from 'electron'
import ElectronStore from 'electron-store'
import fs from 'fs'
import path from 'path'
import Database from 'better-sqlite3-multiple-ciphers'

import type { DatabaseSecurityStatus } from '@shared/contracts/routes'
import type { DatabaseUnlockReason } from '@shared/contracts/databaseSecurity'
import { openSQLiteDatabase } from '../data/databaseConnection'
import {
  isDecryptedDatabaseCorruptionError,
  OrphanWalDatabaseError
} from '@/data/databaseStartupRecovery'
import { shouldExcludeFromSqliteCopy } from '@/data/sqliteCopyExclusions'
import { orderSqliteTablesForCopy } from '@/data/sqliteCopyOrder'

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

type MigrationDirection = 'disable'
export interface DatabaseSecurityMigrationDatabasePort {
  getDatabasePath(): string
  checkpointAndClose(): void
  close(): void
  reopenWithPassword(password?: string): void
  isOpen(): boolean
}

const DEFAULT_METADATA: DatabaseSecurityMetadata = {
  version: 1,
  enabled: false,
  cipher: 'sqlcipher',
  passwordStorage: 'none'
}

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

export class DatabaseSecurityService {
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

  getDatabasePath(): string {
    return this.dbPath
  }

  private rememberPasswordAfterUnlock(
    password: string,
    metadata: DatabaseSecurityMetadata,
    safeStorageAvailable: boolean
  ): void {
    if (!safeStorageAvailable) {
      return
    }
    this.persistMetadata({
      ...metadata,
      passwordStorage: 'safeStorage',
      wrappedPassword: this.wrapPassword(password),
      safeStorageBackend: this.getSafeStorageBackend()
    })
  }

  persistRecoveredEncryptionMetadata(password: string): void {
    this.assertPassword(password)
    const safeStorageAvailable = this.isSafeStorageAvailable()
    const metadata = this.getMetadata()
    this.persistMetadata({
      version: 1,
      enabled: true,
      cipher: 'sqlcipher',
      passwordStorage: safeStorageAvailable ? 'safeStorage' : 'manual',
      wrappedPassword: safeStorageAvailable ? this.wrapPassword(password) : undefined,
      safeStorageBackend: this.getSafeStorageBackend(),
      lastMigrationAt: metadata.lastMigrationAt,
      lastMigrationDirection: metadata.lastMigrationDirection
    })
  }

  clearEncryptionMetadata(): void {
    this.persistMetadata({ ...DEFAULT_METADATA })
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
    if (metadata.enabled && this.isPlaintextDatabase()) {
      this.clearEncryptionMetadata()
      return undefined
    }
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
      let password: string | undefined
      try {
        password = this.unwrapPassword(metadata.wrappedPassword)
        this.validatePassword(password)
        return password
      } catch (error) {
        if (password !== undefined && isDecryptedDatabaseCorruptionError(error)) {
          return password
        }
        if (error instanceof OrphanWalDatabaseError) {
          throw error
        }
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
        this.rememberPasswordAfterUnlock(password, metadata, safeStorageAvailable)
        return password
      } catch (error) {
        if (isDecryptedDatabaseCorruptionError(error)) {
          this.rememberPasswordAfterUnlock(password, metadata, safeStorageAvailable)
          return password
        }
        if (error instanceof OrphanWalDatabaseError) {
          throw error
        }
        reason = 'invalid'
      }
    }
  }

  async enableEncryption(_input: unknown): Promise<DatabaseSecurityStatus> {
    throw new Error('Database encryption has been retired; only legacy decryption is supported.')
  }

  async changePassword(_input: unknown): Promise<DatabaseSecurityStatus> {
    throw new Error('Database encryption has been retired; only legacy decryption is supported.')
  }

  /** Called before desktop services are constructed. No new session uses an encrypted database. */
  async migrateLegacyEncryption(
    database: DatabaseSecurityMigrationDatabasePort & { getDatabasePassword(): string | undefined }
  ): Promise<void> {
    const password = database.getDatabasePassword()
    if (!password) return
    await this.disableEncryption({ currentPassword: password, database })
  }

  async disableEncryption(input: {
    currentPassword: string
    database: DatabaseSecurityMigrationDatabasePort
    providerSettings?: unknown
  }): Promise<DatabaseSecurityStatus> {
    this.assertEnabled()
    this.assertPassword(input.currentPassword)
    this.validatePassword(input.currentPassword)

    await this.migrateDatabase({
      database: input.database,
      sourcePassword: input.currentPassword,
      direction: 'disable'
    })
    this.persistMetadata({
      ...DEFAULT_METADATA,
      lastMigrationAt: Date.now(),
      lastMigrationDirection: 'disable'
    })
    return this.getStatus()
  }

  /** Decrypt an extracted legacy backup before it can replace the active plaintext database. */
  decryptLegacyBackup(sourcePath: string, targetPath: string, password: string): void {
    this.assertPassword(password)
    const counts = this.collectValidationCounts(sourcePath, password)
    try {
      this.exportDatabaseToTemp(sourcePath, targetPath, password)
      fs.chmodSync(targetPath, 0o600)
      this.verifyMigratedDatabase(targetPath, undefined, counts)
    } catch (error) {
      this.removeIfExists(targetPath)
      this.removeSidecars(targetPath)
      throw error
    }
  }

  validatePassword(password: string): void {
    const db = openSQLiteDatabase(this.dbPath, password)
    try {
      db.prepare('SELECT name FROM sqlite_master LIMIT 1').get()
    } finally {
      db.close()
    }
  }

  private isPlaintextDatabase(): boolean {
    if (!fs.existsSync(this.dbPath)) return false
    const fd = fs.openSync(this.dbPath, 'r')
    const header = Buffer.alloc(16)
    try {
      if (fs.readSync(fd, header, 0, 16, 0) !== 16 || header.toString() !== 'SQLite format 3\0')
        return false
    } finally {
      fs.closeSync(fd)
    }
    const db = openSQLiteDatabase(this.dbPath)
    try {
      db.prepare('SELECT name FROM sqlite_master LIMIT 1').get()
      return true
    } finally {
      db.close()
    }
  }

  private async migrateDatabase(input: {
    database: DatabaseSecurityMigrationDatabasePort
    sourcePassword: string | undefined
    direction: MigrationDirection
  }): Promise<void> {
    const dbPath = input.database.getDatabasePath()
    this.acquireMigrationLock(dbPath)
    this.migrationInProgress = true
    const tempPath = this.getTempPath(dbPath)
    const rollbackPath = this.getRollbackPath(dbPath)

    try {
      this.removeIfExists(tempPath)
      this.removeSidecars(tempPath)
      this.removeIfExists(rollbackPath)
      this.removeSidecars(rollbackPath)
      input.database.checkpointAndClose()

      if (input.sourcePassword && input.direction === 'disable') {
        const size = fs.statSync(dbPath).size
        const disk = fs.statfsSync(path.dirname(dbPath))
        if (disk.bavail * disk.bsize < size * 2 + 32 * 1024 * 1024)
          throw new Error('Not enough disk space for legacy database decryption and recovery copy')
        // Keep the checkpointed encrypted input even after the normal rollback is retired.
        const backup = `${dbPath}.legacy-encrypted.${Date.now()}.${randomUUID()}.bak`
        const partial = `${backup}.partial`
        try {
          fs.copyFileSync(dbPath, partial, fs.constants.COPYFILE_EXCL)
          fs.chmodSync(partial, 0o600)
          const backupFd = fs.openSync(partial, 'r')
          try {
            fs.fsyncSync(backupFd)
          } finally {
            fs.closeSync(backupFd)
          }
          fs.renameSync(partial, backup)
        } finally {
          this.removeIfExists(partial)
        }
      }
      const expectedCounts = this.collectValidationCounts(dbPath, input.sourcePassword)
      this.exportDatabaseToTemp(dbPath, tempPath, input.sourcePassword)
      this.verifyMigratedDatabase(tempPath, undefined, expectedCounts)

      this.replaceDatabaseWithRollback(dbPath, tempPath, rollbackPath)

      try {
        input.database.reopenWithPassword(undefined)
      } catch (error) {
        input.database.close()
        this.restoreRollbackDatabase(dbPath, rollbackPath)
        input.database.reopenWithPassword(input.sourcePassword)
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
      if (!input.database.isOpen()) {
        try {
          input.database.reopenWithPassword(input.sourcePassword)
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

  private exportDatabaseToTemp(
    sourcePath: string,
    tempPath: string,
    sourcePassword: string | undefined
  ): void {
    const sourceDb = openSQLiteDatabase(sourcePath, sourcePassword)
    try {
      sourceDb.pragma('wal_checkpoint(TRUNCATE)')
      sourceDb.pragma('journal_mode = DELETE')
      this.attachMigrationTarget(sourceDb, tempPath, sourcePassword)
      this.copySchemaAndData(sourceDb)
      sourceDb.prepare(`DETACH DATABASE ${MIGRATION_TARGET_SCHEMA}`).run()
    } finally {
      sourceDb.close()
    }
  }

  private attachMigrationTarget(
    db: Database.Database,
    tempPath: string,
    sourcePassword: string | undefined
  ): void {
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

    const tables = rows.filter((row) => {
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
    return orderSqliteTablesForCopy(db, tables)
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
    for (const { name: table } of this.listMigratableTables(db)) {
      const row = db.prepare(`SELECT COUNT(*) AS count FROM ${quoteIdentifier(table)}`).get() as
        | { count: number }
        | undefined
      counts[table] = row?.count ?? 0
    }
    return counts
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
