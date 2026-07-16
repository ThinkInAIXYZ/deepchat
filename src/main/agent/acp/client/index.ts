import type { LLM_PROVIDER } from '@shared/types/provider'
import type { AgentSettingsPort } from '@/agent/settings'
import {
  AcpSessionController,
  AcpSessionPersistence,
  type AcpSessionCapabilityEvents,
  type AcpProcessHandle,
  type AcpSessionRecord
} from '@/agent/acp/runtime'
import { AcpConnectionManager } from './connection/AcpConnectionManager'
import { AcpSessionRuntime } from './session/AcpSessionRuntime'
import { AcpPromptController } from './session/AcpPromptController'
import type {
  AcpConnectionRef,
  AcpRegistryPort,
  CancelAcpPromptInput,
  StartAcpConnectionInput
} from './types'
import type { DeepChatEventPublisher } from '@/agent/deepchat/runtime/types'
import type { McpSettings } from '@/mcp/settings'

export class AcpClientRuntime {
  readonly connectionManager: AcpConnectionManager
  readonly sessionRuntime: AcpSessionRuntime
  readonly promptController = new AcpPromptController()
  readonly sessionPersistence: AcpSessionPersistence
  readonly sessionController: AcpSessionController

  constructor(input: {
    provider: LLM_PROVIDER
    agentSettings: AgentSettingsPort
    mcpSettings: McpSettings
    sessionPersistence: AcpSessionPersistence
    registry: AcpRegistryPort
    capabilityEvents?: AcpSessionCapabilityEvents
    publishEvent: DeepChatEventPublisher
  }) {
    this.sessionPersistence = input.sessionPersistence
    this.connectionManager = new AcpConnectionManager(
      input.provider,
      input.agentSettings,
      input.registry,
      input.publishEvent
    )
    this.sessionRuntime = new AcpSessionRuntime({
      providerId: input.provider.id,
      processManager: this.connectionManager.processManager,
      sessionPersistence: input.sessionPersistence,
      agentSettings: input.agentSettings,
      mcpSettings: input.mcpSettings
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
