import type { AcpBuiltinAgentId } from './legacy.presenters'

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
  getAgents(): Promise<Agent[]>
  getAgent(id: string): Promise<Agent | null>
  getAgentsByType(type: AgentType): Promise<Agent[]>
  getEnabledAcpAgents(): Promise<AcpAgent[]>
  createAgent(agent: CreateAgentParams): Promise<string>
  updateAgent(id: string, updates: UpdateAgentParams): Promise<void>
  deleteAgent(id: string): Promise<void>

  migrateAcpAgentsFromStore(): Promise<void>

  ensureDefaultAgent(): Promise<void>
  getDefaultAgent(): Promise<TemplateAgent | null>

  getAcpGlobalEnabled(): boolean
  setAcpGlobalEnabled(enabled: boolean): void
  getAcpUseBuiltinRuntime(): boolean
  setAcpUseBuiltinRuntime(enabled: boolean): void
}

export const DEFAULT_AGENT_ID = 'default-local-agent'
