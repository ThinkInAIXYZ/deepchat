import type {
  AssistantMessageBlock,
  DeepChatSessionState,
  MessageStartResult
} from '@shared/types/agent-interface'
import type { AcpAgentDescriptor } from '@/agent/shared/agentDescriptors'
import type { AppSessionId } from '@/agent/shared/agentSessionIds'
import type { AcpAgentRuntime, AcpAgentRuntimeSessionInput } from '@/agent/acp/instance'
import type {
  SessionStatePort,
  SessionTapePort,
  SessionTranscriptReadPort
} from '@/session/data/contracts'
import type {
  AgentGenerationControlFacet,
  AgentSubagentFacet,
  AgentTransferSourceFacet,
  DirectAcpSessionHandle
} from './sessionHandles'

export interface DirectAcpAgentBackendOptions {
  runtime: AcpAgentRuntime
  sessionState: SessionStatePort
  transcript: Pick<SessionTranscriptReadPort, 'getMessage' | 'hasMessages'> & {
    updateAssistantContent(
      messageId: string,
      blocks: AssistantMessageBlock[],
      metadata?: string
    ): void
  }
  tape: Pick<SessionTapePort, 'linkSubagentTape'>
  deleteDurableSession(sessionId: AppSessionId): Promise<void>
  resolveInput(
    sessionId: AppSessionId,
    descriptor: AcpAgentDescriptor
  ): Promise<AcpAgentRuntimeSessionInput>
}

export interface DirectAcpSessionBackend {
  readonly kind: 'acp'
  readonly runtime: AcpAgentRuntime
  readonly transferSource: AgentTransferSourceFacet
  readonly subagent: AgentSubagentFacet
  readonly generationControl: AgentGenerationControlFacet
  cleanupSession(sessionId: AppSessionId): Promise<void>
  snapshotIfHydrated(
    sessionId: AppSessionId,
    descriptor: AcpAgentDescriptor
  ): Promise<DeepChatSessionState | null>
  open(sessionId: AppSessionId, descriptor: AcpAgentDescriptor): DirectAcpSessionHandle
}

const toSessionState = async (
  input: AcpAgentRuntimeSessionInput,
  runtime: AcpAgentRuntime,
  sessionState: SessionStatePort
): Promise<DeepChatSessionState> => {
  const snapshot = await (await runtime.getOrHydrate(input)).snapshot()
  return {
    status:
      snapshot.status === 'generating'
        ? 'generating'
        : snapshot.status === 'error'
          ? 'error'
          : 'idle',
    providerId: 'acp',
    modelId: input.agent.id,
    permissionMode: await sessionState.getPermissionMode(input.sessionId)
  }
}

