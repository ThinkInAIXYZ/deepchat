import type { PowerMonitor } from 'electron'
import type { CronJob, CronJobRun, CronJobsSchedulerStatus } from '@shared/cronJobs'
import type { cronJobsUpsertInputSchema } from '@shared/contracts/routes/cronJobs.routes'
import type { z } from 'zod'
import type { SQLitePresenter } from '../sqlitePresenter'
import { CronJobsRepository } from './repository'
import {
  SchedulerProcessManager,
  type SchedulerProcessManagerDeps,
  type SchedulerRunDueEvent
} from './schedulerProcessManager'

export type CronJobsUpsertInput = z.input<typeof cronJobsUpsertInputSchema>

export interface CronJobsServiceDeps {
  sqlitePresenter: SQLitePresenter
  schedulerManager?: SchedulerProcessManager
  createSchedulerManager?: (
    deps: Omit<SchedulerProcessManagerDeps, 'spawnHost'>
  ) => SchedulerProcessManager
  powerMonitor?: Pick<PowerMonitor, 'on' | 'off'>
}

export class CronJobsService {
  private readonly repository: CronJobsRepository
  private readonly schedulerManager: SchedulerProcessManager
  private started = false
  private powerMonitor: Pick<PowerMonitor, 'on' | 'off'> | null = null
  private readonly resumeHandler = () => {
    void this.reconcileScheduler('system-resume')
  }

  constructor(deps: CronJobsServiceDeps) {
    this.repository = new CronJobsRepository(deps.sqlitePresenter)
    const managerDeps: Omit<SchedulerProcessManagerDeps, 'spawnHost'> = {
      dbPath: deps.sqlitePresenter.getDatabasePath(),
      dbPassword: deps.sqlitePresenter.getDatabasePassword(),
      getSnapshot: () => this.repository.getSchedulerSnapshot(),
      onRunDue: async (event) => {
        await this.processDueRun(event)
      }
    }
    this.schedulerManager =
      deps.schedulerManager ??
      deps.createSchedulerManager?.(managerDeps) ??
      new SchedulerProcessManager(managerDeps)
    this.powerMonitor = deps.powerMonitor ?? null
  }

  start(): void {
    if (this.started) {
      return
    }
    this.started = true
    void this.attachPowerMonitor()
    void this.reconcileScheduler('startup')
  }

  async stop(): Promise<void> {
    this.started = false
    if (this.powerMonitor) {
      this.powerMonitor.off('resume', this.resumeHandler)
      this.powerMonitor = null
    }
    await this.schedulerManager.stop('app-quit')
  }

  async list(): Promise<{
    jobs: CronJob[]
    schedulerStatus: CronJobsSchedulerStatus
  }> {
    await this.reconcileScheduler('list')
    return {
      jobs: this.repository.listJobs(),
      schedulerStatus: this.schedulerManager.getStatus()
    }
  }

  async upsert(input: CronJobsUpsertInput): Promise<{
    job: CronJob
    schedulerStatus: CronJobsSchedulerStatus
  }> {
    const job = this.repository.upsertJob(input)
    const schedulerStatus = await this.reconcileScheduler('job-upsert')
    return { job, schedulerStatus }
  }

  async delete(id: string): Promise<CronJobsSchedulerStatus> {
    this.repository.deleteJob(id)
    return await this.reconcileScheduler('job-delete')
  }

  async toggle(
    id: string,
    enabled: boolean
  ): Promise<{
    job: CronJob
    schedulerStatus: CronJobsSchedulerStatus
  }> {
    const job = this.repository.setJobEnabled(id, enabled)
    const schedulerStatus = await this.reconcileScheduler('job-toggle')
    return { job, schedulerStatus }
  }

  async runNow(id: string): Promise<{
    job: CronJob
    run: CronJobRun
    schedulerStatus: CronJobsSchedulerStatus
  }> {
    const job = this.repository.requireJob(id)
    const run = this.repository.queueRun({
      jobId: id,
      scheduledAt: Date.now(),
      reason: 'manual'
    })
    await this.processDueRun({
      jobId: id,
      runId: run.id,
      scheduledAt: run.scheduledAt,
      reason: run.reason
    })
    const completed = this.repository.getRun(run.id) ?? run
    const schedulerStatus = await this.reconcileScheduler('manual-run')
    return { job, run: completed, schedulerStatus }
  }

  getSchedulerStatus(): CronJobsSchedulerStatus {
    return this.schedulerManager.getStatus()
  }

  async reconcileScheduler(reason = 'manual'): Promise<CronJobsSchedulerStatus> {
    return await this.schedulerManager.reconcile(reason)
  }

  async restartScheduler(): Promise<CronJobsSchedulerStatus> {
    return await this.schedulerManager.restart()
  }

  private async attachPowerMonitor(): Promise<void> {
    if (this.powerMonitor) {
      this.powerMonitor.off('resume', this.resumeHandler)
      this.powerMonitor.on('resume', this.resumeHandler)
      return
    }

    try {
      const { powerMonitor } = await import('electron')
      this.powerMonitor = powerMonitor
      powerMonitor.off('resume', this.resumeHandler)
      powerMonitor.on('resume', this.resumeHandler)
    } catch (error) {
      console.warn('[CronJobs] Failed to attach power monitor resume handler:', error)
    }
  }

  private async processDueRun(event: SchedulerRunDueEvent): Promise<void> {
    const run = this.repository.getRun(event.runId)
    if (!run) {
      console.warn('[CronJobs] Ignoring unknown run from scheduler:', event.runId)
      return
    }

    try {
      this.repository.markRunRunning(event.runId)
      this.repository.markRunCompleted(event.runId)
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      try {
        this.repository.markRunFailed(event.runId, message)
      } catch (markError) {
        console.error('[CronJobs] Failed to mark run as failed:', markError)
      }
    }
  }
}

export { CronJobsRepository }
