import { LLM_PROVIDER, LLMResponse, ChatMessage, KeyStatus } from '@shared/presenter'
import { OpenAICompatibleProvider } from './openAICompatibleProvider'
import { ConfigPresenter } from '../../configPresenter'
import httpFetch from '@/api'

// Define interface for DeepSeek API key response
interface DeepSeekBalanceResponse {
  is_available: boolean
  balance_infos: Array<{
    currency: string
    total_balance: string
    granted_balance: string
    topped_up_balance: string
  }>
}

export class DeepseekProvider extends OpenAICompatibleProvider {
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
   * Get current API key status from DeepSeek
   * @returns Promise<KeyStatus> API key status information
   */
  public async getKeyStatus(): Promise<KeyStatus> {
    if (!this.provider.apiKey) {
      throw new Error('API key is required')
    }

    const response = await httpFetch.get('https://api.deepseek.com/user/balance', {
      headers: {
        'Accept': 'application/json',
        'Authorization': `Bearer ${this.provider.apiKey}`
      }
    })

    if (!response.ok) {
      const errorText = response.statusText
      throw new Error(`DeepSeek API key check failed: ${response.status} ${response.statusText} - ${errorText}`)
    }

    const balanceResponse: DeepSeekBalanceResponse = response.data

    if (!balanceResponse.is_available) {
      throw new Error('DeepSeek API key is not available')
    }

    // Find CNY balance info first, then USD, then default to first available
    const balanceInfo = balanceResponse.balance_infos.find(info => info.currency === 'CNY')
      || balanceResponse.balance_infos.find(info => info.currency === 'USD')
      || balanceResponse.balance_infos[0]

    if (!balanceInfo) {
      throw new Error('No balance information available')
    }

    const totalBalance = parseFloat(balanceInfo.total_balance)
    const currencySymbol = balanceInfo.currency === 'USD' ? '$' : '¥'

    // Map to unified KeyStatus format
    return {
      limit_remaining: `${currencySymbol}${totalBalance}`,
      remainNum: totalBalance
    }
  }

  /**
   * Override check method to use DeepSeek's API key status endpoint
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
      let errorMessage = 'An unknown error occurred during DeepSeek API key check.'
      if (error instanceof Error) {
        errorMessage = error.message
      } else if (typeof error === 'string') {
        errorMessage = error
      }

      console.error('DeepSeek API key check failed:', error)
      return { isOk: false, errorMsg: errorMessage }
    }
  }
}
