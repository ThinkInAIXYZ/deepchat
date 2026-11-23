import type { ProviderSettingsPort } from '@/provider/settings'
import type { LLM_PROVIDER, MODEL_META } from '@shared/types/provider'
import { getGitHubCopilotToken } from '../../provider/auth/githubCopilotDeviceFlow'
import { BaseLLMProvider } from '../baseProvider'
import type { ProviderLocalePort } from '../ports'

export class GithubCopilotProvider extends BaseLLMProvider {
  private copilotToken: string | null = null
  private tokenExpiresAt: number = 0

  constructor(
    provider: LLM_PROVIDER,
    providerSettings: ProviderSettingsPort,
    locale: ProviderLocalePort
  ) {
    super(provider, providerSettings, locale)
    this.init()
  }

  protected async init() {
    if (this.provider.enable) {
      this.isInitialized = true
    }
  }

  public onProxyResolved(): void {
    this.init()
  }

  public override updateConfig(provider: LLM_PROVIDER): void {
    super.updateConfig(provider)
    this.copilotToken = null
    this.tokenExpiresAt = 0
  }

  private async getCopilotToken(signal?: AbortSignal): Promise<string> {
    signal?.throwIfAborted()
    if (this.copilotToken && Date.now() < this.tokenExpiresAt) {
      return this.copilotToken
    }

    const provider = this.provider
    const data = await getGitHubCopilotToken(provider.apiKey, signal)
    signal?.throwIfAborted()
    if (this.provider.apiKey !== provider.apiKey) {
      throw new Error('GitHub Copilot configuration changed during token exchange. Please retry.')
    }
    if (this.provider === provider) {
      this.copilotToken = data.token
      this.tokenExpiresAt = data.expires_at * 1000
    }
    return data.token
  }

  protected async fetchProviderModels(): Promise<MODEL_META[]> {
    // Try to get models from publicdb first
    const dbModels = this.providerSettings.getDbProviderModels(this.provider.id)
    if (dbModels.length > 0) {
      // Convert RENDERER_MODEL_META to MODEL_META format
      return dbModels.map((m) => ({
        id: m.id,
        name: m.name,
        group: m.group,
        providerId: m.providerId,
        isCustom: m.isCustom
      }))
    }

    // Fallback to hardcoded models if publicdb doesn't have copilot models yet
    console.warn(
      `[GitHub Copilot] No models found in publicdb for provider ${this.provider.id}, using fallback models`
    )

    const models: MODEL_META[] = [
      {
        id: 'gpt-5',
        name: 'GPT-5',
        group: 'GitHub Copilot',
        providerId: this.provider.id,
        isCustom: false,
        contextLength: 128000,
        maxTokens: 8192,
        vision: true,
        functionCall: true,
        reasoning: false
      },
      {
        id: 'gpt-5-mini',
        name: 'GPT-5 mini',
        group: 'GitHub Copilot',
        providerId: this.provider.id,
        isCustom: false,
        contextLength: 128000,
        maxTokens: 16384,
        vision: true,
        functionCall: true,
        reasoning: false
      },
      {
        id: 'gpt-4.1',
        name: 'GPT-4.1',
        group: 'GitHub Copilot',
        providerId: this.provider.id,
        isCustom: false,
        contextLength: 64000,
        maxTokens: 4096,
        vision: true,
        functionCall: true,
        reasoning: false
      },
      {
        id: 'gpt-4o-2024-05-13',
        name: 'GPT-4o',
        group: 'GitHub Copilot',
        providerId: this.provider.id,
        isCustom: false,
        contextLength: 64000,
        maxTokens: 4096,
        vision: true,
        functionCall: true,
        reasoning: false
      },
      {
        id: 'gpt-4',
        name: 'GPT-4',
        group: 'GitHub Copilot',
        providerId: this.provider.id,
        isCustom: false,
        contextLength: 32768,
        maxTokens: 4096,
        vision: false,
        functionCall: true,
        reasoning: false
      },
      {
        id: 'gpt-3.5-turbo',
        name: 'GPT-3.5 Turbo',
        group: 'GitHub Copilot',
        providerId: this.provider.id,
        isCustom: false,
        contextLength: 12288,
        maxTokens: 4096,
        vision: false,
        functionCall: true,
        reasoning: false
      },
      {
        id: 'o1',
        name: 'o1',
        group: 'GitHub Copilot',
        providerId: this.provider.id,
        isCustom: false,
        contextLength: 20000,
        maxTokens: 32768,
        vision: false,
        functionCall: false,
        reasoning: true
      },
      {
        id: 'o3-mini',
        name: 'o3-mini',
        group: 'GitHub Copilot',
        providerId: this.provider.id,
        isCustom: false,
        contextLength: 64000,
        maxTokens: 65536,
        vision: false,
        functionCall: false,
        reasoning: true
      },
      {
        id: 'claude-sonnet-4',
        name: 'Claude Sonnet 4',
        group: 'GitHub Copilot',
        providerId: this.provider.id,
        isCustom: false,
        contextLength: 200000,
        maxTokens: 8192,
        vision: true,
        functionCall: true,
        reasoning: false
      },
      {
        id: 'claude-sonnet-4.5',
        name: 'Claude Sonnet 4.5',
        group: 'GitHub Copilot',
        providerId: this.provider.id,
        isCustom: false,
        contextLength: 200000,
        maxTokens: 8192,
        vision: true,
        functionCall: true,
        reasoning: false
      },
      {
        id: 'claude-3.5-sonnet',
        name: 'Claude Sonnet 3.5',
        group: 'GitHub Copilot',
        providerId: this.provider.id,
        isCustom: false,
        contextLength: 200000,
        maxTokens: 8192,
        vision: true,
        functionCall: true,
        reasoning: false
      },
      {
        id: 'claude-3.7-sonnet',
        name: 'Claude Sonnet 3.7',
        group: 'GitHub Copilot',
        providerId: this.provider.id,
        isCustom: false,
        contextLength: 90000,
        maxTokens: 8192,
        vision: true,
        functionCall: true,
        reasoning: false
      },
      {
        id: 'claude-3.7-sonnet-thought',
        name: 'Claude Sonnet 3.7 Thinking',
        group: 'GitHub Copilot',
        providerId: this.provider.id,
        isCustom: false,
        contextLength: 90000,
        maxTokens: 8192,
        vision: true,
        functionCall: true,
        reasoning: false
      },
      {
        id: 'gemini-2.5-pro',
        name: 'Gemini 2.5 Pro',
        group: 'GitHub Copilot',
        providerId: this.provider.id,
        isCustom: false,
        contextLength: 128000,
        maxTokens: 8192,
        vision: true,
        functionCall: true,
        reasoning: false
      },
      {
        id: 'gemini-2.0-flash-001',
        name: 'Gemini 2.0 Flash',
        group: 'GitHub Copilot',
        providerId: this.provider.id,
        isCustom: false,
        contextLength: 128000,
        maxTokens: 8192,
        vision: true,
        functionCall: true,
        reasoning: false
      }
    ]

    return models
  }

  async check(): Promise<{ isOk: boolean; errorMsg: string | null }> {
    try {
      await this.getCopilotToken()
      return { isOk: true, errorMsg: null }
    } catch (error) {
      return {
        isOk: false,
        errorMsg: error instanceof Error ? error.message : 'Unknown error'
      }
    }
  }
}
