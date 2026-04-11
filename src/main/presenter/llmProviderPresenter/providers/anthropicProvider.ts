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
import { BaseLLMProvider, SUMMARY_TITLES_PROMPT } from '../baseProvider'
import { runAiSdkCoreStream, runAiSdkGenerateText, type AiSdkRuntimeContext } from '../aiSdk'
import type { ProviderMcpRuntimePort } from '../runtimePorts'

export class AnthropicProvider extends BaseLLMProvider {
  private readonly defaultModel = 'claude-sonnet-4-5-20250929'

  constructor(
    provider: LLM_PROVIDER,
    configPresenter: IConfigPresenter,
    mcpRuntime?: ProviderMcpRuntimePort
  ) {
    super(provider, configPresenter, mcpRuntime)
    this.init()
  }

  protected getAiSdkRuntimeContext(): AiSdkRuntimeContext {
    return {
      providerKind: 'anthropic',
      provider: this.provider,
      configPresenter: this.configPresenter,
      defaultHeaders: this.defaultHeaders,
      buildLegacyFunctionCallPrompt: (tools) => this.getFunctionCallWrapPrompt(tools),
      emitRequestTrace: (modelConfig, payload) => this.emitRequestTrace(modelConfig, payload),
      supportsNativeTools: (_modelId, modelConfig) => modelConfig.functionCall === true
    }
  }

  private resolveApiKey(): string | null {
    return this.provider.apiKey || process.env.ANTHROPIC_API_KEY || null
  }

  public onProxyResolved(): void {}

  protected async fetchProviderModels(): Promise<MODEL_META[]> {
    return this.configPresenter.getDbProviderModels(this.provider.id).map((model) => ({
      id: model.id,
      name: model.name,
      providerId: this.provider.id,
      maxTokens: model.maxTokens,
      group: model.group || 'default',
      isCustom: false,
      contextLength: model.contextLength,
      vision: model.vision || false,
      functionCall: model.functionCall || false,
      reasoning: model.reasoning || false,
      ...(model.type ? { type: model.type } : {})
    }))
  }

  public async check(): Promise<{ isOk: boolean; errorMsg: string | null }> {
    if (!this.resolveApiKey()) {
      return { isOk: false, errorMsg: 'Missing API key' }
    }

    try {
      await runAiSdkGenerateText(
        this.getAiSdkRuntimeContext(),
        [{ role: 'user', content: 'Hello' }],
        this.defaultModel,
        this.configPresenter.getModelConfig(this.defaultModel, this.provider.id),
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
      0.3,
      50
    )

    return response.content.trim()
  }

  async completions(
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
    maxTokens?: number,
    systemPrompt?: string
  ): Promise<LLMResponse> {
    const messages: ChatMessage[] = [
      ...(systemPrompt ? [{ role: 'system' as const, content: systemPrompt }] : []),
      {
        role: 'user',
        content: `请对以下内容进行摘要:\n\n${text}\n\n请提供一个简洁明了的摘要。`
      }
    ]

    return runAiSdkGenerateText(
      this.getAiSdkRuntimeContext(),
      messages,
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
    maxTokens?: number,
    systemPrompt?: string
  ): Promise<LLMResponse> {
    const messages: ChatMessage[] = [
      ...(systemPrompt ? [{ role: 'system' as const, content: systemPrompt }] : []),
      { role: 'user', content: prompt }
    ]

    return runAiSdkGenerateText(
      this.getAiSdkRuntimeContext(),
      messages,
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
    maxTokens?: number,
    systemPrompt?: string
  ): Promise<string[]> {
    const response = await this.generateText(
      `根据下面的上下文，给出3个可能的回复建议，每个建议一行，不要有编号或者额外的解释：\n\n${context}`,
      modelId,
      temperature ?? 0.7,
      maxTokens ?? 128,
      systemPrompt
    )

    return response.content
      .split('\n')
      .map((line) => line.trim())
      .filter(Boolean)
      .slice(0, 3)
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
}
