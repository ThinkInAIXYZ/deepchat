import type {
  ChatMessageRecord,
  MessagePageCursor,
  SessionWithState
} from '@shared/types/agent-interface'

export type RecentMessageView = Readonly<{
  sessionId: string
  session: SessionWithState | null
  messageIds: readonly string[]
  messageCache: ReadonlyMap<string, ChatMessageRecord>
  nextCursor: MessagePageCursor | null
  hasMoreHistory: boolean
  revision: number
}>

type CachedRecentMessageView = RecentMessageView & {
  approximateBytes: number
}

const DEFAULT_MAX_ENTRIES = 5
const DEFAULT_MAX_BYTES = 24 * 1024 * 1024

function estimateViewBytes(view: RecentMessageView): number {
  let bytes = 256
  for (const id of view.messageIds) {
    const message = view.messageCache.get(id)
    bytes += id.length * 2 + 64
    if (!message) continue
    bytes += message.content.length * 2
    bytes += message.metadata.length * 2
  }
  return bytes
}

export class RecentMessageViewCache {
  private readonly entries = new Map<string, CachedRecentMessageView>()
  private totalBytes = 0

  constructor(
    private readonly maxEntries = DEFAULT_MAX_ENTRIES,
    private readonly maxBytes = DEFAULT_MAX_BYTES
  ) {}

  get size(): number {
    return this.entries.size
  }

  get approximateBytes(): number {
    return this.totalBytes
  }

  get(sessionId: string): RecentMessageView | null {
    const entry = this.entries.get(sessionId)
    if (!entry) return null
    this.entries.delete(sessionId)
    this.entries.set(sessionId, entry)
    return entry
  }

  set(view: RecentMessageView): void {
    this.delete(view.sessionId)
    const entry: CachedRecentMessageView = {
      ...view,
      messageIds: Object.freeze([...view.messageIds]),
      messageCache: new Map(view.messageCache),
      approximateBytes: estimateViewBytes(view)
    }
    this.entries.set(view.sessionId, entry)
    this.totalBytes += entry.approximateBytes
    this.evictOverflow()
  }

  delete(sessionId: string): void {
    const entry = this.entries.get(sessionId)
    if (!entry) return
    this.entries.delete(sessionId)
    this.totalBytes -= entry.approximateBytes
  }

  clear(): void {
    this.entries.clear()
    this.totalBytes = 0
  }

  private evictOverflow(): void {
    while (this.entries.size > this.maxEntries || this.totalBytes > this.maxBytes) {
      const oldestSessionId = this.entries.keys().next().value
      if (!oldestSessionId) return
      this.delete(oldestSessionId)
    }
  }
}
