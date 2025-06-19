import { LLM_PROVIDER, LLMResponse, ChatMessage, KeyStatus } from '@shared/presenter'
import { OpenAICompatibleProvider } from './openAICompatibleProvider'
import { ConfigPresenter } from '../../configPresenter'
import httpFetch from '@/api'

// Define interface for OpenRouter API key response
interface OpenRouterKeyResponse {
  data: {
    label: string
    usage: number
    is_free_tier: boolean
    is_provisioning_key: boolean
    limit: number | null
    limit_remaining: number | null
    rate_limit: {
      requests: number
      interval: string
    }
  }
}

export class OpenRouterProvider extends OpenAICompatibleProvider {
  constructor(provider: LLM_PROVIDER, configPresenter: ConfigPresenter) {
    super(provider, configPresenter)
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
          content: `You need to summarize the user's conversation into a title of no more than 10 words, with the title language matching the user's primary language, without using punctuation or other special symbols：\n${text}`
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
   * Get current API key status from OpenRouter
   * @returns Promise<KeyStatus> API key status information
   */
  public async getKeyStatus(): Promise<KeyStatus> {
    if (!this.provider.apiKey) {
      throw new Error('API key is required')
    }

    const response = await httpFetch.get('https://openrouter.ai/api/v1/key', {
      headers: {
        'Authorization': `Bearer ${this.provider.apiKey}`,
        'Content-Type': 'application/json'
      },
    })

    if (response.status !== 200) {
      const errorText = response.statusText || 'Unknown error'
      throw new Error(`OpenRouter API key check failed: ${response.status} ${response.statusText} - ${errorText}`)
    }

    const responseText = response.data
    if (!responseText || responseText.trim().length === 0) {
      throw new Error('OpenRouter API returned empty response')
    }

    const keyResponse: OpenRouterKeyResponse = JSON.parse(responseText)
    if (!keyResponse.data) {
      throw new Error(`OpenRouter API response missing 'data' field`)
    }

    // Build KeyStatus based on available data
    const keyStatus: KeyStatus = {
      usage: '$'+keyResponse.data.usage,
    }

    // Only include limit_remaining if it's not null (has actual limit)
    if (keyResponse.data.limit_remaining !== null) {
      keyStatus.limit_remaining = '$'+keyResponse.data.limit_remaining
      keyStatus.remainNum = keyResponse.data.limit_remaining
    }

    return keyStatus
  }

  /**
   * Override check method to use OpenRouter's API key status endpoint
   * @returns Promise<{ isOk: boolean; errorMsg: string | null }>
   */
    public async check(): Promise<{ isOk: boolean; errorMsg: string | null }> {
    try {
      const keyStatus = await this.getKeyStatus()

      // Check if there's remaining quota (only if limit_remaining exists)
      if (keyStatus.remainNum !== undefined && keyStatus.remainNum <= 0) {
        return {
          isOk: false,
          errorMsg: `API key quota exhausted. Remaining: ${keyStatus.limit_remaining}`
        }
      }

      return { isOk: true, errorMsg: null }
    } catch (error: unknown) {
      let errorMessage = 'An unknown error occurred during OpenRouter API key check.'
      if (error instanceof Error) {
        errorMessage = error.message
      } else if (typeof error === 'string') {
        errorMessage = error
      }

      console.error('OpenRouter API key check failed:', error)
      return { isOk: false, errorMsg: errorMessage }
    }
  }
}
