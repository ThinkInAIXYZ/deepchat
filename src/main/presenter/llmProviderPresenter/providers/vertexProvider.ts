import {
  ChatMessage,
  IConfigPresenter,
  LLM_PROVIDER,
  LLMCoreStreamEvent,
  LLMResponse,
  MCPToolDefinition,
  MODEL_META,
  ModelConfig
} from '@shared/presenter'
import { VERTEX_PROVIDER } from '@shared/types/presenters/llmprovider.presenter'
import { BaseLLMProvider, SUMMARY_TITLES_PROMPT } from '../baseProvider'
import {
  runAiSdkCoreStream,
  runAiSdkEmbeddings,
  runAiSdkGenerateText,
  type AiSdkRuntimeContext
} from '../aiSdk'
import type { ProviderMcpRuntimePort } from '../runtimePorts'

export class VertexProvider extends BaseLLMProvider {
  constructor(
    provider: LLM_PROVIDER,
    configPresenter: IConfigPresenter,
    mcpRuntime?: ProviderMcpRuntimePort
  ) {
    super(provider, configPresenter, mcpRuntime)
    this.init()
  }

  private get vertexProvider(): VERTEX_PROVIDER {
    return this.provider as VERTEX_PROVIDER
  }

  protected getAiSdkRuntimeContext(): AiSdkRuntimeContext {
    return {
      providerKind: 'vertex',
      provider: this.provider,
      configPresenter: this.configPresenter,
      defaultHeaders: this.defaultHeaders,
      buildLegacyFunctionCallPrompt: (tools) => this.getFunctionCallWrapPrompt(tools),
      emitRequestTrace: (modelConfig, payload) => this.emitRequestTrace(modelConfig, payload),
      supportsNativeTools: (_modelId, modelConfig) => modelConfig.functionCall === true,
      shouldUseImageGeneration: (_modelId, modelConfig) => modelConfig.apiEndpoint === 'image'
    }
  }

  private hasVertexCredentials(): boolean {
    return Boolean(
      this.vertexProvider.projectId &&
      this.vertexProvider.location &&
      (this.vertexProvider.apiKey ||
        (this.vertexProvider.accountClientEmail && this.vertexProvider.accountPrivateKey))
    )
  }

  public onProxyResolved(): void {}

  protected async fetchProviderModels(): Promise<MODEL_META[]> {
    return this.configPresenter.getDbProviderModels(this.provider.id).map((model) => ({
      id: model.id,
      name: model.name,
      group: model.group || 'default',
      providerId: this.provider.id,
      isCustom: false,
      contextLength: model.contextLength,
      maxTokens: model.maxTokens,
      vision: model.vision || false,
      functionCall: model.functionCall || false,
      reasoning: model.reasoning || false,
      ...(model.type ? { type: model.type } : {})
    }))
  }

  public async check(): Promise<{ isOk: boolean; errorMsg: string | null }> {
    if (!this.hasVertexCredentials()) {
      return {
        isOk: false,
        errorMsg: 'projectId, location, and API credentials are required for Vertex AI'
      }
    }

    const modelId = this.models[0]?.id || 'gemini-1.5-flash-001'

    try {
      await runAiSdkGenerateText(
        this.getAiSdkRuntimeContext(),
        [{ role: 'user', content: 'Hello from Vertex AI' }],
        modelId,
        this.configPresenter.getModelConfig(modelId, this.provider.id),
        0.2,
        16
      )

      return { isOk: true, errorMsg: null }
    } catch (error: unknown) {
      return {
        isOk: false,
        errorMsg: error instanceof Error ? error.message : String(error)
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
      0.4
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

  async summaries(
    text: string,
    modelId: string,
    temperature?: number,
    maxTokens?: number
  ): Promise<LLMResponse> {
    return runAiSdkGenerateText(
      this.getAiSdkRuntimeContext(),
      [
        {
          role: 'user',
          content: `Please generate a concise summary for the following content:\n\n${text}`
        }
      ],
      modelId,
      this.configPresenter.getModelConfig(modelId, this.provider.id),
      temperature,
      maxTokens
    )
  }

  async generateText(
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

  async suggestions(
    context: string,
    modelId: string,
    temperature?: number,
    maxTokens?: number
  ): Promise<string[]> {
    const response = await this.generateText(
      `Based on the following context, please provide up to 5 reasonable suggestion options, each on a new line without numbering:\n\n${context}`,
      modelId,
      temperature ?? 0.7,
      maxTokens ?? 128
    )

    return response.content
      .split('\n')
      .map((line) => line.trim())
      .filter(Boolean)
      .slice(0, 5)
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
}
