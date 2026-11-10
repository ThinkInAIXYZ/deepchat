import { AcpRuntimeOwner } from '@/agent/acp/client'
import { AcpSessionPersistence } from '@/agent/acp/runtime'
import type { DimAuxiliaryModels } from '@/agent/dim/auxiliaryModels'
import type { DimDecisions } from '@/agent/dim/decisions'
import type { DimEmbeddingModels } from '@/agent/dim/embeddingModels'
import type { DimMediaModels } from '@/agent/dim/mediaModels'
import { dimModelParameters } from '@/agent/dim/modelCatalog'
import type { AgentSettingsPort } from '@/agent/settings'
import type { McpSettings } from '@/mcp/settings'
import type { ProviderSettingsPort } from '@/provider/settings'
import type { DeepchatEventPublisher } from '@shared/contracts/events'
import type { ImageGenerationOptions } from '@shared/imageGenerationSettings'
import type { JevJudgmentResult, JevQuestion } from '@shared/jevProtocol'
import logger from '@shared/logger'
import {
  ProviderBatchUpdate,
  ProviderChange,
  checkRequiresRebuild
} from '@shared/provider-operations'
import type { TtsSettings } from '@shared/ttsSettings'
import type { AcpConfigState, AcpDebugRequest, AcpDebugRunResult } from '@shared/types/acp'
import type { ChatMessage } from '@shared/types/core/chat-message'
import type { LLMCoreStreamEvent } from '@shared/types/core/llm-events'
import type { MCPToolDefinition } from '@shared/types/core/mcp'
import type {
  KeyStatus,
  LLMResponse,
  LLM_EMBEDDING_ATTRS,
  LLM_PROVIDER,
  MODEL_META,
  ModelConfig,
  ModelScopeMcpSyncOptions,
  ModelScopeMcpSyncResult,
  OllamaModel,
  ProviderRuntimePort,
  ProviderStreamOptions,
  RateLimitQueueSnapshot,
  StandaloneImageGenerationResult,
  StandaloneSpeechGenerationResult,
  StandaloneVideoGenerationResult
} from '@shared/types/provider'
import type {
  ProviderCatalogRefreshReason,
  ProviderCatalogRefreshResult,
  ProviderCatalogSnapshot
} from '@shared/types/providerCatalog'
import type { VideoGenerationOptions } from '@shared/videoGenerationSettings'
import { ShowResponse } from 'ollama'
import {
  BaseLLMProvider,
  SUMMARY_TITLES_PROMPT,
  type ProviderGenerateTextOptions
} from './baseProvider'
import { ProviderCatalogService } from './catalog/providerCatalogService'
import { ModelManager } from './managers/modelManager'
import { ModelScopeSyncManager } from './managers/modelScopeSyncManager'
import { OllamaManager } from './managers/ollamaManager'
import { ProviderInstanceManager } from './managers/providerInstanceManager'
import { RateLimitManager } from './managers/rateLimitManager'
import type {
  AcpAsLlmProviderPermissionPort,
  AcpAsLlmProviderSessionControlPort,
  AcpProviderAdminPort,
  ProviderLocalePort
} from './ports'
import { resolveAiSdkProviderDefinition } from './providerRegistry'
import { AcpProvider } from './providers/acpProvider'
import type { OllamaProvider } from './providers/ollamaProvider'
import { ProviderConfig, StreamState } from './types'

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