export const createDirectAcpAgentBackend = (
  options: DirectAcpAgentBackendOptions
): DirectAcpSessionBackend => {
  const { runtime, sessionState, transcript, tape } = options
  const resolve = async (sessionId: AppSessionId, descriptor: AcpAgentDescriptor) => {
    const input = await options.resolveInput(sessionId, descriptor)
    return { input, instance: await runtime.getOrHydrate(input) }
  }

  const cleanupSession = async (sessionId: AppSessionId): Promise<void> => {
    let runtimeError: unknown
    try {
      await runtime.cleanupSession(sessionId)
    } catch (error) {
      runtimeError = error
    }
    try {
      await options.deleteDurableSession(sessionId)
    } catch (error) {
      if (!runtimeError) throw error
    }
    if (runtimeError) throw runtimeError
  }

  const close = async (sessionId: AppSessionId): Promise<void> => {
    let cleanupError: unknown
    try {
      await cleanupSession(sessionId)
    } catch (error) {
      cleanupError = error
    }
    try {
      await sessionState.destroySession(sessionId)
    } catch (error) {
      if (!cleanupError) throw error
    }
    if (cleanupError) throw cleanupError
  }

  const open = (
    sessionId: AppSessionId,
    descriptor: AcpAgentDescriptor
  ): DirectAcpSessionHandle => {
    const handle: DirectAcpSessionHandle = {
      kind: 'acp',
      sessionId,
      lifecycle: {
        async initialize(config) {
          if (config.providerId !== 'acp' || config.modelId !== descriptor.id) {
            throw new Error(
              `ACP session identity mismatch: expected acp/${descriptor.id}, received ${config.providerId}/${config.modelId}`
            )
          }
          await sessionState.initSession(sessionId, config)
          await resolve(sessionId, descriptor)
        },
        async isInitialized() {
          return (await sessionState.getSessionState(sessionId)) !== null
        }
      },
      pending: {
        async steerActiveTurn(content, steerOptions) {
          throwIfAborted(steerOptions?.signal)
          const resolvedInput = await options.resolveInput(sessionId, descriptor)
          throwIfAborted(steerOptions?.signal)
          const accepted = await runtime.steer(resolvedInput, content)
          return {
            requestId: null,
            messageId: null,
            userMessage: accepted.message
          }
        },
        async list() {
          let inputs = runtime.listPendingInputs(sessionId)
          if (inputs.some((input) => input.mode === 'steer' && input.state === 'pending')) {
            await runtime.resumePendingInputs(await options.resolveInput(sessionId, descriptor))
            inputs = runtime.listPendingInputs(sessionId)
          }
          return inputs
        },
        async queue(content) {
          return await runtime.queuePendingInput(
            await options.resolveInput(sessionId, descriptor),
            content
          )
        },
        async update(itemId, content) {
          return runtime.updateQueuedInput(sessionId, itemId, content)
        },
        async move(itemId, toIndex) {
          return runtime.moveQueuedInput(sessionId, itemId, toIndex)
        },
        steer: (itemId) => runtime.steerPendingInput(sessionId, itemId),
        async resolveBlocked() {
          throw new Error('Direct ACP sessions do not create blocked attachment inputs.')
        },
        async delete(itemId) {
          runtime.deletePendingInput(sessionId, itemId)
        }
      },
      settings: {
        getPermissionMode: () => sessionState.getPermissionMode(sessionId),
        setPermissionMode: (mode) => sessionState.setPermissionMode(sessionId, mode),
        getGenerationSettings: () => sessionState.getGenerationSettings(sessionId),
        updateGenerationSettings: (settings) =>
          sessionState.updateGenerationSettings(sessionId, settings),
        async setProjectDir(projectDir) {
          await sessionState.setSessionProjectDir(sessionId, projectDir)
          const input = await options.resolveInput(sessionId, descriptor)
          input.workdir = projectDir?.trim() ?? ''
          await runtime.getOrHydrate(input)
        }
      },
      toolInteractions: {
        async respond(messageId, toolCallId, response) {
          if (response.kind !== 'permission') {
            throw new Error('Direct ACP sessions only accept permission interactions.')
          }
          const message = await transcript.getMessage(messageId)
          if (!message || message.sessionId !== sessionId || message.role !== 'assistant') {
            throw new Error(`Assistant message not found: ${messageId}`)
          }
          const blocks = JSON.parse(message.content) as AssistantMessageBlock[]
          const block = blocks.find(
            (candidate) =>
              candidate.type === 'action' &&
              candidate.action_type === 'tool_call_permission' &&
              candidate.tool_call?.id === toolCallId
          )
          const requestId = block?.extra?.permissionRequestId?.trim()
          if (!requestId) {
            throw new Error(`ACP permission request not found for tool call: ${toolCallId}`)
          }
          const resolved = runtime
            .getHydrated(sessionId)
            ?.resolvePermissionRequest(requestId, response.granted)
          if (!resolved) throw new Error(`Unknown ACP permission request: ${requestId}`)
          return { resumed: false }
        },
        async dismiss(messageId: string, toolCallId: string) {
          const message = await transcript.getMessage(messageId)
          if (!message || message.sessionId !== sessionId || message.role !== 'assistant') {
            return false
          }
          const blocks = JSON.parse(message.content) as AssistantMessageBlock[]
          const block = blocks.find(
            (candidate) =>
              candidate.type === 'action' &&
              candidate.action_type === 'tool_call_permission' &&
              candidate.tool_call?.id === toolCallId
          )
          const requestId = block?.extra?.permissionRequestId?.trim()
          if (!requestId) return false
          if (runtime.getHydrated(sessionId)?.resolvePermissionRequest(requestId, false)) {
            return true
          }
          // No live ACP runtime can resolve the request: persist a durable denied
          // block so the stale approval does not reappear after a reload.
          if (!block) return false
          block.status = 'denied'
          block.extra = { ...block.extra, needsUserAction: false }
          transcript.updateAssistantContent(messageId, blocks)
          return true
        }
      },
      async send(input): Promise<MessageStartResult> {
        throwIfAborted(input.context?.signal)
        const resolved = await options.resolveInput(sessionId, descriptor)
        throwIfAborted(input.context?.signal)
        if (input.context?.projectDir !== undefined) {
          resolved.workdir = input.context.projectDir?.trim() ?? ''
        }
        if (input.queue) {
          await runtime.queuePendingInput(resolved, input.content)
          return { requestId: null, messageId: null }
        }
        return await runtime.send(resolved, input.content)
      },
      cancel: () => runtime.cancel(sessionId),
      snapshot: async (snapshotOptions) => {
        if (snapshotOptions?.lightweight) {
          const state = await sessionState.getSessionListState(sessionId)
          return state ? { ...state, providerId: 'acp', modelId: descriptor.id } : null
        }
        return await toSessionState(
          await options.resolveInput(sessionId, descriptor),
          runtime,
          sessionState
        )
      },
      waitForFirstTurnReady: async (waitOptions) =>
        await (await resolve(sessionId, descriptor)).instance.waitForFirstTurnReady(waitOptions),
      close: () => close(sessionId),
      acp: {
        async prepare() {
          await runtime.prepare(await options.resolveInput(sessionId, descriptor))
        },
        async updateWorkdir(workdir) {
          await sessionState.setSessionProjectDir(sessionId, workdir)
          const input = await options.resolveInput(sessionId, descriptor)
          input.workdir = workdir?.trim() ?? ''
          return (await runtime.getOrHydrate(input)).getWorkdir()
        },
        async getModes() {
          return (await resolve(sessionId, descriptor)).instance.getModes()
        },
        async setMode(modeId) {
          await (await resolve(sessionId, descriptor)).instance.setMode(modeId)
        },
        async getConfigOptions() {
          return (await resolve(sessionId, descriptor)).instance.getConfigOptions()
        },
        async setConfigOption(configId, value) {
          return await (
            await resolve(sessionId, descriptor)
          ).instance.setConfigOption(configId, value)
        },
        async getCommands() {
          return (await resolve(sessionId, descriptor)).instance.getCommands()
        },
        async closeRuntime() {
          await runtime.close(sessionId)
        }
      }
    }
    return handle
  }

  return {
    kind: 'acp',
    runtime,
    open,
    async snapshotIfHydrated(sessionId, descriptor) {
      const instance = runtime.getHydrated(sessionId)
      if (!instance) return null
      const snapshot = await instance.snapshot()
      return {
        status:
          snapshot.status === 'generating'
            ? 'generating'
            : snapshot.status === 'error'
              ? 'error'
              : 'idle',
        providerId: 'acp',
        modelId: descriptor.id,
        permissionMode: await sessionState.getPermissionMode(sessionId)
      }
    },
    cleanupSession,
    transferSource: {
      hasMessages: async (sessionId) => await transcript.hasMessages(sessionId),
      listPendingInputs: async (sessionId) => runtime.listPendingInputs(sessionId)
    },
    subagent: {
      linkTape: (input) => tape.linkSubagentTape(input)
    },
    generationControl: {
      getActiveGeneration: (sessionId) =>
        runtime.getHydrated(sessionId)?.getActiveGeneration() ?? null,
      async cancelGenerationByEventId(sessionId, eventId) {
        return await (runtime.getHydrated(sessionId)?.cancelGenerationByEventId(eventId) ?? false)
      }
    }
  }
}

function throwIfAborted(signal?: AbortSignal): void {
  if (!signal?.aborted) return
  if (signal.reason instanceof Error) throw signal.reason
  throw new DOMException('Aborted', 'AbortError')
}
