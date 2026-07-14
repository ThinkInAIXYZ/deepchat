import type {
  AgentTapeAnchorResult,
  AgentTapeAnchorsOptions,
  AgentTapeContextOptions,
  AgentTapeContextResult,
  AgentTapeInfo,
  AgentTapeSearchOptions,
  AgentTapeSearchResult,
  AgentTransferImpact,
  ChatMessagePageResult,
  ChatMessageRecord,
  CreateDetachedSessionInput,
  CreateSessionInput,
  MessagePageCursor,
  MessageStartResult,
  MessageTraceRecord,
  PermissionMode,
  SendMessageInput,
  SessionCompactionState,
  SessionGenerationSettings,
  SessionLightweightListResult,
  SessionListItem,
  SessionPageCursor,
  SessionWithState,
  ToolInteractionResponse,
  ToolInteractionResult
} from '@shared/types/agent-interface'
import type { SearchResult } from '@shared/types/core/search'
import type { DeepChatTapeViewManifestRecord } from '@shared/types/tape-view-manifest'
import type {
  DeepChatTapeReplayExportOptions,
  DeepChatTapeReplaySlice
} from '@shared/types/tape-replay'
import type { AcpConfigState } from '@shared/presenter'
import { SessionProjectionCoordinator } from '../sessionApplication/projectionCoordinator'
import type {
  SessionAgentAssignmentPort,
  SessionLifecyclePort,
  SessionLifecycleSubagentInput,
  SessionTurnPort
} from '../sessionApplication/ports'
import type { SessionPermissionPort } from '../runtimePorts'

export class AgentSessionPresenter {
  private sessionProjection: SessionProjectionCoordinator
  private sessionLifecycle: SessionLifecyclePort
  private sessionAssignment: SessionAgentAssignmentPort
  private sessionTurn: SessionTurnPort
  private sessionPermissionPort?: SessionPermissionPort

  constructor(
    sessionProjection: SessionProjectionCoordinator,
    sessionLifecycle: SessionLifecyclePort,
    sessionAssignment: SessionAgentAssignmentPort,
    sessionTurn: SessionTurnPort,
    runtimePorts?: {
      sessionPermissionPort?: SessionPermissionPort
    }
  ) {
    this.sessionProjection = sessionProjection
    this.sessionLifecycle = sessionLifecycle
    this.sessionAssignment = sessionAssignment
    this.sessionTurn = sessionTurn
    this.sessionPermissionPort = runtimePorts?.sessionPermissionPort
  }

  // ---- IPC-facing methods ----

  async createSession(input: CreateSessionInput, webContentsId: number): Promise<SessionWithState> {
    return await this.sessionLifecycle.createSession(input, webContentsId)
  }

  async createDetachedSession(input: CreateDetachedSessionInput): Promise<SessionWithState> {
    return await this.sessionLifecycle.createDetachedSession(input)
  }

  async createSubagentSession(input: SessionLifecycleSubagentInput): Promise<SessionWithState> {
    return await this.sessionLifecycle.createSubagentSession(input)
  }

  async ensureAcpDraftSession(input: {
    agentId: string
    projectDir: string
    permissionMode?: PermissionMode
  }): Promise<SessionWithState> {
    return await this.sessionLifecycle.ensureAcpDraftSession(input)
  }

  async sendMessage(
    sessionId: string,
    content: string | SendMessageInput,
    options?: { maxProviderRounds?: number }
  ): Promise<MessageStartResult> {
    return await this.sessionTurn.sendMessage(sessionId, content, options)
  }

  async steerActiveTurn(sessionId: string, content: string | SendMessageInput): Promise<void> {
    await this.sessionTurn.steerActiveTurn(sessionId, content)
  }

  async listPendingInputs(sessionId: string) {
    return await this.sessionTurn.listPendingInputs(sessionId)
  }

  async queuePendingInput(sessionId: string, content: string | SendMessageInput) {
    return await this.sessionTurn.queuePendingInput(sessionId, content)
  }

  async updateQueuedInput(sessionId: string, itemId: string, content: string | SendMessageInput) {
    return await this.sessionTurn.updateQueuedInput(sessionId, itemId, content)
  }

  async moveQueuedInput(sessionId: string, itemId: string, toIndex: number) {
    return await this.sessionTurn.moveQueuedInput(sessionId, itemId, toIndex)
  }

  async convertPendingInputToSteer(sessionId: string, itemId: string) {
    return await this.sessionTurn.convertPendingInputToSteer(sessionId, itemId)
  }

  async steerPendingInput(sessionId: string, itemId: string) {
    return await this.sessionTurn.steerPendingInput(sessionId, itemId)
  }

  async deletePendingInput(sessionId: string, itemId: string): Promise<void> {
    await this.sessionTurn.deletePendingInput(sessionId, itemId)
  }

  async retryMessage(sessionId: string, messageId: string): Promise<void> {
    await this.sessionTurn.retryMessage(sessionId, messageId)
  }

