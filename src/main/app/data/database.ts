import type { DatabaseConnectionProvider } from '@/data/databaseConnection'
import { LegacyImportStatusTable } from './tables/legacyImportStatus'

export class AppDatabase {
  constructor(private readonly connection: DatabaseConnectionProvider) {}

  getDatabase() {
    return this.connection.getDatabase()
  }

  get legacyImportStatusTable(): LegacyImportStatusTable {
    return new LegacyImportStatusTable(this.getDatabase())
  }
}
