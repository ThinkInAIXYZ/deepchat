import type { PowerMonitor } from 'electron'
import type {
  CronJob,
  CronJobAgentSnapshot,
  CronJobRun,
  CronJobsSchedulerStatus,
  CronJobStatus,
  CronSchedulePreview,
  CronScheduleValidation
} from '@shared/cronJobs'
import { CRON_JOBS_DEFAULT_RUNTIME as DEFAULT_RUNTIME } from '@shared/cronJobs'
import type { cronJobsUpsertInputSchema } from '@shared/contracts/routes/cronJobs.routes'
import type { IConfigPresenter } from '@shared/presenter'
import type { z } from 'zod'
import type { SQLitePresenter } from '../sqlitePresenter'
import { CronExpressionService } from './cronExpressionService'
import { CronJobsRepository } from './repository'
import { CronJobRunExecutor, type CronJobRunSessionStarter } from './runExecutor'
import { CronJobRuntimeResolver } from './runtimeResolver'
import {
  SchedulerProcessManager,
  type SchedulerProcessManagerDeps,
  type SchedulerRunDueEvent
} from './schedulerProcessManager'

export type CronJobsUpsertInput = z.input<typeof cronJobsUpsertInputSchema>
type CronJobDraft = Omit<CronJob, 'id' | 'createdAt' | 'updatedAt'> & {
  id?: string
}

export interface CronJobsServiceDeps {
  sqlitePresenter: SQLitePresenter
  configPresenter?: Pick<IConfigPresenter, 'listAgents' | 'resolveDeepChatAgentConfig'>
  schedulerManager?: SchedulerProcessManager
  scheduleService?: CronExpressionService
  runtimeResolver?: CronJobRuntimeResolver
  runSessionStarter?: CronJobRunSessionStarter
  createSchedulerManager?: (
    deps: Omit<SchedulerProcessManagerDeps, 'spawnHost'>
  ) => SchedulerProcessManager
  powerMonitor?: Pick<PowerMonitor, 'on' | 'off'>
}

export class CronJobsService {
  private readonly repository: CronJobsRepository
  private readonly schedulerManager: SchedulerProcessManager
  private readonly scheduleService: CronExpressionService
  private readonly runtimeResolver: CronJobRuntimeResolver | null
  private runExecutor: CronJobRunExecutor | null = null
  private started = false
  private powerMonitor: Pick<PowerMonitor, 'on' | 'off'> | null = null
  private readonly resumeHandler = () => {
    void this.reconcileScheduler('system-resume')
  }

  constructor(deps: CronJobsServiceDeps) {
    this.repository = new CronJobsRepository(deps.sqlitePresenter)
    this.scheduleService = deps.scheduleService ?? new CronExpressionService()
    this.runtimeResolver =
      deps.runtimeResolver ??
      (deps.configPresenter ? new CronJobRuntimeResolver(deps.configPresenter) : null)
    if (deps.runSessionStarter) {
      this.runExecutor = new CronJobRunExecutor(this.repository, deps.runSessionStarter)
    }
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
    const draft = this.buildJobDraft(input)
    const jobState = await this.computeJobState(draft, Date.now(), true)
    const job = this.repository.upsertJob({
      ...draft,
      enabled: jobState.enabled,
      status: jobState.status,
      nextRunAt: jobState.nextRunAt,
      scheduleError: jobState.scheduleError,
      agentSnapshot: jobState.agentSnapshot
    })
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
    const existing = this.repository.requireJob(id)
    const draft = this.buildJobDraft({
      ...existing,
      enabled
    })
    const jobState = await this.computeJobState(draft, Date.now(), true)
    const job = this.repository.upsertJob({
      ...draft,
      enabled: jobState.enabled,
      status: jobState.status,
      nextRunAt: jobState.nextRunAt,
      scheduleError: jobState.scheduleError,
      agentSnapshot: jobState.agentSnapshot
    })
    const schedulerStatus = await this.reconcileScheduler('job-toggle')
    return { job, schedulerStatus }
  }

