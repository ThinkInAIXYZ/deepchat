import { randomUUID } from 'node:crypto'
import type { CronJob, CronJobRun } from '@shared/cronJobs'
import {
  subscribeDeepChatInternalSessionUpdates,
  type DeepChatInternalSessionUpdate
} from '../agentRuntimePresenter/internalSessionEvents'
import type { CronJobDeliveryRouter } from './deliveryRouter'
import { CronJobsRepository } from './repository'

export interface CronJobRunSessionStarter {
  createSessionForRun(input: { job: CronJob; run: CronJobRun }): Promise<{
    sessionId: string
    outputMessageId?: string | null
    outputPreview?: string | null
  }>
  startSessionRun(input: { job: CronJob; run: CronJobRun; sessionId: string }): Promise<{
    outputMessageId?: string | null
    outputPreview?: string | null
  }>
}

export class CronJobRunExecutor {
  private readonly claimOwner = `cron-job-runner:${process.pid}:${randomUUID()}`
  private readonly activeSessions = new Map<string, { runId: string; job: CronJob }>()
  private readonly unsubscribeSessionUpdates: () => void

  constructor(
    private readonly repository: CronJobsRepository,
    private readonly sessionStarter: CronJobRunSessionStarter,
    private readonly deliveryRouter?: CronJobDeliveryRouter
  ) {
    this.unsubscribeSessionUpdates = subscribeDeepChatInternalSessionUpdates((update) =>
      this.handleSessionUpdate(update)
    )
  }

  dispose(): void {
    this.unsubscribeSessionUpdates()
    this.activeSessions.clear()
  }

  async execute(input: { runId: string; job: CronJob }): Promise<CronJobRun | null> {
    const run = this.repository.claimRun(input.runId, this.claimOwner)
    if (!run) {
      return this.repository.getRun(input.runId)
    }

    const activeRuns = this.repository.countActiveRunsByJob(input.job.id, run.id)
    if (activeRuns > 0) {
      if (input.job.runtime.concurrencyPolicy === 'queue') {
        return this.repository.releaseRunQueued(run.id)
      }
      const cancelled = this.repository.markRunCancelled(
        run.id,
        'Another cron job run is already active.'
      )
      await this.deliverRun(input.job, cancelled)
      return cancelled
    }

    let sessionId: string | null = null
    try {
      const result = await this.sessionStarter.createSessionForRun({ job: input.job, run })
      sessionId = result.sessionId
      this.repository.updateRunSession(run.id, result.sessionId)
      this.activeSessions.set(result.sessionId, { runId: run.id, job: input.job })
      if (result.outputMessageId || result.outputPreview) {
        this.repository.updateRunOutput(run.id, {
          outputMessageId: result.outputMessageId ?? null,
          outputPreview: result.outputPreview ?? null
        })
      }
      const startResult = await this.sessionStarter.startSessionRun({
        job: input.job,
        run,
        sessionId: result.sessionId
      })
      if (startResult?.outputMessageId || startResult?.outputPreview) {
        this.repository.updateRunOutput(run.id, {
          outputMessageId: startResult.outputMessageId ?? null,
          outputPreview: startResult.outputPreview ?? null
        })
      }
      return this.repository.getRun(run.id)
    } catch (error) {
      if (sessionId) {
        this.activeSessions.delete(sessionId)
      }
      const failed = this.repository.markRunFailed(
        run.id,
        error instanceof Error ? error.message : String(error)
      )
      await this.deliverRun(input.job, failed)
      return failed
    }
  }

  private handleSessionUpdate(update: DeepChatInternalSessionUpdate): void {
    const activeSession = this.activeSessions.get(update.sessionId)
    if (!activeSession) {
      return
    }

    if (update.kind === 'blocks') {
      this.captureRunOutput(activeSession.runId, update)
      return
    }

    if (update.kind !== 'status') {
      return
    }

    if (update.status === 'idle') {
      this.completeRun(activeSession.runId, activeSession.job, update.sessionId)
      return
    }

    if (update.status === 'error') {
      this.failRun(activeSession.runId, activeSession.job, update.sessionId)
    }
  }

  private captureRunOutput(runId: string, update: DeepChatInternalSessionUpdate): void {
    const current = this.repository.getRun(runId)
    if (!current || current.status !== 'running') {
      return
    }
    if (!update.messageId && !update.previewMarkdown) {
      return
    }
    this.repository.updateRunOutput(runId, {
      outputMessageId: update.messageId ?? null,
      outputPreview: update.previewMarkdown ?? null
    })
  }

  private completeRun(runId: string, job: CronJob, sessionId: string): void {
    const current = this.repository.getRun(runId)
    if (!current || current.status !== 'running') {
      this.activeSessions.delete(sessionId)
      return
    }
    const completed = this.repository.markRunCompleted(runId)
    this.activeSessions.delete(sessionId)
    void this.deliverRun(job, completed)
  }

  private failRun(runId: string, job: CronJob, sessionId: string): void {
    const current = this.repository.getRun(runId)
    if (!current || current.status !== 'running') {
      this.activeSessions.delete(sessionId)
      return
    }
    const failed = this.repository.markRunFailed(runId, 'Agent session entered error state.')
    this.activeSessions.delete(sessionId)
    void this.deliverRun(job, failed)
  }

  private async deliverRun(job: CronJob, run: CronJobRun): Promise<void> {
    try {
      await this.deliveryRouter?.deliver({ job, run })
    } catch (error) {
      console.error('[CronJobs] Failed to deliver run result:', error)
    }
  }
}
