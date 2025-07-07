import { IAgentManager, AgentConfig, AgentType, AgentTabData } from '@shared/agent'
import { IConfigPresenter, ITabPresenter } from '@shared/presenter'
import { ChatProvider } from '../chatProvider'
import { DatlasProvider } from '../agentFlowPresenter/providers/datlasProvider'
import { eventBus } from '@/eventbus'
import { AGENT_EVENTS } from '@/events'

export class AgentManager implements IAgentManager {
  private agents: Map<string, AgentConfig> = new Map()
  private providers: Map<string, any> = new Map()
  private tabAgentMap: Map<number, AgentTabData> = new Map()

  private configPresenter: IConfigPresenter
  private tabPresenter: ITabPresenter

  constructor(configPresenter: IConfigPresenter, tabPresenter: ITabPresenter) {
    this.configPresenter = configPresenter
    this.tabPresenter = tabPresenter
    this.initializeDefaultAgents()
    this.loadUserAgents()
  }

  /**
   * 初始化默认的 Agent 配置
   */
  private initializeDefaultAgents(): void {
    // 默认的 Chat Agent
    const chatAgent: AgentConfig = {
      id: 'default-chat',
      type: 'chat',
      name: 'Chat Assistant',
      description: 'Default chat assistant using LLM providers',
      enabled: true,
      config: {},
      icon: 'lucide:message-circle',
      color: '#3b82f6'
    }

    // Datlas Agent (只注册默认配置，不启用)
    const datlasAgent: AgentConfig = {
      id: 'datlas-agent',
      type: 'datlas',
      name: 'Datlas Agent',
      description: 'Knowledge base retrieval and generation service',
      enabled: false,
      config: {
        baseUrl: 'https://ai.maicedata.com/api/knowbase/rag',
        agentId: '',
        token: ''
      },
      icon: 'lucide:database',
      color: '#10b981'
    }

    this.registerAgent(chatAgent)
    this.registerAgent(datlasAgent)
  }

  /**
   * 加载用户自定义的 Agent 配置
   */
  private loadUserAgents(): void {
    try {
      // 从 configPresenter 获取用户配置的 agents
      const userAgents = (this.configPresenter as any).getAgents ? (this.configPresenter as any).getAgents() : []

      userAgents.forEach((userAgent: any) => {
        // 将用户配置的 agent 转换为 AgentConfig 格式
        const agentConfig: AgentConfig = {
          id: userAgent.id,
          type: userAgent.type,
          name: userAgent.name,
          description: userAgent.description || `${userAgent.name} Agent`,
          enabled: userAgent.enabled,
          config: userAgent.config,
          custom: userAgent.custom,
          icon: userAgent.type === 'datlas' ? 'lucide:database' : 'lucide:bot',
          color: userAgent.type === 'datlas' ? '#10b981' : '#3b82f6'
        }

        // 如果是自定义 agent，直接注册
        if (userAgent.custom) {
          console.log(`Loading custom agent: ${userAgent.id}`)
          this.registerAgent(agentConfig)
        } else {
          // 如果是系统 agent，更新现有配置
          const existingAgent = this.agents.get(userAgent.id)
          if (existingAgent) {
            console.log(`Updating system agent: ${userAgent.id}`)
            this.updateAgent(userAgent.id, agentConfig)
          }
        }
      })
    } catch (error) {
      console.error('Failed to load user agents:', error)
    }
  }

  /**
   * 注册 Agent
   */
  registerAgent(config: AgentConfig): void {
    console.log(`Registering agent: ${config.id} (${config.type})`)
    this.agents.set(config.id, config)
    eventBus.sendToMain(AGENT_EVENTS.AGENT_REGISTERED, config)
  }

  /**
   * 取消注册 Agent
   */
  unregisterAgent(agentId: string): void {
    console.log(`Unregistering agent: ${agentId}`)
    this.agents.delete(agentId)
    // 清理相关的 provider
    if (this.providers.has(agentId)) {
      this.providers.delete(agentId)
    }
    eventBus.sendToMain(AGENT_EVENTS.AGENT_UNREGISTERED, agentId)
  }

  /**
   * 获取 Agent 配置
   */
  getAgent(agentId: string): AgentConfig | null {
    return this.agents.get(agentId) || null
  }

