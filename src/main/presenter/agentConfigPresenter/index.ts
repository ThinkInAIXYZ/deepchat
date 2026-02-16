import type { IConfigPresenter, AcpBuiltinAgent, AcpCustomAgent } from '@shared/presenter'
import type {
  Agent,
  AgentType,
  TemplateAgent,
  AcpAgent,
  AcpAgentProfile,
  CreateAgentParams,
  UpdateAgentParams,
  IAgentConfigPresenter
} from '@shared/types/presenters/agentConfig.presenter'
import { AgentsTable } from '../sqlitePresenter/tables/agents'
import type Database from 'better-sqlite3-multiple-ciphers'
import path from 'path'
import fs from 'fs'
import { app } from 'electron'
import ElectronStore from 'electron-store'

export const DEFAULT_AGENT_ID = 'default-local-agent'

const ACP_GLOBAL_STORE_KEY = 'acp_global_enabled'
const ACP_RUNTIME_STORE_KEY = 'acp_use_builtin_runtime'

interface AcpGlobalStore {
  [ACP_GLOBAL_STORE_KEY]?: boolean
  [ACP_RUNTIME_STORE_KEY]?: boolean
}

export class AgentConfigPresenter implements IAgentConfigPresenter {
  private agentsTable: AgentsTable
  private configPresenter: IConfigPresenter
  private acpGlobalStore: ElectronStore<AcpGlobalStore>

  constructor(db: Database.Database, configPresenter: IConfigPresenter) {
    this.agentsTable = new AgentsTable(db)
    this.agentsTable.createTable()
    this.configPresenter = configPresenter
    this.acpGlobalStore = new ElectronStore<AcpGlobalStore>({
      name: 'acp_global_settings',
      defaults: {
        [ACP_GLOBAL_STORE_KEY]: false,
        [ACP_RUNTIME_STORE_KEY]: false
      }
    })
  }

  async getAgents(): Promise<Agent[]> {
    return this.agentsTable.list()
  }

  async getAgent(id: string): Promise<Agent | null> {
    return this.agentsTable.get(id)
  }

  async getAgentsByType(type: AgentType): Promise<Agent[]> {
    return this.agentsTable.listByType(type)
  }

  async getEnabledAcpAgents(): Promise<AcpAgent[]> {
    return this.agentsTable.listEnabledAcpAgents()
  }

  async createAgent(agent: CreateAgentParams): Promise<string> {
    return this.agentsTable.create(agent)
  }

  async updateAgent(id: string, updates: UpdateAgentParams): Promise<void> {
    const agent = await this.getAgent(id)
    if (!agent) {
      throw new Error(`Agent ${id} not found`)
    }
    return this.agentsTable.update(id, updates, agent.type)
  }

  async deleteAgent(id: string): Promise<void> {
    if (id === DEFAULT_AGENT_ID) {
      throw new Error('Cannot delete default agent')
    }
    return this.agentsTable.delete(id)
  }

  async migrateAcpAgentsFromStore(): Promise<void> {
    const hasAcpAgents = await this.agentsTable.hasAcpAgents()
    if (hasAcpAgents) {
      return
    }

    const globalEnabled = await this.configPresenter.getAcpEnabled()
    const useBuiltinRuntime = await this.configPresenter.getAcpUseBuiltinRuntime()
    this.acpGlobalStore.set(ACP_GLOBAL_STORE_KEY, globalEnabled)
    this.acpGlobalStore.set(ACP_RUNTIME_STORE_KEY, useBuiltinRuntime)

    const builtins = await this.configPresenter.getAcpBuiltinAgents()
    const customs = await this.configPresenter.getAcpCustomAgents()

    for (const builtin of builtins) {
      await this.migrateBuiltinAgent(builtin)
    }

    for (const custom of customs) {
      await this.migrateCustomAgent(custom)
    }
  }

  private async migrateBuiltinAgent(builtin: AcpBuiltinAgent): Promise<void> {
    const activeProfile =
      builtin.profiles.find((p) => p.id === builtin.activeProfileId) || builtin.profiles[0]

    if (!activeProfile) {
      return
    }

    await this.agentsTable.create({
      type: 'acp',
      id: builtin.id,
      name: builtin.name,
      command: activeProfile.command,
      args: activeProfile.args,
      env: activeProfile.env,
      enabled: builtin.enabled,
      isBuiltin: true,
      builtinId: builtin.id,
      profiles: builtin.profiles,
      activeProfileId: builtin.activeProfileId || undefined,
      mcpSelections: builtin.mcpSelections
    })
  }

  private async migrateCustomAgent(custom: AcpCustomAgent): Promise<void> {
    await this.agentsTable.create({
      type: 'acp',
      id: custom.id,
      name: custom.name,
      command: custom.command,
      args: custom.args,
      env: custom.env,
      enabled: custom.enabled,
      isBuiltin: false,
      mcpSelections: custom.mcpSelections
    })
  }

