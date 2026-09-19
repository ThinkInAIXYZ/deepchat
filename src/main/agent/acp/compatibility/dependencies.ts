import type { ProviderModelResolutionPort } from '@/provider/settings'
import type { ProviderExecutionPort, RateLimitQueueSnapshot } from '@shared/types/provider'
import type { DeepChatSessionState, SessionGenerationSettings } from '@shared/types/agent-interface'
import type { MCPToolDefinition } from '@shared/types/core/mcp'
import type { RuntimeHookSink } from '@deepchat/agent-kernel/runtime/runtimeHookSink'
import type { AcpAgentInstanceDependencyFactory } from '@/agent/acp/instance'
import { AcpCompatibilityPromptBuilder } from '@/agent/acp/runtime/acpCompatibilityPromptBuilder'
import type { AcpViewManifestInput } from '@/agent/acp/instance/ports'
import { DeepChatAgentInstance } from '@deepchat/agent-kernel/instance/deepChatAgentInstance'
import { awaitWithAbort } from '@deepchat/agent-kernel/collab/lib/awaitWithAbort'
import {
  capAgentRequestMaxTokens,
  estimateToolReserveTokens
} from '@deepchat/agent-kernel/runtime/contextBudget'
import { createUserChatMessage } from '@deepchat/agent-kernel/runtime/contextBuilder'
import { resolveEffectiveActiveSkillNames } from '@deepchat/agent-kernel/resources/systemPromptBuilder'
import type { SessionSettingsStore } from '@/session/data/settings'
import type { SessionTranscript } from '@/session/data/transcript'
import type { TapeReconciliationPort } from '@deepchat/agent-kernel/tape/ports/capabilities'
import type { DeepChatToolResolver } from '@deepchat/agent-kernel/runtime/toolResolver'
import type {
  DeepChatEventPublisher,
  DeepChatSessionUpdatePublisher,
  SessionInvalidationPort
} from '@deepchat/agent-kernel/runtime/types'
import { AcpCompatibilityProjectionAdapter, AcpRequestTraceAdapter } from './adapters'
import type { AgentTraceSettingsPort } from '@/agent/traceSettings'

export interface AcpCompatibilityDependencyBuilderDependencies {
  publishEvent: DeepChatEventPublisher
  publishSessionUpdate: DeepChatSessionUpdatePublisher
  sessionInvalidationPort: SessionInvalidationPort
  providerSettings: ProviderModelResolutionPort
  traceSettings: AgentTraceSettingsPort
  providerRuntime: Pick<ProviderExecutionPort, 'executeWithRateLimit'>
  sessionStore: SessionSettingsStore
  messageStore: SessionTranscript
  tapeReconciliation: TapeReconciliationPort
  toolResolver: DeepChatToolResolver
  appendViewManifest(input: AcpViewManifestInput): void
  getSessionState(sessionId: string): Promise<DeepChatSessionState | null>
  getGenerationSettings(sessionId: string): Promise<SessionGenerationSettings | null>
  buildSystemPrompt(
    sessionId: string,
    basePrompt: string,
    tools: MCPToolDefinition[],
    activeSkillNames: string[],
    sessionActiveSkillNames: string[],
    contextLength: number,
    instance: DeepChatAgentInstance
  ): Promise<string>
  emitRateLimitWaitingMessage(
    sessionId: string,
    messageId: string,
    requestId: string,
    snapshot: RateLimitQueueSnapshot
  ): void
  clearRateLimitWaitingMessage(sessionId: string, messageId: string, requestId: string): void
  hookSink: Pick<RuntimeHookSink, 'scope'>
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
  // ACP owns its status publication; the AcpAgentInstance status is the source of truth and
  // this tracker mirrors its last forwarded state. A fresh instance starts idle, so the first
  // observed `generating` always publishes.
  let publishedStatus: 'idle' | 'generating' | 'error' = 'idle'
  const publishStatus = (status: 'idle' | 'generating' | 'error'): void => {
    if (publishedStatus === status) return
    publishedStatus = status
    dependencies.publishEvent('sessions.status.changed', {
      sessionId,
      status,
      version: Date.now()
    })
    dependencies.publishEvent('sessions.updated', {
      sessionIds: [sessionId],
      reason: 'updated'
    })
    dependencies.publishSessionUpdate({
      sessionId,
      kind: 'status',
      updatedAt: Date.now(),
      status
    })
    dependencies.sessionInvalidationPort.invalidate({
      sessionId,
      reason: 'status-changed'
    })
  }
  // ACP-owned resource instance for regular-scope tool/system-prompt assembly. It never
  // enters the built-in instance registry; its staleness fence comes from the injected ACP
  // ownership authority instead.
  const resourceInstance = new DeepChatAgentInstance(sessionId, input.ownership)
  const projection = new AcpCompatibilityProjectionAdapter({
    publishEvent: dependencies.publishEvent,
    publishSessionUpdate: dependencies.publishSessionUpdate,
    messageStore: dependencies.messageStore,
    tapeReconciliation: dependencies.tapeReconciliation,
    writeViewManifest: async (manifest) => dependencies.appendViewManifest(manifest),
    setStatus: publishStatus
  })

