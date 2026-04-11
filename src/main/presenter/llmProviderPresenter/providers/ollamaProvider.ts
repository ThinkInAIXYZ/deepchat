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
import { Ollama, ShowResponse } from 'ollama'
import {
  runAiSdkCoreStream,
  runAiSdkDimensions,
  runAiSdkEmbeddings,
  runAiSdkGenerateText,
  type AiSdkRuntimeContext
} from '../aiSdk'
import type { ProviderMcpRuntimePort } from '../runtimePorts'

export class OllamaProvider extends BaseLLMProvider {
  private ollama: Ollama

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
    if (this.provider.apiKey) {
      return new Ollama({
        host: this.provider.baseUrl,
        headers: { Authorization: `Bearer ${this.provider.apiKey}` }
      })
    }

    return new Ollama({
      host: this.provider.baseUrl
    })
  }

  protected getAiSdkRuntimeContext(): AiSdkRuntimeContext {
    return {
      providerKind: 'ollama',
      provider: this.provider,
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
      const info = showResponse.model_info
      const family = model.details.family
      const context_length = info?.[family + '.context_length'] ?? DEFAULT_MODEL_CONTEXT_LENGTH
      const embedding_length = info?.[family + '.embedding_length'] ?? 512
      const capabilities = showResponse.capabilities ?? ['chat']

      return {
        ...model,
        model_info: {
          context_length,
          embedding_length
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
        capabilities: ['chat']
      }
    }
  }

  public async listModels(): Promise<OllamaModel[]> {
    try {
      const response = await this.ollama.list()
      const models = response.models as unknown as OllamaModel[]
      return await Promise.all(models.map(async (model) => this.attachModelInfo(model)))
    } catch (error) {
      console.error('Failed to list Ollama models:', (error as Error).message)
      return []
    }
  }

  public async listRunningModels(): Promise<OllamaModel[]> {
    try {
      const response = await this.ollama.ps()
      const runningModels = response.models as unknown as OllamaModel[]
      return await Promise.all(runningModels.map(async (model) => this.attachModelInfo(model)))
    } catch (error) {
      console.error('Failed to list running Ollama models:', (error as Error).message)
      return []
    }
  }

  public async pullModel(
    modelName: string,
    onProgress?: (progress: ProgressResponse) => void
  ): Promise<boolean> {
    try {
      const stream = await this.ollama.pull({
        model: modelName,
        insecure: true,
        stream: true
      })

      for await (const chunk of stream) {
        onProgress?.(chunk as ProgressResponse)
      }

      return true
    } catch (error) {
      console.error(`Failed to pull Ollama model ${modelName}:`, (error as Error).message)
      return false
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
