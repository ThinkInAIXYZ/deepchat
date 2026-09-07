import { afterEach, describe, expect, it, vi } from 'vitest'
import { EpisodeRegistry } from '@shared/notifications'
import { FakeNotificationTime } from '../../helpers/fakeNotificationTime'

afterEach(() => {
  vi.restoreAllMocks()
})

describe('EpisodeRegistry', () => {
  it('aggregates repeated occurrences without creating a new episode', () => {
    const time = new FakeNotificationTime()
    const registry = new EpisodeRegistry(time, time)

    const first = registry.occur('mcp.connection:server-a', 1_000)
    time.advanceBy(400)
    const repeated = registry.occur('mcp.connection:server-a', 1_000)

    expect(repeated.id).toBe(first.id)
    expect(repeated.occurrenceCount).toBe(2)
    expect(repeated.firstSeenAt).toBe(0)
    expect(repeated.lastSeenAt).toBe(400)

    time.advanceBy(999)
    expect(registry.isActive('mcp.connection:server-a')).toBe(true)
    time.advanceBy(1)
    expect(registry.isActive('mcp.connection:server-a')).toBe(false)
  })

  it('keeps dismissal scoped to the current episode', () => {
    const time = new FakeNotificationTime()
    const registry = new EpisodeRegistry(time, time)

    const current = registry.occur('mcp.tools:server-a')
    registry.suppress('mcp.tools:server-a')
    const repeated = registry.occur('mcp.tools:server-a')

    expect(repeated.id).toBe(current.id)
    expect(repeated.suppressed).toBe(true)

    registry.recover('mcp.tools:server-a')
    const next = registry.occur('mcp.tools:server-a')

    expect(next.id).not.toBe(current.id)
    expect(next.suppressed).toBe(false)
  })

  it('emits an explicit close event for recovery', () => {
    const time = new FakeNotificationTime()
    const registry = new EpisodeRegistry(time, time)
    const listener = vi.fn()
    registry.subscribe(listener)

    registry.occur('database.repair')
    const closed = registry.recover('database.repair')

    expect(closed).toMatchObject({
      identity: 'database.repair',
      state: 'closed',
      closeReason: 'recovered'
    })
    expect(listener).toHaveBeenLastCalledWith({
      type: 'closed',
      episode: closed
    })
  })

  it('rejects an invalid quiet TTL without cancelling the current episode deadline', () => {
    const time = new FakeNotificationTime()
    const registry = new EpisodeRegistry(time, time)

    registry.occur('mcp.connection:server-a', 1_000)
    time.advanceBy(400)
    expect(() => registry.occur('mcp.connection:server-a', 0)).toThrow('positive finite')

    time.advanceBy(600)
    expect(registry.isActive('mcp.connection:server-a')).toBe(false)
  })

  it('preserves an episode quiet TTL when a repeated occurrence omits it', () => {
    const time = new FakeNotificationTime()
    const registry = new EpisodeRegistry(time, time)

    registry.occur('mcp.connection:server-a', 1_000)
    time.advanceBy(400)
    registry.occur('mcp.connection:server-a')
    time.advanceBy(999)
    expect(registry.isActive('mcp.connection:server-a')).toBe(true)

    time.advanceBy(1)
    expect(registry.isActive('mcp.connection:server-a')).toBe(false)
  })

  it('isolates listener failures from episode state transitions', () => {
    const time = new FakeNotificationTime()
    const registry = new EpisodeRegistry(time, time)
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    const healthyListener = vi.fn()
    registry.subscribe(() => {
      throw new Error('listener failed')
    })
    registry.subscribe(healthyListener)

    expect(() => registry.occur('mcp.connection:server-a')).not.toThrow()
    expect(registry.isActive('mcp.connection:server-a')).toBe(true)
    expect(healthyListener).toHaveBeenCalledOnce()
    expect(consoleError).toHaveBeenCalled()
  })

  it('preserves event order when a listener performs a nested transition', () => {
    const time = new FakeNotificationTime()
    const registry = new EpisodeRegistry(time, time)
    const observed: string[] = []
    registry.subscribe((event) => {
      if (event.type === 'opened') registry.suppress(event.episode.identity)
    })
    registry.subscribe((event) => observed.push(event.type))

    registry.occur('mcp.connection:server-a')

    expect(observed).toEqual(['opened', 'suppressed'])
  })
})
