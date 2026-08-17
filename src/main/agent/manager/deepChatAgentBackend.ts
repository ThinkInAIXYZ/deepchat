import { DeepChatAgentRuntime } from '@/agent/deepchat/instance/deepChatAgentRuntime'
import type { AppSessionId } from '@/agent/shared/agentSessionIds'
import type { AgentSessionSendInput } from '@/agent/shared/agentSessionHandle'
import type { SessionTapePort, SessionTranscriptReadPort } from '@/session/data/contracts'
import type {
  DeepChatSessionState,
  MessageStartResult,
  PendingSessionInputRecord,
  PermissionMode,
  QueuePendingInputOptions,
  SendMessageInput,
  SessionAgentContextUpdate,
  SessionCompactionSnapshot,
  SessionCompactionState,
  SessionContextOccupancySnapshot,
  SessionGenerationSettings,
  ToolInteractionResponse,
  ToolInteractionResult
} from '@shared/types/agent-interface'
import type {
  AgentActiveGeneration,
  AgentGenerationControlFacet,
  AgentSubagentFacet,
  AgentTransferSourceFacet,
  DeepChatSessionHandle,
  DeepChatTransferTargetFacet
} from './sessionHandles'

export interface DeepChatAgentBackendPort {
  initSession(
    sessionId: AppSessionId,
    config: Partial<SessionAgentContextUpdate> &
      Pick<SessionAgentContextUpdate, 'providerId' | 'modelId'>
  ): Promise<void>
  destroySession(sessionId: AppSessionId): Promise<void>
  getSessionState(sessionId: AppSessionId): Promise<DeepChatSessionState | null>
  getSessionListState(sessionId: AppSessionId): Promise<DeepChatSessionState | null>
  waitForFirstTurnReady(sessionId: AppSessionId, options?: { timeoutMs?: number }): Promise<boolean>
  processMessage(
    sessionId: AppSessionId,
    content: SendMessageInput,
    context?: {
      projectDir?: string | null
      emitRefreshBeforeStream?: boolean
      maxProviderRounds?: number
      preserveResolvedRepresentations?: boolean
      beforeHistoryPreparation?: () => void
    }
  ): Promise<MessageStartResult>
  cancelGeneration(sessionId: AppSessionId): Promise<void>
  steerActiveTurn(
    sessionId: AppSessionId,
    content: SendMessageInput,
    options?: { signal?: AbortSignal }
  ): Promise<MessageStartResult>
  listPendingInputs(sessionId: AppSessionId): Promise<PendingSessionInputRecord[]>
  isPendingQueueResumeAvailable(sessionId: AppSessionId): Promise<boolean>
  resumePendingQueue(sessionId: AppSessionId): Promise<boolean>
  retryPendingQueueInput(
    sessionId: AppSessionId,
    itemId: string
  ): Promise<{ accepted: boolean; started: boolean }>
  queuePendingInput(
    sessionId: AppSessionId,
    content: SendMessageInput,
    options?: QueuePendingInputOptions
  ): Promise<PendingSessionInputRecord>
  updateQueuedInput(
    sessionId: AppSessionId,
    itemId: string,
    content: SendMessageInput
  ): Promise<PendingSessionInputRecord>
  moveQueuedInput(
    sessionId: AppSessionId,
    itemId: string,
    toIndex: number
  ): Promise<PendingSessionInputRecord[]>
  steerPendingInput(sessionId: AppSessionId, itemId: string): Promise<PendingSessionInputRecord>
  resolveBlockedPendingInput(
    sessionId: AppSessionId,
    itemId: string,
    action: 'retry' | 'send_without_image_content'
  ): Promise<PendingSessionInputRecord>
  deletePendingInput(sessionId: AppSessionId, itemId: string): Promise<void>
  getPermissionMode(sessionId: AppSessionId): Promise<PermissionMode>
  setPermissionMode(sessionId: AppSessionId, mode: PermissionMode): Promise<void>
  getGenerationSettings(sessionId: AppSessionId): Promise<SessionGenerationSettings | null>
  updateGenerationSettings(
    sessionId: AppSessionId,
    settings: Partial<SessionGenerationSettings>
  ): Promise<SessionGenerationSettings>
  setSessionProjectDir(sessionId: AppSessionId, projectDir: string | null): Promise<void>
  respondToolInteraction(
    sessionId: AppSessionId,
    messageId: string,
    toolCallId: string,
    response: ToolInteractionResponse
  ): Promise<ToolInteractionResult>
  getActiveGeneration(sessionId: AppSessionId): AgentActiveGeneration | null
  cancelGenerationByEventId(sessionId: AppSessionId, eventId: string): Promise<boolean>
  setSessionAgentContext(sessionId: AppSessionId, config: SessionAgentContextUpdate): Promise<void>
  setSessionModel(sessionId: AppSessionId, providerId: string, modelId: string): Promise<void>
  getSessionCompactionSnapshot(sessionId: AppSessionId): Promise<SessionCompactionSnapshot>
  getSessionContextOccupancy(sessionId: AppSessionId): Promise<SessionContextOccupancySnapshot>
  compactSession(
    sessionId: AppSessionId
  ): Promise<{ compacted: boolean; state: SessionCompactionState }>
  send(sessionId: AppSessionId, input: AgentSessionSendInput): Promise<MessageStartResult>
  cleanupSession(sessionId: AppSessionId): Promise<void>
}

