import type { ProviderSettingsPort } from '@/provider/settings'
import type { ChatMessage } from '@shared/types/core/chat-message'
import type { LLMCoreStreamEvent } from '@shared/types/core/llm-events'
import type { LLMResponse } from '@shared/types/provider'
import type { MCPToolDefinition } from '@shared/types/mcp'
import type {
  LLM_EMBEDDING_ATTRS,
  LLM_PROVIDER,
  MODEL_META,
  ModelConfig,
  OllamaModel,
  ProviderStreamOptions,
  ProgressResponse
} from '@shared/types/provider'
import { ModelType } from '@shared/model'
import {
  BaseLLMProvider,
  SUMMARY_TITLES_PROMPT,
  type ProviderGenerateTextOptions
} from '../baseProvider'
import type { ProviderLocalePort } from '../ports'
import { execFile } from 'node:child_process'
import { Ollama, ShowResponse } from 'ollama'
import {
  runAiSdkCoreStream,
  runAiSdkDimensions,
  runAiSdkEmbeddings,
  runAiSdkGenerateText,
  type AiSdkRuntimeContext
} from '../aiSdk'
import { normalizeOllamaOpenAIBaseUrl, normalizeOllamaSdkHost } from '../aiSdk/providerFactory'
import { isInsecureTlsAllowed } from '@/lib/insecureTls'
import { buildResolvedCapabilitySnapshot, resolveCapabilityIdentity } from '../capabilityIdentity'

const OLLAMA_LIST_TIMEOUT_MS = 5000
const OLLAMA_RUNTIME_CONTEXT_TIMEOUT_MS = 400

export class OllamaProvider extends BaseLLMProvider {
  private static readonly CONFIG_DRAIN_TIMEOUT_MS = 1500

  private ollama: Ollama
  private activeStreams = 0
  private activeStreamResolvers: Array<() => void> = []
  private isDraining = false
  private configUpdateChain: Promise<void> = Promise.resolve()

  constructor(
    provider: LLM_PROVIDER,
    providerSettings: ProviderSettingsPort,
    locale: ProviderLocalePort
  ) {
    super(provider, providerSettings, locale)
    this.ollama = this.createOllamaClient()
    this.init()
  }

  private createOllamaClient(signal?: AbortSignal): Ollama {
    const host = normalizeOllamaSdkHost(this.provider.baseUrl)
    const requestFetch: typeof fetch | undefined = signal
      ? (input, init) => fetch(input, { ...init, signal })
      : undefined

    if (this.provider.apiKey) {
      return new Ollama({
        host,
        headers: { Authorization: `Bearer ${this.provider.apiKey}` },
        ...(requestFetch ? { fetch: requestFetch } : {})
      })
    }

    return new Ollama({
      host,
      ...(requestFetch ? { fetch: requestFetch } : {})
    })
  }

  protected getAiSdkRuntimeContext(
    modelId: string,
    modelConfig?: Pick<ModelConfig, 'reasoning'>
  ): AiSdkRuntimeContext {
    const capabilityIdentity = resolveCapabilityIdentity({
      providerId: this.provider.id,
      modelId,
      explicitProviderId: this.provider.capabilityProviderId
    })

    return {
      providerKind: 'openai-compatible',
      provider: {
        ...this.provider,
        baseUrl: normalizeOllamaOpenAIBaseUrl(this.provider.baseUrl)
      },
      capabilitySnapshot: buildResolvedCapabilitySnapshot(capabilityIdentity, {
        reasoningEnabled: modelConfig?.reasoning
      }),
      providerSettings: this.providerSettings,
      defaultHeaders: this.defaultHeaders,
      buildLegacyFunctionCallPrompt: (tools) => this.getFunctionCallWrapPrompt(tools),
      emitRequestTrace: (modelConfig, payload) => this.emitRequestTrace(modelConfig, payload),
      supportsNativeTools: (_modelId, modelConfig) => modelConfig.functionCall === true
    }
  }

  private mergeCapabilities(...sources: Array<string[] | undefined>): string[] | undefined {
    if (!sources.some(Array.isArray)) {
      return undefined
    }

    return Array.from(new Set(sources.flatMap((source) => (Array.isArray(source) ? source : []))))
  }

  private normalizeCapabilities(capabilities?: string[]): string[] | undefined {
    if (!Array.isArray(capabilities)) {
      return undefined
    }

    const capabilitySet = new Set(capabilities.filter(Boolean))
    if (capabilitySet.has('completion')) {
      capabilitySet.add('chat')
    }
    return Array.from(capabilitySet)
  }

