import type { ProviderSettingsPort } from '@/provider/settings'
import logger from '@shared/logger'
import type { LLMResponse } from '@shared/types/provider'
import type { ChatMessage } from '@shared/types/core/chat-message'
import type { LLMCoreStreamEvent } from '@shared/types/core/llm-events'
import type { MCPToolDefinition } from '@shared/types/core/mcp'
import type {
  ProviderRuntimePort,
  LLM_PROVIDER,
  MODEL_META,
  ModelConfig,
  OllamaModel,
  KeyStatus,
  LLM_EMBEDDING_ATTRS,
  StandaloneImageGenerationResult,
  StandaloneSpeechGenerationResult,
  StandaloneVideoGenerationResult,
  ModelScopeMcpSyncOptions,
  ModelScopeMcpSyncResult,
  RateLimitQueueSnapshot,
  ProviderStreamOptions
} from '@shared/types/provider'
import type { AcpConfigState, AcpDebugRequest, AcpDebugRunResult } from '@shared/types/acp'
import { ApiEndpointType, ModelType } from '@shared/model'
import {
  normalizeImageGenerationOptions,
  type ImageGenerationOptions
} from '@shared/imageGenerationSettings'
import {
  normalizeVideoGenerationOptions,
  type VideoGenerationOptions
} from '@shared/videoGenerationSettings'
import { normalizeTtsSettings, type TtsSettings } from '@shared/ttsSettings'
import { ProviderChange, ProviderBatchUpdate } from '@shared/provider-operations'
import { isProviderDbBackedProvider } from '@shared/providerDbCatalog'
import type {
  AcpAsLlmProviderPermissionPort,
  AcpAsLlmProviderSessionControlPort,
  AcpProviderAdminPort,
  ProviderLocalePort
} from './ports'
import {
  BaseLLMProvider,
  isAudioTranscriptionNotSupportedError,
  type ProviderGenerateTextOptions
} from './baseProvider'
import { ProviderConfig, StreamState } from './types'
import { RateLimitManager } from './managers/rateLimitManager'
import { ProviderInstanceManager } from './managers/providerInstanceManager'
import { ModelManager } from './managers/modelManager'
import { OllamaManager } from './managers/ollamaManager'
import { EmbeddingManager } from './managers/embeddingManager'
import { ModelScopeSyncManager } from './managers/modelScopeSyncManager'
import type { McpSettings } from '@/mcp/settings'
import type { OllamaProvider } from './providers/ollamaProvider'
import { ShowResponse } from 'ollama'
import { AcpRuntimeOwner } from '@/agent/acp/client'
import { AcpSessionPersistence } from '@/agent/acp/runtime'
import { AcpProvider } from './providers/acpProvider'
import type { AgentSettingsPort } from '@/agent/settings'
import type { DeepchatEventPublisher } from '@shared/contracts/events'

const createAbortError = (): Error => {
  if (typeof DOMException !== 'undefined') {
    return new DOMException('Aborted', 'AbortError')
  }

  const error = new Error('Aborted')
  error.name = 'AbortError'
  return error
}

const createAbortPromise = (
  signal: AbortSignal | undefined,
  onAbort?: () => void
): { promise?: Promise<never>; cleanup: () => void } => {
  if (!signal) {
    return { cleanup: () => undefined }
  }

  let abortHandler: (() => void) | null = null
  let abortHandled = false
  const promise = new Promise<never>((_, reject) => {
    abortHandler = () => {
      if (abortHandled) return
      abortHandled = true
      try {
        onAbort?.()
      } catch {
        // Abort cleanup is best effort; the caller must still receive the cancellation error.
      }
      reject(createAbortError())
    }
    signal.addEventListener('abort', abortHandler, { once: true })
    if (signal.aborted) abortHandler()
  })

  return {
    promise,
    cleanup: () => {
      if (abortHandler) {
        signal.removeEventListener('abort', abortHandler)
      }
    }
  }
}

const closeAsyncIterator = <T>(stream: AsyncIterator<T>): void => {
  try {
    const closing = stream.return?.()
    if (closing) void closing.catch(() => undefined)
  } catch {
    // Iterator teardown is best effort and must not replace the cancellation outcome.
  }
}

const AUDIO_TRANSCRIPTION_PROMPT = [
  'Transcribe the provided audio.',
  'Return only the transcription text of the audio content.',
  'Do not translate, summarize, explain, add speaker labels, or use markdown.',
  'If there is no discernible speech, return an empty string.',
  '请只返回音频中的转写文本，不要翻译、总结、解释、添加说话人标签或 Markdown。',
  '如果没有可辨识的语音，请返回空字符串。'
].join(' ')

