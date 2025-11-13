import { RATE_LIMIT_EVENTS } from '@/events'
import { eventBus, SendTarget } from '@/eventbus'
import { IConfigPresenter, LLM_PROVIDER } from '@shared/presenter'
import { ProviderRateLimitState, QueueItem, RateLimitConfig } from '../types'

export class RateLimitManager {
  private readonly providerRateLimitStates: Map<string, ProviderRateLimitState> = new Map()
  private readonly DEFAULT_RATE_LIMIT_CONFIG: RateLimitConfig = {
    qpsLimit: 0.1,
    enabled: false
  }

  constructor(private readonly configPresenter: IConfigPresenter) {}

  initializeProviderRateLimitConfigs(): void {
    const providers = this.configPresenter.getProviders()
    for (const provider of providers) {
      if (provider.rateLimit) {
        this.setProviderRateLimitConfig(provider.id, {
          enabled: provider.rateLimit.enabled,
          qpsLimit: provider.rateLimit.qpsLimit
        })
      }
    }
    console.log(
      `[RateLimitManager] Initialized rate limit configs for ${providers.length} providers`
    )
  }

  updateProviderRateLimit(providerId: string, enabled: boolean, qpsLimit: number): void {
    let finalConfig = { enabled, qpsLimit }
    if (
      finalConfig.qpsLimit !== undefined &&
      (finalConfig.qpsLimit <= 0 || !isFinite(finalConfig.qpsLimit))
    ) {
      if (finalConfig.enabled === true) {
        console.warn(
          `[RateLimitManager] Invalid qpsLimit (${finalConfig.qpsLimit}) for provider ${providerId}, disabling rate limit`
        )
        finalConfig.enabled = false
      }
      const provider = this.configPresenter.getProviderById(providerId)
      finalConfig.qpsLimit = provider?.rateLimit?.qpsLimit ?? 0.1
    }
    this.setProviderRateLimitConfig(providerId, finalConfig)
    const provider = this.configPresenter.getProviderById(providerId)
    if (provider) {
      const updatedProvider: LLM_PROVIDER = {
        ...provider,
        rateLimit: {
          enabled: finalConfig.enabled,
          qpsLimit: finalConfig.qpsLimit
        }
      }
      this.configPresenter.setProviderById(providerId, updatedProvider)
      console.log(`[RateLimitManager] Updated persistent config for ${providerId}`)
    }
  }

  getProviderRateLimitStatus(providerId: string): {
    config: { enabled: boolean; qpsLimit: number }
    currentQps: number
    queueLength: number
    lastRequestTime: number
  } {
    const config = this.getProviderRateLimitConfig(providerId)
    const currentQps = this.getCurrentQps(providerId)
    const queueLength = this.getQueueLength(providerId)
    const lastRequestTime = this.getLastRequestTime(providerId)

    return {
      config,
      currentQps,
      queueLength,
      lastRequestTime
    }
  }

  getAllProviderRateLimitStatus(): Record<
    string,
    {
      config: { enabled: boolean; qpsLimit: number }
      currentQps: number
      queueLength: number
      lastRequestTime: number
    }
  > {
    const status: Record<string, any> = {}
    for (const [providerId, state] of this.providerRateLimitStates) {
      status[providerId] = {
        config: state.config,
        currentQps: this.getCurrentQps(providerId),
        queueLength: state.queue.length,
        lastRequestTime: state.lastRequestTime
      }
    }
    return status
  }

  async executeWithRateLimit(providerId: string): Promise<void> {
    const state = this.getOrCreateRateLimitState(providerId)
    if (!state.config.enabled) {
      this.recordRequest(providerId)
      return Promise.resolve()
    }
    if (this.canExecuteImmediately(providerId)) {
      this.recordRequest(providerId)
      return Promise.resolve()
    }
    return new Promise<void>((resolve, reject) => {
      const queueItem: QueueItem = {
        id: `${providerId}-${Date.now()}-${Math.random()}`,
        timestamp: Date.now(),
        resolve,
        reject
      }

      state.queue.push(queueItem)
      console.log(
        `[RateLimitManager] Request queued for ${providerId}, queue length: ${state.queue.length}`
      )
      eventBus.send(RATE_LIMIT_EVENTS.REQUEST_QUEUED, SendTarget.ALL_WINDOWS, {
        providerId,
        queueLength: state.queue.length,
        requestId: queueItem.id
      })
      this.processRateLimitQueue(providerId)
    })
  }

  syncProviders(providers: LLM_PROVIDER[]): void {
    for (const provider of providers) {
      if (provider.rateLimit) {
        this.setProviderRateLimitConfig(provider.id, {
          enabled: provider.rateLimit.enabled,
          qpsLimit: provider.rateLimit.qpsLimit
        })
      }
    }
    const currentProviderIds = new Set(providers.map((p) => p.id))
    const allStatus = this.getAllProviderRateLimitStatus()
    for (const providerId of Object.keys(allStatus)) {
      if (!currentProviderIds.has(providerId)) {
        this.cleanupProviderRateLimit(providerId)
      }
    }
  }