  private getModelInfoEntries(modelInfo: ShowResponse['model_info'] | undefined) {
    if (!modelInfo) {
      return [] as Array<[string, unknown]>
    }

    if (modelInfo instanceof Map) {
      return Array.from(modelInfo.entries()) as Array<[string, unknown]>
    }

    if (typeof modelInfo === 'object') {
      return Object.entries(modelInfo as Record<string, unknown>)
    }

    return [] as Array<[string, unknown]>
  }

  private findModelInfoNumber(
    entries: Array<[string, unknown]>,
    exactKeys: string[],
    fallback?: (key: string) => boolean
  ): number | undefined {
    for (const exactKey of exactKeys) {
      const value = entries.find(([key]) => key === exactKey)?.[1]
      if (typeof value === 'number' && Number.isFinite(value)) {
        return value
      }
    }

    if (!fallback) {
      return undefined
    }

    for (const [key, value] of entries) {
      if (fallback(key) && typeof value === 'number' && Number.isFinite(value)) {
        return value
      }
    }

    return undefined
  }

  private findModelInfoString(entries: Array<[string, unknown]>, key: string): string | undefined {
    const value = entries.find(([entryKey]) => entryKey === key)?.[1]
    return typeof value === 'string' && value.trim() ? value : undefined
  }

  private findModelInfoValue(entries: Array<[string, unknown]>, key: string): unknown {
    return entries.find(([entryKey]) => entryKey === key)?.[1]
  }

  private isLocalOllamaHost(): boolean {
    try {
      const url = new URL(normalizeOllamaSdkHost(this.provider.baseUrl))
      return ['localhost', '127.0.0.1', '0.0.0.0', '::1'].includes(url.hostname)
    } catch {
      return false
    }
  }

  private getOllamaCliCandidates(): string[] {
    switch (process.platform) {
      case 'darwin':
        return ['ollama', '/opt/homebrew/bin/ollama', '/usr/local/bin/ollama']
      case 'win32':
        return ['ollama.exe', 'ollama']
      default:
        return ['ollama', '/usr/local/bin/ollama', '/usr/bin/ollama']
    }
  }

  private createCliModel(name: string, digest: string): OllamaModel {
    return {
      name,
      model: name,
      size: 0,
      digest,
      modified_at: new Date(),
      details: {
        format: '',
        family: 'default',
        families: ['default'],
        parameter_size: '',
        quantization_level: ''
      }
    }
  }

