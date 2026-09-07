import { describe, expect, it } from 'vitest'
import { RecentMessageViewCache, type RecentMessageView } from '@/stores/ui/recentMessageViewCache'

function buildView(sessionId: string, content = sessionId): RecentMessageView {
  const message = {
    id: `${sessionId}-message`,
    sessionId,
    orderSeq: 1,
    role: 'user' as const,
    content,
    status: 'sent' as const,
    isContextEdge: 0,
    metadata: '{}',
    traceCount: 0,
    createdAt: 1,
    updatedAt: 1
  }
  return {
    sessionId,
    session: null,
    messageIds: [message.id],
    messageCache: new Map([[message.id, message]]),
    nextCursor: null,
    hasMoreHistory: false,
    revision: 1
  }
}

describe('RecentMessageViewCache', () => {
  it('evicts the least recently used session by count', () => {
    const cache = new RecentMessageViewCache(2)
    cache.set(buildView('s1'))
    cache.set(buildView('s2'))
    expect(cache.get('s1')?.sessionId).toBe('s1')

    cache.set(buildView('s3'))

    expect(cache.get('s2')).toBeNull()
    expect(cache.get('s1')?.sessionId).toBe('s1')
    expect(cache.get('s3')?.sessionId).toBe('s3')
  })

  it('evicts views that exceed the configured memory budget', () => {
    const cache = new RecentMessageViewCache(5, 1_000)
    cache.set(buildView('s1', 'a'.repeat(100)))
    cache.set(buildView('s2', 'b'.repeat(600)))

    expect(cache.get('s1')).toBeNull()
    expect(cache.size).toBeLessThanOrEqual(1)
    expect(cache.approximateBytes).toBeLessThanOrEqual(1_000)
  })

  it('copies mutable collections at the cache boundary', () => {
    const cache = new RecentMessageViewCache()
    const view = buildView('s1')
    cache.set(view)
    ;(view.messageIds as string[]).push('late')
    ;(view.messageCache as Map<string, unknown>).clear()

    const cached = cache.get('s1')
    expect(cached?.messageIds).toEqual(['s1-message'])
    expect(cached?.messageCache.size).toBe(1)
  })
})
