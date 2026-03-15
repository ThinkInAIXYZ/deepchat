import type {
  IFilePresenter,
  ILlmProviderPresenter,
  IMCPPresenter,
  IWindowPresenter,
  IYoBrowserPresenter
} from '@shared/presenter'
import type { ISkillPresenter, SkillContent } from '@shared/types/skill'

export interface AgentMcpRuntimePort {
  callTool: IMCPPresenter['callTool']
  grantPermission: IMCPPresenter['grantPermission']
  isServerRunning: IMCPPresenter['isServerRunning']
}

export interface AgentPromptRuntimePort {
  getInputChatMode(): Promise<string | undefined>
  getSkillsEnabled(): boolean
  getActiveSkills(conversationId: string): Promise<string[]>
  loadSkillContent(name: string): Promise<SkillContent | null>
  getMetadataPrompt(): Promise<string>
  getActiveSkillsAllowedTools(conversationId: string): Promise<string[]>
}

export interface AgentPermissionRuntimePort {
  approveFileAccess?(conversationId: string, paths: string[], remember: boolean): void
  getApprovedFilePaths?(conversationId: string): string[]
  approveSettingsAccess?(conversationId: string, toolName: string, remember: boolean): void
  consumeSettingsApproval?(conversationId: string, toolName: string): boolean
}

export interface AgentToolRuntimePort {
  resolveConversationWorkdir(conversationId: string): Promise<string | null>
  getSkillPresenter(): ISkillPresenter
  getYoBrowserToolHandler(): IYoBrowserPresenter['toolHandler']
  getFilePresenter(): Pick<IFilePresenter, 'getMimeType' | 'prepareFileCompletely'>
  getLlmProviderPresenter(): Pick<ILlmProviderPresenter, 'generateCompletionStandalone'>
  createSettingsWindow(): ReturnType<IWindowPresenter['createSettingsWindow']>
  sendToWindow(
    windowId: number,
    channel: string,
    ...args: unknown[]
  ): ReturnType<IWindowPresenter['sendToWindow']>
  getApprovedFilePaths?(conversationId: string): string[]
  consumeSettingsApproval?(conversationId: string, toolName: string): boolean
}