export interface DeepChatAgentBackend {
  readonly kind: 'deepchat'
  readonly runtime: DeepChatAgentRuntime
  readonly transferSource: AgentTransferSourceFacet
  readonly transferTarget: DeepChatTransferTargetFacet
  readonly subagent: AgentSubagentFacet
  readonly generationControl: AgentGenerationControlFacet
  cleanupSession(sessionId: AppSessionId): Promise<void>
  snapshotIfHydrated(sessionId: AppSessionId): Promise<DeepChatSessionState | null>
  open(sessionId: AppSessionId): DeepChatSessionHandle
}

export interface DeepChatAgentBackendOptions {
  runtime: DeepChatAgentRuntime
  port: DeepChatAgentBackendPort
  transcript: Pick<SessionTranscriptReadPort, 'hasMessages'>
  tape: Pick<SessionTapePort, 'linkSubagentTape'>
}

export function createDeepChatAgentBackend(
  options: DeepChatAgentBackendOptions
): DeepChatAgentBackend {
  const { port, runtime, transcript, tape } = options
  const handles = new Map<AppSessionId, DeepChatSessionHandle>()
  const transferSource: AgentTransferSourceFacet = {
    hasMessages: async (sessionId) => await transcript.hasMessages(sessionId),
    listPendingInputs: (sessionId) => port.listPendingInputs(sessionId)
  }
  const subagent: AgentSubagentFacet = {
    linkTape: (input) => tape.linkSubagentTape(input)
  }
  const generationControl: AgentGenerationControlFacet = {
    getActiveGeneration: (sessionId) => port.getActiveGeneration(sessionId),
    cancelGenerationByEventId: (sessionId, eventId) =>
      port.cancelGenerationByEventId(sessionId, eventId)
  }

  const open = (sessionId: AppSessionId): DeepChatSessionHandle => {
    const current = handles.get(sessionId)
    if (current) return current

    // Opening a handle hydrates the runtime instance so hydration-sensitive reads such as
    // snapshotIfHydrated observe the session as soon as it has a handle.
    const instance = runtime.getOrHydrate(sessionId)
    const handle: DeepChatSessionHandle = {
      sessionId,
      kind: 'deepchat',
      lifecycle: {
        initialize: (config) => port.initSession(sessionId, config),
        isInitialized: async () => (await port.getSessionState(sessionId)) !== null
      },
      pending: {
        steerActiveTurn: (content, steerOptions) =>
          steerOptions
            ? port.steerActiveTurn(sessionId, content, steerOptions)
            : port.steerActiveTurn(sessionId, content),
        list: () => port.listPendingInputs(sessionId),
        queue: (content, queueOptions) => port.queuePendingInput(sessionId, content, queueOptions),
        update: (itemId, content) => port.updateQueuedInput(sessionId, itemId, content),
        move: (itemId, toIndex) => port.moveQueuedInput(sessionId, itemId, toIndex),
        steer: (itemId) => port.steerPendingInput(sessionId, itemId),
        resolveBlocked: (itemId, action) =>
          port.resolveBlockedPendingInput(sessionId, itemId, action),
        delete: (itemId) => port.deletePendingInput(sessionId, itemId)
      },
      settings: {
        getPermissionMode: () => port.getPermissionMode(sessionId),
        setPermissionMode: (mode) => port.setPermissionMode(sessionId, mode),
        getGenerationSettings: () => port.getGenerationSettings(sessionId),
        updateGenerationSettings: (settings) => port.updateGenerationSettings(sessionId, settings),
        setProjectDir: (projectDir) => port.setSessionProjectDir(sessionId, projectDir)
      },
      toolInteractions: {
        respond: (messageId, toolCallId, response) =>
          port.respondToolInteraction(sessionId, messageId, toolCallId, response)
      },
      send: (input) => port.send(sessionId, input),
      cancel: () => port.cancelGeneration(sessionId),
      snapshot: (snapshotOptions) =>
        snapshotOptions?.lightweight
          ? port.getSessionListState(sessionId)
          : port.getSessionState(sessionId),
      waitForFirstTurnReady: (waitOptions) => port.waitForFirstTurnReady(sessionId, waitOptions),
      close: async () => {
        handles.delete(sessionId)
        try {
          await port.destroySession(sessionId)
        } finally {
          // Closing a handle always releases its own runtime instance, even when durable teardown
          // fails, while leaving any replacement instance alone.
          if (runtime.getHydrated(sessionId) === instance) runtime.evict(sessionId)
        }
      },
      deepchat: {
        setSessionAgentContext: (config) => port.setSessionAgentContext(sessionId, config),
        setModel: (providerId, modelId) => port.setSessionModel(sessionId, providerId, modelId),
        getCompactionSnapshot: () => port.getSessionCompactionSnapshot(sessionId),
        getContextOccupancy: () => port.getSessionContextOccupancy(sessionId),
        compact: () => port.compactSession(sessionId),
        isPendingQueueResumeAvailable: () => port.isPendingQueueResumeAvailable(sessionId),
        resumePendingQueue: () => port.resumePendingQueue(sessionId),
        retryPendingQueueInput: (itemId) => port.retryPendingQueueInput(sessionId, itemId)
      }
    }
    handles.set(sessionId, handle)
    return handle
  }

  return {
    kind: 'deepchat',
    runtime,
    open,
    async snapshotIfHydrated(sessionId) {
      if (!runtime.getHydrated(sessionId)) return null
      return await port.getSessionListState(sessionId)
    },
    async cleanupSession(sessionId) {
      handles.delete(sessionId)
      await port.cleanupSession(sessionId)
    },
    transferSource,
    transferTarget: {
      setSessionAgentContext: (sessionId, config) => port.setSessionAgentContext(sessionId, config)
    },
    subagent,
    generationControl
  }
}
