import type {
  IConfigPresenter,
  ILlmProviderPresenter,
  RateLimitQueueSnapshot
} from '@shared/presenter'
import type { DeepChatSessionState } from '@shared/types/agent-interface'
import type { MCPToolDefinition } from '@shared/types/core/mcp'
import type { HookEventName } from '@shared/hooksNotifications'
import type { NewSessionHookContext } from '../hooksNotifications/newSessionBridge'
import type { AcpAgentInstanceDependencyFactory } from '@/agent/acp/instance'
import { AcpCompatibilityPromptBuilder } from '@/agent/acp/runtime'
import type { AcpViewManifestInput } from '@/agent/acp/instance/ports'
import type { DeepChatAgentInstance } from '@/agent/deepchat/instance/deepChatAgentInstance'
import { awaitWithAbort } from '@/lib/awaitWithAbort'
import { capAgentRequestMaxTokens, estimateToolReserveTokens } from './contextBudget'
import { createUserChatMessage } from './contextBuilder'
import { normalizeUserMessageInput } from './interactionProjection'
import { resolveEffectiveActiveSkillNames } from '@/agent/deepchat/resources/systemPromptBuilder'
import type { DeepChatSessionStore } from './sessionStore'
import type { DeepChatMessageStore } from './messageStore'
import type { DeepChatTapeService } from './tapeService'
import type { DeepChatToolResolver } from './toolResolver'
import {
  AcpCompatibilityProjectionAdapter,
  AcpRequestTraceAdapter
} from './acpCompatibilityAdapters'

export interface AcpCompatibilityDependencyBuilderDependencies {
  configPresenter: IConfigPresenter
  llmProviderPresenter: ILlmProviderPresenter
  sessionStore: DeepChatSessionStore
  messageStore: DeepChatMessageStore
  tapeService: DeepChatTapeService
  toolResolver: DeepChatToolResolver
  appendViewManifest(input: AcpViewManifestInput): void
  setStatus(sessionId: string, status: DeepChatSessionState['status']): void
  getSessionState(sessionId: string): Promise<DeepChatSessionState | null>
  getDeepChatInstance(sessionId: string): DeepChatAgentInstance
  getGenerationSettings(
    sessionId: string,
    instance: DeepChatAgentInstance
  ): Promise<import('@shared/types/agent-interface').SessionGenerationSettings>
  buildSystemPrompt(
    sessionId: string,
    basePrompt: string,
    tools: MCPToolDefinition[],
    activeSkillNames: string[],
    instance: DeepChatAgentInstance
  ): Promise<string>
  emitRateLimitWaitingMessage(
    sessionId: string,
    messageId: string,
    requestId: string,
    snapshot: RateLimitQueueSnapshot
  ): void
  clearRateLimitWaitingMessage(sessionId: string, messageId: string, requestId: string): void
  dispatchHook(event: HookEventName, context: NewSessionHookContext): void
}

function throwIfAbortRequested(signal?: AbortSignal): void {
  if (!signal?.aborted) return
  if (typeof DOMException !== 'undefined') {
    throw new DOMException('Aborted', 'AbortError')
  }
  const error = new Error('Aborted')
  error.name = 'AbortError'
  throw error
}

