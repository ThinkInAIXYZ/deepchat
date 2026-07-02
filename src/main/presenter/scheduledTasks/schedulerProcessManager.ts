import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import log from 'electron-log'
import type { SchedulerProcessStatus } from '@shared/scheduledTasks'
import type { SchedulerEvent } from './schedulerProtocol'
import type { SchedulerStore } from './schedulerStore'

type UtilityProcess = import('electron').UtilityProcess

const IDLE_EXIT_MS = 30_000
const RESTART_DELAYS_MS = [0, 1000, 5000, 15_000] as const
const CRASH_WINDOW_MS = 5 * 60_000
const MAX_CRASHES_IN_WINDOW = 5

export class SchedulerProcessManager {
  private proc: UtilityProcess | null = null
  private idleExitTimer: NodeJS.Timeout | null = null
  private restartTimer: NodeJS.Timeout | null = null
  private crashTimes: number[] = []
  private stopping = false
  private status: SchedulerProcessStatus = {
    state: 'stopped',
    enabledTaskCount: 0,
    nextRunAt: null
  }

  constructor(
    private readonly deps: {
      store: SchedulerStore
      getDatabasePath: () => string
      getDatabasePassword: () => string | undefined
      executeQueuedRun: (taskId: string, runId: string) => Promise<void>
    }
  ) {}

  getStatus(): SchedulerProcessStatus {
    this.refreshCounts()
    return { ...this.status }
  }

  async ensureRunning(
    reason: 'startup' | 'task_changed' | 'resume' | 'scheduler_restart'
  ): Promise<void> {
    this.refreshCounts()
    if (this.status.enabledTaskCount === 0) {
      this.scheduleIdleExit()
      return
    }

    this.clearIdleExit()
    if (this.proc) {
      this.post({ type: 'RECONCILE', reason })
      return
    }

    await this.startProcess(reason)
  }

  async reconcileNow(): Promise<SchedulerProcessStatus> {
    await this.ensureRunning('task_changed')
    this.post({ type: 'RECONCILE', reason: 'manual' })
    return this.getStatus()
  }

  async restart(): Promise<SchedulerProcessStatus> {
    this.stopProcess('restart')
    await this.ensureRunning('scheduler_restart')
    return this.getStatus()
  }

  onTaskChanged(taskId: string): void {
    void this.ensureRunning('task_changed')
    this.post({ type: 'TASK_CHANGED', taskId })
  }

  stop(reason: 'no_enabled_tasks' | 'app_quit' | 'restart' = 'app_quit'): void {
    this.stopping = true
    this.stopProcess(reason)
    this.status = {
      state: 'stopped',
      enabledTaskCount: this.deps.store.countEnabledTasks(),
      nextRunAt: this.deps.store.getNearestNextRunAt()
    }
  }

  private async startProcess(
    reason: 'startup' | 'task_changed' | 'resume' | 'scheduler_restart'
  ): Promise<void> {
    this.status.state = 'starting'
    this.status.startedAt = Date.now()
    this.stopping = false

    const { app, utilityProcess } = await import('electron')
    const modulePath = this.resolveUtilityHostEntryPoint(app.getAppPath())
    const proc = utilityProcess.fork(modulePath, ['--deepchat-scheduled-tasks-host'], {
      serviceName: 'DeepChat Scheduled Tasks',
      stdio: 'ignore',
      env: {
        ...process.env,
        DEEPCHAT_SCHEDULED_TASKS_HOST: '1'
      }
    })

    this.proc = proc
    proc.on('message', (message) => this.handleMessage(message))
    proc.on('exit', (code) => this.handleExit(code))
    proc.on('error', (type, location) => {
      const message = `[scheduler] utility process error type=${type} location=${location}`
      this.status.lastError = message
      log.error(message)
    })
    proc.once('spawn', () => {
      this.post({
        type: 'START',
        dbPath: this.deps.getDatabasePath(),
        dbPassword: this.deps.getDatabasePassword(),
        owner: `scheduler-${process.pid}-${Date.now()}`
      })
      this.post({ type: 'RECONCILE', reason })
    })
  }

  private stopProcess(reason: 'no_enabled_tasks' | 'app_quit' | 'restart'): void {
    this.clearIdleExit()
    if (this.restartTimer) {
      clearTimeout(this.restartTimer)
      this.restartTimer = null
    }
    if (!this.proc) {
      return
    }
    try {
      this.proc.postMessage({ type: 'STOP', reason })
    } catch {
      // Process may already be gone.
    }
    this.proc.kill()
    this.proc = null
  }

