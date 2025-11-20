import { ProviderBatchUpdate, ProviderChange } from '@shared/provider-operations'
import { IConfigPresenter, LLM_PROVIDER } from '@shared/presenter'
import { BaseLLMProvider } from '../baseProvider'
import { BaseAgentProvider } from '../baseAgentProvider'
import { OpenAIProvider } from '../providers/openAIProvider'
import { DeepseekProvider } from '../providers/deepseekProvider'
import { SiliconcloudProvider } from '../providers/siliconcloudProvider'
import { DashscopeProvider } from '../providers/dashscopeProvider'
import { OpenAICompatibleProvider } from '../providers/openAICompatibleProvider'
import { PPIOProvider } from '../providers/ppioProvider'
import { TokenFluxProvider } from '../providers/tokenfluxProvider'
import { GeminiProvider } from '../providers/geminiProvider'
import { GithubProvider } from '../providers/githubProvider'
import { GithubCopilotProvider } from '../providers/githubCopilotProvider'
import { OllamaProvider } from '../providers/ollamaProvider'
import { AnthropicProvider } from '../providers/anthropicProvider'
import { AwsBedrockProvider } from '../providers/awsBedrockProvider'
import { DoubaoProvider } from '../providers/doubaoProvider'
import { TogetherProvider } from '../providers/togetherProvider'
import { GrokProvider } from '../providers/grokProvider'
import { GroqProvider } from '../providers/groqProvider'
import { ZhipuProvider } from '../providers/zhipuProvider'
import { LMStudioProvider } from '../providers/lmstudioProvider'
import { OpenAIResponsesProvider } from '../providers/openAIResponsesProvider'
import { CherryInProvider } from '../providers/cherryInProvider'
import { OpenRouterProvider } from '../providers/openRouterProvider'
import { MinimaxProvider } from '../providers/minimaxProvider'
import { AihubmixProvider } from '../providers/aihubmixProvider'
import { _302AIProvider } from '../providers/_302AIProvider'
import { ModelscopeProvider } from '../providers/modelscopeProvider'
import { AcpProvider } from '../providers/acpProvider'
import { VercelAIGatewayProvider } from '../providers/vercelAIGatewayProvider'
import { PoeProvider } from '../providers/poeProvider'
import { JiekouProvider } from '../providers/jiekouProvider'
import { ZenmuxProvider } from '../providers/zenmuxProvider'
import { RateLimitManager } from './rateLimitManager'
import { StreamState } from '../types'
import { AcpSessionPersistence } from '../agent/acpSessionPersistence'

type ProviderConstructor = new (
  provider: LLM_PROVIDER,
  configPresenter: IConfigPresenter,
  ...rest: any[]
) => BaseLLMProvider

interface ProviderInstanceManagerOptions {
  configPresenter: IConfigPresenter
  activeStreams: Map<string, StreamState>
  rateLimitManager: RateLimitManager
  getCurrentProviderId: () => string | null
  setCurrentProviderId: (providerId: string | null) => void
  acpSessionPersistence?: AcpSessionPersistence
}

export class ProviderInstanceManager {
  private static readonly PROVIDER_ID_MAP = ProviderInstanceManager.buildProviderIdMap()
  private static readonly PROVIDER_TYPE_MAP = ProviderInstanceManager.buildProviderTypeMap()

  private readonly providers: Map<string, LLM_PROVIDER> = new Map()
  private readonly providerInstances: Map<string, BaseLLMProvider> = new Map()

  constructor(private readonly options: ProviderInstanceManagerOptions) {}

