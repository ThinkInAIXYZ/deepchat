import type { AppSessionId } from '@/agent/shared/agentSessionIds'
import type { AgentSessionSendInput } from '@/agent/shared/agentSessionHandle'
import type { DeepChatAgentInstance } from '@/agent/deepchat/instance/deepChatAgentInstance'
import { DeepChatAgentRuntime } from '@/agent/deepchat/instance/deepChatAgentRuntime'
import type {
  DeepChatSessionState,
  IAgentImplementation,
  MessageStartResult,
  PendingSessionInputRecord,
  SessionAgentContextUpdate
} from '@shared/types/agent-interface'

export type LegacyAgentSendInput = AgentSessionSendInput

export interface LegacyAgentSessionHandle {
  readonly sessionId: AppSessionId
  readonly kind: 'deepchat' | 'acp'
  readonly compatibilityImplementation: IAgentImplementation
  send(input: LegacyAgentSendInput): Promise<MessageStartResult>
  cancel(): Promise<void>
  snapshot(options?: { lightweight?: boolean }): Promise<DeepChatSessionState | null>
  close(): Promise<void>
}

export interface LegacyTransferSourceFacet {
  hasMessages(sessionId: AppSessionId): Promise<boolean>
  listPendingInputs(sessionId: AppSessionId): Promise<PendingSessionInputRecord[]>
}

export interface LegacyDeepChatTransferTargetFacet {
  setSessionAgentContext(sessionId: AppSessionId, config: SessionAgentContextUpdate): Promise<void>
}

export interface LegacyDeepChatSubagentFacet {
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

export interface LegacyAcpSubagentFacet {
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

export interface LegacyActiveGeneration {
  eventId: string
  runId: string
}

export interface LegacyGenerationControlFacet {
  getActiveGeneration(sessionId: AppSessionId): LegacyActiveGeneration | null
  cancelGenerationByEventId(sessionId: AppSessionId, eventId: string): Promise<boolean>
}

export interface LegacyDeepChatSessionBackend {
  readonly kind: 'deepchat'
  readonly implementation: IAgentImplementation
  readonly runtime: DeepChatAgentRuntime
  readonly transferSource: LegacyTransferSourceFacet
  readonly transferTarget: LegacyDeepChatTransferTargetFacet
  readonly subagent: LegacyDeepChatSubagentFacet
  readonly generationControl: LegacyGenerationControlFacet
  open(sessionId: AppSessionId): DeepChatAgentInstance
}

export interface LegacyAcpSessionBackend {
  readonly kind: 'acp'
  readonly implementation: IAgentImplementation
  readonly transferSource: LegacyTransferSourceFacet
  readonly subagent: LegacyAcpSubagentFacet
  readonly generationControl: LegacyGenerationControlFacet
  open(sessionId: AppSessionId): LegacyAgentSessionHandle
}

export type LegacyAgentSessionBackend = LegacyDeepChatSessionBackend | LegacyAcpSessionBackend

export interface LegacyAgentBackendSet {
  readonly deepchat: LegacyDeepChatSessionBackend
  readonly acp: LegacyAcpSessionBackend
}

function requireMethod<T extends (...args: never[]) => unknown>(
  implementation: object,
  methodName: string
): T {
  const method = (implementation as Record<string, unknown>)[methodName]
  if (typeof method !== 'function') {
    throw new Error(`Legacy agent implementation is missing required method: ${String(methodName)}`)
  }
  return method.bind(implementation) as T
}

export function createLegacyAgentBackend(
  kind: 'deepchat',
  implementation: IAgentImplementation
): LegacyDeepChatSessionBackend
export function createLegacyAgentBackend(
  kind: 'acp',
  implementation: IAgentImplementation
): LegacyAcpSessionBackend
export function createLegacyAgentBackend(
  kind: 'deepchat' | 'acp',
  implementation: IAgentImplementation
): LegacyAgentSessionBackend {
  const hasMessages = requireMethod<IAgentImplementation['hasMessages']>(
    implementation,
    'hasMessages'
  )
  const listPendingInputs = requireMethod<NonNullable<IAgentImplementation['listPendingInputs']>>(
    implementation,
    'listPendingInputs'
  )
  const mergeSubagentTape = requireMethod<NonNullable<IAgentImplementation['mergeSubagentTape']>>(
    implementation,
    'mergeSubagentTape'
  )
  const discardSubagentTape = requireMethod<
    NonNullable<IAgentImplementation['discardSubagentTape']>
  >(implementation, 'discardSubagentTape')
  const getActiveGeneration = requireMethod<
    (sessionId: AppSessionId) => LegacyActiveGeneration | null
  >(implementation, 'getActiveGeneration')
  const cancelGenerationByEventId = requireMethod<
    (sessionId: AppSessionId, eventId: string) => Promise<boolean>
  >(implementation, 'cancelGenerationByEventId')
  const transferSource: LegacyTransferSourceFacet = {
    hasMessages: (sessionId) => hasMessages(sessionId),
    listPendingInputs: (sessionId) => listPendingInputs(sessionId)
  }
  const subagent = {
    mergeTape: (
      parentSessionId: AppSessionId,
      childSessionId: AppSessionId,
      meta?: Record<string, unknown>
    ) => mergeSubagentTape(parentSessionId, childSessionId, meta),
    discardTape: (
      parentSessionId: AppSessionId,
      childSessionId: AppSessionId,
      meta?: Record<string, unknown>
    ) => discardSubagentTape(parentSessionId, childSessionId, meta)
  }
  const generationControl: LegacyGenerationControlFacet = {
    getActiveGeneration: (sessionId) => getActiveGeneration(sessionId),
    cancelGenerationByEventId: (sessionId, eventId) => cancelGenerationByEventId(sessionId, eventId)
  }
  const openLegacyHandle = (
    sessionId: AppSessionId,
    handleKind: 'deepchat' | 'acp'
  ): LegacyAgentSessionHandle => ({
    sessionId,
    kind: handleKind,
    compatibilityImplementation: implementation,
    async send(input) {
      if (implementation.queuePendingInput && input.queue) {
        await implementation.queuePendingInput(sessionId, input.content, input.queue)
        return { requestId: null, messageId: null }
      }
      return await implementation.processMessage(sessionId, input.content, input.context)
    },
    async cancel() {
      await implementation.cancelGeneration(sessionId)
    },
    async snapshot(options) {
      if (options?.lightweight && implementation.getSessionListState) {
        return await implementation.getSessionListState(sessionId)
      }
      return await implementation.getSessionState(sessionId)
    },
    async close() {
      await implementation.destroySession(sessionId)
    }
  })
  const common = {
    kind,
    implementation,
    transferSource,
    generationControl
  }

  if (kind === 'deepchat') {
    const setSessionAgentContext = requireMethod<
      NonNullable<IAgentImplementation['setSessionAgentContext']>
    >(implementation, 'setSessionAgentContext')
    const runtime = new DeepChatAgentRuntime((sessionId) => openLegacyHandle(sessionId, 'deepchat'))
    return {
      ...common,
      kind,
      runtime,
      open: (sessionId) => runtime.getOrHydrate(sessionId),
      transferTarget: {
        setSessionAgentContext: (sessionId, config) => setSessionAgentContext(sessionId, config)
      },
      subagent
    }
  }

  return {
    ...common,
    kind,
    open: (sessionId) => openLegacyHandle(sessionId, 'acp'),
    subagent
  }
}
