import {
  LLM_PROVIDER,
  LLMResponse,
  MODEL_META,
  ChatMessage,
  IConfigPresenter,
  LLMCoreStreamEvent,
  ModelConfig,
  MCPToolDefinition
} from '@shared/presenter'
import { ModelType } from '@shared/model'
import {
  resolveModelContextLength,
  resolveModelFunctionCall,
  resolveModelMaxTokens
} from '@shared/modelConfigDefaults'
import { OpenAICompatibleProvider } from './openAICompatibleProvider'
import { providerDbLoader } from '../../configPresenter/providerDbLoader'
import type { ProviderMcpRuntimePort } from '../runtimePorts'

const DOUBAO_THINKING_NOTE = 'doubao-thinking-parameter'

export class DoubaoProvider extends OpenAICompatibleProvider {
  constructor(
    provider: LLM_PROVIDER,
    configPresenter: IConfigPresenter,
    mcpRuntime?: ProviderMcpRuntimePort
  ) {
    // Initialize Doubao model configuration
    super(provider, configPresenter, mcpRuntime)
  }

  private supportsThinking(modelId: string): boolean {
    const model = providerDbLoader.getModel(this.provider.id, modelId)
    const notes = model?.extra_capabilities?.reasoning?.notes
    return Array.isArray(notes) && notes.includes(DOUBAO_THINKING_NOTE)
  }

  /**
   * Override coreStream method to support Doubao's thinking parameter
   */
  async *coreStream(
    messages: ChatMessage[],
    modelId: string,
    modelConfig: ModelConfig,
    temperature: number,
    maxTokens: number,
    mcpTools: MCPToolDefinition[]
  ): AsyncGenerator<LLMCoreStreamEvent> {
    if (!this.isInitialized) throw new Error('Provider not initialized')
    if (!modelId) throw new Error('Model ID is required')

    const shouldAddThinking = this.supportsThinking(modelId) && modelConfig?.reasoning

    if (shouldAddThinking) {
      // Original create method
      const originalCreate = this.openai.chat.completions.create.bind(this.openai.chat.completions)
      // Replace create method to add thinking parameter
      this.openai.chat.completions.create = ((params: any, options?: any) => {
        const modifiedParams = {
          ...params,
          thinking: {
            type: 'enabled'
          }
        }
        return originalCreate(modifiedParams, options)
      }) as any

      try {
        const effectiveModelConfig = { ...modelConfig, reasoning: false }
        yield* super.coreStream(
          messages,
          modelId,
          effectiveModelConfig,
          temperature,
          maxTokens,
          mcpTools
        )
      } finally {
        this.openai.chat.completions.create = originalCreate
      }
    } else {
      yield* super.coreStream(messages, modelId, modelConfig, temperature, maxTokens, mcpTools)
    }
  }

  protected async fetchOpenAIModels(): Promise<MODEL_META[]> {
    const provider = providerDbLoader.getProvider(this.provider.id)
    if (!provider || !Array.isArray(provider.models)) {
      return []
    }

    return provider.models.map((model) => {
      const inputs = model.modalities?.input
      const outputs = model.modalities?.output
      const hasImageInput = Array.isArray(inputs) && inputs.includes('image')
      const hasImageOutput = Array.isArray(outputs) && outputs.includes('image')
      const modelType = hasImageOutput ? ModelType.ImageGeneration : ModelType.Chat

      return {
        id: model.id,
        name: model.display_name || model.name || model.id,
        group: 'default',
        providerId: this.provider.id,
        isCustom: false,
        contextLength: resolveModelContextLength(model.limit?.context),
        maxTokens: resolveModelMaxTokens(model.limit?.output),
        vision: hasImageInput,
        functionCall: resolveModelFunctionCall(model.tool_call),
        reasoning: Boolean(model.reasoning?.supported),
        enableSearch: Boolean(model.search?.supported),
        type: modelType
      }
    })
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
