import type {
  CONVERSATION,
  CONVERSATION_SETTINGS,
  ParentSelection,
  MESSAGE_STATUS,
  MESSAGE_METADATA,
  SearchResult,
  Session,
  CreateSessionParams,
  ISQLitePresenter,
  IConfigPresenter,
  ILlmProviderPresenter,
  AcpWorkdirInfo,
  IConversationExporter
} from '@shared/presenter'
import type { AssistantMessageBlock, Message, UserMessageContent } from '@shared/chat'
import type { NowledgeMemThread, NowledgeMemExportSummary } from '@shared/types/nowledgeMem'
import { presenter } from '@/presenter'
import { eventBus } from '@/eventbus'
import { TAB_EVENTS, CONVERSATION_EVENTS } from '@/events'
import type { ISessionPresenter } from './interface'
import { MessageManager } from './managers/messageManager'
import { buildUserMessageContext } from '../agentPresenter/message/messageFormatter'
import { CommandPermissionService } from '../permission/commandPermissionService'
import { ConversationManager, type CreateConversationOptions } from './managers/conversationManager'
import type { ConversationExportFormat } from '../exporter/formats/conversationExporter'

const DEFAULT_MESSAGE_LENGTH = 300

export class SessionPresenter implements ISessionPresenter {
  private sqlitePresenter: ISQLitePresenter
  private messageManager: MessageManager
  private llmProviderPresenter: ILlmProviderPresenter
  private conversationManager: ConversationManager
  private exporter: IConversationExporter
  private commandPermissionService: CommandPermissionService
  private activeConversationIds: Map<number, string> = new Map()

  constructor(options: {
    messageManager?: MessageManager
    sqlitePresenter: ISQLitePresenter
    llmProviderPresenter: ILlmProviderPresenter
    configPresenter: IConfigPresenter
    exporter: IConversationExporter
    commandPermissionService?: CommandPermissionService
  }) {
    this.sqlitePresenter = options.sqlitePresenter
    this.messageManager = options.messageManager ?? new MessageManager(options.sqlitePresenter)
    this.llmProviderPresenter = options.llmProviderPresenter
    this.exporter = options.exporter
    this.commandPermissionService =
      options.commandPermissionService ?? new CommandPermissionService()
    this.conversationManager = new ConversationManager({
      sqlitePresenter: options.sqlitePresenter,
      configPresenter: options.configPresenter,
      messageManager: this.messageManager,
      activeConversationIds: this.activeConversationIds
    })
    // 监听Tab关闭事件，清理绑定关系
    eventBus.on(TAB_EVENTS.CLOSED, (tabId: number) => {
      const activeConversationId = this.getActiveConversationIdSync(tabId)
      if (activeConversationId) {
        this.commandPermissionService.clearConversation(activeConversationId)
        presenter.filePermissionService?.clearConversation(activeConversationId)
        this.clearActiveConversation(tabId, { notify: true })
        console.log(`SessionPresenter: Cleaned up conversation binding for closed tab ${tabId}.`)
      }
    })
    eventBus.on(TAB_EVENTS.RENDERER_TAB_READY, () => {
      this.broadcastThreadListUpdate()
    })

    // 初始化时处理所有未完成的消息
    this.messageManager.initializeUnfinishedMessages()
  }

  async createSession(params: CreateSessionParams): Promise<string> {
    const tabId =
      typeof params.tabId === 'number'
        ? params.tabId
        : await presenter.tabPresenter.getActiveTabId(
            presenter.windowPresenter.getFocusedWindow()?.id ?? 0
          )
    if (tabId == null) {
      throw new Error('tabId is required to create a session')
    }
    return this.createConversation(params.title, params.settings ?? {}, tabId, params.options ?? {})
  }

  async getSession(sessionId: string): Promise<Session> {
    const conversation = await this.getConversation(sessionId)
    return this.toSession(conversation)
  }

  async getSessionList(
    page: number,
    pageSize: number
  ): Promise<{ total: number; sessions: Session[] }> {
    const result = await this.getConversationList(page, pageSize)
    return {
      total: result.total,
      sessions: result.list.map((conversation) => this.toSession(conversation))
    }
  }

  async renameSession(sessionId: string, title: string): Promise<void> {
    await this.renameConversation(sessionId, title)
  }

