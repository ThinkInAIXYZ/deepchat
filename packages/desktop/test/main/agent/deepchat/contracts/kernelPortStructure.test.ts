import { describe, expectTypeOf, it } from 'vitest'
import type { AgentSettings } from '@/agent/settings'
import type { AgentTraceSettings } from '@/agent/traceSettings'
import type { PromptSettings } from '@/agent/promptSettings'
import type { ProgrammaticToolParentRegistry } from '@/cli/programmaticToolParentRegistry'
import type { AgentCliTokenAuthority } from '@/cli/agentTokenAuthority'
import type { AttachmentCapabilityRouter } from '@/ocr/attachmentCapabilityRouter'
import type { ProviderSettings } from '@/provider/settings'
import type { SkillSettings } from '@/skill/settings'
import type { SessionPermissionPort } from '@/session/contracts'
import type { SessionDatabase } from '@/session/data/database'
import type { SessionPendingInputs } from '@/session/data/pendingInputs'
import type { SessionSettingsStore } from '@/session/data/settings'
import type { SessionTranscript } from '@/session/data/transcript'
import type { DeepChatSessionsTable } from '@/session/data/tables/deepchatSessions'
import type { NewSessionsTable } from '@/session/data/tables/newSessions'
import type { SessionTape } from '@/tape/application/sessionTape'
import type { CommandShellService } from '@/agent/shared/process/commandShellService'
import type {
  cacheToolCallImagePreviews,
  extractToolCallImagePreviews
} from '@/lib/toolCallImagePreviews'
import type { resolveSessionVisionTarget } from '@/agent/vision/sessionVisionResolver'
import type { AgentSettingsPort } from '@deepchat/agent-kernel/contracts/agentSettings'
import type { AgentTraceSettingsPort } from '@deepchat/agent-kernel/contracts/agentTraceSettings'
import type { AttachmentPreparationPort } from '@deepchat/agent-kernel/contracts/attachmentPreparation'
import type { PromptSettingsPort } from '@deepchat/agent-kernel/contracts/promptSettings'
import type {
  ProgrammaticGrantAuthorityPort,
  ProgrammaticToolAuthorityPort
} from '@deepchat/agent-kernel/contracts/programmaticToolAuthority'
import type { CommandShellResolutionPort } from '@deepchat/agent-kernel/contracts/commandShellResolution'
import type {
  CacheImageOptions,
  ToolImagePreviewPort
} from '@deepchat/agent-kernel/contracts/imagePreview'
import type { MemoryCursorStorePort } from '@deepchat/agent-kernel/contracts/memoryCursorStore'
import type { PendingInputStorePort } from '@deepchat/agent-kernel/contracts/pendingInputStore'
import type { ProviderModelResolutionPort } from '@deepchat/agent-kernel/contracts/providerModelResolution'
import type {
  SessionAgentRowPort,
  SessionAgentRowStorePort
} from '@deepchat/agent-kernel/contracts/sessionAgentRow'
import type { SessionSettingsStorePort } from '@deepchat/agent-kernel/contracts/sessionSettingsStore'
import type { SkillSettingsPort } from '@deepchat/agent-kernel/contracts/skillSettings'
import type { TapeStorePort } from '@deepchat/agent-kernel/contracts/tapeStore'
import type { TranscriptStorePort } from '@deepchat/agent-kernel/contracts/transcriptStore'
import type { VisionTargetResolverPort } from '@deepchat/agent-kernel/contracts/visionTarget'
import type { DeepChatHarnessDependencies } from '@/agent/deepchat/harness/runtimeServices'
import type { DeepChatKernelDependencies } from '@deepchat/agent-kernel/composition/createDeepChatRuntimeServices'

/**
 * Type-level regression net for Stage 2B-1: the host classes stay structurally compatible with
 * the kernel's named ports. If a host method drifts away from a port, this suite fails before any
 * runtime wiring does.
 */
