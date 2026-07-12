import type { AppSessionId } from '@/agent/shared/agentSessionIds'
import { DeepChatAgentRuntime } from '@/agent/deepchat/instance/deepChatAgentRuntime'
import type { IAgentImplementation, SessionCompactionState } from '@shared/types/agent-interface'
import type {
  AgentActiveGeneration,
  AgentGenerationControlFacet,
  AgentSessionHandle,
  AgentSubagentFacet,
  AgentTransferSourceFacet,
  DeepChatSessionHandle,
  DeepChatTransferTargetFacet
} from './sessionHandles'

export interface LegacyDeepChatSessionBackend {
  readonly kind: 'deepchat'
  readonly runtimeKind: 'legacy'
  readonly implementation: IAgentImplementation
  readonly runtime: DeepChatAgentRuntime
  readonly transferSource: AgentTransferSourceFacet
  readonly transferTarget: DeepChatTransferTargetFacet
  readonly subagent: AgentSubagentFacet
  readonly generationControl: AgentGenerationControlFacet
  cleanupSession(sessionId: AppSessionId): Promise<void>
  open(sessionId: AppSessionId): DeepChatSessionHandle
}

const deepChatHandles = new WeakMap<
  DeepChatAgentRuntime,
  Map<AppSessionId, DeepChatSessionHandle>
>()

function requireMethod<T extends (...args: never[]) => unknown>(
  implementation: object,
  methodName: string
): T {
  const method = (implementation as Record<string, unknown>)[methodName]
  if (typeof method !== 'function') {
    throw new Error(`Legacy agent implementation is missing required method: ${methodName}`)
  }
  return method.bind(implementation) as T
}

