import { randomUUID } from 'node:crypto'
import type { CronJob, CronJobRun } from '@shared/cronJobs'
import type { SessionRuntimeEventPort, SessionRuntimeUpdate } from '@/session/runtimeEvents'
import { isSessionBusyError } from '@/session/turn'
import type { CronJobDeliveryRouter } from './deliveryRouter'
import { CronJobsRepository } from './repository'

type CronRunDeliverySegment = NonNullable<SessionRuntimeUpdate['deliverySegments']>[number]

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

const getRunOutputPreview = (update: SessionRuntimeUpdate): string | null => {
  const deliveryText =
    update.deliverySegments?.map(formatRunDeliverySegment).filter(Boolean).join('\n\n').trim() ?? ''
  return deliveryText || update.responseMarkdown || update.previewMarkdown || null
}

interface ActiveSessionRun {
  runId: string
  job: CronJob
  sessionId: string
  isReusedExistingSession: boolean
  started: boolean
  sawIdleWhileStarting: boolean
  abortController: AbortController
  expectedSubmissionId: string | null
  trackedMessageId: string | null
  trackedRequestId: string | null
  timeout: ReturnType<typeof setTimeout> | null
}

export interface CronJobRunSessionStarter {
  createSessionForRun(input: { job: CronJob; run: CronJobRun }): Promise<{
    sessionId: string
    reused?: boolean
    createdReuseSession?: boolean
    outputMessageId?: string | null
    outputPreview?: string | null
  }>
  startSessionRun(input: {
    job: CronJob
    run: CronJobRun
    sessionId: string
    reused?: boolean
    signal?: AbortSignal
    onBeforeSubmit?: (meta?: { submissionId?: string }) => void
  }): Promise<{
    outputMessageId?: string | null
    outputRequestId?: string | null
    outputPreview?: string | null
    expectedSubmissionId?: string | null
  }>
  cancelSessionRun(input: {
    job: CronJob
    run: CronJobRun
    sessionId: string
    reason: string
    eventId?: string | null
    submissionId?: string | null
    allowSessionWideCancel?: boolean
  }): Promise<void>
  isSessionBusy?(sessionId: string): Promise<boolean>
}

export class CronJobRunExecutor {
  private readonly claimOwner = `cron-job-runner:${process.pid}:${randomUUID()}`
  private readonly activeSessions = new Map<string, ActiveSessionRun>()
  private readonly startingSessions = new Set<string>()
  private readonly pendingQueuedSessions = new Set<string>()
  private readonly unsubscribeSessionUpdates: () => void
  private hasRequeuedRuns = false
  private disposed = false

  constructor(
    private readonly repository: CronJobsRepository,
    private readonly sessionStarter: CronJobRunSessionStarter,
    private readonly deliveryRouter: CronJobDeliveryRouter,
    sessionEvents: SessionRuntimeEventPort,
    private readonly onDrainQueued?: () => void
  ) {
    this.unsubscribeSessionUpdates = sessionEvents.subscribe((update) =>
      this.handleSessionUpdate(update)
    )
  }

