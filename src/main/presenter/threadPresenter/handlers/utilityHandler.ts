import type { Message } from '@shared/chat'
import type { CONVERSATION } from '@shared/presenter'
import { BaseHandler } from './baseHandler'

export class UtilityHandler extends BaseHandler {
  async translateText(_text: string, _tabId: number): Promise<string> {
    throw new Error('UtilityHandler.translateText not implemented yet')
  }

  async askAI(_text: string, _tabId: number): Promise<string> {
    throw new Error('UtilityHandler.askAI not implemented yet')
  }

  async exportConversation(
    _conversation: CONVERSATION,
    _messages: Message[],
    _format: 'markdown' | 'html' | 'txt'
  ): Promise<{ filename: string; content: string }> {
    throw new Error('UtilityHandler.exportConversation not implemented yet')
  }

  async summaryTitles(_tabId?: number, _conversationId?: string): Promise<string> {
    throw new Error('UtilityHandler.summaryTitles not implemented yet')
  }

  async getMessageRequestPreview(_messageId: string): Promise<unknown> {
    throw new Error('UtilityHandler.getMessageRequestPreview not implemented yet')
  }
}
