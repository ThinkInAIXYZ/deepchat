import { randomUUID } from 'node:crypto'
import type { CronJob, CronJobRun } from '@shared/cronJobs'
import {
  subscribeDeepChatInternalSessionUpdates,
  type DeepChatInternalSessionUpdate
} from '../agentRuntimePresenter/internalSessionEvents'
import type { CronJobDeliveryRouter } from './deliveryRouter'
import { CronJobsRepository } from './repository'

type CronRunDeliverySegment = NonNullable<DeepChatInternalSessionUpdate['deliverySegments']>[number]

const formatRunDeliverySegment = (segment: CronRunDeliverySegment): string => {
  const text = segment.text.trim()
  if (!text) {
    return ''
  }

  if (segment.kind === 'process') {
    return `Process\n${text}`
  }

  if (segment.kind === 'terminal') {
    return `Status\n${text}`
  }

  return `Answer\n${text}`
}

const getRunOutputPreview = (update: DeepChatInternalSessionUpdate): string | null => {
  const deliveryText =
    update.deliverySegments?.map(formatRunDeliverySegment).filter(Boolean).join('\n\n').trim() ?? ''
  return deliveryText || update.responseMarkdown || update.previewMarkdown || null
}

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
    console.info('[CronJobs] Executor claiming run:', {
      jobId: input.job.id,
      runId: input.runId,
      jobName: input.job.name
    })
    const run = this.repository.claimRun(input.runId, this.claimOwner)
    if (!run) {
      console.warn('[CronJobs] Executor could not claim run:', {
        jobId: input.job.id,
        runId: input.runId
      })
      return this.repository.getRun(input.runId)
    }

    const activeRuns = this.repository.countActiveRunsByJob(input.job.id, run.id)
    if (activeRuns > 0) {
      if (input.job.runtime.concurrencyPolicy === 'queue') {
        console.info('[CronJobs] Requeued run because another run is active:', {
          jobId: input.job.id,
          runId: run.id,
          activeRuns
        })
        return this.repository.releaseRunQueued(run.id)
      }
      console.info('[CronJobs] Skipped run because another run is active:', {
        jobId: input.job.id,
        runId: run.id,
        activeRuns
      })
      const cancelled = this.repository.markRunCancelled(
        run.id,
        'Another cron job run is already active.'
      )
      return cancelled
    }

    let sessionId: string | null = null
    try {
      console.info('[CronJobs] Creating session for run:', {
        jobId: input.job.id,
        runId: run.id,
        agentId: input.job.agentId
      })
      const result = await this.sessionStarter.createSessionForRun({ job: input.job, run })
      sessionId = result.sessionId
      console.info('[CronJobs] Created session for run:', {
        jobId: input.job.id,
        runId: run.id,
        sessionId
      })
      this.repository.updateRunSession(run.id, result.sessionId)
      this.activeSessions.set(result.sessionId, { runId: run.id, job: input.job })
      if (result.outputMessageId || result.outputPreview) {
        this.repository.updateRunOutput(run.id, {
          outputMessageId: result.outputMessageId ?? null,
          outputPreview: result.outputPreview ?? null
        })
      }
      console.info('[CronJobs] Starting session run:', {
        jobId: input.job.id,
        runId: run.id,
        sessionId: result.sessionId
      })
      const startResult = await this.sessionStarter.startSessionRun({
        job: input.job,
        run,
        sessionId: result.sessionId
      })
      console.info('[CronJobs] Session run started:', {
        jobId: input.job.id,
        runId: run.id,
        sessionId: result.sessionId,
        outputMessageId: startResult?.outputMessageId ?? null
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
      console.error('[CronJobs] Run execution failed:', {
        jobId: input.job.id,
        runId: run.id,
        sessionId,
        error
      })
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
    const outputPreview = getRunOutputPreview(update)
    if (!update.messageId && !outputPreview) {
      return
    }
    this.repository.updateRunOutput(runId, {
      outputMessageId: update.messageId ?? null,
      outputPreview
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
