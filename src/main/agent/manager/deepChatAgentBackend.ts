import { DeepChatAgentRuntime } from '@/agent/deepchat/instance/deepChatAgentRuntime'
import type { AppSessionId } from '@/agent/shared/agentSessionIds'
import type { SessionTapePort, SessionTranscriptReadPort } from '@/session/data/contracts'
import type {
  DeepChatSessionState,
  MessageStartResult,
  PendingInputEnqueueSource,
  PendingSessionInputRecord,
  PermissionMode,
  QueuePendingInputOptions,
  SendMessageInput,
  SessionAgentContextUpdate,
  SessionCompactionState,
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
      pendingQueueItemId?: string
      pendingQueueItemSource?: PendingInputEnqueueSource
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
  convertPendingInputToSteer(
    sessionId: AppSessionId,
    itemId: string
  ): Promise<PendingSessionInputRecord>
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
  getSessionCompactionState(sessionId: AppSessionId): Promise<SessionCompactionState>
  compactSession(
    sessionId: AppSessionId
  ): Promise<{ compacted: boolean; state: SessionCompactionState }>
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
        convertToSteer: (itemId) => port.convertPendingInputToSteer(sessionId, itemId),
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
      send: (input) => instance.send(input),
      cancel: () => instance.cancel(),
      snapshot: (snapshotOptions) => instance.snapshot(snapshotOptions),
      waitForFirstTurnReady: (waitOptions) => port.waitForFirstTurnReady(sessionId, waitOptions),
      close: async () => {
        handles.delete(sessionId)
        await instance.close()
      },
      deepchat: {
        setSessionAgentContext: (config) => port.setSessionAgentContext(sessionId, config),
        setModel: (providerId, modelId) => port.setSessionModel(sessionId, providerId, modelId),
        getCompactionState: () => port.getSessionCompactionState(sessionId),
        compact: () => port.compactSession(sessionId)
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
      return (await runtime.getHydrated(sessionId)?.snapshot({ lightweight: true })) ?? null
    },
    async cleanupSession(sessionId) {
      handles.delete(sessionId)
      await runtime.cleanupSession(sessionId)
    },
    transferSource,
    transferTarget: {
      setSessionAgentContext: (sessionId, config) => port.setSessionAgentContext(sessionId, config)
    },
    subagent,
    generationControl
  }
}
