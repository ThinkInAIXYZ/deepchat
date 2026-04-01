import type {
  IFilePresenter,
  ILlmProviderPresenter,
  IWindowPresenter,
  IYoBrowserPresenter
} from '@shared/presenter'
import type {
  DeepChatSubagentMeta,
  DeepChatSubagentSlot,
  PermissionMode,
  SendMessageInput,
  SessionGenerationSettings,
  SessionKind
} from '@shared/types/agent-interface'
import type { ISkillPresenter } from '@shared/types/skill'
import type { DeepChatInternalSessionUpdate } from '../deepchatAgentPresenter/internalSessionEvents'

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
  createSubagentSession(input: CreateSubagentSessionInput): Promise<ConversationSessionInfo | null>
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
    'executeWithRateLimit' | 'generateCompletionStandalone'
  >
  createSettingsWindow(): ReturnType<IWindowPresenter['createSettingsWindow']>
  sendToWindow(
    windowId: number,
    channel: string,
    ...args: unknown[]
  ): ReturnType<IWindowPresenter['sendToWindow']>
  getApprovedFilePaths(conversationId: string): string[]
  consumeSettingsApproval(conversationId: string, toolName: string): boolean
}
