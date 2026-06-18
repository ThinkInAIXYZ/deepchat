import { describe, expect, it } from 'vitest'

// Mirrors AgentRuntimePresenter.enqueueSessionExtraction's serialization contract.
function makeLock() {
  const chains = new Map<string, Promise<void>>()
  function enqueue(sessionId: string, task: () => Promise<void>): void {
    const prev = chains.get(sessionId) ?? Promise.resolve()
    const next = prev.then(task, task).catch(() => undefined)
    chains.set(sessionId, next)
    void next.finally(() => {
      if (chains.get(sessionId) === next) chains.delete(sessionId)
    })
  }
  return { chains, enqueue }
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

  it('clears the chain entry once the tail settles', async () => {
    const { chains, enqueue } = makeLock()
    enqueue('s1', async () => undefined)
    expect(chains.has('s1')).toBe(true)
    await tick()
    expect(chains.has('s1')).toBe(false)
  })
})