export function createAcpCompatibilityDependencies(
  dependencies: AcpCompatibilityDependencyBuilderDependencies,
  input: Parameters<AcpAgentInstanceDependencyFactory>[0]
): ReturnType<AcpAgentInstanceDependencyFactory> {
  const { runtime, session } = input
  const sessionId = session.sessionId
  const rateLimitMessageId = `rate-limit-acp:${sessionId}`
  const rateLimitRequestId = `acp:${sessionId}`
  let queuedForRateLimit = false
  const projection = new AcpCompatibilityProjectionAdapter({
    messageStore: dependencies.messageStore,
    tapeService: dependencies.tapeService,
    writeViewManifest: async (manifest) => dependencies.appendViewManifest(manifest),
    setStatus: (status) => dependencies.setStatus(sessionId, status)
  })

  return {
    promptResources: {
      resolve: async ({ content, scope, workdir, signal }) => {
        throwIfAbortRequested(signal)
        const state = await awaitWithAbort(dependencies.getSessionState(sessionId), signal)
        if (!state) throw new Error(`Session ${sessionId} not found`)
        const resourceInstance = dependencies.getDeepChatInstance(sessionId)
        resourceInstance.setAgentId(session.descriptor.id)
        resourceInstance.setProjectDir(workdir)
        const generationSettings = await awaitWithAbort(
          dependencies.getGenerationSettings(sessionId, resourceInstance),
          signal
        )
        const normalizedInput = normalizeUserMessageInput(content)
        resourceInstance.replaceRuntimeActivatedSkills(normalizedInput.activeSkills ?? [])

        let tools: MCPToolDefinition[] = []
        let systemPrompt = ''
        if (scope === 'regular') {
          const sessionSkills = await awaitWithAbort(
            dependencies.toolResolver.resolveActiveSkillNamesForToolProfile(
              sessionId,
              resourceInstance
            ),
            signal
          )
          const activeSkills = resolveEffectiveActiveSkillNames(sessionSkills, resourceInstance)
          tools = await awaitWithAbort(
            dependencies.toolResolver.loadToolDefinitionsForSession(
              sessionId,
              workdir,
              activeSkills,
              resourceInstance
            ),
            signal
          )
          systemPrompt = await awaitWithAbort(
            dependencies.buildSystemPrompt(
              sessionId,
              generationSettings.systemPrompt,
              tools,
              activeSkills,
              resourceInstance
            ),
            signal
          )
        }

        throwIfAbortRequested(signal)
        const traceEnabled =
          dependencies.configPresenter.getSetting<boolean>('traceDebugEnabled') === true
        const contextLength = Math.max(1, generationSettings.contextLength)
        const effectiveMaxTokens = capAgentRequestMaxTokens(
          generationSettings.maxTokens,
          contextLength
        )
        const summaryCursorOrderSeq =
          dependencies.sessionStore.getSummaryState(sessionId).summaryCursorOrderSeq
        return {
          latestUserMessage: createUserChatMessage(normalizedInput, false, false),
          userContent: {
            text: normalizedInput.text,
            files: normalizedInput.files ?? [],
            links: [],
            search: false,
            think: false,
            ...(normalizedInput.activeSkills?.length
              ? { activeSkills: normalizedInput.activeSkills }
              : {}),
            ...(normalizedInput.inlineItems?.length
              ? { inlineItems: normalizedInput.inlineItems }
              : {})
          },
          sections: {
            configured: systemPrompt,
            runtime: '',
            environment: '',
            skills: '',
            activeSkills: '',
            tooling: '',
            permission: '',
            verification: ''
          },
          localToolDefinitions: scope === 'regular' ? tools : [],
          requestTimeoutMs: generationSettings.timeout,
          traceEnabled,
          viewManifest: {
            taskType: 'chat',
            policy: 'legacy_context_v1',
            policyVersion: null,
            tokenBudget: {
              contextLength,
              requestedMaxTokens: generationSettings.maxTokens,
              effectiveMaxTokens,
              reserveTokens: effectiveMaxTokens,
              toolReserveTokens: estimateToolReserveTokens(tools)
            },
            summaryCursorOrderSeq,
            supportsVision: false,
            supportsAudioInput: false,
            traceDebugEnabled: traceEnabled
          }
        }
      }
    },
    promptBuilder: new AcpCompatibilityPromptBuilder(),
    projection,
    trace: new AcpRequestTraceAdapter(dependencies.messageStore),
    rateGate: {
      wait: async (signal) => {
        await dependencies.llmProviderPresenter.executeWithRateLimit('acp', {
          signal,
          scope: 'acp-direct',
          onQueued: (snapshot) => {
            queuedForRateLimit = true
            dependencies.emitRateLimitWaitingMessage(
              sessionId,
              rateLimitMessageId,
              rateLimitRequestId,
              snapshot
            )
          }
        })
      },
      clearWaiting: () => {
        if (!queuedForRateLimit) return
        dependencies.clearRateLimitWaitingMessage(sessionId, rateLimitMessageId, rateLimitRequestId)
        queuedForRateLimit = false
      }
    },
    turns: {
      startTurn: (input) => runtime.sessionPersistence.startTurn(input),
      finishTurn: (input) => runtime.sessionPersistence.finishTurn(input)
    },
    debug: {
      appendDebugEvent: (agentId, entry) => {
        runtime.processManager.appendDebugEvent(agentId, entry)
      }
    },
    observer: {
      userPromptSubmitted: (input) => {
        dependencies.dispatchHook('UserPromptSubmit', {
          sessionId: input.sessionId,
          messageId: input.messageId,
          promptPreview: input.promptPreview,
          providerId: 'acp',
          modelId: input.agentId,
          projectDir: input.workdir
        })
        dependencies.dispatchHook('SessionStart', {
          sessionId: input.sessionId,
          messageId: input.messageId,
          promptPreview: input.promptPreview,
          providerId: 'acp',
          modelId: input.agentId,
          projectDir: input.workdir
        })
      },
      terminal: (input) => {
        dependencies.dispatchHook('Stop', {
          sessionId: input.sessionId,
          providerId: 'acp',
          modelId: input.agentId,
          projectDir: input.workdir,
          stop: {
            reason: input.stopReason,
            userStop: input.status === 'aborted'
          }
        })
        dependencies.dispatchHook('SessionEnd', {
          sessionId: input.sessionId,
          providerId: 'acp',
          modelId: input.agentId,
          projectDir: input.workdir,
          error: input.errorMessage ? { message: input.errorMessage } : null
        })
      }
    }
  }
}
