import type { AssistantMessageBlock, Message, UserMessageContent } from '@shared/chat'
import { finalizeAssistantMessageBlocks } from '@shared/chat/messageBlocks'
import type { MODEL_META, SearchResult } from '@shared/presenter'
import { nanoid } from 'nanoid'
import { buildUserMessageContext } from '../../agentPresenter/message/messageFormatter'
import type { GeneratingMessageState } from '../types'
import { BaseHandler, type ThreadHandlerContext } from './baseHandler'

interface SearchHandlerOptions {
  generatingMessages: Map<string, GeneratingMessageState>
  searchingMessages: Set<string>
  getSearchAssistantModel?: () => MODEL_META | null
  getSearchAssistantProviderId?: () => string | null
}

export class SearchHandler extends BaseHandler {
  private readonly generatingMessages: Map<string, GeneratingMessageState>
  private readonly searchingMessages: Set<string>
  private readonly getSearchAssistantModel: () => MODEL_META | null
  private readonly getSearchAssistantProviderId: () => string | null

  constructor(context: ThreadHandlerContext, options: SearchHandlerOptions) {
    super(context)
    this.generatingMessages = options.generatingMessages
    this.searchingMessages = options.searchingMessages
    this.getSearchAssistantModel = options.getSearchAssistantModel ?? (() => null)
    this.getSearchAssistantProviderId = options.getSearchAssistantProviderId ?? (() => null)
    this.assertDependencies()
  }

  private assertDependencies(): void {
    void this.generatingMessages
    void this.searchingMessages
    void this.getSearchAssistantModel
    void this.getSearchAssistantProviderId
  }

  async startStreamSearch(
    conversationId: string,
    messageId: string,
    query: string
  ): Promise<SearchResult[]> {
    const state = this.generatingMessages.get(messageId)
    if (!state) {
      throw new Error('Generation state not found')
    }

    const activeEngine = this.ctx.searchManager.getActiveEngine()
    const labelValue = 'web_search'
    const engineId = activeEngine?.id ?? labelValue
    const engineName = activeEngine?.name ?? engineId

    this.throwIfCancelled(messageId)

    const searchId = nanoid()
    const searchBlock: AssistantMessageBlock = {
      id: searchId,
      type: 'search',
      content: '',
      status: 'loading',
      timestamp: Date.now(),
      extra: {
        total: 0,
        searchId,
        pages: [],
        label: labelValue,
        name: labelValue,
        engine: engineName,
        provider: engineName
      }
    }

    this.finalizeLastBlock(state)
    state.message.content.push(searchBlock)
    await this.ctx.messageManager.editMessage(messageId, JSON.stringify(state.message.content))

    state.isSearching = true
    this.searchingMessages.add(messageId)

    try {
      const contextMessages = await this.getContextMessages(conversationId)
      this.throwIfCancelled(messageId)

      const formattedContext = this.serializeContextMessages(contextMessages)

      searchBlock.status = 'optimizing'
      await this.ctx.messageManager.editMessage(messageId, JSON.stringify(state.message.content))

      const optimizedQuery = await this.rewriteUserSearchQuery(
        query,
        formattedContext,
        conversationId,
        engineName
      ).catch((error) => {
        console.error('Failed to rewrite search query:', error)
        return query
      })

      if (optimizedQuery.includes('无须搜索')) {
        searchBlock.status = 'success'
        searchBlock.content = ''
        await this.ctx.messageManager.editMessage(messageId, JSON.stringify(state.message.content))
        state.isSearching = false
        this.searchingMessages.delete(messageId)
        return []
      }

      this.throwIfCancelled(messageId)

      searchBlock.status = 'reading'
      await this.ctx.messageManager.editMessage(messageId, JSON.stringify(state.message.content))

      const results = await this.ctx.searchManager.search(conversationId, optimizedQuery)

      this.throwIfCancelled(messageId)

      searchBlock.status = 'loading'
      const pages = results
        .filter((item) => item && (item.icon || item.favicon))
        .slice(0, 6)
        .map((item) => ({
          url: item?.url || '',
          icon: item?.icon || item?.favicon || ''
        }))

      const previousExtra = searchBlock.extra ?? {}
      searchBlock.extra = {
        ...previousExtra,
        total: results.length,
        pages
      }
      await this.ctx.messageManager.editMessage(messageId, JSON.stringify(state.message.content))

      await this.saveSearchResults(messageId, results, searchId)

      this.throwIfCancelled(messageId)

      searchBlock.status = 'success'
      await this.ctx.messageManager.editMessage(messageId, JSON.stringify(state.message.content))

      state.isSearching = false
      this.searchingMessages.delete(messageId)
      return results
    } catch (error) {
      state.isSearching = false
      this.searchingMessages.delete(messageId)

      searchBlock.status = 'error'
      searchBlock.content = String(error)
      await this.ctx.messageManager.editMessage(messageId, JSON.stringify(state.message.content))

      if (String(error).includes('userCanceledGeneration')) {
        this.ctx.searchManager.stopSearch(state.conversationId)
      }

      return []
    }
  }

