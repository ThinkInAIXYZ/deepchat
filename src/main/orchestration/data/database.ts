import type { DatabaseConnectionProvider } from '@/data/databaseConnection'
import { LiveDelegationEventsTable } from './tables/liveDelegationEvents'
import { LiveDelegationsTable } from './tables/liveDelegations'
import { LiveDelegationTurnsTable } from './tables/liveDelegationTurns'

export class LiveDelegationDatabase {
  constructor(private readonly connection: DatabaseConnectionProvider) {}

  getDatabase() {
    return this.connection.getDatabase()
  }

  get delegations(): LiveDelegationsTable {
    return new LiveDelegationsTable(this.getDatabase())
  }

  get turns(): LiveDelegationTurnsTable {
    return new LiveDelegationTurnsTable(this.getDatabase())
  }

  get events(): LiveDelegationEventsTable {
    return new LiveDelegationEventsTable(this.getDatabase())
  }
}
