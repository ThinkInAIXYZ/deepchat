import logger from '@shared/logger'
import { truncateUnicodeCodePoints } from '@shared/lib/unicodeText'

import { isMemoryProviderDeadlineError } from '../core/providerCancellation'
import {
  RECALL_QUERY_EMBEDDING_BREAKER_COOLDOWN_MS,
  RECALL_QUERY_EMBEDDING_BREAKER_FAILURE_THRESHOLD,
  RECALL_QUERY_EMBEDDING_BREAKER_FAILURE_WINDOW_MS,
  RECALL_QUERY_EMBEDDING_MAX_CODE_POINTS,
  RECALL_QUERY_EMBEDDING_MAX_CONCURRENT,
  RECALL_QUERY_EMBEDDING_STALE_MS
} from '../runtimeConstants'
import { embeddingFingerprint, type MemoryModelRef } from '../context'
import type { MemoryEmbeddingGatewayPort } from '../ports'

export type QueryEmbeddingCircuitEvent =
  | 'failure'
  | 'opened'
  | 'halfOpen'
  | 'closed'
  | 'probeCancelled'
  | 'skipped'

export type QueryEmbeddingCircuitState = 'closed' | 'open' | 'halfOpen'

export type QueryEmbeddingStartResult =
  | { status: 'started'; promise: Promise<number[][]> }
  | { status: 'capacity' }
  | { status: 'circuitOpen' }

export interface QueryEmbeddingCircuitDiagnostics {
  recordQueryEmbeddingCircuitEvent?(agentId: string, event: QueryEmbeddingCircuitEvent): void
  resetQueryEmbeddingCircuit?(agentId: string): void
}

interface CircuitState {
  fingerprint: string
  failuresInWindow: number
  failureWindowStartedAt: number | null
  openUntil: number
  halfOpenProbe: boolean
}

interface InFlightEntry {
  agentId: string
  startedAt: number
  promise: Promise<number[][]>
  circuit: CircuitState
  recoveryProbe: boolean
  consumerSignals: Set<AbortSignal | undefined>
  circuitSettled: boolean
}

/**
 * Per-Agent, per-embedding-identity breaker for warm recall query embeddings. Consecutive
 * deadline/transport failures inside a short window open the circuit; after the cooldown exactly
 * one half-open probe may run and its result decides whether the circuit closes again. Concurrent
 * recalls for the same query share one in-flight provider call, and cancellation by every consumer
 * never counts as provider health. Timing uses the infrastructure clock, not the domain clock.
 */
export class QueryEmbeddingCircuitBreaker {
  private readonly inFlight = new Map<string, Map<string, InFlightEntry>>()
  private readonly circuits = new Map<string, CircuitState>()

  constructor(
    private readonly ports: {
      embeddingGateway: MemoryEmbeddingGatewayPort
      diagnostics?: QueryEmbeddingCircuitDiagnostics
    }
  ) {}

  start(
    agentId: string,
    embedding: MemoryModelRef,
    fullQuery: string,
    signal?: AbortSignal
  ): QueryEmbeddingStartResult {
    const query = truncateUnicodeCodePoints(fullQuery, RECALL_QUERY_EMBEDDING_MAX_CODE_POINTS)
    const fingerprint = embeddingFingerprint(embedding.providerId, embedding.modelId)
    const key = `${agentId}::${fingerprint}`
    const now = Date.now()
    const circuit = this.circuitFor(agentId, fingerprint)
    let group = this.inFlight.get(key)
    let replacedStale = false
    if (group) {
      for (const [trackedQuery, entry] of group) {
        if (entry.circuitSettled) {
          group.delete(trackedQuery)
        } else if (now - entry.startedAt >= RECALL_QUERY_EMBEDDING_STALE_MS) {
          this.settleCancellation(entry)
          group.delete(trackedQuery)
          replacedStale = true
        }
      }
      if (group.size === 0) {
        this.inFlight.delete(key)
        group = undefined
      }
    }
    if (replacedStale) logger.warn(`[Memory] stale query embedding replaced for ${agentId}`)

    if (circuit.halfOpenProbe || circuit.openUntil > now) {
      this.ports.diagnostics?.recordQueryEmbeddingCircuitEvent?.(agentId, 'skipped')
      return { status: 'circuitOpen' }
    }

    const recoveryProbe = circuit.openUntil > 0
    const existing = group?.get(query)
    if (!recoveryProbe && existing) {
      existing.consumerSignals.add(signal)
      return { status: 'started', promise: existing.promise }
    }
    if ((group?.size ?? 0) >= RECALL_QUERY_EMBEDDING_MAX_CONCURRENT) {
      return { status: 'capacity' }
    }

    if (recoveryProbe) {
      circuit.halfOpenProbe = true
      this.ports.diagnostics?.recordQueryEmbeddingCircuitEvent?.(agentId, 'halfOpen')
    }
    if (!group) {
      group = new Map()
      this.inFlight.set(key, group)
    }

    let promise: Promise<number[][]>
    try {
      promise = this.ports.embeddingGateway.getEmbeddings(
        agentId,
        embedding.providerId,
        embedding.modelId,
        [query],
        'query-embedding'
      )
    } catch (error) {
      promise = Promise.reject(error)
    }
    const entry: InFlightEntry = {
      agentId,
      startedAt: now,
      promise,
      circuit,
      recoveryProbe,
      consumerSignals: new Set([signal]),
      circuitSettled: false
    }
    group.set(query, entry)
    void promise
      .then(
        () => {
          if (consumersCancelled(entry)) this.settleCancellation(entry)
          else this.settleSuccess(entry)
        },
        (error) => {
          if (consumersCancelled(entry)) this.settleCancellation(entry)
          else if (isCircuitFailure(error)) this.settleFailure(entry)
          else this.settleCancellation(entry)
        }
      )
      .finally(() => {
        const currentGroup = this.inFlight.get(key)
        if (currentGroup?.get(query) === entry) {
          currentGroup.delete(query)
          if (currentGroup.size === 0) this.inFlight.delete(key)
        }
      })
      .catch(() => undefined)
    return { status: 'started', promise }
  }

