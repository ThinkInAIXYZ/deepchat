import type {
  AcpBuiltinAgent,
  AcpBuiltinAgentId,
  AcpCustomAgent,
  AcpStoreData,
  IConfigPresenter
} from '@shared/presenter'
import type {
  TemplateAgent,
  AcpAgent,
  AcpAgentProfile,
  CreateAgentParams,
  UpdateAgentParams,
  IAgentConfigPresenter,
  Agent,
  AgentType
} from '@shared/types/presenters/agentConfig.presenter'
import { AgentsTable } from '../sqlitePresenter/tables/agents'
import type Database from 'better-sqlite3-multiple-ciphers'
import path from 'path'
import fs from 'fs'
import { app } from 'electron'
import ElectronStore from 'electron-store'
import { nanoid } from 'nanoid'

export const DEFAULT_AGENT_ID = 'default-local-agent'

const ACP_GLOBAL_STORE_KEY = 'acp_global_enabled'
const ACP_RUNTIME_STORE_KEY = 'acp_use_builtin_runtime'
const ACP_STORE_NAME = 'acp_agents'

interface AcpGlobalStore {
  [ACP_GLOBAL_STORE_KEY]?: boolean
  [ACP_RUNTIME_STORE_KEY]?: boolean
}

export class AgentConfigPresenter implements IAgentConfigPresenter {
  private agentsTable: AgentsTable
  private acpGlobalStore: ElectronStore<AcpGlobalStore>
  private legacyAcpStore: ElectronStore<Partial<AcpStoreData>> | null = null
  private _configPresenter: IConfigPresenter | null = null

  constructor(db: Database.Database) {
    this.agentsTable = new AgentsTable(db)
    this.agentsTable.createTable()
    this.acpGlobalStore = new ElectronStore<AcpGlobalStore>({
      name: 'acp_global_settings',
      defaults: {
        [ACP_GLOBAL_STORE_KEY]: false,
        [ACP_RUNTIME_STORE_KEY]: false
      }
    })
  }

