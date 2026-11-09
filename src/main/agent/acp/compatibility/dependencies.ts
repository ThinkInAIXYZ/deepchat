import type { ProviderModelResolutionPort } from '@/provider/settings'
import type { ProviderExecutionPort } from '@shared/types/provider'
import type { MCPToolDefinition } from '@shared/types/core/mcp'
import type { SkillMetadataSnapshotPort, SkillServicePort } from '@shared/types/skill'
import type { ToolServicePort } from '@shared/types/tool'
import type { AgentSettingsPort } from '@/agent/settings'
import type { PromptSettings } from '@/agent/promptSettings'
import type { AgentTraceSettingsPort } from '@/agent/traceSettings'
import type { SkillSettingsPort } from '@/skill/settings'
import type { HookObserver } from '@/hook/observer'
import type { CommandShellService } from '@/agent/shared/process/commandShellService'
import type { AcpAgentInstanceDependencyFactory } from '@/agent/acp/instance'
import { AcpCompatibilityPromptBuilder } from '@/agent/acp/runtime'
import { DeepChatAgentRuntime } from '@/agent/deepchat/instance/deepChatAgentRuntime'
import { SessionIdentityService } from '@/agent/deepchat/runtime/sessionIdentityService'
import {
  SessionStatusPublisher,
  type SessionStatusPublisherPorts
} from '@/agent/deepchat/runtime/sessionStatusPublisher'
import { DeepChatToolResolver } from '@/agent/deepchat/runtime/toolResolver'
import { RuntimeHookSink } from '@/agent/deepchat/runtime/runtimeHookSink'
import { createRateLimitBlock } from '@/agent/deepchat/runtime/echo'
import { logSlowPreStreamStep } from '@/agent/deepchat/runtime/preStreamWatchdog'
import {
  resolveSessionGenerationSettings,
  type PersistedSessionGenerationRow
} from '@/agent/shared/generationSettings'
import {
  capAgentRequestMaxTokens,
  estimateToolReserveTokens
} from '@/agent/deepchat/runtime/contextBudget'
import { createUserChatMessage } from '@/agent/deepchat/runtime/contextBuilder'
import {
  resolveEffectiveActiveSkillNames,
  buildSystemPromptWithSkills,
  type SystemPromptBuilderDependencies
} from '@/agent/deepchat/resources/systemPromptBuilder'
import type { DeepChatOutputPort } from '@/agent/deepchat/runtime/output'
import { createProviderViewManifest } from '@/tape/application/providerViewManifest'
import type {
  TapeReconciliationPort,
  TapeViewManifestReader,
  TapeViewManifestWriter
} from '@/tape/ports/capabilities'
import type { SessionResourceReadPort } from '@/session/data/contracts'
import type { SessionSettingsStore } from '@/session/data/settings'
import type { SessionTranscript } from '@/session/data/transcript'
import { awaitWithAbort } from '@/lib/awaitWithAbort'
import { AcpCompatibilityProjectionAdapter, AcpRequestTraceAdapter } from './adapters'

