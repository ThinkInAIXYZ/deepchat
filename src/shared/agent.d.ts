// Agent 类型定义
export type AgentType = 'chat' | 'datlas' | 'custom'

// Agent 配置接口
export interface AgentConfig {
  id: string
  type: AgentType
  name: string
  description?: string
  enabled: boolean
  config: Record<string, any>
  custom?: boolean
  icon?: string
  color?: string
}

// Agent 实例接口
export interface AgentInstance {
  id: string
  type: AgentType
  config: AgentConfig
  provider: any // ChatProvider 或 AgentProvider
}

// Tab 类型扩展
export interface TabTypeConfig {
  type: 'chat' | 'agent'
  agentType?: AgentType
  agentId?: string
  metadata?: Record<string, any>
}

// Agent Tab 数据
export interface AgentTabData {
  id: number
  title: string
  agentType: AgentType
  agentId: string
  config: AgentConfig
  isActive: boolean
  url: string
  icon?: string
}

// Agent 会话设置
export interface AgentConversationSettings {
  agentId: string
  agentType: AgentType
  systemPrompt?: string
  temperature?: number
  maxTokens?: number
  // Agent 特定的配置
  agentConfig?: Record<string, any>
}

// Agent 管理器接口
export interface IAgentManager {
  // 初始化
  initialize(): Promise<void>

  // Agent 注册和管理
  registerAgent(config: AgentConfig): void
  unregisterAgent(agentId: string): void
  getAgent(agentId: string): AgentConfig | null
  getAgentsByType(type: AgentType): AgentConfig[]
  getAllAgents(): AgentConfig[]
  reloadUserAgents(): Promise<void>

  // Provider 管理
  createProvider(agentId: string): boolean
  getProvider(agentId: string): any

  // Tab 相关
  createAgentTab(windowId: number, agentId: string, options?: any): Promise<number | null>
  getAgentTabConfig(tabId: number): AgentTabData | null

  // Agent 状态检查
  checkAgent(agentId: string): Promise<{ isOk: boolean; errorMsg: string | null }>
  updateAgent(agentId: string, updates: Partial<AgentConfig>): void
}

// Chat Provider 接口 (从 ThreadPresenter 抽取)
export interface IChatProvider {
  // 会话管理
  createConversation(title: string, settings?: any, tabId?: number): Promise<string>
  getConversation(conversationId: string): Promise<any>
  deleteConversation(conversationId: string): Promise<void>

  // 消息管理
  sendMessage(conversationId: string, content: string, role: string): Promise<any>
  getMessages(conversationId: string, page: number, pageSize: number): Promise<any>

  // 流式处理
  startStreamCompletion(conversationId: string, queryMsgId?: string): Promise<void>
  stopMessageGeneration(messageId: string): Promise<void>

  // 检查状态
  check(): Promise<{ isOk: boolean; errorMsg: string | null }>
}
