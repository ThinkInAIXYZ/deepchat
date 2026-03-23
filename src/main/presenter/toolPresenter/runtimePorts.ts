import type {
  IFilePresenter,
  ILlmProviderPresenter,
  IWindowPresenter,
  IYoBrowserPresenter
} from '@shared/presenter'
import type { ISkillPresenter } from '@shared/types/skill'

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
