import { randomUUID } from 'node:crypto'
import type {
  AgentType,
  CreateDetachedSessionInput,
  MessageStartResult,
  SessionRecord
} from '@shared/types/agent-interface'
import type { ToolModeOverride } from '@shared/toolMode'
import { resolveAcpAgentAlias } from '@shared/utils/acpAgentAlias'
import type { CronJobRunSessionStarter } from './runExecutor'

export interface CronJobSessionLifecyclePort {
  createDetachedSession(input: CreateDetachedSessionInput): Promise<{ id: string }>
}

export interface CronJobSessionLookupPort {
  get(sessionId: string): SessionRecord | null
}

export interface CronJobSessionTurnPort {
  sendMessage(
    sessionId: string,
    content: string,
    options?: {
      maxProviderRounds?: number
      signal?: AbortSignal
      submissionId?: string
      rejectIfBusy?: boolean
      requireAcpResume?: boolean
      onBeforeSubmit?: () => void
    }
  ): Promise<MessageStartResult>
  cancelGeneration(sessionId: string): Promise<void>
  cancelGenerationByEventId?(sessionId: string, eventId: string): Promise<boolean>
  cancelSubmission?(sessionId: string, submissionId: string): Promise<boolean>
  isSessionBusy?(sessionId: string): Promise<boolean>
}

export interface CronJobAgentCatalogPort {
  getAgentType(agentId: string): Promise<AgentType | null>
}

export function validateReusedSessionForAgent(
  session: SessionRecord | null,
  sessionId: string,
  agentId: string
): SessionRecord {
  if (!session) {
    throw new Error(`Reused session "${sessionId}" no longer exists.`)
  }
  if (session.isDraft) {
    throw new Error(`Reused session "${sessionId}" is a draft and cannot be used for cron runs.`)
  }
  if (session.sessionKind === 'subagent') {
    throw new Error(`Reused session "${sessionId}" is a subagent session and cannot be reused.`)
  }
  if (resolveAcpAgentAlias(session.agentId) !== resolveAcpAgentAlias(agentId)) {
    throw new Error(
      `Reused session "${sessionId}" belongs to agent "${session.agentId}" instead of "${agentId}".`
    )
  }
  return session
}