  async runNow(id: string): Promise<{
    job: CronJob
    run: CronJobRun
    schedulerStatus: CronJobsSchedulerStatus
  }> {
    const job = this.repository.requireJob(id)
    await this.assertRunnable(job)
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

  listRuns(jobId: string, limit?: number): CronJobRun[] {
    this.repository.requireJob(jobId)
    return this.repository.listRunsByJob(jobId, limit)
  }

  getRun(id: string): CronJobRun {
    return this.repository.requireRun(id)
  }

  setRunSessionStarter(runSessionStarter: CronJobRunSessionStarter): void {
    this.runExecutor?.dispose()
    this.runExecutor = new CronJobRunExecutor(this.repository, runSessionStarter)
  }

  getSchedulerStatus(): CronJobsSchedulerStatus {
    return this.schedulerManager.getStatus()
  }

  async reconcileScheduler(reason = 'manual'): Promise<CronJobsSchedulerStatus> {
    await this.reconcileStoredSchedules(Date.now())
    return await this.schedulerManager.reconcile(reason)
  }

  async restartScheduler(): Promise<CronJobsSchedulerStatus> {
    return await this.schedulerManager.restart()
  }

  validateSchedule(input: {
    cronExpr: string
    timezone: string
    from?: number
  }): CronScheduleValidation {
    return this.scheduleService.validate(input.cronExpr, input.timezone, input.from)
  }

  previewSchedule(input: {
    cronExpr: string
    timezone: string
    count?: number
    from?: number
  }): CronSchedulePreview {
    return this.scheduleService.preview(input.cronExpr, input.timezone, input.count, input.from)
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

  private buildJobDraft(input: CronJobsUpsertInput): CronJobDraft {
    const existing = input.id ? this.repository.getJob(input.id) : null
    return {
      id: input.id,
      name: input.name,
      description: input.description ?? existing?.description ?? null,
      enabled: input.enabled,
      status: input.status ?? existing?.status ?? (input.enabled ? 'ready' : 'disabled'),
      cronExpr: input.cronExpr,
      timezone: input.timezone,
      agentId: input.agentId,
      nextRunAt: input.nextRunAt ?? existing?.nextRunAt ?? null,
      misfirePolicy: input.misfirePolicy ?? existing?.misfirePolicy ?? 'skip',
      maxCatchUpRuns: input.maxCatchUpRuns ?? existing?.maxCatchUpRuns ?? null,
      scheduleError: input.scheduleError ?? existing?.scheduleError ?? null,
      taskPrompt: input.taskPrompt ?? existing?.taskPrompt ?? '',
      taskSystemInstruction: input.taskSystemInstruction ?? existing?.taskSystemInstruction ?? null,
      taskOutputMode: input.taskOutputMode ?? existing?.taskOutputMode ?? 'final_message',
      modelPolicy: input.modelPolicy ?? existing?.modelPolicy ?? 'follow_agent',
      toolPolicy: input.toolPolicy ?? existing?.toolPolicy ?? 'follow_agent',
      permissionPolicy: input.permissionPolicy ?? existing?.permissionPolicy ?? 'follow_agent',
      runtime: input.runtime ?? existing?.runtime ?? { ...DEFAULT_RUNTIME },
      agentSnapshot: input.agentSnapshot ?? existing?.agentSnapshot ?? null
    }
  }

  private async computeJobState(
    input: Pick<
      CronJob,
      | 'enabled'
      | 'cronExpr'
      | 'timezone'
      | 'agentId'
      | 'taskPrompt'
      | 'modelPolicy'
      | 'toolPolicy'
      | 'permissionPolicy'
      | 'agentSnapshot'
    >,
    now: number,
    throwOnInvalid: boolean
  ): Promise<{
    enabled: boolean
    status: CronJobStatus
    nextRunAt: number | null
    scheduleError: string | null
    agentSnapshot: CronJobAgentSnapshot | null
  }> {
    const validation = this.scheduleService.validate(input.cronExpr, input.timezone, now)
    let status = await this.resolveAgentStatus(input)
    let enabled = input.enabled
    const taskPrompt = input.taskPrompt.trim()

    if (!enabled && status === 'ready') {
      status = 'disabled'
    }

    if (enabled && !taskPrompt) {
      if (throwOnInvalid) {
        throw new Error('Cron job task prompt is required.')
      }
      enabled = false
      status = 'disabled'
    }

    if (enabled && status !== 'ready') {
      if (throwOnInvalid) {
        throw new Error('Cron job requires an enabled agent.')
      }
      enabled = false
    }

    if (!validation.valid && enabled) {
      if (throwOnInvalid) {
        throw new Error(validation.error ?? 'Invalid cron schedule.')
      }
      enabled = false
    }

    return {
      enabled,
      status,
      nextRunAt: enabled && status === 'ready' ? validation.nextRunAt : null,
      scheduleError: validation.error,
      agentSnapshot: await this.captureSnapshotIfNeeded(input)
    }
  }

  private async resolveAgentStatus(
    input: Pick<
      CronJob,
      'agentId' | 'modelPolicy' | 'toolPolicy' | 'permissionPolicy' | 'agentSnapshot'
    >
  ): Promise<CronJobStatus> {
    if (!input.agentId) {
      return 'disabled'
    }
    if (!this.runtimeResolver) {
      return 'ready'
    }
    return (await this.runtimeResolver.resolve(input)).status
  }

  private async captureSnapshotIfNeeded(
    input: Pick<
      CronJob,
      'agentId' | 'modelPolicy' | 'toolPolicy' | 'permissionPolicy' | 'agentSnapshot'
    >
  ): Promise<CronJobAgentSnapshot | null> {
    const shouldCapture =
      input.modelPolicy === 'pin_current' ||
      input.toolPolicy === 'snapshot' ||
      input.permissionPolicy === 'snapshot'
    if (!shouldCapture) {
      return null
    }
    return (await this.runtimeResolver?.captureSnapshot(input.agentId)) ?? input.agentSnapshot
  }

  private async assertRunnable(job: CronJob): Promise<void> {
    const state = await this.computeJobState(job, Date.now(), true)
    if (!state.enabled || state.status !== 'ready') {
      throw new Error('Cron job is not runnable.')
    }
  }

  private async reconcileStoredSchedules(now: number): Promise<void> {
    for (const job of this.repository.listJobs()) {
      const state = await this.computeJobState(job, now, false)
      if (
        job.enabled === state.enabled &&
        job.status === state.status &&
        job.nextRunAt === state.nextRunAt &&
        job.scheduleError === state.scheduleError &&
        JSON.stringify(job.agentSnapshot) === JSON.stringify(state.agentSnapshot)
      ) {
        continue
      }
      this.repository.upsertJob({
        ...job,
        enabled: state.enabled,
        status: state.status,
        nextRunAt: state.nextRunAt,
        scheduleError: state.scheduleError,
        agentSnapshot: state.agentSnapshot,
        now
      })
    }
  }

  private async processDueRun(event: SchedulerRunDueEvent): Promise<void> {
    const run = this.repository.getRun(event.runId)
    const job = this.repository.getJob(event.jobId)
    if (!run) {
      console.warn('[CronJobs] Ignoring unknown run from scheduler:', event.runId)
      return
    }
    if (!job) {
      this.repository.markRunFailed(event.runId, `Unknown cron job: ${event.jobId}`)
      return
    }

    try {
      await this.assertRunnable(job)
      if (this.runExecutor) {
        await this.runExecutor.execute({
          runId: event.runId,
          job
        })
      } else {
        this.repository.markRunRunning(event.runId)
        this.repository.markRunCompleted(event.runId)
      }
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
export type { CronJobRunSessionStarter }
