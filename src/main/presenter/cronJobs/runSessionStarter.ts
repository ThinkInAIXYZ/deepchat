import type {
  AgentType,
  CreateDetachedSessionInput,
  MessageStartResult
} from '@shared/types/agent-interface'
import type { CronJobRunSessionStarter } from './runExecutor'

export interface CronJobSessionLifecyclePort {
  createDetachedSession(input: CreateDetachedSessionInput): Promise<{ id: string }>
}

export interface CronJobSessionTurnPort {
  sendMessage(
    sessionId: string,
    content: string,
    options?: { maxProviderRounds?: number }
  ): Promise<MessageStartResult>
  cancelGeneration(sessionId: string): Promise<void>
}

export interface CronJobAgentCatalogPort {
  getAgentType(agentId: string): Promise<AgentType | null>
}

export const createCronJobRunSessionStarter = (deps: {
  lifecycle: CronJobSessionLifecyclePort
  turn: CronJobSessionTurnPort
  agentCatalog: CronJobAgentCatalogPort
}): CronJobRunSessionStarter => ({
  async createSessionForRun({ job, run }) {
    if (!job.agentId) {
      throw new Error('Cron job requires an enabled agent.')
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
          subagentEnabled?: boolean
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
      ...(snapshotConfig?.subagentEnabled !== undefined
        ? { subagentEnabled: snapshotConfig.subagentEnabled }
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
    return { sessionId: session.id }
  },

  async startSessionRun({ job, sessionId }) {
    if (!job.taskPrompt.trim()) {
      throw new Error('Cron job task prompt is empty.')
    }
    console.info('[CronJobs] Sending task prompt to session:', {
      jobId: job.id,
      sessionId,
      promptLength: job.taskPrompt.length
    })
    const result = await deps.turn.sendMessage(sessionId, job.taskPrompt, {
      maxProviderRounds: job.runtime.maxTurns
    })
    console.info('[CronJobs] Task prompt accepted by session:', {
      jobId: job.id,
      sessionId,
      outputMessageId: result.messageId ?? null
    })
    return {
      outputMessageId: result.messageId ?? null
    }
  },

  async cancelSessionRun({ sessionId }) {
    await deps.turn.cancelGeneration(sessionId)
  }
})
