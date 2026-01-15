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
    selectedVariantsMap?: Record<string, string>,
    tabId?: number
  ): Promise<AssistantMessage | null>
  cancelLoop(messageId: string): Promise<void>
  retryMessage(
    messageId: string,
    selectedVariantsMap?: Record<string, string>,
    tabId?: number
  ): Promise<AssistantMessage>
  regenerateFromUserMessage(
    agentId: string,
    userMessageId: string,
    selectedVariantsMap?: Record<string, string>,
    tabId?: number
  ): Promise<AssistantMessage>
  translateText(text: string, tabId: number): Promise<string>
  askAI(text: string, tabId: number): Promise<string>
  handlePermissionResponse(
    messageId: string,
    toolCallId: string,
    granted: boolean,
    permissionType: 'read' | 'write' | 'all' | 'command',
    remember?: boolean
  ): Promise<void>
  getMessageRequestPreview(agentId: string, messageId?: string): Promise<unknown>
}
