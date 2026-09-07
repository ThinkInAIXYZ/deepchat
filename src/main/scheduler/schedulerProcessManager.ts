import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'
import type { UtilityProcess } from 'electron'
import type { CronJobsSchedulerStatus, SchedulerCommand, SchedulerEvent } from '@shared/cronJobs'
import type { CronJobsSchedulerSnapshot } from './repository'

type SchedulerUtilityProcess = Pick<UtilityProcess, 'postMessage' | 'kill' | 'pid'> & {
  on(event: 'message', listener: (message: unknown) => void): SchedulerUtilityProcess
  on(event: 'exit', listener: (code: number) => void): SchedulerUtilityProcess
  on(event: 'error', listener: (type: string, location: string) => void): SchedulerUtilityProcess
  once(event: 'spawn', listener: () => void): SchedulerUtilityProcess
  once(event: 'exit', listener: (code: number) => void): SchedulerUtilityProcess
  off(event: 'spawn', listener: () => void): SchedulerUtilityProcess
  off(event: 'exit', listener: (code: number) => void): SchedulerUtilityProcess
}

export interface SchedulerRunDueEvent {
  jobId: string
  runId: string
  scheduledAt: number
  reason: 'scheduled' | 'manual'
}

export interface SchedulerProcessManagerDeps {
  dbPath: string
  dbPassword?: string
  getSnapshot: () => CronJobsSchedulerSnapshot
  onRunDue: (event: SchedulerRunDueEvent) => Promise<void> | void
  idleShutdownMs?: number
  maxRestartAttempts?: number
  restartDelayMs?: number
  spawnHost?: () => Promise<SchedulerUtilityProcess>
}

const DEFAULT_IDLE_SHUTDOWN_MS = 30_000
const DEFAULT_RESTART_DELAY_MS = 1_000
const DEFAULT_MAX_RESTART_ATTEMPTS = 5

export class SchedulerProcessManager {
  private host: SchedulerUtilityProcess | null = null
  private hostReady: Promise<SchedulerUtilityProcess> | null = null
  private readonly idleShutdownMs: number
  private readonly restartDelayMs: number
  private readonly maxRestartAttempts: number
  private idleStopTimer: NodeJS.Timeout | null = null
  private restartTimer: NodeJS.Timeout | null = null
  private shuttingDown = false
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
    this.cancelIdleStop()
    this.cancelRestart()

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

  private async ensureHost(): Promise<SchedulerUtilityProcess> {
    if (this.host) {
      return this.host
    }
    if (this.hostReady) {
      return await this.hostReady
    }

    this.shuttingDown = false
    this.updateStatus({ state: 'starting', lastError: null })
    this.hostReady = this.spawnHost()
    try {
      return await this.hostReady
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      this.updateStatus({ state: 'error', pid: null, lastError: message })
      throw error
    } finally {
      this.hostReady = null
    }
  }

  private async spawnHost(): Promise<SchedulerUtilityProcess> {
    const host = this.deps.spawnHost ? await this.deps.spawnHost() : await this.spawnDefaultHost()
    host.on('message', (message) => this.handleHostMessage(host, message))
    host.on('exit', (code) => this.handleHostExit(host, code))
    host.on('error', (type, location) => {
      if (this.host !== host) {
        return
      }
      const message = `Scheduler utility process error: ${type} at ${location}`
      console.error('[CronJobs] Scheduler utility process error:', { type, location })
      this.updateStatus({ state: 'error', lastError: message })
    })

    this.host = host
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

  private async spawnDefaultHost(): Promise<SchedulerUtilityProcess> {
    const { app, utilityProcess } = await import('electron')
    const modulePath = this.resolveUtilityHostEntryPoint(app.getAppPath())
    const host = utilityProcess.fork(modulePath, ['--deepchat-cron-scheduler-host'], {
      serviceName: 'DeepChat Cron Jobs Scheduler',
      stdio: 'ignore',
      env: {
        ...process.env,
        DEEPCHAT_CRON_SCHEDULER_HOST: '1',
        DEEPCHAT_CRON_SCHEDULER_DB_PATH: this.deps.dbPath,
        ...(this.deps.dbPassword
          ? { DEEPCHAT_CRON_SCHEDULER_DB_PASSWORD: this.deps.dbPassword }
          : {})
      }
    }) as SchedulerUtilityProcess

    return await new Promise<SchedulerUtilityProcess>((resolve, reject) => {
      let settled = false
      const settle = (callback: () => void) => {
        if (settled) {
          return
        }
        settled = true
        host.off('spawn', onSpawn)
        host.off('exit', onExit)
        callback()
      }
      const onSpawn = () => {
        settle(() => resolve(host))
      }
      const onExit = (code: number) => {
        settle(() => reject(new Error(`Cron scheduler utility exited before spawn: ${code}`)))
      }

      host.once('spawn', onSpawn)
      host.once('exit', onExit)
    })
  }

  private resolveUtilityHostEntryPoint(appPath?: string): string {
    const modulePath = fileURLToPath(import.meta.url)
    const candidates = [
      ...(appPath
        ? [
            path.join(appPath, 'out/main/schedulerUtilityHost.js'),
            path.join(appPath, 'schedulerUtilityHost.js')
          ]
        : []),
      path.resolve(path.dirname(modulePath), 'schedulerUtilityHost.js'),
      path.resolve(path.dirname(modulePath), '../schedulerUtilityHost.js'),
      path.resolve(process.cwd(), 'out/main/schedulerUtilityHost.js')
    ]

    return candidates.find((candidate) => fs.existsSync(candidate)) ?? candidates[0]
  }

  private handleHostMessage(host: SchedulerUtilityProcess, message: unknown): void {
    if (this.host !== host) {
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
      case 'HEARTBEAT':
        this.updateStatus({
          state: 'running',
          enabledJobCount: event.enabledJobCount,
          nextRunAt: event.nextRunAt,
          lastHeartbeatAt: event.now,
          lastError: null
        })
        if (event.enabledJobCount === 0) {
          this.scheduleIdleStop()
        }
        return
      case 'IDLE':
        this.updateStatus({
          state: 'idle',
          enabledJobCount: event.enabledJobCount,
          nextRunAt: event.nextRunAt,
          lastHeartbeatAt: event.now
        })
        this.scheduleIdleStop()
        return
      case 'RUN_DUE':
        console.info('[CronJobs] Scheduler reported due run:', {
          jobId: event.jobId,
          runId: event.runId,
          scheduledAt: event.scheduledAt,
          reason: event.reason
        })
        void Promise.resolve(
          this.deps.onRunDue({
            jobId: event.jobId,
            runId: event.runId,
            scheduledAt: event.scheduledAt,
            reason: event.reason
          })
        ).catch((error) => {
          console.error('[CronJobs] Failed to process due run:', error)
        })
        return
      case 'ERROR':
        console.error('[CronJobs] Scheduler utility error:', event.message)
        this.updateStatus({
          state: 'error',
          lastError: event.message,
          lastHeartbeatAt: event.now
        })
        return
    }
  }

  private handleHostExit(host: SchedulerUtilityProcess, code: number): void {
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

  const type = (payload as { type?: unknown }).type
  if (
    type === 'READY' ||
    type === 'HEARTBEAT' ||
    type === 'RUN_DUE' ||
    type === 'IDLE' ||
    type === 'ERROR'
  ) {
    return payload as SchedulerEvent
  }

  return null
}
