import type { CronJobsSchedulerStatus, SchedulerCommand, SchedulerEvent } from '@shared/cronJobs'
import type { CronJobsSchedulerSnapshot, SchedulerRunDueEvent } from './repository'
export type { SchedulerRunDueEvent } from './repository'

export interface SchedulerHost {
  readonly pid: number | undefined
  postMessage(command: SchedulerCommand): void
  kill(): void
  onMessage(listener: (message: unknown) => void): void
  onExit(listener: (code: number) => void): void
  onError(listener: (type: string, location: string) => void): void
}

export interface SchedulerProcessManagerDeps {
  getSnapshot: () => CronJobsSchedulerSnapshot
  queueDueRuns: () => SchedulerRunDueEvent[]
  onRunDue: (event: SchedulerRunDueEvent) => Promise<void> | void
  idleShutdownMs?: number
  maxRestartAttempts?: number
  restartDelayMs?: number
  spawnHost: (signal: AbortSignal) => Promise<SchedulerHost>
}

const DEFAULT_IDLE_SHUTDOWN_MS = 30_000
const DEFAULT_RESTART_DELAY_MS = 1_000
const DEFAULT_MAX_RESTART_ATTEMPTS = 5

export class SchedulerProcessManager {
  private host: SchedulerHost | null = null
  private hostReady: Promise<SchedulerHost> | null = null
  private pendingSpawn: AbortController | null = null
  private readonly idleShutdownMs: number
  private readonly restartDelayMs: number
  private readonly maxRestartAttempts: number
  private idleStopTimer: NodeJS.Timeout | null = null
  private restartTimer: NodeJS.Timeout | null = null
  private shuttingDown = false
  private lastScanRequestId = 0
  private hostEpoch = 0
  private status: CronJobsSchedulerStatus = {
    state: 'stopped',
    pid: null,
    enabledJobCount: 0,
    nextRunAt: null,
    lastHeartbeatAt: null,
    lastError: null,
    restartAttempts: 0,
    updatedAt: Date.now()
  }

  constructor(private readonly deps: SchedulerProcessManagerDeps) {
    this.idleShutdownMs = deps.idleShutdownMs ?? DEFAULT_IDLE_SHUTDOWN_MS
    this.restartDelayMs = deps.restartDelayMs ?? DEFAULT_RESTART_DELAY_MS
    this.maxRestartAttempts = deps.maxRestartAttempts ?? DEFAULT_MAX_RESTART_ATTEMPTS
  }

  getStatus(): CronJobsSchedulerStatus {
    return { ...this.status }
  }

  async start(reason = 'manual'): Promise<CronJobsSchedulerStatus> {
    return await this.reconcile(reason)
  }

  async reconcile(reason = 'manual'): Promise<CronJobsSchedulerStatus> {
    const snapshot = this.deps.getSnapshot()
    this.updateStatus({
      enabledJobCount: snapshot.enabledJobCount,
      nextRunAt: snapshot.nextRunAt
    })

    if (snapshot.enabledJobCount === 0) {
      this.scheduleIdleStop()
      if (!this.host) {
        this.updateStatus({ state: 'idle' })
      } else {
        this.postCommand({
          type: 'RECONCILE',
          reason,
          now: Date.now()
        })
      }
      return this.getStatus()
    }

    this.cancelIdleStop()
    const host = await this.ensureHost()
    if (this.host !== host || this.shuttingDown)
      throw new Error('Scheduler utility spawn was superseded.')
    host.postMessage({
      type: 'RECONCILE',
      reason,
      now: Date.now()
    } satisfies SchedulerCommand)
    return this.getStatus()
  }

  async restart(): Promise<CronJobsSchedulerStatus> {
    await this.stop('restart')
    this.shuttingDown = false
    this.updateStatus({ restartAttempts: 0, lastError: null })
    return await this.reconcile('restart')
  }

  async stop(reason = 'manual'): Promise<CronJobsSchedulerStatus> {
    this.shuttingDown = true
    this.hostEpoch++
    this.cancelIdleStop()
    this.cancelRestart()
    this.pendingSpawn?.abort()
    this.pendingSpawn = null

    const host = this.host
    this.host = null
    this.hostReady = null
    if (host) {
      try {
        host.postMessage({
          type: 'STOP',
          reason,
          now: Date.now()
        } satisfies SchedulerCommand)
      } catch {}

      try {
        host.kill()
      } catch {}
    }

    this.updateStatus({
      state: 'stopped',
      pid: null
    })
    return this.getStatus()
  }

