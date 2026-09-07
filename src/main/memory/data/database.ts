import type { DatabaseConnectionProvider } from '@/data/databaseConnection'
import { AgentMemoryTable } from './tables/agentMemory'
import { AgentMemoryAuditTable } from './tables/agentMemoryAudit'
import { AgentMemoryDirectiveTable } from './tables/agentMemoryDirective'
import { DeepChatMemoryIngestionProjectionTable } from './tables/deepchatMemoryIngestionProjection'

export class MemoryDatabase {
  private agentMemory:
    | {
        database: ReturnType<DatabaseConnectionProvider['getDatabase']>
        table: AgentMemoryTable
      }
    | undefined

  constructor(private readonly connection: DatabaseConnectionProvider) {}

  getDatabase() {
    return this.connection.getDatabase()
  }

  get agentMemoryTable() {
    const database = this.getDatabase()
    if (this.agentMemory?.database !== database) {
      const table = new AgentMemoryTable(database)
      table.createTable()
      this.agentMemory = { database, table }
    }
    return this.agentMemory.table
  }

  get agentMemoryAuditTable() {
    return new AgentMemoryAuditTable(this.getDatabase())
  }

  get agentMemoryDirectiveTable() {
    return new AgentMemoryDirectiveTable(this.getDatabase())
  }

  get ingestionProjectionTable() {
    return new DeepChatMemoryIngestionProjectionTable(this.getDatabase())
  }
}
