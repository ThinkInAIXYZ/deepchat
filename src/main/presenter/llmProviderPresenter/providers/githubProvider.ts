import {
  LLM_PROVIDER,
  LLMResponse,
  MODEL_META,
  ChatMessage,
  IConfigPresenter
} from '@shared/presenter'
import { DEFAULT_MODEL_CONTEXT_LENGTH, DEFAULT_MODEL_MAX_TOKENS } from '@shared/modelConfigDefaults'
import { OpenAICompatibleProvider } from './openAICompatibleProvider'
import type { ProviderMcpRuntimePort } from '../runtimePorts'

export class GithubProvider extends OpenAICompatibleProvider {
  constructor(
    provider: LLM_PROVIDER,
    configPresenter: IConfigPresenter,
    mcpRuntime?: ProviderMcpRuntimePort
  ) {
    super(provider, configPresenter, mcpRuntime)
  }
  protected async fetchOpenAIModels(options?: { timeout: number }): Promise<MODEL_META[]> {
    const response = await this.fetchOpenAIModelRecords(options)
    return response
      .filter((model) => typeof model.name === 'string')
      .map((model) => ({
        id: model.name as string,
        name: model.name as string,
        group: 'default',
        providerId: this.provider.id,
        isCustom: false,
        contextLength: DEFAULT_MODEL_CONTEXT_LENGTH,
        maxTokens: DEFAULT_MODEL_MAX_TOKENS,
        description: typeof model.description === 'string' ? model.description : undefined
      }))
  }
  async completions(
    messages: ChatMessage[],
    modelId: string,
    temperature?: number,
    maxTokens?: number
  ): Promise<LLMResponse> {
    return this.openAICompletion(messages, modelId, temperature, maxTokens)
  }

  async generateText(
    prompt: string,
    modelId: string,
    temperature?: number,
    maxTokens?: number
  ): Promise<LLMResponse> {
    return this.openAICompletion(
      [
        {
          role: 'user',
          content: prompt
        }
      ],
      modelId,
      temperature,
      maxTokens
    )
  }
}