  private post(message: unknown): void {
    if (!this.proc) {
      return
    }
    try {
      this.proc.postMessage(message)
    } catch (error) {
      this.status.lastError = error instanceof Error ? error.message : String(error)
    }
  }

  private handleMessage(message: unknown): void {
    const event = unwrapMessage(message)
    if (!isSchedulerEvent(event)) {
      return
    }

    switch (event.type) {
      case 'READY':
        this.status.state = 'running'
        this.status.pid = event.pid
        return
      case 'HEARTBEAT':
        this.status.state = event.enabledTaskCount === 0 ? 'idle' : 'running'
        this.status.pid = event.pid
        this.status.lastHeartbeatAt = event.now
        this.status.enabledTaskCount = event.enabledTaskCount
        this.status.nextRunAt = event.nextRunAt
        return
      case 'RUN_DUE':
        void this.deps.executeQueuedRun(event.taskId, event.runId).catch((error) => {
          log.error('[scheduler] queued run execution failed:', error)
        })
        return
      case 'IDLE':
        this.status.state = 'idle'
        this.status.enabledTaskCount = event.enabledTaskCount
        this.scheduleIdleExit()
        return
      case 'ERROR':
        this.status.lastError = event.error
        log.error('[scheduler] utility error:', event.error, event.stack)
        return
    }
  }

  private handleExit(code: number): void {
    this.proc = null
    if (this.stopping) {
      return
    }

    this.status.state = 'crashed'
    this.status.lastError = `Scheduler utility exited with code ${code}`
    this.refreshCounts()
    if (this.status.enabledTaskCount === 0) {
      this.status.state = 'stopped'
      return
    }

    const now = Date.now()
    this.crashTimes = [...this.crashTimes.filter((time) => now - time <= CRASH_WINDOW_MS), now]
    if (this.crashTimes.length > MAX_CRASHES_IN_WINDOW) {
      return
    }

    const delay =
      RESTART_DELAYS_MS[Math.min(this.crashTimes.length - 1, RESTART_DELAYS_MS.length - 1)]
    this.restartTimer = setTimeout(() => {
      this.restartTimer = null
      void this.ensureRunning('scheduler_restart')
    }, delay)
  }

  private scheduleIdleExit(): void {
    if (!this.proc || this.idleExitTimer) {
      return
    }
    this.idleExitTimer = setTimeout(() => {
      this.idleExitTimer = null
      if (this.deps.store.countEnabledTasks() === 0) {
        this.stopProcess('no_enabled_tasks')
        this.status.state = 'stopped'
      }
    }, IDLE_EXIT_MS)
  }

  private clearIdleExit(): void {
    if (this.idleExitTimer) {
      clearTimeout(this.idleExitTimer)
      this.idleExitTimer = null
    }
  }

  private refreshCounts(): void {
    this.status.enabledTaskCount = this.deps.store.countEnabledTasks()
    this.status.nextRunAt = this.deps.store.getNearestNextRunAt()
  }

  private resolveUtilityHostEntryPoint(appPath?: string): string {
    const modulePath = fileURLToPath(import.meta.url)
    const candidates = [
      ...(appPath
        ? [
            path.join(appPath, 'out/main/scheduledTasksUtilityHost.js'),
            path.join(appPath, 'scheduledTasksUtilityHost.js')
          ]
        : []),
      path.resolve(path.dirname(modulePath), 'scheduledTasksUtilityHost.js'),
      path.resolve(path.dirname(modulePath), '../scheduledTasksUtilityHost.js'),
      path.resolve(process.cwd(), 'out/main/scheduledTasksUtilityHost.js')
    ]

    return candidates.find((candidate) => fs.existsSync(candidate)) ?? candidates[0]
  }
}

function unwrapMessage(message: unknown): unknown {
  if (message && typeof message === 'object' && 'data' in message) {
    return (message as { data?: unknown }).data
  }
  return message
}

function isSchedulerEvent(value: unknown): value is SchedulerEvent {
  return (
    Boolean(value) &&
    typeof value === 'object' &&
    typeof (value as SchedulerEvent).type === 'string'
  )
}
