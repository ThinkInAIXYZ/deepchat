import type { ProviderSettingsPort } from '@/provider/settings'
import type { LLM_PROVIDER, MODEL_META } from '@shared/types/provider'
import { BaseLLMProvider } from '../baseProvider'
import type { ProviderLocalePort } from '../ports'
import { createProviderHttpErrorFromResponse } from '../providerFailure'

const DEFAULT_BASE_URL = 'https://dev.voice.ai'

type VoiceStatusResponse = {
  voice_id: string
  name?: string | null
  status?: string
  voice_visibility?: string | null
}

export class VoiceAIProvider extends BaseLLMProvider {
  constructor(
    provider: LLM_PROVIDER,
    providerSettings: ProviderSettingsPort,
    locale: ProviderLocalePort
  ) {
    super(provider, providerSettings, locale)
    this.init()
  }

  public onProxyResolved(): void {}

  public async check(): Promise<{ isOk: boolean; errorMsg: string | null }> {
    if (!this.provider.apiKey) {
      return { isOk: false, errorMsg: 'API key is required' }
    }

    try {
      await this.listVoices()
      return { isOk: true, errorMsg: null }
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error)
      return { isOk: false, errorMsg: message }
    }
  }

  protected async fetchProviderModels(): Promise<MODEL_META[]> {
    if (!this.provider.apiKey) return []

    try {
      const voices = await this.listVoices()
      const models: MODEL_META[] = voices.map((voice) => ({
        id: voice.voice_id,
        name: voice.name && voice.name.trim().length > 0 ? voice.name : voice.voice_id,
        group: 'default',
        providerId: this.provider.id,
        isCustom: false
      }))

      const defaultVoice: MODEL_META = {
        id: 'default',
        name: 'Default Voice',
        group: 'default',
        providerId: this.provider.id,
        isCustom: false
      }

      return [defaultVoice, ...models]
    } catch (error) {
      console.error('[VoiceAI] Failed to fetch voices:', error)
      return []
    }
  }

  private getBaseUrl(): string {
    const raw = this.provider.baseUrl?.trim()
    if (raw && raw.length > 0) {
      return raw.replace(/\/+$/, '')
    }
    return DEFAULT_BASE_URL
  }

  private buildUrl(path: string): string {
    const base = this.getBaseUrl()
    const normalizedPath = path.startsWith('/') ? path : `/${path}`
    return `${base}${normalizedPath}`
  }

  private getAuthHeaders(): Record<string, string> {
    if (!this.provider.apiKey) {
      throw new Error('API key is required')
    }

    return {
      Authorization: `Bearer ${this.provider.apiKey}`,
      'Content-Type': 'application/json',
      ...this.defaultHeaders
    }
  }

  private async listVoices(): Promise<VoiceStatusResponse[]> {
    const { signal, dispose } = this.createModelRequestSignal({
      timeout: this.getModelFetchTimeout()
    })
    try {
      const response = await this.fetchProvider(this.buildUrl('/api/v1/tts/voices'), {
        method: 'GET',
        headers: this.getAuthHeaders(),
        ...(signal ? { signal } : {})
      })

      if (!response.ok) {
        throw createProviderHttpErrorFromResponse(
          `Voice.ai list voices failed: ${response.status} ${response.statusText}`,
          response,
          'voiceai_voices_http_error'
        )
      }

      const data = await response.json()
      if (!Array.isArray(data)) return []
      return data as VoiceStatusResponse[]
    } finally {
      dispose()
    }
  }
}