export class ProviderRuntime
  implements
    ProviderRuntimePort,
    AcpAsLlmProviderSessionControlPort,
    AcpAsLlmProviderPermissionPort,
    AcpProviderAdminPort
{
  private currentProviderId: string | null = null
  private readonly activeStreams: Map<string, StreamState> = new Map()
  private readonly modelRefreshPromises: Map<string, Promise<void>> = new Map()
  private readonly providerSettings: ProviderSettingsPort
  private readonly config: ProviderConfig = {
    maxConcurrentStreams: 10
  }
  private readonly rateLimitManager: RateLimitManager
  private readonly providerInstanceManager: ProviderInstanceManager
  private readonly modelManager: ModelManager
  private readonly ollamaManager: OllamaManager
  private readonly embeddingManager: EmbeddingManager
  private readonly modelScopeSyncManager: ModelScopeSyncManager
  private readonly acpRuntimeOwner: AcpRuntimeOwner
  private readonly acpSessionPersistence: AcpSessionPersistence
  private shutdownPromise?: Promise<void>

  constructor(
    providerSettings: ProviderSettingsPort,
    locale: ProviderLocalePort,
    agentSettings: Pick<AgentSettingsPort, 'getAcpEnabled' | 'getAcpAgents'>,
    mcpSettings: McpSettings,
    acpRuntimeOwner: AcpRuntimeOwner,
    acpSessionPersistence: AcpSessionPersistence,
    private readonly publishEvent: DeepchatEventPublisher
  ) {
    this.providerSettings = providerSettings
    this.rateLimitManager = new RateLimitManager(
      providerSettings,
      (providerId, provider) => this.setProviderById(providerId, provider),
      this.publishEvent
    )
    this.acpRuntimeOwner = acpRuntimeOwner
    this.acpSessionPersistence = acpSessionPersistence
    this.providerInstanceManager = new ProviderInstanceManager({
      providerSettings,
      locale,
      agentSettings,
      activeStreams: this.activeStreams,
      rateLimitManager: this.rateLimitManager,
      getCurrentProviderId: () => this.currentProviderId,
      setCurrentProviderId: (providerId) => {
        this.currentProviderId = providerId
      },
      acpRuntimeOwner: this.acpRuntimeOwner,
      publishEvent: this.publishEvent
    })
    this.modelManager = new ModelManager({
      providerSettings,
      getProviderInstance: this.getProviderInstance.bind(this)
    })
    this.ollamaManager = new OllamaManager({
      getProviderInstance: this.getProviderInstance.bind(this),
      publishEvent: this.publishEvent
    })
    this.embeddingManager = new EmbeddingManager({
      getProviderInstance: this.getProviderInstance.bind(this)
    })
    this.modelScopeSyncManager = new ModelScopeSyncManager({
      providerSettings,
      mcpSettings
    })

    this.rateLimitManager.initializeProviderRateLimitConfigs()
    this.providerInstanceManager.init()
  }

  handleProxyResolved(): void {
    this.providerInstanceManager.handleProxyResolved()
  }

  handleProviderAtomicUpdate(change: ProviderChange): void {
    this.providerInstanceManager.handleProviderAtomicUpdate(change)
  }

  handleProviderBatchUpdate(batchUpdate: ProviderBatchUpdate): void {
    this.providerInstanceManager.handleProviderBatchUpdate(batchUpdate)
  }

  setProviderById(providerId: string, provider: LLM_PROVIDER): void {
    if (!this.providerSettings.getProviderById(providerId)) {
      return
    }
    this.providerSettings.setProviderById(providerId, provider)
    this.replaceProviders(this.providerSettings.getProviders())
  }

  updateProviderAtomic(providerId: string, updates: Partial<LLM_PROVIDER>): boolean {
    if (!this.providerSettings.getProviderById(providerId)) {
      return false
    }
    const requiresRebuild = this.providerSettings.updateProviderAtomic(providerId, updates)
    this.handleProviderAtomicUpdate({
      operation: 'update',
      providerId,
      requiresRebuild,
      updates
    })
    return requiresRebuild
  }

  updateProvidersBatch(batchUpdate: ProviderBatchUpdate): void {
    this.providerSettings.updateProvidersBatch(batchUpdate)
    this.handleProviderBatchUpdate(batchUpdate)
  }

  addProviderAtomic(provider: LLM_PROVIDER): void {
    this.providerSettings.addProviderAtomic(provider)
    this.handleProviderAtomicUpdate({
      operation: 'add',
      providerId: provider.id,
      requiresRebuild: true,
      provider
    })
  }

  removeProviderAtomic(providerId: string): void {
    this.providerSettings.removeProviderAtomic(providerId)
    this.handleProviderAtomicUpdate({
      operation: 'remove',
      providerId,
      requiresRebuild: true
    })
  }

  reorderProvidersAtomic(providers: LLM_PROVIDER[]): void {
    this.providerSettings.reorderProvidersAtomic(providers)
    this.handleProviderAtomicUpdate({
      operation: 'reorder',
      providerId: '',
      requiresRebuild: false
    })
  }

  handleProviderDbUpdated(): void {
    this.refreshEnabledProviderDbBackedModelsInBackground('provider-db-updated')
  }

  getProviders(): LLM_PROVIDER[] {
    return this.providerInstanceManager.getProviders()
  }

  getCurrentProvider(): LLM_PROVIDER | null {
    if (!this.currentProviderId) {
      return null
    }
    try {
      return this.providerInstanceManager.getProviderById(this.currentProviderId)
    } catch {
      return null
    }
  }

  getProviderById(id: string): LLM_PROVIDER {
    return this.providerInstanceManager.getProviderById(id)
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

  private replaceProviders(providers: LLM_PROVIDER[]): void {
    this.stopAllStreams()
    this.providerInstanceManager.setProviders(providers)
  }

  public getProviderInstance(providerId: string): BaseLLMProvider {
    return this.providerInstanceManager.getProviderInstance(providerId)
  }

  public getExistingProviderInstance(providerId: string): BaseLLMProvider | undefined {
    return this.providerInstanceManager.getExistingProviderInstance(providerId)
  }

  public async getRuntimeContextLimitTokens(
    providerId: string,
    modelId: string,
    signal?: AbortSignal
  ): Promise<number | undefined> {
    return await this.getProviderInstance(providerId).getRuntimeContextLimitTokens(modelId, signal)
  }

  public streamChat(
    providerId: string,
    messages: ChatMessage[],
    modelId: string,
    modelConfig: ModelConfig,
    temperature: number,
    maxTokens: number,
    tools: MCPToolDefinition[],
    options?: ProviderStreamOptions
  ): AsyncGenerator<LLMCoreStreamEvent> {
    return this.getProviderInstance(providerId).coreStream(
      messages,
      modelId,
      modelConfig,
      temperature,
      maxTokens,
      tools,
      options
    )
  }

  async shutdown(): Promise<void> {
    if (this.shutdownPromise) return await this.shutdownPromise
    this.shutdownPromise = (async () => {
      await this.stopAllStreams()
      this.providerInstanceManager.shutdown()
    })()
    return await this.shutdownPromise
  }

  async clearAcpSession(conversationId: string): Promise<void> {
    const acpProvider = this.getExistingProviderInstance('acp') as
      | { clearSession?: (conversationId: string) => Promise<void> }
      | undefined
    if (acpProvider?.clearSession) {
      await acpProvider.clearSession(conversationId)
    }
  }

  async getModelList(providerId: string): Promise<MODEL_META[]> {
    return this.modelManager.getModelList(providerId)
  }

  async updateModelStatus(providerId: string, modelId: string, enabled: boolean): Promise<void> {
    await this.modelManager.updateModelStatus(providerId, modelId, enabled)
  }

  async batchUpdateModelStatus(
    providerId: string,
    updates: { modelId: string; enabled: boolean }[]
  ): Promise<void> {
    const statusMap: Record<string, boolean> = {}
    for (const update of updates) {
      statusMap[update.modelId] = update.enabled
    }
    await this.modelManager.batchUpdateModelStatusQuiet(providerId, statusMap)
  }

  /**
   * 更新 provider 的速率限制配置
   */
  updateProviderRateLimit(providerId: string, enabled: boolean, qpsLimit: number): void {
    this.rateLimitManager.updateProviderRateLimit(providerId, enabled, qpsLimit)
  }

  /**
   * 获取 provider 的速率限制状态
   */
  getProviderRateLimitStatus(providerId: string): {
    config: { enabled: boolean; qpsLimit: number }
    currentQps: number
    queueLength: number
    lastRequestTime: number
  } {
    return this.rateLimitManager.getProviderRateLimitStatus(providerId)
  }

  /**
   * 获取所有 provider 的速率限制状态
   */
  getAllProviderRateLimitStatus(): Record<
    string,
    {
      config: { enabled: boolean; qpsLimit: number }
      currentQps: number
      queueLength: number
      lastRequestTime: number
    }
  > {
    return this.rateLimitManager.getAllProviderRateLimitStatus()
  }

  async executeWithRateLimit(
    providerId: string,
    options?: {
      signal?: AbortSignal
      onQueued?: (snapshot: RateLimitQueueSnapshot) => void
      scope?: 'provider' | 'acp-direct'
    }
  ): Promise<void> {
    await this.rateLimitManager.executeWithRateLimit(providerId, options)
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
      // The consuming agent runtime deletes the stream after an end event or abort signal.
    }
  }

  private async stopAllStreams(): Promise<void> {
    const promises = Array.from(this.activeStreams.keys()).map((eventId) =>
      this.stopStream(eventId)
    )
    await Promise.all(promises)
  }

  // 非流式方法
  async generateCompletion(
    providerId: string,
    messages: { role: 'system' | 'user' | 'assistant'; content: string }[],
    modelId: string,
    temperature?: number,
    maxTokens?: number
  ): Promise<string> {
    // Record input messages to the large model
    logger.info('generateCompletion', providerId, modelId, temperature, maxTokens, messages)
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
    maxTokens?: number,
    options?: Pick<ProviderGenerateTextOptions, 'signal'>
  ): Promise<LLMResponse> {
    const provider = this.getProviderInstance(providerId)
    return options
      ? provider.generateText(prompt, modelId, temperature, maxTokens, options)
      : provider.generateText(prompt, modelId, temperature, maxTokens)
  }

  async generateCompletionStandalone(
    providerId: string,
    messages: ChatMessage[],
    modelId: string,
    temperature?: number,
    maxTokens?: number,
    options?: { signal?: AbortSignal; swallowErrors?: boolean }
  ): Promise<string> {
    const provider = this.getProviderInstance(providerId)
    let response = ''
    const signal = options?.signal
    const shouldSwallowErrors = options?.swallowErrors !== false

    if (signal?.aborted) {
      throw createAbortError()
    }

    const completionPromise = provider.completions(messages, modelId, temperature, maxTokens)
    const abort = createAbortPromise(signal)

    try {
      const llmResponse = await (abort.promise
        ? Promise.race([completionPromise, abort.promise])
        : completionPromise)
      response = llmResponse.content

      return response
    } catch (error) {
      if (signal?.aborted || (error instanceof Error && error.name === 'AbortError')) {
        throw error
      }

      console.error('Stream error:', error)

      if (!shouldSwallowErrors) {
        throw error instanceof Error ? error : new Error('Standalone completion failed')
      }

      return ''
    } finally {
      abort.cleanup()
    }
  }

  async transcribeAudioStandalone(
    providerId: string,
    modelId: string,
    audioBase64: string,
    mimeType: string,
    filename?: string,
    options?: { signal?: AbortSignal }
  ): Promise<string> {
    const normalizedAudioBase64 = audioBase64.trim()
    const normalizedMimeType = mimeType.trim().toLowerCase()

    if (!normalizedAudioBase64) {
      throw new Error('Audio data is required for transcription')
    }

    if (!normalizedMimeType.startsWith('audio/')) {
      throw new Error(`Invalid audio MIME type for transcription: ${mimeType}`)
    }

    const signal = options?.signal
    if (signal?.aborted) {
      throw createAbortError()
    }

    await this.executeWithRateLimit(providerId, { signal })

    const provider = this.getProviderInstance(providerId)
    try {
      return (
        await provider.transcribeAudio(
          modelId,
          normalizedAudioBase64,
          normalizedMimeType,
          filename,
          {
            signal
          }
        )
      ).trim()
    } catch (error) {
      if (!isAudioTranscriptionNotSupportedError(error)) {
        throw error
      }
    }

    const text = await this.generateCompletionStandalone(
      providerId,
      [
        {
          role: 'user',
          content: [
            {
              type: 'text',
              text: AUDIO_TRANSCRIPTION_PROMPT
            },
            {
              type: 'input_audio',
              input_audio: {
                data: normalizedAudioBase64,
                media_type: normalizedMimeType,
                ...(filename?.trim() ? { filename: filename.trim() } : {})
              }
            }
          ]
        }
      ],
      modelId,
      0,
      undefined,
      { signal, swallowErrors: false }
    )

    return text.trim()
  }

  async generateImageStandalone(
    providerId: string,
    prompt: string,
    modelId: string,
    imageOptions?: ImageGenerationOptions,
    options?: { signal?: AbortSignal }
  ): Promise<StandaloneImageGenerationResult> {
    const normalizedPrompt = prompt.trim()
    if (!normalizedPrompt) {
      throw new Error('Image generation prompt is required')
    }

    const signal = options?.signal
    if (signal?.aborted) {
      throw createAbortError()
    }

    await this.executeWithRateLimit(providerId, { signal })

    const provider = this.getProviderInstance(providerId)
    const modelConfig = this.providerSettings.getModelConfig(modelId, providerId)
    const mergedImageOptions = normalizeImageGenerationOptions({
      ...modelConfig.imageGeneration,
      ...imageOptions
    })
    const resolvedModelConfig: ModelConfig = {
      ...modelConfig,
      type: ModelType.ImageGeneration,
      apiEndpoint: ApiEndpointType.Image,
      imageGeneration: mergedImageOptions
    }
    const stream = provider.coreStream(
      [{ role: 'user', content: normalizedPrompt }],
      modelId,
      resolvedModelConfig,
      modelConfig.temperature ?? 0.7,
      modelConfig.maxTokens ?? 1024,
      [],
      { signal }
    )
    const images: StandaloneImageGenerationResult['images'] = []
    const abort = createAbortPromise(signal, () => {
      closeAsyncIterator(stream)
    })

    const collect = async () => {
      for await (const event of stream) {
        if (signal?.aborted) {
          throw createAbortError()
        }

        if (event.type === 'image_data') {
          images.push({
            data: event.image_data.data,
            mimeType: event.image_data.mimeType
          })
        }
        if (event.type === 'error') {
          throw new Error(event.error_message)
        }
      }
    }

    try {
      await (abort.promise ? Promise.race([collect(), abort.promise]) : collect())
    } finally {
      abort.cleanup()
    }

    if (images.length === 0) {
      throw new Error('Image generation completed without image output')
    }

    return {
      providerId,
      modelId,
      ...(mergedImageOptions ? { options: mergedImageOptions } : {}),
      images
    }
  }

  async generateVideoStandalone(
    providerId: string,
    prompt: string,
    modelId: string,
    videoOptions?: VideoGenerationOptions,
    options?: { signal?: AbortSignal }
  ): Promise<StandaloneVideoGenerationResult> {
    const normalizedPrompt = prompt.trim()
    if (!normalizedPrompt) {
      throw new Error('Video generation prompt is required')
    }

    const signal = options?.signal
    if (signal?.aborted) {
      throw createAbortError()
    }

    await this.executeWithRateLimit(providerId, { signal })

    const provider = this.getProviderInstance(providerId)
    const modelConfig = this.providerSettings.getModelConfig(modelId, providerId)
    const mergedVideoOptions = normalizeVideoGenerationOptions({
      ...modelConfig.videoGeneration,
      ...videoOptions
    })
    const resolvedModelConfig: ModelConfig = {
      ...modelConfig,
      type: ModelType.VideoGeneration,
      apiEndpoint: ApiEndpointType.Video,
      videoGeneration: mergedVideoOptions
    }
    const stream = provider.coreStream(
      [{ role: 'user', content: normalizedPrompt }],
      modelId,
      resolvedModelConfig,
      modelConfig.temperature ?? 0.7,
      modelConfig.maxTokens ?? 1024,
      [],
      { signal }
    )
    const videos: StandaloneVideoGenerationResult['videos'] = []
    const abort = createAbortPromise(signal, () => {
      closeAsyncIterator(stream)
    })

    const collect = async () => {
      for await (const event of stream) {
        if (signal?.aborted) {
          throw createAbortError()
        }

        if (
          event.type === 'image_data' &&
          event.image_data.mimeType.trim().toLowerCase().startsWith('video/')
        ) {
          videos.push({
            data: event.image_data.data,
            mimeType: event.image_data.mimeType
          })
        }
        if (event.type === 'error') {
          throw new Error(event.error_message)
        }
      }
    }

    try {
      await (abort.promise ? Promise.race([collect(), abort.promise]) : collect())
    } finally {
      abort.cleanup()
    }

    if (videos.length === 0) {
      throw new Error('Video generation completed without video output')
    }

    return {
      providerId,
      modelId,
      ...(mergedVideoOptions ? { options: mergedVideoOptions } : {}),
      videos
    }
  }

  async generateSpeechStandalone(
    providerId: string,
    text: string,
    modelId: string,
    speechOptions?: TtsSettings,
    options?: { signal?: AbortSignal }
  ): Promise<StandaloneSpeechGenerationResult> {
    const normalizedText = text.trim()
    if (!normalizedText) {
      throw new Error('Speech generation text is required')
    }

    const signal = options?.signal
    if (signal?.aborted) {
      throw createAbortError()
    }

    await this.executeWithRateLimit(providerId, { signal })

    const provider = this.getProviderInstance(providerId)
    const modelConfig = this.providerSettings.getModelConfig(modelId, providerId)
    const mergedSpeechOptions = normalizeTtsSettings({
      ...modelConfig.tts,
      ...speechOptions
    })
    const resolvedModelConfig: ModelConfig = {
      ...modelConfig,
      type: ModelType.TTS,
      apiEndpoint: ApiEndpointType.AudioSpeech,
      tts: mergedSpeechOptions
    }
    const stream = provider.coreStream(
      [{ role: 'user', content: normalizedText }],
      modelId,
      resolvedModelConfig,
      modelConfig.temperature ?? 0.7,
      modelConfig.maxTokens ?? 1024,
      [],
      { signal }
    )
    let audio: StandaloneSpeechGenerationResult['audio'] | undefined
    const abort = createAbortPromise(signal, () => {
      closeAsyncIterator(stream)
    })

    const collect = async () => {
      for await (const event of stream) {
        if (signal?.aborted) {
          throw createAbortError()
        }

        if (
          event.type === 'image_data' &&
          event.image_data.mimeType.trim().toLowerCase().startsWith('audio/')
        ) {
          if (audio) {
            throw new Error('Speech generation returned multiple audio outputs')
          }
          audio = {
            data: event.image_data.data,
            mimeType: event.image_data.mimeType
          }
        }
        if (event.type === 'error') {
          throw new Error(event.error_message)
        }
      }
    }

    try {
      await (abort.promise ? Promise.race([collect(), abort.promise]) : collect())
    } finally {
      abort.cleanup()
    }

    if (!audio) {
      throw new Error('Speech generation completed without audio output')
    }

    return {
      providerId,
      modelId,
      ...(mergedSpeechOptions ? { options: mergedSpeechOptions } : {}),
      audio
    }
  }

  // 配置相关方法
  setMaxConcurrentStreams(max: number): void {
    this.config.maxConcurrentStreams = max
  }

  getMaxConcurrentStreams(): number {
    return this.config.maxConcurrentStreams
  }

  async check(
    providerId: string,
    modelId?: string
  ): Promise<{ isOk: boolean; errorMsg: string | null }> {
    try {
      const provider = this.getProviderInstance(providerId)

      // 如果提供了modelId，使用completions方法进行测试
      if (modelId) {
        try {
          const testMessage = [{ role: 'user' as const, content: 'hi' }]
          const response: LLMResponse | null = await Promise.race([
            provider.completions(testMessage, modelId, 0.1, 10),
            new Promise<null>((resolve) => setTimeout(() => resolve(null), 60000))
          ])
          // 检查响应是否有效
          if (
            response &&
            (response.content || response.content === '' || response.reasoning_content)
          ) {
            return { isOk: true, errorMsg: null }
          } else {
            return { isOk: false, errorMsg: 'Model response is invalid' }
          }
        } catch (error) {
          console.error(`Model ${modelId} check failed:`, error)
          const errorMessage = error instanceof Error ? error.message : String(error)
          return { isOk: false, errorMsg: `Model test failed: ${errorMessage}` }
        }
      } else {
        // 如果没有提供modelId，使用provider自己的check方法进行基本验证
        logger.info(
          `[ProviderRuntime] No modelId provided, using provider's own check method for ${providerId}`
        )
        try {
          return await provider.check()
        } catch (error) {
          console.error(`Provider ${providerId} check failed:`, error)
          const errorMessage = error instanceof Error ? error.message : String(error)
          return { isOk: false, errorMsg: `Provider check failed: ${errorMessage}` }
        }
      }
    } catch (error) {
      console.error(`Provider ${providerId} check failed:`, error)
      const errorMessage = error instanceof Error ? error.message : String(error)
      return { isOk: false, errorMsg: `Provider check failed: ${errorMessage}` }
    }
  }

  async getKeyStatus(providerId: string): Promise<KeyStatus | null> {
    const provider = this.getProviderInstance(providerId)
    return provider.getKeyStatus()
  }

  /**
   * Validates a draft provider configuration and loads its model catalog in one
   * operation, without persisting the provider or toggling any enable flag.
   * Used by the add-provider "Connect and load models" flow; with
   * `loadModels: false` it performs the staged verification of an existing
   * provider's edited configuration without touching its persisted catalog.
   */
  async validateDraft(
    draft: LLM_PROVIDER,
    options?: { loadModels?: boolean }
  ): Promise<{
    isOk: boolean
    errorMsg: string | null
    models: MODEL_META[]
  }> {
    const loadModels = options?.loadModels ?? true
    let instance: BaseLLMProvider | undefined
    try {
      // enable:false keeps the base-provider constructor from kicking off its
      // background init fetch; check() and fetchModels() below are explicit.
      instance = this.providerInstanceManager.createDraftInstance({ ...draft, enable: false })
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error)
      return { isOk: false, errorMsg: errorMessage, models: [] }
    }
    if (!instance) {
      return { isOk: false, errorMsg: `Unsupported provider type: ${draft.apiType}`, models: [] }
    }

    try {
      const checkResult = await instance.check()
      if (!checkResult.isOk) {
        return { ...checkResult, models: [] }
      }

      if (!loadModels) {
        return { isOk: true, errorMsg: null, models: [] }
      }

      const models = await instance.fetchModels({ suppressErrors: false })
      return { isOk: true, errorMsg: null, models }
    } catch (error) {
      // fetchModels with suppressErrors:false rethrows before any persisted
      // write, so there is no partial catalog to clean up. Clearing here would
      // erase an existing provider's saved models if draft.id matches it.
      const errorMessage = error instanceof Error ? error.message : String(error)
      return { isOk: false, errorMsg: errorMessage, models: [] }
    } finally {
      if (
        'cleanup' in instance &&
        typeof (instance as { cleanup?: unknown }).cleanup === 'function'
      ) {
        try {
          ;(instance as unknown as { cleanup: () => void }).cleanup()
        } catch (error) {
          console.error(`Failed to clean up draft provider instance ${draft.id}:`, error)
        }
      }
    }
  }

  private getEnabledProviderIdsUsingProviderDb(): string[] {
    return this.providerInstanceManager
      .getProviders()
      .filter(
        (provider) =>
          provider.enable &&
          isProviderDbBackedProvider(provider.id) &&
          provider.id !== 'openai-codex'
      )
      .map((provider) => provider.id)
  }

  private async syncProviderDbBeforeRefresh(providerId: string): Promise<void> {
    if (!isProviderDbBackedProvider(providerId)) {
      return
    }

    const result = await this.providerSettings.refreshProviderDb(true)
    if (result.status === 'error') {
      throw new Error(result.message || 'Provider DB refresh failed')
    }
  }

  private enqueueProviderModelRefresh(providerId: string): Promise<void> {
    const existingRefresh = this.modelRefreshPromises.get(providerId)
    if (existingRefresh) {
      return existingRefresh
    }

    const refreshPromise = (async () => {
      const provider = this.getProviderInstance(providerId)
      await provider.refreshModels()
    })().finally(() => {
      if (this.modelRefreshPromises.get(providerId) === refreshPromise) {
        this.modelRefreshPromises.delete(providerId)
      }
    })

    this.modelRefreshPromises.set(providerId, refreshPromise)
    return refreshPromise
  }

  private refreshEnabledProviderDbBackedModelsInBackground(reason: string): void {
    for (const providerId of this.getEnabledProviderIdsUsingProviderDb()) {
      void this.enqueueProviderModelRefresh(providerId).catch((error) => {
        console.warn(
          `[ProviderRuntime] Failed to refresh models for provider ${providerId} during ${reason}:`,
          error
        )
      })
    }
  }

  async refreshModels(providerId: string): Promise<void> {
    try {
      await this.syncProviderDbBeforeRefresh(providerId)
      await this.enqueueProviderModelRefresh(providerId)
    } catch (error) {
      console.error(`Failed to refresh models for provider ${providerId}:`, error)
      const errorMessage = error instanceof Error ? error.message : String(error)
      throw new Error(`Model refresh failed: ${errorMessage}`)
    }
  }

  async addCustomModel(
    providerId: string,
    model: Omit<MODEL_META, 'providerId' | 'isCustom' | 'group'>
  ): Promise<MODEL_META> {
    return this.modelManager.addCustomModel(providerId, model)
  }

  async removeCustomModel(providerId: string, modelId: string): Promise<boolean> {
    return this.modelManager.removeCustomModel(providerId, modelId)
  }

  async updateCustomModel(
    providerId: string,
    modelId: string,
    updates: Partial<MODEL_META>
  ): Promise<boolean> {
    return this.modelManager.updateCustomModel(providerId, modelId, updates)
  }

  async getCustomModels(providerId: string): Promise<MODEL_META[]> {
    return this.modelManager.getCustomModels(providerId)
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
  getOllamaProviderInstance(providerId: string): OllamaProvider | null {
    return this.ollamaManager.getOllamaProviderInstance(providerId)
  }
  // ollama api
  listOllamaModels(providerId: string): Promise<OllamaModel[]> {
    return this.ollamaManager.listOllamaModels(providerId)
  }
  showOllamaModelInfo(providerId: string, modelName: string): Promise<ShowResponse> {
    return this.ollamaManager.showOllamaModelInfo(providerId, modelName)
  }
  listOllamaRunningModels(providerId: string): Promise<OllamaModel[]> {
    return this.ollamaManager.listOllamaRunningModels(providerId)
  }
  pullOllamaModels(providerId: string, modelName: string): Promise<boolean> {
    return this.ollamaManager.pullOllamaModels(providerId, modelName)
  }
  /**
   * 获取文本的 embedding 表示
   * @param providerId 提供商ID
   * @param modelId 模型ID
   * @param texts 文本数组
   * @returns embedding 数组
   */
  async getEmbeddings(
    providerId: string,
    modelId: string,
    texts: string[],
    signal?: AbortSignal
  ): Promise<number[][]> {
    return this.embeddingManager.getEmbeddings(providerId, modelId, texts, signal)
  }

  /**
   * 获取指定模型的 embedding 维度
   * @param providerId 提供商ID
   * @param modelId 模型ID
   * @returns 模型的 embedding 维度
   */
  async getDimensions(
    providerId: string,
    modelId: string,
    signal?: AbortSignal
  ): Promise<{ data: LLM_EMBEDDING_ATTRS; errorMsg?: string }> {
    return this.embeddingManager.getDimensions(providerId, modelId, signal)
  }

  async syncModelScopeMcpServers(
    providerId: string,
    syncOptions?: ModelScopeMcpSyncOptions
  ): Promise<ModelScopeMcpSyncResult> {
    return this.modelScopeSyncManager.syncModelScopeMcpServers(providerId, syncOptions)
  }

  async setAcpWorkdir(
    conversationId: string,
    agentId: string,
    workdir: string | null
  ): Promise<void> {
    const provider = this.getAcpProviderInstance()
    if (provider) {
      await provider.updateAcpWorkdir(conversationId, agentId, workdir)
      return
    }

    const requestedWorkdir = workdir?.trim() ? workdir.trim() : null
    const trimmed =
      requestedWorkdir && this.acpSessionPersistence.isWorkdirUsable(requestedWorkdir)
        ? requestedWorkdir
        : null
    if (requestedWorkdir && !trimmed) {
      console.warn(
        `[ACP] Ignoring unavailable ACP workdir "${requestedWorkdir}" for conversation ${conversationId} (agent ${agentId}); using default workdir.`
      )
    }
    await this.acpSessionPersistence.updateWorkdir(conversationId, agentId, trimmed)
  }

  async warmupAcpProcess(agentId: string, workdir?: string): Promise<void> {
    const provider = this.getAcpProviderInstance()
    if (!provider) return
    try {
      await provider.warmupProcess(agentId, workdir)
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      if (message.includes('shutting down')) {
        console.warn(
          `[ACP] Cannot warmup process for agent ${agentId}: process manager is shutting down`
        )
        return
      }
      throw error
    }
  }

  async getAcpProcessConfigOptions(
    agentId: string,
    workdir?: string
  ): Promise<AcpConfigState | null> {
    const provider = this.getAcpProviderInstance()
    if (!provider) {
      return null
    }
    return provider.getProcessConfigOptions(agentId, workdir)
  }

  async getAcpSessionConfigOptions(conversationId: string): Promise<AcpConfigState | null> {
    const provider = this.getAcpProviderInstance()
    if (!provider) {
      return null
    }
    return await provider.getSessionConfigOptions(conversationId)
  }

  async setAcpSessionConfigOption(
    conversationId: string,
    configId: string,
    value: string | boolean
  ): Promise<AcpConfigState | null> {
    const provider = this.getAcpProviderInstance()
    if (!provider) {
      throw new Error('[ACP] ACP provider not found')
    }
    return await provider.setSessionConfigOption(conversationId, configId, value)
  }

  async getAcpSessionCommands(conversationId: string): Promise<
    Array<{
      name: string
      description: string
      input?: { hint: string } | null
    }>
  > {
    const provider = this.getAcpProviderInstance()
    if (!provider) {
      return []
    }
    return await provider.getSessionCommands(conversationId)
  }

  async runAcpDebugAction(request: AcpDebugRequest): Promise<AcpDebugRunResult> {
    const provider = this.getAcpProviderInstance()
    if (!provider) {
      throw new Error('ACP provider unavailable')
    }
    return await provider.runDebugAction(request)
  }

  async resolveAgentPermission(requestId: string, granted: boolean): Promise<void> {
    const provider = this.getAcpProviderInstance()
    if (!provider) {
      throw new Error('ACP provider unavailable')
    }
    await provider.resolvePermissionRequest(requestId, granted)
  }

  private getAcpProviderInstance(): AcpProvider | null {
    try {
      const instance = this.getProviderInstance('acp')
      return instance instanceof AcpProvider ? (instance as AcpProvider) : null
    } catch (error) {
      console.warn('[ProviderRuntime] ACP provider unavailable:', error)
      return null
    }
  }
}
