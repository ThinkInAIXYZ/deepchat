import type { LLM_PROVIDER, ConfigServicePort, AcpAgentConfig } from '@shared/presenter'
import { AcpProcessManager, type AcpProcessHandle } from '@/agent/acp/runtime'
import type { AcpConnectionRef, AcpRegistryPort, StartAcpConnectionInput } from '../types'
import { PROTOCOL_VERSION } from '@agentclientprotocol/sdk'
import type { DeepChatEventPublisher } from '@/agent/deepchat/runtime/types'

export class AcpConnectionManager {
  readonly processManager: AcpProcessManager

  constructor(
    provider: LLM_PROVIDER,
    configService: ConfigServicePort,
    registry: AcpRegistryPort,
    publishEvent: DeepChatEventPublisher
  ) {
    this.processManager = new AcpProcessManager({
      publishEvent,
      providerId: provider.id,
      resolveLaunchSpec: (agentId, workdir) => configService.resolveAcpLaunchSpec(agentId, workdir),
      getAgentState: (agentId) => configService.getAcpAgentState(agentId),
      getNpmRegistry: async () => registry.getNpmRegistry(),
      getUvRegistry: async () => registry.getUvRegistry()
    })
  }

  async startConnection(input: StartAcpConnectionInput): Promise<AcpConnectionRef> {
    const handle = await this.processManager.getConnection(input.agent, input.workdir)
    return this.toRef(handle)
  }

  async release(agentId: string): Promise<void> {
    await this.processManager.release(agentId)
  }

  toRef(handle: AcpProcessHandle): AcpConnectionRef {
    return {
      id: `${handle.agentId}:${handle.workdir}`,
      agentId: handle.agentId,
      workdir: handle.workdir,
      protocolVersion: String(PROTOCOL_VERSION),
      capabilities: handle.agentCapabilities,
      authMethods: handle.authMethods,
      status: handle.status === 'ready' ? 'ready' : 'error'
    }
  }

  async getConnection(agent: AcpAgentConfig, workdir?: string): Promise<AcpProcessHandle> {
    return this.processManager.getConnection(agent, workdir)
  }
}
