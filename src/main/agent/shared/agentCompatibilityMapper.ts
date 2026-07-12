import type { Agent } from '@shared/types/agent-interface'
import type { AgentCatalogRecord } from './agentDescriptors'

export function mapCatalogRecordToLegacyAgent(record: AgentCatalogRecord): Agent {
  return {
    id: record.id,
    name: record.name,
    type: record.kind,
    agentType: record.kind,
    enabled: record.enabled,
    protected: record.protected,
    icon: record.icon ?? undefined,
    description: record.description ?? undefined,
    source: record.source,
    avatar: record.avatar,
    config: record.kind === 'deepchat' ? record.config : null,
    installState: record.kind === 'acp' ? record.installState : null
  }
}
