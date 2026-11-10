import type { ProviderSettingsPort } from '@/provider/settings'
import logger from '@shared/logger'
import type { KeyStatus, LLM_PROVIDER, MODEL_META, ModelConfig } from '@shared/types/provider'
import { DeviceService } from '../device'
import type { ProviderLocalePort } from './ports'
import { buildProviderTraceHeaders, fetchWithProviderHeaders } from './providerHeaders'
import { resolveRequestTraceContext, type ProviderRequestTracePayload } from './requestTrace'

export interface ProviderGenerateTextOptions {
  signal?: AbortSignal
}

/** Product catalog, configuration and metadata queries. Inference belongs to dim or direct ACP. */
export abstract class BaseLLMProvider {
  protected static readonly DEFAULT_MODEL_FETCH_TIMEOUT = 12000 // Increased to 12 seconds as universal default

  protected provider: LLM_PROVIDER
  protected models: MODEL_META[] = []
  protected customModels: MODEL_META[] = []
  protected isInitialized: boolean = false
  protected providerSettings: ProviderSettingsPort
  private modelFetchPromise: Promise<MODEL_META[]> | null = null

  protected defaultHeaders: Record<string, string> = {
    'HTTP-Referer': 'https://deepchatai.cn',
    'X-Title': 'DeepChat'
  }

  constructor(
    provider: LLM_PROVIDER,
    providerSettings: ProviderSettingsPort,
    _locale: ProviderLocalePort
  ) {
    this.provider = provider
    this.providerSettings = providerSettings
    this.defaultHeaders = DeviceService.getDefaultHeaders()

    // Initialize models and customModels from cached config data
    this.loadCachedModels()
  }

  /**
   * Get the model fetch timeout configuration
   * @returns Timeout duration (milliseconds)
   */
  protected getModelFetchTimeout(): number {
    return BaseLLMProvider.DEFAULT_MODEL_FETCH_TIMEOUT
  }

  protected resolveModelRequestTimeout(
    modelConfig?: Pick<ModelConfig, 'timeout'> | null
  ): number | undefined {
    const timeout = modelConfig?.timeout
    if (typeof timeout !== 'number' || !Number.isFinite(timeout) || timeout <= 0) {
      return undefined
    }

    return Math.round(timeout)
  }

  protected createModelRequestTimeoutError(timeoutMs: number): Error {
    const error = new Error(`Request timed out after ${timeoutMs}ms`) as Error & {
      code: string
    }
    error.name = 'AbortError'
    error.code = 'provider_request_timeout'
    return error
  }

  public updateConfig(provider: LLM_PROVIDER): void {
    this.provider = { ...provider }
    this.modelFetchPromise = null
    this.loadCachedModels()
  }

  protected fetchProvider(input: string | URL | Request, init?: RequestInit): Promise<Response> {
    return fetchWithProviderHeaders(this.provider, input, init)
  }

  protected createModelRequestSignal(
    modelConfig?: Pick<ModelConfig, 'timeout'> | null,
    callerSignal?: AbortSignal
  ): {
    signal?: AbortSignal
    timeoutMs?: number
    dispose: () => void
  } {
    const timeoutMs = this.resolveModelRequestTimeout(modelConfig)
    if (!timeoutMs && !callerSignal) {
      return {
        dispose: () => {}
      }
    }

    if (!timeoutMs) {
      return {
        signal: callerSignal,
        dispose: () => {}
      }
    }

    const controller = new AbortController()
    const timeoutId = setTimeout(() => {
      controller.abort(this.createModelRequestTimeoutError(timeoutMs))
    }, timeoutMs)
    const onCallerAbort = () => controller.abort(callerSignal?.reason)

    if (callerSignal) {
      if (callerSignal.aborted) onCallerAbort()
      else callerSignal.addEventListener('abort', onCallerAbort, { once: true })
    }

    return {
      signal: controller.signal,
      timeoutMs,
      dispose: () => {
        clearTimeout(timeoutId)
        callerSignal?.removeEventListener('abort', onCallerAbort)
      }
    }
  }

  /**
   * Load cached model data from configuration
   * Called in constructor to avoid needing to re-fetch model lists every time
   */
  private loadCachedModels(): void {
    try {
      // Load cached provider models from config
      const cachedModels = this.providerSettings.getProviderModels(this.provider.id)
      if (cachedModels && cachedModels.length > 0) {
        this.models = cachedModels
        logger.info(
          `Loaded ${cachedModels.length} cached models for provider: ${this.provider.name}`
        )
      }

      // Load cached custom models from config
      const cachedCustomModels = this.providerSettings.getCustomModels(this.provider.id)
      if (cachedCustomModels && cachedCustomModels.length > 0) {
        this.customModels = cachedCustomModels
        logger.info(
          `Loaded ${cachedCustomModels.length} cached custom models for provider: ${this.provider.name}`
        )
      }
    } catch (error) {
      logger.warn(`Failed to load cached models for provider: ${this.provider.name}`, error)
      // Keep default empty arrays if loading fails
      this.models = []
      this.customModels = []
    }
  }

  /**
   * Initialize the provider. Catalog discovery is owned by the provider catalog service, so
   * initialization only marks the instance usable; it never talks to the upstream catalog.
   */
  protected async init() {
    this.isInitialized = true
  }