  async deleteMessage(sessionId: string, messageId: string): Promise<void> {
    await this.sessionTurn.deleteMessage(sessionId, messageId)
  }

  async editUserMessage(
    sessionId: string,
    messageId: string,
    text: string
  ): Promise<ChatMessageRecord> {
    return await this.sessionTurn.editUserMessage(sessionId, messageId, text)
  }

  async forkSession(
    sourceSessionId: string,
    targetMessageId: string,
    newTitle?: string
  ): Promise<SessionWithState> {
    return await this.sessionLifecycle.forkSession(sourceSessionId, targetMessageId, newTitle)
  }

  async getSessionList(filters?: {
    agentId?: string
    projectDir?: string
    includeSubagents?: boolean
    parentSessionId?: string
  }): Promise<SessionWithState[]> {
    return await this.sessionProjection.listSessions(filters)
  }

  async getLightweightSessionList(options?: {
    limit?: number
    cursor?: SessionPageCursor | null
    includeSubagents?: boolean
    agentId?: string
    prioritizeSessionId?: string
  }): Promise<SessionLightweightListResult> {
    return await this.sessionProjection.listLightweight(options)
  }

  async getLightweightSessionsByIds(sessionIds: string[]): Promise<SessionListItem[]> {
    return await this.sessionProjection.getLightweightByIds(sessionIds)
  }

  async getSession(sessionId: string): Promise<SessionWithState | null> {
    return await this.sessionProjection.getSession(sessionId)
  }

  async getMessages(sessionId: string): Promise<ChatMessageRecord[]> {
    return await this.sessionProjection.getMessages(sessionId)
  }

  async listMessagesPage(
    sessionId: string,
    options?: {
      limit?: number
      cursor?: MessagePageCursor | null
    }
  ): Promise<ChatMessagePageResult> {
    return await this.sessionProjection.listMessagesPage(sessionId, options)
  }

  async getSessionCompactionState(sessionId: string): Promise<SessionCompactionState> {
    return await this.sessionTurn.getSessionCompactionState(sessionId)
  }

  async compactSession(
    sessionId: string
  ): Promise<{ compacted: boolean; state: SessionCompactionState }> {
    return await this.sessionTurn.compactSession(sessionId)
  }

  async getTapeInfo(sessionId: string): Promise<AgentTapeInfo> {
    return await this.sessionProjection.getTapeInfo(sessionId)
  }

  async searchTape(
    sessionId: string,
    query: string,
    options?: AgentTapeSearchOptions
  ): Promise<AgentTapeSearchResult[]> {
    return await this.sessionProjection.searchTape(sessionId, query, options)
  }

  async getTapeContext(
    sessionId: string,
    entryIds: number[],
    options?: AgentTapeContextOptions
  ): Promise<AgentTapeContextResult> {
    return await this.sessionProjection.getTapeContext(sessionId, entryIds, options)
  }

  async listTapeAnchors(
    sessionId: string,
    options?: AgentTapeAnchorsOptions
  ): Promise<AgentTapeAnchorResult[]> {
    return await this.sessionProjection.listTapeAnchors(sessionId, options)
  }

  async handoffTape(
    sessionId: string,
    name: string,
    state: Record<string, unknown> = {}
  ): Promise<AgentTapeAnchorResult> {
    return await this.sessionProjection.handoffTape(sessionId, name, state)
  }

  async listMessageViewManifests(messageId: string): Promise<DeepChatTapeViewManifestRecord[]> {
    return await this.sessionProjection.listMessageViewManifests(messageId)
  }

  async exportMessageTapeReplaySlice(
    messageId: string,
    options?: DeepChatTapeReplayExportOptions
  ): Promise<DeepChatTapeReplaySlice | null> {
    return await this.sessionProjection.exportMessageTapeReplaySlice(messageId, options)
  }

  async mergeSubagentTape(
    parentSessionId: string,
    childSessionId: string,
    meta: Record<string, unknown> = {}
  ): Promise<void> {
    await this.sessionAssignment.mergeSubagentTape(parentSessionId, childSessionId, meta)
  }

  async discardSubagentTape(
    parentSessionId: string,
    childSessionId: string,
    meta: Record<string, unknown> = {}
  ): Promise<void> {
    await this.sessionAssignment.discardSubagentTape(parentSessionId, childSessionId, meta)
  }

  async getSearchResults(messageId: string, searchId?: string): Promise<SearchResult[]> {
    return await this.sessionProjection.getSearchResults(messageId, searchId)
  }

  async listMessageTraces(messageId: string): Promise<MessageTraceRecord[]> {
    return await this.sessionProjection.listMessageTraces(messageId)
  }

  async getMessageTraceCount(messageId: string): Promise<number> {
    return await this.sessionProjection.getMessageTraceCount(messageId)
  }

  async getMessageIds(sessionId: string): Promise<string[]> {
    return await this.sessionProjection.getMessageIds(sessionId)
  }

  async getMessage(messageId: string): Promise<ChatMessageRecord | null> {
    return await this.sessionProjection.getMessage(messageId)
  }