  private static buildProviderIdMap(): Map<string, ProviderConstructor> {
    return new Map<string, ProviderConstructor>([
      ['302ai', _302AIProvider],
      ['minimax', MinimaxProvider],
      ['grok', GrokProvider],
      ['openrouter', OpenRouterProvider],
      ['ppio', PPIOProvider],
      ['tokenflux', TokenFluxProvider],
      ['deepseek', DeepseekProvider],
      ['aihubmix', AihubmixProvider],
      ['modelscope', ModelscopeProvider],
      ['silicon', SiliconcloudProvider],
      ['siliconcloud', SiliconcloudProvider],
      ['dashscope', DashscopeProvider],
      ['gemini', GeminiProvider],
      ['zhipu', ZhipuProvider],
      ['github', GithubProvider],
      ['github-copilot', GithubCopilotProvider],
      ['ollama', OllamaProvider],
      ['anthropic', AnthropicProvider],
      ['doubao', DoubaoProvider],
      ['openai', OpenAIProvider],
      ['openai-responses', OpenAIResponsesProvider],
      ['cherryin', CherryInProvider],
      ['lmstudio', LMStudioProvider],
      ['together', TogetherProvider],
      ['groq', GroqProvider],
      ['vercel-ai-gateway', VercelAIGatewayProvider],
      ['poe', PoeProvider],
      ['aws-bedrock', AwsBedrockProvider],
      ['jiekou', JiekouProvider],
      ['zenmux', ZenmuxProvider],
      ['acp', AcpProvider]
    ])
  }

  private static buildProviderTypeMap(): Map<string, ProviderConstructor> {
    return new Map<string, ProviderConstructor>([
      ['minimax', OpenAIProvider],
      ['deepseek', DeepseekProvider],
      ['silicon', SiliconcloudProvider],
      ['siliconcloud', SiliconcloudProvider],
      ['dashscope', DashscopeProvider],
      ['ppio', PPIOProvider],
      ['gemini', GeminiProvider],
      ['zhipu', ZhipuProvider],
      ['github', GithubProvider],
      ['github-copilot', GithubCopilotProvider],
      ['ollama', OllamaProvider],
      ['anthropic', AnthropicProvider],
      ['doubao', DoubaoProvider],
      ['openai', OpenAIProvider],
      ['openai-compatible', OpenAICompatibleProvider],
      ['openai-responses', OpenAIResponsesProvider],
      ['lmstudio', LMStudioProvider],
      ['together', TogetherProvider],
      ['groq', GroqProvider],
      ['grok', GrokProvider],
      ['vercel-ai-gateway', VercelAIGatewayProvider],
      ['poe', PoeProvider],
      ['aws-bedrock', AwsBedrockProvider],
      ['jiekou', JiekouProvider],
      ['zenmux', ZenmuxProvider],
      ['acp', AcpProvider]
    ])
  }

  private static isAgentConstructor(ctor?: ProviderConstructor): boolean {
    if (!ctor) return false
    return BaseAgentProvider.prototype.isPrototypeOf(ctor.prototype)
  }

  init(): void {
    const providers = this.options.configPresenter.getProviders()
    for (const provider of providers) {
      this.providers.set(provider.id, provider)
      if (provider.enable) {
        try {
          console.log('init provider', provider.id, provider.apiType)
          const instance = this.createProviderInstance(provider)
          if (instance) {
            this.providerInstances.set(provider.id, instance)
          }
        } catch (error) {
          console.error(`Failed to initialize provider ${provider.id}:`, error)
        }
      }
    }
  }

  setProviders(providers: LLM_PROVIDER[]): void {
    this.providers.clear()
    providers.forEach((provider) => {
      this.providers.set(provider.id, provider)
    })
    this.providerInstances.clear()
    const enabledProviders = Array.from(this.providers.values()).filter(
      (provider) => provider.enable
    )
    this.onProvidersUpdated(providers)

    for (const provider of enabledProviders) {
      try {
        console.log(`Initializing provider instance: ${provider.id}`)
        this.getProviderInstance(provider.id)
      } catch (error) {
        console.error(`Failed to initialize provider ${provider.id}:`, error)
      }
    }

    const currentProviderId = this.options.getCurrentProviderId()
    if (currentProviderId && !providers.find((p) => p.id === currentProviderId)) {
      this.options.setCurrentProviderId(null)
    }
  }

