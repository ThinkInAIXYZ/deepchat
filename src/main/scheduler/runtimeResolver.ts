import type { CronJob, CronJobAgentSnapshot, CronJobStatus } from '@shared/cronJobs'
import type { AgentSettingsPort } from '@/agent/settings'
import type { Agent, DeepChatAgentConfig } from '@shared/types/agent-interface'

export interface CronJobRuntimePlan {
  agent: Pick<Agent, 'id' | 'name' | 'type' | 'agentType'>
  config: DeepChatAgentConfig | null
  snapshot: CronJobAgentSnapshot | null
}

export class CronJobRuntimeResolver {
  constructor(
    private readonly agentSettings: Pick<
      AgentSettingsPort,
      'listAgents' | 'resolveDeepChatAgentConfig'
    >
  ) {}

  async resolve(
    job: Pick<
      CronJob,
      'agentId' | 'modelPolicy' | 'toolPolicy' | 'permissionPolicy' | 'agentSnapshot'
    >
  ): Promise<{
    status: CronJobStatus
    plan: CronJobRuntimePlan | null
  }> {
    const agent = await this.getEnabledAgent(job.agentId)
    if (!agent) {
      return { status: 'invalid_agent', plan: null }
    }

    const shouldUseSnapshot =
      job.modelPolicy === 'pin_current' ||
      job.toolPolicy === 'snapshot' ||
      job.permissionPolicy === 'snapshot'
    const snapshot = shouldUseSnapshot ? job.agentSnapshot : null
    return {
      status: 'ready',
      plan: {
        agent,
        config: snapshot?.config
          ? (snapshot.config as DeepChatAgentConfig)
          : await this.resolveConfig(agent),
        snapshot
      }
    }
  }

  async captureSnapshot(agentId: string | null): Promise<CronJobAgentSnapshot | null> {
    const agent = await this.getEnabledAgent(agentId)
    if (!agent) {
      return null
    }

    return {
      version: 1,
      capturedAt: Date.now(),
      agent: {
        id: agent.id,
        name: agent.name,
        type: (agent.agentType ?? agent.type) as 'deepchat' | 'acp'
      },
      config: await this.resolveConfig(agent)
    }
  }

  private async getEnabledAgent(agentId: string | null): Promise<Agent | null> {
    if (!agentId) {
      return null
    }
    return (
      (await this.agentSettings.listAgents()).find(
        (agent) => agent.id === agentId && agent.enabled
      ) ?? null
    )
  }

  private async resolveConfig(
    agent: Pick<Agent, 'id' | 'type' | 'agentType'>
  ): Promise<DeepChatAgentConfig | null> {
    return (agent.agentType ?? agent.type) === 'deepchat'
      ? await this.agentSettings.resolveDeepChatAgentConfig(agent.id)
      : null
  }
}
