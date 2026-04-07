import {
  ILlmProviderPresenter,
  LLM_PROVIDER,
  LLMResponse,
  MODEL_META,
  OllamaModel,
  ChatMessage,
  KeyStatus,
  LLM_EMBEDDING_ATTRS,
  ModelScopeMcpSyncOptions,
  ModelScopeMcpSyncResult,
  IConfigPresenter,
  ISQLitePresenter,
  AcpConfigState,
  RateLimitQueueSnapshot,
  AcpWorkdirInfo,
  AcpDebugRequest,
  AcpDebugRunResult
} from '@shared/presenter'
import { ProviderChange, ProviderBatchUpdate } from '@shared/provider-operations'
import { isProviderDbBackedProvider } from '@shared/providerDbCatalog'
import { eventBus } from '@/eventbus'
import { CONFIG_EVENTS, PROVIDER_DB_EVENTS } from '@/events'
import { BaseLLMProvider } from './baseProvider'
import { ProviderConfig, StreamState } from './types'
import { RateLimitManager } from './managers/rateLimitManager'
import { ProviderInstanceManager } from './managers/providerInstanceManager'
import { ModelManager } from './managers/modelManager'
import { OllamaManager } from './managers/ollamaManager'
import { EmbeddingManager } from './managers/embeddingManager'
import { ModelScopeSyncManager } from './managers/modelScopeSyncManager'
import type { OllamaProvider } from './providers/ollamaProvider'
import { ShowResponse } from 'ollama'
import { AcpSessionPersistence } from './acp'
import { AcpProvider } from './providers/acpProvider'
import type { ProviderMcpRuntimePort } from './runtimePorts'

const createAbortError = (): Error => {
  if (typeof DOMException !== 'undefined') {
    return new DOMException('Aborted', 'AbortError')
  }

  const error = new Error('Aborted')
  error.name = 'AbortError'
  return error
}

export class LLMProviderPresenter implements ILlmProviderPresenter {
  private currentProviderId: string | null = null
  private readonly activeStreams: Map<string, StreamState> = new Map()
  private readonly modelRefreshPromises: Map<string, Promise<void>> = new Map()
  private readonly configPresenter: IConfigPresenter
  private readonly config: ProviderConfig = {
    maxConcurrentStreams: 10
  }
  private readonly rateLimitManager: RateLimitManager
  private readonly providerInstanceManager: ProviderInstanceManager
  private readonly modelManager: ModelManager
  private readonly ollamaManager: OllamaManager
  private readonly embeddingManager: EmbeddingManager
  private readonly modelScopeSyncManager: ModelScopeSyncManager
  private readonly acpSessionPersistence: AcpSessionPersistence

