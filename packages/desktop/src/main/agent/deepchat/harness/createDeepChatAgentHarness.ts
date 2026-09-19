import type { AcpAgentInstanceDependencyFactory } from '@/agent/acp/instance'
import { createAcpCompatibilityDependencies } from '@/agent/acp/compatibility/dependencies'
import { resolveSessionVisionTarget } from '@/agent/vision/sessionVisionResolver'
import {
  cacheToolCallImagePreviews,
  extractToolCallImagePreviews
} from '@/lib/toolCallImagePreviews'
import { AcpSessionStateAdapter } from '@/agent/acp/instance/acpSessionStateAdapter'
import { createDeepChatRuntimeServices } from '@deepchat/agent-kernel/composition/createDeepChatRuntimeServices'
import { ProgrammaticToolParentRegistry } from '@/cli/programmaticToolParentRegistry'
import { DeepChatAgentHarness } from './deepChatAgentHarness'
import type { DeepChatHarnessDependencies } from './runtimeServices'

/**
 * Single composition root for the DeepChat agent runtime. The kernel owner graph comes from the
 * workspace package; this host facade injects the Desktop-owned collaborators (vision resolution,
 * image previews, programmatic tool parents) and assembles the ACP compatibility factory over
 * kernel-exposed owners.
 */
export function createDeepChatAgentHarness(
  deps: DeepChatHarnessDependencies
): DeepChatAgentHarness {
  const sessionStore = deps.sessionData.settings
  const messageStore = deps.sessionData.transcript
  const tapeService = deps.sessionData.tapeStore

  const services = createDeepChatRuntimeServices({
    ...deps,
    visionTargetResolver: { resolveSessionVisionTarget },
    imagePreviews: { cacheToolCallImagePreviews, extractToolCallImagePreviews },
    programmaticToolParents:
      deps.programmaticToolParents ??
      new ProgrammaticToolParentRegistry({
        tokenAuthority: deps.agentCliTokenAuthority,
        executionJournal: deps.sessionData.programmaticExecutionJournal
      })
  })

  // ACP state seam over the host session settings store; the compatibility factory reads
  // session existence and generation settings through it without touching built-in scope.
  const acpSessionState = new AcpSessionStateAdapter(
    sessionStore,
    deps.providerSettings,
    deps.promptSettings
  )
  const acpCompatibility: AcpAgentInstanceDependencyFactory = (input) =>
    createAcpCompatibilityDependencies(
      {
        publishEvent: deps.publishEvent,
        publishSessionUpdate: deps.publishSessionUpdate,
        sessionInvalidationPort: deps.sessionInvalidationPort,
        providerSettings: deps.providerSettings,
        traceSettings: deps.traceSettings,
        providerRuntime: deps.providerRuntime,
        sessionStore,
        messageStore,
        tapeReconciliation: tapeService,
        toolResolver: services.toolResolver,
        appendViewManifest: (manifest) =>
          services.loopRunner.commitTapeProviderView({
            sessionId: manifest.sessionId,
            messageId: manifest.messageId,
            requestSeq: manifest.requestSeq,
            taskType: manifest.taskType,
            policy: manifest.policy,
            policyVersion: manifest.policyVersion,
            contextBuilderVersion: 'legacy-v1',
            messages: manifest.messages,
            tools: manifest.localToolDefinitions,
            tokenBudget: manifest.tokenBudget,
            providerId: manifest.providerId,
            modelId: manifest.modelId,
            summaryCursorOrderSeq: manifest.summaryCursorOrderSeq,
            supportsVision: manifest.supportsVision,
            supportsAudioInput: manifest.supportsAudioInput,
            traceDebugEnabled: manifest.traceDebugEnabled,
            programmaticToolCapability: null
          }),
        // Neutral 2C reads: the adapter touches only the persisted session settings store, so
        // the ACP path never hydrates built-in scope or fences through sessionSettingsCoordinator.
        getSessionState: async (sessionId) => await acpSessionState.getSessionState(sessionId),
        getGenerationSettings: async (sessionId) =>
          await acpSessionState.getGenerationSettings(sessionId),
        buildSystemPrompt: async (
          sessionId,
          basePrompt,
          tools,
          activeSkills,
          sessionActiveSkills,
          contextLength,
          instance
        ) =>
          await services.promptAssembly.build(
            sessionId,
            basePrompt,
            tools,
            await deps.commandShell.resolveForTurn(),
            activeSkills,
            instance,
            {
              sessionActiveSkillNamesOverride: sessionActiveSkills,
              contextLength
            }
          ),
        emitRateLimitWaitingMessage: (sessionId, messageId, requestId, snapshot) =>
          services.loopRunner.emitRateLimitWaitingMessage(
            sessionId,
            messageId,
            requestId,
            snapshot
          ),
        clearRateLimitWaitingMessage: (sessionId, messageId, requestId) =>
          services.loopRunner.clearRateLimitWaitingMessage(sessionId, messageId, requestId),
        hookSink: services.hookSink
      },
      input
    )

  return new DeepChatAgentHarness({ ...services, acpCompatibility })
}
