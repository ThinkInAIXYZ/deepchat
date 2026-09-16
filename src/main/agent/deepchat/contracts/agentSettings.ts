import type {
  AcpAgentConfig,
  AcpAgentInstallState,
  AcpAgentState,
  AcpManualAgent,
  AcpRegistryAgent,
  AcpResolvedLaunchSpec
} from '@shared/types/acp'
import type {
  Agent,
  AgentType,
  CreateDeepChatAgentInput,
  DeepChatAgentConfig,
  UpdateDeepChatAgentInput
} from '@shared/types/agent-interface'

/**
 * Agent configuration surface the built-in kernel needs. Declared here so kernel modules depend on
 * this structural port instead of the Desktop settings service; the host class implements it.
 */
export interface AgentSettingsPort {
  getAcpEnabled(): Promise<boolean>
  setAcpEnabled(enabled: boolean): Promise<void>
  listAcpRegistryAgents(): Promise<AcpRegistryAgent[]>
  refreshAcpRegistry(force?: boolean): Promise<AcpRegistryAgent[]>
  getAcpRegistryIconMarkup(agentId: string, iconUrl?: string): Promise<string | null>
  getAcpAgentState(agentId: string): Promise<AcpAgentState | null>
  setAcpAgentEnabled(agentId: string, enabled: boolean): Promise<void>
  setAcpAgentEnvOverride(agentId: string, env: Record<string, string>): Promise<void>
  ensureAcpAgentInstalled(agentId: string): Promise<AcpAgentInstallState>
  repairAcpAgent(agentId: string): Promise<AcpAgentInstallState>
  uninstallAcpRegistryAgent(agentId: string): Promise<void>
  listManualAcpAgents(): Promise<AcpManualAgent[]>
  addManualAcpAgent(
    agent: Omit<AcpManualAgent, 'id' | 'source'> & { id?: string }
  ): Promise<AcpManualAgent>
  updateManualAcpAgent(
    agentId: string,
    updates: Partial<Omit<AcpManualAgent, 'id' | 'source'>>
  ): Promise<AcpManualAgent | null>
  removeManualAcpAgent(agentId: string): Promise<boolean>
  getAcpAgents(): Promise<AcpAgentConfig[]>
  resolveAcpLaunchSpec(agentId: string, workdir?: string): Promise<AcpResolvedLaunchSpec>
  getAcpSharedMcpSelections(): Promise<string[]>
  setAcpSharedMcpSelections(mcpIds: string[]): Promise<void>
  listAgents(): Promise<Agent[]>
  getAgent(agentId: string): Promise<Agent | null>
  getAgentType(agentId: string): Promise<AgentType | null>
  getDeepChatAgentConfig(agentId: string): Promise<DeepChatAgentConfig | null>
  resolveDeepChatAgentConfig(agentId: string): Promise<DeepChatAgentConfig>
  agentSupportsCapability(agentId: string, capability: 'vision'): Promise<boolean>
  createDeepChatAgent(input: CreateDeepChatAgentInput): Promise<Agent>
  updateDeepChatAgent(agentId: string, updates: UpdateDeepChatAgentInput): Promise<Agent | null>
  deleteDeepChatAgent(agentId: string): Promise<boolean>
  deleteDeepChatAgentWithCleanup(
    agentId: string
  ): Promise<{ removed: boolean; cleanupPendingRestart: boolean }>
  getAgentMcpSelections(agentId: string, isBuiltin?: boolean): Promise<string[]>
  setAgentMcpSelections(agentId: string, isBuiltin: boolean, mcpIds: string[]): Promise<void>
  addMcpToAgent(agentId: string, isBuiltin: boolean, mcpId: string): Promise<void>
  removeMcpFromAgent(agentId: string, isBuiltin: boolean, mcpId: string): Promise<void>
  getDefaultModel(): { providerId: string; modelId: string } | undefined
  setDefaultModel(model: { providerId: string; modelId: string } | undefined): void
}
