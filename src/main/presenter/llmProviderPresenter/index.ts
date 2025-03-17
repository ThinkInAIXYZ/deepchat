import {
  ILlmProviderPresenter,
  LLM_PROVIDER,
  LLMResponse,
  MODEL_META,
  OllamaModel
} from '@shared/presenter'
import { BaseLLMProvider, ChatMessage } from './baseProvider'
import { OpenAIProvider } from './providers/openAIProvider'
import { DeepseekProvider } from './providers/deepseekProvider'
import { SiliconcloudProvider } from './providers/siliconcloudProvider'
import { eventBus } from '@/eventbus'
import { OpenAICompatibleProvider } from './providers/openAICompatibleProvider'
import { PPIOProvider } from './providers/ppioProvider'
import { getModelConfig } from './modelConfigs'
import { OLLAMA_EVENTS, STREAM_EVENTS } from '@/events'
import { ConfigPresenter } from '../configPresenter'
import { GeminiProvider } from './providers/geminiProvider'
import { GithubProvider } from './providers/githubProvider'
import { OllamaProvider } from './providers/ollamaProvider'
import { AnthropicProvider } from './providers/anthropicProvider'
import { ShowResponse } from 'ollama'
// 导入其他provider...

// 流的状态
interface StreamState {
  isGenerating: boolean
  providerId: string
  modelId: string
  abortController: AbortController
  provider: BaseLLMProvider
}

// 配置项
interface ProviderConfig {
  maxConcurrentStreams: number
}

export class LLMProviderPresenter implements ILlmProviderPresenter {
  private providers: Map<string, LLM_PROVIDER> = new Map()
  private providerInstances: Map<string, BaseLLMProvider> = new Map()
  private currentProviderId: string | null = null
  // 通过 eventId 管理所有的 stream
  private activeStreams: Map<string, StreamState> = new Map()
  // 配置
  private config: ProviderConfig = {
    maxConcurrentStreams: 10
  }
  private configPresenter: ConfigPresenter

  constructor(configPresenter: ConfigPresenter) {
    this.configPresenter = configPresenter
    this.init()
  }

  private init() {
    const providers = this.configPresenter.getProviders()
    for (const provider of providers) {
      this.providers.set(provider.id, provider)
      if (provider.enable) {
        try {
          let instance: BaseLLMProvider
          if (provider.apiType === 'openai') {
            instance = new OpenAIProvider(provider, this.configPresenter)
          } else if (provider.apiType === 'deepseek') {
            instance = new DeepseekProvider(provider, this.configPresenter)
          } else if (provider.apiType === 'siliconcloud') {
            instance = new SiliconcloudProvider(provider, this.configPresenter)
          } else if (provider.apiType === 'openai-compatible') {
            instance = new OpenAICompatibleProvider(provider, this.configPresenter)
          } else if (provider.apiType === 'ppio') {
            instance = new PPIOProvider(provider, this.configPresenter)
          } else if (provider.apiType === 'gemini') {
            instance = new GeminiProvider(provider, this.configPresenter)
          } else if (provider.apiType === 'github') {
            instance = new GithubProvider(provider, this.configPresenter)
          } else if (provider.apiType === 'ollama') {
            instance = new OllamaProvider(provider, this.configPresenter)
          } else if (provider.apiType === 'anthropic') {
            instance = new AnthropicProvider(provider, this.configPresenter)
          } else {
            console.warn(`Unknown provider type: ${provider.apiType}`)
            continue
          }
          this.providerInstances.set(provider.id, instance)
        } catch (error) {
          console.error(`Failed to initialize provider ${provider.id}:`, error)
        }
      }
    }
  }

  getProviders(): LLM_PROVIDER[] {
    return Array.from(this.providers.values())
  }

  getCurrentProvider(): LLM_PROVIDER | null {
    return this.currentProviderId ? this.providers.get(this.currentProviderId) || null : null
  }

  getProviderById(id: string): LLM_PROVIDER {
    const provider = this.providers.get(id)
    if (!provider) {
      throw new Error(`Provider ${id} not found`)
    }
    return provider
  }

