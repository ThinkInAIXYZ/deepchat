import type { IConfigPresenter } from '@shared/presenter'
import type {
  Agent,
  AgentType,
  TemplateAgent,
  AcpAgent,
  CreateAgentParams,
  UpdateAgentParams,
  IAgentConfigPresenter
} from '@shared/types/presenters/agentConfig.presenter'
import { AgentsTable } from '../sqlitePresenter/tables/agents'
import type Database from 'better-sqlite3-multiple-ciphers'
import path from 'path'
import fs from 'fs'
import { app } from 'electron'

export const DEFAULT_AGENT_ID = 'default-local-agent'

export class AgentConfigPresenter implements IAgentConfigPresenter {
  private agentsTable: AgentsTable
  private configPresenter: IConfigPresenter

  constructor(db: Database.Database, configPresenter: IConfigPresenter) {
    this.agentsTable = new AgentsTable(db)
    this.agentsTable.createTable()
    this.configPresenter = configPresenter
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

  async syncAcpAgents(): Promise<void> {
    const acpConfigs = await this.configPresenter.getAcpAgents()
    const existingAcpAgents = await this.getAgentsByType('acp')

    const existingMap = new Map(existingAcpAgents.map((a) => [a.id, a]))
    const configIds = new Set(acpConfigs.map((c) => c.id))

    for (const config of acpConfigs) {
      const existing = existingMap.get(config.id) as AcpAgent | undefined
      if (!existing) {
        await this.agentsTable.create({
          type: 'acp',
          id: config.id,
          name: config.name,
          command: config.command,
          args: config.args,
          env: config.env,
          enabled: true
        })
      } else {
        const needsUpdate =
          existing.name !== config.name ||
          existing.command !== config.command ||
          JSON.stringify(existing.args) !== JSON.stringify(config.args) ||
          JSON.stringify(existing.env) !== JSON.stringify(config.env)

        if (needsUpdate) {
          await this.agentsTable.update(
            config.id,
            {
              name: config.name,
              command: config.command,
              args: config.args,
              env: config.env
            },
            'acp'
          )
        }
      }
    }

    for (const agent of existingAcpAgents) {
      if (!configIds.has(agent.id)) {
        await this.agentsTable.delete(agent.id)
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
}