  async deleteSession(sessionId: string): Promise<void> {
    await this.deleteConversation(sessionId)
  }

  async toggleSessionPinned(sessionId: string, pinned: boolean): Promise<void> {
    await this.toggleConversationPinned(sessionId, pinned)
  }

  async updateSessionSettings(
    sessionId: string,
    settings: Partial<Session['config']>
  ): Promise<void> {
    await this.updateConversationSettings(sessionId, settings as Partial<CONVERSATION_SETTINGS>)
  }

  async bindToTab(sessionId: string, tabId: number): Promise<void> {
    await this.setActiveConversation(sessionId, tabId)
  }

  async unbindFromTab(tabId: number): Promise<void> {
    this.clearActiveConversation(tabId, { notify: true })
  }

  async activateSession(tabId: number, sessionId: string): Promise<void> {
    await this.setActiveConversation(sessionId, tabId)
  }

  async getActiveSession(tabId: number): Promise<Session | null> {
    const conversation = await this.getActiveConversation(tabId)
    return conversation ? this.toSession(conversation) : null
  }

  async findTabForSession(
    sessionId: string,
    _preferredWindowType?: 'main' | 'floating'
  ): Promise<number | null> {
    return this.findTabForConversation(sessionId)
  }

  async getMessageThread(
    sessionId: string,
    page: number,
    pageSize: number
  ): Promise<{ total: number; messages: Message[] }> {
    const result = await this.messageManager.getMessageThread(sessionId, page, pageSize)
    return {
      total: result.total,
      messages: result.list
    }
  }

  async getLastUserMessage(sessionId: string): Promise<Message | null> {
    return this.messageManager.getLastUserMessage(sessionId)
  }

  async forkSession(
    targetSessionId: string,
    targetMessageId: string,
    newTitle: string,
    settings?: Partial<Session['config']>,
    selectedVariantsMap?: Record<string, string>
  ): Promise<string> {
    return this.forkConversation(
      targetSessionId,
      targetMessageId,
      newTitle,
      settings as Partial<CONVERSATION_SETTINGS>,
      selectedVariantsMap
    )
  }

  async createChildSessionFromSelection(params: {
    parentSessionId: string
    parentMessageId: string
    parentSelection: ParentSelection | string
    title: string
    settings?: Partial<Session['config']>
    tabId?: number
    openInNewTab?: boolean
  }): Promise<string> {
    return this.createChildConversationFromSelection({
      parentConversationId: params.parentSessionId,
      parentMessageId: params.parentMessageId,
      parentSelection: params.parentSelection,
      title: params.title,
      settings: params.settings as Partial<CONVERSATION_SETTINGS>,
      tabId: params.tabId,
      openInNewTab: params.openInNewTab
    })
  }

  async listChildSessionsByParent(parentSessionId: string): Promise<Session[]> {
    const list = await this.listChildConversationsByParent(parentSessionId)
    return list.map((conversation) => this.toSession(conversation))
  }

  async listChildSessionsByMessageIds(parentMessageIds: string[]): Promise<Session[]> {
    const list = await this.listChildConversationsByMessageIds(parentMessageIds)
    return list.map((conversation) => this.toSession(conversation))
  }

  async generateTitle(sessionId: string): Promise<string> {
    const conversation = await this.getConversation(sessionId)

    let messageCount = Math.ceil(conversation.settings.contextLength / DEFAULT_MESSAGE_LENGTH)
    if (messageCount < 2) {
      messageCount = 2
    }

    const messages = await this.messageManager.getContextMessages(conversation.id, messageCount)
    const selectedVariantsMap = conversation.settings.selectedVariantsMap || {}
    const variantAwareMessages = this.applyVariantSelection(messages, selectedVariantsMap)
    const formattedMessages = variantAwareMessages
      .map((msg) => {
        if (msg.role === 'user') {
          const userContent: UserMessageContent =
            typeof msg.content === 'string'
              ? {
                  text: msg.content,
                  files: [],
                  links: [],
                  think: false,
                  search: false
                }
              : (msg.content as UserMessageContent)
          return {
            role: 'user' as const,
            content: buildUserMessageContext(userContent)
          }
        }

        const content = (msg.content as AssistantMessageBlock[])
          .filter((block) => block.type === 'content')
          .map((block) => block.content)
          .join('\n')

        return {
          role: 'assistant' as const,
          content
        }
      })
      .filter((item) => item.content.length > 0)

    const title = await this.llmProviderPresenter.summaryTitles(
      formattedMessages,
      conversation.settings.providerId,
      conversation.settings.modelId
    )

    let cleanedTitle = title.replace(/<think>.*?<\/think>/g, '').trim()
    cleanedTitle = cleanedTitle.replace(/^<think>/, '').trim()
    return cleanedTitle
  }

