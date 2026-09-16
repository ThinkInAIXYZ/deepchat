import type {
  ChatMessagePageResult,
  ChatMessageRecord,
  CreateDetachedSessionInput,
  MessagePageCursor,
  MessageStartResult,
  SessionRecord,
  SessionWithState
} from '@shared/types/agent-interface'

/**
 * V1 CLI compatibility projection ports. Declared here so the compatibility handler's narrow
 * contracts are importable without CLI runtime dependencies; runtime instances stay host-side
 * (see docs/architecture/standalone-agent-harness/compatibility.md).
 */
export type RunLifecyclePort = Readonly<{
  createDetachedSession(input: CreateDetachedSessionInput): Promise<SessionWithState>
}>

export type RunTurnPort = Readonly<{
  sendMessage(
    sessionId: string,
    content: string,
    options?: { maxProviderRounds?: number }
  ): Promise<MessageStartResult>
  cancelGeneration(sessionId: string): Promise<void>
}>

export type RunProjectionPort = Readonly<{
  getSession(sessionId: string): Promise<SessionWithState | null>
  listMessagesPage(
    sessionId: string,
    options?: { limit?: number; cursor?: MessagePageCursor | null }
  ): Promise<ChatMessagePageResult>
}>

export type RunSessionStorePort = Readonly<{
  get(sessionId: string): SessionRecord | null
}>

export type RunPendingAssistantMessages = (runId: string) => ChatMessageRecord[]

export type RunWaitingDescendantInteraction = (runId: string) => boolean
