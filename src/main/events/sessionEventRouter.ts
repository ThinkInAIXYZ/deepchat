import {
  SESSION_RUN_STREAM_EVENT_NAMES,
  sessionsUpdatedEvent,
  type DeepchatEventName
} from '@shared/contracts/events'
import type { TypedEventHub } from './typedEventHub'

const RUN_STREAM_EVENTS = new Set<DeepchatEventName>(SESSION_RUN_STREAM_EVENT_NAMES)

type SessionEventRouterOptions = Readonly<{
  hub: TypedEventHub
  // string: CLI run root; null: known renderer session; undefined: unknown/deleted session.
  resolveSessionRunId(sessionId: string): string | null | undefined
  getBoundRendererIds(sessionId: string): readonly number[]
}>

const MAX_OWNERSHIP_CACHE_ENTRIES = 4_096

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function sessionIdsForEvent(name: DeepchatEventName, payload: unknown): string[] {
  if (!isRecord(payload)) return []
  if (name === 'sessions.updated') {
    return Array.isArray(payload.sessionIds)
      ? payload.sessionIds.filter((value): value is string => typeof value === 'string')
      : []
  }
  if (typeof payload.sessionId === 'string') return [payload.sessionId]
  if (typeof payload.conversationId === 'string') return [payload.conversationId]
  return []
}

export class SessionEventRouter {
  private readonly ownershipCache = new Map<string, string | null>()

  constructor(private readonly options: SessionEventRouterOptions) {}

  publish(name: DeepchatEventName, payload: unknown): void {
    const sessionIds = sessionIdsForEvent(name, payload)
    if (name === 'sessions.updated') {
      for (const sessionId of sessionIds) this.ownershipCache.delete(sessionId)
    }
    const ownership = sessionIds.map((sessionId) => ({
      sessionId,
      runId: this.resolveSessionRunId(sessionId)
    }))
    const cliRunOwnership = ownership.flatMap(({ sessionId, runId }) => {
      return runId ? [{ sessionId, runId }] : []
    })
    const unknownSessionIds = ownership.flatMap(({ sessionId, runId }) =>
      runId === undefined ? [sessionId] : []
    )
    if (cliRunOwnership.length === 0 && unknownSessionIds.length === 0) {
      this.options.hub.publish(name, payload, { kind: 'renderer-all' })
      return
    }

    if (name === 'sessions.updated') {
      this.publishSessionsUpdated(sessionsUpdatedEvent.payload.parse(payload), unknownSessionIds)
      return
    }

    if (cliRunOwnership.length === 0) return

    if (RUN_STREAM_EVENTS.has(name)) {
      for (const runId of new Set(cliRunOwnership.map((ownership) => ownership.runId))) {
        this.options.hub.publish(name, payload, { kind: 'run', runId })
      }
    }
    this.publishToBoundRenderers(
      name,
      payload,
      cliRunOwnership.map(({ sessionId }) => sessionId)
    )
  }

  private resolveSessionRunId(sessionId: string): string | null | undefined {
    if (this.ownershipCache.has(sessionId)) {
      const cached = this.ownershipCache.get(sessionId)!
      this.ownershipCache.delete(sessionId)
      this.ownershipCache.set(sessionId, cached)
      return cached
    }

    const runId = this.options.resolveSessionRunId(sessionId)
    if (runId === undefined) return undefined
    this.ownershipCache.set(sessionId, runId)
    while (this.ownershipCache.size > MAX_OWNERSHIP_CACHE_ENTRIES) {
      const oldest = this.ownershipCache.keys().next().value
      if (oldest === undefined) break
      this.ownershipCache.delete(oldest)
    }
    return runId
  }

  private publishSessionsUpdated(
    payload: ReturnType<typeof sessionsUpdatedEvent.payload.parse>,
    unknownSessionIds: readonly string[]
  ): void {
    if (payload.reason === 'deleted') {
      this.options.hub.publish('sessions.updated', payload, { kind: 'renderer-all' })
      return
    }
    const unknownIds = new Set(unknownSessionIds)
    const knownSessionIds = payload.sessionIds.filter((sessionId) => !unknownIds.has(sessionId))
    if (knownSessionIds.length > 0) {
      this.options.hub.publish(
        'sessions.updated',
        { ...payload, sessionIds: knownSessionIds },
        { kind: 'renderer-all' }
      )
    }
  }

  private publishToBoundRenderers(
    name: DeepchatEventName,
    payload: unknown,
    sessionIds: readonly string[]
  ): void {
    const rendererIds = new Set(
      sessionIds.flatMap((sessionId) => [...this.options.getBoundRendererIds(sessionId)])
    )
    for (const webContentsId of rendererIds) {
      this.options.hub.publish(name, payload, { kind: 'renderer', webContentsId })
    }
  }
}
