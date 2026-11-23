import type { FileServicePort } from '@shared/types/file'
import type { ProviderRuntimePort } from '@shared/types/provider'
import type { MCPToolDefinition } from '@shared/types/mcp'
import type { SettingsNavigationPayload } from '@shared/settingsNavigation'
import type {
  DeepChatSubagentMeta,
  DeepChatSubagentCapability,
  PermissionMode,
  SendMessageInput,
  SessionGenerationSettings,
  SessionStatus,
  SessionKind,
  SubagentTapeLinkInput,
  SubagentTapeLinkReceipt
} from '@shared/types/agent-interface'
import type { LiveDelegationSubagentContext } from '@shared/orchestration/liveDelegation'
import type { OrchestrationPolicy } from '@shared/orchestration/policy'
import type { ToolModeOverride } from '@shared/toolMode'
import type {
  LiveDelegationDetail,
  LiveDelegationEventSummary,
  LiveDelegationResultPage,
  LiveDelegationSummary
} from '@shared/orchestration/liveDelegation'
import type { AgentInvocationAdmissionPort } from '@/agent/invocationAdmission'
import type { SkillServicePort } from '@shared/types/skill'
import type { CacheImageOptions } from '@/platform/imageCache'
import type { AgentMemoryCategory } from '@shared/types/agent-memory'
import type { MemoryCommandResult } from '@shared/contracts/routes/memory.routes'
import type { SessionRuntimeUpdate } from '@/session/runtimeEvents'
import type { SkillExecutionAuthorityPort } from '@/skill/skillExecutionAuthority'
import type { MemoryScopeContext, MemoryWriteOutcome } from '../memory/types'
import type { LiveDelegationConsentReceipt } from '@/orchestration/liveDelegationConsent'
import type { ReadSessionInput } from '@shared/sessionReferences'

export interface ConversationSessionInfo {
  sessionId: string
  agentId: string
  agentName: string
  agentType: 'deepchat' | 'acp' | null
  providerId: string
  modelId: string
  projectDir: string | null
  permissionMode: PermissionMode
  orchestrationPolicy: OrchestrationPolicy
  toolModeOverride: ToolModeOverride
  generationSettings: SessionGenerationSettings | null
  disabledAgentTools: string[]
  activeSkills: string[]
  sessionKind: SessionKind
  parentSessionId: string | null
  subagentMeta: DeepChatSubagentMeta | null
  subagentCapability: DeepChatSubagentCapability
  status: SessionStatus
}

export interface ConversationExecutionAuthority {
  sessionId: string
  agentId: string
  projectDir: string | null
  sessionKind: SessionKind
  disabledAgentTools: string[]
  enabledMcpServerIds?: string[] | null
  subagentCapability: DeepChatSubagentCapability
}

export interface CreateSubagentSessionInput {
  parentSessionId: string
  agentId: string
  parentAgentId?: string | null
  slotId: string
  displayName: string
  targetAgentId?: string | null
  projectDir?: string | null
  providerId: string
  modelId: string
  permissionMode: PermissionMode
  toolModeOverride?: ToolModeOverride
  generationSettings?: Partial<SessionGenerationSettings>
  disabledAgentTools?: string[]
  activeSkills?: string[]
  liveDelegationContext?: LiveDelegationSubagentContext
  preserveExecutionConfig?: boolean
}

export interface AgentToolSessionPort {
  resolveConversationWorkdir(conversationId: string): Promise<string | null>
  resolveConversationSessionInfo(conversationId: string): Promise<ConversationSessionInfo | null>
  resolveConversationExecutionAuthorityNow(
    conversationId: string
  ): ConversationExecutionAuthority | null
  resolveConversationExecutionAuthority(
    conversationId: string
  ): Promise<ConversationExecutionAuthority | null>
}

export interface AgentMemoryToolPort {
  isMemoryEnabled(agentId: string): boolean
  rememberMemory(
    agentId: string,
    input: {
      content: string
      kind: 'semantic' | 'episodic'
      category?: AgentMemoryCategory | null
      importance?: number
    },
    sourceSession?: string | null,
    model?: { providerId: string; modelId: string } | null,
    beforeMutation?: () => void
  ): Promise<MemoryWriteOutcome>
  recallMemory(
    agentId: string,
    query: string,
    scopeContext?: MemoryScopeContext
  ): Promise<Array<{ id: string; kind: string; content: string }>>
  forgetMemory(
    agentId: string,
    memoryId: string,
    beforeMutation?: () => void
  ): Promise<MemoryCommandResult>
}