  async ensureDefaultAgent(): Promise<void> {
    const existing = await this.getAgent(DEFAULT_AGENT_ID)
    if (existing) {
      return
    }

    const defaultWorkdir = path.join(app.getPath('userData'), 'workspace')
    await fs.promises.mkdir(defaultWorkdir, { recursive: true })

    const providers = this.configPresenter.getProviders()
    const enabledProvider = providers.find((p) => p.enable)
    const defaultProviderId = enabledProvider?.id || 'openai'
    const defaultModelId = 'gpt-4'

    await this.agentsTable.create({
      type: 'template',
      id: DEFAULT_AGENT_ID,
      name: 'Local Agent',
      providerId: defaultProviderId,
      modelId: defaultModelId,
      icon: 'lucide:bot'
    })
  }

  async getDefaultAgent(): Promise<TemplateAgent | null> {
    const agent = await this.getAgent(DEFAULT_AGENT_ID)
    if (agent && agent.type === 'template') {
      return agent
    }
    return null
  }

  getAcpGlobalEnabled(): boolean {
    return Boolean(this.acpGlobalStore.get(ACP_GLOBAL_STORE_KEY))
  }

  setAcpGlobalEnabled(enabled: boolean): void {
    this.acpGlobalStore.set(ACP_GLOBAL_STORE_KEY, enabled)
  }

  getAcpUseBuiltinRuntime(): boolean {
    return Boolean(this.acpGlobalStore.get(ACP_RUNTIME_STORE_KEY))
  }

  setAcpUseBuiltinRuntime(enabled: boolean): void {
    this.acpGlobalStore.set(ACP_RUNTIME_STORE_KEY, enabled)
  }

  async addAcpAgentProfile(
    agentId: string,
    profile: Omit<AcpAgentProfile, 'id'>
  ): Promise<AcpAgentProfile> {
    const agent = await this.getAgent(agentId)
    if (!agent || agent.type !== 'acp') {
      throw new Error(`ACP agent ${agentId} not found`)
    }

    const newProfile: AcpAgentProfile = {
      id: `profile-${Date.now()}`,
      name: profile.name,
      command: profile.command,
      args: profile.args,
      env: profile.env
    }

    const profiles = [...(agent.profiles || []), newProfile]
    const activeProfileId = agent.activeProfileId || newProfile.id

    await this.agentsTable.update(
      agentId,
      {
        profiles,
        activeProfileId
      },
      'acp'
    )

    return newProfile
  }

  async updateAcpAgentProfile(
    agentId: string,
    profileId: string,
    updates: Partial<Omit<AcpAgentProfile, 'id'>>
  ): Promise<AcpAgentProfile | null> {
    const agent = await this.getAgent(agentId)
    if (!agent || agent.type !== 'acp' || !agent.profiles) {
      return null
    }

    const profileIndex = agent.profiles.findIndex((p) => p.id === profileId)
    if (profileIndex === -1) {
      return null
    }

    const updatedProfile: AcpAgentProfile = {
      ...agent.profiles[profileIndex],
      ...updates
    }

    const profiles = [...agent.profiles]
    profiles[profileIndex] = updatedProfile

    await this.agentsTable.update(agentId, { profiles }, 'acp')

    return updatedProfile
  }

  async removeAcpAgentProfile(agentId: string, profileId: string): Promise<boolean> {
    const agent = await this.getAgent(agentId)
    if (!agent || agent.type !== 'acp' || !agent.profiles) {
      return false
    }

    if (agent.profiles.length <= 1) {
      return false
    }

    const profiles = agent.profiles.filter((p) => p.id !== profileId)
    if (profiles.length === agent.profiles.length) {
      return false
    }

    let activeProfileId = agent.activeProfileId
    if (activeProfileId === profileId) {
      activeProfileId = profiles[0]?.id
    }

    await this.agentsTable.update(
      agentId,
      {
        profiles,
        activeProfileId
      },
      'acp'
    )

    return true
  }

  async setAcpAgentActiveProfile(agentId: string, profileId: string): Promise<void> {
    const agent = await this.getAgent(agentId)
    if (!agent || agent.type !== 'acp' || !agent.profiles) {
      throw new Error(`ACP agent ${agentId} not found`)
    }

    const profile = agent.profiles.find((p) => p.id === profileId)
    if (!profile) {
      throw new Error(`Profile ${profileId} not found`)
    }

    await this.agentsTable.update(
      agentId,
      {
        activeProfileId: profileId,
        command: profile.command,
        args: profile.args,
        env: profile.env
      },
      'acp'
    )
  }

  async getAcpAgentMcpSelections(agentId: string): Promise<string[]> {
    const agent = await this.getAgent(agentId)
    if (!agent || agent.type !== 'acp') {
      return []
    }
    return agent.mcpSelections || []
  }

  async setAcpAgentMcpSelections(agentId: string, mcpIds: string[]): Promise<void> {
    const agent = await this.getAgent(agentId)
    if (!agent || agent.type !== 'acp') {
      throw new Error(`ACP agent ${agentId} not found`)
    }

    await this.agentsTable.update(agentId, { mcpSelections: mcpIds }, 'acp')
  }
}
