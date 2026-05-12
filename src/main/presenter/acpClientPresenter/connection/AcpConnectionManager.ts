import type { LLM_PROVIDER, IConfigPresenter, AcpAgentConfig } from '@shared/presenter'
import type { ProviderMcpRuntimePort } from '@/presenter/llmProviderPresenter/runtimePorts'
import { AcpProcessManager, type AcpProcessHandle } from '@/presenter/llmProviderPresenter/acp'
import type { AcpConnectionRef, StartAcpConnectionInput } from '../types'
import { PROTOCOL_VERSION } from '@agentclientprotocol/sdk'

export class AcpConnectionManager {
  readonly processManager: AcpProcessManager

  constructor(
    provider: LLM_PROVIDER,
    configPresenter: IConfigPresenter,
    mcpRuntime?: ProviderMcpRuntimePort
  ) {
    this.processManager = new AcpProcessManager({
      providerId: provider.id,
      resolveLaunchSpec: (agentId, workdir) =>
        configPresenter.resolveAcpLaunchSpec(agentId, workdir),
      getAgentState: (agentId) => configPresenter.getAcpAgentState(agentId),
      getNpmRegistry: async () => mcpRuntime?.getNpmRegistry?.() ?? null,
      getUvRegistry: async () => mcpRuntime?.getUvRegistry?.() ?? null
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
