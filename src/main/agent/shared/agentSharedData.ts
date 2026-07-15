import type {
  AgentTapeAnchorResult,
  AgentTapeAnchorsOptions,
  AgentTapeContextOptions,
  AgentTapeContextResult,
  AgentTapeHandoffState,
  AgentTapeInfo,
  AgentTapeSearchOptions,
  AgentTapeSearchResult,
  ChatMessagePageResult,
  ChatMessageRecord,
  DeepChatSessionState,
  MessagePageCursor,
  PermissionMode,
  SendMessageInput,
  SessionAgentContextUpdate,
  SessionGenerationSettings,
  SubagentTapeLinkInput,
  SubagentTapeLinkReceipt
} from '@shared/types/agent-interface'
import type { DeepChatTapeViewManifestRecord } from '@shared/types/tape-view-manifest'
import type {
  DeepChatTapeReplayExportOptions,
  DeepChatTapeReplaySlice
} from '@shared/types/tape-replay'

export interface AgentSessionStatePort {
  initSession(
    sessionId: string,
    config: Partial<SessionAgentContextUpdate> &
      Pick<SessionAgentContextUpdate, 'providerId' | 'modelId'>
  ): Promise<void>
  destroySession(sessionId: string): Promise<void>
  getSessionState(sessionId: string): Promise<DeepChatSessionState | null>
  getSessionListState(sessionId: string): Promise<DeepChatSessionState | null>
  getPermissionMode(sessionId: string): Promise<PermissionMode>
  setPermissionMode(sessionId: string, mode: PermissionMode): Promise<void>
  getGenerationSettings(sessionId: string): Promise<SessionGenerationSettings | null>
  updateGenerationSettings(
    sessionId: string,
    settings: Partial<SessionGenerationSettings>
  ): Promise<SessionGenerationSettings>
  setSessionProjectDir(sessionId: string, projectDir: string | null): Promise<void>
}

export interface AgentTranscriptReadPort {
  getMessages(sessionId: string): Promise<ChatMessageRecord[]>
  hasMessages(sessionId: string): Promise<boolean>
  listMessagesPage(
    sessionId: string,
    options?: { limit?: number; cursor?: MessagePageCursor | null }
  ): Promise<ChatMessagePageResult>
  getMessageIds(sessionId: string): Promise<string[]>
  getMessage(messageId: string): Promise<ChatMessageRecord | null>
}

export interface AgentTranscriptMutationPort {
  clearMessages(sessionId: string): Promise<void>
  prepareRetryMessage(
    sessionId: string,
    messageId: string
  ): Promise<{ content: SendMessageInput; projectDir: string | null }>
  deleteMessage(sessionId: string, messageId: string): Promise<void>
  editUserMessage(sessionId: string, messageId: string, text: string): Promise<ChatMessageRecord>
  forkSessionFromMessage(
    sourceSessionId: string,
    targetSessionId: string,
    targetMessageId: string
  ): Promise<void>
}

export interface AgentTapePort {
  getTapeInfo(sessionId: string): Promise<AgentTapeInfo>
  searchTape(
    sessionId: string,
    query: string,
    options?: AgentTapeSearchOptions
  ): Promise<AgentTapeSearchResult[]>
  getTapeContext(
    sessionId: string,
    entryIds: number[],
    options?: AgentTapeContextOptions
  ): Promise<AgentTapeContextResult>
  listTapeAnchors(
    sessionId: string,
    options?: AgentTapeAnchorsOptions
  ): Promise<AgentTapeAnchorResult[]>
  handoffTape(
    sessionId: string,
    name: string,
    state: AgentTapeHandoffState
  ): Promise<AgentTapeAnchorResult>
  listMessageViewManifests(
    sessionId: string,
    messageId: string
  ): Promise<DeepChatTapeViewManifestRecord[]>
  exportMessageTapeReplaySlice(
    sessionId: string,
    messageId: string,
    options?: DeepChatTapeReplayExportOptions
  ): Promise<DeepChatTapeReplaySlice | null>
  linkSubagentTape(input: SubagentTapeLinkInput): Promise<SubagentTapeLinkReceipt>
}

export interface AgentSharedDataPorts {
  sessionState: AgentSessionStatePort
  transcript: AgentTranscriptReadPort
  transcriptMutation: AgentTranscriptMutationPort
  tape: AgentTapePort
}
