import type { AssistantMessage } from '@shared/chat'

export interface IAgentPresenter {
  sendMessage(
    agentId: string,
    content: string,
    tabId?: number,
    selectedVariantsMap?: Record<string, string>
  ): Promise<AssistantMessage | null>
  continueLoop(
    agentId: string,
    messageId: string,
    selectedVariantsMap?: Record<string, string>
  ): Promise<void>
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