  /**
   * 新增：查找指定会话ID所在的Tab ID
   * @param conversationId 会话ID
   * @returns 如果找到，返回tabId，否则返回null
   */
  async findTabForConversation(conversationId: string): Promise<number | null> {
    return this.conversationManager.findTabForConversation(conversationId)
  }

  getActiveConversationIdSync(tabId: number): string | null {
    return this.conversationManager.getActiveConversationIdSync(tabId)
  }

  getTabsByConversation(conversationId: string): number[] {
    return this.conversationManager.getTabsByConversation(conversationId)
  }

  clearActiveConversation(tabId: number, options: { notify?: boolean } = {}): void {
    const conversationId = this.getActiveConversationIdSync(tabId)
    if (conversationId) {
      this.commandPermissionService.clearConversation(conversationId)
      presenter.filePermissionService?.clearConversation(conversationId)
    }
    this.conversationManager.clearActiveConversation(tabId, options)
  }

  clearConversationBindings(conversationId: string): void {
    this.commandPermissionService.clearConversation(conversationId)
    presenter.filePermissionService?.clearConversation(conversationId)
    this.conversationManager.clearConversationBindings(conversationId)
  }

  clearCommandPermissionCache(conversationId?: string): void {
    if (conversationId) {
      this.commandPermissionService.clearConversation(conversationId)
      presenter.filePermissionService?.clearConversation(conversationId)
      return
    }
    this.commandPermissionService.clearAll()
    presenter.filePermissionService?.clearAll()
  }

  async setActiveConversation(conversationId: string, tabId: number): Promise<void> {
    await this.conversationManager.setActiveConversation(conversationId, tabId)
  }

  async openConversationInNewTab(payload: {
    conversationId: string
    tabId?: number
    messageId?: string
    childConversationId?: string
  }): Promise<number | null> {
    const { conversationId, tabId, messageId, childConversationId } = payload

    await this.sqlitePresenter.getConversation(conversationId)

    const existingTabId = await this.conversationManager.findTabForConversation(conversationId)
    if (existingTabId !== null) {
      await presenter.tabPresenter.switchTab(existingTabId)
      if (messageId || childConversationId) {
        eventBus.sendToTab(existingTabId, CONVERSATION_EVENTS.SCROLL_TO_MESSAGE, {
          conversationId,
          messageId,
          childConversationId
        })
      }
      return existingTabId
    }

    const sourceWindowId =
      typeof tabId === 'number'
        ? presenter.tabPresenter.getWindowIdByWebContentsId(tabId)
        : undefined
    const fallbackWindowId = presenter.windowPresenter.getFocusedWindow()?.id
    const windowId = sourceWindowId ?? fallbackWindowId

    if (!windowId) {
      if (typeof tabId === 'number') {
        await this.conversationManager.setActiveConversation(conversationId, tabId)
        if (messageId || childConversationId) {
          eventBus.sendToTab(tabId, CONVERSATION_EVENTS.SCROLL_TO_MESSAGE, {
            conversationId,
            messageId,
            childConversationId
          })
        }
        return tabId
      }
      return null
    }

    const newTabId = await presenter.tabPresenter.createTab(windowId, 'local://chat', {
      active: true
    })

    if (!newTabId) {
      if (typeof tabId === 'number') {
        await this.conversationManager.setActiveConversation(conversationId, tabId)
        if (messageId || childConversationId) {
          eventBus.sendToTab(tabId, CONVERSATION_EVENTS.SCROLL_TO_MESSAGE, {
            conversationId,
            messageId,
            childConversationId
          })
        }
        return tabId
      }
      return null
    }

    await this.waitForTabReady(newTabId)
    await this.conversationManager.setActiveConversation(conversationId, newTabId)
    if (messageId || childConversationId) {
      eventBus.sendToTab(newTabId, CONVERSATION_EVENTS.SCROLL_TO_MESSAGE, {
        conversationId,
        messageId,
        childConversationId
      })
    }
    return newTabId
  }

