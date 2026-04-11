import {
  AWS_BEDROCK_PROVIDER,
  ChatMessage,
  IConfigPresenter,
  LLMCoreStreamEvent,
  LLMResponse,
  MCPToolDefinition,
  MODEL_META,
  ModelConfig
} from '@shared/presenter'
import { BedrockClient, ListFoundationModelsCommand } from '@aws-sdk/client-bedrock'
import { BaseLLMProvider, SUMMARY_TITLES_PROMPT } from '../baseProvider'
import { runAiSdkCoreStream, runAiSdkGenerateText, type AiSdkRuntimeContext } from '../aiSdk'
import type { ProviderMcpRuntimePort } from '../runtimePorts'

export class AwsBedrockProvider extends BaseLLMProvider {
  private bedrock!: BedrockClient
  private readonly defaultModel = 'anthropic.claude-3-5-sonnet-20240620-v1:0'

  constructor(
    provider: AWS_BEDROCK_PROVIDER,
    configPresenter: IConfigPresenter,
    mcpRuntime?: ProviderMcpRuntimePort
  ) {
    super(provider, configPresenter, mcpRuntime)
    this.init()
  }

  protected getAiSdkRuntimeContext(): AiSdkRuntimeContext {
    return {
      providerKind: 'aws-bedrock',
      provider: this.provider,
      configPresenter: this.configPresenter,
      defaultHeaders: this.defaultHeaders,
      buildLegacyFunctionCallPrompt: (tools) => this.getFunctionCallWrapPrompt(tools),
      emitRequestTrace: (modelConfig, payload) => this.emitRequestTrace(modelConfig, payload),
      supportsNativeTools: (_modelId, modelConfig) => modelConfig.functionCall === true
    }
  }

  private getCredentials() {
    const provider = this.provider as AWS_BEDROCK_PROVIDER
    const accessKeyId = provider.credential?.accessKeyId || process.env.BEDROCK_ACCESS_KEY_ID
    const secretAccessKey =
      provider.credential?.secretAccessKey || process.env.BEDROCK_SECRET_ACCESS_KEY
    const region = provider.credential?.region || process.env.BEDROCK_REGION

    if (!accessKeyId || !secretAccessKey || !region) {
      return null
    }

    return {
      accessKeyId,
      secretAccessKey,
      region
    }
  }

  public onProxyResolved(): void {}

  protected async init() {
    const credentials = this.getCredentials()
    if (!credentials) {
      return
    }

    this.bedrock = new BedrockClient({
      credentials: {
        accessKeyId: credentials.accessKeyId,
        secretAccessKey: credentials.secretAccessKey
      },
      region: credentials.region
    })

    await super.init()
  }

  protected async fetchProviderModels(): Promise<MODEL_META[]> {
    try {
      const credentials = this.getCredentials()
      if (!credentials) {
        throw new Error('Missing AWS Bedrock credentials')
      }

      const region = await this.bedrock.config.region()
      const command = new ListFoundationModelsCommand({})
      const response = await this.bedrock.send(command)
      const models = response.modelSummaries

      return (
        models
          ?.filter(
            (model) => model.modelId && /^anthropic.claude-[a-z0-9-]+(:\d+)$/g.test(model.modelId)
          )
          ?.filter((model) => model.modelLifecycle?.status === 'ACTIVE')
          ?.filter(
            (model) => model.inferenceTypesSupported && model.inferenceTypesSupported.length > 0
          )
          .map<MODEL_META>((model) => ({
            id: model.inferenceTypesSupported?.includes('ON_DEMAND')
              ? model.modelId!
              : `${region.split('-')[0]}.${model.modelId}`,
            name: model.modelId?.replace('anthropic.', '') || '<Unknown>',
            providerId: this.provider.id,
            maxTokens: 64_000,
            group: `AWS Bedrock Claude - ${
              model.modelId?.includes('opus')
                ? 'opus'
                : model.modelId?.includes('sonnet')
                  ? 'sonnet'
                  : model.modelId?.includes('haiku')
                    ? 'haiku'
                    : 'other'
            }`,
            isCustom: false,
            contextLength: 200_000,
            vision: false,
            functionCall: false,
            reasoning: false
          })) || []
      )
    } catch (error) {
      console.error('获取AWS Bedrock Anthropic模型列表出错:', error)
      return this.configPresenter
        .getDbProviderModels('amazon-bedrock')
        .filter((model) => model.id.startsWith('anthropic.'))
        .map((model) => ({
          id: model.id,
          name: model.name,
          providerId: this.provider.id,
          maxTokens: model.maxTokens,
          group: model.group || 'Bedrock Claude',
          isCustom: false,
          contextLength: model.contextLength,
          vision: model.vision || false,
          functionCall: model.functionCall || false,
          reasoning: model.reasoning || false,
          ...(model.type ? { type: model.type } : {})
        }))
    }
  }

  public async check(): Promise<{ isOk: boolean; errorMsg: string | null }> {
    if (!this.getCredentials()) {
      return { isOk: false, errorMsg: 'Missing AWS Bedrock credentials' }
    }

    try {
      await runAiSdkGenerateText(
        this.getAiSdkRuntimeContext(),
        [{ role: 'user', content: 'Hi' }],
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

  async suggestions(
    context: string,
    modelId: string,
    temperature?: number,
    maxTokens?: number
  ): Promise<string[]> {
    const response = await this.generateText(
      `根据下面的上下文，给出3个可能的回复建议，每个建议一行，不要有编号或者额外的解释：\n\n${context}`,
      modelId,
      temperature ?? 0.7,
      maxTokens ?? 128
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