  /**
   * 获取提供商的模型列表
   * @returns 模型列表
   */
  public async fetchModels(options?: { suppressErrors?: boolean }): Promise<MODEL_META[]> {
    const provider = this.provider
    const suppressErrors = options?.suppressErrors ?? true
    let models: MODEL_META[]

    try {
      if (!this.modelFetchPromise) {
        const pending = this.fetchProviderModels().finally(() => {
          if (this.modelFetchPromise === pending) {
            this.modelFetchPromise = null
          }
        })
        this.modelFetchPromise = pending
      }
      models = await this.modelFetchPromise
    } catch (e) {
      logger.error(
        `[Provider] fetchModels: Failed to fetch models for provider "${this.provider.id}":`,
        e
      )
      if (!suppressErrors) {
        throw e
      }
      if (!this.models) {
        this.models = []
      }
      return []
    }

    logger.info(
      `[Provider] fetchModels: fetched ${models?.length || 0} models for provider "${this.provider.id}"`
    )
    if (provider !== this.provider) return []

    // Validate a private snapshot of the shared discovery result.
    const validatedModels = structuredClone(models).map((model) => {
      if (model.providerId !== this.provider.id) {
        logger.warn(
          `[Provider] fetchModels: Model ${model.id} has incorrect providerId: expected "${this.provider.id}", got "${model.providerId}". Fixing it.`
        )
        model.providerId = this.provider.id
      }
      return model
    })
    this.models = validatedModels
    return structuredClone(validatedModels)
  }

  /**
   * Fetch the provider's current catalog without persisting it. Catalog persistence is owned by
   * the main-process catalog service.
   */
  public async fetchCatalog(): Promise<MODEL_META[]> {
    return await this.fetchProviderModels()
  }

  /** Reload the in-memory read-through cache after the catalog service persists new rows. */
  public reloadModelsFromSettings(): void {
    this.loadCachedModels()
    this.modelFetchPromise = null
  }

  /**
   * 获取特定提供商的模型
   * 此方法由具体的提供商子类实现
   * @returns 提供商支持的模型列表
   */
  protected abstract fetchProviderModels(): Promise<MODEL_META[]>

  /**
   * 获取所有模型（包括自定义模型）
   * @returns 模型列表
   */
  public getModels(): MODEL_META[] {
    return [...this.models, ...this.customModels]
  }

  /**
   * 添加自定义模型
   * @param model 模型基本信息
   * @returns 添加后的完整模型信息
   */
  public addCustomModel(model: Omit<MODEL_META, 'providerId' | 'isCustom' | 'group'>): MODEL_META {
    const newModel: MODEL_META = {
      ...model,
      providerId: this.provider.id,
      isCustom: true,
      group: 'default'
    }

    // 检查是否已存在相同ID的自定义模型
    const existingIndex = this.customModels.findIndex((m) => m.id === newModel.id)
    if (existingIndex !== -1) {
      this.customModels[existingIndex] = newModel
    } else {
      this.customModels.push(newModel)
    }

    // Sync with config
    this.providerSettings.addCustomModel(this.provider.id, newModel)

    return newModel
  }

  /**
   * 删除自定义模型
   * @param modelId 要删除的模型ID
   * @returns 是否删除成功
   */
  public removeCustomModel(modelId: string): boolean {
    const index = this.customModels.findIndex((model) => model.id === modelId)
    if (index !== -1) {
      this.customModels.splice(index, 1)
      // Sync with config
      this.providerSettings.removeCustomModel(this.provider.id, modelId)
      return true
    }
    return false
  }

  /**
   * 更新自定义模型
   * @param modelId 要更新的模型ID
   * @param updates 要更新的字段
   * @returns 是否更新成功
   */
  public updateCustomModel(modelId: string, updates: Partial<MODEL_META>): boolean {
    const model = this.customModels.find((m) => m.id === modelId)
    if (model) {
      // 应用更新
      Object.assign(model, updates)
      // Sync with config
      this.providerSettings.updateCustomModel(this.provider.id, modelId, updates)
      return true
    }
    return false
  }

  /**
   * 获取所有自定义模型
   * @returns 自定义模型列表
   */
  public getCustomModels(): MODEL_META[] {
    return this.customModels
  }

  /**
   * 代理更新回调
   * 当代理配置变更时调用此方法更新提供商的代理设置
   */
  public abstract onProxyResolved(): void

  /**
   * 验证提供商API是否可用
   * @returns 验证结果和错误信息
   */
  public abstract check(): Promise<{ isOk: boolean; errorMsg: string | null }>

  /**
   * Return the total context currently allocated by the provider runtime, when it can be observed
   * without loading the model. Static model metadata is not a runtime limit. Implementations that
   * support this observation should return `undefined` only when a successful query has no
   * model-specific runtime fact; reject if the query itself is unavailable so callers can preserve
   * a prior successful limit.
   */
  public async getRuntimeContextLimitTokens(
    _modelId: string,
    _signal?: AbortSignal
  ): Promise<number | undefined> {
    return undefined
  }

  /**
   * 获取 API key 状态信息
   * @returns API key 状态信息，如果不支持则返回 null
   */
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  public async getKeyStatus(): Promise<KeyStatus | null> {
    return null // 默认实现返回 null，表示不支持此功能
  }

  protected async emitRequestTrace(
    modelConfig: ModelConfig,
    payload: {
      endpoint: string
      headers?: Record<string, string>
      body?: unknown
    }
  ): Promise<void> {
    const context = resolveRequestTraceContext(modelConfig)
    if (!context) {
      return
    }

    const tracePayload: ProviderRequestTracePayload = {
      endpoint: payload.endpoint,
      headers: buildProviderTraceHeaders(this.provider, payload.endpoint, payload.headers ?? {}),
      body: payload.body ?? null
    }

    try {
      await context.persist(tracePayload)
    } catch (error) {
      logger.warn(
        `[Trace] Failed to persist request trace for provider "${this.provider.id}"`,
        error
      )
    }
  }
}
export const SUMMARY_TITLES_PROMPT = `
You need to summarize the user's conversation into a title of no more than 10 words, with the title language matching the user's primary language, without using punctuation or other special symbols,only output the title,here is the conversation:
`
