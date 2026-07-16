import type { DatabaseConnectionProvider } from '@/data/databaseConnection'
import { McpSettingsTable } from './settingsTable'

export class McpDatabase {
  constructor(private readonly connection: DatabaseConnectionProvider) {}

  get settingsTable(): McpSettingsTable {
    return new McpSettingsTable(this.connection.getDatabase())
  }
}