  async setCurrentProvider(providerId: string): Promise<void> {
    // 如果有正在生成的流，先停止它们
    await this.stopAllStreams()

    const provider = this.getProviderById(providerId)
    if (!provider) {
      throw new Error(`Provider ${providerId} not found`)
    }

    this.currentProviderId = providerId
    // 确保新的 provider 实例已经初始化
    this.getProviderInstance(providerId)
  }

  setProviders(providers: LLM_PROVIDER[]): void {
    // 如果有正在生成的流，先停止它们
    this.stopAllStreams()

    this.providers.clear()
    providers.forEach((provider) => {
      this.providers.set(provider.id, provider)
    })
    this.providerInstances.clear()
    const enabledProviders = Array.from(this.providers.values()).filter(
      (provider) => provider.enable
    )
    for (const provider of enabledProviders) {
      this.getProviderInstance(provider.id)
    }

    // 如果当前 provider 不在新的列表中，清除当前 provider
    if (this.currentProviderId && !providers.find((p) => p.id === this.currentProviderId)) {
      this.currentProviderId = null
    }
  }

  private getProviderInstance(providerId: string): BaseLLMProvider {
    let instance = this.providerInstances.get(providerId)
    if (!instance) {
      const provider = this.getProviderById(providerId)
      switch (provider.id) {
        case 'openai':
          instance = new OpenAIProvider(provider, this.configPresenter)
          break
        case 'deepseek':
          instance = new DeepseekProvider(provider, this.configPresenter)
          break
        case 'silicon':
          instance = new SiliconcloudProvider(provider, this.configPresenter)
          break
        case 'ppio':
          instance = new PPIOProvider(provider, this.configPresenter)
          break
        case 'gemini':
          instance = new GeminiProvider(provider, this.configPresenter)
          break
        case 'github':
          instance = new GithubProvider(provider, this.configPresenter)
          break
        // 添加其他provider的实例化逻辑
        case 'ollama':
          instance = new OllamaProvider(provider, this.configPresenter)
          break
        case 'anthropic':
          instance = new AnthropicProvider(provider, this.configPresenter)
          break
        default:
          instance = new OpenAICompatibleProvider(provider, this.configPresenter)
          break
      }
      this.providerInstances.set(providerId, instance)
    }
    return instance
  }

  async getModelList(providerId: string): Promise<MODEL_META[]> {
    const provider = this.getProviderInstance(providerId)
    let models = await provider.fetchModels()
    models = models.map((model) => {
      const config = getModelConfig(model.id)
      if (config) {
        model.maxTokens = config.maxTokens
        model.contextLength = config.contextLength
      }
      return model
    })
    return models
  }

  async updateModelStatus(providerId: string, modelId: string, enabled: boolean): Promise<void> {
    this.configPresenter.setModelStatus(providerId, modelId, enabled)
  }

  isGenerating(eventId: string): boolean {
    return this.activeStreams.has(eventId)
  }

  getStreamState(eventId: string): StreamState | null {
    return this.activeStreams.get(eventId) || null
  }

  async stopStream(eventId: string): Promise<void> {
    const stream = this.activeStreams.get(eventId)
    if (stream) {
      stream.abortController.abort()
      this.activeStreams.delete(eventId)
      eventBus.emit(STREAM_EVENTS.END, { eventId, userStop: true })
    }
  }

  private async stopAllStreams(): Promise<void> {
    const promises = Array.from(this.activeStreams.keys()).map((eventId) =>
      this.stopStream(eventId)
    )
    await Promise.all(promises)
  }

  private canStartNewStream(): boolean {
    return this.activeStreams.size < this.config.maxConcurrentStreams
  }

  private async handleStreamOperation(
    operation: () => Promise<void>,
    eventId: string,
    providerId: string,
    modelId: string
  ) {
    if (!this.canStartNewStream()) {
      throw new Error('已达到最大并发流数量限制')
    }

    if (this.activeStreams.has(eventId)) {
      throw new Error('该事件ID已存在正在生成的流')
    }

    const provider = this.getProviderInstance(providerId)
    const abortController = new AbortController()

    // 创建新的流状态
    const streamState: StreamState = {
      isGenerating: true,
      providerId,
      modelId,
      abortController,
      provider
    }

    this.activeStreams.set(eventId, streamState)

    try {
      await operation()
      eventBus.emit(STREAM_EVENTS.END, { eventId })
    } catch (error) {
      eventBus.emit(STREAM_EVENTS.ERROR, { error: String(error), eventId })
      throw error
    } finally {
      this.activeStreams.delete(eventId)
    }
  }

