import { LLM_PROVIDER, LLMResponse, ChatMessage, IConfigPresenter } from '@shared/presenter'
import { OpenAICompatibleProvider } from './openAICompatibleProvider'
import { proxyConfig } from '@/presenter/proxyConfig'
import { ProxyAgent } from 'undici'
import OpenAI from 'openai'
import type { ProviderMcpRuntimePort } from '../runtimePorts'
import type { AiSdkRuntimeContext } from '../aiSdk'

export class AihubmixProvider extends OpenAICompatibleProvider {
  protected override getAiSdkRuntimeContext(): AiSdkRuntimeContext {
    const context = super.getAiSdkRuntimeContext()
    return {
      ...context,
      defaultHeaders: {
        ...context.defaultHeaders,
        'APP-Code': 'SMUE7630'
      }
    }
  }

  constructor(
    provider: LLM_PROVIDER,
    configPresenter: IConfigPresenter,
    mcpRuntime?: ProviderMcpRuntimePort
  ) {
    super(provider, configPresenter, mcpRuntime)
  }

  protected createOpenAIClient(): void {
    // Get proxy configuration
    const proxyUrl = proxyConfig.getProxyUrl()
    const fetchOptions: { dispatcher?: ProxyAgent } = {}

    if (proxyUrl) {
      console.log(`[Aihubmix Provider] Using proxy: ${proxyUrl}`)
      const proxyAgent = new ProxyAgent(proxyUrl)
      fetchOptions.dispatcher = proxyAgent
    }

    this.openai = new OpenAI({
      apiKey: this.provider.apiKey,
      baseURL: this.provider.baseUrl,
      defaultHeaders: {
        ...this.defaultHeaders,
        'APP-Code': 'SMUE7630'
      },
      fetchOptions
    })
  }

  async completions(
    messages: ChatMessage[],
    modelId: string,
    temperature?: number,
    maxTokens?: number
  ): Promise<LLMResponse> {
    return this.openAICompletion(messages, modelId, temperature, maxTokens)
  }

  async generateText(
    prompt: string,
    modelId: string,
    temperature?: number,
    maxTokens?: number
  ): Promise<LLMResponse> {
    return this.openAICompletion(
      [
        {
          role: 'user',
          content: prompt
        }
      ],
      modelId,
      temperature,
      maxTokens
    )
  }
}
