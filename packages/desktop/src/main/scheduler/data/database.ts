import type { DatabaseConnectionProvider } from '@/data/databaseConnection'
import { CronJobDeliveriesTable } from './tables/cronJobDeliveries'
import { CronJobsTable } from './tables/cronJobs'
import { CronJobRunsTable } from './tables/cronJobRuns'

interface SchedulerDatabaseConnectionProvider extends DatabaseConnectionProvider {
  getDatabasePath(): string
  getDatabasePassword(): string | undefined
}

export class SchedulerDatabase {
  constructor(private readonly connection: SchedulerDatabaseConnectionProvider) {}

  getDatabase() {
    return this.connection.getDatabase()
  }

  getDatabasePath(): string {
    return this.connection.getDatabasePath()
  }

  getDatabasePassword(): string | undefined {
    return this.connection.getDatabasePassword()
  }

  get cronJobsTable(): CronJobsTable {
    return new CronJobsTable(this.getDatabase())
  }

  get cronJobRunsTable(): CronJobRunsTable {
    return new CronJobRunsTable(this.getDatabase())
  }

  get cronJobDeliveriesTable(): CronJobDeliveriesTable {
    return new CronJobDeliveriesTable(this.getDatabase())
  }
}
