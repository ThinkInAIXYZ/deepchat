import {
  createEmptyMemoryRuntimeDiagnostics,
  type MemoryDistributionDto,
  type MemoryRuntimeDiagnosticsDto
} from '@shared/contracts/routes/memory.routes'
import {
  MEMORY_MAINTENANCE_BUDGET_STEPS,
  MEMORY_RECALL_LATENCY_STAGES,
  MEMORY_RETRIEVAL_DEGRADATION_CAUSES,
  MEMORY_RETRIEVAL_OUTCOMES,
  MEMORY_RETRIEVAL_PURPOSES,
  type MemoryMaintenanceBudgetStep,
  type MemoryRecallLatencyStage,
  type MemoryRetrievalDegradationCause,
  type MemoryRetrievalOutcome,
  type MemoryRetrievalPurpose
} from '@shared/types/agent-memory'
import type { MemoryPerfObserver } from '../../ports'
import { BoundedNumberRing, summarizeNumberDistribution } from '@/lib/boundedNumberRing'

const DEFAULT_MAX_AGENTS = 64
const DEFAULT_SAMPLE_CAPACITY = 256
const DEFAULT_AGENT_TTL_MS = 24 * 60 * 60 * 1000

function normalizePositiveInteger(value: number | undefined, fallback: number): number {
  if (value === undefined || !Number.isFinite(value)) return fallback
  const normalized = Math.floor(value)
  return normalized > 0 ? normalized : fallback
}

function distribution(values: number[]): MemoryDistributionDto {
  return summarizeNumberDistribution(values)
}

type RetrievalDiagnosticsState = {
  recallLatency: Record<MemoryRecallLatencyStage, BoundedNumberRing>
  ftsCandidates: number
  vectorCandidates: number
  selected: number
  outcomeCounts: Record<MemoryRetrievalOutcome, number>
  degradationCounts: Record<MemoryRetrievalDegradationCause, number>
}

type AgentDiagnosticsState = {
  lastTouchedAt: number
  retrieval: Record<MemoryRetrievalPurpose, RetrievalDiagnosticsState>
  queryEmbeddingCircuit: {
    state: 'closed' | 'open' | 'halfOpen'
    failures: number
    openCount: number
    skipped: number
  }
  extraction: {
    chunksCompleted: number
    chunksCancelled: number
    chunksFailed: number
    llmCalls: number
    casRetries: number
  }
  embedding: {
    batchSize: BoundedNumberRing
    drainDurationMs: BoundedNumberRing
    succeeded: number
    failed: number
    ftsOnly: number
  }
  maintenance: {
    cheapDurationMs: BoundedNumberRing
    heavyDurationMs: BoundedNumberRing
    completed: number
    skipped: number
    failed: number
    llmCalls: number
    llmTokens: number
    budgetDeniedByStep: Record<MemoryMaintenanceBudgetStep, number>
  }
}

export type MemoryRecallDiagnosticSample = {
  purpose: MemoryRetrievalPurpose
  latencyMs: Partial<Record<MemoryRecallLatencyStage, number>>
  ftsCandidates: number
  vectorCandidates: number
  selected: number
  outcome: MemoryRetrievalOutcome
  degradations: readonly MemoryRetrievalDegradationCause[]
}

export type MemoryExtractionDiagnosticSample = {
  outcome: 'completed' | 'cancelled' | 'failed'
  llmCalls: number
  casRetries: number
}

export type MemoryEmbeddingDiagnosticSample = {
  batchSize: number
  drainDurationMs: number
  succeeded: number
  failed: number
  ftsOnly: number
}

export type MemoryMaintenanceDiagnosticSample = {
  phase: 'cheap' | 'heavy'
  durationMs: number
  outcome: 'completed' | 'skipped' | 'failed'
  llmCalls: number
  llmTokens: number
  budgetDeniedByStep?: Partial<Record<MemoryMaintenanceBudgetStep, number>>
}

export class MemoryDiagnosticsCollector {
  private readonly agents = new Map<string, AgentDiagnosticsState>()
  private readonly maxAgents: number
  private readonly sampleCapacity: number
  private process = createEmptyMemoryRuntimeDiagnostics().process
  private oldestExtractionQueuedAt: number | null = null

