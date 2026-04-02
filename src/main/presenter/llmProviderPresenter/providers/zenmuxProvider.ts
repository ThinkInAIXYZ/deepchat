import Anthropic from '@anthropic-ai/sdk'
import {
  ChatMessage,
  IConfigPresenter,
  KeyStatus,
  LLM_EMBEDDING_ATTRS,
  LLM_PROVIDER,
  LLMResponse,
  LLMCoreStreamEvent,
  MCPToolDefinition,
  MODEL_META,
  ModelConfig
} from '@shared/presenter'
import { ProxyAgent } from 'undici'
import { BaseLLMProvider } from '../baseProvider'
import { proxyConfig } from '../../proxyConfig'
import { AnthropicProvider } from './anthropicProvider'
import { OpenAICompatibleProvider } from './openAICompatibleProvider'
import type { ProviderMcpRuntimePort } from '../runtimePorts'

const ZENMUX_ANTHROPIC_BASE_URL = 'https://zenmux.ai/api/anthropic'

class ZenmuxOpenAIDelegate extends OpenAICompatibleProvider {
  protected override async init() {
    this.isInitialized = true
  }

  public async fetchZenmuxModels(options?: { timeout: number }): Promise<MODEL_META[]> {
    return super.fetchOpenAIModels(options)
  }
}

class ZenmuxAnthropicDelegate extends AnthropicProvider {
  private clientInitialized = false

  protected override async init() {}

  public async ensureClientInitialized(): Promise<void> {
    const apiKey = this.provider.apiKey || process.env.ANTHROPIC_API_KEY || null
    if (!apiKey) {
      this.clientInitialized = false
      this.isInitialized = false
      return
    }

    const proxyUrl = proxyConfig.getProxyUrl()
    const fetchOptions: { dispatcher?: ProxyAgent } = {}

    if (proxyUrl) {
      const proxyAgent = new ProxyAgent(proxyUrl)
      fetchOptions.dispatcher = proxyAgent
    }

    const self = this as unknown as { anthropic?: Anthropic }
    self.anthropic = new Anthropic({
      apiKey,
      baseURL: this.provider.baseUrl || ZENMUX_ANTHROPIC_BASE_URL,
      defaultHeaders: this.defaultHeaders,
      fetchOptions
    })

    this.clientInitialized = true
    this.isInitialized = true
  }

  public isClientInitialized(): boolean {
    return this.clientInitialized
  }

  public override onProxyResolved(): void {
    void this.ensureClientInitialized()
  }
}

export class ZenmuxProvider extends BaseLLMProvider {
  private readonly openaiDelegate: ZenmuxOpenAIDelegate
  private readonly anthropicDelegate: ZenmuxAnthropicDelegate

  constructor(
    provider: LLM_PROVIDER,
    configPresenter: IConfigPresenter,
    mcpRuntime?: ProviderMcpRuntimePort
  ) {
    super(provider, configPresenter, mcpRuntime)

    this.openaiDelegate = new ZenmuxOpenAIDelegate(provider, configPresenter, mcpRuntime)
    this.anthropicDelegate = new ZenmuxAnthropicDelegate(
      {
        ...provider,
        apiType: 'anthropic',
        baseUrl: ZENMUX_ANTHROPIC_BASE_URL
      },
      configPresenter,
      mcpRuntime
    )

    this.init()
  }

  private isAnthropicModel(modelId: string): boolean {
    return modelId.trim().toLowerCase().startsWith('anthropic/')
  }

  private async ensureAnthropicDelegateReady(): Promise<ZenmuxAnthropicDelegate> {
    await this.anthropicDelegate.ensureClientInitialized()

    if (!this.anthropicDelegate.isClientInitialized()) {
      throw new Error('Anthropic SDK not initialized')
    }

    return this.anthropicDelegate
  }

  protected async fetchProviderModels(): Promise<MODEL_META[]> {
    const models = await this.openaiDelegate.fetchZenmuxModels()
    return models.map((model) => ({
      ...model,
      group: 'ZenMux'
    }))
  }

  public onProxyResolved(): void {
    this.openaiDelegate.onProxyResolved()

    if (this.anthropicDelegate.isClientInitialized()) {
      this.anthropicDelegate.onProxyResolved()
    }
  }

  public async check(): Promise<{ isOk: boolean; errorMsg: string | null }> {
    return this.openaiDelegate.check()
  }

  public async summaryTitles(messages: ChatMessage[], modelId: string): Promise<string> {
    if (this.isAnthropicModel(modelId)) {
      const delegate = await this.ensureAnthropicDelegateReady()
      return delegate.summaryTitles(messages, modelId)
    }

    return this.openaiDelegate.summaryTitles(messages, modelId)
  }

  public async completions(
    messages: ChatMessage[],
    modelId: string,
    temperature?: number,
    maxTokens?: number
  ): Promise<LLMResponse> {
    if (this.isAnthropicModel(modelId)) {
      const delegate = await this.ensureAnthropicDelegateReady()
      return delegate.completions(messages, modelId, temperature, maxTokens)
    }

    return this.openaiDelegate.completions(messages, modelId, temperature, maxTokens)
  }

  public async summaries(
    text: string,
    modelId: string,
    temperature?: number,
    maxTokens?: number
  ): Promise<LLMResponse> {
    if (this.isAnthropicModel(modelId)) {
      const delegate = await this.ensureAnthropicDelegateReady()
      return delegate.summaries(text, modelId, temperature, maxTokens)
    }

    return this.openaiDelegate.summaries(text, modelId, temperature, maxTokens)
  }

  public async generateText(
    prompt: string,
    modelId: string,
    temperature?: number,
    maxTokens?: number
  ): Promise<LLMResponse> {
    if (this.isAnthropicModel(modelId)) {
      const delegate = await this.ensureAnthropicDelegateReady()
      return delegate.generateText(prompt, modelId, temperature, maxTokens)
    }

    return this.openaiDelegate.generateText(prompt, modelId, temperature, maxTokens)
  }

  public async *coreStream(
    messages: ChatMessage[],
    modelId: string,
    modelConfig: ModelConfig,
    temperature: number,
    maxTokens: number,
    tools: MCPToolDefinition[]
  ): AsyncGenerator<LLMCoreStreamEvent> {
    if (this.isAnthropicModel(modelId)) {
      const delegate = await this.ensureAnthropicDelegateReady()
      yield* delegate.coreStream(messages, modelId, modelConfig, temperature, maxTokens, tools)
      return
    }

    yield* this.openaiDelegate.coreStream(
      messages,
      modelId,
      modelConfig,
      temperature,
      maxTokens,
      tools
    )
  }

  public async getEmbeddings(modelId: string, texts: string[]): Promise<number[][]> {
    if (this.isAnthropicModel(modelId)) {
      const delegate = await this.ensureAnthropicDelegateReady()
      return delegate.getEmbeddings(modelId, texts)
    }

    return this.openaiDelegate.getEmbeddings(modelId, texts)
  }

  public async getDimensions(modelId: string): Promise<LLM_EMBEDDING_ATTRS> {
    if (this.isAnthropicModel(modelId)) {
      const delegate = await this.ensureAnthropicDelegateReady()
      return delegate.getDimensions(modelId)
    }

    return this.openaiDelegate.getDimensions(modelId)
  }

  public async getKeyStatus(): Promise<KeyStatus | null> {
    return this.openaiDelegate.getKeyStatus()
  }
}
