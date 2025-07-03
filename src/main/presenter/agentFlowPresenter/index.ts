import {
  LLMCoreStreamEvent,
  ModelConfig,
  MCPToolDefinition,
  ChatMessage,
  MODEL_META
} from '@shared/presenter'
import { BaseAgentProvider } from './baseAgentProvider'
import { ConfigPresenter } from '../configPresenter'
import { DatlasProvider } from './providers/datlasProvider'
import { eventBus } from '@/eventbus'
import { CONFIG_EVENTS } from '@/events'

// Agent配置类型
export interface AGENT_CONFIG {
  id: string
  name: string
  type: string  // 'datlas' 等
  enabled: boolean
  config: { baseUrl: string; agentId: string; token: string; }
  custom?: boolean
}

export interface IAgentFlowPresenter {
  setAgents(agents: AGENT_CONFIG[]): void
  getAgents(): AGENT_CONFIG[]
  getAgentById(id: string): AGENT_CONFIG
  getAgentInstance(agentId: string): BaseAgentProvider
  getModelList(agentId: string): Promise<MODEL_META[]>
  check(agentId: string): Promise<{ isOk: boolean; errorMsg: string | null }>
  startAgentCompletion(
    agentId: string,
    messages: ChatMessage[],
    modelId: string,
    modelConfig: ModelConfig,
    temperature?: number,
    maxTokens?: number
  ): AsyncGenerator<LLMCoreStreamEvent>
}

export class AgentFlowPresenter implements IAgentFlowPresenter {
  private agents: Map<string, AGENT_CONFIG> = new Map()
  private agentInstances: Map<string, BaseAgentProvider> = new Map()
  private configPresenter: ConfigPresenter

  constructor(configPresenter: ConfigPresenter) {
    this.configPresenter = configPresenter
    this.init()

    // 监听代理更新事件
    eventBus.on(CONFIG_EVENTS.PROXY_RESOLVED, () => {
      // 遍历所有活跃的 Agent provider 实例，调用 onProxyResolved
      for (const provider of this.agentInstances.values()) {
        provider.onProxyResolved()
      }
    })
  }

  private init() {
    console.log('Initializing Agent Flow Presenter')
  }

  private createAgentInstance(agent: AGENT_CONFIG): BaseAgentProvider | undefined {
    try {
      console.log(`Creating Agent provider instance: ${agent.id} (${agent.type})`)

      switch (agent.type) {
        case 'datlas':
          return new DatlasProvider(agent, this.configPresenter)
        default:
          console.warn(`Unknown Agent provider type: ${agent.type}`)
          return undefined
      }
    } catch (error) {
      console.error(`Failed to create Agent provider instance for ${agent.id}:`, error)
      return undefined
    }
  }

  setAgents(agents: AGENT_CONFIG[]): void {
    this.agents.clear()

    agents.forEach((agent) => {
      this.agents.set(agent.id, agent)
    })

    this.agentInstances.clear()
    const enabledAgents = Array.from(this.agents.values()).filter(
      (agent) => agent.enabled
    )

    // Initialize agent instances sequentially to avoid race conditions
    for (const agent of enabledAgents) {
      try {
        console.log(`Initializing Agent provider instance: ${agent.id}`)
        this.getAgentInstance(agent.id)
      } catch (error) {
        console.error(`Failed to initialize Agent provider ${agent.id}:`, error)
      }
    }
  }

  getAgents(): AGENT_CONFIG[] {
    return Array.from(this.agents.values())
  }

  getAgentById(id: string): AGENT_CONFIG {
    const agent = this.agents.get(id)
    if (!agent) {
      throw new Error(`Agent ${id} not found`)
    }
    return agent
  }

  getAgentInstance(agentId: string): BaseAgentProvider {
    let instance = this.agentInstances.get(agentId)
    if (!instance) {
      const agent = this.getAgentById(agentId)
      instance = this.createAgentInstance(agent)
      if (!instance) {
        throw new Error(`Failed to create Agent provider instance for ${agentId}`)
      }
      this.agentInstances.set(agentId, instance)
    }
    return instance
  }

  async getModelList(agentId: string): Promise<MODEL_META[]> {
    const provider = this.getAgentInstance(agentId)
    let models = await provider.fetchModels()

    models = models.map((model) => {
      const config = this.configPresenter.getModelConfig(model.id, agentId)
      if (config) {
        model.maxTokens = config.maxTokens
        model.contextLength = config.contextLength
        model.vision = model.vision !== undefined ? model.vision : config.vision || false
        model.functionCall = model.functionCall !== undefined ? model.functionCall : config.functionCall || false
        model.reasoning = model.reasoning !== undefined ? model.reasoning : config.reasoning || false
      } else {
        // 确保模型具有这些属性，如果没有配置，默认为false
        model.vision = model.vision || false
        model.functionCall = model.functionCall || false
        model.reasoning = model.reasoning || false
      }
      return model
    })

    return models
  }

  async check(agentId: string): Promise<{ isOk: boolean; errorMsg: string | null }> {
    try {
      const provider = this.getAgentInstance(agentId)
      return await provider.check()
    } catch (error) {
      return {
        isOk: false,
        errorMsg: error instanceof Error ? error.message : 'Unknown error'
      }
    }
  }

  async *startAgentCompletion(
    agentId: string,
    messages: ChatMessage[],
    modelId: string,
    modelConfig: ModelConfig,
    temperature: number = 0.7,
    maxTokens: number = 4096
  ): AsyncGenerator<LLMCoreStreamEvent> {
    const provider = this.getAgentInstance(agentId)

    // Agent不使用工具，传入空数组
    const tools: MCPToolDefinition[] = []

    // 直接委托给Agent provider的coreStream方法
    yield* provider.coreStream(messages, modelId, modelConfig, temperature, maxTokens, tools)
  }
}