  async getActiveConversation(tabId: number): Promise<CONVERSATION | null> {
    return this.conversationManager.getActiveConversation(tabId)
  }

  async getConversation(conversationId: string): Promise<CONVERSATION> {
    return this.conversationManager.getConversation(conversationId)
  }

  async createConversation(
    title: string,
    settings: Partial<CONVERSATION_SETTINGS> = {},
    tabId: number,
    options: CreateConversationOptions = {}
  ): Promise<string> {
    const conversationId = await this.conversationManager.createConversation(
      title,
      settings,
      tabId,
      options
    )

    if (settings?.acpWorkdirMap) {
      const tasks = Object.entries(settings.acpWorkdirMap)
        .filter(([, path]) => typeof path === 'string' && path.trim().length > 0)
        .map(([agentId, path]) =>
          this.llmProviderPresenter
            .setAcpWorkdir(conversationId, agentId, path as string)
            .catch((error) =>
              console.warn('[SessionPresenter] Failed to set ACP workdir during creation', {
                conversationId,
                agentId,
                error
              })
            )
        )

      await Promise.all(tasks)
    }

    return conversationId
  }

  async renameConversation(conversationId: string, title: string): Promise<CONVERSATION> {
    return this.conversationManager.renameConversation(conversationId, title)
  }

  async deleteConversation(conversationId: string): Promise<void> {
    this.commandPermissionService.clearConversation(conversationId)
    presenter.filePermissionService?.clearConversation(conversationId)
    await this.conversationManager.deleteConversation(conversationId)
  }

  async toggleConversationPinned(conversationId: string, pinned: boolean): Promise<void> {
    await this.conversationManager.toggleConversationPinned(conversationId, pinned)
  }

  async updateConversationTitle(conversationId: string, title: string): Promise<void> {
    await this.conversationManager.updateConversationTitle(conversationId, title)
  }

  async updateConversationSettings(
    conversationId: string,
    settings: Partial<CONVERSATION_SETTINGS>
  ): Promise<void> {
    await this.conversationManager.updateConversationSettings(conversationId, settings)
  }

  async getConversationList(
    page: number,
    pageSize: number
  ): Promise<{ total: number; list: CONVERSATION[] }> {
    return this.conversationManager.getConversationList(page, pageSize)
  }

  async loadMoreThreads(): Promise<{ hasMore: boolean; total: number }> {
    return this.conversationManager.loadMoreThreads()
  }

  async broadcastThreadListUpdate(): Promise<void> {
    await this.conversationManager.broadcastThreadListUpdate()
  }

  async getMessages(
    conversationId: string,
    page: number,
    pageSize: number
  ): Promise<{ total: number; list: Message[] }> {
    return await this.messageManager.getMessageThread(conversationId, page, pageSize)
  }

  async getMessageIds(conversationId: string): Promise<string[]> {
    return this.messageManager.getMessageIds(conversationId)
  }

  async getMessagesByIds(messageIds: string[]): Promise<Message[]> {
    return this.messageManager.getMessagesByIds(messageIds)
  }

  async getContextMessages(conversationId: string): Promise<Message[]> {
    const conversation = await this.getConversation(conversationId)
    let messageCount = Math.ceil(conversation.settings.contextLength / 300)
    if (messageCount < 2) {
      messageCount = 2
    }
    return this.messageManager.getContextMessages(conversationId, messageCount)
  }

  async clearContext(conversationId: string): Promise<void> {
    await this.sqlitePresenter.runTransaction(async () => {
      const conversation = await this.getConversation(conversationId)
      if (conversation) {
        await this.sqlitePresenter.deleteAllMessages()
      }
    })
  }

  async getMessage(messageId: string): Promise<Message> {
    return await this.messageManager.getMessage(messageId)
  }

