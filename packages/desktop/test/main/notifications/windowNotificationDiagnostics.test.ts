import { describe, expect, it, vi } from 'vitest'
import { AggregatedWindowNotificationDiagnostics } from '@/notifications'
import { FakeNotificationTime } from '../../helpers/fakeNotificationTime'

describe('AggregatedWindowNotificationDiagnostics', () => {
  it('aggregates low-cardinality diagnostics before writing', () => {
    const time = new FakeNotificationTime()
    const write = vi.fn()
    const diagnostics = new AggregatedWindowNotificationDiagnostics({
      scheduler: time,
      write,
      flushIntervalMs: 100
    })
    const event = {
      code: 'mcp.connectionFailed' as const,
      reason: 'no-compatible-target' as const,
      priority: 40,
      scopeKind: 'scope' as const
    }

    diagnostics.record(event)
    diagnostics.record(event)
    time.advanceBy(99)
    expect(write).not.toHaveBeenCalled()

    time.advanceBy(1)
    expect(write).toHaveBeenCalledOnce()
    expect(write).toHaveBeenCalledWith({
      ...event,
      count: 2
    })
  })

  it('flushes remaining diagnostics during disposal without retaining raw values', () => {
    const time = new FakeNotificationTime()
    const write = vi.fn()
    const diagnostics = new AggregatedWindowNotificationDiagnostics({
      scheduler: time,
      write
    })

    diagnostics.record({
      code: 'providerDeeplink.failed',
      reason: 'delivery-failed',
      priority: 40,
      scopeKind: 'key'
    })
    diagnostics.dispose()

    expect(write).toHaveBeenCalledWith({
      code: 'providerDeeplink.failed',
      reason: 'delivery-failed',
      priority: 40,
      scopeKind: 'key',
      count: 1
    })
    expect(JSON.stringify(write.mock.calls)).not.toContain('entity')
    expect(JSON.stringify(write.mock.calls)).not.toContain('message')
  })
})