  constructor(
    private readonly options: {
      now?: () => number
      maxAgents?: number
      sampleCapacity?: number
      agentTtlMs?: number
    } = {}
  ) {
    this.maxAgents = normalizePositiveInteger(options.maxAgents, DEFAULT_MAX_AGENTS)
    this.sampleCapacity = normalizePositiveInteger(options.sampleCapacity, DEFAULT_SAMPLE_CAPACITY)
  }

  recordRecall(agentId: string, sample: MemoryRecallDiagnosticSample): void {
    this.safely(() => {
      const state = this.agent(agentId).retrieval[sample.purpose]
      for (const stage of MEMORY_RECALL_LATENCY_STAGES) {
        const value = sample.latencyMs[stage]
        if (value !== undefined) state.recallLatency[stage].push(value)
      }
      state.ftsCandidates += this.count(sample.ftsCandidates)
      state.vectorCandidates += this.count(sample.vectorCandidates)
      state.selected += this.count(sample.selected)
      const outcome = MEMORY_RETRIEVAL_OUTCOMES.includes(sample.outcome) ? sample.outcome : 'failed'
      state.outcomeCounts[outcome] += 1
      for (const degradation of new Set(sample.degradations)) {
        const normalized = MEMORY_RETRIEVAL_DEGRADATION_CAUSES.includes(degradation)
          ? degradation
          : 'unknown'
        state.degradationCounts[normalized] += 1
      }
    })
  }

  recordQueryEmbeddingCircuitEvent(
    agentId: string,
    event: 'failure' | 'opened' | 'halfOpen' | 'closed' | 'probeCancelled' | 'skipped'
  ): void {
    this.safely(() => {
      const circuit = this.agent(agentId).queryEmbeddingCircuit
      if (event === 'failure') circuit.failures += 1
      else if (event === 'opened') {
        circuit.state = 'open'
        circuit.openCount += 1
      } else if (event === 'halfOpen') circuit.state = 'halfOpen'
      else if (event === 'closed') circuit.state = 'closed'
      else if (event === 'probeCancelled') circuit.state = 'open'
      else circuit.skipped += 1
    })
  }

  resetQueryEmbeddingCircuit(agentId: string): void {
    this.safely(() => {
      const state = this.agents.get(agentId)
      if (!state) return
      state.queryEmbeddingCircuit = {
        state: 'closed',
        failures: 0,
        openCount: 0,
        skipped: 0
      }
    })
  }

  recordExtraction(agentId: string, sample: MemoryExtractionDiagnosticSample): void {
    this.safely(() => {
      const counters = this.agent(agentId).extraction
      if (sample.outcome === 'completed') counters.chunksCompleted += 1
      else if (sample.outcome === 'cancelled') counters.chunksCancelled += 1
      else counters.chunksFailed += 1
      counters.llmCalls += this.count(sample.llmCalls)
      counters.casRetries += this.count(sample.casRetries)
    })
  }

  recordEmbedding(agentId: string, sample: MemoryEmbeddingDiagnosticSample): void {
    this.safely(() => {
      const embedding = this.agent(agentId).embedding
      embedding.batchSize.push(sample.batchSize)
      embedding.drainDurationMs.push(sample.drainDurationMs)
      embedding.succeeded += this.count(sample.succeeded)
      embedding.failed += this.count(sample.failed)
      embedding.ftsOnly += this.count(sample.ftsOnly)
    })
  }

  recordMaintenance(agentId: string, sample: MemoryMaintenanceDiagnosticSample): void {
    this.safely(() => {
      const maintenance = this.agent(agentId).maintenance
      const target =
        sample.phase === 'cheap' ? maintenance.cheapDurationMs : maintenance.heavyDurationMs
      target.push(sample.durationMs)
      maintenance[sample.outcome] += 1
      maintenance.llmCalls += this.count(sample.llmCalls)
      maintenance.llmTokens += this.count(sample.llmTokens)
      for (const step of MEMORY_MAINTENANCE_BUDGET_STEPS) {
        maintenance.budgetDeniedByStep[step] += this.count(sample.budgetDeniedByStep?.[step] ?? 0)
      }
    })
  }

  observeExtractionQueue(depth: number, oldestQueuedAt: number | null): void {
    this.safely(() => {
      this.process.extractionQueue = {
        depth: this.count(depth),
        oldestQueuedAgeMs: oldestQueuedAt === null ? null : Math.max(0, this.now() - oldestQueuedAt)
      }
      this.oldestExtractionQueuedAt = oldestQueuedAt
    })
  }