export interface AgentSubagentToolPort {
  createSubagentSession(input: CreateSubagentSessionInput): Promise<ConversationSessionInfo | null>
  linkSubagentTape(input: SubagentTapeLinkInput): Promise<SubagentTapeLinkReceipt>
  sendConversationMessage(conversationId: string, content: string | SendMessageInput): Promise<void>
  cancelConversation(conversationId: string): Promise<void>
  subscribeSessionRuntimeUpdates(listener: (update: SessionRuntimeUpdate) => void): () => void
}

export type LiveDelegationStartAuthorization = LiveDelegationConsentReceipt

export interface AgentLiveDelegationToolPort {
  spawn(
    parentSessionId: string,
    input: { slotId: string; title: string; prompt: string },
    authorization?: LiveDelegationStartAuthorization,
    beforeMutation?: () => void
  ): Promise<LiveDelegationDetail>
  send(
    parentSessionId: string,
    delegationId: string,
    message: string,
    beforeMutation?: () => void
  ): LiveDelegationDetail
  followUp(
    parentSessionId: string,
    delegationId: string,
    task: string,
    authorization?: LiveDelegationStartAuthorization,
    beforeMutation?: () => void
  ): Promise<LiveDelegationDetail>
  list(parentSessionId: string, limit?: number): LiveDelegationSummary[]
  inspect(parentSessionId: string, delegationId: string): LiveDelegationDetail
  readResult(
    parentSessionId: string,
    delegationId: string,
    options?: { turnId?: string; cursor?: string; maxTokens?: number }
  ): Promise<LiveDelegationResultPage>
  wait(
    parentSessionId: string,
    options?: {
      after?: number
      timeoutMs?: number
      delegationIds?: string[]
      signal?: AbortSignal
    }
  ): Promise<{ events: LiveDelegationEventSummary[]; cursor: number; timedOut: boolean }>
  interrupt(
    parentSessionId: string,
    delegationId: string,
    beforeMutation?: () => void
  ): Promise<LiveDelegationDetail>
}

export interface AgentBrowserToolPort {
  getToolDefinitions(): MCPToolDefinition[]
  callTool(
    toolName: string,
    args: Record<string, unknown>,
    conversationId?: string,
    runId?: string,
    beforeInvoke?: (normalizedArguments: Record<string, unknown>) => void,
    signal?: AbortSignal
  ): Promise<string>
}

export type AgentFileToolPort = Pick<FileServicePort, 'getMimeType' | 'prepareFileCompletely'>

export type AgentProviderToolPort = Pick<
  ProviderRuntimePort,
  'executeWithRateLimit' | 'generateCompletionStandalone' | 'generateImageStandalone'
>

export interface AgentDesktopToolPort {
  createSettingsWindow(): Promise<number | null>
  sendToWindow(windowId: number, channel: string, ...args: unknown[]): boolean
  sendSettingsNavigation(windowId: number, navigation: SettingsNavigationPayload): boolean
}

export interface AgentDisplaySettingsPort {
  getCopyWithCotEnabled(): boolean
  setCopyWithCotEnabled(enabled: boolean): void
  getRequestedLanguage(): string
  setLanguage(language: string): void
  getTheme(): 'system' | 'light' | 'dark'
  setTheme(theme: 'system' | 'light' | 'dark'): void
  getFontSizeLevel(): number
  setFontSizeLevel(level: number): void
}

export interface AgentToolPermissionPort {
  getApprovedFilePaths(
    conversationId: string,
    requiredPermission?: 'read' | 'write' | 'all',
    provisionalLeaseId?: string
  ): string[]
  consumeSettingsApproval(
    conversationId: string,
    toolName: string,
    provisionalLeaseId?: string
  ): boolean
}

export interface AgentHtmlRenderPanelPort {
  /** Persisted bytes of the shell and the latest version of each section; null when the session has no such panel. */
  measurePanel(
    conversationId: string,
    panelId: string
  ):
    | { shellBytes: number; sectionBytes: ReadonlyMap<string, number> }
    | null
    | Promise<{ shellBytes: number; sectionBytes: ReadonlyMap<string, number> } | null>
}

export interface AgentToolDependencies {
  sessions: AgentToolSessionPort
  memory: AgentMemoryToolPort
  subagents: AgentSubagentToolPort
  liveDelegation?: AgentLiveDelegationToolPort
  htmlRenderPanels?: AgentHtmlRenderPanelPort
  agentInvocationAdmission: AgentInvocationAdmissionPort
  skills: SkillServicePort
  skillExecutionAuthority: SkillExecutionAuthorityPort
  browser: AgentBrowserToolPort
  files: AgentFileToolPort
  provider: AgentProviderToolPort
  desktop: AgentDesktopToolPort
  permissions: AgentToolPermissionPort
  readSession(callerSessionId: string, input: ReadSessionInput): Promise<unknown>
  cacheImage(data: string, options?: CacheImageOptions): Promise<string>
}
