import type { InjectionKey } from 'vue'
import type {
  RendererPerformanceRecord,
  RendererPerformancePhase,
  RendererStartupWorkloadTaskId,
  RendererStartupWorkloadTaskState
} from '@shared/contracts/routes'
import { createPerformanceClient } from '@api/PerformanceClient'

export type StartupWorkloadTaskSnapshot = {
  id: RendererStartupWorkloadTaskId
  state: RendererStartupWorkloadTaskState | 'pending' | 'running'
  startedAt?: number
  updatedAt?: number
}

type RendererPerformanceSubmit = (record: RendererPerformanceRecord) => Promise<boolean>

type StartupPhaseOptions = {
  startupRunId?: string
  fallback?: boolean
  outcome?: RendererPerformanceRecord['outcome']
}

const MAX_PENDING_RECORDS = 24
const MAX_ELAPSED_MS = 24 * 60 * 60 * 1000

function getMonotonicNow(): number | null {
  if (typeof performance === 'undefined' || typeof performance.now !== 'function') {
    return null
  }
  return performance.now()
}

function clampElapsed(elapsedMs: number): number {
  return Math.max(0, Math.min(MAX_ELAPSED_MS, elapsedMs))
}

/**
 * App-scoped renderer diagnostic reporter. It owns no Vue state and only accepts allowlisted
 * metadata, so feature code cannot accidentally persist user content through performance logs.
 */
export class RendererPerformanceReporter {
  private readonly startedAt = getMonotonicNow()
  private enabled = false
  private disposed = false
  private startupRunId: string | undefined
  private pendingRecords: RendererPerformanceRecord[] = []
  private readonly observedWorkloadTerminals = new Set<string>()
  private readonly sessionStartedAt = new Map<number, number | null>()

  constructor(
    private readonly submit: RendererPerformanceSubmit = (record) =>
      createPerformanceClient().recordRenderer(record),
    private readonly now: () => number | null = getMonotonicNow,
    private readonly onSubmitError: () => void = () => {
      console.warn('[RendererPerformance] Failed to submit diagnostic record')
    }
  ) {}

  setEnabled(enabled: boolean): void {
    if (this.disposed) return

    this.enabled = enabled
    if (!enabled) {
      this.pendingRecords = []
      return
    }

    if (this.startupRunId) {
      this.flushPendingStartupRecords()
      return
    }

    const pendingNonStartupRecords = this.pendingRecords.filter(
      (record) => record.scope !== 'startup'
    )
    this.pendingRecords = this.pendingRecords.filter((record) => record.scope === 'startup')
    for (const record of pendingNonStartupRecords) {
      this.submitRecord(record)
    }
  }

  recordStartup(
    phase: Extract<
      RendererPerformancePhase,
      | 'shell-mounted'
      | 'app-stores-ready'
      | 'bootstrap-ready'
      | 'bootstrap-fallback'
      | 'route-ready'
      | 'interactive'
      | 'deferred-settled'
    >,
    options: StartupPhaseOptions = {}
  ): void {
    if (options.startupRunId) {
      this.startupRunId = options.startupRunId
      this.flushPendingStartupRecords()
    }

    this.record({
      schemaVersion: 1,
      source: 'chat-main',
      scope: 'startup',
      phase,
      outcome: options.outcome ?? 'completed',
      elapsedMs: this.elapsedSinceStart(),
      startupRunId: this.startupRunId,
      fallback: options.fallback
    })
  }

  observeStartupWorkload(
    startupRunId: string | null,
    tasks: readonly StartupWorkloadTaskSnapshot[]
  ): void {
    if (!startupRunId) return

    for (const task of tasks) {
      if (task.state !== 'completed' && task.state !== 'failed' && task.state !== 'cancelled') {
        continue
      }
      if (!task.startedAt || !task.updatedAt) {
        continue
      }

      const terminalKey = `${startupRunId}:${task.id}`
      if (this.observedWorkloadTerminals.has(terminalKey)) {
        continue
      }
      this.observedWorkloadTerminals.add(terminalKey)
      this.record({
        schemaVersion: 1,
        source: 'chat-main',
        scope: 'workload',
        phase: 'deferred-settled',
        outcome: task.state,
        elapsedMs: clampElapsed(task.updatedAt - task.startedAt),
        startupRunId,
        workloadTaskId: task.id,
        workloadTaskState: task.state
      })
    }
  }

  recordChatSession(
    phase: Extract<
      RendererPerformancePhase,
      | 'selected'
      | 'preparation-started'
      | 'cache-committed'
      | 'messages-prepared'
      | 'messages-committed'
      | 'first-message-paint'
      | 'input-ready'
      | 'secondary-state-ready'
    >,
    sessionEpoch: number
  ): void {
    if (phase === 'selected') {
      this.sessionStartedAt.set(sessionEpoch, this.now())
    }
    const sessionStartedAt = this.sessionStartedAt.get(sessionEpoch)
    const now = this.now()
    const elapsedMs =
      sessionStartedAt === null || sessionStartedAt === undefined || now === null
        ? 0
        : clampElapsed(now - sessionStartedAt)

    this.record({
      schemaVersion: 1,
      source: 'chat-main',
      scope: 'chat-session',
      phase,
      outcome: 'completed',
      elapsedMs,
      startupRunId: this.startupRunId,
      sessionEpoch
    })
  }

  dispose(): void {
    this.disposed = true
    this.pendingRecords = []
    this.observedWorkloadTerminals.clear()
    this.sessionStartedAt.clear()
  }

  private elapsedSinceStart(): number {
    const now = this.now()
    if (this.startedAt === null || now === null) {
      return 0
    }
    return clampElapsed(now - this.startedAt)
  }

  private record(record: RendererPerformanceRecord): void {
    const normalizedRecord = Object.fromEntries(
      Object.entries(record).filter(([, value]) => value !== undefined)
    ) as RendererPerformanceRecord

    if (this.disposed) return
    if (!this.enabled) {
      if (this.pendingRecords.length < MAX_PENDING_RECORDS) {
        this.pendingRecords.push(normalizedRecord)
      }
      return
    }
    if (normalizedRecord.scope === 'startup' && !normalizedRecord.startupRunId) {
      if (this.pendingRecords.length < MAX_PENDING_RECORDS) {
        this.pendingRecords.push(normalizedRecord)
      }
      return
    }
    this.submitRecord(normalizedRecord)
  }

  private flushPendingStartupRecords(): void {
    if (!this.enabled || !this.startupRunId) return

    const activeStartupRunId = this.startupRunId
    const pendingRecords = this.pendingRecords
    this.pendingRecords = []
    for (const record of pendingRecords) {
      if (record.scope !== 'startup') {
        this.submitRecord(record)
        continue
      }
      if (record.startupRunId && record.startupRunId !== activeStartupRunId) {
        this.pendingRecords.push(record)
        continue
      }
      this.submitRecord({ ...record, startupRunId: activeStartupRunId })
    }
  }

  private submitRecord(record: RendererPerformanceRecord): void {
    void this.submit(record).catch(() => this.onSubmitError())
  }
}

export const RENDERER_PERFORMANCE_REPORTER: InjectionKey<RendererPerformanceReporter> = Symbol(
  'renderer-performance-reporter'
)
