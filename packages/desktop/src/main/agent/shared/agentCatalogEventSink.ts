export interface AgentCatalogEventSink {
  publishChanged(agentIds?: string[]): void
}
