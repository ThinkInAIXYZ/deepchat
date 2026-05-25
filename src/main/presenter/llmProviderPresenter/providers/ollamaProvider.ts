import {
  ChatMessage,
  IConfigPresenter,
  LLM_EMBEDDING_ATTRS,
  LLM_PROVIDER,
  LLMCoreStreamEvent,
  LLMResponse,
  MCPToolDefinition,
  MODEL_META,
  ModelConfig,
  OllamaModel,
  ProgressResponse
} from '@shared/presenter'
import { ModelType } from '@shared/model'
import { DEFAULT_MODEL_CONTEXT_LENGTH, DEFAULT_MODEL_MAX_TOKENS } from '@shared/modelConfigDefaults'
import { BaseLLMProvider, SUMMARY_TITLES_PROMPT } from '../baseProvider'
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
import type { ProviderMcpRuntimePort } from '../runtimePorts'
import { isInsecureTlsAllowed } from '@/lib/insecureTls'

const OLLAMA_LIST_TIMEOUT_MS = 5000

export class OllamaProvider extends BaseLLMProvider {
  private static readonly CONFIG_DRAIN_TIMEOUT_MS = 1500

  private ollama: Ollama
  private activeStreams = 0
  private activeStreamResolvers: Array<() => void> = []
  private isDraining = false
  private configUpdateChain: Promise<void> = Promise.resolve()

  constructor(
    provider: LLM_PROVIDER,
    configPresenter: IConfigPresenter,
    mcpRuntime?: ProviderMcpRuntimePort
  ) {
    super(provider, configPresenter, mcpRuntime)
    this.ollama = this.createOllamaClient()
    this.init()
  }

  private createOllamaClient(): Ollama {
    const host = normalizeOllamaSdkHost(this.provider.baseUrl)

    if (this.provider.apiKey) {
      return new Ollama({
        host,
        headers: { Authorization: `Bearer ${this.provider.apiKey}` }
      })
    }

    return new Ollama({
      host
    })
  }

  protected getAiSdkRuntimeContext(): AiSdkRuntimeContext {
    return {
      providerKind: 'openai-compatible',
      provider: {
        ...this.provider,
        baseUrl: normalizeOllamaOpenAIBaseUrl(this.provider.baseUrl)
      },
      configPresenter: this.configPresenter,
      defaultHeaders: this.defaultHeaders,
      buildLegacyFunctionCallPrompt: (tools) => this.getFunctionCallWrapPrompt(tools),
      emitRequestTrace: (modelConfig, payload) => this.emitRequestTrace(modelConfig, payload),
      supportsNativeTools: (_modelId, modelConfig) => modelConfig.functionCall === true
    }
  }

  private mergeCapabilities(...sources: Array<string[] | undefined>): string[] {
    return Array.from(new Set(sources.flatMap((source) => (Array.isArray(source) ? source : []))))
  }

  private normalizeCapabilities(capabilities?: string[]): string[] {
    const capabilitySet = new Set(Array.isArray(capabilities) ? capabilities.filter(Boolean) : [])
    if (capabilitySet.size === 0) {
      capabilitySet.add('chat')
    }
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
      },
      capabilities: ['chat']
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
    return (
      actualModelName === requestedModelName ||
      (!requestedModelName.includes(':') && actualModelName === `${requestedModelName}:latest`)
    )
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

  private resolveOllamaModelMeta(model: OllamaModel, cachedModel?: MODEL_META): MODEL_META {
    const capabilitySet = new Set(
      this.mergeCapabilities(
        model.capabilities,
        cachedModel?.type === ModelType.Embedding ? ['embedding'] : undefined,
        cachedModel?.vision ? ['vision'] : undefined,
        cachedModel?.functionCall ? ['tools'] : undefined,
        cachedModel?.reasoning ? ['thinking'] : undefined
      )
    )

    const resolvedType = capabilitySet.has('embedding')
      ? ModelType.Embedding
      : (cachedModel?.type ?? ModelType.Chat)

    const family = model.details?.family || cachedModel?.group || 'default'
    const parameterSize = model.details?.parameter_size || ''
    const description = `${parameterSize} ${family} model`.trim()

    return {
      id: model.name,
      name: model.name,
      providerId: this.provider.id,
      contextLength:
        model.model_info?.context_length ??
        cachedModel?.contextLength ??
        DEFAULT_MODEL_CONTEXT_LENGTH,
      maxTokens: cachedModel?.maxTokens ?? DEFAULT_MODEL_MAX_TOKENS,
      isCustom: false,
      group: family,
      description,
      vision: capabilitySet.has('vision') || Boolean(model.model_info?.vision?.embedding_length),
      functionCall: capabilitySet.has('tools'),
      reasoning: capabilitySet.has('thinking'),
      type: resolvedType
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

      const cachedModels = new Map(
        this.configPresenter.getProviderModels(this.provider.id).map((model) => [model.id, model])
      )

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
        this.configPresenter.ensureModelStatus(this.provider.id, model.name, true)
        return this.resolveOllamaModelMeta(model, cachedModels.get(model.name))
      })