export class ProviderRuntime
  implements
    ProviderRuntimePort,
    AcpAsLlmProviderSessionControlPort,
    AcpAsLlmProviderPermissionPort,
    AcpProviderAdminPort
{
  private currentProviderId: string | null = null
  private readonly activeStreams: Map<string, StreamState> = new Map()
  private readonly providerSettings: ProviderSettingsPort
  private readonly config: ProviderConfig = {
    maxConcurrentStreams: 10
  }
  private readonly rateLimitManager: RateLimitManager
  private readonly providerInstanceManager: ProviderInstanceManager
  private readonly providerCatalogService: ProviderCatalogService
  private readonly modelManager: ModelManager
  private readonly ollamaManager: OllamaManager
  private readonly modelScopeSyncManager: ModelScopeSyncManager
  private readonly acpRuntimeOwner: AcpRuntimeOwner
  private readonly acpSessionPersistence: AcpSessionPersistence
  private shutdownPromise?: Promise<void>
  private nativeEmbedding?: DimEmbeddingModels
  private nativeModels?: DimAuxiliaryModels
  private nativeMedia?: DimMediaModels
  private nativeDecisions?: DimDecisions

  /** Desktop catalog administration remains here; production text inference belongs to dim. */
  setNativeEmbedding(embedding: DimEmbeddingModels): void {
    this.nativeEmbedding = embedding
  }

  setNativeModels(models: DimAuxiliaryModels): void {
    this.nativeModels = models
  }

  setNativeDecisions(decisions: DimDecisions): void {
    this.nativeDecisions = decisions
  }

  setNativeMedia(media: DimMediaModels): void {
    this.nativeMedia = media
  }

  private requireNativeModels(): DimAuxiliaryModels {
    if (!this.nativeModels) throw new Error('Native dim model service is unavailable')
    return this.nativeModels
  }
  private requireNativeEmbedding(): DimEmbeddingModels {
    if (!this.nativeEmbedding) throw new Error('Native dim embedding service is unavailable')
    return this.nativeEmbedding
  }

  private async nativeCompletion(
    providerId: string,
    modelId: string,
    messages: ChatMessage[],
    temperature?: number,
    maxTokens?: number,
    signal?: AbortSignal
  ): Promise<LLMResponse> {
    const reply = await this.requireNativeModels().complete({
      providerId,
      modelId,
      messages,
      parameters: { temperature, maxTokens },
      signal
    })
    return {
      content: reply.text,
      ...(reply.usage
        ? {
            totalUsage: {
              prompt_tokens: reply.usage.promptTokens,
              completion_tokens: reply.usage.completionTokens,
              total_tokens: reply.usage.totalTokens
            }
          }
        : {})
    }
  }

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
    this.providerCatalogService = new ProviderCatalogService({
      settings: providerSettings,
      source: {
        fetchCatalog: (providerId) => this.getProviderInstance(providerId).fetchCatalog(),
        reloadModels: (providerId) =>
          this.getExistingProviderInstance(providerId)?.reloadModelsFromSettings()
      },
      publishEvent: this.publishEvent
    })
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
      publishEvent: this.publishEvent,
      catalogWriter: this.providerCatalogService
    })
    this.modelManager = new ModelManager({
      providerSettings,
      getProviderInstance: this.getProviderInstance.bind(this)
    })
    this.ollamaManager = new OllamaManager({
      getProviderInstance: this.getProviderInstance.bind(this),
      publishEvent: this.publishEvent
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
    const previous = this.providerSettings.getProviderById(providerId)
    if (!previous) {
      return
    }
    this.providerSettings.setProviderById(providerId, provider)
    this.replaceProviders(this.providerSettings.getProviders())
    const updatedFields = Object.fromEntries(
      Object.entries(provider).filter(
        ([key, value]) => (previous as Record<string, unknown>)[key] !== value
      )
    )
    if (checkRequiresRebuild(updatedFields)) {
      this.providerCatalogService.onProviderConfigChanged(providerId)
    }
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
    if (requiresRebuild) {
      this.providerCatalogService.onProviderConfigChanged(providerId)
    }
    return requiresRebuild
  }

  updateProvidersBatch(batchUpdate: ProviderBatchUpdate): void {
    const previousProviderIds = new Set(
      this.providerSettings.getProviders().map((provider) => provider.id)
    )
    this.providerSettings.updateProvidersBatch(batchUpdate)
    this.handleProviderBatchUpdate(batchUpdate)
    const nextProviderIds = new Set(batchUpdate.providers.map((provider) => provider.id))
    for (const providerId of previousProviderIds) {
      if (!nextProviderIds.has(providerId)) {
        this.providerCatalogService.forgetCatalog(providerId)
      }
    }
    for (const change of batchUpdate.changes) {
      if (change.operation !== 'reorder' && change.requiresRebuild) {
        this.providerCatalogService.onProviderConfigChanged(change.providerId)
      }
    }
  }

  addProviderAtomic(provider: LLM_PROVIDER): void {
    this.providerSettings.addProviderAtomic(provider)
    this.handleProviderAtomicUpdate({
      operation: 'add',
      providerId: provider.id,
      requiresRebuild: true,
      provider
    })
    this.providerCatalogService.onProviderConfigChanged(provider.id)
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
    this.providerCatalogService.onProviderDbUpdated()
  }

  getProviderCatalog(providerId: string): ProviderCatalogSnapshot {
    return this.providerCatalogService.getSnapshot(providerId)
  }

  listProviderCatalogs(providerIds?: string[]): ProviderCatalogSnapshot[] {
    return this.providerCatalogService.listSnapshots(providerIds)
  }

  refreshProviderCatalog(
    providerId: string,
    reason: ProviderCatalogRefreshReason = 'user'
  ): Promise<ProviderCatalogRefreshResult> {
    return this.providerCatalogService.refresh(providerId, reason)
  }

  ensureProviderCatalogFresh(providerId: string): boolean {
    return this.providerCatalogService.ensureFresh(providerId)
  }

  replaceProviderCatalogFromSource(
    providerId: string,
    models: MODEL_META[],
    reason: ProviderCatalogRefreshReason = 'external-write'
  ): ProviderCatalogRefreshResult {
    return this.providerCatalogService.replaceFromSource(providerId, models, reason)
  }

  notifyProviderCatalogExternalWrite(
    providerId: string,
    reason: ProviderCatalogRefreshReason = 'external-write'
  ): void {
    this.providerCatalogService.onExternalCatalogWrite(providerId, reason)
  }

  invalidateProviderCatalogFromSync(providerId: string): void {
    this.providerCatalogService.invalidateFromSync(providerId)
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
    if (this.providerSettings.getProviderById(providerId)?.apiType !== 'acp') {
      if (tools.length)
        throw new Error('Agent tools must be dispatched by the native session owner')
      return this.requireNativeModels().stream({
        providerId,
        modelId,
        messages,
        parameters: dimModelParameters({ ...modelConfig, temperature, maxTokens }),
        signal: options?.signal
      })
    }
    return this.acpExecution(providerId).coreStream(
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
    if (this.providerSettings.getProviderById(providerId)?.apiType !== 'acp')
      return (await this.nativeCompletion(providerId, modelId, messages, temperature, maxTokens))
        .content
    // Record input messages to the large model
    logger.info('generateCompletion', providerId, modelId, temperature, maxTokens, messages)
    const provider = this.acpExecution(providerId)
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
    if (this.providerSettings.getProviderById(providerId)?.apiType !== 'acp')
      return this.nativeCompletion(
        providerId,
        modelId,
        [
          {
            role: 'user',
            content: `Please provide a concise summary of the following content. Return only the summary.\n\n${text}`
          }
        ],
        temperature,
        maxTokens
      )
    const provider = this.acpExecution(providerId)
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
    if (this.providerSettings.getProviderById(providerId)?.apiType !== 'acp')
      return this.nativeCompletion(
        providerId,
        modelId,
        [{ role: 'user', content: prompt }],
        temperature,
        maxTokens,
        options?.signal
      )
    const provider = this.acpExecution(providerId)
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
    if (this.providerSettings.getProviderById(providerId)?.apiType !== 'acp') {
      this.requireNativeModels()
      try {
        return (
          await this.nativeCompletion(
            providerId,
            modelId,
            messages,
            temperature,
            maxTokens,
            options?.signal
          )
        ).content
      } catch (error) {
        options?.signal?.throwIfAborted()
        if (options?.swallowErrors === false) throw error
        return ''
      }
    }
    const provider = this.acpExecution(providerId)
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

  /**
   * Evaluates typed questions against a state on a System One provider. Deliberately separate from
   * `generateCompletionStandalone`: the result is typed answers consumed by code, not text.
   */
  async runJudgment(
    providerId: string,
    modelId: string,
    request: { state: unknown; questions: Record<string, JevQuestion> },
    options?: { signal?: AbortSignal }
  ): Promise<JevJudgmentResult> {
    if (!this.nativeDecisions) throw new Error('Native dim decision service is unavailable')
    return this.nativeDecisions.runJudgment(providerId, modelId, request, options)
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

    const config = this.providerSettings.getModelConfig(modelId, providerId)
    const capability = this.providerSettings.getCapabilitySnapshot({ providerId, modelId })
    if (!config.speechRecognition && capability.supportsAudioInput) {
      const reply = await this.requireNativeModels().complete({
        providerId,
        modelId,
        messages: [
          {
            role: 'user',
            content: [
              {
                type: 'text',
                text: 'Transcribe the provided audio. Return only the transcription, in its original language, without explanations, translation, speaker labels or formatting. Return an empty string if there is no discernible speech.'
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
        parameters: { temperature: 0 },
        signal
      })
      return reply.text.trim()
    }
    return this.requireNativeMedia().transcribeAudioStandalone(
      providerId,
      modelId,
      normalizedAudioBase64,
      normalizedMimeType,
      filename,
      options
    )
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

    return this.requireNativeMedia().generateImageStandalone(
      providerId,
      normalizedPrompt,
      modelId,
      imageOptions,
      options
    )
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

    return this.requireNativeMedia().generateVideoStandalone(
      providerId,
      normalizedPrompt,
      modelId,
      videoOptions,
      options
    )
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

    return this.requireNativeMedia().generateSpeechStandalone(
      providerId,
      normalizedText,
      modelId,
      speechOptions,
      options
    )
  }

  private requireNativeMedia(): DimMediaModels {
    if (!this.nativeMedia) throw new Error('Native dim media service is unavailable')
    return this.nativeMedia
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
      const configured = this.providerSettings.getProviderById(providerId)
      if (configured && configured.apiType !== 'acp' && !modelId) {
        const definition = resolveAiSdkProviderDefinition(configured)
        if (definition?.checkStrategy === 'generate-text') modelId = definition.checkModelId
      }
      // Explicit model tests follow the same native inference boundary as production calls.
      if (modelId) {
        try {
          const testMessage = [{ role: 'user' as const, content: 'hi' }]
          const response: LLMResponse | null = await Promise.race([
            this.providerSettings.getProviderById(providerId)?.apiType !== 'acp'
              ? this.nativeCompletion(
                  providerId,
                  modelId,
                  testMessage,
                  0.1,
                  10,
                  AbortSignal.timeout(60_000)
                )
              : this.acpExecution(providerId).completions(testMessage, modelId, 0.1, 10),
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
          return await this.getProviderInstance(providerId).check()
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
   * `loadModels: false` it only probes the draft without fetching its catalog.
   * Saving an existing provider is independent of this remote probe.
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
      const definition = resolveAiSdkProviderDefinition(draft)
      const checkResult =
        definition?.checkStrategy === 'generate-text'
          ? await this.requireNativeModels()
              .completeDraft(
                draft,
                definition.checkModelId || '',
                definition.checkPrompt || 'Hello',
                AbortSignal.timeout(60_000)
              )
              .then(() => ({ isOk: true, errorMsg: null }))
          : await instance.check()
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

  async refreshModels(providerId: string): Promise<void> {
    const result = await this.providerCatalogService.refresh(providerId, 'user')
    if (result.status === 'failed') {
      // Never surface upstream errors here: they can contain connection credentials.
      throw new Error(`Model refresh failed: ${result.errorCode ?? 'unknown'}`)
    }
  }

  async addCustomModel(
    providerId: string,
    model: Omit<MODEL_META, 'providerId' | 'isCustom' | 'group'>
  ): Promise<MODEL_META> {
    const added = await this.modelManager.addCustomModel(providerId, model)
    this.providerCatalogService.onExternalCatalogWrite(providerId, 'external-write')
    return added
  }

  async removeCustomModel(providerId: string, modelId: string): Promise<boolean> {
    const removed = await this.modelManager.removeCustomModel(providerId, modelId)
    if (removed) {
      this.providerCatalogService.onExternalCatalogWrite(providerId, 'external-write')
    }
    return removed
  }

  async updateCustomModel(
    providerId: string,
    modelId: string,
    updates: Partial<MODEL_META>
  ): Promise<boolean> {
    const updated = await this.modelManager.updateCustomModel(providerId, modelId, updates)
    if (updated) {
      this.providerCatalogService.onExternalCatalogWrite(providerId, 'external-write')
    }
    return updated
  }

  async getCustomModels(providerId: string): Promise<MODEL_META[]> {
    return this.modelManager.getCustomModels(providerId)
  }

  async summaryTitles(
    messages: { role: 'system' | 'user' | 'assistant'; content: string }[],
    providerId: string,
    modelId: string
  ): Promise<string> {
    if (this.providerSettings.getProviderById(providerId)?.apiType !== 'acp') {
      const response = await this.nativeCompletion(
        providerId,
        modelId,
        [{ role: 'system', content: SUMMARY_TITLES_PROMPT }, ...messages],
        0.5,
        128
      )
      return response.content.replace(/["']/g, '').trim()
    }
    const provider = this.acpExecution(providerId)
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
    return this.requireNativeEmbedding().getEmbeddings(providerId, modelId, texts, signal)
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
    return this.requireNativeEmbedding().getDimensions(providerId, modelId, signal)
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

  /** Only the direct ACP client exposes a Node-side execution interface. */
  private acpExecution(providerId: string): AcpProvider {
    if (this.providerSettings.getProviderById(providerId)?.apiType !== 'acp')
      throw new Error('Provider inference belongs to native dim')
    return this.getProviderInstance(providerId) as AcpProvider
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