export function createLegacyAgentBackend(
  kind: 'deepchat',
  implementation: IAgentImplementation,
  deepChatRuntime?: DeepChatAgentRuntime
): LegacyDeepChatSessionBackend
export function createLegacyAgentBackend(
  kind: 'deepchat',
  implementation: IAgentImplementation,
  deepChatRuntime?: DeepChatAgentRuntime
): LegacyDeepChatSessionBackend {
  const initSession = requireMethod<IAgentImplementation['initSession']>(
    implementation,
    'initSession'
  )
  const destroySession = requireMethod<IAgentImplementation['destroySession']>(
    implementation,
    'destroySession'
  )
  const getSessionState = requireMethod<IAgentImplementation['getSessionState']>(
    implementation,
    'getSessionState'
  )
  const getSessionListState = implementation.getSessionListState?.bind(implementation)
  const waitForFirstTurnReady = implementation.waitForFirstTurnReady?.bind(implementation)
  const processMessage = requireMethod<IAgentImplementation['processMessage']>(
    implementation,
    'processMessage'
  )
  const cancelGeneration = requireMethod<IAgentImplementation['cancelGeneration']>(
    implementation,
    'cancelGeneration'
  )
  const steerActiveTurn = requireMethod<NonNullable<IAgentImplementation['steerActiveTurn']>>(
    implementation,
    'steerActiveTurn'
  )
  const listPendingInputs = requireMethod<NonNullable<IAgentImplementation['listPendingInputs']>>(
    implementation,
    'listPendingInputs'
  )
  const queuePendingInput = requireMethod<NonNullable<IAgentImplementation['queuePendingInput']>>(
    implementation,
    'queuePendingInput'
  )
  const updateQueuedInput = requireMethod<NonNullable<IAgentImplementation['updateQueuedInput']>>(
    implementation,
    'updateQueuedInput'
  )
  const moveQueuedInput = requireMethod<NonNullable<IAgentImplementation['moveQueuedInput']>>(
    implementation,
    'moveQueuedInput'
  )
  const convertPendingInputToSteer = requireMethod<
    NonNullable<IAgentImplementation['convertPendingInputToSteer']>
  >(implementation, 'convertPendingInputToSteer')
  const steerPendingInput = requireMethod<NonNullable<IAgentImplementation['steerPendingInput']>>(
    implementation,
    'steerPendingInput'
  )
  const deletePendingInput = requireMethod<NonNullable<IAgentImplementation['deletePendingInput']>>(
    implementation,
    'deletePendingInput'
  )
  const getPermissionMode = requireMethod<NonNullable<IAgentImplementation['getPermissionMode']>>(
    implementation,
    'getPermissionMode'
  )
  const setPermissionMode = requireMethod<NonNullable<IAgentImplementation['setPermissionMode']>>(
    implementation,
    'setPermissionMode'
  )
  const getGenerationSettings = requireMethod<
    NonNullable<IAgentImplementation['getGenerationSettings']>
  >(implementation, 'getGenerationSettings')
  const updateGenerationSettings = requireMethod<
    NonNullable<IAgentImplementation['updateGenerationSettings']>
  >(implementation, 'updateGenerationSettings')
  const setSessionProjectDir = requireMethod<
    NonNullable<IAgentImplementation['setSessionProjectDir']>
  >(implementation, 'setSessionProjectDir')
  const respondToolInteraction = requireMethod<
    NonNullable<IAgentImplementation['respondToolInteraction']>
  >(implementation, 'respondToolInteraction')
  const hasMessages = requireMethod<IAgentImplementation['hasMessages']>(
    implementation,
    'hasMessages'
  )
  const mergeSubagentTape = requireMethod<NonNullable<IAgentImplementation['mergeSubagentTape']>>(
    implementation,
    'mergeSubagentTape'
  )
  const discardSubagentTape = requireMethod<
    NonNullable<IAgentImplementation['discardSubagentTape']>
  >(implementation, 'discardSubagentTape')
  const getActiveGeneration = requireMethod<
    (sessionId: AppSessionId) => AgentActiveGeneration | null
  >(implementation, 'getActiveGeneration')
  const cancelGenerationByEventId = requireMethod<
    (sessionId: AppSessionId, eventId: string) => Promise<boolean>
  >(implementation, 'cancelGenerationByEventId')

  const transferSource: AgentTransferSourceFacet = {
    hasMessages: (sessionId) => hasMessages(sessionId),
    listPendingInputs: (sessionId) => listPendingInputs(sessionId)
  }
  const subagent: AgentSubagentFacet = {
    mergeTape: (parentSessionId, childSessionId, meta) =>
      mergeSubagentTape(parentSessionId, childSessionId, meta),
    discardTape: (parentSessionId, childSessionId, meta) =>
      discardSubagentTape(parentSessionId, childSessionId, meta)
  }
  const generationControl: AgentGenerationControlFacet = {
    getActiveGeneration: (sessionId) => getActiveGeneration(sessionId),
    cancelGenerationByEventId: (sessionId, eventId) => cancelGenerationByEventId(sessionId, eventId)
  }

  const createCommonHandle = (sessionId: AppSessionId): AgentSessionHandle => ({
    sessionId,
    kind: 'deepchat',
    runtimeKind: 'legacy',
    lifecycle: {
      initialize: (config) => initSession(sessionId, config),
      isInitialized: async () => (await getSessionState(sessionId)) !== null
    },
    pending: {
      steerActiveTurn: (content) => steerActiveTurn(sessionId, content),
      list: () => listPendingInputs(sessionId),
      queue: (content, options) => queuePendingInput(sessionId, content, options),
      update: (itemId, content) => updateQueuedInput(sessionId, itemId, content),
      move: (itemId, toIndex) => moveQueuedInput(sessionId, itemId, toIndex),
      convertToSteer: (itemId) => convertPendingInputToSteer(sessionId, itemId),
      steer: (itemId) => steerPendingInput(sessionId, itemId),
      delete: (itemId) => deletePendingInput(sessionId, itemId)
    },
    settings: {
      getPermissionMode: () => getPermissionMode(sessionId),
      setPermissionMode: (mode) => setPermissionMode(sessionId, mode),
      getGenerationSettings: () => getGenerationSettings(sessionId),
      updateGenerationSettings: (settings) => updateGenerationSettings(sessionId, settings),
      setProjectDir: (projectDir) => setSessionProjectDir(sessionId, projectDir)
    },
    toolInteractions: {
      respond: (messageId, toolCallId, response) =>
        respondToolInteraction(sessionId, messageId, toolCallId, response)
    },
    async send(input) {
      if (input.queue) {
        await queuePendingInput(sessionId, input.content, input.queue)
        return { requestId: null, messageId: null }
      }
      return await processMessage(sessionId, input.content, input.context)
    },
    cancel: () => cancelGeneration(sessionId),
    snapshot: (options) =>
      options?.lightweight && getSessionListState
        ? getSessionListState(sessionId)
        : getSessionState(sessionId),
    waitForFirstTurnReady: (options) =>
      waitForFirstTurnReady ? waitForFirstTurnReady(sessionId, options) : Promise.resolve(false),
    close: () => destroySession(sessionId)
  })

  const common = {
    kind,
    runtimeKind: 'legacy' as const,
    implementation,
    transferSource,
    subagent,
    generationControl,
    cleanupSession: async (_sessionId: AppSessionId) => undefined
  }

  const setSessionAgentContext = requireMethod<
    NonNullable<IAgentImplementation['setSessionAgentContext']>
  >(implementation, 'setSessionAgentContext')
  const setSessionModel = requireMethod<NonNullable<IAgentImplementation['setSessionModel']>>(
    implementation,
    'setSessionModel'
  )
  const getSessionCompactionState = requireMethod<
    NonNullable<IAgentImplementation['getSessionCompactionState']>
  >(implementation, 'getSessionCompactionState')
  const compactSession = requireMethod<NonNullable<IAgentImplementation['compactSession']>>(
    implementation,
    'compactSession'
  )
  const invalidateSystemPromptCache = requireMethod<(sessionId: string) => void>(
    implementation,
    'invalidateSessionSystemPromptCache'
  )
  const runtime =
    deepChatRuntime ?? new DeepChatAgentRuntime((sessionId) => createCommonHandle(sessionId))
  let handles = deepChatHandles.get(runtime)
  if (!handles) {
    handles = new Map<AppSessionId, DeepChatSessionHandle>()
    deepChatHandles.set(runtime, handles)
  }
  const open = (sessionId: AppSessionId): DeepChatSessionHandle => {
    const current = handles.get(sessionId)
    if (current) return current
    const instance = runtime.getOrHydrate(sessionId)
    const commonHandle = createCommonHandle(sessionId)
    const handle: DeepChatSessionHandle = {
      ...commonHandle,
      kind: 'deepchat',
      runtimeKind: 'legacy',
      send: (input) => instance.send(input),
      cancel: () => instance.cancel(),
      snapshot: (options) => instance.snapshot(options),
      waitForFirstTurnReady: (options) => commonHandle.waitForFirstTurnReady(options),
      close: async () => {
        handles.delete(sessionId)
        await instance.close()
      },
      deepchat: {
        setSessionAgentContext: (config) => setSessionAgentContext(sessionId, config),
        setModel: (providerId, modelId) => setSessionModel(sessionId, providerId, modelId),
        getCompactionState: () => getSessionCompactionState(sessionId),
        compact: () =>
          compactSession(sessionId) as Promise<{
            compacted: boolean
            state: SessionCompactionState
          }>,
        invalidateSystemPromptCache: () => invalidateSystemPromptCache(sessionId)
      }
    }
    handles.set(sessionId, handle)
    return handle
  }

  return {
    ...common,
    kind,
    runtime,
    cleanupSession: async (sessionId) => {
      handles.delete(sessionId)
      await runtime.cleanupSession(sessionId)
    },
    open,
    transferTarget: {
      setSessionAgentContext: (sessionId, config) => setSessionAgentContext(sessionId, config)
    }
  }
}
