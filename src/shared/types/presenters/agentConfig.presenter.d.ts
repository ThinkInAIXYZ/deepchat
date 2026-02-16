import type {
  AcpBuiltinAgentId,
  AcpCustomAgent,
  AcpAgentProfile,
  IConfigPresenter
} from './legacy.presenters'

export type AgentType = 'template' | 'acp'

export interface AgentBase {
  id: string
  name: string
  type: AgentType
  icon?: string
  createdAt: number
  updatedAt: number
}

export interface TemplateAgent extends AgentBase {
  type: 'template'
  providerId: string
  modelId: string
  systemPrompt?: string
  temperature?: number
  contextLength?: number
  maxTokens?: number
  thinkingBudget?: number
  reasoningEffort?: 'minimal' | 'low' | 'medium' | 'high'
}

export interface AcpAgentProfile {
  id: string
  name: string
  command: string
  args?: string[]
  env?: Record<string, string>
}

export interface AcpAgent extends AgentBase {
  type: 'acp'
  command: string
  args?: string[]
  env?: Record<string, string>
  cwd?: string
  enabled: boolean
  isBuiltin?: boolean
  builtinId?: AcpBuiltinAgentId
  profiles?: AcpAgentProfile[]
  activeProfileId?: string
  mcpSelections?: string[]
}

export type Agent = TemplateAgent | AcpAgent

export interface CreateTemplateAgentParams {
  id?: string
  name: string
  icon?: string
  providerId: string
  modelId: string
  systemPrompt?: string
  temperature?: number
  contextLength?: number
  maxTokens?: number
  thinkingBudget?: number
  reasoningEffort?: 'minimal' | 'low' | 'medium' | 'high'
}

export interface CreateAcpAgentParams {
  id?: string
  name: string
  icon?: string
  command: string
  args?: string[]
  env?: Record<string, string>
  cwd?: string
  enabled?: boolean
  isBuiltin?: boolean
  builtinId?: AcpBuiltinAgentId
  profiles?: AcpAgentProfile[]
  activeProfileId?: string
  mcpSelections?: string[]
}

export type CreateAgentParams =
  | ({ type: 'template' } & CreateTemplateAgentParams)
  | ({ type: 'acp' } & CreateAcpAgentParams)

export type UpdateTemplateAgentParams = Partial<
  Omit<TemplateAgent, 'id' | 'type' | 'createdAt' | 'updatedAt'>
>
export type UpdateAcpAgentParams = Partial<
  Omit<AcpAgent, 'id' | 'type' | 'createdAt' | 'updatedAt'>
>
export type UpdateAgentParams = UpdateTemplateAgentParams | UpdateAcpAgentParams

export interface IAgentConfigPresenter {
  setConfigPresenter(configPresenter: IConfigPresenter): void
  getAgents(): Promise<Agent[]>
  getAgent(id: string): Promise<Agent | null>
  getAgentsByType(type: AgentType): Promise<Agent[]>
  getEnabledAcpAgents(): Promise<AcpAgent[]>
  getAcpBuiltinAgents(): Promise<AcpAgent[]>
  getAcpCustomAgents(): Promise<AcpAgent[]>
  createAgent(agent: CreateAgentParams): Promise<string>
  updateAgent(id: string, updates: UpdateAgentParams): Promise<void>
  deleteAgent(id: string): Promise<void>

  setAcpBuiltinEnabled(id: string, enabled: boolean): Promise<void>
  addAcpBuiltinProfile(
    agentId: string,
    profile: Omit<AcpAgentProfile, 'id'>,
    options?: { activate?: boolean }
  ): Promise<AcpAgentProfile>
  updateAcpBuiltinProfile(
    agentId: string,
    profileId: string,
    updates: Partial<Omit<AcpAgentProfile, 'id'>>
  ): Promise<AcpAgentProfile | null>
  removeAcpBuiltinProfile(agentId: string, profileId: string): Promise<boolean>
  setAcpBuiltinActiveProfile(agentId: string, profileId: string): Promise<void>
  addAcpCustomAgent(agent: Omit<AcpCustomAgent, 'id' | 'createdAt' | 'updatedAt'>): Promise<string>
  updateAcpCustomAgent(
    id: string,
    updates: Partial<Omit<AcpCustomAgent, 'id' | 'createdAt' | 'updatedAt'>>
  ): Promise<void>
  removeAcpCustomAgent(id: string): Promise<void>
  setAcpCustomAgentEnabled(id: string, enabled: boolean): Promise<void>

  getAgentMcpSelections(agentId: string): Promise<string[]>
  setAgentMcpSelections(agentId: string, mcpIds: string[]): Promise<void>

  migrateAcpAgentsFromStore(): Promise<void>

  ensureDefaultBuiltinAgents(): Promise<void>

  ensureDefaultAgent(): Promise<void>
  getDefaultAgent(): Promise<TemplateAgent | null>

  getAcpGlobalEnabled(): boolean
  setAcpGlobalEnabled(enabled: boolean): void
  getAcpUseBuiltinRuntime(): boolean
  setAcpUseBuiltinRuntime(enabled: boolean): void
}

export const DEFAULT_AGENT_ID = 'default-local-agent'