  async activateSession(webContentsId: number, sessionId: string): Promise<void> {
    await this.sessionProjection.activate(webContentsId, sessionId)
  }

  async deactivateSession(webContentsId: number): Promise<void> {
    await this.sessionProjection.deactivate(webContentsId)
  }

  async getActiveSession(webContentsId: number): Promise<SessionWithState | null> {
    return await this.sessionProjection.getActive(webContentsId)
  }

  getActiveSessionId(webContentsId: number): string | null {
    return this.sessionProjection.getActiveId(webContentsId)
  }

  async renameSession(sessionId: string, title: string): Promise<void> {
    await this.sessionProjection.renameSession(sessionId, title)
  }

  async toggleSessionPinned(sessionId: string, pinned: boolean): Promise<void> {
    await this.sessionProjection.toggleSessionPinned(sessionId, pinned)
  }

  async clearSessionMessages(sessionId: string): Promise<void> {
    await this.sessionTurn.clearSessionMessages(sessionId)
  }

  async deleteSession(sessionId: string): Promise<void> {
    await this.sessionLifecycle.deleteSession(sessionId)
  }

  async getAgentTransferImpact(agentId: string): Promise<AgentTransferImpact> {
    return await this.sessionAssignment.getAgentTransferImpact(agentId)
  }

  async moveAgentSessions(
    fromAgentId: string,
    toAgentId: string
  ): Promise<{ movedSessionIds: string[]; deletedSessionIds: string[] }> {
    return await this.sessionAssignment.moveAgentSessions(fromAgentId, toAgentId)
  }

  async deleteAgentSessions(agentId: string): Promise<string[]> {
    return await this.sessionAssignment.deleteAgentSessions(agentId)
  }

  async moveSessionToAgent(sessionId: string, toAgentId: string): Promise<SessionWithState> {
    return await this.sessionAssignment.moveSessionToAgent(sessionId, toAgentId)
  }

  async cancelGeneration(sessionId: string): Promise<void> {
    await this.sessionTurn.cancelGeneration(sessionId)
  }

  clearSessionPermissions(sessionId: string): void {
    this.sessionPermissionPort?.clearSessionPermissions(sessionId)
  }

  async respondToolInteraction(
    sessionId: string,
    messageId: string,
    toolCallId: string,
    response: ToolInteractionResponse
  ): Promise<ToolInteractionResult> {
    return await this.sessionTurn.respondToolInteraction(sessionId, messageId, toolCallId, response)
  }

  async getAcpSessionCommands(sessionId: string): Promise<
    Array<{
      name: string
      description: string
      input?: { hint: string } | null
    }>
  > {
    return await this.sessionAssignment.getAcpSessionCommands(sessionId)
  }

  async getAcpSessionConfigOptions(sessionId: string): Promise<AcpConfigState | null> {
    return await this.sessionAssignment.getAcpSessionConfigOptions(sessionId)
  }

  async setAcpSessionConfigOption(
    sessionId: string,
    configId: string,
    value: string | boolean
  ): Promise<AcpConfigState | null> {
    return await this.sessionAssignment.setAcpSessionConfigOption(sessionId, configId, value)
  }

  async getPermissionMode(sessionId: string): Promise<PermissionMode> {
    return await this.sessionAssignment.getPermissionMode(sessionId)
  }

  async setPermissionMode(sessionId: string, mode: PermissionMode): Promise<void> {
    await this.sessionAssignment.setPermissionMode(sessionId, mode)
  }

  async setSessionSubagentEnabled(sessionId: string, enabled: boolean): Promise<SessionWithState> {
    return await this.sessionAssignment.setSessionSubagentEnabled(sessionId, enabled)
  }

  async setSessionModel(
    sessionId: string,
    providerId: string,
    modelId: string
  ): Promise<SessionWithState> {
    return await this.sessionAssignment.setSessionModel(sessionId, providerId, modelId)
  }

  async setSessionProjectDir(
    sessionId: string,
    projectDir: string | null
  ): Promise<SessionWithState> {
    return await this.sessionAssignment.setSessionProjectDir(sessionId, projectDir)
  }

  async getSessionGenerationSettings(sessionId: string): Promise<SessionGenerationSettings | null> {
    return await this.sessionAssignment.getSessionGenerationSettings(sessionId)
  }

  async getSessionDisabledAgentTools(sessionId: string): Promise<string[]> {
    return await this.sessionAssignment.getSessionDisabledAgentTools(sessionId)
  }

  async updateSessionDisabledAgentTools(
    sessionId: string,
    disabledAgentTools: string[]
  ): Promise<string[]> {
    return await this.sessionAssignment.updateSessionDisabledAgentTools(
      sessionId,
      disabledAgentTools
    )
  }

  async updateSessionGenerationSettings(
    sessionId: string,
    settings: Partial<SessionGenerationSettings>
  ): Promise<SessionGenerationSettings> {
    return await this.sessionAssignment.updateSessionGenerationSettings(sessionId, settings)
  }
}
