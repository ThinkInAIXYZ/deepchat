import type { IConfigPresenter, LLM_PROVIDER } from '@shared/presenter'
import {
  AcpSessionController,
  AcpSessionPersistence,
  type AcpSessionCapabilityEvents,
  type AcpProcessHandle,
  type AcpSessionRecord
} from '@/agent/acp/runtime'
import type { ProviderMcpRuntimePort } from '@/presenter/llmProviderPresenter/runtimePorts'
import { AcpConnectionManager } from './connection/AcpConnectionManager'
import { AcpSessionRuntime } from './session/AcpSessionRuntime'
import { AcpPromptController } from './session/AcpPromptController'
import type { AcpConnectionRef, CancelAcpPromptInput, StartAcpConnectionInput } from './types'

export class AcpClientRuntime {
  readonly connectionManager: AcpConnectionManager
  readonly sessionRuntime: AcpSessionRuntime
  readonly promptController = new AcpPromptController()
  readonly sessionPersistence: AcpSessionPersistence
  readonly sessionController: AcpSessionController

  constructor(input: {
    provider: LLM_PROVIDER
    configPresenter: IConfigPresenter
    sessionPersistence: AcpSessionPersistence
    mcpRuntime?: ProviderMcpRuntimePort
    capabilityEvents?: AcpSessionCapabilityEvents
  }) {
    this.sessionPersistence = input.sessionPersistence
    this.connectionManager = new AcpConnectionManager(
      input.provider,
      input.configPresenter,
      input.mcpRuntime
    )
    this.sessionRuntime = new AcpSessionRuntime({
      providerId: input.provider.id,
      processManager: this.connectionManager.processManager,
      sessionPersistence: input.sessionPersistence,
      configPresenter: input.configPresenter
    })
    this.sessionController = new AcpSessionController(
      this.sessionRuntime.sessionManager,
      this.connectionManager.processManager,
      input.sessionPersistence,
      input.capabilityEvents
    )
  }

  get processManager() {
    return this.connectionManager.processManager
  }

  get sessionManager() {
    return this.sessionRuntime.sessionManager
  }

  async startConnection(input: StartAcpConnectionInput): Promise<AcpConnectionRef> {
    return this.connectionManager.startConnection(input)
  }

  async cancel(input: CancelAcpPromptInput): Promise<void> {
    const session = this.sessionManager.getSessionById(input.sessionId)
    await session?.connection.cancel({ sessionId: input.sessionId })
    this.promptController.cancel(input.sessionId)
  }

  toConnectionRef(handle: AcpProcessHandle): AcpConnectionRef {
    return this.connectionManager.toRef(handle)
  }

  toSessionRef(session: AcpSessionRecord) {
    return {
      id: session.sessionId,
      acpSessionId: session.sessionId,
      conversationId: session.conversationId,
      connectionId: `${session.agentId}:${session.workdir}`,
      workdir: session.workdir,
      modeId: session.currentModeId,
      status: session.status
    }
  }
}

export type * from './types'
export { AcpPromptController, type AcpPromptTurn } from './session/AcpPromptController'
export { AcpRuntimeOwner, type AcpDirectRuntimeLifecycle } from './acpRuntimeOwner'