  // 从数据库获取搜索结果
  async getSearchResults(messageId: string, searchId?: string): Promise<SearchResult[]> {
    const results = await this.sqlitePresenter.getMessageAttachments(messageId, 'search_result')
    const parsed =
      results
        .map((result) => {
          try {
            return JSON.parse(result.content) as SearchResult
          } catch (error) {
            console.warn('解析搜索结果附件失败:', error)
            return null
          }
        })
        .filter((item): item is SearchResult => item !== null) ?? []

    if (searchId) {
      const filtered = parsed.filter((item) => item.searchId === searchId)
      if (filtered.length > 0) {
        return filtered
      }
      // 历史数据兼容：如果没有匹配的 searchId，则回退到没有 searchId 的结果
      const legacyResults = parsed.filter((item) => !item.searchId)
      if (legacyResults.length > 0) {
        return legacyResults
      }
    }

    return parsed
  }

  // 查找特定会话的生成状态
  async editMessage(messageId: string, content: string): Promise<Message> {
    return await this.messageManager.editMessage(messageId, content)
  }

  async deleteMessage(messageId: string): Promise<void> {
    await this.messageManager.deleteMessage(messageId)
  }

  async getMessageVariants(messageId: string): Promise<Message[]> {
    return await this.messageManager.getMessageVariants(messageId)
  }

  async updateMessageStatus(messageId: string, status: MESSAGE_STATUS): Promise<void> {
    await this.messageManager.updateMessageStatus(messageId, status)
  }

  async updateMessageMetadata(
    messageId: string,
    metadata: Partial<MESSAGE_METADATA>
  ): Promise<void> {
    await this.messageManager.updateMessageMetadata(messageId, metadata)
  }

  async markMessageAsContextEdge(messageId: string, isEdge: boolean): Promise<void> {
    await this.messageManager.markMessageAsContextEdge(messageId, isEdge)
  }

  async getActiveConversationId(tabId: number): Promise<string | null> {
    return this.conversationManager.getActiveConversationIdSync(tabId)
  }

  async clearActiveThread(tabId: number): Promise<void> {
    this.clearActiveConversation(tabId, { notify: true })
  }

  async clearAllMessages(conversationId: string): Promise<void> {
    await this.messageManager.clearAllMessages(conversationId)
  }

  async getMessageExtraInfo(messageId: string, type: string): Promise<Record<string, unknown>[]> {
    const attachments = await this.sqlitePresenter.getMessageAttachments(messageId, type)
    return attachments.map((attachment) => JSON.parse(attachment.content))
  }

  async getMainMessageByParentId(
    conversationId: string,
    parentId: string
  ): Promise<Message | null> {
    const message = await this.messageManager.getMainMessageByParentId(conversationId, parentId)
    if (!message) {
      return null
    }
    return message
  }

  /**
   * Applies variant selection to messages based on selectedVariantsMap.
   * Returns messages with selected variant fields applied when a variant is selected.
   */
  private applyVariantSelection(
    messages: Message[],
    selectedVariantsMap: Record<string, string>
  ): Message[] {
    return messages.map((msg) => {
      if (msg.role === 'assistant' && selectedVariantsMap[msg.id] && msg.variants) {
        const selectedVariantId = selectedVariantsMap[msg.id]
        const selectedVariant = msg.variants.find((variant) => variant.id === selectedVariantId)

        if (selectedVariant) {
          const newMsg = JSON.parse(JSON.stringify(msg))
          newMsg.content = selectedVariant.content
          newMsg.usage = selectedVariant.usage
          newMsg.model_id = selectedVariant.model_id
          newMsg.model_provider = selectedVariant.model_provider
          newMsg.model_name = selectedVariant.model_name
          return newMsg
        }
      }
      return msg
    })
  }

  destroy() {
    // Reserved for future cleanup hooks.
  }

  /**
   * 创建会话的分支
   * @param targetConversationId 源会话ID
   * @param targetMessageId 目标消息ID（截止到该消息的所有消息将被复制）
   * @param newTitle 新会话标题
   * @param settings 新会话设置
   * @param selectedVariantsMap 选定的变体映射表 (可选)
   * @returns 新创建的会话ID
   */
  async forkConversation(
    targetConversationId: string,
    targetMessageId: string,
    newTitle: string,
    settings?: Partial<CONVERSATION_SETTINGS>,
    selectedVariantsMap?: Record<string, string>
  ): Promise<string> {
    return this.conversationManager.forkConversation(
      targetConversationId,
      targetMessageId,
      newTitle,
      settings,
      selectedVariantsMap
    )
  }

