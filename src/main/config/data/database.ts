import type { DatabaseConnectionProvider } from '@/data/databaseConnection'
import type { SettingsActivityInput, SettingsActivityRecord } from '@shared/contracts/routes'
import { ConfigTables } from './tables/configTables'
import { SettingsActivityTable } from './tables/settingsActivity'

export class ConfigDatabase {
  constructor(private readonly connection: DatabaseConnectionProvider) {}

  getDatabase() {
    return this.connection.getDatabase()
  }

  get configTables(): ConfigTables {
    return new ConfigTables(this.getDatabase())
  }

  get settingsActivityTable(): SettingsActivityTable {
    return new SettingsActivityTable(this.getDatabase())
  }

  async recordSettingsActivity(input: SettingsActivityInput): Promise<SettingsActivityRecord> {
    return this.settingsActivityTable.record(input)
  }

  async listSettingsActivity(limit?: number): Promise<SettingsActivityRecord[]> {
    return this.settingsActivityTable.list(limit)
  }
}
