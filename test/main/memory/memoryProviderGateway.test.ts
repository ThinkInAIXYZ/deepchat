import { describe, expect, it, vi } from 'vitest'

import { MemoryProviderGateway } from '@/memory/infra/providerGateway'
import {
  MEMORY_PROVIDER_CANCELLATION_CODE,
  MEMORY_PROVIDER_CAPACITY_CODE,
  MEMORY_PROVIDER_DEADLINE_CODE
} from '@/memory/core/providerCancellation'
import type { MemoryProviderGatewayDeps } from '@/memory/ports'
import { createMemoryDiagnosticsProbe } from './serviceHarness'

function makeGateway(overrides: Partial<MemoryProviderGatewayDeps> = {}): {
  gateway: MemoryProviderGateway
  deps: MemoryProviderGatewayDeps
} {
  const deps = {
    executeWithRateLimit: vi.fn(async () => undefined),
    getEmbeddings: vi.fn(async () => [[1, 2, 3]]),
    getDimensions: vi.fn(async () => ({ data: { dimensions: 3 } })),
    generateText: vi.fn(async () => 'ok'),
    ...overrides
  } as MemoryProviderGatewayDeps
  return { gateway: new MemoryProviderGateway(deps), deps }
}

describe('MemoryProviderGateway', () => {
  it('observes the real admission waiting gauge and closed outcomes', async () => {
    let admit!: () => void
    const perfObserver = { increment: vi.fn(), observe: vi.fn() }
    const probe = createMemoryDiagnosticsProbe()
    const diagnostics = {
      recordProviderAdmissionDecision: vi.fn(probe.recordProviderAdmissionDecision),
      recordProviderRaceEvent: vi.fn(probe.recordProviderRaceEvent)
    }
    const { gateway } = makeGateway({
      perfObserver,
      diagnostics,
      executeWithRateLimit: vi.fn(
        () =>
          new Promise<void>((resolve) => {
            admit = resolve
          })
      )
    })

    const request = gateway.generateText('agent', 'p', 'm', 'prompt', 'decision')
    expect(perfObserver.observe).toHaveBeenLastCalledWith('queueDepth', 1)
    admit()
    await expect(request).resolves.toBe('ok')
    expect(perfObserver.observe).toHaveBeenLastCalledWith('queueDepth', 0)
    expect(diagnostics.recordProviderAdmissionDecision).toHaveBeenCalledWith('admitted')
  })

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
        code: MEMORY_PROVIDER_DEADLINE_CODE,
        message: '[Memory] query-embedding deadline exceeded (800ms)'
      })

      await vi.advanceTimersByTimeAsync(800)

      await assertion
    } finally {
      vi.useRealTimers()
    }
  })

  describe('adaptive query embedding deadline', () => {
    /** Provider whose latency is scripted per call; `undefined` never settles. */
    function makeLatencyGateway(latenciesMs: Array<number | undefined>) {
      let call = 0
      const getEmbeddings = vi.fn(
        (_providerId: string, _modelId: string, _texts: string[], signal?: AbortSignal) =>
          new Promise<number[][]>((resolve, reject) => {
            const latency = latenciesMs[call++]
            signal?.addEventListener('abort', () => reject(signal.reason), { once: true })
            if (latency !== undefined) setTimeout(() => resolve([[1, 2, 3]]), latency)
          })
      )
      return { ...makeGateway({ getEmbeddings }), getEmbeddings }
    }

    async function settle<T>(promise: Promise<T>, advanceMs: number): Promise<T> {
      const guarded = promise.then(
        (value) => ({ ok: true as const, value }),
        (error) => ({ ok: false as const, error })
      )
      await vi.advanceTimersByTimeAsync(advanceMs)
      const outcome = await guarded
      if (outcome.ok === true) return outcome.value
      throw outcome.error
    }

    it('keeps the floor for fast providers so their behaviour is unchanged', async () => {
      vi.useFakeTimers()
      try {
        const { gateway } = makeLatencyGateway([100, 150, undefined])
        await settle(gateway.getEmbeddings('a', 'p', 'm', ['warm'], 'embedding-warm'), 100)
        await settle(gateway.getEmbeddings('a', 'p', 'm', ['q1'], 'query-embedding'), 150)

        const hung = gateway.getEmbeddings('a', 'p', 'm', ['q2'], 'query-embedding')
        await expect(settle(hung, 800)).rejects.toMatchObject({
          code: MEMORY_PROVIDER_DEADLINE_CODE,
          message: '[Memory] query-embedding deadline exceeded (800ms)'
        })
      } finally {
        vi.useRealTimers()
      }
    })

    it('raises the deadline from the warm-up latency before the first query', async () => {
      vi.useFakeTimers()
      try {
        const { gateway } = makeLatencyGateway([700, 1200])
        await settle(gateway.getEmbeddings('a', 'p', 'm', ['warm'], 'embedding-warm'), 700)

        // 700ms smoothed × 2 headroom = 1400ms, so a 1200ms query succeeds where 800ms failed.
        await expect(
          settle(gateway.getEmbeddings('a', 'p', 'm', ['q'], 'query-embedding'), 1200)
        ).resolves.toEqual([[1, 2, 3]])
      } finally {
        vi.useRealTimers()
      }
    })

    it('relaxes to the ceiling once after a miss and then converges on the observed latency', async () => {
      vi.useFakeTimers()
      try {
        const { gateway } = makeLatencyGateway([undefined, 1200, undefined, 1200, undefined])

        await expect(
          settle(gateway.getEmbeddings('a', 'p', 'm', ['q1'], 'query-embedding'), 800)
        ).rejects.toMatchObject({ message: '[Memory] query-embedding deadline exceeded (800ms)' })

        await expect(
          settle(gateway.getEmbeddings('a', 'p', 'm', ['q2'], 'query-embedding'), 1200)
        ).resolves.toEqual([[1, 2, 3]])

        // One sample of 1200ms: deadline is clamp(1200 × 2) = 2000ms, no longer the relaxation.
        await expect(
          settle(gateway.getEmbeddings('a', 'p', 'm', ['q3'], 'query-embedding'), 2000)
        ).rejects.toMatchObject({ message: '[Memory] query-embedding deadline exceeded (2000ms)' })

        await expect(
          settle(gateway.getEmbeddings('a', 'p', 'm', ['q4'], 'query-embedding'), 1200)
        ).resolves.toEqual([[1, 2, 3]])
        await expect(
          settle(gateway.getEmbeddings('a', 'p', 'm', ['q5'], 'query-embedding'), 2000)
        ).rejects.toMatchObject({ message: '[Memory] query-embedding deadline exceeded (2000ms)' })
      } finally {
        vi.useRealTimers()
      }
    })

    it('tracks latency per provider model and leaves other purposes alone', async () => {
      vi.useFakeTimers()
      try {
        const { gateway } = makeLatencyGateway([1000, undefined, undefined])
        await settle(gateway.getEmbeddings('a', 'p', 'slow', ['warm'], 'embedding-warm'), 1000)

        await expect(
          settle(gateway.getEmbeddings('a', 'p', 'fast', ['q'], 'query-embedding'), 800)
        ).rejects.toMatchObject({ message: '[Memory] query-embedding deadline exceeded (800ms)' })
        await expect(
          settle(gateway.getEmbeddings('a', 'p', 'slow', ['batch'], 'embedding-batch'), 30_000)
        ).rejects.toMatchObject({ message: '[Memory] embedding-batch deadline exceeded (30000ms)' })
      } finally {
        vi.useRealTimers()
      }
    })
  })

  it('aborts queued or active requests during disposal without waiting for provider support', async () => {
    const { gateway } = makeGateway({
      executeWithRateLimit: vi.fn(() => new Promise<void>(() => undefined))
    })
    const request = gateway.generateText('agent', 'p', 'm', 'prompt', 'maintenance')

    gateway.abortAll()

    await expect(request).rejects.toMatchObject({
      name: 'AbortError',
      code: MEMORY_PROVIDER_CANCELLATION_CODE
    })
  })

  it('does not admit a queued request that resolves after abort', async () => {
    let admit!: () => void
    const diagnostics = {
      recordProviderAdmissionDecision: vi.fn(),
      recordProviderRaceEvent: vi.fn()
    }
    const { gateway } = makeGateway({
      diagnostics,
      executeWithRateLimit: vi.fn(
        () =>
          new Promise<void>((resolve) => {
            admit = resolve
          })
      )
    })
    const request = gateway.generateText('agent', 'p', 'm', 'prompt', 'decision')

    gateway.abortAgent('agent')
    await expect(request).rejects.toMatchObject({ name: 'AbortError' })
    admit()
    await vi.waitFor(() => {
      expect(diagnostics.recordProviderRaceEvent).toHaveBeenCalledWith('lateSettled')
    })

    expect(diagnostics.recordProviderAdmissionDecision).not.toHaveBeenCalledWith('admitted')
  })

  it('separates rate-limit rejection from local capacity rejection', async () => {
    const diagnostics = {
      recordProviderAdmissionDecision: vi.fn(),
      recordProviderRaceEvent: vi.fn()
    }
    const { gateway } = makeGateway({
      diagnostics,
      executeWithRateLimit: vi.fn(async () => {
        throw new Error('limited')
      })
    })

    await expect(gateway.generateText('agent', 'p', 'm', 'prompt', 'decision')).rejects.toThrow(
      'limited'
    )
    expect(diagnostics.recordProviderAdmissionDecision).toHaveBeenCalledWith('rateLimited')
    expect(diagnostics.recordProviderAdmissionDecision).not.toHaveBeenCalledWith('admitted')
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
        getDimensions: vi.fn(
          () =>
            new Promise<Awaited<ReturnType<MemoryProviderGatewayDeps['getDimensions']>>>(
              () => undefined
            )
        ),
        getEmbeddings: vi.fn(
          () =>
            new Promise<Awaited<ReturnType<MemoryProviderGatewayDeps['getEmbeddings']>>>(
              () => undefined
            )
        ),
        generateText: vi.fn(
          () =>
            new Promise<Awaited<ReturnType<MemoryProviderGatewayDeps['generateText']>>>(
              () => undefined
            )
        )
      })
      const assertion = expect(start(gateway)).rejects.toMatchObject({ name: 'AbortError' })

      await vi.advanceTimersByTimeAsync(deadline)

      await assertion
    } finally {
      vi.useRealTimers()
    }
  })

  it('caps two unsettled provider calls per agent/provider/model/purpose key', async () => {
    const diagnostics = {
      recordProviderAdmissionDecision: vi.fn(),
      recordProviderRaceEvent: vi.fn()
    }
    const { gateway, deps } = makeGateway({
      diagnostics,
      generateText: vi.fn(() => new Promise<string>(() => undefined))
    })
    const first = gateway.generateText('agent', 'p', 'm', 'one', 'decision')
    const second = gateway.generateText('agent', 'p', 'm', 'two', 'decision')
    await Promise.resolve()
    await Promise.resolve()

    await expect(
      gateway.generateText('agent', 'p', 'm', 'three', 'decision')
    ).rejects.toMatchObject({ name: 'AbortError', code: MEMORY_PROVIDER_CAPACITY_CODE })
    expect(deps.generateText).toHaveBeenCalledTimes(2)
    expect(diagnostics.recordProviderAdmissionDecision).toHaveBeenCalledWith('capacityRejected')

    gateway.abortAll()
    await Promise.allSettled([first, second])
  })

  it('restores capacity after signal-aware provider calls settle on agent abort', async () => {
    const diagnostics = {
      recordProviderAdmissionDecision: vi.fn(),
      recordProviderRaceEvent: vi.fn()
    }
    let callCount = 0
    const { gateway } = makeGateway({
      diagnostics,
      generateText: vi.fn((_providerId, _modelId, _prompt, signal) => {
        callCount += 1
        if (callCount > 2) return Promise.resolve('after-abort')

        return new Promise<string>((_resolve, reject) => {
          signal?.addEventListener('abort', () => reject(signal.reason), { once: true })
        })
      })
    })
    const first = gateway.generateText('agent', 'p', 'm', 'one', 'decision')
    const second = gateway.generateText('agent', 'p', 'm', 'two', 'decision')
    await vi.waitFor(() => expect(callCount).toBe(2))

    gateway.abortAgent('agent')
    await Promise.allSettled([first, second])
    await vi.waitFor(() => {
      expect(diagnostics.recordProviderRaceEvent).toHaveBeenCalledTimes(4)
      expect(diagnostics.recordProviderRaceEvent).toHaveBeenCalledWith('aborted')
      expect(diagnostics.recordProviderRaceEvent).toHaveBeenCalledWith('lateSettled')
    })

    await expect(gateway.generateText('agent', 'p', 'm', 'after', 'decision')).resolves.toBe(
      'after-abort'
    )
  })

  it('retains capacity after abort until signal-aware provider calls actually settle', async () => {
    const releases: Array<() => void> = []
    let callCount = 0
    const diagnostics = {
      recordProviderAdmissionDecision: vi.fn(),
      recordProviderRaceEvent: vi.fn()
    }
    const { gateway, deps } = makeGateway({
      diagnostics,
      generateText: vi.fn((_providerId, _modelId, _prompt, signal) => {
        callCount += 1
        if (callCount > 2) return Promise.resolve('after-settle')

        return new Promise<string>((_resolve, reject) => {
          signal?.addEventListener(
            'abort',
            () => {
              releases.push(() => reject(signal.reason))
            },
            { once: true }
          )
        })
      })
    })
    const first = gateway.generateText('agent', 'p', 'm', 'one', 'decision')
    const second = gateway.generateText('agent', 'p', 'm', 'two', 'decision')
    await vi.waitFor(() => expect(callCount).toBe(2))

    gateway.abortAgent('agent')
    await Promise.allSettled([first, second])
    await vi.waitFor(() => expect(releases).toHaveLength(2))

    await expect(
      gateway.generateText('agent', 'p', 'm', 'still-full', 'decision')
    ).rejects.toMatchObject({ name: 'AbortError', code: MEMORY_PROVIDER_CAPACITY_CODE })
    expect(deps.generateText).toHaveBeenCalledTimes(2)

    releases.forEach((release) => release())
    await vi.waitFor(() => {
      expect(
        diagnostics.recordProviderRaceEvent.mock.calls.filter(([event]) => event === 'lateSettled')
      ).toHaveLength(2)
    })

    await expect(gateway.generateText('agent', 'p', 'm', 'after', 'decision')).resolves.toBe(
      'after-settle'
    )
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
    ).rejects.toMatchObject({ name: 'AbortError', code: MEMORY_PROVIDER_CAPACITY_CODE })
    expect(deps.generateText).toHaveBeenCalledTimes(64)

    gateway.abortAll()
    await Promise.allSettled(requests)
  })
})