  async createChildConversationFromSelection(payload: {
    parentConversationId: string
    parentMessageId: string
    parentSelection: ParentSelection | string
    title: string
    settings?: Partial<CONVERSATION_SETTINGS>
    tabId?: number
    openInNewTab?: boolean
  }): Promise<string> {
    const {
      parentConversationId,
      parentMessageId,
      parentSelection,
      title,
      settings,
      tabId,
      openInNewTab
    } = payload

    const parentConversation = await this.sqlitePresenter.getConversation(parentConversationId)
    if (!parentConversation) {
      throw new Error('Parent conversation not found')
    }

    await this.messageManager.getMessage(parentMessageId)

    const mergedSettings = {
      ...parentConversation.settings,
      ...settings
    }
    mergedSettings.selectedVariantsMap = {}

    const newConversationId = await this.sqlitePresenter.createConversation(title, mergedSettings)
    const resolvedParentSelection =
      typeof parentSelection === 'string'
        ? (() => {
            try {
              return JSON.parse(parentSelection) as ParentSelection
            } catch {
              throw new Error('Invalid parent selection payload')
            }
          })()
        : parentSelection
    await this.sqlitePresenter.updateConversation(newConversationId, {
      is_new: 0,
      parentConversationId,
      parentMessageId,
      parentSelection: resolvedParentSelection
    })

    const shouldOpenInNewTab = openInNewTab ?? true
    if (shouldOpenInNewTab) {
      const sourceWindowId =
        typeof tabId === 'number'
          ? presenter.tabPresenter.getWindowIdByWebContentsId(tabId)
          : undefined
      const fallbackWindowId = presenter.windowPresenter.getFocusedWindow()?.id
      const windowId = sourceWindowId ?? fallbackWindowId

      if (windowId) {
        const newTabId = await presenter.tabPresenter.createTab(windowId, 'local://chat', {
          active: true
        })
        if (newTabId) {
          await this.waitForTabReady(newTabId)
          await this.conversationManager.setActiveConversation(newConversationId, newTabId)
          await this.broadcastThreadListUpdate()
          return newConversationId
        }
      }
    }

    if (typeof tabId === 'number') {
      await this.conversationManager.setActiveConversation(newConversationId, tabId)
    }

    await this.broadcastThreadListUpdate()
    return newConversationId
  }

  async listChildConversationsByParent(parentConversationId: string): Promise<CONVERSATION[]> {
    return this.sqlitePresenter.listChildConversationsByParent(parentConversationId)
  }

  async listChildConversationsByMessageIds(parentMessageIds: string[]): Promise<CONVERSATION[]> {
    return this.sqlitePresenter.listChildConversationsByMessageIds(parentMessageIds)
  }

  private async waitForTabReady(tabId: number): Promise<void> {
    return new Promise((resolve) => {
      let resolved = false
      const onTabReady = (readyTabId: number) => {
        if (readyTabId === tabId && !resolved) {
          resolved = true
          eventBus.off(TAB_EVENTS.RENDERER_TAB_READY, onTabReady)
          clearTimeout(timeoutId)
          resolve()
        }
      }

      eventBus.on(TAB_EVENTS.RENDERER_TAB_READY, onTabReady)

      const timeoutId = setTimeout(() => {
        if (!resolved) {
          resolved = true
          eventBus.off(TAB_EVENTS.RENDERER_TAB_READY, onTabReady)
          resolve()
        }
      }, 3000)
    })
  }

  /**
   * 导出会话内容
   * @param conversationId 会话ID
   * @param format 导出格式 ('markdown' | 'html' | 'txt')
   * @returns 包含文件名和内容的对象
   */
  async exportConversation(
    conversationId: string,
    format: ConversationExportFormat = 'markdown'
  ): Promise<{
    filename: string
    content: string
  }> {
    return this.exporter.exportConversation(conversationId, format)
  }