  constructor(
    configPresenter: IConfigPresenter,
    sqlitePresenter: ISQLitePresenter,
    mcpRuntime?: ProviderMcpRuntimePort
  ) {
    this.configPresenter = configPresenter
    this.rateLimitManager = new RateLimitManager(configPresenter)
    this.acpSessionPersistence = new AcpSessionPersistence(sqlitePresenter)
    this.providerInstanceManager = new ProviderInstanceManager({
      configPresenter,
      activeStreams: this.activeStreams,
      rateLimitManager: this.rateLimitManager,
      getCurrentProviderId: () => this.currentProviderId,
      setCurrentProviderId: (providerId) => {
        this.currentProviderId = providerId
      },
      acpSessionPersistence: this.acpSessionPersistence,
      mcpRuntime
    })
    this.modelManager = new ModelManager({
      configPresenter,
      getProviderInstance: this.getProviderInstance.bind(this)
    })
    this.ollamaManager = new OllamaManager({
      getProviderInstance: this.getProviderInstance.bind(this)
    })
    this.embeddingManager = new EmbeddingManager({
      getProviderInstance: this.getProviderInstance.bind(this)
    })
    this.modelScopeSyncManager = new ModelScopeSyncManager({
      configPresenter,
      getProviderInstance: this.getProviderInstance.bind(this)
    })

    this.rateLimitManager.initializeProviderRateLimitConfigs()
    this.providerInstanceManager.init()

    eventBus.on(CONFIG_EVENTS.PROXY_RESOLVED, () => {
      this.providerInstanceManager.handleProxyResolved()
    })

    eventBus.on(CONFIG_EVENTS.PROVIDER_ATOMIC_UPDATE, (change: ProviderChange) => {
      this.providerInstanceManager.handleProviderAtomicUpdate(change)
    })

    eventBus.on(CONFIG_EVENTS.PROVIDER_BATCH_UPDATE, (batchUpdate: ProviderBatchUpdate) => {
      this.providerInstanceManager.handleProviderBatchUpdate(batchUpdate)
    })

    eventBus.on(PROVIDER_DB_EVENTS.UPDATED, () => {
      this.refreshEnabledProviderDbBackedModelsInBackground('provider-db-updated')
    })
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

  setProviders(providers: LLM_PROVIDER[]): void {
    this.stopAllStreams()
    this.providerInstanceManager.setProviders(providers)
  }

  public getProviderInstance(providerId: string): BaseLLMProvider {
    return this.providerInstanceManager.getProviderInstance(providerId)
  }

  public getExistingProviderInstance(providerId: string): BaseLLMProvider | undefined {
    return this.providerInstanceManager.getExistingProviderInstance(providerId)
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
      // Deletion is handled by the consuming loop in sessionPresenter upon receiving the 'end' event or abortion signal
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
    console.log('generateCompletion', providerId, modelId, temperature, maxTokens, messages)
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

  async generateCompletionStandalone(
    providerId: string,
    messages: ChatMessage[],
    modelId: string,
    temperature?: number,
    maxTokens?: number,
    options?: { signal?: AbortSignal }
  ): Promise<string> {
    const provider = this.getProviderInstance(providerId)
    let response = ''
    const signal = options?.signal

    if (signal?.aborted) {
      throw createAbortError()
    }

    const completionPromise = provider.completions(messages, modelId, temperature, maxTokens)
    const abortPromise =
      signal &&
      new Promise<never>((_, reject) => {
        const onAbort = () => reject(createAbortError())
        signal.addEventListener('abort', onAbort, { once: true })
        completionPromise.finally(() => signal.removeEventListener('abort', onAbort))
      })

    try {
      const llmResponse = await (abortPromise
        ? Promise.race([completionPromise, abortPromise])
        : completionPromise)
      response = llmResponse.content

      return response
    } catch (error) {
      if (signal?.aborted || (error instanceof Error && error.name === 'AbortError')) {
        throw error
      }
      console.error('Stream error:', error)
      return ''
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
        console.log(
          `[LLMProviderPresenter] No modelId provided, using provider's own check method for ${providerId}`
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

  private getEnabledProviderIdsUsingProviderDb(): string[] {
    return this.providerInstanceManager
      .getProviders()
      .filter((provider) => provider.enable && isProviderDbBackedProvider(provider.id))
      .map((provider) => provider.id)
  }

  private async syncProviderDbBeforeRefresh(providerId: string): Promise<void> {
    if (!isProviderDbBackedProvider(providerId)) {
      return
    }

    const result = await this.configPresenter.refreshProviderDb(true)
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
          `[LLMProviderPresenter] Failed to refresh models for provider ${providerId} during ${reason}:`,
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
  async getEmbeddings(providerId: string, modelId: string, texts: string[]): Promise<number[][]> {
    return this.embeddingManager.getEmbeddings(providerId, modelId, texts)
  }

  /**
   * 获取指定模型的 embedding 维度
   * @param providerId 提供商ID
   * @param modelId 模型ID
   * @returns 模型的 embedding 维度
   */
  async getDimensions(
    providerId: string,
    modelId: string
  ): Promise<{ data: LLM_EMBEDDING_ATTRS; errorMsg?: string }> {
    return this.embeddingManager.getDimensions(providerId, modelId)
  }

  async syncModelScopeMcpServers(
    providerId: string,
    syncOptions?: ModelScopeMcpSyncOptions
  ): Promise<ModelScopeMcpSyncResult> {
    return this.modelScopeSyncManager.syncModelScopeMcpServers(providerId, syncOptions)
  }

  async getAcpWorkdir(conversationId: string, agentId: string): Promise<AcpWorkdirInfo> {
    const record = await this.acpSessionPersistence.getSessionData(conversationId, agentId)
    const path = this.acpSessionPersistence.resolveWorkdir(record?.workdir)
    const isCustom = Boolean(record?.workdir && record.workdir.trim().length > 0)
    return { path, isCustom }
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

    const trimmed = workdir?.trim() ? workdir : null
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

  async getAcpProcessModes(
    agentId: string,
    workdir?: string
  ): Promise<
    | {
        availableModes?: Array<{ id: string; name: string; description: string }>
        currentModeId?: string
      }
    | undefined
  > {
    const provider = this.getAcpProviderInstance()
    if (!provider) {
      return undefined
    }
    return provider.getProcessModes(agentId, workdir)
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

  async setAcpPreferredProcessMode(agentId: string, workdir: string, modeId: string) {
    const provider = this.getAcpProviderInstance()
    if (!provider) return

    await provider.setPreferredProcessMode(agentId, workdir, modeId)
  }

  async setAcpSessionMode(conversationId: string, modeId: string): Promise<void> {
    const provider = this.getAcpProviderInstance()
    if (!provider) {
      throw new Error('[ACP] ACP provider not found')
    }
    await provider.setSessionMode(conversationId, modeId)
  }

  async prepareAcpSession(conversationId: string, agentId: string, workdir: string): Promise<void> {
    const provider = this.getAcpProviderInstance()
    if (!provider) {
      throw new Error('[ACP] ACP provider not found')
    }
    await provider.prepareSession(conversationId, agentId, workdir)
  }

  async getAcpSessionModes(conversationId: string): Promise<{
    current: string
    available: Array<{ id: string; name: string; description: string }>
  } | null> {
    const provider = this.getAcpProviderInstance()
    if (!provider) {
      return null
    }
    return await provider.getSessionModes(conversationId)
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
      console.warn('[LLMProviderPresenter] ACP provider unavailable:', error)
      return null
    }
  }
}
