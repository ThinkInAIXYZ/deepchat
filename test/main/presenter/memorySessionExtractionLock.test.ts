import { describe, expect, it } from 'vitest'

// Mirrors AgentRuntimePresenter.enqueueSessionExtraction's serialization contract.
function makeLock(now: () => number = Date.now) {
  const chains = new Map<string, Promise<void>>()
  const epochs = new Map<string, number>()
  const queue = new Map<number, { sessionId: string; queuedAt: number }>()
  const observations: Array<{ depth: number; oldestQueuedAt: number | null }> = []
  let nextQueueId = 0
  const observe = () => {
    observations.push({
      depth: queue.size,
      oldestQueuedAt: queue.values().next().value?.queuedAt ?? null
    })
  }
  function ensureEpoch(sessionId: string): number {
    if (!epochs.has(sessionId)) epochs.set(sessionId, 0)
    return epochs.get(sessionId) ?? 0
  }
  function bumpEpoch(sessionId: string): void {
    epochs.set(sessionId, (epochs.get(sessionId) ?? 0) + 1)
  }
  function enqueue(sessionId: string, task: (epoch: number) => Promise<void>): void {
    const queueId = ++nextQueueId
    queue.set(queueId, { sessionId, queuedAt: now() })
    observe()
    const prev = chains.get(sessionId) ?? Promise.resolve()
    const runTask = async () => {
      try {
        await task(ensureEpoch(sessionId))
      } finally {
        queue.delete(queueId)
        observe()
      }
    }
    const next = prev.then(runTask, runTask).catch(() => undefined)
    chains.set(sessionId, next)
    void next.finally(() => {
      if (chains.get(sessionId) === next) chains.delete(sessionId)
    })
  }
  function destroy(sessionId: string): void {
    for (const [queueId, entry] of queue) {
      if (entry.sessionId === sessionId) queue.delete(queueId)
    }
    observe()
  }
  return { chains, enqueue, bumpEpoch, destroy, observations }
}

function deferred() {
  let resolve!: () => void
  const promise = new Promise<void>((r) => {
    resolve = r
  })
  return { promise, resolve }
}

const tick = () => new Promise((r) => setTimeout(r, 0))

describe('per-session extraction lock (C2, AC-2.3/2.4)', () => {
  it('runs same-session tasks strictly one at a time, in enqueue order', async () => {
    const { enqueue } = makeLock()
    const events: string[] = []
    const d1 = deferred()
    const d2 = deferred()

    enqueue('s1', async () => {
      events.push('start1')
      await d1.promise
      events.push('end1')
    })
    enqueue('s1', async () => {
      events.push('start2')
      await d2.promise
      events.push('end2')
    })

    await tick()
    expect(events).toEqual(['start1'])

    d1.resolve()
    await tick()
    expect(events).toEqual(['start1', 'end1', 'start2'])

    d2.resolve()
    await tick()
    expect(events).toEqual(['start1', 'end1', 'start2', 'end2'])
  })

  it('does not block sibling sessions', async () => {
    const { enqueue } = makeLock()
    const events: string[] = []
    const blocked = deferred()

    enqueue('s1', async () => {
      events.push('s1-start')
      await blocked.promise
      events.push('s1-end')
    })
    enqueue('s2', async () => {
      events.push('s2-start')
      events.push('s2-end')
    })

    await tick()
    expect(events).toContain('s2-start')
    expect(events).toContain('s2-end')
    expect(events).not.toContain('s1-end')

    blocked.resolve()
    await tick()
    expect(events).toContain('s1-end')
  })

  it('reports absolute content-free queue state and clears destroyed sessions', async () => {
    const { enqueue, destroy, observations } = makeLock()
    const blocked = deferred()
    enqueue('s1', async () => blocked.promise)
    enqueue('s1', async () => undefined)
    expect(observations.at(-1)).toMatchObject({ depth: 2 })

    destroy('s1')
    expect(observations.at(-1)).toEqual({ depth: 0, oldestQueuedAt: null })
    expect(JSON.stringify(observations)).not.toContain('prompt')
    blocked.resolve()
    await tick()
  })

  it('reports the next oldest queue entry after deleting the first one', async () => {
    const queuedAt = [100, 200]
    const { enqueue, destroy, observations } = makeLock(() => queuedAt.shift()!)
    const first = deferred()
    const second = deferred()

    enqueue('s1', async () => first.promise)
    enqueue('s2', async () => second.promise)
    expect(observations.at(-1)).toEqual({ depth: 2, oldestQueuedAt: 100 })

    destroy('s1')
    expect(observations.at(-1)).toEqual({ depth: 1, oldestQueuedAt: 200 })

    first.resolve()
    second.resolve()
    await tick()
  })

  it('clears the chain entry once the tail settles', async () => {
    const { chains, enqueue } = makeLock()
    enqueue('s1', async () => undefined)
    expect(chains.has('s1')).toBe(true)
    await tick()
    expect(chains.has('s1')).toBe(false)
  })

  it('captures the epoch when a queued task starts, not when it is enqueued', async () => {
    const { enqueue, bumpEpoch } = makeLock()
    const events: Array<string | number> = []
    const blocked = deferred()

    enqueue('s1', async (epoch) => {
      events.push('start1', epoch)
      await blocked.promise
    })
    enqueue('s1', async (epoch) => {
      events.push('start2', epoch)
    })

    await tick()
    expect(events).toEqual(['start1', 0])

    bumpEpoch('s1')
    blocked.resolve()
    await tick()

    expect(events).toEqual(['start1', 0, 'start2', 1])
  })

  it('advances the cursor only after ok:true extraction results', async () => {
    let cursor = 0
    async function consumeSpan(toOrderSeq: number, result: { ok: boolean }) {
      if (!result.ok) return
      cursor = toOrderSeq
    }

    await consumeSpan(10, { ok: false })
    expect(cursor).toBe(0)

    await consumeSpan(10, { ok: true })
    expect(cursor).toBe(10)
  })
})