  private async ensureHost(): Promise<SchedulerHost> {
    if (this.host) {
      return this.host
    }
    if (this.hostReady) {
      return await this.hostReady
    }

    this.shuttingDown = false
    this.updateStatus({ state: 'starting', lastError: null })
    const epoch = ++this.hostEpoch
    const pendingSpawn = new AbortController()
    this.pendingSpawn = pendingSpawn
    const ready = this.spawnHost(epoch, pendingSpawn.signal)
    this.hostReady = ready
    try {
      return await ready
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      if (this.hostEpoch === epoch)
        this.updateStatus({ state: 'error', pid: null, lastError: message })
      throw error
    } finally {
      if (this.hostReady === ready) this.hostReady = null
      if (this.pendingSpawn === pendingSpawn) this.pendingSpawn = null
    }
  }

  private async spawnHost(epoch: number, signal: AbortSignal): Promise<SchedulerHost> {
    const host = await this.deps.spawnHost(signal)
    if (this.hostEpoch !== epoch || this.shuttingDown) {
      host.kill()
      throw new Error('Scheduler utility spawn was superseded.')
    }
    host.onMessage((message) => this.handleHostMessage(host, message))
    host.onExit((code) => this.handleHostExit(host, code))
    host.onError((type, location) => {
      if (this.host !== host) {
        return
      }
      const message = `Scheduler utility process error: ${type} at ${location}`
      console.error('[CronJobs] Scheduler utility process error:', { type, location })
      this.updateStatus({ state: 'error', lastError: message })
    })

    this.host = host
    this.lastScanRequestId = 0
    this.updateStatus({
      state: 'running',
      pid: host.pid ?? null,
      restartAttempts: 0
    })
    host.postMessage({
      type: 'START',
      now: Date.now()
    } satisfies SchedulerCommand)
    return host
  }

  private handleHostMessage(host: SchedulerHost, message: unknown): void {
    if (this.host !== host || this.shuttingDown) {
      return
    }
    const event = unwrapSchedulerEvent(message)
    if (!event) {
      return
    }

    switch (event.type) {
      case 'READY':
        this.updateStatus({
          state: 'running',
          pid: event.pid,
          lastHeartbeatAt: event.now,
          lastError: null
        })
        return
      case 'HEARTBEAT': {
        const snapshot = this.deps.getSnapshot()
        this.updateStatus({
          state: 'running',
          ...snapshot,
          lastHeartbeatAt: event.now,
          lastError: null
        })
        if (snapshot.enabledJobCount === 0) {
          this.scheduleIdleStop()
        } else this.cancelIdleStop()
        return
      }
      case 'IDLE': {
        const snapshot = this.deps.getSnapshot()
        this.updateStatus({
          state: snapshot.enabledJobCount === 0 ? 'idle' : 'running',
          ...snapshot,
          lastHeartbeatAt: event.now
        })
        if (snapshot.enabledJobCount === 0) this.scheduleIdleStop()
        else this.cancelIdleStop()
        return
      }
      case 'SCAN_DUE':
        if (event.requestId !== this.lastScanRequestId + 1) {
          this.updateStatus({ state: 'error', lastError: 'Invalid scheduler scan sequence.' })
          host.kill()
          return
        }
        this.lastScanRequestId = event.requestId
        this.scanDueRuns(host, event.requestId)
        return
      case 'ERROR':
        console.error('[CronJobs] Scheduler utility error:', event.message)
        this.updateStatus({
          state: 'error',
          lastError: event.message,
          lastHeartbeatAt: event.now
        })
        if (event.fatal) host.kill()
        return
    }
  }

