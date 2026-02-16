import Database from 'better-sqlite3-multiple-ciphers'

export abstract class BaseTable {
  protected db: Database.Database
  protected tableName: string

  constructor(db: Database.Database, tableName: string) {
    this.db = db
    this.tableName = tableName
  }

  abstract getCreateTableSQL(): string

  abstract getMigrationSQL?(version: number): string | null

  abstract getLatestVersion(): number

  runMigration?(version: number): void

  protected tableExists(): boolean {
    const result = this.db
      .prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name=?`)
      .get(this.tableName) as { name: string } | undefined

    return !!result
  }

  public createTable(): void {
    if (!this.tableExists()) {
      this.db.exec(this.getCreateTableSQL())
    }
  }
}
