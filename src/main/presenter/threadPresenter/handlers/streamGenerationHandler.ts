import type { AssistantMessage, Message, MessageFile, UserMessage } from '@shared/chat'
import type { CONVERSATION, SearchResult } from '@shared/presenter'
import type { GeneratingMessageState } from '../types'
import type { ContentBufferHandler } from './contentBufferHandler'
import type { SearchHandler } from './searchHandler'
import { BaseHandler, type ThreadHandlerContext } from './baseHandler'

interface StreamGenerationHandlerDeps {
  contentBufferHandler: ContentBufferHandler
  searchHandler: SearchHandler
  generatingMessages: Map<string, GeneratingMessageState>
}

export class StreamGenerationHandler extends BaseHandler {
  private readonly contentBufferHandler: ContentBufferHandler
  private readonly searchHandler: SearchHandler
  private readonly generatingMessages: Map<string, GeneratingMessageState>

  constructor(context: ThreadHandlerContext, deps: StreamGenerationHandlerDeps) {
    super(context)
    this.contentBufferHandler = deps.contentBufferHandler
    this.searchHandler = deps.searchHandler
    this.generatingMessages = deps.generatingMessages
    this.assertDependencies()
  }

  private assertDependencies(): void {
    void this.contentBufferHandler
    void this.searchHandler
    void this.generatingMessages
  }

  async startStreamCompletion(
    _conversationId: string,
    _queryMsgId?: string,
    _selectedVariantsMap?: Record<string, string>
  ): Promise<void> {
    throw new Error('StreamGenerationHandler.startStreamCompletion not implemented yet')
  }

  async continueStreamCompletion(
    _conversationId: string,
    _queryMsgId: string
  ): Promise<AssistantMessage> {
    throw new Error('StreamGenerationHandler.continueStreamCompletion not implemented yet')
  }

  async prepareConversationContext(
    _conversationId: string,
    _queryMsgId?: string,
    _selectedVariantsMap?: Record<string, string>
  ): Promise<{ conversation: CONVERSATION; userMessage: Message; contextMessages: Message[] }> {
    throw new Error('StreamGenerationHandler.prepareConversationContext not implemented yet')
  }

  async processUserMessageContent(
    _userMessage: UserMessage
  ): Promise<{ userContent: string; urlResults: SearchResult[]; imageFiles: MessageFile[] }> {
    throw new Error('StreamGenerationHandler.processUserMessageContent not implemented yet')
  }

  async updateGenerationState(
    _state: GeneratingMessageState,
    _promptTokens: number
  ): Promise<void> {
    throw new Error('StreamGenerationHandler.updateGenerationState not implemented yet')
  }

  findGeneratingState(_conversationId: string): GeneratingMessageState | null {
    throw new Error('StreamGenerationHandler.findGeneratingState not implemented yet')
  }

  async regenerateFromUserMessage(
    _conversationId: string,
    _userMessageId: string,
    _selectedVariantsMap?: Record<string, string>
  ): Promise<AssistantMessage> {
    throw new Error('StreamGenerationHandler.regenerateFromUserMessage not implemented yet')
  }
}
