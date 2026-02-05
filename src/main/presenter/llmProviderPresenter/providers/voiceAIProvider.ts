import {
  ChatMessage,
  IConfigPresenter,
  LLM_PROVIDER,
  LLMResponse,
  MODEL_META,
  LLMCoreStreamEvent,
  MCPToolDefinition,
  ModelConfig
} from '@shared/presenter'
import { createStreamEvent } from '@shared/types/core/llm-events'
import { BaseLLMProvider } from '../baseProvider'
import { proxyConfig } from '../../proxyConfig'
import { ProxyAgent } from 'undici'

const DEFAULT_BASE_URL = 'https://dev.voice.ai'
const DEFAULT_AUDIO_FORMAT = 'mp3'
const DEFAULT_TTS_MODEL = 'voiceai-tts-v1-latest'
const DEFAULT_LANGUAGE = 'en'
const DEFAULT_TEMPERATURE = 1
const DEFAULT_TOP_P = 0.8
const SUPPORTED_LANGUAGES = new Set([
  'en',
  'ca',
  'sv',
  'es',
  'fr',
  'de',
  'it',
  'pt',
  'pl',
  'ru',
  'nl'
])

const AUDIO_MIME_TYPE: Record<string, string> = {
  mp3: 'audio/mpeg',
  wav: 'audio/wav',
  pcm: 'audio/pcm'
}

type VoiceStatusResponse = {
  voice_id: string
  name?: string | null
  status?: string
  voice_visibility?: string | null
}

type VoiceAITtsConfig = {
  audioFormat: string
  model: string
  language: string
  temperature: number
  topP: number
}

export class VoiceAIProvider extends BaseLLMProvider {
  private proxyAgent?: ProxyAgent
  private proxyUrl?: string

  constructor(provider: LLM_PROVIDER, configPresenter: IConfigPresenter) {
    super(provider, configPresenter)
    this.init()
  }

  public onProxyResolved(): void {
    this.proxyAgent = undefined
    this.proxyUrl = undefined
  }

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

  public async summaryTitles(messages: ChatMessage[], _modelId: string): Promise<string> {
    const text = this.extractLatestUserText(messages)
    if (!text) return 'Voice AI'
    return this.buildShortTitle(text)
  }

  public async completions(
    messages: ChatMessage[],
    modelId: string,
    temperature?: number,
    _maxTokens?: number
  ): Promise<LLMResponse> {
    const text = this.extractLatestUserText(messages)
    if (!text) {
      throw new Error('No user text provided for Voice.ai TTS')
    }

    await this.generateSpeech(text, modelId, temperature)

    return {
      content: text
    }
  }

  public async summaries(
    text: string,
    modelId: string,
    temperature?: number,
    _maxTokens?: number
  ): Promise<LLMResponse> {
    if (!text) {
      throw new Error('No text provided for Voice.ai TTS')
    }

    await this.generateSpeech(text, modelId, temperature)

    return {
      content: this.buildShortTitle(text)
    }
  }

  public async generateText(
    prompt: string,
    modelId: string,
    temperature?: number,
    _maxTokens?: number
  ): Promise<LLMResponse> {
    if (!prompt) {
      throw new Error('No prompt provided for Voice.ai TTS')
    }

    await this.generateSpeech(prompt, modelId, temperature)

    return {
      content: prompt
    }
  }

