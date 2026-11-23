import type { SessionDatabase } from '@/session/data/database'
import type { DeepChatOutputPort } from '@/agent/shared/output'
import type {
  SessionCompactionSnapshot,
  SessionCompactionState,
  SessionContextOccupancySnapshot
} from '@shared/types/agent-interface'
import type { DimSessionBinding } from '@/session/data/tables/dimSessionBindings'
import { DimContent } from './content'
import { DimSessionControls } from './sessionControls'
import { DimMethodError } from './pluginClient'
import { dimSequence, type DimEvent } from './sessionConnection'

interface ContextOptions {
  database: SessionDatabase
  content: DimContent
  controls: DimSessionControls
  output: DeepChatOutputPort
  prepareNative(sessionId: string): Promise<void>
}
const unavailable = (): SessionContextOccupancySnapshot => ({
  freshness: 'unavailable',
  source: null,
  occupiedTokens: null,
  contextWindowTokens: null,
  requestSeq: null,
  manifestEntryId: null,
  providerAttemptEntryId: null,
  measuredAt: null
})
const initial = (): SessionCompactionState => ({
  status: 'idle',
  // Neutral legacy UI index. Native boundaries are identified only by snapshot.timeline.
  cursorOrderSeq: 1,
  summaryUpdatedAt: null,
  boundaryReason: null
})

/** Native context commands and read models, with lossless Timeline identities separate from Tape. */
export class DimContext {
  private readonly snapshots = new Map<string, SessionCompactionSnapshot>()
  private version = Date.now()
  constructor(private readonly options: ContextOptions) {}

  readonly getSessionContextOccupancy = async (
    sessionId: string
  ): Promise<SessionContextOccupancySnapshot> => {
    const binding = this.options.database.dimSessionBindingsTable.get(sessionId)
    if (!binding) return unavailable()
    try {
      const usage = await this.options.controls.call<{
        through: number | string
        contextWindow: number
        estimatedInputTokens: number
      }>('context', this.ref(binding))
      this.current(binding)
      if (
        !Number.isFinite(usage.contextWindow) ||
        usage.contextWindow < 1 ||
        !Number.isFinite(usage.estimatedInputTokens) ||
        usage.estimatedInputTokens < 0
      )
        throw new Error('Invalid native context usage')
      return {
        freshness: 'current',
        source: 'estimated',
        occupiedTokens: Math.ceil(usage.estimatedInputTokens),
        contextWindowTokens: Math.floor(usage.contextWindow),
        requestSeq: null,
        manifestEntryId: null,
        providerAttemptEntryId: null,
        measuredAt: Date.now(),
        timeline: { ...this.ref(binding), sequence: dimSequence(usage.through).toString() }
      }
    } catch (error) {
      if (
        error instanceof DimMethodError &&
        error.data &&
        typeof error.data === 'object' &&
        !Array.isArray(error.data) &&
        error.data.appError === 'context_not_configured'
      )
        return unavailable()
      throw error
    }
  }

  readonly getSessionCompactionSnapshot = async (
    sessionId: string
  ): Promise<SessionCompactionSnapshot> => {
    const binding = this.options.database.dimSessionBindingsTable.get(sessionId)
    if (!binding) return { state: initial(), emitSeq: 0, latestAnchorEntryId: null }
    const ref = this.ref(binding)
    const version = ++this.version
    const head = await this.options.content.latest(ref, [
      'context/compact',
      'context/compaction-start',
      'context/compaction'
    ])
    const latest = head.event
    const { event: completed } = await this.options.content.latest(
      ref,
      ['context/compaction'],
      {
        op: 'compare',
        left: { kind: 'field', path: 'data.status' },
        comparison: 'eq',
        right: { kind: 'value', value: 'completed' }
      },
      head.through
    )
    const state = initial()
    if (completed) {
      state.status = 'compacted'
      state.summaryUpdatedAt = completed.create_at
    }
    if (latest && latest.name !== 'compaction') state.status = 'compacting'
    const snapshot: SessionCompactionSnapshot = {
      state,
      emitSeq: version,
      latestAnchorEntryId: null,
      ...(latest
        ? {
            timeline: {
              ...ref,
              sequence: dimSequence(latest.sequence).toString(),
              eventId: latest.id
            }
          }
        : {})
    }
    this.current(binding)
    const newer = this.snapshots.get(sessionId)
    if (newer && newer.emitSeq > version) return newer
    this.snapshots.set(sessionId, snapshot)
    return snapshot
  }

  readonly compactSession = async (
    sessionId: string
  ): Promise<{ compacted: boolean; state: SessionCompactionState }> => {
    await this.options.prepareNative(sessionId)
    const binding = this.options.database.dimSessionBindingsTable.get(sessionId)
    if (!binding) throw new Error('Native session is not initialized')
    const result = await this.options.controls.call<{ status: string }>(
      'compact',
      this.ref(binding)
    )
    const snapshot = await this.getSessionCompactionSnapshot(sessionId)
    this.publish(sessionId, snapshot)
    return { compacted: result.status === 'completed', state: snapshot.state }
  }

  observe(sessionId: string, event: DimEvent): void {
    if (
      event.type !== 'context' ||
      !['compact', 'compaction-start', 'compaction'].includes(event.name)
    )
      return
    const binding = this.options.database.dimSessionBindingsTable.get(sessionId)
    if (!binding) return
    const previous = this.snapshots.get(sessionId)
    if (
      previous?.timeline &&
      previous.timeline.sessionId === binding.dimSessionId &&
      previous.timeline.branchId === binding.branchId &&
      dimSequence(previous.timeline.sequence) >= dimSequence(event.sequence)
    )
      return
    const state = { ...(previous?.state ?? initial()) }
    if (event.name === 'compaction') {
      if (event.data.status === 'completed') {
        state.status = 'compacted'
        state.summaryUpdatedAt = event.create_at
      } else state.status = state.summaryUpdatedAt === null ? 'idle' : 'compacted'
    } else state.status = 'compacting'
    const snapshot = {
      state,
      emitSeq: ++this.version,
      latestAnchorEntryId: null,
      timeline: {
        ...this.ref(binding),
        sequence: dimSequence(event.sequence).toString(),
        eventId: event.id
      }
    }
    this.snapshots.set(sessionId, snapshot)
    this.publish(sessionId, snapshot)
  }
  forget(sessionId: string): void {
    this.snapshots.delete(sessionId)
  }
  private publish(sessionId: string, snapshot: SessionCompactionSnapshot) {
    this.options.output.compactionChanged({
      sessionId,
      ...snapshot.state,
      emitSeq: snapshot.emitSeq,
      latestAnchorEntryId: null,
      ...(snapshot.timeline ? { timeline: snapshot.timeline } : {})
    })
  }
  private ref(binding: DimSessionBinding) {
    return { sessionId: binding.dimSessionId, branchId: binding.branchId }
  }
  private current(binding: DimSessionBinding) {
    const current = this.options.database.dimSessionBindingsTable.get(binding.sessionId)
    if (
      !current ||
      current.dimSessionId !== binding.dimSessionId ||
      current.branchId !== binding.branchId ||
      current.generation !== binding.generation
    )
      throw new Error('Native context belongs to a replaced session scope')
  }
}
