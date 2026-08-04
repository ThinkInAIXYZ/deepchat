import type { FileServicePort } from '@shared/types/file'
import type { ProviderRuntimePort } from '@shared/types/provider'
import type { MCPToolDefinition } from '@shared/types/mcp'
import type { SettingsNavigationPayload } from '@shared/settingsNavigation'
import type {
  DeepChatSubagentMeta,
  DeepChatSubagentCapability,
  AgentTapeContextOptions,
  AgentTapeContextResult,
  AgentTapeSearchOptions,
  AgentTapeSearchResult,
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
import type {
  LiveDelegationDetail,
  LiveDelegationEventSummary,
  LiveDelegationResultPage,
  LiveDelegationSummary
} from '@shared/orchestration/liveDelegation'
import type { AgentInvocationAdmissionPort } from '@/agent/invocationAdmission'
import type { SkillServicePort } from '@shared/types/skill'
import type { AgentMemoryCategory } from '@shared/types/agent-memory'
import type { MemoryCommandResult } from '@shared/contracts/routes/memory.routes'
import type { SessionRuntimeUpdate } from '@/session/runtimeEvents'
import type { MemoryScopeContext, MemoryWriteOutcome } from '../memory/types'
import type {
  CronJob,
  CronJobRun,
  CronJobsSchedulerStatus,
  CronSchedulePreview
} from '@shared/cronJobs'
import type { cronJobsUpsertInputSchema } from '@shared/contracts/routes/cronJobs.routes'
import type { z } from 'zod'
import type { LiveDelegationConsentReceipt } from '@/orchestration/liveDelegationConsent'

export type AgentToolCronJobUpsertInput = z.input<typeof cronJobsUpsertInputSchema>

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
  generationSettings: SessionGenerationSettings | null
  disabledAgentTools: string[]
  activeSkills: string[]
  sessionKind: SessionKind
  parentSessionId: string | null
  subagentMeta: DeepChatSubagentMeta | null
  subagentCapability: DeepChatSubagentCapability
  status: SessionStatus
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
  generationSettings?: Partial<SessionGenerationSettings>
  disabledAgentTools?: string[]
  activeSkills?: string[]
  liveDelegationContext?: LiveDelegationSubagentContext
}

export interface AgentToolSessionPort {
  resolveConversationWorkdir(conversationId: string): Promise<string | null>
  resolveConversationSessionInfo(conversationId: string): Promise<ConversationSessionInfo | null>
}

export interface AgentTapeToolPort {
  searchTape(
    conversationId: string,
    query: string,
    options?: AgentTapeSearchOptions
  ): Promise<AgentTapeSearchResult[]>
  getTapeContext(
    conversationId: string,
    entryIds: number[],
    options?: AgentTapeContextOptions
  ): Promise<AgentTapeContextResult>
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
    model?: { providerId: string; modelId: string } | null
  ): Promise<MemoryWriteOutcome>
  recallMemory(
    agentId: string,
    query: string,
    scopeContext?: MemoryScopeContext
  ): Promise<Array<{ id: string; kind: string; content: string }>>
  forgetMemory(agentId: string, memoryId: string): Promise<MemoryCommandResult>
}

export interface AgentCronJobToolPort {
  listCronJobs(): Promise<{ jobs: CronJob[]; schedulerStatus: CronJobsSchedulerStatus }>
  upsertCronJob(input: AgentToolCronJobUpsertInput): Promise<CronJob>
  deleteCronJob(id: string): Promise<void>
  toggleCronJob(id: string, enabled: boolean): Promise<CronJob>
  runCronJobNow(id: string): Promise<CronJobRun>
  listCronJobRuns(jobId: string, limit?: number): Promise<CronJobRun[]>
  previewCronSchedule(input: {
    cronExpr: string
    timezone: string
    count?: number
  }): Promise<CronSchedulePreview>
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
    authorization?: LiveDelegationStartAuthorization
  ): Promise<LiveDelegationDetail>
  send(parentSessionId: string, delegationId: string, message: string): LiveDelegationDetail
  followUp(
    parentSessionId: string,
    delegationId: string,
    task: string,
    authorization?: LiveDelegationStartAuthorization
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
  interrupt(parentSessionId: string, delegationId: string): Promise<LiveDelegationDetail>
}

export interface AgentBrowserToolPort {
  getToolDefinitions(): MCPToolDefinition[]
  callTool(
    toolName: string,
    args: Record<string, unknown>,
    conversationId?: string,
    runId?: string
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
    requiredPermission?: 'read' | 'write' | 'all'
  ): string[]
  consumeSettingsApproval(conversationId: string, toolName: string): boolean
}

export interface AgentToolDependencies {
  sessions: AgentToolSessionPort
  tape: AgentTapeToolPort
  memory: AgentMemoryToolPort
  cronJobs: AgentCronJobToolPort
  subagents: AgentSubagentToolPort
  liveDelegation?: AgentLiveDelegationToolPort
  agentInvocationAdmission: AgentInvocationAdmissionPort
  skills: SkillServicePort
  browser: AgentBrowserToolPort
  files: AgentFileToolPort
  provider: AgentProviderToolPort
  desktop: AgentDesktopToolPort
  permissions: AgentToolPermissionPort
  cacheImage(data: string): Promise<string>
}