  public async *coreStream(
    messages: ChatMessage[],
    modelId: string,
    _modelConfig: ModelConfig,
    temperature: number,
    _maxTokens: number,
    _mcpTools: MCPToolDefinition[]
  ): AsyncGenerator<LLMCoreStreamEvent> {
    const text = this.extractLatestUserText(messages)
    if (!text) {
      yield createStreamEvent.error('No user text provided for Voice.ai TTS')
      yield createStreamEvent.stop('error')
      return
    }

    try {
      const { audioBase64, mimeType } = await this.generateSpeech(text, modelId, temperature)

      yield createStreamEvent.imageData({
        data: audioBase64,
        mimeType
      })

      yield createStreamEvent.stop('complete')
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error)
      yield createStreamEvent.error(message)
      yield createStreamEvent.stop('error')
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
        isCustom: false,
        contextLength: 4096,
        maxTokens: 2048
      }))

      const defaultVoice: MODEL_META = {
        id: 'default',
        name: 'Default Voice',
        group: 'default',
        providerId: this.provider.id,
        isCustom: false,
        contextLength: 4096,
        maxTokens: 2048
      }

      return [defaultVoice, ...models]
    } catch (error) {
      console.error('[VoiceAI] Failed to fetch voices:', error)
      return []
    }
  }

  private getFetchOptions(): { dispatcher?: ProxyAgent } {
    const proxyUrl = proxyConfig.getProxyUrl()
    if (!proxyUrl) return {}
    if (this.proxyUrl !== proxyUrl || !this.proxyAgent) {
      this.proxyAgent = new ProxyAgent(proxyUrl)
      this.proxyUrl = proxyUrl
    }
    return { dispatcher: this.proxyAgent }
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

  private getTtsConfig(): VoiceAITtsConfig {
    const audioFormat =
      this.configPresenter.getSetting<string>('voiceAI_audioFormat') || DEFAULT_AUDIO_FORMAT
    const model = this.configPresenter.getSetting<string>('voiceAI_model') || DEFAULT_TTS_MODEL
    const rawLanguage = this.configPresenter.getSetting<string>('voiceAI_language')
    const language = rawLanguage?.trim().toLowerCase() || DEFAULT_LANGUAGE
    const temperatureSetting = this.configPresenter.getSetting<number>('voiceAI_temperature')
    const topPSetting = this.configPresenter.getSetting<number>('voiceAI_topP')

    return {
      audioFormat,
      model,
      language,
      temperature:
        typeof temperatureSetting === 'number' ? temperatureSetting : DEFAULT_TEMPERATURE,
      topP: typeof topPSetting === 'number' ? topPSetting : DEFAULT_TOP_P
    }
  }

  private resolveVoiceId(modelId: string | undefined): string | null {
    if (!modelId) return null
    if (modelId === 'default') return null
    return modelId
  }

  private getAudioMimeType(format: string): string {
    const key = format.toLowerCase()
    return AUDIO_MIME_TYPE[key] || 'audio/mpeg'
  }

  private parseDataUri(value: string): { mimeType: string; data: string } | null {
    const match = value.match(/^data:([^;]+);base64,(.*)$/)
    if (!match?.[1] || !match?.[2]) return null
    return { mimeType: match[1], data: match[2] }
  }

  private isHttpUrl(value: string): boolean {
    return value.startsWith('http://') || value.startsWith('https://')
  }

  private pickString(source: Record<string, unknown>, keys: string[]): string | null {
    for (const key of keys) {
      const value = source[key]
      if (typeof value === 'string' && value.trim().length > 0) {
        return value
      }
    }
    return null
  }

  private async fetchAudioFromUrl(
    url: string,
    fallbackMimeType: string
  ): Promise<{ audioBase64: string; mimeType: string }> {
    const headers: Record<string, string> = { ...this.defaultHeaders }
    const baseUrl = this.getBaseUrl()
    if (this.provider.apiKey && url.startsWith(baseUrl)) {
      headers.Authorization = `Bearer ${this.provider.apiKey}`
    }

    const response = await fetch(url, {
      method: 'GET',
      headers,
      ...this.getFetchOptions()
    })

    if (!response.ok) {
      const errorText = await response.text()
      throw new Error(`Voice.ai audio fetch failed: ${response.status} ${errorText}`)
    }

    const contentType = response.headers.get('content-type')?.split(';')[0]?.trim()
    const mimeType = contentType && contentType.length > 0 ? contentType : fallbackMimeType
    const buffer = Buffer.from(await response.arrayBuffer())
    return { audioBase64: buffer.toString('base64'), mimeType }
  }

  private async resolveAudioValue(
    value: string,
    fallbackMimeType: string
  ): Promise<{ audioBase64: string; mimeType: string } | null> {
    const trimmed = value.trim()
    if (!trimmed) return null

    const dataUri = this.parseDataUri(trimmed)
    if (dataUri) {
      return { audioBase64: dataUri.data, mimeType: dataUri.mimeType }
    }

    if (this.isHttpUrl(trimmed)) {
      return await this.fetchAudioFromUrl(trimmed, fallbackMimeType)
    }

    return { audioBase64: trimmed, mimeType: fallbackMimeType }
  }

  private async resolveAudioFromJson(
    payload: unknown,
    fallbackMimeType: string
  ): Promise<{ audioBase64: string; mimeType: string } | null> {
    if (!payload || typeof payload !== 'object') return null

    const data = payload as Record<string, unknown>
    const rootMimeType =
      this.pickString(data, ['mime_type', 'content_type', 'contentType']) || fallbackMimeType

    const audioField = data.audio
    if (audioField && typeof audioField === 'object') {
      const audioData = audioField as Record<string, unknown>
      const audioMimeType =
        this.pickString(audioData, ['mime_type', 'content_type', 'contentType']) || rootMimeType
      const audioValue =
        this.pickString(audioData, ['base64', 'data', 'audio_base64', 'audioBase64', 'audio']) ||
        this.pickString(audioData, ['url', 'audio_url', 'audioUrl'])
      if (audioValue) {
        return await this.resolveAudioValue(audioValue, audioMimeType)
      }
    }

    const directAudioValue =
      this.pickString(data, ['audio_base64', 'audioBase64', 'audio', 'data']) ||
      this.pickString(data, ['audio_url', 'audioUrl', 'url'])
    if (directAudioValue) {
      return await this.resolveAudioValue(directAudioValue, rootMimeType)
    }

    return null
  }

  private async listVoices(): Promise<VoiceStatusResponse[]> {
    const response = await fetch(this.buildUrl('/api/v1/tts/voices'), {
      method: 'GET',
      headers: this.getAuthHeaders(),
      ...this.getFetchOptions()
    })

    if (!response.ok) {
      const errorText = await response.text()
      throw new Error(`Voice.ai list voices failed: ${response.status} ${errorText}`)
    }

    const data = await response.json()
    if (!Array.isArray(data)) return []
    return data as VoiceStatusResponse[]
  }

  private async generateSpeech(
    text: string,
    modelId: string,
    temperature?: number
  ): Promise<{ audioBase64: string; mimeType: string }> {
    const config = this.getTtsConfig()
    if (!SUPPORTED_LANGUAGES.has(config.language)) {
      throw new Error(
        `Unsupported language code: ${config.language}. Supported languages: ${Array.from(
          SUPPORTED_LANGUAGES
        ).join(', ')}`
      )
    }
    const voiceId = this.resolveVoiceId(modelId)
    const requestBody: Record<string, unknown> = {
      text,
      audio_format: config.audioFormat,
      model: config.model,
      language: config.language,
      temperature: typeof temperature === 'number' ? temperature : config.temperature,
      top_p: config.topP
    }

    if (voiceId) {
      requestBody['voice_id'] = voiceId
    }

    const response = await fetch(this.buildUrl('/api/v1/tts/speech'), {
      method: 'POST',
      headers: this.getAuthHeaders(),
      body: JSON.stringify(requestBody),
      ...this.getFetchOptions()
    })

    if (!response.ok) {
      const errorText = await response.text()
      throw new Error(`Voice.ai generate speech failed: ${response.status} ${errorText}`)
    }

    const contentType = response.headers.get('content-type')?.split(';')[0]?.trim()
    const fallbackMimeType = this.getAudioMimeType(config.audioFormat)

    if (contentType?.includes('application/json')) {
      const json = await response.json()
      const resolved = await this.resolveAudioFromJson(json, fallbackMimeType)
      if (!resolved) {
        throw new Error('Voice.ai generate speech returned JSON without audio data')
      }
      return resolved
    }

    const mimeType = contentType && contentType.length > 0 ? contentType : fallbackMimeType
    const buffer = Buffer.from(await response.arrayBuffer())
    return { audioBase64: buffer.toString('base64'), mimeType }
  }

  private extractLatestUserText(messages: ChatMessage[]): string | null {
    const lastUser = [...messages].reverse().find((message) => message.role === 'user')
    if (!lastUser?.content) return null

    if (typeof lastUser.content === 'string') {
      return lastUser.content
    }

    if (Array.isArray(lastUser.content)) {
      const textParts = lastUser.content
        .filter((part) => part.type === 'text')
        .map((part) => part.text)
        .filter(Boolean)

      return textParts.length > 0 ? textParts.join('\n') : null
    }

    return null
  }

  private buildShortTitle(text: string): string {
    const normalized = text.replace(/\s+/g, ' ').trim()
    if (!normalized) return 'Voice AI'
    return normalized.length > 32 ? `${normalized.slice(0, 32)}…` : normalized
  }
}
