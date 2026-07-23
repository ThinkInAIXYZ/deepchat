import { AcpAgentRepository } from '@/agent/acp/acpAgentRepository'
import {
  BUILTIN_DEEPCHAT_AGENT_ID,
  DeepChatAgentRepository
} from '@/agent/deepchat/deepChatAgentRepository'
import {
  AgentNotFoundError,
  decodeAgentCatalogRow,
  decodeExecutableAgentDescriptor
} from '@/agent/shared/agentCatalogCodec'
import type { AgentDescriptor } from '@/agent/shared/agentDescriptors'
import { mapCatalogRecordToLegacyAgent } from '@/agent/shared/agentCompatibilityMapper'
import { toAppSessionId } from '@/agent/shared/agentSessionIds'
import type { AcpAgentConfig } from '@shared/types/acp'
import type {
  AcpAgentInstallState,
  AcpAgentState,
  AcpManualAgent,
  AcpRegistryAgent
} from '@shared/types/acp'
import type {
  Agent,
  AgentAvatar,
  CreateDeepChatAgentInput,
  DeepChatAgentConfig,
  UpdateDeepChatAgentInput
} from '@shared/types/agent-interface'
import type { SessionDatabase } from '@/session/data/database'
import type { AgentDatabase } from '@/agent/data/database'
import type { MemoryDatabase } from '@/memory/data/database'

export class AgentRepository {
  private readonly deepchat: DeepChatAgentRepository
  private readonly acp: AcpAgentRepository

  constructor(
    private readonly sqlitePresenter: AgentDatabase,
    sessionDatabase: SessionDatabase,
    memoryDatabase: MemoryDatabase
  ) {
    const listSessionIdsByAgent = (agentId: string) =>
      sessionDatabase.newSessionsTable
        .list({ agentId, includeSubagents: true })
        .map((session) => toAppSessionId(session.id))

    this.deepchat = new DeepChatAgentRepository({
      rows: sqlitePresenter.agentsTable,
      listSessionIdsByAgent,
      clearMemoryByAgent: (agentId) => memoryDatabase.agentMemoryTable.clearByAgent(agentId),
      clearMemoryAuditByAgent: (agentId) =>
        memoryDatabase.agentMemoryAuditTable.clearByAgent(agentId),
      transaction: (operation) => sqlitePresenter.getDatabase().transaction(operation)()
    })
    this.acp = new AcpAgentRepository({
      rows: sqlitePresenter.agentsTable,
      listSessionIdsByAgent
    })
  }

  listAgents(filters?: { agentType?: 'deepchat' | 'acp'; enabled?: boolean }): Agent[] {
    return this.sqlitePresenter.agentsTable
      .list({ agentType: filters?.agentType, enabled: filters?.enabled })
      .map((row) => mapCatalogRecordToLegacyAgent(decodeAgentCatalogRow(row)))
  }

  getAgent(agentId: string): Agent | null {
    const row = this.sqlitePresenter.agentsTable.get(agentId)
    return row ? mapCatalogRecordToLegacyAgent(decodeAgentCatalogRow(row)) : null
  }

  getAgentType(agentId: string): 'deepchat' | 'acp' | null {
    return this.sqlitePresenter.agentsTable.get(agentId)?.agent_type ?? null
  }

  resolveExecutableDescriptor(agentId: string): AgentDescriptor {
    const row = this.sqlitePresenter.agentsTable.get(agentId)
    if (!row) throw new AgentNotFoundError(agentId)
    return decodeExecutableAgentDescriptor(row, {
      resolveDeepChatConfig: (id) => this.deepchat.resolveConfig(id),
      resolveRegistryReference: (id) => this.acp.getRegistryReference(id)
    })
  }

  ensureBuiltinDeepChatAgent(defaults?: {
    name?: string
    icon?: string | null
    avatar?: AgentAvatar | null
    config?: DeepChatAgentConfig | null
  }): Agent {
    return mapCatalogRecordToLegacyAgent(
      decodeAgentCatalogRow(this.deepchat.ensureBuiltin(defaults))
    )
  }