  async startStreamCompletion(
    providerId: string,
    messages: ChatMessage[],
    modelId: string,
    eventId: string,
    temperature?: number
  ): Promise<void> {
    if (!this.canStartNewStream()) {
      throw new Error('已达到最大并发流数量限制')
    }

    const provider = this.getProviderInstance(providerId)
    const abortController = new AbortController()

    this.activeStreams.set(eventId, {
      isGenerating: true,
      providerId,
      modelId,
      abortController,
      provider
    })

    try {
      // console.log(
      //   'startStreamCompletion',
      //   providerId,
      //   modelId,
      //   temperature,
      //   JSON.stringify(messages)
      // )
      const stream = provider.streamCompletions(messages, modelId, temperature)

      for await (const chunk of stream) {
        if (abortController.signal.aborted) {
          break
        }

        eventBus.emit(STREAM_EVENTS.RESPONSE, {
          eventId,
          ...chunk
        })
      }

      if (!abortController.signal.aborted) {
        eventBus.emit(STREAM_EVENTS.END, { eventId })
      }
    } catch (error) {
      console.error('Stream error:', error)
      eventBus.emit(STREAM_EVENTS.ERROR, {
        eventId,
        error: error instanceof Error ? error.message : String(error)
      })
    } finally {
      this.activeStreams.delete(eventId)
    }
  }

  async startStreamSummary(
    providerId: string,
    text: string,
    modelId: string,
    eventId: string,
    temperature?: number,
    maxTokens?: number
  ): Promise<void> {
    await this.handleStreamOperation(
      async () => {
        const stream = this.activeStreams.get(eventId)
        if (!stream) return

        const summaryStream = stream.provider.streamSummaries(text, modelId, temperature, maxTokens)

        for await (const response of summaryStream) {
          if (stream.abortController.signal.aborted) {
            break
          }
          eventBus.emit(STREAM_EVENTS.RESPONSE, {
            content: response.content,
            reasoning_content: response.reasoning_content,
            eventId
          })
        }
      },
      eventId,
      providerId,
      modelId
    )
  }

  async startStreamText(
    providerId: string,
    prompt: string,
    modelId: string,
    eventId: string,
    temperature?: number,
    maxTokens?: number
  ): Promise<void> {
    await this.handleStreamOperation(
      async () => {
        const stream = this.activeStreams.get(eventId)
        if (!stream) return

        const textStream = stream.provider.streamGenerateText(
          prompt,
          modelId,
          temperature,
          maxTokens
        )

        for await (const response of textStream) {
          if (stream.abortController.signal.aborted) {
            break
          }
          eventBus.emit(STREAM_EVENTS.RESPONSE, {
            content: response.content,
            reasoning_content: response.reasoning_content,
            eventId
          })
        }
      },
      eventId,
      providerId,
      modelId
    )
  }

  // 非流式方法
  async generateCompletion(
    providerId: string,
    messages: { role: 'system' | 'user' | 'assistant'; content: string }[],
    modelId: string,
    temperature?: number,
    maxTokens?: number
  ): Promise<string> {
    console.log('generateCompletion', providerId, modelId, temperature, maxTokens)
    const provider = this.getProviderInstance(providerId)
    const response = await provider.completions(messages, modelId, temperature, maxTokens)
    return response.content
  }

  async generateSummary(
    providerId: string,
    text: string,
    modelId: string,
    temperature?: number,
    maxTokens?: number
  ): Promise<LLMResponse> {
    const provider = this.getProviderInstance(providerId)
    return provider.summaries(text, modelId, temperature, maxTokens)
  }

