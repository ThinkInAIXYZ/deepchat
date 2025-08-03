import { eventBus, SendTarget } from '@/eventbus'
import { RATE_LIMIT_EVENTS } from '@/events'

export interface RateLimitConfig {
  qpsLimit: number
  enabled: boolean
}

interface QueueItem {
  id: string
  timestamp: number
  resolve: () => void
  reject: (error: Error) => void
}

interface ProviderRateLimitState {
  config: RateLimitConfig
  queue: QueueItem[]
  lastRequestTime: number
  isProcessing: boolean
}

export class RateLimitManager {
  private providerStates: Map<string, ProviderRateLimitState> = new Map()
  private readonly DEFAULT_CONFIG: RateLimitConfig = {
    qpsLimit: 10,
    enabled: false
  }

  constructor() {
    console.log('[RateLimitManager] Initialized')
  }

  setProviderConfig(providerId: string, config: Partial<RateLimitConfig>): void {
    const currentState = this.providerStates.get(providerId)
    const newConfig = {
      ...this.DEFAULT_CONFIG,
      ...currentState?.config,
      ...config
    }

    if (!currentState) {
      this.providerStates.set(providerId, {
        config: newConfig,
        queue: [],
        lastRequestTime: 0,
        isProcessing: false
      })
    } else {
      currentState.config = newConfig
    }

    console.log(`[RateLimitManager] Updated config for ${providerId}:`, newConfig)

    eventBus.send(RATE_LIMIT_EVENTS.CONFIG_UPDATED, SendTarget.ALL_WINDOWS, {
      providerId,
      config: newConfig
    })
  }

  getProviderConfig(providerId: string): RateLimitConfig {
    const state = this.providerStates.get(providerId)
    return state?.config || this.DEFAULT_CONFIG
  }

  canExecuteImmediately(providerId: string): boolean {
    const state = this.providerStates.get(providerId)
    if (!state || !state.config.enabled) {
      return true
    }

    const now = Date.now()
    const intervalMs = (1 / state.config.qpsLimit) * 1000

    return now - state.lastRequestTime >= intervalMs
  }

  async executeWithRateLimit(providerId: string): Promise<void> {
    const state = this.getOrCreateState(providerId)

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

      this.processQueue(providerId)
    })
  }

  private recordRequest(providerId: string): void {
    const state = this.getOrCreateState(providerId)
    const now = Date.now()
    state.lastRequestTime = now

    eventBus.send(RATE_LIMIT_EVENTS.REQUEST_EXECUTED, SendTarget.ALL_WINDOWS, {
      providerId,
      timestamp: now,
      currentQps: this.getCurrentQps(providerId)
    })
  }

  private async processQueue(providerId: string): Promise<void> {
    const state = this.providerStates.get(providerId)
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
      console.error(`[RateLimitManager] Error processing queue for ${providerId}:`, error)

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

  private getOrCreateState(providerId: string): ProviderRateLimitState {
    let state = this.providerStates.get(providerId)
    if (!state) {
      state = {
        config: { ...this.DEFAULT_CONFIG },
        queue: [],
        lastRequestTime: 0,
        isProcessing: false
      }
      this.providerStates.set(providerId, state)
    }
    return state
  }

  getCurrentQps(providerId: string): number {
    const state = this.providerStates.get(providerId)
    if (!state || !state.config.enabled || state.lastRequestTime === 0) return 0

    const now = Date.now()
    const timeSinceLastRequest = now - state.lastRequestTime
    const intervalMs = (1 / state.config.qpsLimit) * 1000

    return timeSinceLastRequest < intervalMs ? 1 : 0
  }

  getQueueLength(providerId: string): number {
    const state = this.providerStates.get(providerId)
    return state?.queue.length || 0
  }

  getLastRequestTime(providerId: string): number {
    const state = this.providerStates.get(providerId)
    return state?.lastRequestTime || 0
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
    const status: Record<string, any> = {}

    for (const [providerId, state] of this.providerStates) {
      status[providerId] = {
        config: state.config,
        currentQps: this.getCurrentQps(providerId),
        queueLength: state.queue.length,
        lastRequestTime: state.lastRequestTime
      }
    }

    return status
  }

  cleanupProvider(providerId: string): void {
    const state = this.providerStates.get(providerId)
    if (state) {
      while (state.queue.length > 0) {
        const queueItem = state.queue.shift()
        if (queueItem) {
          queueItem.reject(new Error('Provider removed'))
        }
      }

      this.providerStates.delete(providerId)
      console.log(`[RateLimitManager] Cleaned up state for ${providerId}`)
    }
  }
}