  private scanDueRuns(host: SchedulerHost, requestId: number): void {
    let error: string | undefined
    try {
      const events = this.deps.queueDueRuns()
      for (const event of events) {
        // Dispatch committed runs at the owner even if the timer reply is lost.
        try {
          void Promise.resolve(this.deps.onRunDue(event)).catch((error) => {
            console.error('[CronJobs] Failed to process due run:', error)
          })
        } catch (error) {
          console.error('[CronJobs] Failed to process due run:', error)
        }
      }
    } catch (cause) {
      error = (cause instanceof Error ? cause.message : String(cause)).slice(0, 4096)
      this.updateStatus({ state: 'error', lastError: error })
    }
    if (this.host !== host || this.shuttingDown) return
    try {
      host.postMessage({
        type: 'SCAN_RESULT',
        requestId,
        ...this.deps.getSnapshot(),
        ...(error !== undefined ? { error } : {}),
        now: Date.now()
      } satisfies SchedulerCommand)
    } catch (cause) {
      console.error('[CronJobs] Failed to reply to scheduler scan:', cause)
      host.kill()
    }
  }

  private handleHostExit(host: SchedulerHost, code: number): void {
    if (this.host !== host) {
      return
    }
    const message = `Cron scheduler utility exited with code ${code}.`
    const hasEnabledJobs = this.deps.getSnapshot().enabledJobCount > 0
    const expectedExit = this.shuttingDown || !hasEnabledJobs
    this.host = null
    this.hostReady = null
    this.updateStatus({
      state: expectedExit ? (this.shuttingDown ? 'stopped' : 'idle') : 'error',
      pid: null,
      lastError: expectedExit ? null : message
    })

    if (expectedExit) {
      return
    }
    this.scheduleRestart()
  }

  private postCommand(command: SchedulerCommand): void {
    try {
      this.host?.postMessage(command)
    } catch (error) {
      console.error('[CronJobs] Failed to post scheduler command:', error)
    }
  }

  private scheduleIdleStop(): void {
    if (this.idleStopTimer || !this.host) {
      return
    }
    this.idleStopTimer = setTimeout(() => {
      this.idleStopTimer = null
      if (this.deps.getSnapshot().enabledJobCount === 0) {
        void this.stop('idle')
      }
    }, this.idleShutdownMs)
  }

  private cancelIdleStop(): void {
    if (!this.idleStopTimer) {
      return
    }
    clearTimeout(this.idleStopTimer)
    this.idleStopTimer = null
  }

  private scheduleRestart(): void {
    if (this.restartTimer || this.status.restartAttempts >= this.maxRestartAttempts) {
      return
    }

    const nextAttempts = this.status.restartAttempts + 1
    this.updateStatus({ restartAttempts: nextAttempts })
    this.restartTimer = setTimeout(() => {
      this.restartTimer = null
      void this.reconcile('restart-after-exit').catch((error) => {
        const message = error instanceof Error ? error.message : String(error)
        this.updateStatus({ state: 'error', lastError: message })
        this.scheduleRestart()
      })
    }, this.restartDelayMs)
  }

  private cancelRestart(): void {
    if (!this.restartTimer) {
      return
    }
    clearTimeout(this.restartTimer)
    this.restartTimer = null
  }

  private updateStatus(patch: Partial<CronJobsSchedulerStatus>): void {
    this.status = {
      ...this.status,
      ...patch,
      updatedAt: Date.now()
    }
  }
}

function unwrapSchedulerEvent(message: unknown): SchedulerEvent | null {
  const payload =
    message && typeof message === 'object' && 'data' in message
      ? (message as { data?: unknown }).data
      : message

  if (!payload || typeof payload !== 'object' || !('type' in payload)) {
    return null
  }

  const event = payload as Record<string, unknown>
  const nonnegativeInteger = (value: unknown): value is number =>
    typeof value === 'number' && Number.isSafeInteger(value) && value >= 0
  if (!nonnegativeInteger(event.now)) return null
  switch (event.type) {
    case 'READY':
      if (event.pid !== null && (!nonnegativeInteger(event.pid) || event.pid === 0)) return null
      break
    case 'HEARTBEAT':
    case 'IDLE':
      if (
        !nonnegativeInteger(event.enabledJobCount) ||
        (event.nextRunAt !== null && !nonnegativeInteger(event.nextRunAt))
      )
        return null
      break
    case 'SCAN_DUE':
      if (!nonnegativeInteger(event.requestId) || event.requestId === 0) return null
      break
    case 'ERROR':
      if (
        typeof event.message !== 'string' ||
        event.message.length > 4096 ||
        (event.fatal !== undefined && typeof event.fatal !== 'boolean') ||
        (event.stack !== undefined && typeof event.stack !== 'string')
      )
        return null
      break
    default:
      return null
  }
  return event as unknown as SchedulerEvent
}