export const createCronJobRunSessionStarter = (deps: {
  lifecycle: CronJobSessionLifecyclePort
  turn: CronJobSessionTurnPort
  agentCatalog: CronJobAgentCatalogPort
  sessions?: CronJobSessionLookupPort
}): CronJobRunSessionStarter => ({
  async createSessionForRun({ job, run }) {
    if (!job.agentId) {
      throw new Error('Cron job requires an enabled agent.')
    }
    if (job.sessionMode === 'reuse_session' && job.reuseSessionId) {
      if (!deps.sessions) {
        throw new Error('Session lookup is unavailable for reused cron sessions.')
      }
      validateReusedSessionForAgent(
        deps.sessions.get(job.reuseSessionId),
        job.reuseSessionId,
        job.agentId
      )
      console.info('[CronJobs] Reusing existing session for run:', {
        jobId: job.id,
        runId: run.id,
        sessionId: job.reuseSessionId,
        agentId: job.agentId
      })
      return {
        sessionId: job.reuseSessionId,
        reused: true
      }
    }

    console.info('[CronJobs] Resolving agent for session:', {
      jobId: job.id,
      runId: run.id,
      agentId: job.agentId
    })
    const agentType = await deps.agentCatalog.getAgentType(job.agentId)
    const snapshotConfig = job.agentSnapshot?.config as
      | {
          defaultModelPreset?: { providerId?: string; modelId?: string } | null
          permissionMode?: 'default' | 'auto_approve' | 'full_access'
          disabledAgentTools?: string[]
          defaultToolMode?: ToolModeOverride
          systemPrompt?: string
        }
      | null
      | undefined
    const modelPreset =
      agentType === 'deepchat' && job.modelPolicy === 'pin_current'
        ? snapshotConfig?.defaultModelPreset
        : null
    const systemPrompt = job.taskSystemInstruction?.trim() || snapshotConfig?.systemPrompt

    const session = await deps.lifecycle.createDetachedSession({
      agentId: job.agentId,
      title: job.name,
      ...(agentType === 'acp' ? { providerId: 'acp', modelId: job.agentId } : {}),
      ...(modelPreset?.providerId ? { providerId: modelPreset.providerId } : {}),
      ...(modelPreset?.modelId ? { modelId: modelPreset.modelId } : {}),
      ...(job.permissionPolicy === 'snapshot' && snapshotConfig?.permissionMode
        ? { permissionMode: snapshotConfig.permissionMode }
        : {}),
      ...(job.toolPolicy === 'snapshot' && snapshotConfig?.disabledAgentTools
        ? { disabledAgentTools: snapshotConfig.disabledAgentTools }
        : {}),
      // null pins the model default; only snapshots captured before the field existed follow the agent.
      ...(job.toolPolicy === 'snapshot' && snapshotConfig?.defaultToolMode !== undefined
        ? { toolModeOverride: snapshotConfig.defaultToolMode }
        : {}),
      ...(systemPrompt ? { generationSettings: { systemPrompt } } : {}),
      metadata: {
        source: 'cron_job',
        cronJobId: job.id,
        cronJobRunId: run.id,
        scheduledAt: run.scheduledAt
      }
    })
    console.info('[CronJobs] Detached session created:', {
      jobId: job.id,
      runId: run.id,
      sessionId: session.id,
      agentType
    })
    return {
      sessionId: session.id,
      ...(job.sessionMode === 'reuse_session' ? { createdReuseSession: true } : {})
    }
  },

  async startSessionRun({ job, run, sessionId, reused, signal, onBeforeSubmit }) {
    if (!job.taskPrompt.trim()) {
      throw new Error('Cron job task prompt is empty.')
    }
    const submissionId = `cron:${run.id}:${randomUUID()}`
    console.info('[CronJobs] Sending task prompt to session:', {
      jobId: job.id,
      sessionId,
      reused: Boolean(reused),
      promptLength: job.taskPrompt.length
    })
    const result = await deps.turn.sendMessage(sessionId, job.taskPrompt, {
      maxProviderRounds: job.runtime.maxTurns,
      ...(signal ? { signal } : {}),
      submissionId,
      ...(reused ? { rejectIfBusy: true, requireAcpResume: true } : {}),
      ...(onBeforeSubmit
        ? {
            onBeforeSubmit: () => onBeforeSubmit({ submissionId })
          }
        : {})
    })
    console.info('[CronJobs] Task prompt accepted by session:', {
      jobId: job.id,
      sessionId,
      outputMessageId: result.messageId ?? null
    })
    return {
      outputMessageId: result.messageId ?? null,
      ...(result.requestId ? { outputRequestId: result.requestId } : {}),
      expectedSubmissionId: submissionId
    }
  },

  async cancelSessionRun({ sessionId, eventId, submissionId, allowSessionWideCancel }) {
    if (eventId && deps.turn.cancelGenerationByEventId) {
      const cancelled = await deps.turn.cancelGenerationByEventId(sessionId, eventId)
      if (cancelled) {
        return
      }
    }
    if (submissionId && deps.turn.cancelSubmission) {
      const cancelled = await deps.turn.cancelSubmission(sessionId, submissionId)
      if (cancelled) {
        return
      }
      console.warn('[CronJobs] Submission cancellation returned false:', {
        sessionId,
        submissionId,
        eventId: eventId ?? null
      })
    }
    if (allowSessionWideCancel !== false) {
      await deps.turn.cancelGeneration(sessionId)
    }
  },

  ...(deps.turn.isSessionBusy
    ? { isSessionBusy: (sessionId: string) => deps.turn.isSessionBusy!(sessionId) }
    : {})
})
