import type { MessageMeasurementSnapshot } from './useMessageWindow'

const DEFAULT_MAX_ENTRIES = 5

export class RecentMessageMeasurementCache {
  private readonly entries = new Map<string, MessageMeasurementSnapshot>()

  constructor(private readonly maxEntries = DEFAULT_MAX_ENTRIES) {}

  get size(): number {
    return this.entries.size
  }

  get(sessionId: string): MessageMeasurementSnapshot | null {
    const snapshot = this.entries.get(sessionId)
    if (!snapshot) return null
    this.entries.delete(sessionId)
    this.entries.set(sessionId, snapshot)
    return snapshot
  }

  set(sessionId: string, snapshot: MessageMeasurementSnapshot): void {
    this.entries.delete(sessionId)
    this.entries.set(sessionId, Object.freeze({ ...snapshot }))
    while (this.entries.size > this.maxEntries) {
      const oldestSessionId = this.entries.keys().next().value
      if (!oldestSessionId) return
      this.entries.delete(oldestSessionId)
    }
  }

  clear(): void {
    this.entries.clear()
  }
}

export const recentMessageMeasurementCache = new RecentMessageMeasurementCache()
