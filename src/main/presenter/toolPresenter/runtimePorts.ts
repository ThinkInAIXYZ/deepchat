import type {
  IFilePresenter,
  ILlmProviderPresenter,
  IWindowPresenter,
  IYoBrowserPresenter
} from '@shared/presenter'
import type {
  DeepChatSubagentMeta,
  DeepChatSubagentSlot,
  AgentTapeContextOptions,
  AgentTapeContextResult,
  AgentTapeSearchOptions,
  AgentTapeSearchResult,
  PermissionMode,
  SendMessageInput,
  SessionGenerationSettings,
  SessionKind
} from '@shared/types/agent-interface'
import type { ISkillPresenter } from '@shared/types/skill'
import type { AgentMemoryCategory } from '@shared/types/agent-memory'
import type { DeepChatInternalSessionUpdate } from '../agentRuntimePresenter/internalSessionEvents'
import type { MemoryWriteOutcome } from '../memoryPresenter/types'
import type {
  CronJob,
  CronJobRun,
  CronJobsSchedulerStatus,
  CronSchedulePreview
} from '@shared/cronJobs'
import type { cronJobsUpsertInputSchema } from '@shared/contracts/routes/cronJobs.routes'
import type { z } from 'zod'

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
  generationSettings: SessionGenerationSettings | null
  disabledAgentTools: string[]
  activeSkills: string[]
  sessionKind: SessionKind
  parentSessionId: string | null
  subagentEnabled: boolean
  subagentMeta: DeepChatSubagentMeta | null
  availableSubagentSlots: DeepChatSubagentSlot[]
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
}

export interface AgentToolRuntimePort {
  resolveConversationWorkdir(conversationId: string): Promise<string | null>
  resolveConversationSessionInfo(conversationId: string): Promise<ConversationSessionInfo | null>
  searchTape?(
    conversationId: string,
    query: string,
    options?: AgentTapeSearchOptions
  ): Promise<AgentTapeSearchResult[]>
  getTapeContext?(
    conversationId: string,
    entryIds: number[],
    options?: AgentTapeContextOptions
  ): Promise<AgentTapeContextResult>
  /** Returns whether long-term memory is enabled for the active agent. */
  isMemoryEnabled?(agentId: string): boolean
  /** Writes a long-term memory through the shared semantic coordinator. */
  rememberMemory?(
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
  /** Recalls long-term memories related to the query. */
  recallMemory?(
    agentId: string,
    query: string
  ): Promise<Array<{ id: string; kind: string; content: string }>>
  forgetMemory?(agentId: string, memoryId: string): Promise<boolean>
  listCronJobs?(): Promise<{ jobs: CronJob[]; schedulerStatus: CronJobsSchedulerStatus }>
  upsertCronJob?(input: AgentToolCronJobUpsertInput): Promise<CronJob>
  deleteCronJob?(id: string): Promise<void>
  toggleCronJob?(id: string, enabled: boolean): Promise<CronJob>
  runCronJobNow?(id: string): Promise<CronJobRun>
  listCronJobRuns?(jobId: string, limit?: number): Promise<CronJobRun[]>
  previewCronSchedule?(input: {
    cronExpr: string
    timezone: string
    count?: number
  }): Promise<CronSchedulePreview>
  createSubagentSession(input: CreateSubagentSessionInput): Promise<ConversationSessionInfo | null>
  mergeSubagentTape?(
    parentSessionId: string,
    childSessionId: string,
    meta?: Record<string, unknown>
  ): Promise<void>
  discardSubagentTape?(
    parentSessionId: string,
    childSessionId: string,
    meta?: Record<string, unknown>
  ): Promise<void>
  sendConversationMessage(conversationId: string, content: string | SendMessageInput): Promise<void>
  cancelConversation(conversationId: string): Promise<void>
  subscribeDeepChatSessionUpdates(
    listener: (update: DeepChatInternalSessionUpdate) => void
  ): () => void
  getSkillPresenter(): ISkillPresenter
  getYoBrowserToolHandler(): IYoBrowserPresenter['toolHandler']
  getFilePresenter(): Pick<IFilePresenter, 'getMimeType' | 'prepareFileCompletely'>
  getLlmProviderPresenter(): Pick<
    ILlmProviderPresenter,
    'executeWithRateLimit' | 'generateCompletionStandalone' | 'generateImageStandalone'
  >
  cacheImage?(data: string): Promise<string>
  createSettingsWindow(): ReturnType<IWindowPresenter['createSettingsWindow']>
  sendToWindow(
    windowId: number,
    channel: string,
    ...args: unknown[]
  ): ReturnType<IWindowPresenter['sendToWindow']>
  sendSettingsNavigation(
    windowId: number,
    navigation: Parameters<IWindowPresenter['sendSettingsNavigation']>[1]
  ): ReturnType<IWindowPresenter['sendSettingsNavigation']>
  getApprovedFilePaths(
    conversationId: string,
    requiredPermission?: 'read' | 'write' | 'all'
  ): string[]
  consumeSettingsApproval(conversationId: string, toolName: string): boolean
}
