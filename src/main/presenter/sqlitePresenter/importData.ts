import Database from 'better-sqlite3-multiple-ciphers'

export interface ImportSummary {
  tableCounts: Record<string, number>
}

type ColumnInfo = {
  name: string
  pk: number
}

/**
 * 数据导入类
 * 用于从外部SQLite数据库导入数据到当前数据库
 */
export class DataImporter {
  private sourceDb: Database.Database
  private targetDb: Database.Database

  constructor(
    sourcePath: string,
    targetDbOrPath: Database.Database | string,
    sourcePassword?: string,
    targetPassword?: string
  ) {
    this.sourceDb = new Database(sourcePath)
    this.sourceDb.pragma('journal_mode = WAL')

    if (sourcePassword) {
      this.sourceDb.pragma("cipher='sqlcipher'")
      this.sourceDb.pragma(`key='${sourcePassword}'`)
    }

    if (typeof targetDbOrPath === 'string') {
      this.targetDb = new Database(targetDbOrPath)
      this.targetDb.pragma('journal_mode = WAL')

      if (targetPassword) {
        this.targetDb.pragma("cipher='sqlcipher'")
        this.targetDb.pragma(`key='${targetPassword}'`)
      }
    } else {
      this.targetDb = targetDbOrPath
    }
  }

  /**
   * 开始导入数据
   */
  public async importData(): Promise<ImportSummary> {
    const tableCounts: Record<string, number> = {}
    const tables = this.getTablesInOrder()

    const importTransaction = this.targetDb.transaction(() => {
      for (const table of tables) {
        try {
          const inserted = this.importTable(table)
          if (inserted > 0) {
            tableCounts[table] = inserted
          }
        } catch (error) {
          throw new Error(
            `Failed to import table ${table}: ${error instanceof Error ? error.message : String(error)}`
          )
        }
      }
    })

    try {
      importTransaction()
      return { tableCounts }
    } catch (transactionError) {
      throw new Error(
        `Failed to import database: ${
          transactionError instanceof Error ? transactionError.message : String(transactionError)
        }`
      )
    }
  }

  private getTablesInOrder(): string[] {
    const tables = this.sourceDb
      .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'")
      .all() as { name: string }[]

    const preferredOrder = ['conversations', 'messages', 'attachments', 'message_attachments']
    const preferredSet = new Set(preferredOrder)

    const preferredTables: string[] = []
    const remainingTables: string[] = []

    for (const { name } of tables) {
      if (preferredSet.has(name)) {
        preferredTables.push(name)
      } else {
        remainingTables.push(name)
      }
    }

    preferredTables.sort((a, b) => preferredOrder.indexOf(a) - preferredOrder.indexOf(b))
    remainingTables.sort()

    return [...preferredTables, ...remainingTables]
  }

  private importTable(tableName: string): number {
    const sourceColumns = this.getTableColumns(this.sourceDb, tableName)
    const targetColumns = this.getTableColumns(this.targetDb, tableName)

    if (targetColumns.length === 0) {
      return 0
    }

    const targetColumnNames = new Set(targetColumns.map((column) => column.name))
    const commonColumns = sourceColumns.filter((column) => targetColumnNames.has(column.name))

    if (commonColumns.length === 0) {
      return 0
    }

    const pkColumns = targetColumns
      .filter((column) => column.pk > 0 && commonColumns.some((col) => col.name === column.name))
      .sort((a, b) => a.pk - b.pk)

    const wrappedTableName = this.wrapIdentifier(tableName)
    const selectColumnsSql = commonColumns
      .map((column) => this.wrapIdentifier(column.name))
      .join(', ')
    const rows = this.sourceDb
      .prepare(`SELECT ${selectColumnsSql} FROM ${wrappedTableName}`)
      .all() as Record<string, unknown>[]

    if (rows.length === 0) {
      return 0
    }

    const insertPlaceholders = Array.from({ length: commonColumns.length }, () => '?').join(', ')
    const insertSql = `INSERT INTO ${wrappedTableName} (${selectColumnsSql}) VALUES (${insertPlaceholders})`
    const insertStmt = this.targetDb.prepare(insertSql)

    let existsStmt: Database.Statement | null = null
    if (pkColumns.length > 0) {
      const whereClause = pkColumns
        .map((column) => `${this.wrapIdentifier(column.name)} = ?`)
        .join(' AND ')
      existsStmt = this.targetDb.prepare(
        `SELECT 1 FROM ${wrappedTableName} WHERE ${whereClause} LIMIT 1`
      )
    }

    let inserted = 0
    for (const row of rows) {
      if (existsStmt) {
        const pkValues = pkColumns.map((column) => row[column.name])
        if (existsStmt.get(...pkValues)) {
          continue
        }
      }

      const values = commonColumns.map((column) => row[column.name])
      insertStmt.run(...values)
      inserted++
    }

    return inserted
  }

  private getTableColumns(db: Database.Database, tableName: string): ColumnInfo[] {
    const wrappedTableName = this.wrapIdentifier(tableName)
    try {
      const columns = db.prepare(`PRAGMA table_info(${wrappedTableName})`).all() as ColumnInfo[]
      return columns
    } catch (error) {
      console.warn(`Failed to read table info for ${tableName}:`, error)
      return []
    }
  }

  private wrapIdentifier(identifier: string): string {
    return `"${identifier.replace(/"/g, '""')}"`
  }

  public close(): void {
    if (this.sourceDb) {
      this.sourceDb.close()
    }
    if (this.targetDb) {
      this.targetDb.close()
    }
  }
}
