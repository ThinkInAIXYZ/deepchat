import type { JsonValue } from '@shared/contracts/json'
import type { DimRuntimeSupervisor } from './runtimeSupervisor'

export interface DimAgentProfile {
  name: string
  description: string
  systemPrompt: string
  tools?: string[]
}

export class DimAgentProfiles {
  constructor(private readonly host: DimRuntimeSupervisor) {}
  async ensure(profile: DimAgentProfile): Promise<string> {
    const client = await this.host.start()
    const reply = await client.call<{ agentId: string }>(
      'deepchat.agent.ensure',
      profile as unknown as JsonValue
    )
    return reply.agentId
  }
}
