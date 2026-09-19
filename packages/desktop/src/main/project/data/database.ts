import type { DatabaseConnectionProvider } from '@/data/databaseConnection'
import { NewProjectsTable } from './tables/newProjects'
import { NewEnvironmentsTable } from './tables/newEnvironments'
import { NewEnvironmentPreferencesTable } from './tables/newEnvironmentPreferences'

export class ProjectDatabase {
  constructor(private readonly connection: DatabaseConnectionProvider) {}

  getDatabase() {
    return this.connection.getDatabase()
  }

  get newProjectsTable() {
    return new NewProjectsTable(this.getDatabase())
  }

  get newEnvironmentsTable() {
    return new NewEnvironmentsTable(this.getDatabase())
  }

  get newEnvironmentPreferencesTable() {
    return new NewEnvironmentPreferencesTable(this.getDatabase())
  }
}