  createDeepChatAgent(input: CreateDeepChatAgentInput): Agent {
    return mapCatalogRecordToLegacyAgent(decodeAgentCatalogRow(this.deepchat.create(input)))
  }

  updateDeepChatAgent(agentId: string, updates: UpdateDeepChatAgentInput): Agent | null {
    const row = this.deepchat.update(agentId, updates)
    return row ? mapCatalogRecordToLegacyAgent(decodeAgentCatalogRow(row)) : null
  }

  canDeleteDeepChatAgent(agentId: string): boolean {
    return this.deepchat.canDelete(agentId)
  }

  deleteDeepChatAgent(agentId: string): boolean {
    return this.deepchat.delete(agentId)
  }

  getDeepChatAgentConfig(agentId: string): DeepChatAgentConfig | null {
    return this.deepchat.getConfig(agentId)
  }

  resolveDeepChatAgentConfig(agentId: string): DeepChatAgentConfig {
    return this.deepchat.resolveConfig(agentId)
  }

  listResolvedDeepChatAgentConfigs(): Array<{
    agentId: string
    config: DeepChatAgentConfig
  }> {
    return this.deepchat.listResolvedConfigs()
  }

  materializeLegacyInheritedDeepChatConfigs(): {
    materializedAgentIds: string[]
    recoveredAgentIds: string[]
    legacySkillAllowLists: Record<string, string[]>
  } {
    return this.deepchat.materializeLegacyInheritedConfigs()
  }

  listManualAcpAgents(): AcpManualAgent[] {
    return this.acp.listManual()
  }

  getManualAcpAgent(agentId: string): AcpManualAgent | null {
    return this.acp.getManual(agentId)
  }

  createManualAcpAgent(
    agent: Omit<AcpManualAgent, 'id' | 'source'> & { id?: string }
  ): AcpManualAgent {
    return this.acp.createManual(agent)
  }

  updateManualAcpAgent(
    agentId: string,
    updates: Partial<Omit<AcpManualAgent, 'id' | 'source'>>
  ): AcpManualAgent | null {
    return this.acp.updateManual(agentId, updates)
  }

  removeManualAcpAgent(agentId: string): boolean {
    return this.acp.removeManual(agentId)
  }

  hasAgentSessions(agentId: string): boolean {
    return this.acp.hasSessions(agentId)
  }

  syncRegistryAgents(
    agents: AcpRegistryAgent[],
    legacyStateById?: Record<string, AcpAgentState>,
    legacyInstallStateById?: Record<string, AcpAgentInstallState>
  ): void {
    this.acp.syncRegistry(agents, legacyStateById, legacyInstallStateById)
  }

  getAcpAgentState(agentId: string): AcpAgentState | null {
    return this.acp.getState(agentId)
  }

  setAgentEnabled(agentId: string, enabled: boolean): boolean {
    if (!this.sqlitePresenter.agentsTable.get(agentId)) return false
    this.sqlitePresenter.agentsTable.update(agentId, { enabled })
    return true
  }

  setAgentEnvOverride(agentId: string, env: Record<string, string>): boolean {
    return this.acp.setEnvOverride(agentId, env)
  }

  getAgentInstallState(agentId: string): AcpAgentInstallState | null {
    return this.acp.getInstallState(agentId)
  }

  setAgentInstallState(agentId: string, installState: AcpAgentInstallState | null): boolean {
    return this.acp.setInstallState(agentId, installState)
  }

  clearRegistryAcpAgentInstallation(agentId: string, installState: AcpAgentInstallState): boolean {
    return this.acp.clearRegistryInstallation(agentId, installState)
  }

  toAcpAgentConfig(
    agentId: string,
    preview?: Pick<AcpAgentConfig, 'command' | 'args'>
  ): AcpAgentConfig | null {
    return this.acp.toConfig(agentId, preview)
  }

  getAcpRegistryOverlay(agentId: string): {
    enabled: boolean
    envOverride?: Record<string, string>
    installState?: AcpAgentInstallState | null
  } | null {
    return this.acp.getRegistryOverlay(agentId)
  }
}

export { BUILTIN_DEEPCHAT_AGENT_ID }