  async rewriteUserSearchQuery(
    query: string,
    contextMessages: string,
    conversationId: string,
    searchEngine: string
  ): Promise<string> {
    const rewritePrompt = `
    你非常擅长于使用搜索引擎去获取最新的数据,你的目标是在充分理解用户的问题后，进行全面的网络搜索搜集必要的信息，首先你要提取并优化搜索的查询内容

    现在时间：${new Date().toISOString()}
    正在使用的搜索引擎：${searchEngine}

    请遵循以下规则重写搜索查询：
    1. 根据用户的问题和上下文，重写应该进行搜索的关键词
    2. 如果需要使用时间，则根据当前时间给出需要查询的具体时间日期信息
    3. 生成的查询关键词要选择合适的语言，考虑用户的问题类型使用最适合的语言进行搜索，例如某些问题应该保持用户的问题语言，而有一些则更适合翻译成英语或其他语言
    4. 保持查询简洁，通常不超过3个关键词, 最多不要超过5个关键词，参考当前搜索引擎的查询习惯重写关键字

    直接返回优化后的搜索词，不要有任何额外说明。
    如果你觉得用户的问题不需要进行搜索，请直接返回"无须搜索"。

    如下是之前对话的上下文：
    <context_messages>
    ${contextMessages}
    </context_messages>
    如下是用户的问题：
    <user_question>
    ${query}
    </user_question>
    `

    const conversation = await this.ctx.sqlitePresenter.getConversation(conversationId)
    if (!conversation) {
      return query
    }

    const providerId = this.getSearchAssistantProviderId() || conversation.settings.providerId
    const modelId = this.getSearchAssistantModel()?.id || conversation.settings.modelId

    try {
      const rewrittenQuery = await this.ctx.llmProviderPresenter.generateCompletion(
        providerId,
        [
          {
            role: 'user',
            content: rewritePrompt
          }
        ],
        modelId
      )
      return rewrittenQuery.trim() || query
    } catch (error) {
      console.error('Failed to rewrite search query:', error)
      return query
    }
  }

  async processSearchResults(
    messageId: string,
    results: SearchResult[],
    searchBlocks?: AssistantMessageBlock[]
  ): Promise<void> {
    const state = this.generatingMessages.get(messageId)
    if (!state) {
      return
    }

    if (!results.length) {
      return
    }

    const searchId = nanoid()
    const block: AssistantMessageBlock =
      searchBlocks?.[0] ??
      ({
        id: searchId,
        type: 'search',
        status: 'success',
        timestamp: Date.now(),
        content: '',
        extra: {
          total: results.length,
          searchId,
          pages: results
            .filter((item) => item.icon || item.favicon)
            .slice(0, 6)
            .map((item) => ({
              url: item.url || '',
              icon: item.icon || item.favicon || ''
            }))
        }
      } satisfies AssistantMessageBlock)

    if (!searchBlocks) {
      this.finalizeLastBlock(state)
      state.message.content.push(block)
    }

    const attachmentSearchId =
      typeof block.extra?.searchId === 'string' ? block.extra.searchId : searchId

    await this.saveSearchResults(messageId, results, attachmentSearchId)
    await this.ctx.messageManager.editMessage(messageId, JSON.stringify(state.message.content))
  }

  private async getContextMessages(conversationId: string): Promise<Message[]> {
    const conversation = await this.ctx.sqlitePresenter.getConversation(conversationId)
    if (!conversation) {
      throw new Error('Conversation not found')
    }

    let messageCount = Math.ceil(conversation.settings.contextLength / 300)
    if (messageCount < 2) {
      messageCount = 2
    }

    return this.ctx.messageManager.getContextMessages(conversationId, messageCount)
  }

  private serializeContextMessages(messages: Message[]): string {
    return messages
      .map((msg) => {
        if (msg.role === 'user') {
          const content = msg.content as UserMessageContent
          const userContext = buildUserMessageContext(content)
          return `user: ${userContext}`
        }

        if (msg.role === 'assistant') {
          let finalContent = 'assistant: '
          const content = msg.content as AssistantMessageBlock[]
          content.forEach((block) => {
            if (block.type === 'content') {
              finalContent += block.content + '\n'
            }
            if (block.type === 'search') {
              finalContent += `search-result: ${JSON.stringify(block.extra)}`
            }
            if (block.type === 'tool_call') {
              finalContent += `tool_call: ${JSON.stringify(block.tool_call)}`
            }
            if (block.type === 'image') {
              finalContent += `image: ${block.image_data?.data}`
            }
          })
          return finalContent
        }

        return JSON.stringify(msg.content)
      })
      .join('\n')
  }

  private finalizeLastBlock(state: GeneratingMessageState): void {
    finalizeAssistantMessageBlocks(state.message.content)
  }

  private throwIfCancelled(messageId: string): void {
    if (this.isMessageCancelled(messageId)) {
      throw new Error('common.error.userCanceledGeneration')
    }
  }

  private isMessageCancelled(messageId: string): boolean {
    const state = this.generatingMessages.get(messageId)
    return !state || state.isCancelled === true
  }

  private async saveSearchResults(
    messageId: string,
    results: SearchResult[],
    searchId: string
  ): Promise<void> {
    for (const result of results) {
      await this.ctx.sqlitePresenter.addMessageAttachment(
        messageId,
        'search_result',
        JSON.stringify({
          title: result.title,
          url: result.url,
          content: result.content || '',
          description: result.description || '',
          icon: result.icon || result.favicon || '',
          rank: typeof result.rank === 'number' ? result.rank : undefined,
          searchId
        })
      )
    }
  }
}
