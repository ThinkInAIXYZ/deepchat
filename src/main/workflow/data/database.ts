import type { DatabaseConnectionProvider } from '@/data/databaseConnection'
import { WorkflowInvocationsTable } from './tables/workflowInvocations'
import { WorkflowRunsTable } from './tables/workflowRuns'

export class WorkflowDatabase {
  constructor(private readonly connection: DatabaseConnectionProvider) {}

  getDatabase() {
    return this.connection.getDatabase()
  }

  get workflowRunsTable(): WorkflowRunsTable {
    return new WorkflowRunsTable(this.getDatabase())
  }

  get workflowInvocationsTable(): WorkflowInvocationsTable {
    return new WorkflowInvocationsTable(this.getDatabase())
  }
}
