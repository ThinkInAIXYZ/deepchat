import type { DatabaseConnectionProvider } from '@/data/databaseConnection'
import { CronJobDeliveriesTable } from './tables/cronJobDeliveries'
import { CronJobsTable } from './tables/cronJobs'
import { CronJobRunsTable } from './tables/cronJobRuns'

export class SchedulerDatabase {
  constructor(private readonly connection: DatabaseConnectionProvider) {}

  getDatabase() {
    return this.connection.getDatabase()
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