  async generateText(
    providerId: string,
    prompt: string,
    modelId: string,
    temperature?: number,
    maxTokens?: number
  ): Promise<LLMResponse> {
    const provider = this.getProviderInstance(providerId)
    return provider.generateText(prompt, modelId, temperature, maxTokens)
  }

  async generateSuggestions(
    providerId: string,
    context: string,
    modelId: string,
    temperature?: number,
    maxTokens?: number
  ): Promise<string[]> {
    const provider = this.getProviderInstance(providerId)
    return provider.suggestions(context, modelId, temperature, maxTokens)
  }

  // 配置相关方法
  setMaxConcurrentStreams(max: number): void {
    this.config.maxConcurrentStreams = max
  }

  getMaxConcurrentStreams(): number {
    return this.config.maxConcurrentStreams
  }

  async check(providerId: string): Promise<{ isOk: boolean; errorMsg: string | null }> {
    const provider = this.getProviderInstance(providerId)
    return provider.check()
  }

  async addCustomModel(
    providerId: string,
    model: Omit<MODEL_META, 'providerId' | 'isCustom' | 'group'>
  ): Promise<MODEL_META> {
    const provider = this.getProviderInstance(providerId)
    return provider.addCustomModel(model)
  }

  async removeCustomModel(providerId: string, modelId: string): Promise<boolean> {
    const provider = this.getProviderInstance(providerId)
    return provider.removeCustomModel(modelId)
  }

  async updateCustomModel(
    providerId: string,
    modelId: string,
    updates: Partial<MODEL_META>
  ): Promise<boolean> {
    const provider = this.getProviderInstance(providerId)
    const res = provider.updateCustomModel(modelId, updates)
    this.configPresenter.updateCustomModel(providerId, modelId, updates)
    return res
  }

  async getCustomModels(providerId: string): Promise<MODEL_META[]> {
    const provider = this.getProviderInstance(providerId)
    return provider.getCustomModels()
  }

  async summaryTitles(
    messages: { role: 'system' | 'user' | 'assistant'; content: string }[],
    providerId: string,
    modelId: string
  ): Promise<string> {
    const provider = this.getProviderInstance(providerId)
    return provider.summaryTitles(messages, modelId)
  }

  // 获取 OllamaProvider 实例
  getOllamaProviderInstance(): OllamaProvider | null {
    // 从所有 provider 中找到已经启用的 ollama provider
    for (const provider of this.providers.values()) {
      if (provider.id === 'ollama' && provider.enable) {
        const providerInstance = this.providerInstances.get(provider.id)
        if (providerInstance instanceof OllamaProvider) {
          return providerInstance
        }
      }
    }
    return null
  }
  // ollama api
  listOllamaModels(): Promise<OllamaModel[]> {
    const provider = this.getOllamaProviderInstance()
    if (!provider) {
      console.error('Ollama provider not found')
      return Promise.resolve([])
    }
    return provider.listModels()
  }
  showOllamaModelInfo(modelName: string): Promise<ShowResponse> {
    const provider = this.getOllamaProviderInstance()
    if (!provider) {
      throw new Error('Ollama provider not found')
    }
    return provider.showModelInfo(modelName)
  }
  listOllamaRunningModels(): Promise<OllamaModel[]> {
    const provider = this.getOllamaProviderInstance()
    if (!provider) {
      console.error('Ollama provider not found')
      return Promise.resolve([])
    }
    return provider.listRunningModels()
  }
  pullOllamaModels(modelName: string): Promise<boolean> {
    const provider = this.getOllamaProviderInstance()
    if (!provider) {
      throw new Error('Ollama provider not found')
    }
    return provider.pullModel(modelName, (progress) => {
      console.log('pullOllamaModels', {
        eventId: 'pullOllamaModels',
        modelName: modelName,
        ...progress
      })
      eventBus.emit(OLLAMA_EVENTS.PULL_MODEL_PROGRESS, {
        eventId: 'pullOllamaModels',
        modelName: modelName,
        ...progress
      })
    })
  }
  deleteOllamaModel(modelName: string): Promise<boolean> {
    const provider = this.getOllamaProviderInstance()
    if (!provider) {
      throw new Error('Ollama provider not found')
    }
    return provider.deleteModel(modelName)
  }
}
