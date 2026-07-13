import type {
  AssistantMessageBlock,
  DeepChatSessionState,
  MessageStartResult
} from '@shared/types/agent-interface'
import type { AcpAgentDescriptor } from '@/agent/shared/agentDescriptors'
import type { AppSessionId } from '@/agent/shared/agentSessionIds'
import type { AcpAgentRuntime, AcpAgentRuntimeSessionInput } from '@/agent/acp/instance'
import type {
  AgentSessionStatePort,
  AgentTapePort,
  AgentTranscriptReadPort
} from '@/agent/shared/agentSharedData'
import type {
  AgentGenerationControlFacet,
  AgentSubagentFacet,
  AgentTransferSourceFacet,
  DirectAcpSessionHandle
} from './sessionHandles'

export interface DirectAcpAgentBackendOptions {
  runtime: AcpAgentRuntime
  sessionState: AgentSessionStatePort
  transcript: Pick<AgentTranscriptReadPort, 'getMessage' | 'hasMessages'>
  tape: Pick<AgentTapePort, 'mergeSubagentTape' | 'discardSubagentTape'>
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
  open(sessionId: AppSessionId, descriptor: AcpAgentDescriptor): DirectAcpSessionHandle
}

const toSessionState = async (
  input: AcpAgentRuntimeSessionInput,
  runtime: AcpAgentRuntime,
  sessionState: AgentSessionStatePort
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
        async steerActiveTurn(content) {
          await runtime.steer(await options.resolveInput(sessionId, descriptor), content)
        },
        async list() {
          return runtime.listPendingInputs(sessionId)
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
        async convertToSteer(itemId) {
          return runtime.convertPendingInputToSteer(sessionId, itemId)
        },
        steer: (itemId) => runtime.steerPendingInput(sessionId, itemId),
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
        }
      },
      async send(input): Promise<MessageStartResult> {
        const resolved = await options.resolveInput(sessionId, descriptor)
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
    cleanupSession,
    transferSource: {
      hasMessages: (sessionId) => transcript.hasMessages(sessionId),
      listPendingInputs: async (sessionId) => runtime.listPendingInputs(sessionId)
    },
    subagent: {
      mergeTape: (parentSessionId, childSessionId, meta) =>
        tape.mergeSubagentTape(parentSessionId, childSessionId, meta),
      discardTape: (parentSessionId, childSessionId, meta) =>
        tape.discardSubagentTape(parentSessionId, childSessionId, meta)
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