  observeEmbeddingBacklog(pending: number, activeAgents: number): void {
    this.safely(() => {
      this.process.embeddingBacklog = {
        pending: this.count(pending),
        activeAgents: this.count(activeAgents)
      }
    })
  }

  observeVectorResources(openStores: number, activeLeases: number): void {
    this.safely(() => {
      const vector = this.process.vector
      vector.openStores = this.count(openStores)
      vector.activeLeases = this.count(activeLeases)
      vector.openStoresHighWater = Math.max(vector.openStoresHighWater, vector.openStores)
      vector.activeLeasesHighWater = Math.max(vector.activeLeasesHighWater, vector.activeLeases)
    })
  }

  observeProviderQueue(queued: number): void {
    this.safely(() => {
      this.process.providerAdmission.queued = this.count(queued)
    })
  }

  recordVectorOutcome(
    outcome: 'eviction' | 'warmupSucceeded' | 'warmupDeferred' | 'warmupFailed'
  ): void {
    this.safely(() => {
      if (outcome === 'eviction') this.process.vector.evictions += 1
      else this.process.vector[outcome] += 1
    })
  }

  recordProviderAdmissionDecision(outcome: 'admitted' | 'rateLimited' | 'capacityRejected'): void {
    this.safely(() => {
      this.process.providerAdmission.admissionDecisions[outcome] += 1
    })
  }

  recordProviderRaceEvent(outcome: 'deadline' | 'aborted' | 'lateSettled'): void {
    this.safely(() => {
      this.process.providerAdmission.raceEvents[outcome] += 1
    })
  }

  snapshot(agentId: string): MemoryRuntimeDiagnosticsDto {
    const empty = createEmptyMemoryRuntimeDiagnostics()
    try {
      this.sweepExpired()
      const state = this.agents.get(agentId)
      const process = structuredClone(this.process)
      process.extractionQueue.oldestQueuedAgeMs =
        this.oldestExtractionQueuedAt === null
          ? null
          : Math.max(0, this.now() - this.oldestExtractionQueuedAt)
      if (!state) return { agent: empty.agent, process }
      return {
        agent: {
          retrieval: Object.fromEntries(
            MEMORY_RETRIEVAL_PURPOSES.map((purpose) => {
              const retrieval = state.retrieval[purpose]
              return [
                purpose,
                {
                  latencyMs: Object.fromEntries(
                    MEMORY_RECALL_LATENCY_STAGES.map((stage) => [
                      stage,
                      distribution(retrieval.recallLatency[stage].snapshot())
                    ])
                  ),
                  ftsCandidates: retrieval.ftsCandidates,
                  vectorCandidates: retrieval.vectorCandidates,
                  selected: retrieval.selected,
                  outcomeCounts: { ...retrieval.outcomeCounts },
                  degradationCounts: { ...retrieval.degradationCounts }
                }
              ]
            })
          ) as MemoryRuntimeDiagnosticsDto['agent']['retrieval'],
          queryEmbeddingCircuit: { ...state.queryEmbeddingCircuit },
          extraction: { ...state.extraction },
          embedding: {
            batchSize: distribution(state.embedding.batchSize.snapshot()),
            drainDurationMs: distribution(state.embedding.drainDurationMs.snapshot()),
            succeeded: state.embedding.succeeded,
            failed: state.embedding.failed,
            ftsOnly: state.embedding.ftsOnly
          },
          maintenance: {
            cheapDurationMs: distribution(state.maintenance.cheapDurationMs.snapshot()),
            heavyDurationMs: distribution(state.maintenance.heavyDurationMs.snapshot()),
            completed: state.maintenance.completed,
            skipped: state.maintenance.skipped,
            failed: state.maintenance.failed,
            llmCalls: state.maintenance.llmCalls,
            llmTokens: state.maintenance.llmTokens,
            budgetDeniedByStep: { ...state.maintenance.budgetDeniedByStep }
          }
        },
        process
      }
    } catch {
      return empty
    }
  }

  cleanupAgent(agentId: string): void {
    this.safely(() => this.agents.delete(agentId))
  }

  clear(): void {
    this.safely(() => {
      this.agents.clear()
      this.process = createEmptyMemoryRuntimeDiagnostics().process
      this.oldestExtractionQueuedAt = null
    })
  }

  createPerfObserverAdapter(): MemoryPerfObserver {
    let openStores = 0
    let activeLeases = 0
    return {
      increment: () => undefined,
      observe: (name, value) => {
        if (name === 'openStores') openStores = value
        if (name === 'activeLeases') activeLeases = value
        if (name === 'queueDepth') this.observeProviderQueue(value)
        if (name === 'openStores' || name === 'activeLeases') {
          this.observeVectorResources(openStores, activeLeases)
        }
      }
    }
  }

