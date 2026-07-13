import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/routes/publishDeepchatEvent', () => ({
  publishDeepchatEvent: vi.fn()
}))

import { RateLimitManager } from '@/presenter/llmProviderPresenter/managers/rateLimitManager'
import { publishDeepchatEvent } from '@/routes/publishDeepchatEvent'

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

    expect(publishDeepchatEvent).toHaveBeenCalledWith(
      'providers.rateLimit.requestExecuted',
      expect.objectContaining({
        providerId: 'openai',
        timestamp: Date.now(),
        version: Date.now()
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
      (publishDeepchatEvent as ReturnType<typeof vi.fn>).mock.calls.filter(
        ([eventName]) => eventName === 'providers.rateLimit.requestQueued'
      )
    ).toHaveLength(1)
    expect(
      (publishDeepchatEvent as ReturnType<typeof vi.fn>).mock.calls.filter(
        ([eventName]) => eventName === 'providers.rateLimit.requestExecuted'
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
      (publishDeepchatEvent as ReturnType<typeof vi.fn>).mock.calls.filter(
        ([eventName]) => eventName === 'providers.rateLimit.requestExecuted'
      )
    ).toHaveLength(1)
  })
})
