import type { AcpConfigState } from '@shared/presenter'
import type {
  DeepChatSessionState,
  MessageStartResult,
  PendingSessionInputRecord,
  PermissionMode,
  SendMessageInput,
  SessionAgentContextUpdate,
  SessionCompactionState,
  SessionGenerationSettings,
  ToolInteractionResponse,
  ToolInteractionResult
} from '@shared/types/agent-interface'
import type { AppSessionId } from '@/agent/shared/agentSessionIds'
import type { AgentSessionSendInput } from '@/agent/shared/agentSessionHandle'
import type { AcpMode } from '@/agent/acp/instance'
import type { AcpSessionCommand } from '@/agent/acp/runtime'

export interface AgentSessionLifecycleFacet {
  initialize(
    config: Partial<SessionAgentContextUpdate> &
      Pick<SessionAgentContextUpdate, 'providerId' | 'modelId'>
  ): Promise<void>
  isInitialized(): Promise<boolean>
}

export interface AgentPendingInputFacet {
  steerActiveTurn(content: SendMessageInput): Promise<void>
  list(): Promise<PendingSessionInputRecord[]>
  queue(
    content: SendMessageInput,
    options?: { source: 'queue' | 'send'; projectDir?: string | null }
  ): Promise<PendingSessionInputRecord>
  update(itemId: string, content: SendMessageInput): Promise<PendingSessionInputRecord>
  move(itemId: string, toIndex: number): Promise<PendingSessionInputRecord[]>
  convertToSteer(itemId: string): Promise<PendingSessionInputRecord>
  steer(itemId: string): Promise<PendingSessionInputRecord>
  delete(itemId: string): Promise<void>
}

export interface AgentSessionSettingsFacet {
  getPermissionMode(): Promise<PermissionMode>
  setPermissionMode(mode: PermissionMode): Promise<void>
  getGenerationSettings(): Promise<SessionGenerationSettings | null>
  updateGenerationSettings(
    settings: Partial<SessionGenerationSettings>
  ): Promise<SessionGenerationSettings>
  setProjectDir(projectDir: string | null): Promise<void>
}

export interface AgentToolInteractionFacet {
  respond(
    messageId: string,
    toolCallId: string,
    response: ToolInteractionResponse
  ): Promise<ToolInteractionResult>
}

export interface AgentSessionHandle {
  readonly sessionId: AppSessionId
  readonly kind: 'deepchat' | 'acp'
  readonly lifecycle: AgentSessionLifecycleFacet
  readonly pending: AgentPendingInputFacet
  readonly settings: AgentSessionSettingsFacet
  readonly toolInteractions: AgentToolInteractionFacet
  send(input: AgentSessionSendInput): Promise<MessageStartResult>
  cancel(): Promise<void>
  snapshot(options?: { lightweight?: boolean }): Promise<DeepChatSessionState | null>
  waitForFirstTurnReady(options?: { timeoutMs?: number }): Promise<boolean>
  close(): Promise<void>
}

export interface DeepChatControlFacet {
  setSessionAgentContext(config: SessionAgentContextUpdate): Promise<void>
  setModel(providerId: string, modelId: string): Promise<void>
  getCompactionState(): Promise<SessionCompactionState>
  compact(): Promise<{ compacted: boolean; state: SessionCompactionState }>
  invalidateSystemPromptCache(): void
}

export interface DeepChatSessionHandle extends AgentSessionHandle {
  readonly kind: 'deepchat'
  readonly deepchat: DeepChatControlFacet
}

export interface DirectAcpControlFacet {
  prepare(): Promise<void>
  updateWorkdir(workdir: string | null): Promise<string>
  getModes(): Promise<{ current: string; available: AcpMode[] } | null>
  setMode(modeId: string): Promise<void>
  getConfigOptions(): Promise<AcpConfigState | null>
  setConfigOption(configId: string, value: string | boolean): Promise<AcpConfigState | null>
  getCommands(): Promise<AcpSessionCommand[]>
  closeRuntime(): Promise<void>
}

export interface DirectAcpSessionHandle extends AgentSessionHandle {
  readonly kind: 'acp'
  readonly acp: DirectAcpControlFacet
}

export interface AgentTransferSourceFacet {
  hasMessages(sessionId: AppSessionId): Promise<boolean>
  listPendingInputs(sessionId: AppSessionId): Promise<PendingSessionInputRecord[]>
}

export interface DeepChatTransferTargetFacet {
  setSessionAgentContext(sessionId: AppSessionId, config: SessionAgentContextUpdate): Promise<void>
}

export interface AgentSubagentFacet {
  mergeTape(
    parentSessionId: AppSessionId,
    childSessionId: AppSessionId,
    meta?: Record<string, unknown>
  ): Promise<void>
  discardTape(
    parentSessionId: AppSessionId,
    childSessionId: AppSessionId,
    meta?: Record<string, unknown>
  ): Promise<void>
}

export interface AgentActiveGeneration {
  eventId: string
  runId: string
}

export interface AgentGenerationControlFacet {
  getActiveGeneration(sessionId: AppSessionId): AgentActiveGeneration | null
  cancelGenerationByEventId(sessionId: AppSessionId, eventId: string): Promise<boolean>
}
