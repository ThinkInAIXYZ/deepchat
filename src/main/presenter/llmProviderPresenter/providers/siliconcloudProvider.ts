import {
  LLM_PROVIDER,
  LLMResponse,
  MODEL_META,
  ChatMessage,
  KeyStatus,
  IConfigPresenter,
  LLMCoreStreamEvent,
  ModelConfig,
  MCPToolDefinition
} from '@shared/presenter'
import { OpenAICompatibleProvider } from './openAICompatibleProvider'

// Define interface for SiliconCloud API key response
interface SiliconCloudKeyResponse {
  code: number
  message: string
  status: boolean
  data: {
    id: string
    name: string
    image: string
    email: string
    isAdmin: boolean
    balance: string
    status: string
    introduction: string
    role: string
    chargeBalance: string
    totalBalance: string
  }
}

export class SiliconcloudProvider extends OpenAICompatibleProvider {
  // 支持 enable_thinking 参数的模型列表
  private static readonly ENABLE_THINKING_MODELS: string[] = [
    'qwen/qwen3-8b',
    'qwen/qwen3-14b',
    'qwen/qwen3-32b',
    'qwen/qwen3-30b-a3b',
    'qwen/qwen3-235b-a22b',
    'tencent/hunyuan-a13b-instruct',
    'zai-org/glm-4.5v',
    'deepseek-ai/deepseek-v3.1',
    'pro/deepseek-ai/deepseek-v3.1'
  ]

  constructor(provider: LLM_PROVIDER, configPresenter: IConfigPresenter) {
    super(provider, configPresenter)
  }

  /**
   * 检查模型是否支持 enable_thinking 参数
   * @param modelId 模型ID
   * @returns boolean 是否支持 enable_thinking
   */
  private supportsEnableThinking(modelId: string): boolean {
    const normalizedModelId = modelId.toLowerCase()
    return SiliconcloudProvider.ENABLE_THINKING_MODELS.some((supportedModel) =>
      normalizedModelId.includes(supportedModel)
    )
  }

  /**
   * 重写 coreStream 方法以支持 SiliconCloud 的 enable_thinking 参数
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

    const shouldAddEnableThinking = this.supportsEnableThinking(modelId) && modelConfig?.reasoning

    if (shouldAddEnableThinking) {
      // 原始的 create 方法
      const originalCreate = this.openai.chat.completions.create.bind(this.openai.chat.completions)
      // 替换 create 方法以添加 enable_thinking 参数
      this.openai.chat.completions.create = ((params: any, options?: any) => {
        const modifiedParams = {
          ...params,
          enable_thinking: true
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

  protected async fetchOpenAIModels(options?: { timeout: number }): Promise<MODEL_META[]> {
    const response = await this.openai.models.list({
      ...options,
      query: { type: 'text', sub_type: 'chat' }
    })
    return response.data.map((model) => ({
      id: model.id,
      name: model.id,
      group: 'default',
      providerId: this.provider.id,
      isCustom: false,
      contextLength: 4096,
      maxTokens: 2048
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

  async summaries(
    text: string,
    modelId: string,
    temperature?: number,
    maxTokens?: number
  ): Promise<LLMResponse> {
    return this.openAICompletion(
      [
        {
          role: 'user',
          content: `请总结以下内容，使用简洁的语言，突出重点：\n${text}`
        }
      ],
      modelId,
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

  /**
   * Get current API key status from SiliconCloud
   * @returns Promise<KeyStatus> API key status information
   */
  public async getKeyStatus(): Promise<KeyStatus> {
    if (!this.provider.apiKey) {
      throw new Error('API key is required')
    }

    const response = await fetch('https://api.siliconflow.cn/v1/user/info', {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${this.provider.apiKey}`,
        'Content-Type': 'application/json'
      }
    })

    if (!response.ok) {
      const errorText = await response.text()
      throw new Error(
        `SiliconCloud API key check failed: ${response.status} ${response.statusText} - ${errorText}`
      )
    }

    const keyResponse: SiliconCloudKeyResponse = await response.json()

    if (keyResponse.code !== 20000 || !keyResponse.status) {
      throw new Error(`SiliconCloud API error: ${keyResponse.message}`)
    }

    const totalBalance = parseFloat(keyResponse.data.totalBalance)

    // Map to unified KeyStatus format
    return {
      limit_remaining: `¥${totalBalance}`,
      remainNum: totalBalance
    }
  }

  /**
   * Override check method to use SiliconCloud's API key status endpoint
   * @returns Promise<{ isOk: boolean; errorMsg: string | null }>
   */
  public async check(): Promise<{ isOk: boolean; errorMsg: string | null }> {
    try {
      const keyStatus = await this.getKeyStatus()

      // Check if there's remaining quota
      if (keyStatus.remainNum !== undefined && keyStatus.remainNum <= 0) {
        return {
          isOk: false,
          errorMsg: `API key quota exhausted. Remaining: ${keyStatus.limit_remaining}`
        }
      }

      return { isOk: true, errorMsg: null }
    } catch (error: unknown) {
      let errorMessage = 'An unknown error occurred during SiliconCloud API key check.'
      if (error instanceof Error) {
        errorMessage = error.message
      } else if (typeof error === 'string') {
        errorMessage = error
      }

      console.error('SiliconCloud API key check failed:', error)
      return { isOk: false, errorMsg: errorMessage }
    }
  }
}
