import { describe, expect, it } from 'vitest'
import { RecentMessageMeasurementCache } from '@/composables/message/recentMessageMeasurementCache'

describe('RecentMessageMeasurementCache', () => {
  it('keeps copied snapshots across consumer lifetimes', () => {
    const cache = new RecentMessageMeasurementCache()
    const snapshot = { m1: 120 }
    cache.set('s1', snapshot)
    snapshot.m1 = 240

    expect(cache.get('s1')).toEqual({ m1: 120 })
  })

  it('evicts the least recently used session by count', () => {
    const cache = new RecentMessageMeasurementCache(2)
    cache.set('s1', { m1: 100 })
    cache.set('s2', { m2: 200 })
    expect(cache.get('s1')).toEqual({ m1: 100 })

    cache.set('s3', { m3: 300 })

    expect(cache.get('s2')).toBeNull()
    expect(cache.get('s1')).toEqual({ m1: 100 })
    expect(cache.get('s3')).toEqual({ m3: 300 })
  })
})
