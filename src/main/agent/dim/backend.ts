import type { JsonValue } from '@shared/contracts/json'
import type {
  SendMessageInput,
  MessageStartResult,
  AttachmentPreparationSummary
} from '@shared/types/agent-interface'
import type { DeepChatAgentBackendPort } from '@/agent/manager/deepChatAgentBackend'
import type { SessionStatePort } from '@/session/data/contracts'
import type { SessionDatabase } from '@/session/data/database'
import type { AppSessionId } from '@/agent/shared/agentSessionIds'
import { isSendMessageInputEmpty } from '@/agent/shared/agentSessionNormalization'
import { DimSessionRuntime } from './sessionRuntime'

type CoreMethods =
  | 'openSessionInstance'
  | 'getHydratedSessionListState'
  | 'getSessionState'
  | 'getSessionListState'
  | 'waitForFirstTurnReady'
  | 'processMessage'
  | 'steerActiveTurn'
  | 'send'
  | 'cancelGeneration'
  | 'getActiveGeneration'
  | 'cancelGenerationByEventId'
  | 'cleanupSession'
type StartContext = NonNullable<Parameters<DeepChatAgentBackendPort['processMessage']>[2]>
interface PreparedInput {
  content: JsonValue[]
  representation: JsonValue
  summary: AttachmentPreparationSummary
}
export interface DimBackendOptions {
  database: SessionDatabase
  state: SessionStatePort
  runtime: DimSessionRuntime
  // Product controllers delegate settings, queue commands, interactions and context to native owners.
  controllers: Omit<DeepChatAgentBackendPort, CoreMethods>
  prepareInput(
    sessionId: AppSessionId,
    input: SendMessageInput,
    signal?: AbortSignal
  ): Promise<PreparedInput>
  // Configuration adoption and on-demand conversion complete before native admission.
  prepareNative(sessionId: string, context?: StartContext): Promise<void>
  closed(sessionId: string): void
}

/** The built-in backend is a product facade. dim owns every accepted turn and queued input. */
export function createDimSessionBackend(options: DimBackendOptions): DeepChatAgentBackendPort {
  const hydrated = new Map<string, object>()
  const { runtime, database, controllers, state } = options
  const active = (sessionId: string) => {
    const binding = database.dimSessionBindingsTable.get(sessionId)
    return binding?.activeTurnId
      ? { eventId: binding.activeTurnId, runId: binding.activeTurnId }
      : null
  }
  const submit = async (
    sessionId: AppSessionId,
    input: SendMessageInput,
    mode: 'queue' | 'steer',
    context?: StartContext,
    signal?: AbortSignal
  ): Promise<MessageStartResult> => {
    signal?.throwIfAborted()
    if (isSendMessageInputEmpty(input)) throw new Error('Message cannot be empty')
    if (!(await state.getSessionState(sessionId))) throw new Error('Session is not initialized')
    const prepared = await options.prepareInput(sessionId, input, signal)
    if (prepared.summary.status === 'needs_user_action')
      return {
        requestId: null,
        messageId: null,
        attachmentPreparation: prepared.summary
      }
    signal?.throwIfAborted()
    if (context?.projectDir !== undefined)
      await controllers.setSessionProjectDir(sessionId, context.projectDir)
    context?.beforeHistoryPreparation?.()
    await options.prepareNative(sessionId, context)
    signal?.throwIfAborted()
    await runtime.submit(sessionId, prepared.content, {
      mode,
      representation: prepared.representation
    })
    // The native receipt acknowledges admission, not execution. Live projection publishes the
    // eventual user/assistant identities; a queued submission must not borrow the active turn id.
    return { requestId: null, messageId: null, attachmentPreparation: prepared.summary }
  }
  const cleanup = async (sessionId: string): Promise<void> => {
    hydrated.delete(sessionId)
    try {
      if (database.dimSessionBindingsTable.get(sessionId)) await runtime.cancel(sessionId)
    } finally {
      await runtime.close(sessionId)
      options.closed(sessionId)
    }
  }
  const port: DeepChatAgentBackendPort = {
    ...controllers,
    openSessionInstance: (sessionId) => {
      const scope = {}
      hydrated.set(sessionId, scope)
      return () => {
        if (hydrated.get(sessionId) === scope) hydrated.delete(sessionId)
      }
    },
    getHydratedSessionListState: async (sessionId) =>
      hydrated.has(sessionId) ? state.getSessionListState(sessionId) : null,
    getSessionState: (sessionId) => state.getSessionState(sessionId),
    getSessionListState: (sessionId) => state.getSessionListState(sessionId),
    waitForFirstTurnReady: async (sessionId) => {
      if (!(await state.getSessionState(sessionId))) return false
      if (database.dimSessionBindingsTable.get(sessionId)) await runtime.open(sessionId)
      return true
    },
    processMessage: (sessionId, input, context) => submit(sessionId, input, 'queue', context),
    steerActiveTurn: (sessionId, input, settings) =>
      submit(sessionId, input, 'steer', undefined, settings?.signal),
    cancelGeneration: async (sessionId) => {
      if (database.dimSessionBindingsTable.get(sessionId)) await runtime.cancel(sessionId)
    },
    getActiveGeneration: active,
    cancelGenerationByEventId: async (sessionId, eventId) => {
      if (active(sessionId)?.eventId !== eventId) return false
      await runtime.cancel(sessionId)
      return true
    },
    send: async (sessionId, input) => {
      input.context?.signal?.throwIfAborted()
      if (input.queue) {
        await controllers.queuePendingInput(sessionId, input.content, {
          ...input.queue,
          signal: input.context?.signal
        })
        return { requestId: null, messageId: null }
      }
      return submit(sessionId, input.content, 'queue', input.context, input.context?.signal)
    },
    cleanupSession: cleanup
  }
  return port
}