  setConfigPresenter(configPresenter: IConfigPresenter): void {
    this._configPresenter = configPresenter
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

  async getAcpBuiltinAgents(): Promise<AcpAgent[]> {
    return this.agentsTable.listBuiltinAcpAgents()
  }

  async getAcpCustomAgents(): Promise<AcpAgent[]> {
    return this.agentsTable.listCustomAcpAgents()
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
    return this.agentsTable.delete(id)
  }

  async setAcpBuiltinEnabled(id: string, enabled: boolean): Promise<void> {
    const agent = await this.getAgent(id)
    if (!agent || agent.type !== 'acp' || !agent.isBuiltin) {
      throw new Error(`Builtin ACP agent ${id} not found`)
    }

    const updates: Partial<AcpAgent> = { enabled }

    if (enabled && !agent.activeProfileId) {
      const profiles = agent.profiles || []
      if (profiles.length > 0) {
        updates.activeProfileId = profiles[0].id
      }
    }

    await this.agentsTable.update(id, updates, 'acp')
    this.notifyAcpAgentsMutated([id])
  }

  async addAcpBuiltinProfile(
    agentId: string,
    profile: Omit<AcpAgentProfile, 'id'>,
    options?: { activate?: boolean }
  ): Promise<AcpAgentProfile> {
    const agent = await this.getAgent(agentId)
    if (!agent || agent.type !== 'acp' || !agent.isBuiltin) {
      throw new Error(`Builtin ACP agent ${agentId} not found`)
    }

    const newProfile: AcpAgentProfile = {
      ...profile,
      id: nanoid()
    }

    const profiles = [...(agent.profiles || []), newProfile]
    const updates: Partial<AcpAgent> = { profiles }

    if (options?.activate) {
      updates.activeProfileId = newProfile.id
    }

    await this.agentsTable.update(agentId, updates, 'acp')
    this.notifyAcpAgentsMutated([agentId])
    return newProfile
  }

  async updateAcpBuiltinProfile(
    agentId: string,
    profileId: string,
    updates: Partial<Omit<AcpAgentProfile, 'id'>>
  ): Promise<AcpAgentProfile | null> {
    const agent = await this.getAgent(agentId)
    if (!agent || agent.type !== 'acp' || !agent.isBuiltin) {
      throw new Error(`Builtin ACP agent ${agentId} not found`)
    }

    const profiles = agent.profiles || []
    const profileIndex = profiles.findIndex((p) => p.id === profileId)
    if (profileIndex === -1) return null

    const updatedProfile = { ...profiles[profileIndex], ...updates }
    const updatedProfiles = [...profiles]
    updatedProfiles[profileIndex] = updatedProfile

    await this.agentsTable.update(agentId, { profiles: updatedProfiles }, 'acp')
    this.notifyAcpAgentsMutated([agentId])
    return updatedProfile
  }

  async removeAcpBuiltinProfile(agentId: string, profileId: string): Promise<boolean> {
    const agent = await this.getAgent(agentId)
    if (!agent || agent.type !== 'acp' || !agent.isBuiltin) {
      throw new Error(`Builtin ACP agent ${agentId} not found`)
    }

    const profiles = agent.profiles || []
    const profileIndex = profiles.findIndex((p) => p.id === profileId)
    if (profileIndex === -1) return false

    const updatedProfiles = profiles.filter((p) => p.id !== profileId)
    const updates: Partial<AcpAgent> = { profiles: updatedProfiles }

    if (agent.activeProfileId === profileId) {
      updates.activeProfileId = updatedProfiles.length > 0 ? updatedProfiles[0].id : undefined
    }

    await this.agentsTable.update(agentId, updates, 'acp')
    this.notifyAcpAgentsMutated([agentId])
    return true
  }

  async setAcpBuiltinActiveProfile(agentId: string, profileId: string): Promise<void> {
    const agent = await this.getAgent(agentId)
    if (!agent || agent.type !== 'acp' || !agent.isBuiltin) {
      throw new Error(`Builtin ACP agent ${agentId} not found`)
    }

    const profiles = agent.profiles || []
    if (!profiles.find((p) => p.id === profileId)) {
      throw new Error(`Profile ${profileId} not found in agent ${agentId}`)
    }

    await this.agentsTable.update(agentId, { activeProfileId: profileId }, 'acp')
    this.notifyAcpAgentsMutated([agentId])
  }

  async addAcpCustomAgent(
    agent: Omit<AcpCustomAgent, 'id' | 'createdAt' | 'updatedAt'>
  ): Promise<string> {
    const id = await this.agentsTable.create({
      type: 'acp',
      name: agent.name,
      command: agent.command,
      args: agent.args,
      env: agent.env,
      enabled: agent.enabled ?? true,
      isBuiltin: false,
      mcpSelections: agent.mcpSelections
    })
    this.notifyAcpAgentsMutated([id])
    return id
  }

  async updateAcpCustomAgent(
    id: string,
    updates: Partial<Omit<AcpCustomAgent, 'id' | 'createdAt' | 'updatedAt'>>
  ): Promise<void> {
    const agent = await this.getAgent(id)
    if (!agent || agent.type !== 'acp' || agent.isBuiltin) {
      throw new Error(`Custom ACP agent ${id} not found`)
    }
    await this.agentsTable.update(id, updates, 'acp')
    this.notifyAcpAgentsMutated([id])
  }

  async removeAcpCustomAgent(id: string): Promise<void> {
    const agent = await this.getAgent(id)
    if (!agent || agent.type !== 'acp' || agent.isBuiltin) {
      throw new Error(`Custom ACP agent ${id} not found`)
    }
    await this.agentsTable.delete(id)
    this.notifyAcpAgentsMutated([id])
  }

  async setAcpCustomAgentEnabled(id: string, enabled: boolean): Promise<void> {
    const agent = await this.getAgent(id)
    if (!agent || agent.type !== 'acp' || agent.isBuiltin) {
      throw new Error(`Custom ACP agent ${id} not found`)
    }
    await this.agentsTable.update(id, { enabled }, 'acp')
    this.notifyAcpAgentsMutated([id])
  }

  async getAgentMcpSelections(agentId: string): Promise<string[]> {
    const agent = await this.getAgent(agentId)
    if (!agent || agent.type !== 'acp') {
      return []
    }
    return agent.mcpSelections || []
  }

  async setAgentMcpSelections(agentId: string, mcpIds: string[]): Promise<void> {
    const agent = await this.getAgent(agentId)
    if (!agent || agent.type !== 'acp') {
      throw new Error(`ACP agent ${agentId} not found`)
    }
    await this.agentsTable.update(agentId, { mcpSelections: mcpIds }, 'acp')
    this.notifyAcpAgentsMutated([agentId])
  }

  private notifyAcpAgentsMutated(agentIds?: string[]): void {
    if (this._configPresenter) {
      this._configPresenter.onAcpAgentsMutated(agentIds)
    }
  }

  async migrateAcpAgentsFromStore(): Promise<void> {
    const hasAcpAgents = await this.agentsTable.hasAcpAgents()
    if (hasAcpAgents) {
      return
    }

    const legacyStore = this.getLegacyAcpStore()
    if (!legacyStore) {
      return
    }

    const storeData = legacyStore.store as Partial<AcpStoreData>
    const globalEnabled = storeData.enabled ?? false
    const useBuiltinRuntime = storeData.useBuiltinRuntime ?? false

    this.acpGlobalStore.set(ACP_GLOBAL_STORE_KEY, globalEnabled)
    this.acpGlobalStore.set(ACP_RUNTIME_STORE_KEY, useBuiltinRuntime)

    const builtins = storeData.builtins ?? []
    const customs = storeData.customs ?? []

    for (const builtin of builtins) {
      await this.migrateBuiltinAgent(builtin)
    }

    for (const custom of customs) {
      await this.migrateCustomAgent(custom)
    }
  }

  private getLegacyAcpStore(): ElectronStore<Partial<AcpStoreData>> | null {
    if (this.legacyAcpStore) {
      return this.legacyAcpStore
    }

    try {
      this.legacyAcpStore = new ElectronStore<Partial<AcpStoreData>>({
        name: ACP_STORE_NAME,
        cwd: path.join(app.getPath('userData'), 'config')
      })
      return this.legacyAcpStore
    } catch {
      return null
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

  async ensureDefaultBuiltinAgents(): Promise<void> {
    const DEFAULT_BUILTIN_AGENTS: Array<{
      id: AcpBuiltinAgentId
      name: string
      command: string
      args: string[]
    }> = [
      {
        id: 'kimi-cli',
        name: 'Kimi CLI',
        command: 'kimi',
        args: []
      },
      {
        id: 'claude-code-acp',
        name: 'Claude Code',
        command: 'claude',
        args: []
      },
      {
        id: 'codex-acp',
        name: 'Codex',
        command: 'codex',
        args: []
      }
    ]

    for (const defaultAgent of DEFAULT_BUILTIN_AGENTS) {
      const existing = await this.agentsTable.getByBuiltinId(defaultAgent.id)
      if (!existing) {
        await this.agentsTable.create({
          type: 'acp',
          name: defaultAgent.name,
          command: defaultAgent.command,
          args: defaultAgent.args,
          enabled: false,
          isBuiltin: true,
          builtinId: defaultAgent.id,
          profiles: [
            {
              id: nanoid(),
              name: 'Default',
              command: defaultAgent.command,
              args: defaultAgent.args,
              env: {}
            }
          ]
        })
      }
    }
  }

  async ensureDefaultAgent(): Promise<void> {
    const existing = await this.getAgent(DEFAULT_AGENT_ID)
    if (existing) {
      return
    }

    const defaultWorkdir = path.join(app.getPath('userData'), 'workspace')
    await fs.promises.mkdir(defaultWorkdir, { recursive: true })

    if (!this._configPresenter) {
      return
    }

    const providers = this._configPresenter.getProviders()
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
    const prevEnabled = this.acpGlobalStore.get(ACP_GLOBAL_STORE_KEY, false)
    this.acpGlobalStore.set(ACP_GLOBAL_STORE_KEY, enabled)
    if (prevEnabled !== enabled && this._configPresenter) {
      this._configPresenter.syncAcpProviderEnabled(enabled)
      if (!enabled) {
        this._configPresenter.clearProviderModels('acp')
      }
      this._configPresenter.onAcpAgentsMutated()
    }
  }

  getAcpUseBuiltinRuntime(): boolean {
    return Boolean(this.acpGlobalStore.get(ACP_RUNTIME_STORE_KEY))
  }

  setAcpUseBuiltinRuntime(enabled: boolean): void {
    this.acpGlobalStore.set(ACP_RUNTIME_STORE_KEY, enabled)
  }
}