  handleProviderBatchUpdate(batchUpdate: ProviderBatchUpdate): void {
    console.log(`Handling batch provider update with ${batchUpdate.changes.length} changes`)

    this.providers.clear()
    batchUpdate.providers.forEach((provider) => {
      this.providers.set(provider.id, provider)
    })

    for (const change of batchUpdate.changes) {
      this.handleProviderAtomicUpdate(change)
    }

    this.onProvidersUpdated(batchUpdate.providers)
  }

  handleProviderAtomicUpdate(change: ProviderChange): void {
    switch (change.operation) {
      case 'add':
        this.handleProviderAdd(change)
        break
      case 'remove':
        this.handleProviderRemove(change)
        break
      case 'update':
        this.handleProviderUpdate(change)
        break
      case 'reorder':
        this.handleProviderReorder(change)
        break
    }
  }

  handleProxyResolved(): void {
    for (const provider of this.providerInstances.values()) {
      provider.onProxyResolved()
    }
  }

  getProviders(): LLM_PROVIDER[] {
    return Array.from(this.providers.values())
  }

  getProviderById(id: string): LLM_PROVIDER {
    const provider = this.providers.get(id)
    if (!provider) {
      throw new Error(`Provider ${id} not found`)
    }
    return provider
  }

  getProviderInstance(providerId: string): BaseLLMProvider {
    let instance = this.providerInstances.get(providerId)
    if (!instance) {
      const provider = this.getProviderById(providerId)
      instance = this.createProviderInstance(provider)
      if (!instance) {
        throw new Error(`Failed to create provider instance for ${providerId}`)
      }
      this.providerInstances.set(providerId, instance)
    }
    return instance
  }

  isAgentProvider(providerId: string): boolean {
    const instance = this.providerInstances.get(providerId)
    if (instance) {
      return instance instanceof BaseAgentProvider
    }

    const provider = this.providers.get(providerId)
    if (!provider) {
      return false
    }

    const ProviderClass =
      ProviderInstanceManager.PROVIDER_ID_MAP.get(provider.id) ??
      ProviderInstanceManager.PROVIDER_TYPE_MAP.get(provider.apiType)

    return ProviderInstanceManager.isAgentConstructor(ProviderClass)
  }

  private handleProviderAdd(change: ProviderChange): void {
    if (!change.provider) return

    this.providers.set(change.providerId, change.provider)

    if (change.provider.enable && change.requiresRebuild) {
      try {
        console.log(`Creating new provider instance: ${change.providerId}`)
        this.getProviderInstance(change.providerId)
      } catch (error) {
        console.error(`Failed to create provider instance ${change.providerId}:`, error)
      }
    }
  }

  private handleProviderRemove(change: ProviderChange): void {
    this.providers.delete(change.providerId)

    if (change.requiresRebuild) {
      this.cleanupProviderInstance(change.providerId)
    }
  }

  private handleProviderUpdate(change: ProviderChange): void {
    if (!change.updates) return

    const currentProvider = this.providers.get(change.providerId)
    if (!currentProvider) return

    const updatedProvider = { ...currentProvider, ...change.updates }
    this.providers.set(change.providerId, updatedProvider)

    const wasEnabled = currentProvider.enable
    const isEnabled = updatedProvider.enable
    const enableStatusChanged = 'enable' in change.updates && wasEnabled !== isEnabled

    if (change.requiresRebuild) {
      console.log(`Rebuilding provider instance: ${change.providerId}`)
      this.providerInstances.delete(change.providerId)

      if (updatedProvider.enable) {
        try {
          const instance = this.getProviderInstance(change.providerId)
          // For ACP provider, trigger model loading when enabled
          if (change.providerId === 'acp' && instance && 'handleEnableStateChange' in instance) {
            console.log(`[ACP] Provider rebuilt and enabled, triggering model loading`)
            void (instance as any).handleEnableStateChange()
          }
        } catch (error) {
          console.error(`Failed to rebuild provider instance ${change.providerId}:`, error)
        }
      } else if (enableStatusChanged && !isEnabled) {
        console.log(`Provider ${change.providerId} disabled, cleaning up instance`)
        this.cleanupProviderInstance(change.providerId)
      }
    } else {
      if (enableStatusChanged) {
        if (!isEnabled) {
          console.log(`Provider ${change.providerId} disabled, cleaning up instance`)
          this.cleanupProviderInstance(change.providerId)
        } else {
          try {
            console.log(`Provider ${change.providerId} enabled, creating instance`)
            const instance = this.getProviderInstance(change.providerId)
            // For ACP provider, trigger model loading when enabled
            if (change.providerId === 'acp' && instance && 'handleEnableStateChange' in instance) {
              console.log(`[ACP] Provider enabled, triggering model loading`)
              void (instance as any).handleEnableStateChange()
            }
          } catch (error) {
            console.error(`Failed to create provider instance ${change.providerId}:`, error)
          }
        }
      } else {
        const instance = this.providerInstances.get(change.providerId)
        if (instance && 'updateConfig' in instance) {
          try {
            ;(instance as any).updateConfig(updatedProvider)
          } catch (error) {
            console.error(`Failed to update provider config ${change.providerId}:`, error)
          }
        }
      }
    }
  }

