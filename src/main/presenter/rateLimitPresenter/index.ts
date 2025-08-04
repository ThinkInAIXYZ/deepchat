import { RateLimitManager, RateLimitConfig } from './rateLimitManager'
import { ConfigPresenter } from '../configPresenter'
import { LLM_PROVIDER } from '@shared/presenter'

export class RateLimitPresenter {
  private rateLimitManager: RateLimitManager
  private configPresenter: ConfigPresenter

  constructor(configPresenter: ConfigPresenter) {
    this.configPresenter = configPresenter
    this.rateLimitManager = new RateLimitManager()
    this.initializeProviderConfigs()
  }

  private initializeProviderConfigs(): void {
    const providers = this.configPresenter.getProviders()
    for (const provider of providers) {
      if (provider.rateLimit) {
        this.rateLimitManager.setProviderConfig(provider.id, {
          enabled: provider.rateLimit.enabled,
          qpsLimit: provider.rateLimit.qpsLimit
        })
      }
    }
    console.log(`[RateLimitPresenter] Initialized configs for ${providers.length} providers`)
  }

  updateProviderConfig(providerId: string, config: Partial<RateLimitConfig>): void {
    let finalConfig = { ...config }
    if (
      finalConfig.qpsLimit !== undefined &&
      finalConfig.qpsLimit <= 0 &&
      finalConfig.enabled === true
    ) {
      console.warn(
        `[RateLimitPresenter] Invalid qpsLimit (${finalConfig.qpsLimit}) for provider ${providerId}, disabling rate limit`
      )
      finalConfig.enabled = false
    }
    this.rateLimitManager.setProviderConfig(providerId, finalConfig)
    const provider = this.configPresenter.getProviderById(providerId)
    if (provider) {
      const updatedProvider: LLM_PROVIDER = {
        ...provider,
        rateLimit: {
          enabled: finalConfig.enabled ?? provider.rateLimit?.enabled ?? false,
          qpsLimit: finalConfig.qpsLimit ?? provider.rateLimit?.qpsLimit ?? 10
        }
      }

      this.configPresenter.setProviderById(providerId, updatedProvider)
      console.log(`[RateLimitPresenter] Updated persistent config for ${providerId}`)
    }
  }

  getProviderConfig(providerId: string): RateLimitConfig {
    return this.rateLimitManager.getProviderConfig(providerId)
  }

  canExecuteImmediately(providerId: string): boolean {
    return this.rateLimitManager.canExecuteImmediately(providerId)
  }

  async executeWithRateLimit(providerId: string): Promise<void> {
    return this.rateLimitManager.executeWithRateLimit(providerId)
  }

  getCurrentQps(providerId: string): number {
    return this.rateLimitManager.getCurrentQps(providerId)
  }

  getQueueLength(providerId: string): number {
    return this.rateLimitManager.getQueueLength(providerId)
  }

  getLastRequestTime(providerId: string): number {
    return this.rateLimitManager.getLastRequestTime(providerId)
  }

  getAllProviderStatus(): Record<
    string,
    {
      config: RateLimitConfig
      currentQps: number
      queueLength: number
      lastRequestTime: number
    }
  > {
    return this.rateLimitManager.getAllProviderStatus()
  }

  cleanupProvider(providerId: string): void {
    this.rateLimitManager.cleanupProvider(providerId)
  }

  onProvidersUpdated(providers: LLM_PROVIDER[]): void {
    for (const provider of providers) {
      if (provider.rateLimit) {
        this.rateLimitManager.setProviderConfig(provider.id, {
          enabled: provider.rateLimit.enabled,
          qpsLimit: provider.rateLimit.qpsLimit
        })
      }
    }

    const currentProviderIds = new Set(providers.map((p) => p.id))
    const allStatus = this.rateLimitManager.getAllProviderStatus()

    for (const providerId of Object.keys(allStatus)) {
      if (!currentProviderIds.has(providerId)) {
        this.rateLimitManager.cleanupProvider(providerId)
      }
    }
  }

  getRateLimitManager(): RateLimitManager {
    return this.rateLimitManager
  }
}
