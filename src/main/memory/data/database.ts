import type { DatabaseConnectionProvider } from '@/data/databaseConnection'
import { AgentMemoryTable } from './tables/agentMemory'
import { AgentMemoryAuditTable } from './tables/agentMemoryAudit'
import { DeepChatMemoryIngestionProjectionTable } from './tables/deepchatMemoryIngestionProjection'

export class MemoryDatabase {
  constructor(private readonly connection: DatabaseConnectionProvider) {}

  getDatabase() {
    return this.connection.getDatabase()
  }

  get agentMemoryTable() {
    return new AgentMemoryTable(this.getDatabase())
  }

  get agentMemoryAuditTable() {
    return new AgentMemoryAuditTable(this.getDatabase())
  }

  get ingestionProjectionTable() {
    return new DeepChatMemoryIngestionProjectionTable(this.getDatabase())
  }
}
