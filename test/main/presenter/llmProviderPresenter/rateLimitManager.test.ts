import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/eventbus', () => ({
  eventBus: {
    send: vi.fn()
  },
  SendTarget: {
    ALL_WINDOWS: 'all'
  }
}))

vi.mock('@/events', () => ({
  RATE_LIMIT_EVENTS: {
    CONFIG_UPDATED: 'rate-limit:config-updated',
    REQUEST_QUEUED: 'rate-limit:request-queued',
    REQUEST_EXECUTED: 'rate-limit:request-executed',
    LIMIT_EXCEEDED: 'rate-limit:limit-exceeded'
  }
}))

import { eventBus } from '@/eventbus'
import { RateLimitManager } from '@/presenter/llmProviderPresenter/managers/rateLimitManager'

function createConfigPresenter(rateLimit?: { enabled: boolean; qpsLimit: number }) {
  const provider = {
    id: 'openai',
    name: 'OpenAI',
    rateLimit: rateLimit ?? { enabled: false, qpsLimit: 1 }
  }

  return {
    provider,
    presenter: {
      getProviders: vi.fn(() => [provider]),
      getProviderById: vi.fn(() => provider),
      setProviderById: vi.fn((providerId: string, nextProvider: typeof provider) => {
        if (providerId === provider.id) {
          Object.assign(provider, nextProvider)
        }
      })
    }
  }
}

describe('RateLimitManager', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-04-01T00:00:00.000Z'))
    vi.clearAllMocks()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('executes immediately and records the request when the provider is not rate limited', async () => {
    const { presenter } = createConfigPresenter({ enabled: false, qpsLimit: 1 })
    const manager = new RateLimitManager(presenter as any)
    manager.initializeProviderRateLimitConfigs()

    await manager.executeWithRateLimit('openai')

    expect(eventBus.send).toHaveBeenCalledWith(
      'rate-limit:request-executed',
      'all',
      expect.objectContaining({
        providerId: 'openai',
        timestamp: Date.now()
      })
    )
  })

  it('queues a request, reports queue info, and executes it after the interval', async () => {
    const { presenter } = createConfigPresenter({ enabled: true, qpsLimit: 1 })
    const manager = new RateLimitManager(presenter as any)
    manager.initializeProviderRateLimitConfigs()

    await manager.executeWithRateLimit('openai')

    const onQueued = vi.fn()
    const queuedPromise = manager.executeWithRateLimit('openai', { onQueued })
    await Promise.resolve()

    expect(onQueued).toHaveBeenCalledWith(
      expect.objectContaining({
        providerId: 'openai',
        qpsLimit: 1,
        currentQps: 1,
        queueLength: 1,
        estimatedWaitTime: expect.any(Number)
      })
    )
    expect(manager.getQueueLength('openai')).toBe(1)

    await vi.advanceTimersByTimeAsync(1000)
    await queuedPromise

    expect(manager.getQueueLength('openai')).toBe(0)
    expect(
      (eventBus.send as ReturnType<typeof vi.fn>).mock.calls.filter(
        ([eventName]) => eventName === 'rate-limit:request-queued'
      )
    ).toHaveLength(1)
    expect(
      (eventBus.send as ReturnType<typeof vi.fn>).mock.calls.filter(
        ([eventName]) => eventName === 'rate-limit:request-executed'
      )
    ).toHaveLength(2)
  })

  it('removes an aborted queued request and never reaches the provider gate', async () => {
    const { presenter } = createConfigPresenter({ enabled: true, qpsLimit: 1 })
    const manager = new RateLimitManager(presenter as any)
    manager.initializeProviderRateLimitConfigs()

    await manager.executeWithRateLimit('openai')

    const abortController = new AbortController()
    const queuedPromise = manager.executeWithRateLimit('openai', {
      signal: abortController.signal
    })
    await Promise.resolve()

    abortController.abort()

    await expect(queuedPromise).rejects.toMatchObject({ name: 'AbortError' })
    expect(manager.getQueueLength('openai')).toBe(0)

    await vi.advanceTimersByTimeAsync(1000)

    expect(
      (eventBus.send as ReturnType<typeof vi.fn>).mock.calls.filter(
        ([eventName]) => eventName === 'rate-limit:request-executed'
      )
    ).toHaveLength(1)
  })
})
