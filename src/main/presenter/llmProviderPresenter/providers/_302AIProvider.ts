import { LLM_PROVIDER, LLMResponse, ChatMessage, KeyStatus } from '@shared/presenter'
import { OpenAICompatibleProvider } from './openAICompatibleProvider'
import { ConfigPresenter } from '../../configPresenter'

// Define interface for 302AI API balance response
interface _302AIBalanceResponse {
  data: {
    balance: string
  }
}

export class _302AIProvider extends OpenAICompatibleProvider {
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
   * Get current API key status from 302AI
   * @returns Promise<KeyStatus> API key status information
   */
  public async getKeyStatus(): Promise<KeyStatus> {
    if (!this.provider.apiKey) {
      throw new Error('API key is required')
    }

    const response = await fetch('https://api.302.ai/dashboard/balance', {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${this.provider.apiKey}`,
        'Content-Type': 'application/json'
      }
    })

    if (!response.ok) {
      const errorText = await response.text()
      throw new Error(
        `302AI API key check failed: ${response.status} ${response.statusText} - ${errorText}`
      )
    }

    const balanceResponse: _302AIBalanceResponse = await response.json()
    const balance = parseFloat(balanceResponse.data.balance)
    const remaining = '$' + balanceResponse.data.balance

    return {
      limit_remaining: remaining,
      remainNum: balance
    }
  }

  /**
   * Override check method to use 302AI's API key status endpoint
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
      let errorMessage = 'An unknown error occurred during 302AI API key check.'
      if (error instanceof Error) {
        errorMessage = error.message
      } else if (typeof error === 'string') {
        errorMessage = error
      }

      console.error('302AI API key check failed:', error)
      return { isOk: false, errorMsg: errorMessage }
    }
  }
}