  private handleProviderReorder(_change: ProviderChange): void {
    console.log(`Provider reorder completed, no instance rebuild required`)
  }

  private cleanupProviderInstance(providerId: string): void {
    const activeStreamsToStop = Array.from(this.options.activeStreams.entries()).filter(
      ([, streamState]) => streamState.providerId === providerId
    )

    for (const [eventId, streamState] of activeStreamsToStop) {
      console.log(`Stopping active stream for disabled provider ${providerId}: ${eventId}`)
      try {
        streamState.abortController.abort()
      } catch (error) {
        console.error(`Failed to abort stream ${eventId}:`, error)
      }
      this.options.activeStreams.delete(eventId)
    }

    const instance = this.providerInstances.get(providerId)
    if (instance) {
      console.log(`Removing provider instance: ${providerId}`)
      this.providerInstances.delete(providerId)

      if ('cleanup' in instance && typeof (instance as any).cleanup === 'function') {
        try {
          ;(instance as any).cleanup()
        } catch (error) {
          console.error(`Failed to cleanup provider instance ${providerId}:`, error)
        }
      }
    }

    this.options.rateLimitManager.cleanupProviderRateLimit(providerId)

    const currentProviderId = this.options.getCurrentProviderId()
    if (currentProviderId === providerId) {
      console.log(`Clearing current provider as it was disabled: ${providerId}`)
      this.options.setCurrentProviderId(null)
    }
  }

  private onProvidersUpdated(providers: LLM_PROVIDER[]): void {
    this.options.rateLimitManager.syncProviders(providers)
  }

  /**
   * Creates a provider instance while preserving backward compatibility.
   * Lookup order MUST remain id -> apiType so that legacy configs lacking ids continue to work.
   */
  private createProviderInstance(provider: LLM_PROVIDER): BaseLLMProvider | undefined {
    try {
      let ProviderClass = ProviderInstanceManager.PROVIDER_ID_MAP.get(provider.id)

      if (!ProviderClass) {
        ProviderClass = ProviderInstanceManager.PROVIDER_TYPE_MAP.get(provider.apiType)
        if (ProviderClass) {
          console.log(
            `No specific provider found for id: ${provider.id}, falling back to apiType: ${provider.apiType}`
          )
        }
      }

      if (!ProviderClass) {
        console.warn(`Unknown provider type: ${provider.apiType} for provider id: ${provider.id}`)
        return undefined
      }

      if (provider.id === 'acp') {
        if (!this.options.acpSessionPersistence) {
          throw new Error('ACP session persistence is not configured')
        }
        return new AcpProvider(
          provider,
          this.options.configPresenter,
          this.options.acpSessionPersistence
        )
      }

      return new ProviderClass(provider, this.options.configPresenter)
    } catch (error) {
      console.error(`Failed to create provider instance for ${provider.id}:`, error)
      return undefined
    }
  }
}
