import type { SchedulerCommand, SchedulerEvent } from '@shared/cronJobs'

const SCHEDULER_HOST_ARG = '--deepchat-cron-scheduler-host'
const HEARTBEAT_INTERVAL_MS = 5_000
const MAX_SCAN_DELAY_MS = 30_000

type ParentPort = {
  postMessage(message: unknown): void
  on(event: 'message', listener: (message: unknown) => void): void
  start?(): void
}

type SchedulerSnapshot = { enabledJobCount: number; nextRunAt: number | null }

function isSchedulerCommand(message: unknown): message is SchedulerCommand {
  if (!message || typeof message !== 'object' || !('type' in message)) return false
  if (message.type === 'START' || message.type === 'STOP' || message.type === 'RECONCILE')
    return true
  if (message.type !== 'SCAN_RESULT') return false
  const result = message as Extract<SchedulerCommand, { type: 'SCAN_RESULT' }>
  return (
    Number.isSafeInteger(result.requestId) &&
    result.requestId > 0 &&
    Number.isSafeInteger(result.enabledJobCount) &&
    result.enabledJobCount >= 0 &&
    (result.nextRunAt === null ||
      (Number.isSafeInteger(result.nextRunAt) && result.nextRunAt >= 0)) &&
    (result.error === undefined || typeof result.error === 'string')
  )
}

export class CronJobsSchedulerUtilityHost {
  private heartbeatTimer: NodeJS.Timeout | null = null
  private scanTimer: NodeJS.Timeout | null = null
  private replyTimer: NodeJS.Timeout | null = null
  private shuttingDown = false
  private requestId = 0
  private pendingRequestId: number | null = null
  private reconcileRequested = false
  private snapshot: SchedulerSnapshot = { enabledJobCount: 0, nextRunAt: null }

  constructor(private readonly options: { postMessage: (message: SchedulerEvent) => void }) {}

  start(): void {
    if (this.shuttingDown || this.heartbeatTimer) return
    this.send({ type: 'READY', pid: process.pid || null, now: Date.now() })
    this.heartbeatTimer = setInterval(() => this.sendHeartbeat(), HEARTBEAT_INTERVAL_MS)
    this.reconcile()
  }

  reconcile(): void {
    if (this.shuttingDown) return
    this.clearScanTimer()
    if (this.pendingRequestId !== null) {
      this.reconcileRequested = true
      return
    }
    const requestId = ++this.requestId
    this.pendingRequestId = requestId
    this.replyTimer = setTimeout(() => {
      this.shutdown()
      this.send({
        type: 'ERROR',
        message: 'Scheduler Store scan timed out.',
        fatal: true,
        now: Date.now()
      })
    }, MAX_SCAN_DELAY_MS)
    this.send({ type: 'SCAN_DUE', requestId, now: Date.now() })
  }

  applyScanResult(result: Extract<SchedulerCommand, { type: 'SCAN_RESULT' }>): void {
    if (this.shuttingDown || result.requestId !== this.pendingRequestId) return
    if (this.replyTimer) clearTimeout(this.replyTimer)
    this.replyTimer = null
    this.pendingRequestId = null
    this.snapshot = { enabledJobCount: result.enabledJobCount, nextRunAt: result.nextRunAt }
    this.sendHeartbeat()
    if (result.error !== undefined) {
      this.reconcileRequested = false
      this.send({ type: 'ERROR', message: result.error, now: Date.now() })
      this.scheduleScan(MAX_SCAN_DELAY_MS)
      return
    }
    if (this.reconcileRequested) {
      this.reconcileRequested = false
      this.reconcile()
      return
    }
    if (this.snapshot.enabledJobCount === 0) {
      this.send({ type: 'IDLE', ...this.snapshot, now: Date.now() })
      return
    }
    this.scheduleScan(
      this.snapshot.nextRunAt === null
        ? MAX_SCAN_DELAY_MS
        : Math.min(Math.max(this.snapshot.nextRunAt - Date.now(), 0), MAX_SCAN_DELAY_MS)
    )
  }

  shutdown(): void {
    this.shuttingDown = true
    if (this.heartbeatTimer) clearInterval(this.heartbeatTimer)
    if (this.replyTimer) clearTimeout(this.replyTimer)
    this.heartbeatTimer = null
    this.replyTimer = null
    this.pendingRequestId = null
    this.clearScanTimer()
  }

  private scheduleScan(delay: number): void {
    this.clearScanTimer()
    this.scanTimer = setTimeout(() => {
      this.scanTimer = null
      this.reconcile()
    }, delay)
  }

  private clearScanTimer(): void {
    if (this.scanTimer) clearTimeout(this.scanTimer)
    this.scanTimer = null
  }

  private sendHeartbeat(): void {
    this.send({ type: 'HEARTBEAT', ...this.snapshot, now: Date.now() })
  }

  private send(message: SchedulerEvent): void {
    this.options.postMessage(message)
  }
}

export function runSchedulerUtilityHostIfRequested(): boolean {
  if (
    process.env.DEEPCHAT_CRON_SCHEDULER_HOST !== '1' &&
    !process.argv.includes(SCHEDULER_HOST_ARG)
  )
    return false
  const parentPort = (process as NodeJS.Process & { parentPort?: ParentPort }).parentPort
  if (!parentPort) throw new Error('Cron scheduler utility host started without a parent port.')
  const host = new CronJobsSchedulerUtilityHost({
    postMessage: (message) => parentPort.postMessage(message)
  })
  const keepAliveIntervalId = setInterval(() => {}, 2 ** 31 - 1)
  parentPort.start?.()
  parentPort.on('message', (message) => {
    const command =
      message && typeof message === 'object' && 'data' in message
        ? (message as { data: unknown }).data
        : message
    if (!isSchedulerCommand(command)) return
    switch (command.type) {
      case 'START':
        host.start()
        return
      case 'RECONCILE':
        host.reconcile()
        return
      case 'SCAN_RESULT':
        host.applyScanResult(command)
        return
      case 'STOP':
        clearInterval(keepAliveIntervalId)
        host.shutdown()
        process.exit(0)
    }
  })
  process.once('beforeExit', () => {
    clearInterval(keepAliveIntervalId)
    host.shutdown()
  })
  return true
}
