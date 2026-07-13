import type {
  AgentCreateInput,
  AgentRow,
  AgentUpdateInput
} from '@/presenter/sqlitePresenter/tables/agents'

export interface AgentRowFilters {
  agentType?: AgentRow['agent_type']
  source?: AgentRow['source']
  enabled?: boolean
}

export interface AgentRowStore {
  get(id: string): AgentRow | undefined
  list(filters?: AgentRowFilters): AgentRow[]
  create(input: AgentCreateInput): void
  upsert(input: AgentCreateInput): void
  update(id: string, input: AgentUpdateInput): void
  delete(id: string): void
}
