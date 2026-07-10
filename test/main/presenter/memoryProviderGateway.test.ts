import { describe, expect, it, vi } from 'vitest'

import { MemoryProviderGateway } from '@/presenter/memoryPresenter/infra/providerGateway'
import type { MemoryPresenterDeps } from '@/presenter/memoryPresenter/types'

function makeGateway(overrides: Partial<MemoryPresenterDeps> = {}): {
  gateway: MemoryProviderGateway
  deps: MemoryPresenterDeps
} {
  const deps = {
    executeWithRateLimit: vi.fn(async () => undefined),
    getEmbeddings: vi.fn(async () => [[1, 2, 3]]),
    getDimensions: vi.fn(async () => ({ data: { dimensions: 3 } })),
    generateText: vi.fn(async () => 'ok'),
    ...overrides
  } as unknown as MemoryPresenterDeps
  return { gateway: new MemoryProviderGateway(deps), deps }
}

describe('MemoryProviderGateway', () => {
  it('admits the request before invoking the provider and exposes its purpose', async () => {
    const order: string[] = []
    const { gateway, deps } = makeGateway({
      executeWithRateLimit: vi.fn(async (_providerId, options) => {
        order.push(`admit:${options.purpose}`)
      }),
      generateText: vi.fn(async () => {
        order.push('provider')
        return 'ok'
      })
    })

    await expect(gateway.generateText('agent', 'p', 'm', 'prompt', 'decision')).resolves.toBe('ok')

    expect(order).toEqual(['admit:decision', 'provider'])
    expect(deps.executeWithRateLimit).toHaveBeenCalledTimes(1)
  })

  it('settles a never-ending query embedding at the 800ms absolute deadline', async () => {
    vi.useFakeTimers()
    try {
      const { gateway } = makeGateway({
        getEmbeddings: vi.fn(() => new Promise<number[][]>(() => undefined))
      })
      const request = gateway.getEmbeddings('agent', 'p', 'm', ['query'], 'query-embedding')
      const assertion = expect(request).rejects.toMatchObject({
        name: 'AbortError',
        message: '[Memory] query-embedding deadline exceeded (800ms)'
      })

      await vi.advanceTimersByTimeAsync(800)

      await assertion
    } finally {
      vi.useRealTimers()
    }
  })

  it('aborts queued or active requests during disposal without waiting for provider support', async () => {
    const { gateway } = makeGateway({
      executeWithRateLimit: vi.fn(() => new Promise<void>(() => undefined))
    })
    const request = gateway.generateText('agent', 'p', 'm', 'prompt', 'maintenance')

    gateway.abortAll()

    await expect(request).rejects.toMatchObject({ name: 'AbortError' })
  })

  it('aborts only the invalidated agent and ignores a late provider resolution', async () => {
    let resolveProvider!: (value: string) => void
    const { gateway } = makeGateway({
      generateText: vi.fn(
        () =>
          new Promise<string>((resolve) => {
            resolveProvider = resolve
          })
      )
    })
    const request = gateway.generateText('agent-a', 'p', 'm', 'prompt', 'decision')
    await Promise.resolve()
    await Promise.resolve()

    gateway.abortAgent('agent-a')
    resolveProvider('late')

    await expect(request).rejects.toMatchObject({ name: 'AbortError' })
  })

  it('absorbs a provider rejection that arrives after the outer deadline', async () => {
    vi.useFakeTimers()
    try {
      let rejectProvider!: (error: Error) => void
      const { gateway } = makeGateway({
        getEmbeddings: vi.fn(
          () =>
            new Promise<number[][]>((_resolve, reject) => {
              rejectProvider = reject
            })
        )
      })
      const request = gateway.getEmbeddings('agent', 'p', 'm', ['query'], 'query-embedding')
      const assertion = expect(request).rejects.toMatchObject({ name: 'AbortError' })
      await vi.advanceTimersByTimeAsync(800)
      await assertion

      rejectProvider(new Error('late provider rejection'))
      await Promise.resolve()
    } finally {
      vi.useRealTimers()
    }
  })

  it.each([
    {
      name: 'dimension',
      deadline: 15_000,
      start: (gateway: MemoryProviderGateway) => gateway.getDimensions('agent', 'p', 'm')
    },
    {
      name: 'embedding batch',
      deadline: 30_000,
      start: (gateway: MemoryProviderGateway) =>
        gateway.getEmbeddings('agent', 'p', 'm', ['value'], 'embedding-batch')
    },
    {
      name: 'maintenance text',
      deadline: 60_000,
      start: (gateway: MemoryProviderGateway) =>
        gateway.generateText('agent', 'p', 'm', 'prompt', 'maintenance')
    }
  ])('enforces the $name absolute deadline', async ({ deadline, start }) => {
    vi.useFakeTimers()
    try {
      const { gateway } = makeGateway({
        getDimensions: vi.fn(() => new Promise(() => undefined)),
        getEmbeddings: vi.fn(() => new Promise(() => undefined)),
        generateText: vi.fn(() => new Promise(() => undefined))
      })
      const assertion = expect(start(gateway)).rejects.toMatchObject({ name: 'AbortError' })

      await vi.advanceTimersByTimeAsync(deadline)

      await assertion
    } finally {
      vi.useRealTimers()
    }
  })

  it('caps two unsettled provider calls per agent/provider/model/purpose key', async () => {
    const { gateway, deps } = makeGateway({
      generateText: vi.fn(() => new Promise<string>(() => undefined))
    })
    const first = gateway.generateText('agent', 'p', 'm', 'one', 'decision')
    const second = gateway.generateText('agent', 'p', 'm', 'two', 'decision')
    await Promise.resolve()
    await Promise.resolve()

    await expect(
      gateway.generateText('agent', 'p', 'm', 'three', 'decision')
    ).rejects.toMatchObject({ name: 'AbortError' })
    expect(deps.generateText).toHaveBeenCalledTimes(2)

    gateway.abortAll()
    await Promise.allSettled([first, second])
  })

  it('caps unsettled provider calls globally', async () => {
    const { gateway, deps } = makeGateway({
      generateText: vi.fn(() => new Promise<string>(() => undefined))
    })
    const requests = Array.from({ length: 64 }, (_, index) =>
      gateway.generateText(`agent-${index}`, 'p', 'm', 'prompt', 'decision')
    )
    await Promise.resolve()
    await Promise.resolve()

    await expect(
      gateway.generateText('agent-overflow', 'p', 'm', 'prompt', 'decision')
    ).rejects.toMatchObject({ name: 'AbortError' })
    expect(deps.generateText).toHaveBeenCalledTimes(64)

    gateway.abortAll()
    await Promise.allSettled(requests)
  })
})