  cleanupProviderRateLimit(providerId: string): void {
    const state = this.providerRateLimitStates.get(providerId)
    if (state) {
      while (state.queue.length > 0) {
        const queueItem = state.queue.shift()
        if (queueItem) {
          queueItem.reject(new Error('Provider removed'))
        }
      }
      this.providerRateLimitStates.delete(providerId)
      console.log(`[RateLimitManager] Cleaned up rate limit state for ${providerId}`)
    }
  }

  private setProviderRateLimitConfig(providerId: string, config: Partial<RateLimitConfig>): void {
    const currentState = this.providerRateLimitStates.get(providerId)
    const newConfig = {
      ...this.DEFAULT_RATE_LIMIT_CONFIG,
      ...currentState?.config,
      ...config
    }
    if (!currentState) {
      this.providerRateLimitStates.set(providerId, {
        config: newConfig,
        queue: [],
        lastRequestTime: 0,
        isProcessing: false
      })
    } else {
      currentState.config = newConfig
    }
    console.log(`[RateLimitManager] Updated rate limit config for ${providerId}:`, newConfig)
    eventBus.send(RATE_LIMIT_EVENTS.CONFIG_UPDATED, SendTarget.ALL_WINDOWS, {
      providerId,
      config: newConfig
    })
  }

  getProviderRateLimitConfig(providerId: string): RateLimitConfig {
    const state = this.providerRateLimitStates.get(providerId)
    return state?.config || this.DEFAULT_RATE_LIMIT_CONFIG
  }

  canExecuteImmediately(providerId: string): boolean {
    const state = this.providerRateLimitStates.get(providerId)
    if (!state || !state.config.enabled) {
      return true
    }
    const now = Date.now()
    const intervalMs = (1 / state.config.qpsLimit) * 1000
    return now - state.lastRequestTime >= intervalMs
  }

  private recordRequest(providerId: string): void {
    const state = this.getOrCreateRateLimitState(providerId)
    const now = Date.now()
    state.lastRequestTime = now
    eventBus.send(RATE_LIMIT_EVENTS.REQUEST_EXECUTED, SendTarget.ALL_WINDOWS, {
      providerId,
      timestamp: now,
      currentQps: this.getCurrentQps(providerId)
    })
  }

  private async processRateLimitQueue(providerId: string): Promise<void> {
    const state = this.providerRateLimitStates.get(providerId)
    if (!state || state.isProcessing || state.queue.length === 0) {
      return
    }
    state.isProcessing = true
    try {
      while (state.queue.length > 0) {
        if (this.canExecuteImmediately(providerId)) {
          const queueItem = state.queue.shift()
          if (queueItem) {
            this.recordRequest(providerId)
            queueItem.resolve()
            console.log(
              `[RateLimitManager] Request executed for ${providerId}, remaining queue: ${state.queue.length}`
            )
          }
        } else {
          const now = Date.now()
          const intervalMs = (1 / state.config.qpsLimit) * 1000
          const nextAllowedTime = state.lastRequestTime + intervalMs
          const waitTime = Math.max(0, nextAllowedTime - now)
          if (waitTime > 0) {
            await new Promise((resolve) => setTimeout(resolve, waitTime))
          }
        }
      }
    } catch (error) {
      console.error(
        `[RateLimitManager] Error processing rate limit queue for ${providerId}:`,
        error
      )
      while (state.queue.length > 0) {
        const queueItem = state.queue.shift()
        if (queueItem) {
          queueItem.reject(new Error('Rate limit processing failed'))
        }
      }
    } finally {
      state.isProcessing = false
    }
  }

  private getOrCreateRateLimitState(providerId: string): ProviderRateLimitState {
    let state = this.providerRateLimitStates.get(providerId)
    if (!state) {
      state = {
        config: { ...this.DEFAULT_RATE_LIMIT_CONFIG },
        queue: [],
        lastRequestTime: 0,
        isProcessing: false
      }
      this.providerRateLimitStates.set(providerId, state)
    }
    return state
  }

  getCurrentQps(providerId: string): number {
    const state = this.providerRateLimitStates.get(providerId)
    if (!state || !state.config.enabled || state.lastRequestTime === 0) return 0
    const now = Date.now()
    const timeSinceLastRequest = now - state.lastRequestTime
    const intervalMs = (1 / state.config.qpsLimit) * 1000
    return timeSinceLastRequest < intervalMs ? 1 : 0
  }

  getQueueLength(providerId: string): number {
    const state = this.providerRateLimitStates.get(providerId)
    return state?.queue.length || 0
  }

  private getLastRequestTime(providerId: string): number {
    const state = this.providerRateLimitStates.get(providerId)
    return state?.lastRequestTime || 0
  }
}
