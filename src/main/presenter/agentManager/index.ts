import { IAgentManager, AgentConfig, AgentType, AgentTabData } from '@shared/agent'
import { IConfigPresenter, ITabPresenter, IAgentFlowPresenter } from '@shared/presenter'
import { ChatProvider } from '../chatProvider'
import { DatlasProvider } from '../agentFlowPresenter/providers/datlasProvider'
import { ClaudeCliProvider } from '../agentFlowPresenter/providers/claudeCliProvider'
import { eventBus } from '@/eventbus'
import { AGENT_EVENTS } from '@/events'

export class AgentManager implements IAgentManager {
  private agents: Map<string, AgentConfig> = new Map()
  private providers: Map<string, any> = new Map()
  private tabAgentMap: Map<number, AgentTabData> = new Map()

  private configPresenter: IConfigPresenter
  private tabPresenter: ITabPresenter
  private agentFlowPresenter?: IAgentFlowPresenter

  constructor(configPresenter: IConfigPresenter, tabPresenter: ITabPresenter) {
    this.configPresenter = configPresenter
    this.tabPresenter = tabPresenter
  }

  /**
   * 初始化 AgentManager（从外部调用）
   */
  async initialize(): Promise<void> {
    console.log('Initializing AgentManager...')
    await this.loadUserAgents()
    console.log('AgentManager initialized successfully')
  }

  /**
   * 设置 AgentFlowPresenter 的引用
   */
  setAgentFlowPresenter(agentFlowPresenter: IAgentFlowPresenter): void {
    this.agentFlowPresenter = agentFlowPresenter
    this.syncAgentFlowPresenter()
  }

  /**
   * 同步 Agent 配置到 AgentFlowPresenter
   */
  private syncAgentFlowPresenter(): void {
    if (!this.agentFlowPresenter) return

    try {
      // 获取所有 Agent 配置
      const agents = this.getAllAgents()

      // 转换为 AgentFlowPresenter 需要的格式
      const agentFlowConfigs = agents.map((agent) => ({
        id: agent.id,
        name: agent.name,
        type: agent.type,
        enabled: agent.enabled,
        config: {
          baseUrl: agent.config.baseUrl || 'https://ai.maicedata.com/api/knowbase/rag',
          agentId: agent.config.agentId || '',
          token: agent.config.token || '',
          ...agent.config
        },
        custom: agent.custom
      }))

      // 设置到 AgentFlowPresenter
      this.agentFlowPresenter.setAgents(agentFlowConfigs)
      console.log(`Synced ${agentFlowConfigs.length} agents to AgentFlowPresenter`)
    } catch (error) {
      console.error('Failed to sync agents to AgentFlowPresenter:', error)
    }
  }

  /**
   * 从 configPresenter 加载用户配置的 Agent
   */
  private async loadUserAgents(): Promise<void> {
    try {
      console.log('Loading user agents from config...')
      const userAgents = await this.configPresenter.getAgents()
      console.log('Found user agents:', userAgents.length)

      userAgents.forEach((agentConfig, index) => {
        console.log(`Agent ${index + 1}:`, {
          id: agentConfig.id,
          name: agentConfig.name,
          type: agentConfig.type,
          enabled: agentConfig.enabled,
          hasConfig: !!agentConfig.config
        })

        const config: AgentConfig = {
          id: agentConfig.id,
          name: agentConfig.name,
          type: agentConfig.type as AgentType,
          enabled: agentConfig.enabled,
          config: agentConfig.config,
          icon: 'lucide:database', // 默认图标，可以根据类型设置
          color: '#10b981', // 默认颜色
          description: `${agentConfig.name} Agent`
        }

        this.agents.set(agentConfig.id, config)
        console.log(`Registered agent: ${config.id}`)
      })

      console.log(`Total agents loaded: ${this.agents.size}`)

      // 同步到 AgentFlowPresenter
      this.syncAgentFlowPresenter()
    } catch (error) {
      console.error('Failed to load user agents:', error)
      throw error
    }
  }

  /**
   * 重新加载用户配置的 Agent
   */
  async reloadUserAgents(): Promise<void> {
    try {
      console.log('Reloading user agents...')

      // 清除现有的 Agent（但保留 providers）
      this.agents.clear()

      // 重新加载用户配置的 Agent
      await this.loadUserAgents()

      console.log('User agents reloaded successfully')
    } catch (error) {
      console.error('Failed to reload user agents:', error)
      throw error
    }
  }

  /**
   * 注册 Agent
   */
  registerAgent(config: AgentConfig): void {
    console.log(`Registering agent: ${config.id} (${config.type})`)
    this.agents.set(config.id, config)

    // 同步到 AgentFlowPresenter
    this.syncAgentFlowPresenter()

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

    // 同步到 AgentFlowPresenter
    this.syncAgentFlowPresenter()

    eventBus.sendToMain(AGENT_EVENTS.AGENT_UNREGISTERED, agentId)
  }

  /**
   * 获取 Agent 配置
   */
  getAgent(agentId: string): AgentConfig | null {
    // 对于默认的 chat agent，返回默认配置
    if (agentId === 'default-chat') {
      return {
        id: 'default-chat',
        name: 'Chat Assistant',
        type: 'chat',
        enabled: true,
        config: {},
        icon: 'lucide:message-circle',
        color: '#3b82f6',
        description: 'Default chat assistant'
      }
    }

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
    // 对于默认的 chat agent，直接返回成功，不需要创建 provider
    if (agentId === 'default-chat') {
      return true
    }

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
      case 'claude-cli':
        provider = new ClaudeCliProvider(
          {
            id: agentId,
            name: agent.name,
            type: agent.type,
            enabled: agent.enabled,
            config: {
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
    const agent = this.getAgent(agentId)
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
    // 对于默认的 chat agent，不允许更新
    if (agentId === 'default-chat') {
      console.warn('Cannot update default chat agent')
      return
    }

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

    // 同步到 AgentFlowPresenter
    this.syncAgentFlowPresenter()

    eventBus.sendToMain(AGENT_EVENTS.AGENT_UPDATED, updatedAgent)
  }

  /**
   * 检查 Agent 是否可用
   */
  async checkAgent(agentId: string): Promise<{ isOk: boolean; errorMsg: string | null }> {
    try {
      // 对于默认的 chat agent，直接返回可用状态
      if (agentId === 'default-chat') {
        return { isOk: true, errorMsg: null }
      }

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
