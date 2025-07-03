import {
  LLM_PROVIDER,
  MODEL_META,
  LLMCoreStreamEvent,
  ModelConfig,
  MCPToolDefinition,
  ChatMessage
} from '@shared/presenter'
import { BaseRagProvider } from '../llmProviderPresenter/baseRagProvider'
import { ConfigPresenter } from '../configPresenter'
import { DatlasProvider } from '../llmProviderPresenter/providers/datlasProvider'
import { eventBus } from '@/eventbus'
import { CONFIG_EVENTS } from '@/events'

export interface IRagProviderPresenter {
  setProviders(providers: LLM_PROVIDER[]): void
  getProviders(): LLM_PROVIDER[]
  getProviderById(id: string): LLM_PROVIDER
  getProviderInstance(providerId: string): BaseRagProvider
  getModelList(providerId: string): Promise<MODEL_META[]>
  check(providerId: string): Promise<{ isOk: boolean; errorMsg: string | null }>
  startRagCompletion(
    providerId: string,
    messages: ChatMessage[],
    modelId: string,
    modelConfig: ModelConfig,
    temperature?: number,
    maxTokens?: number
  ): AsyncGenerator<LLMCoreStreamEvent>
}

export class RagProviderPresenter implements IRagProviderPresenter {
  private providers: Map<string, LLM_PROVIDER> = new Map()
  private providerInstances: Map<string, BaseRagProvider> = new Map()
  private configPresenter: ConfigPresenter

  constructor(configPresenter: ConfigPresenter) {
    this.configPresenter = configPresenter
    this.init()

    // 监听代理更新事件
    eventBus.on(CONFIG_EVENTS.PROXY_RESOLVED, () => {
      // 遍历所有活跃的 RAG provider 实例，调用 onProxyResolved
      for (const provider of this.providerInstances.values()) {
        provider.onProxyResolved()
      }
    })
  }

  private init() {
    console.log('Initializing RAG Provider Presenter')
  }

  private createProviderInstance(provider: LLM_PROVIDER): BaseRagProvider | undefined {
    try {
      console.log(`Creating RAG provider instance: ${provider.id} (${provider.apiType})`)

      switch (provider.apiType) {
        case 'rag':
          return new DatlasProvider(provider, this.configPresenter)
        default:
          console.warn(`Unknown RAG provider type: ${provider.apiType}`)
          return undefined
      }
    } catch (error) {
      console.error(`Failed to create RAG provider instance for ${provider.id}:`, error)
      return undefined
    }
  }

  setProviders(providers: LLM_PROVIDER[]): void {
    this.providers.clear()

    // 只处理RAG类型的providers
    const ragProviders = providers.filter(provider => provider.apiType === 'rag')

    ragProviders.forEach((provider) => {
      this.providers.set(provider.id, provider)
    })

    this.providerInstances.clear()
    const enabledProviders = Array.from(this.providers.values()).filter(
      (provider) => provider.enable
    )

    // Initialize provider instances sequentially to avoid race conditions
    for (const provider of enabledProviders) {
      try {
        console.log(`Initializing RAG provider instance: ${provider.id}`)
        this.getProviderInstance(provider.id)
      } catch (error) {
        console.error(`Failed to initialize RAG provider ${provider.id}:`, error)
      }
    }
  }

  getProviders(): LLM_PROVIDER[] {
    return Array.from(this.providers.values())
  }

  getProviderById(id: string): LLM_PROVIDER {
    const provider = this.providers.get(id)
    if (!provider) {
      throw new Error(`RAG Provider ${id} not found`)
    }
    return provider
  }

  getProviderInstance(providerId: string): BaseRagProvider {
    let instance = this.providerInstances.get(providerId)
    if (!instance) {
      const provider = this.getProviderById(providerId)
      instance = this.createProviderInstance(provider)
      if (!instance) {
        throw new Error(`Failed to create RAG provider instance for ${providerId}`)
      }
      this.providerInstances.set(providerId, instance)
    }
    return instance
  }

  async getModelList(providerId: string): Promise<MODEL_META[]> {
    const provider = this.getProviderInstance(providerId)
    let models = await provider.fetchModels()

    models = models.map((model) => {
      const config = this.configPresenter.getModelConfig(model.id, providerId)
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

  async check(providerId: string): Promise<{ isOk: boolean; errorMsg: string | null }> {
    try {
      const provider = this.getProviderInstance(providerId)
      return await provider.check()
    } catch (error) {
      return {
        isOk: false,
        errorMsg: error instanceof Error ? error.message : 'Unknown error'
      }
    }
  }

  async *startRagCompletion(
    providerId: string,
    messages: ChatMessage[],
    modelId: string,
    modelConfig: ModelConfig,
    temperature: number = 0.7,
    maxTokens: number = 4096
  ): AsyncGenerator<LLMCoreStreamEvent> {
    const provider = this.getProviderInstance(providerId)

    // RAG不使用工具，传入空数组
    const tools: MCPToolDefinition[] = []

    // 直接委托给RAG provider的coreStream方法
    yield* provider.coreStream(messages, modelId, modelConfig, temperature, maxTokens, tools)
  }
}