  private agent(agentId: string): AgentDiagnosticsState {
    const existing = this.agents.get(agentId)
    if (existing) {
      existing.lastTouchedAt = this.now()
      this.agents.delete(agentId)
      this.agents.set(agentId, existing)
      return existing
    }
    if (this.agents.size >= this.maxAgents) this.sweepExpired()
    while (this.agents.size >= this.maxAgents) {
      const oldestAgentId = this.agents.keys().next().value as string | undefined
      if (!oldestAgentId) break
      this.agents.delete(oldestAgentId)
    }
    const ringRecord = () =>
      Object.fromEntries(
        MEMORY_RECALL_LATENCY_STAGES.map((stage) => [
          stage,
          new BoundedNumberRing(this.sampleCapacity)
        ])
      ) as Record<MemoryRecallLatencyStage, BoundedNumberRing>
    const retrievalState = (): RetrievalDiagnosticsState => ({
      recallLatency: ringRecord(),
      ftsCandidates: 0,
      vectorCandidates: 0,
      selected: 0,
      outcomeCounts: Object.fromEntries(
        MEMORY_RETRIEVAL_OUTCOMES.map((outcome) => [outcome, 0])
      ) as Record<MemoryRetrievalOutcome, number>,
      degradationCounts: Object.fromEntries(
        MEMORY_RETRIEVAL_DEGRADATION_CAUSES.map((cause) => [cause, 0])
      ) as Record<MemoryRetrievalDegradationCause, number>
    })
    const state: AgentDiagnosticsState = {
      lastTouchedAt: this.now(),
      retrieval: Object.fromEntries(
        MEMORY_RETRIEVAL_PURPOSES.map((purpose) => [purpose, retrievalState()])
      ) as Record<MemoryRetrievalPurpose, RetrievalDiagnosticsState>,
      queryEmbeddingCircuit: {
        state: 'closed',
        failures: 0,
        openCount: 0,
        skipped: 0
      },
      extraction: {
        chunksCompleted: 0,
        chunksCancelled: 0,
        chunksFailed: 0,
        llmCalls: 0,
        casRetries: 0
      },
      embedding: {
        batchSize: new BoundedNumberRing(this.sampleCapacity),
        drainDurationMs: new BoundedNumberRing(this.sampleCapacity),
        succeeded: 0,
        failed: 0,
        ftsOnly: 0
      },
      maintenance: {
        cheapDurationMs: new BoundedNumberRing(this.sampleCapacity),
        heavyDurationMs: new BoundedNumberRing(this.sampleCapacity),
        completed: 0,
        skipped: 0,
        failed: 0,
        llmCalls: 0,
        llmTokens: 0,
        budgetDeniedByStep: Object.fromEntries(
          MEMORY_MAINTENANCE_BUDGET_STEPS.map((step) => [step, 0])
        ) as Record<MemoryMaintenanceBudgetStep, number>
      }
    }
    this.agents.set(agentId, state)
    return state
  }

  private sweepExpired(): void {
    const cutoff = this.now() - (this.options.agentTtlMs ?? DEFAULT_AGENT_TTL_MS)
    for (const [agentId, state] of this.agents) {
      if (state.lastTouchedAt < cutoff) this.agents.delete(agentId)
    }
  }

  private now(): number {
    return this.options.now?.() ?? Date.now()
  }

  private count(value: number): number {
    return Number.isFinite(value) ? Math.max(0, Math.floor(value)) : 0
  }

  private safely(operation: () => void): void {
    try {
      operation()
    } catch {
      // Diagnostics must never affect memory behavior.
    }
  }
}

export function createCompositeMemoryPerfObserver(
  observers: Array<MemoryPerfObserver | undefined>
): MemoryPerfObserver {
  const active = observers.filter(
    (observer): observer is MemoryPerfObserver => observer !== undefined
  )
  return {
    increment(name, amount) {
      for (const observer of active) {
        try {
          observer.increment(name, amount)
        } catch {
          // Observation is best-effort and must not affect the owner.
        }
      }
    },
    observe(name, value) {
      for (const observer of active) {
        try {
          observer.observe(name, value)
        } catch {
          // Observation is best-effort and must not affect the owner.
        }
      }
    }
  }
}