describe('kernel port structural compatibility', () => {
  it('keeps the host transcript store satisfying TranscriptStorePort', () => {
    expectTypeOf<SessionTranscript>().toMatchTypeOf<TranscriptStorePort>()
  })

  it('keeps the host settings store satisfying SessionSettingsStorePort', () => {
    expectTypeOf<SessionSettingsStore>().toMatchTypeOf<SessionSettingsStorePort>()
  })

  it('keeps the host pending-input store satisfying PendingInputStorePort', () => {
    expectTypeOf<SessionPendingInputs>().toMatchTypeOf<PendingInputStorePort>()
  })

  it('keeps the composed tape facade satisfying TapeStorePort', () => {
    expectTypeOf<SessionTape>().toMatchTypeOf<TapeStorePort>()
  })

  it('keeps the session database satisfying the session-agent row projection port', () => {
    expectTypeOf<SessionDatabase>().toMatchTypeOf<SessionAgentRowPort>()
    expectTypeOf<NewSessionsTable>().toMatchTypeOf<SessionAgentRowStorePort>()
  })

  it('keeps the deepchat sessions table satisfying MemoryCursorStorePort', () => {
    expectTypeOf<DeepChatSessionsTable>().toMatchTypeOf<MemoryCursorStorePort>()
  })

  it('keeps the host settings services satisfying their kernel ports', () => {
    expectTypeOf<ProviderSettings>().toMatchTypeOf<ProviderModelResolutionPort>()
    expectTypeOf<AgentSettings>().toMatchTypeOf<AgentSettingsPort>()
    expectTypeOf<AgentTraceSettings>().toMatchTypeOf<AgentTraceSettingsPort>()
    expectTypeOf<PromptSettings>().toMatchTypeOf<PromptSettingsPort>()
    expectTypeOf<SkillSettings>().toMatchTypeOf<SkillSettingsPort>()
  })

  it('keeps the host permission authority satisfying SessionPermissionPort', () => {
    expectTypeOf<SessionPermissionPort>().toMatchTypeOf<
      import('@deepchat/agent-kernel/contracts/sessionPermission').SessionPermissionPort
    >()
  })

  it('keeps the host image preview helpers satisfying ToolImagePreviewPort', () => {
    expectTypeOf<{
      cacheToolCallImagePreviews: typeof cacheToolCallImagePreviews
      extractToolCallImagePreviews: typeof extractToolCallImagePreviews
    }>().toMatchTypeOf<ToolImagePreviewPort>()
    expectTypeOf<CacheImageOptions>().not.toBeNever()
  })

  it('keeps the host vision resolver satisfying VisionTargetResolverPort', () => {
    expectTypeOf<{
      resolveSessionVisionTarget: typeof resolveSessionVisionTarget
    }>().toMatchTypeOf<VisionTargetResolverPort>()
  })

  it('keeps the host attachment router satisfying AttachmentPreparationPort', () => {
    expectTypeOf<AttachmentCapabilityRouter>().toMatchTypeOf<AttachmentPreparationPort>()
  })

  it('keeps the host command shell service satisfying CommandShellResolutionPort', () => {
    expectTypeOf<CommandShellService>().toMatchTypeOf<CommandShellResolutionPort>()
  })

  it('keeps the host programmatic authorities satisfying their kernel ports', () => {
    expectTypeOf<ProgrammaticToolParentRegistry>().toMatchTypeOf<ProgrammaticToolAuthorityPort>()
    expectTypeOf<AgentCliTokenAuthority>().toMatchTypeOf<ProgrammaticGrantAuthorityPort>()
  })

  it('keeps the host harness dependencies satisfying the kernel composition dependencies', () => {
    // The host facade passes its dependency object into the package composition with only the
    // three Desktop-owned injections added; every host-provided service must therefore satisfy
    // the kernel dependency port structurally, or the Desktop embedding stops typechecking.
    type KernelDepsWithoutInjections = Omit<
      DeepChatKernelDependencies,
      'visionTargetResolver' | 'imagePreviews' | 'programmaticToolParents'
    >
    type HostDepsWithoutInjections = Omit<
      DeepChatHarnessDependencies,
      'visionTargetResolver' | 'imagePreviews' | 'programmaticToolParents'
    >
    // A plain conditional keeps this free of expectTypeOf branding: the alias only resolves to
    // 'satisfied' when every host-provided dependency structurally extends its kernel port.
    type HostDepsSatisfyKernelDeps = HostDepsWithoutInjections extends KernelDepsWithoutInjections
      ? 'satisfied'
      : never
    expectTypeOf<HostDepsSatisfyKernelDeps>().toEqualTypeOf<'satisfied'>()
  })
})