  private parseOllamaListOutput(output: string): OllamaModel[] {
    return output
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => line && !line.startsWith('NAME '))
      .map((line) => {
        const match = line.match(/^(\S+)\s+([0-9a-fA-F]+)\s+/)
        return match ? this.createCliModel(match[1], match[2]) : null
      })
      .filter((model): model is OllamaModel => Boolean(model))
  }

  private async listModelsFromCli(): Promise<OllamaModel[]> {
    if (!this.isLocalOllamaHost()) {
      return []
    }

    let lastError: unknown = null
    try {
      const sdkHost = normalizeOllamaSdkHost(this.provider.baseUrl)
      for (const command of this.getOllamaCliCandidates()) {
        try {
          const stdout = await new Promise<string>((resolve, reject) => {
            execFile(
              command,
              ['list'],
              {
                timeout: OLLAMA_LIST_TIMEOUT_MS,
                maxBuffer: 1024 * 1024,
                env: {
                  ...process.env,
                  OLLAMA_HOST: sdkHost
                }
              },
              (error, output) => {
                if (error) {
                  reject(error)
                  return
                }

                resolve(output)
              }
            )
          })
          return this.parseOllamaListOutput(stdout)
        } catch (error) {
          lastError = error
        }
      }

      throw lastError
    } catch {
      return []
    }
  }

  private async listModelsFromSdk(): Promise<OllamaModel[]> {
    const response = await this.ollama.list()
    return response.models as unknown as OllamaModel[]
  }

  private alignModelsWithCliList(
    sdkModels: OllamaModel[],
    cliModels: OllamaModel[]
  ): OllamaModel[] {
    if (cliModels.length === 0) {
      return sdkModels
    }

    const sdkModelsByName = new Map(sdkModels.map((model) => [model.name, model]))
    return cliModels.map((cliModel) => {
      const sdkModel = sdkModelsByName.get(cliModel.name)
      return sdkModel ? this.mergeOllamaModels(sdkModel, cliModel) : cliModel
    })
  }

  private matchesRequestedModelName(actualModelName: string, requestedModelName: string): boolean {
    const normalizeLatestTag = (name: string): string =>
      name.endsWith(':latest') ? name.slice(0, -':latest'.length) : name
    return normalizeLatestTag(actualModelName) === normalizeLatestTag(requestedModelName)
  }

  private normalizeRuntimeContextLength(value: unknown): number | undefined {
    return Number.isSafeInteger(value) && (value as number) > 0 ? (value as number) : undefined
  }

  private async listRuntimeModels(client: Ollama = this.ollama): Promise<OllamaModel[]> {
    const response = await client.ps()
    return response.models.map((rawModel) => {
      const model = rawModel as unknown as OllamaModel & { context_length?: unknown }
      const runtimeContextLength = this.normalizeRuntimeContextLength(model.context_length)
      return {
        ...model,
        ...(runtimeContextLength !== undefined ? { runtimeContextLength } : {})
      }
    })
  }

  private mergeModelInfo(
    primary?: OllamaModel['model_info'],
    secondary?: OllamaModel['model_info']
  ): OllamaModel['model_info'] {
    if (!primary && !secondary) {
      return undefined
    }

    const mergedGeneral =
      secondary?.general || primary?.general
        ? {
            ...secondary?.general,
            ...primary?.general
          }
        : undefined

    const mergedVisionEmbeddingLength =
      primary?.vision?.embedding_length ?? secondary?.vision?.embedding_length
    const mergedVision =
      typeof mergedVisionEmbeddingLength === 'number'
        ? {
            embedding_length: mergedVisionEmbeddingLength
          }
        : undefined

    return {
      ...secondary,
      ...primary,
      ...(mergedGeneral ? { general: mergedGeneral } : {}),
      ...(mergedVision ? { vision: mergedVision } : {})
    }
  }

  private mergeOllamaModels(preferred: OllamaModel, secondary?: OllamaModel): OllamaModel {
    if (!secondary) {
      return preferred
    }

    return {
      ...secondary,
      ...preferred,
      details: {
        ...secondary.details,
        ...preferred.details
      },
      model_info: this.mergeModelInfo(preferred.model_info, secondary.model_info),
      capabilities: this.mergeCapabilities(preferred.capabilities, secondary.capabilities)
    }
  }

  private resolveOllamaModelMeta(model: OllamaModel): MODEL_META {
    const hasCapabilityFacts = Array.isArray(model.capabilities)
    const capabilitySet = new Set(model.capabilities ?? [])
    const hasVisionEmbedding =
      typeof model.model_info?.vision?.embedding_length === 'number' &&
      Number.isFinite(model.model_info.vision.embedding_length) &&
      model.model_info.vision.embedding_length > 0
    const contextLength = model.model_info?.context_length
    const resolvedType = capabilitySet.has('embedding')
      ? ModelType.Embedding
      : capabilitySet.has('chat') || capabilitySet.has('completion')
        ? ModelType.Chat
        : undefined

    const family = model.details?.family || 'default'
    const parameterSize = model.details?.parameter_size || ''
    const description = `${parameterSize} ${family} model`.trim()

    return {
      id: model.name,
      name: model.name,
      providerId: this.provider.id,
      ...(typeof contextLength === 'number' && Number.isFinite(contextLength) && contextLength > 0
        ? { contextLength }
        : {}),
      isCustom: false,
      group: family,
      description,
      ...(hasCapabilityFacts || hasVisionEmbedding
        ? { vision: capabilitySet.has('vision') || hasVisionEmbedding }
        : {}),
      ...(hasCapabilityFacts ? { functionCall: capabilitySet.has('tools') } : {}),
      ...(hasCapabilityFacts ? { reasoning: capabilitySet.has('thinking') } : {}),
      ...(resolvedType !== undefined ? { type: resolvedType } : {})
    }
  }

  public onProxyResolved(): void {}

  public override updateConfig(provider: LLM_PROVIDER): void {
    this.configUpdateChain = this.configUpdateChain
      .then(() => this.applyConfigUpdate(provider))
      .catch((error) => {
        console.error(`Failed to update Ollama config ${provider.id}:`, error)
      })
  }

  private async applyConfigUpdate(provider: LLM_PROVIDER): Promise<void> {
    this.isDraining = true

    try {
      const previousClient = this.ollama
      await this.waitForActiveStreamsToDrain(previousClient)

      super.updateConfig(provider)
      this.ollama = this.createOllamaClient()
    } finally {
      this.isDraining = false
    }
  }

  private async waitForActiveStreamsToDrain(client: Ollama): Promise<void> {
    if (this.activeStreams === 0) {
      return
    }

    await Promise.race([
      new Promise<void>((resolve) => {
        this.activeStreamResolvers.push(resolve)
      }),
      new Promise<void>((resolve) => {
        const timeoutId = setTimeout(() => {
          try {
            client.abort()
          } catch (error) {
            console.warn('Failed to abort active Ollama streams during config drain:', error)
          }
          resolve()
        }, OllamaProvider.CONFIG_DRAIN_TIMEOUT_MS)

        this.activeStreamResolvers.push(() => {
          clearTimeout(timeoutId)
          resolve()
        })
      })
    ])
  }

  private async waitForDrainIfNeeded(): Promise<void> {
    await this.configUpdateChain
    if (!this.isDraining) {
      return
    }

    await this.configUpdateChain
  }

  private beginActiveStream(): () => void {
    this.activeStreams += 1

    return () => {
      this.activeStreams = Math.max(0, this.activeStreams - 1)
      if (this.activeStreams === 0) {
        const resolvers = this.activeStreamResolvers
        this.activeStreamResolvers = []
        resolvers.forEach((resolve) => resolve())
      }
    }
  }

  protected async fetchProviderModels(): Promise<MODEL_META[]> {
    try {
      const [localModels, runningModels] = await Promise.all([
        this.listModels(),
        this.listRunningModels()
      ])

      const mergedModels = new Map<string, OllamaModel>()
      for (const localModel of localModels) {
        mergedModels.set(localModel.name, localModel)
      }
      for (const runningModel of runningModels) {
        const existing = mergedModels.get(runningModel.name)
        const merged = existing
          ? this.mergeOllamaModels(existing, runningModel)
          : this.mergeOllamaModels(runningModel)
        mergedModels.set(runningModel.name, merged)
      }

      const resolvedModels = Array.from(mergedModels.values()).map((model) => {
        this.providerSettings.ensureModelStatus(this.provider.id, model.name, true)
        return this.resolveOllamaModelMeta(model)
      })

      return resolvedModels
    } catch (error) {
      console.error('Failed to fetch Ollama models:', error)
      return this.providerSettings.getDbProviderModels(this.provider.id).map((model) => ({
        id: model.id,
        name: model.name,
        providerId: this.provider.id,
        isCustom: false,
        group: model.group || 'default',
        description: undefined
      }))
    }
  }

  public async check(): Promise<{ isOk: boolean; errorMsg: string | null }> {
    try {
      await this.ollama.list()
      return { isOk: true, errorMsg: null }
    } catch (error) {
      return {
        isOk: false,
        errorMsg: `Unable to connect to Ollama service: ${(error as Error).message}`
      }
    }
  }

  public async summaryTitles(messages: ChatMessage[], modelId: string): Promise<string> {
    const prompt = `${SUMMARY_TITLES_PROMPT}\n\n${messages.map((m) => `${m.role}: ${m.content}`).join('\n')}`
    const modelConfig = this.providerSettings.getModelConfig(modelId, this.provider.id)
    const response = await runAiSdkGenerateText(
      this.getAiSdkRuntimeContext(modelId, modelConfig),
      [{ role: 'user', content: prompt }],
      modelId,
      modelConfig,
      0.3,
      30
    )

    return response.content.trim() || 'New Conversation'
  }

  public async completions(
    messages: ChatMessage[],
    modelId: string,
    temperature?: number,
    maxTokens?: number
  ): Promise<LLMResponse> {
    const modelConfig = this.providerSettings.getModelConfig(modelId, this.provider.id)
    return runAiSdkGenerateText(
      this.getAiSdkRuntimeContext(modelId, modelConfig),
      messages,
      modelId,
      modelConfig,
      temperature,
      maxTokens
    )
  }

  public async summaries(
    text: string,
    modelId: string,
    temperature?: number,
    maxTokens?: number
  ): Promise<LLMResponse> {
    const modelConfig = this.providerSettings.getModelConfig(modelId, this.provider.id)
    return runAiSdkGenerateText(
      this.getAiSdkRuntimeContext(modelId, modelConfig),
      [{ role: 'user', content: `Please summarize the following content:\n\n${text}` }],
      modelId,
      modelConfig,
      temperature ?? 0.5,
      maxTokens
    )
  }

  public async generateText(
    prompt: string,
    modelId: string,
    temperature?: number,
    maxTokens?: number,
    options?: ProviderGenerateTextOptions
  ): Promise<LLMResponse> {
    const modelConfig = this.providerSettings.getModelConfig(modelId, this.provider.id)
    if (options?.signal) {
      return runAiSdkGenerateText(
        this.getAiSdkRuntimeContext(modelId, modelConfig),
        [{ role: 'user', content: prompt }],
        modelId,
        modelConfig,
        temperature,
        maxTokens,
        options.signal
      )
    }
    return runAiSdkGenerateText(
      this.getAiSdkRuntimeContext(modelId, modelConfig),
      [{ role: 'user', content: prompt }],
      modelId,
      modelConfig,
      temperature,
      maxTokens
    )
  }

  public async suggestions(
    context: string,
    modelId: string,
    temperature?: number,
    maxTokens?: number
  ): Promise<string[]> {
    const response = await this.generateText(
      `Based on the following context, generate 5 possible follow-up questions or suggestions, one per line:\n\n${context}`,
      modelId,
      temperature ?? 0.8,
      maxTokens ?? 200
    )

    return response.content
      .split('\n')
      .map((line) => line.trim())
      .filter(Boolean)
      .slice(0, 5)
  }

  private async attachModelInfo(model: OllamaModel): Promise<OllamaModel> {
    try {
      const showResponse = await this.showModelInfo(model.name)
      const entries = this.getModelInfoEntries(showResponse.model_info)
      const family = model.details.family
      const architecture = this.findModelInfoString(entries, 'general.architecture')
      const exactPrefixes = Array.from(new Set([family, architecture].filter(Boolean) as string[]))
      const contextLength = this.findModelInfoNumber(
        entries,
        exactPrefixes.map((prefix) => `${prefix}.context_length`),
        (key) =>
          key.endsWith('.context_length') && !key.includes('.vision.') && !key.includes('.audio.')
      )
      const embeddingLength = this.findModelInfoNumber(
        entries,
        exactPrefixes.map((prefix) => `${prefix}.embedding_length`),
        (key) =>
          key.endsWith('.embedding_length') && !key.includes('.vision.') && !key.includes('.audio.')
      )
      const visionEmbeddingLength = this.findModelInfoNumber(
        entries,
        exactPrefixes.map((prefix) => `${prefix}.vision.embedding_length`),
        (key) => key.includes('.vision.') && key.endsWith('.embedding_length')
      )
      const fileType = this.findModelInfoValue(entries, 'general.file_type')
      const parameterCount = this.findModelInfoValue(entries, 'general.parameter_count')
      const quantizationVersion = this.findModelInfoValue(entries, 'general.quantization_version')
      const general = {
        ...(architecture ? { architecture } : {}),
        ...(typeof fileType === 'string'
          ? { file_type: fileType }
          : typeof fileType === 'number'
            ? { file_type: String(fileType) }
            : {}),
        ...(typeof parameterCount === 'number' ? { parameter_count: parameterCount } : {}),
        ...(typeof quantizationVersion === 'number'
          ? { quantization_version: quantizationVersion }
          : {})
      }
      const capabilities = this.normalizeCapabilities(showResponse.capabilities)

      return {
        ...model,
        details: {
          ...model.details,
          ...showResponse.details
        },
        model_info: this.mergeModelInfo(
          {
            ...(contextLength !== undefined ? { context_length: contextLength } : {}),
            ...(embeddingLength !== undefined ? { embedding_length: embeddingLength } : {}),
            ...(visionEmbeddingLength
              ? { vision: { embedding_length: visionEmbeddingLength } }
              : {}),
            ...(Object.keys(general).length > 0 ? { general } : {})
          },
          model.model_info
        ),
        ...(capabilities !== undefined ? { capabilities } : {})
      }
    } catch (error) {
      console.warn(
        `Failed to get info for model ${model.name}, preserving sparse metadata:`,
        (error as Error).message
      )
      return model
    }
  }

  public async listModels(): Promise<OllamaModel[]> {
    const [sdkModels, cliModels] = await Promise.all([
      this.listModelsFromSdk().catch(() => [] as OllamaModel[]),
      this.listModelsFromCli()
    ])

    try {
      const models = this.alignModelsWithCliList(sdkModels, cliModels)
      const enrichedModels = await Promise.all(
        models.map(async (model) => this.attachModelInfo(model))
      )
      return enrichedModels
    } catch {
      return this.alignModelsWithCliList(sdkModels, cliModels)
    }
  }

  public async listRunningModels(): Promise<OllamaModel[]> {
    try {
      const runningModels = await this.listRuntimeModels()
      return await Promise.all(runningModels.map(async (model) => this.attachModelInfo(model)))
    } catch {
      return []
    }
  }

  public override async getRuntimeContextLimitTokens(
    modelId: string,
    signal?: AbortSignal
  ): Promise<number | undefined> {
    signal?.throwIfAborted()
    const timeoutController = new AbortController()
    let timeoutId: ReturnType<typeof setTimeout> | undefined
    try {
      timeoutId = setTimeout(() => {
        timeoutController.abort(
          new Error(
            `Timed out after ${OLLAMA_RUNTIME_CONTEXT_TIMEOUT_MS}ms while reading Ollama runtime models`
          )
        )
      }, OLLAMA_RUNTIME_CONTEXT_TIMEOUT_MS)
      const requestSignal = signal
        ? AbortSignal.any([signal, timeoutController.signal])
        : timeoutController.signal
      const runningModels = await this.listRuntimeModels(this.createOllamaClient(requestSignal))
      const matchingModels = runningModels.filter((model) =>
        this.matchesRequestedModelName(model.name, modelId)
      )
      if (matchingModels.length === 0) return undefined

      const matchingLimits = matchingModels
        .map((model) => model.runtimeContextLength)
        .filter((value): value is number => value !== undefined)
      if (matchingLimits.length === 0) {
        throw new Error(
          'Ollama did not expose runtime context_length for the running model. Upgrade Ollama to v0.9.7 or newer.'
        )
      }
      return Math.min(...matchingLimits)
    } catch (error) {
      signal?.throwIfAborted()
      const cause = timeoutController.signal.aborted ? timeoutController.signal.reason : error
      throw new Error(
        `Failed to read the Ollama runtime context for ${modelId}: ${
          cause instanceof Error ? cause.message : String(cause)
        }`,
        { cause }
      )
    } finally {
      if (timeoutId !== undefined) clearTimeout(timeoutId)
    }
  }

  public async pullModel(
    modelName: string,
    onProgress?: (progress: ProgressResponse) => void
  ): Promise<boolean> {
    await this.waitForDrainIfNeeded()

    const finishStream = this.beginActiveStream()
    try {
      const stream = await this.ollama.pull({
        model: modelName,
        insecure: isInsecureTlsAllowed(),
        stream: true
      })

      for await (const chunk of stream) {
        onProgress?.(chunk as ProgressResponse)
      }

      const localModels = await this.listModels()
      return localModels.some((model) => this.matchesRequestedModelName(model.name, modelName))
    } catch {
      return false
    } finally {
      finishStream()
    }
  }

  public async showModelInfo(modelName: string): Promise<ShowResponse> {
    try {
      return await this.ollama.show({
        model: modelName
      })
    } catch (error) {
      console.error(`Failed to show Ollama model info for ${modelName}:`, (error as Error).message)
      throw error
    }
  }

  async *coreStream(
    messages: ChatMessage[],
    modelId: string,
    modelConfig: ModelConfig,
    temperature: number,
    maxTokens: number,
    mcpTools: MCPToolDefinition[],
    options?: ProviderStreamOptions
  ): AsyncGenerator<LLMCoreStreamEvent> {
    yield* runAiSdkCoreStream(
      this.getAiSdkRuntimeContext(modelId, modelConfig),
      messages,
      modelId,
      modelConfig,
      temperature,
      maxTokens,
      mcpTools,
      options?.signal
    )
  }

  async getEmbeddings(modelId: string, texts: string[], signal?: AbortSignal): Promise<number[][]> {
    return runAiSdkEmbeddings(this.getAiSdkRuntimeContext(modelId), modelId, texts, signal)
  }

  async getDimensions(modelId: string, signal?: AbortSignal): Promise<LLM_EMBEDDING_ATTRS> {
    return runAiSdkDimensions(this.getAiSdkRuntimeContext(modelId), modelId, signal)
  }
}