  state(agentId: string): QueryEmbeddingCircuitState {
    const circuit = this.circuits.get(agentId)
    if (!circuit) return 'closed'
    if (circuit.halfOpenProbe) return 'halfOpen'
    return circuit.openUntil > 0 ? 'open' : 'closed'
  }

  // Embedding identity changes and Agent cleanup drop both the breaker and any shared call.
  reset(agentId: string): void {
    this.clearInFlight(agentId)
    this.circuits.delete(agentId)
    this.ports.diagnostics?.resetQueryEmbeddingCircuit?.(agentId)
  }

  clear(): void {
    this.inFlight.clear()
    this.circuits.clear()
  }

  private circuitFor(agentId: string, fingerprint: string): CircuitState {
    const existing = this.circuits.get(agentId)
    if (existing?.fingerprint === fingerprint) return existing
    if (existing) {
      this.clearInFlight(agentId)
      this.ports.diagnostics?.resetQueryEmbeddingCircuit?.(agentId)
    }
    const circuit: CircuitState = {
      fingerprint,
      failuresInWindow: 0,
      failureWindowStartedAt: null,
      openUntil: 0,
      halfOpenProbe: false
    }
    this.circuits.set(agentId, circuit)
    return circuit
  }

  private settleSuccess(entry: InFlightEntry): void {
    if (entry.circuitSettled) return
    entry.circuitSettled = true
    if (this.circuits.get(entry.agentId) !== entry.circuit) return
    if (!entry.recoveryProbe && entry.circuit.openUntil > 0) return
    entry.circuit.failuresInWindow = 0
    entry.circuit.failureWindowStartedAt = null
    entry.circuit.openUntil = 0
    entry.circuit.halfOpenProbe = false
    this.ports.diagnostics?.recordQueryEmbeddingCircuitEvent?.(entry.agentId, 'closed')
  }

  private settleFailure(entry: InFlightEntry): void {
    if (entry.circuitSettled) return
    entry.circuitSettled = true
    const circuit = entry.circuit
    if (this.circuits.get(entry.agentId) !== circuit) return
    this.ports.diagnostics?.recordQueryEmbeddingCircuitEvent?.(entry.agentId, 'failure')
    const now = Date.now()
    if (entry.recoveryProbe) {
      circuit.halfOpenProbe = false
      this.open(entry.agentId, circuit, now)
      return
    }
    if (circuit.openUntil > now) return
    if (
      circuit.failureWindowStartedAt === null ||
      now - circuit.failureWindowStartedAt > RECALL_QUERY_EMBEDDING_BREAKER_FAILURE_WINDOW_MS
    ) {
      circuit.failureWindowStartedAt = now
      circuit.failuresInWindow = 1
    } else {
      circuit.failuresInWindow += 1
    }
    if (circuit.failuresInWindow >= RECALL_QUERY_EMBEDDING_BREAKER_FAILURE_THRESHOLD) {
      this.open(entry.agentId, circuit, now)
    }
  }

  private open(agentId: string, circuit: CircuitState, now: number): void {
    circuit.openUntil = now + RECALL_QUERY_EMBEDDING_BREAKER_COOLDOWN_MS
    this.ports.diagnostics?.recordQueryEmbeddingCircuitEvent?.(agentId, 'opened')
    logger.warn(`[Memory] query embedding circuit opened for ${agentId}; vector recall paused`)
  }

  private settleCancellation(entry: InFlightEntry): void {
    if (entry.circuitSettled) return
    entry.circuitSettled = true
    if (this.circuits.get(entry.agentId) !== entry.circuit) return
    if (!entry.recoveryProbe) return
    entry.circuit.halfOpenProbe = false
    this.ports.diagnostics?.recordQueryEmbeddingCircuitEvent?.(entry.agentId, 'probeCancelled')
  }

  private clearInFlight(agentId: string): void {
    const prefix = `${agentId}::`
    for (const key of this.inFlight.keys()) {
      if (key.startsWith(prefix)) this.inFlight.delete(key)
    }
  }
}

function consumersCancelled(entry: InFlightEntry): boolean {
  return (
    entry.consumerSignals.size > 0 &&
    [...entry.consumerSignals].every((signal) => signal?.aborted === true)
  )
}

/**
 * Every provider failure except a cancellation counts, including 4xx rejections: a persistent
 * 400 from a misconfigured model or proxy costs a failed round trip on every turn, and only the
 * breaker bounds that to one probe per cooldown. Query truncation already keeps well-formed
 * requests inside provider input limits, so a rejection is a health signal, not a request quirk.
 */
function isCircuitFailure(error: unknown): boolean {
  if (isMemoryProviderDeadlineError(error)) return true
  return (error as { name?: string } | null)?.name !== 'AbortError'
}