  /**
   * 根据类型获取 Agent 列表
   */
  getAgentsByType(type: AgentType): AgentConfig[] {
    return Array.from(this.agents.values()).filter((agent) => agent.type === type)
  }

  /**
   * 获取所有 Agent
   */
  getAllAgents(): AgentConfig[] {
    return Array.from(this.agents.values())
  }

  /**
   * 创建 Agent Provider
   */
  createProvider(agentId: string): boolean {
    const agent = this.agents.get(agentId)
    if (!agent) {
      throw new Error(`Agent not found: ${agentId}`)
    }

    // 如果已经存在 provider，直接返回成功
    if (this.providers.has(agentId)) {
      return true
    }

    let provider: any

    switch (agent.type) {
      case 'chat':
        provider = new ChatProvider()
        break
      case 'datlas':
        provider = new DatlasProvider(
          {
            id: agentId,
            name: agent.name,
            type: agent.type,
            enabled: agent.enabled,
            config: {
              baseUrl: agent.config.baseUrl || 'https://ai.maicedata.com/api/knowbase/rag',
              agentId: agent.config.agentId || '',
              token: agent.config.token || '',
              ...agent.config
            }
          },
          this.configPresenter as any
        )
        break
      default:
        throw new Error(`Unsupported agent type: ${agent.type}`)
    }

    this.providers.set(agentId, provider)
    return true
  }

  /**
   * 获取 Agent Provider
   */
  getProvider(agentId: string): any {
    return this.providers.get(agentId) || null
  }

  /**
   * 创建 Agent Tab
   */
  async createAgentTab(windowId: number, agentId: string, options?: any): Promise<number | null> {
    const agent = this.agents.get(agentId)
    if (!agent) {
      console.error(`Agent not found: ${agentId}`)
      return null
    }

    // 构建 Agent Tab URL
    const url =
      agent.type === 'chat' ? 'local://chat' : `local://agent?type=${agent.type}&id=${agentId}`

    // 创建 Tab
    const tabId = await this.tabPresenter.createTab(windowId, url, {
      active: options?.active ?? true,
      position: options?.position
    })

    if (tabId) {
      // 存储 Tab 与 Agent 的映射关系
      const tabData: AgentTabData = {
        id: tabId,
        title: agent.name,
        agentType: agent.type,
        agentId: agentId,
        config: agent,
        isActive: options?.active ?? true,
        url: url,
        icon: agent.icon
      }

      this.tabAgentMap.set(tabId, tabData)
      console.log(`Created agent tab: ${tabId} for agent: ${agentId}`)
    }

    return tabId
  }

  /**
   * 获取 Agent Tab 配置
   */
  getAgentTabConfig(tabId: number): AgentTabData | null {
    return this.tabAgentMap.get(tabId) || null
  }

  /**
   * 更新 Agent 配置
   */
  updateAgent(agentId: string, updates: Partial<AgentConfig>): void {
    const agent = this.agents.get(agentId)
    if (!agent) {
      throw new Error(`Agent not found: ${agentId}`)
    }

    const updatedAgent = { ...agent, ...updates }
    this.agents.set(agentId, updatedAgent)

    // 如果 provider 已存在，可能需要重新创建
    if (this.providers.has(agentId)) {
      this.providers.delete(agentId)
    }

    eventBus.sendToMain(AGENT_EVENTS.AGENT_UPDATED, updatedAgent)
  }

  /**
   * 检查 Agent 是否可用
   */
  async checkAgent(agentId: string): Promise<{ isOk: boolean; errorMsg: string | null }> {
    try {
      // 如果 provider 不存在，尝试创建
      if (!this.providers.has(agentId)) {
        const created = this.createProvider(agentId)
        if (!created) {
          return { isOk: false, errorMsg: 'Failed to create provider' }
        }
      }

      const provider = this.getProvider(agentId)
      if (!provider) {
        return { isOk: false, errorMsg: 'Provider not found' }
      }

      if (typeof provider.check === 'function') {
        return await provider.check()
      }

      return { isOk: true, errorMsg: null }
    } catch (error) {
      return {
        isOk: false,
        errorMsg: error instanceof Error ? error.message : 'Unknown error'
      }
    }
  }

  /**
   * 销毁 AgentManager
   */
  destroy(): void {
    console.log('Destroying AgentManager')
    this.agents.clear()
    this.providers.clear()
    this.tabAgentMap.clear()
  }
}