  dispose(): void {
    this.disposed = true
    this.unsubscribeSessionUpdates()
    for (const sessionId of this.activeSessions.keys()) {
      this.clearActiveSession(sessionId)
    }
    this.activeSessions.clear()
    this.startingSessions.clear()
    this.pendingQueuedSessions.clear()
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

    let job = this.repository.getJob(input.job.id) ?? input.job
    const activeRuns = this.repository.countActiveRunsByJob(job.id, run.id)
    if (activeRuns > 0) {
      if (job.runtime.concurrencyPolicy === 'queue') {
        console.info('[CronJobs] Requeued run because another run is active:', {
          jobId: job.id,
          runId: run.id,
          activeRuns
        })
        this.hasRequeuedRuns = true
        return this.repository.releaseRunQueued(run.id)
      }
      console.info('[CronJobs] Skipped run because another run is active:', {
        jobId: job.id,
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
    let reservedStartingSession = false
    let trackedInActiveSessions = false
    const abortController = new AbortController()
    try {
      console.info('[CronJobs] Resolving session for run:', {
        jobId: job.id,
        runId: run.id,
        agentId: job.agentId,
        sessionMode: job.sessionMode,
        reuseSessionId: job.reuseSessionId
      })
      const result = await this.sessionStarter.createSessionForRun({ job, run })
      sessionId = result.sessionId
      const isSharedSession = Boolean(result.reused || result.createdReuseSession)
      if (result.createdReuseSession) {
        if (!job.agentId) {
          throw new Error('Cron job requires an enabled agent.')
        }
        const bound = this.repository.bindJobReuseSessionId(job.id, sessionId, job.agentId)
        if (!bound) {
          const latestJob = this.repository.getJob(job.id)
          if (!latestJob) {
            throw new Error(`Cron job "${job.id}" no longer exists.`)
          }
          if (latestJob.agentId !== job.agentId) {
            throw new Error(
              `Cron job "${job.id}" changed agent while initializing reused session "${sessionId}".`
            )
          }
          if (
            latestJob.sessionMode === 'reuse_session' &&
            latestJob.reuseSessionId &&
            latestJob.reuseSessionId !== sessionId
          ) {
            throw new Error(
              `Cron job "${job.id}" is already bound to a different reused session "${latestJob.reuseSessionId}".`
            )
          }
          job = latestJob
        } else {
          job = bound
        }
      }

      if (isSharedSession) {
        const sessionActiveInDb = this.repository.countActiveRunsBySession(sessionId, run.id) > 0
        if (
          this.activeSessions.has(sessionId) ||
          this.startingSessions.has(sessionId) ||
          sessionActiveInDb
        ) {
          return await this.handleBusyTargetSession(job, run, sessionId, 'reservation')
        }
        this.startingSessions.add(sessionId)
        reservedStartingSession = true
      }

      console.info('[CronJobs] Session ready for run:', {
        jobId: job.id,
        runId: run.id,
        sessionId,
        reused: isSharedSession
      })
      this.repository.updateRunSession(run.id, sessionId)
      if (result.outputMessageId || result.outputPreview) {
        this.repository.updateRunOutput(run.id, {
          outputMessageId: result.outputMessageId ?? null,
          outputPreview: result.outputPreview ?? null
        })
      }

      const registerActiveSession = (meta?: { submissionId?: string }) => {
        if (!sessionId) {
          return
        }
        const existing = this.activeSessions.get(sessionId)
        if (trackedInActiveSessions && existing && existing.runId === run.id) {
          if (!existing.expectedSubmissionId && meta?.submissionId) {
            existing.expectedSubmissionId = meta.submissionId
          }
          return
        }
        trackedInActiveSessions = true
        this.activeSessions.set(sessionId, {
          runId: run.id,
          job,
          sessionId,
          isReusedExistingSession: isSharedSession,
          started: false,
          sawIdleWhileStarting: false,
          abortController,
          expectedSubmissionId: meta?.submissionId ?? null,
          trackedMessageId: result.outputMessageId ?? null,
          trackedRequestId: null,
          timeout: this.createRunTimeout(run.id, job, sessionId)
        })
      }

      if (!isSharedSession) {
        registerActiveSession()
      }

      console.info('[CronJobs] Starting session run:', {
        jobId: job.id,
        runId: run.id,
        sessionId
      })
      const startResult = await this.sessionStarter.startSessionRun({
        job,
        run,
        sessionId,
        reused: isSharedSession,
        signal: abortController.signal,
        onBeforeSubmit: registerActiveSession
      })
      if (abortController.signal.aborted) {
        if (reservedStartingSession) {
          this.startingSessions.delete(sessionId)
          reservedStartingSession = false
        }
        const cancelEventId = startResult?.outputRequestId ?? startResult?.outputMessageId ?? null
        const cancelSubmissionId = startResult?.expectedSubmissionId ?? null
        if (cancelEventId || cancelSubmissionId || !isSharedSession) {
          void this.sessionStarter
            .cancelSessionRun({
              job,
              run,
              sessionId,
              reason: 'Cron job run aborted before start completed.',
              ...(cancelEventId ? { eventId: cancelEventId } : {}),
              ...(cancelSubmissionId ? { submissionId: cancelSubmissionId } : {}),
              ...(isSharedSession ? { allowSessionWideCancel: false } : {})
            })
            .catch(() => {})
        }
        this.wakeSessionWaiters(sessionId)
        return this.repository.getRun(run.id)
      }
      if (!trackedInActiveSessions) {
        const latest = this.repository.getRun(run.id)
        if (latest?.status === 'running') {
          registerActiveSession(
            startResult?.expectedSubmissionId
              ? { submissionId: startResult.expectedSubmissionId }
              : undefined
          )
        }
      }
      if (reservedStartingSession) {
        this.startingSessions.delete(sessionId)
        reservedStartingSession = false
      }
      if (!this.activeSessions.has(sessionId)) {
        this.wakeSessionWaiters(sessionId)
      }
      console.info('[CronJobs] Session run started:', {
        jobId: job.id,
        runId: run.id,
        sessionId,
        outputMessageId: startResult?.outputMessageId ?? null
      })
      const active = this.activeSessions.get(sessionId)
      if (active && active.runId === run.id) {
        if (!active.expectedSubmissionId && startResult?.expectedSubmissionId) {
          active.expectedSubmissionId = startResult.expectedSubmissionId
        }
        if (!active.trackedMessageId && startResult?.outputMessageId) {
          active.trackedMessageId = startResult.outputMessageId
        }
        if (!active.trackedRequestId && startResult?.outputRequestId) {
          active.trackedRequestId = startResult.outputRequestId
        }
      }
      if (startResult?.outputMessageId || startResult?.outputPreview) {
        this.repository.updateRunOutput(run.id, {
          outputMessageId: startResult.outputMessageId ?? null,
          outputPreview: startResult.outputPreview ?? null
        })
      }
      return this.repository.getRun(run.id)
    } catch (error) {
      const sawIdleWhileStarting =
        Boolean(sessionId) &&
        this.activeSessions.get(sessionId!)?.runId === run.id &&
        this.activeSessions.get(sessionId!)?.sawIdleWhileStarting === true
      if (sessionId && reservedStartingSession) {
        this.startingSessions.delete(sessionId)
        reservedStartingSession = false
      }
      if (sessionId && trackedInActiveSessions) {
        this.clearActiveSession(sessionId, run.id)
      }
      const current = this.repository.getRun(run.id)
      if (!current || current.status !== 'running') {
        if (sessionId) {
          await this.wakeSessionWaitersAfterRuntimeRelease(
            sessionId,
            isSessionBusyError(error) ? sawIdleWhileStarting : true
          )
        }
        return current
      }
      if (sessionId && isSessionBusyError(error)) {
        return await this.handleBusyTargetSession(
          job,
          run,
          sessionId,
          'runtime',
          sawIdleWhileStarting
        )
      }
      if (sessionId) {
        this.wakeSessionWaiters(sessionId)
      }
      console.error('[CronJobs] Run execution failed:', {
        jobId: job.id,
        runId: run.id,
        sessionId,
        error
      })
      const failed = this.repository.markRunFailed(
        run.id,
        error instanceof Error ? error.message : String(error)
      )
      await this.deliverRun(job, failed)
      this.scheduleQueuedDrain()
      return failed
    }
  }

  private async handleBusyTargetSession(
    job: CronJob,
    run: CronJobRun,
    sessionId: string,
    cause: 'reservation' | 'runtime',
    sawIdleWhileStarting = false
  ): Promise<CronJobRun> {
    if (job.runtime.concurrencyPolicy === 'queue') {
      console.info('[CronJobs] Requeued run because target session is busy:', {
        jobId: job.id,
        runId: run.id,
        sessionId,
        cause
      })
      this.hasRequeuedRuns = true
      this.pendingQueuedSessions.add(sessionId)
      const requeued = this.repository.releaseRunQueued(run.id)
      if (cause === 'runtime') {
        await this.wakeSessionWaitersAfterRuntimeRelease(sessionId, sawIdleWhileStarting)
      }
      return requeued
    }
    console.info('[CronJobs] Skipped run because target session is busy:', {
      jobId: job.id,
      runId: run.id,
      sessionId,
      cause
    })
    const cancelled = this.repository.markRunCancelled(run.id, 'Target session is busy.')
    if (cause === 'runtime') {
      await this.wakeSessionWaitersAfterRuntimeRelease(sessionId, sawIdleWhileStarting)
    }
    return cancelled
  }

  private async wakeSessionWaitersAfterRuntimeRelease(
    sessionId: string,
    sawIdleWhileStarting: boolean
  ): Promise<void> {
    if (!this.pendingQueuedSessions.has(sessionId)) {
      return
    }
    if (sawIdleWhileStarting) {
      this.wakeSessionWaiters(sessionId)
      return
    }
    if (!this.sessionStarter.isSessionBusy) {
      return
    }
    try {
      if (
        !(await this.sessionStarter.isSessionBusy(sessionId)) &&
        !this.disposed &&
        !this.activeSessions.has(sessionId) &&
        !this.startingSessions.has(sessionId)
      ) {
        this.wakeSessionWaiters(sessionId)
      }
    } catch (error) {
      console.warn('[CronJobs] Failed to recheck target session idle state:', {
        sessionId,
        error
      })
    }
  }

  private wakeSessionWaiters(sessionId: string): void {
    if (
      this.activeSessions.has(sessionId) ||
      this.startingSessions.has(sessionId) ||
      !this.pendingQueuedSessions.has(sessionId)
    ) {
      return
    }
    this.pendingQueuedSessions.delete(sessionId)
    this.hasRequeuedRuns = true
    this.scheduleQueuedDrain()
  }

  notifySessionIdle(sessionId: string): void {
    if (
      this.activeSessions.has(sessionId) ||
      (!this.pendingQueuedSessions.has(sessionId) && !this.startingSessions.has(sessionId))
    ) {
      return
    }
    this.pendingQueuedSessions.delete(sessionId)
    this.hasRequeuedRuns = true
    this.scheduleQueuedDrain()
  }

  private matchesTrackedTurn(
    activeSession: ActiveSessionRun,
    update: SessionRuntimeUpdate
  ): boolean {
    if (activeSession.isReusedExistingSession && activeSession.expectedSubmissionId) {
      if (update.submissionId && update.submissionId !== activeSession.expectedSubmissionId) {
        return false
      }
      if (!activeSession.trackedMessageId && !activeSession.trackedRequestId) {
        return update.submissionId === activeSession.expectedSubmissionId
      }
    }
    if (
      activeSession.trackedMessageId &&
      update.messageId &&
      update.messageId !== activeSession.trackedMessageId
    ) {
      return false
    }
    if (
      activeSession.trackedRequestId &&
      update.requestId &&
      update.requestId !== activeSession.trackedRequestId
    ) {
      return false
    }
    return true
  }

  private bindTrackedTurn(activeSession: ActiveSessionRun, update: SessionRuntimeUpdate): void {
    if (!activeSession.trackedMessageId && update.messageId) {
      activeSession.trackedMessageId = update.messageId
    }
    if (!activeSession.trackedRequestId && update.requestId) {
      activeSession.trackedRequestId = update.requestId
    }
  }

  private handleSessionUpdate(update: SessionRuntimeUpdate): void {
    const activeSession = this.activeSessions.get(update.sessionId)
    if (!activeSession) {
      if (update.kind === 'status' && (update.status === 'idle' || update.status === 'error')) {
        this.notifySessionIdle(update.sessionId)
      }
      return
    }

    if (update.kind === 'blocks') {
      if (!this.matchesTrackedTurn(activeSession, update)) {
        return
      }
      this.bindTrackedTurn(activeSession, update)
      if (update.messageId || update.requestId) {
        activeSession.started = true
      }
      this.captureRunOutput(activeSession.runId, update)
      return
    }

    if (update.kind !== 'status') {
      return
    }

    if (update.status === 'generating') {
      if (!this.matchesTrackedTurn(activeSession, update)) {
        return
      }
      this.bindTrackedTurn(activeSession, update)
      activeSession.started = true
      return
    }

    if (!this.matchesTrackedTurn(activeSession, update)) {
      if (
        !activeSession.trackedMessageId &&
        !activeSession.trackedRequestId &&
        (update.status === 'idle' || update.status === 'error')
      ) {
        activeSession.sawIdleWhileStarting = true
      }
      return
    }

    // Hydrating the detached session can publish idle before its task starts.
    if (
      !activeSession.started &&
      update.status === 'idle' &&
      !update.messageId &&
      !update.requestId
    )
      return

    if (update.status === 'idle') {
      this.completeRun(activeSession.runId, activeSession.job, update.sessionId)
      return
    }

    if (update.status === 'error') {
      this.failRun(activeSession.runId, activeSession.job, update.sessionId, update.error)
    }
  }

  private captureRunOutput(runId: string, update: SessionRuntimeUpdate): void {
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
      this.clearActiveSession(sessionId, runId)
      return
    }
    const completed = this.repository.markRunCompleted(runId)
    this.clearActiveSession(sessionId, runId)
    void this.deliverRun(job, completed)
    this.wakeSessionWaiters(sessionId)
    this.scheduleQueuedDrain()
  }

  private failRun(runId: string, job: CronJob, sessionId: string, errorMessage?: string): void {
    const current = this.repository.getRun(runId)
    if (!current || current.status !== 'running') {
      this.clearActiveSession(sessionId, runId)
      return
    }
    const failed = this.repository.markRunFailed(
      runId,
      errorMessage?.trim() || 'Agent session entered error state.'
    )
    this.clearActiveSession(sessionId, runId)
    void this.deliverRun(job, failed)
    this.wakeSessionWaiters(sessionId)
    this.scheduleQueuedDrain()
  }

  private createRunTimeout(
    runId: string,
    job: CronJob,
    sessionId: string
  ): ReturnType<typeof setTimeout> | null {
    const maxDurationMs = job.runtime.maxDurationMs
    if (!Number.isFinite(maxDurationMs) || maxDurationMs <= 0) {
      return null
    }

    return setTimeout(() => {
      void this.failRunForTimeout(runId, job, sessionId, maxDurationMs)
    }, maxDurationMs)
  }

  private clearActiveSession(sessionId: string, expectedRunId?: string): void {
    const activeSession = this.activeSessions.get(sessionId)
    if (!activeSession) {
      return
    }
    if (expectedRunId && activeSession.runId !== expectedRunId) {
      return
    }
    if (activeSession.timeout) {
      clearTimeout(activeSession.timeout)
    }
    this.activeSessions.delete(sessionId)
  }

  private async failRunForTimeout(
    runId: string,
    job: CronJob,
    sessionId: string,
    maxDurationMs: number
  ): Promise<void> {
    const activeSession = this.activeSessions.get(sessionId)
    const eventId =
      activeSession && activeSession.runId === runId
        ? (activeSession.trackedRequestId ?? activeSession.trackedMessageId)
        : null
    const submissionId =
      activeSession && activeSession.runId === runId ? activeSession.expectedSubmissionId : null
    const allowSessionWideCancel =
      activeSession && activeSession.runId === runId
        ? !activeSession.isReusedExistingSession
        : job.sessionMode !== 'reuse_session'

    const current = this.repository.getRun(runId)
    if (!current || current.status !== 'running') {
      this.clearActiveSession(sessionId, runId)
      return
    }

    const errorMessage = `Cron job exceeded max duration (${maxDurationMs} ms).`
    console.warn('[CronJobs] Run exceeded max duration:', {
      jobId: job.id,
      runId,
      sessionId,
      maxDurationMs,
      eventId,
      submissionId
    })
    const failed = this.repository.markRunFailed(runId, errorMessage)
    if (activeSession && activeSession.runId === runId) {
      activeSession.abortController.abort(new Error(errorMessage))
    }
    this.clearActiveSession(sessionId, runId)

    try {
      await this.sessionStarter.cancelSessionRun({
        job,
        run: current,
        sessionId,
        reason: errorMessage,
        ...(eventId ? { eventId } : {}),
        ...(submissionId ? { submissionId } : {}),
        ...(allowSessionWideCancel ? {} : { allowSessionWideCancel: false })
      })
    } catch (error) {
      console.warn('[CronJobs] Failed to cancel timed out run session:', {
        jobId: job.id,
        runId,
        sessionId,
        error
      })
    }

    await this.deliverRun(job, failed)
    this.wakeSessionWaiters(sessionId)
    this.scheduleQueuedDrain()
  }

  private scheduleQueuedDrain(): void {
    if (this.disposed || !this.onDrainQueued || !this.hasRequeuedRuns) {
      return
    }
    this.hasRequeuedRuns = false
    queueMicrotask(() => {
      if (!this.disposed) {
        this.onDrainQueued?.()
      }
    })
  }

  private async deliverRun(job: CronJob, run: CronJobRun): Promise<void> {
    try {
      await this.deliveryRouter.deliver({ job, run })
    } catch (error) {
      console.error('[CronJobs] Failed to deliver run result:', error)
    }
  }
}
