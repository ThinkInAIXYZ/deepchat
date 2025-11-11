import type { AssistantMessageBlock } from '@shared/chat'
import type { SearchResult } from '@shared/presenter'
import { BaseHandler, type ThreadHandlerContext } from './baseHandler'
import type { GeneratingMessageState } from '../types'

export class SearchHandler extends BaseHandler {
  private readonly generatingMessages: Map<string, GeneratingMessageState>
  private readonly searchingMessages: Set<string>

  constructor(
    context: ThreadHandlerContext,
    options: {
      generatingMessages: Map<string, GeneratingMessageState>
      searchingMessages: Set<string>
    }
  ) {
    super(context)
    this.generatingMessages = options.generatingMessages
    this.searchingMessages = options.searchingMessages
    this.assertDependencies()
  }

  private assertDependencies(): void {
    void this.generatingMessages
    void this.searchingMessages
  }

  async startStreamSearch(
    _conversationId: string,
    _messageId: string,
    _query: string
  ): Promise<SearchResult[]> {
    throw new Error('SearchHandler.startStreamSearch not implemented yet')
  }

  async rewriteUserSearchQuery(
    _query: string,
    _contextMessages: string,
    _conversationId: string,
    _searchEngine: string
  ): Promise<string> {
    throw new Error('SearchHandler.rewriteUserSearchQuery not implemented yet')
  }

  async processSearchResults(
    _messageId: string,
    _results: SearchResult[],
    _searchBlocks?: AssistantMessageBlock[]
  ): Promise<void> {
    throw new Error('SearchHandler.processSearchResults not implemented yet')
  }
}