      return resolvedModels
    } catch (error) {
      console.error('Failed to fetch Ollama models:', error)
      return this.configPresenter.getDbProviderModels(this.provider.id).map((model) => ({
        id: model.id,
        name: model.name,
        providerId: this.provider.id,
        contextLength: model.contextLength,
        maxTokens: model.maxTokens,
        isCustom: false,
        group: model.group || 'default',
        description: undefined,
        vision: model.vision || false,
        functionCall: model.functionCall || false,
        reasoning: model.reasoning || false,
        ...(model.type ? { type: model.type } : {})
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
    const response = await runAiSdkGenerateText(
      this.getAiSdkRuntimeContext(),
      [{ role: 'user', content: prompt }],
      modelId,
      this.configPresenter.getModelConfig(modelId, this.provider.id),
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
    return runAiSdkGenerateText(
      this.getAiSdkRuntimeContext(),
      messages,
      modelId,
      this.configPresenter.getModelConfig(modelId, this.provider.id),
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
    return runAiSdkGenerateText(
      this.getAiSdkRuntimeContext(),
      [{ role: 'user', content: `Please summarize the following content:\n\n${text}` }],
      modelId,
      this.configPresenter.getModelConfig(modelId, this.provider.id),
      temperature ?? 0.5,
      maxTokens
    )
  }

  public async generateText(
    prompt: string,
    modelId: string,
    temperature?: number,
    maxTokens?: number
  ): Promise<LLMResponse> {
    return runAiSdkGenerateText(
      this.getAiSdkRuntimeContext(),
      [{ role: 'user', content: prompt }],
      modelId,
      this.configPresenter.getModelConfig(modelId, this.provider.id),
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
      const context_length =
        this.findModelInfoNumber(
          entries,
          exactPrefixes.map((prefix) => `${prefix}.context_length`),
          (key) =>
            key.endsWith('.context_length') && !key.includes('.vision.') && !key.includes('.audio.')
        ) ?? DEFAULT_MODEL_CONTEXT_LENGTH
      const embedding_length =
        this.findModelInfoNumber(
          entries,
          exactPrefixes.map((prefix) => `${prefix}.embedding_length`),
          (key) =>
            key.endsWith('.embedding_length') &&
            !key.includes('.vision.') &&
            !key.includes('.audio.')
        ) ?? 512
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
        model_info: {
          context_length,
          embedding_length,
          ...(visionEmbeddingLength ? { vision: { embedding_length: visionEmbeddingLength } } : {}),
          ...(Object.keys(general).length > 0 ? { general } : {})
        },
        capabilities
      }
    } catch (error) {
      console.warn(
        `Failed to get info for model ${model.name}, using defaults:`,
        (error as Error).message
      )
      return {
        ...model,
        model_info: {
          context_length: 4096,
          embedding_length: 512
        },
        capabilities: this.normalizeCapabilities(['chat'])
      }
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
      const response = await this.ollama.ps()
      const runningModels = response.models as unknown as OllamaModel[]
      return await Promise.all(runningModels.map(async (model) => this.attachModelInfo(model)))
    } catch {
      return []
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
    mcpTools: MCPToolDefinition[]
  ): AsyncGenerator<LLMCoreStreamEvent> {
    yield* runAiSdkCoreStream(
      this.getAiSdkRuntimeContext(),
      messages,
      modelId,
      modelConfig,
      temperature,
      maxTokens,
      mcpTools
    )
  }

  async getEmbeddings(modelId: string, texts: string[]): Promise<number[][]> {
    return runAiSdkEmbeddings(this.getAiSdkRuntimeContext(), modelId, texts)
  }

  async getDimensions(modelId: string): Promise<LLM_EMBEDDING_ATTRS> {
    return runAiSdkDimensions(this.getAiSdkRuntimeContext(), modelId)
  }
}