  async getAcpWorkdir(conversationId: string, agentId: string): Promise<AcpWorkdirInfo> {
    return this.llmProviderPresenter.getAcpWorkdir(conversationId, agentId)
  }

  async setAcpWorkdir(
    conversationId: string,
    agentId: string,
    workdir: string | null
  ): Promise<void> {
    await this.llmProviderPresenter.setAcpWorkdir(conversationId, agentId, workdir)
  }

  async warmupAcpProcess(agentId: string, workdir: string): Promise<void> {
    await this.llmProviderPresenter.warmupAcpProcess(agentId, workdir)
  }

  async getAcpProcessModes(
    agentId: string,
    workdir: string
  ): Promise<
    | {
        availableModes?: Array<{ id: string; name: string; description: string }>
        currentModeId?: string
      }
    | undefined
  > {
    return await this.llmProviderPresenter.getAcpProcessModes(agentId, workdir)
  }

  async setAcpPreferredProcessMode(agentId: string, workdir: string, modeId: string) {
    await this.llmProviderPresenter.setAcpPreferredProcessMode(agentId, workdir, modeId)
  }

  async setAcpSessionMode(conversationId: string, modeId: string): Promise<void> {
    await this.llmProviderPresenter.setAcpSessionMode(conversationId, modeId)
  }

  async getAcpSessionModes(conversationId: string): Promise<{
    current: string
    available: Array<{ id: string; name: string; description: string }>
  } | null> {
    return await this.llmProviderPresenter.getAcpSessionModes(conversationId)
  }

  /**
   * Export conversation to nowledge-mem format with validation
   */
  async exportToNowledgeMem(conversationId: string): Promise<{
    success: boolean
    data?: NowledgeMemThread | undefined
    summary?: NowledgeMemExportSummary
    errors?: string[]
    warnings?: string[]
  }> {
    return this.exporter.exportToNowledgeMem(conversationId)
  }

  /**
   * Submit thread to nowledge-mem API
   */
  async submitToNowledgeMem(conversationId: string): Promise<{
    success: boolean
    threadId?: string
    data?: NowledgeMemThread
    errors?: string[]
  }> {
    return this.exporter.submitToNowledgeMem(conversationId)
  }

  /**
   * Test nowledge-mem API connection
   */
  async testNowledgeMemConnection(): Promise<{
    success: boolean
    message?: string
    error?: string
  }> {
    return this.exporter.testNowledgeMemConnection()
  }

  /**
   * Update nowledge-mem configuration
   */
  async updateNowledgeMemConfig(config: {
    baseUrl?: string
    apiKey?: string
    timeout?: number
  }): Promise<void> {
    await this.exporter.updateNowledgeMemConfig(config)
  }

  /**
   * Get nowledge-mem configuration
   */
  getNowledgeMemConfig() {
    return this.exporter.getNowledgeMemConfig()
  }

  private toSession(conversation: CONVERSATION): Session {
    const tabs = this.conversationManager.getTabsByConversation(conversation.id)
    const tabId = tabs.length > 0 ? tabs[0] : null
    const windowId =
      typeof tabId === 'number' ? presenter.tabPresenter.getWindowIdByWebContentsId(tabId) : null
    const windowType = windowId ? 'main' : tabId !== null ? 'floating' : null
    const sessionContext =
      typeof presenter?.sessionManager?.getSessionSync === 'function'
        ? presenter.sessionManager.getSessionSync(conversation.id)
        : null
    const settings = conversation.settings as unknown as Omit<
      Session['config'],
      'sessionId' | 'title' | 'isPinned'
    >

    return {
      sessionId: conversation.id,
      status: sessionContext?.status ?? 'idle',
      config: {
        ...settings,
        sessionId: conversation.id,
        title: conversation.title,
        isPinned: conversation.is_pinned === 1
      },
      bindings: {
        tabId: tabId ?? null,
        windowId: windowId ?? null,
        windowType
      },
      context: {
        resolvedChatMode: (conversation.settings.chatMode ??
          'chat') as Session['context']['resolvedChatMode'],
        agentWorkspacePath: conversation.settings.agentWorkspacePath ?? null,
        acpWorkdirMap: conversation.settings.acpWorkdirMap
      },
      createdAt: conversation.createdAt,
      updatedAt: conversation.updatedAt
    }
  }
}
