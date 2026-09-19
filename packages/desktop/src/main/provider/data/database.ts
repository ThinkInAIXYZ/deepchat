import type { DatabaseConnectionProvider } from '@/data/databaseConnection'
import { ProviderSettingsTable } from './settingsTable'

export class ProviderDatabase {
  constructor(private readonly connection: DatabaseConnectionProvider) {}

  get settingsTable(): ProviderSettingsTable {
    return new ProviderSettingsTable(this.connection.getDatabase())
  }
}
