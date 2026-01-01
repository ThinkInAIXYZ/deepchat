import type { MESSAGE } from './thread.presenter'

export interface IAgentPresenter {
  sendMessage(agentId: string, content: string, tabId?: number): Promise<MESSAGE | null>
  continueLoop(agentId: string, messageId: string): Promise<void>
  cancelLoop(messageId: string): Promise<void>
  handlePermissionResponse(
    messageId: string,
    toolCallId: string,
    granted: boolean,
    permissionType: 'read' | 'write' | 'all' | 'command',
    remember?: boolean
  ): Promise<void>
  getMessageRequestPreview(agentId: string, messageId?: string): Promise<unknown>
}