export interface AcpCompatibilityHostDependencies {
  output: DeepChatOutputPort
  publishStatus: SessionStatusPublisherPorts['publishStatus']
  providerSettings: ProviderModelResolutionPort
  promptSettings: Pick<PromptSettings, 'getDefaultSystemPrompt'>
  traceSettings: AgentTraceSettingsPort
  providerRuntime: Pick<ProviderExecutionPort, 'executeWithRateLimit'>
  sessionStore: Pick<SessionSettingsStore, 'get' | 'getSummaryState'> & SessionResourceReadPort
  messageStore: SessionTranscript
  tape: TapeReconciliationPort & TapeViewManifestReader & TapeViewManifestWriter
  agentSettings: AgentSettingsPort
  skillSettings: SkillSettingsPort
  skillService: SkillServicePort & SkillMetadataSnapshotPort
  toolService: ToolServicePort
  providerCatalogPort: SystemPromptBuilderDependencies['providerCatalogPort']
  commandShell: Pick<CommandShellService, 'resolveForTurn'>
  hookObserver: HookObserver
  onSessionCompleted?: (sessionId: string) => void
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
  dependencies: AcpCompatibilityHostDependencies,
  input: Parameters<AcpAgentInstanceDependencyFactory>[0]
): ReturnType<AcpAgentInstanceDependencyFactory> {
  const { runtime, session } = input
  const sessionId = session.sessionId
  const registry = new DeepChatAgentRuntime()
  const scope = registry.getOrHydrateScope(session.sessionId)
  const resourceInstance = scope.instance
  const identity = new SessionIdentityService({ registry, sessions: dependencies.sessionStore })
  const toolResolver = new DeepChatToolResolver({
    ...dependencies,
    registry,
    identity,
    sessions: dependencies.sessionStore
  })
  const statusPublisher = new SessionStatusPublisher({ publishStatus: dependencies.publishStatus })
  const persisted = dependencies.sessionStore.get(sessionId)
  if (persisted)
    resourceInstance.setRuntimeState({
      status: 'idle',
      providerId: persisted.provider_id,
      modelId: persisted.model_id,
      permissionMode: persisted.permission_mode
    })
  resourceInstance.setAgentId(session.descriptor.id)
  resourceInstance.setProjectDir(session.workdir)
  const resolveProjectDir = (_sessionId: string, incoming: string | null | undefined) =>
    incoming === undefined ? resourceInstance.getProjectDir() : incoming?.trim() || null
  const hookSink = new RuntimeHookSink({
    observer: dependencies.hookObserver,
    identity,
    sessionSettings: { resolveProjectDir },
    onSessionCompleted: dependencies.onSessionCompleted
  })
  const promptDependencies: SystemPromptBuilderDependencies = {
    ...dependencies,
    assertCurrent: () => scope.assertCurrent(),
    isAcpBackedSubagentSession: (id, providerId) =>
      identity.isAcpBackedSubagentSession(id, providerId),
    resolveProjectDir,
    logSlowStep: logSlowPreStreamStep
  }
  const rateLimitMessageId = `rate-limit-acp:${sessionId}`
  const rateLimitRequestId = `acp:${sessionId}`
  let rateLimitRevision = 0
  const publishRateLimit = (
    blocks: import('@shared/types/agent-interface').AssistantMessageBlock[]
  ) =>
    dependencies.output.streamSnapshot({
      kind: 'snapshot',
      requestId: rateLimitRequestId,
      sessionId,
      messageId: rateLimitMessageId,
      updatedAt: Date.now(),
      revision: ++rateLimitRevision,
      blocks
    })
  let queuedForRateLimit = false
  const projection = new AcpCompatibilityProjectionAdapter({
    output: dependencies.output,
    messageStore: dependencies.messageStore,
    tapeReconciliation: dependencies.tape,
    writeViewManifest: async (manifest) =>
      dependencies.tape.appendViewManifest(
        createProviderViewManifest(dependencies.tape, {
          ...manifest,
          tools: manifest.localToolDefinitions,
          contextBuilderVersion: 'legacy-v1'
        })
      ),
    setStatus: (status) => {
      statusPublisher.transition(scope, status)
    }
  })

  return {
    promptResources: {
      resolve: async ({ content, scope, workdir, signal }) => {
        throwIfAbortRequested(signal)
        const state = dependencies.sessionStore.get(sessionId)
        if (!state) throw new Error(`Session ${sessionId} not found`)
        resourceInstance.setRuntimeState({
          status: resourceInstance.getRuntimeState()?.status ?? 'idle',
          providerId: state.provider_id,
          modelId: state.model_id,
          permissionMode: state.permission_mode
        })
        resourceInstance.invalidateToolProfileCache()
        resourceInstance.setAgentId(session.descriptor.id)
        resourceInstance.setProjectDir(workdir)
        const generationSettings = await awaitWithAbort(
          resolveSessionGenerationSettings(
            {
              providerSettings: dependencies.providerSettings,
              promptSettings: dependencies.promptSettings,
              readPersisted: () =>
                dependencies.sessionStore.get(sessionId) as
                  | PersistedSessionGenerationRow
                  | undefined
            },
            sessionId
          ),
          signal
        )
        const runtimeActiveSkills = await awaitWithAbort(
          toolResolver.validateSkillNamesForSession(
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
            toolResolver.resolveActiveSkillNamesForToolProfile(sessionId),
            signal
          )
          const activeSkills = resolveEffectiveActiveSkillNames(sessionSkills, resourceInstance)
          tools = await awaitWithAbort(
            toolResolver.loadToolDefinitionsForSession(
              sessionId,
              workdir,
              activeSkills,
              resourceInstance
            ),
            signal
          )
          systemPrompt = await awaitWithAbort(
            buildSystemPromptWithSkills(promptDependencies, {
              sessionId,
              basePrompt: generationSettings.systemPrompt,
              toolDefinitions: tools,
              activeSkillNamesOverride: activeSkills,
              sessionActiveSkillNamesOverride: sessionSkills,
              contextLength,
              resourceInstance,
              orchestrationPolicy: toolResolver.resolveOrchestrationPolicy(sessionId),
              commandShell: await dependencies.commandShell.resolveForTurn()
            }),
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
            publishRateLimit([createRateLimitBlock(snapshot)])
          }
        })
      },
      clearWaiting: () => {
        if (!queuedForRateLimit) return
        publishRateLimit([])
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
        const hooks = hookSink.scope({
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
        hookSink
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
