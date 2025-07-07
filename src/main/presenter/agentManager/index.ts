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

    // Datlas Agent
    const datlasAgent: AgentConfig = {
      id: 'datlas-agent',
      type: 'datlas',
      name: 'Datlas Agent',
      description: 'Knowledge base retrieval and generation service',
      enabled: true,
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
    return Array.from(this.agents.values()).filter(agent => agent.type === type)
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
  createProvider(agentId: string): any {
    const agent = this.agents.get(agentId)
    if (!agent) {
      throw new Error(`Agent not found: ${agentId}`)
    }

    // 如果已经存在 provider，直接返回
    if (this.providers.has(agentId)) {
      return this.providers.get(agentId)
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
    return provider
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
    const url = agent.type === 'chat'
      ? 'local://chat'
      : `local://agent?type=${agent.type}&id=${agentId}`

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
    const provider = this.getProvider(agentId)
    if (!provider) {
      return { isOk: false, errorMsg: 'Provider not found' }
    }

    if (typeof provider.check === 'function') {
      return await provider.check()
    }

    return { isOk: true, errorMsg: null }
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
