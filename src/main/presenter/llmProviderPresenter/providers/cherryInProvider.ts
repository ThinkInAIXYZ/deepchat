import { LLM_PROVIDER, MODEL_META, IConfigPresenter, KeyStatus } from '@shared/presenter'
import { OpenAICompatibleProvider } from './openAICompatibleProvider'

interface CherryInUsageResponse {
  total_usage: number
}

export class CherryInProvider extends OpenAICompatibleProvider {
  constructor(provider: LLM_PROVIDER, configPresenter: IConfigPresenter) {
    super(provider, configPresenter)
  }

  private getBaseUrl(): string {
    return (this.provider.baseUrl || 'https://open.cherryin.ai/v1').replace(/\/$/, '')
  }

  public async getKeyStatus(): Promise<KeyStatus> {
    if (!this.provider.apiKey) {
      throw new Error('API key is required')
    }

    const baseUrl = this.getBaseUrl()
    const headers = {
      Authorization: `Bearer ${this.provider.apiKey}`,
      'Content-Type': 'application/json'
    }

    const usageResponse = await fetch(`${baseUrl}/dashboard/billing/usage`, {
      method: 'GET',
      headers
    })

    if (!usageResponse.ok) {
      const errorText = await usageResponse.text()
      throw new Error(
        `CherryIn usage check failed: ${usageResponse.status} ${usageResponse.statusText} - ${errorText}`
      )
    }

    const usageData: CherryInUsageResponse = await usageResponse.json()

    const totalUsage = Number(usageData?.total_usage)

    const usageUsd = Number.isFinite(totalUsage) ? totalUsage / 100 : 0

    return {
      usage: `$${usageUsd.toFixed(2)}`
    }
  }

  public async check(): Promise<{ isOk: boolean; errorMsg: string | null }> {
    try {
      await this.getKeyStatus()
      return { isOk: true, errorMsg: null }
    } catch (error: unknown) {
      let errorMessage = 'An unknown error occurred during CherryIn API key check.'
      if (error instanceof Error) {
        errorMessage = error.message
      } else if (typeof error === 'string') {
        errorMessage = error
      }

      console.error('CherryIn API key check failed:', error)
      return { isOk: false, errorMsg: errorMessage }
    }
  }

  protected async fetchOpenAIModels(options?: { timeout: number }): Promise<MODEL_META[]> {
    try {
      const models = await super.fetchOpenAIModels(options)
      if (models.length > 0) {
        return models.map((model) => ({
          ...model,
          group: model.group === 'default' ? 'cherryin' : model.group,
          providerId: this.provider.id
        }))
      }
    } catch (error) {
      console.warn(
        '[CherryInProvider] Failed to fetch models via API, falling back to defaults',
        error
      )
    }

    return []
  }
}
