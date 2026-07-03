import { randomUUID } from 'node:crypto'
import type { CronJob, CronJobRun } from '@shared/cronJobs'
import {
  subscribeDeepChatInternalSessionUpdates,
  type DeepChatInternalSessionUpdate
} from '../agentRuntimePresenter/internalSessionEvents'
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
  private readonly activeSessions = new Map<string, string>()
  private readonly unsubscribeSessionUpdates: () => void

  constructor(
    private readonly repository: CronJobsRepository,
    private readonly sessionStarter: CronJobRunSessionStarter
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
      return this.repository.markRunCancelled(run.id, 'Another cron job run is already active.')
    }

    let sessionId: string | null = null
    try {
      const result = await this.sessionStarter.createSessionForRun({ job: input.job, run })
      sessionId = result.sessionId
      this.repository.updateRunSession(run.id, result.sessionId)
      this.activeSessions.set(result.sessionId, run.id)
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
      return this.repository.markRunFailed(
        run.id,
        error instanceof Error ? error.message : String(error)
      )
    }
  }

  private handleSessionUpdate(update: DeepChatInternalSessionUpdate): void {
    const runId = this.activeSessions.get(update.sessionId)
    if (!runId) {
      return
    }

    if (update.kind === 'blocks') {
      this.captureRunOutput(runId, update)
      return
    }

    if (update.kind !== 'status') {
      return
    }

    if (update.status === 'idle') {
      this.completeRun(runId, update.sessionId)
      return
    }

    if (update.status === 'error') {
      this.failRun(runId, update.sessionId)
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

  private completeRun(runId: string, sessionId: string): void {
    const current = this.repository.getRun(runId)
    if (!current || current.status !== 'running') {
      this.activeSessions.delete(sessionId)
      return
    }
    this.repository.markRunCompleted(runId)
    this.activeSessions.delete(sessionId)
  }

  private failRun(runId: string, sessionId: string): void {
    const current = this.repository.getRun(runId)
    if (!current || current.status !== 'running') {
      this.activeSessions.delete(sessionId)
      return
    }
    this.repository.markRunFailed(runId, 'Agent session entered error state.')
    this.activeSessions.delete(sessionId)
  }
}