  return {
    promptResources: {
      resolve: async ({ content, scope, workdir, signal }) => {
        throwIfAbortRequested(signal)
        const state = await awaitWithAbort(dependencies.getSessionState(sessionId), signal)
        if (!state) throw new Error(`Session ${sessionId} not found`)
        // Carry the persisted session identity (provider/model/permission) on the resource
        // instance: downstream prompt assembly and tool-profile fingerprints read it there.
        resourceInstance.setRuntimeState(state)
        resourceInstance.setAgentId(session.descriptor.id)
        resourceInstance.setProjectDir(workdir)
        const generationSettings = await awaitWithAbort(
          dependencies.getGenerationSettings(sessionId),
          signal
        )
        if (!generationSettings) throw new Error(`Session ${sessionId} not found`)
        const runtimeActiveSkills = await awaitWithAbort(
          dependencies.toolResolver.validateSkillNamesForSession(
            sessionId,
            content.activeSkills ?? [],
            resourceInstance
          ),
          signal
        )
        resourceInstance.replaceRuntimeActivatedSkills(runtimeActiveSkills)
        const contextLength = Math.max(1, generationSettings.contextLength)

        let tools: MCPToolDefinition[] = []
        let systemPrompt = ''
        if (scope === 'regular') {
          const sessionSkills = await awaitWithAbort(
            dependencies.toolResolver.resolveActiveSkillNamesForToolProfile(sessionId),
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
              sessionSkills,
              contextLength,
              resourceInstance
            ),
            signal
          )
        }

        throwIfAbortRequested(signal)
        const traceEnabled = dependencies.traceSettings.isEnabled()
        const effectiveMaxTokens = capAgentRequestMaxTokens(
          generationSettings.maxTokens,
          contextLength
        )
        const summaryCursorOrderSeq =
          dependencies.sessionStore.getSummaryState(sessionId).summaryCursorOrderSeq
        return {
          latestUserMessage: createUserChatMessage(content, false, false),
          userContent: {
            text: content.text,
            files: content.files ?? [],
            links: [],
            search: false,
            think: false,
            ...(runtimeActiveSkills.length ? { activeSkills: runtimeActiveSkills } : {}),
            ...(content.inlineItems?.length ? { inlineItems: content.inlineItems } : {})
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
        await dependencies.providerRuntime.executeWithRateLimit('acp', {
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
        const hooks = dependencies.hookSink.scope({
          sessionId: input.sessionId,
          messageId: input.messageId,
          providerId: 'acp',
          modelId: input.agentId,
          projectDir: input.workdir
        })
        hooks.emit({ event: 'UserPromptSubmit', promptPreview: input.promptPreview })
        hooks.emit({ event: 'SessionStart', promptPreview: input.promptPreview })
      },
      terminal: (input) => {
        dependencies.hookSink
          .scope({
            sessionId: input.sessionId,
            providerId: 'acp',
            modelId: input.agentId,
            projectDir: input.workdir
          })
          .terminal({
            completed: input.status === 'completed',
            reason: input.stopReason,
            userStop: input.status === 'aborted',
            error: input.errorMessage ? { message: input.errorMessage } : null
          })
      }
    }
  }
}
