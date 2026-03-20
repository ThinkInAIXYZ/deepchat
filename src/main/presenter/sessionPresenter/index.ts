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
import { BrowserWindow, webContents as electronWebContents } from 'electron'
import { promises as fs } from 'fs'
import { presenter } from '@/presenter'
import { eventBus } from '@/eventbus'
import { TAB_EVENTS, CONVERSATION_EVENTS } from '@/events'
import type { ISessionPresenter } from './interface'
import { MessageManager } from './managers/messageManager'
import { buildUserMessageContext } from '../agentPresenter/message/messageFormatter'
import { CommandPermissionService } from '../permission/commandPermissionService'
import { ConversationManager, type CreateConversationOptions } from './managers/conversationManager'
import type { ConversationExportFormat } from '../exporter/formats/conversationExporter'
import { resolveSessionDir } from './sessionPaths'

const DEFAULT_MESSAGE_LENGTH = 300

export class SessionPresenter implements ISessionPresenter {
  private sqlitePresenter: ISQLitePresenter
  private messageManager: MessageManager
  private llmProviderPresenter: ILlmProviderPresenter
  private configPresenter: IConfigPresenter
  private conversationManager: ConversationManager
  private exporter: IConversationExporter
  private commandPermissionService: CommandPermissionService
  private activeConversationBindings: Map<number, string> = new Map()
  private legacyRuntimeInitialized = false

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
    this.configPresenter = options.configPresenter
    this.exporter = options.exporter
    this.commandPermissionService =
      options.commandPermissionService ?? new CommandPermissionService()
    this.conversationManager = new ConversationManager({
      sqlitePresenter: options.sqlitePresenter,
      configPresenter: options.configPresenter,
      messageManager: this.messageManager,
      activeConversationBindings: this.activeConversationBindings
    })
  }

  initializeLegacyRuntime(): void {
    if (this.legacyRuntimeInitialized) {
      return
    }

    this.legacyRuntimeInitialized = true

    // Clean up conversation bindings when a bound renderer is closed.
    eventBus.on(TAB_EVENTS.CLOSED, (webContentsId: number) => {
      const activeConversationId = this.getActiveConversationIdSync(webContentsId)
      if (activeConversationId) {
        void presenter.cleanupLegacyConversationRuntime(activeConversationId)
        this.commandPermissionService.clearConversation(activeConversationId)
        presenter.filePermissionService?.clearConversation(activeConversationId)
        presenter.settingsPermissionService?.clearConversation(activeConversationId)
        this.clearActiveConversationBindingInternal(webContentsId, { notify: true })
        console.log(
          `SessionPresenter: Cleaned up conversation binding for closed webContents ${webContentsId}.`
        )
      }
    })
    eventBus.on(TAB_EVENTS.RENDERER_TAB_READY, () => {
      void this.broadcastThreadListUpdate().catch((error) => {
        if (
          error instanceof Error &&
          /no such table:\s*(conversations|messages|message_attachments)/i.test(error.message)
        ) {
          console.info(
            '[SessionPresenter] Skip legacy thread list broadcast on tab ready: legacy tables not found.'
          )
          return
        }
        console.error('[SessionPresenter] Failed to broadcast thread list on tab ready:', error)
      })
    })

    // 初始化时处理所有未完成的消息
    void this.messageManager.initializeUnfinishedMessages()
  }

  async createSession(params: CreateSessionParams): Promise<string> {
    const webContentsId =
      typeof params.webContentsId === 'number'
        ? params.webContentsId
        : typeof params.tabId === 'number'
          ? params.tabId
          : typeof params.options?.webContentsId === 'number'
            ? params.options.webContentsId
            : typeof params.options?.tabId === 'number'
              ? params.options.tabId
              : (presenter.windowPresenter.getFocusedWindow()?.webContents.id ?? null)

    if (webContentsId == null) {
      throw new Error('webContentsId is required to create a session')
    }
    return this.createConversation(
      params.title,
      params.settings ?? {},
      webContentsId,
      params.options ?? {}
    )
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

  async bindToWebContents(sessionId: string, webContentsId: number): Promise<void> {
    await this.setActiveConversation(sessionId, webContentsId)
  }

  async bindToTab(sessionId: string, tabId: number): Promise<void> {
    await this.bindToWebContents(sessionId, tabId)
  }

  async unbindFromWebContents(webContentsId: number): Promise<void> {
    this.clearActiveConversationBindingInternal(webContentsId, { notify: true })
  }

  async unbindFromTab(tabId: number): Promise<void> {
    await this.unbindFromWebContents(tabId)
  }

  async activateSession(webContentsId: number, sessionId: string): Promise<void> {
    await this.setActiveConversation(sessionId, webContentsId)
  }

  async getActiveSession(webContentsId: number): Promise<Session | null> {
    const conversation = await this.getActiveConversation(webContentsId)
    return conversation ? this.toSession(conversation) : null
  }

  async findWebContentsForSession(
    sessionId: string,
    _preferredWindowType?: 'main' | 'floating'
  ): Promise<number | null> {
    return this.findWebContentsForConversation(sessionId)
  }

  async findTabForSession(
    sessionId: string,
    preferredWindowType?: 'main' | 'floating'
  ): Promise<number | null> {
    return this.findWebContentsForSession(sessionId, preferredWindowType)
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

  async getLastAssistantMessage(sessionId: string): Promise<Message | null> {
    return this.messageManager.getLastAssistantMessage(sessionId)
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
    webContentsId?: number
    openInNewWindow?: boolean
    tabId?: number
    openInNewTab?: boolean
  }): Promise<string> {
    return this.createChildConversationFromSelection({
      parentConversationId: params.parentSessionId,
      parentMessageId: params.parentMessageId,
      parentSelection: params.parentSelection,
      title: params.title,
      settings: params.settings as Partial<CONVERSATION_SETTINGS>,
      webContentsId: params.webContentsId ?? params.tabId,
      openInNewWindow: params.openInNewWindow ?? params.openInNewTab,
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

    const assistantModel = this.configPresenter.getSetting<{ providerId: string; modelId: string }>(
      'assistantModel'
    )
    const fallbackProviderId = conversation.settings.providerId
    const fallbackModelId = conversation.settings.modelId
    const preferredProviderId = assistantModel?.providerId || fallbackProviderId
    const preferredModelId = assistantModel?.modelId || fallbackModelId

    let title: string
    try {
      title = await this.llmProviderPresenter.summaryTitles(
        formattedMessages,
        preferredProviderId,
        preferredModelId
      )
    } catch (error) {
      const shouldFallback =
        preferredProviderId !== fallbackProviderId || preferredModelId !== fallbackModelId
      if (!shouldFallback) {
        throw error
      }
      console.warn(
        '[SessionPresenter] Failed to generate title with assistant model, fallback to conversation model',
        {
          preferredProviderId,
          preferredModelId,
          fallbackProviderId,
          fallbackModelId,
          error
        }
      )
      title = await this.llmProviderPresenter.summaryTitles(
        formattedMessages,
        fallbackProviderId,
        fallbackModelId
      )
    }

    let cleanedTitle = title.replace(/<think>.*?<\/think>/g, '').trim()
    cleanedTitle = cleanedTitle.replace(/^<think>/, '').trim()
    return cleanedTitle
  }

  async findWebContentsForConversation(conversationId: string): Promise<number | null> {
    return this.conversationManager.findWebContentsForConversation(conversationId)
  }

  async findTabForConversation(conversationId: string): Promise<number | null> {
    return this.findWebContentsForConversation(conversationId)
  }

  getActiveConversationIdSync(webContentsId: number): string | null {
    return this.conversationManager.getActiveConversationIdSync(webContentsId)
  }

  getWebContentsIdsByConversation(conversationId: string): number[] {
    return this.conversationManager.getWebContentsIdsByConversation(conversationId)
  }

  getTabsByConversation(conversationId: string): number[] {
    return this.getWebContentsIdsByConversation(conversationId)
  }

  private clearActiveConversationBindingInternal(
    webContentsId: number,
    options: { notify?: boolean } = {}
  ): void {
    const conversationId = this.getActiveConversationIdSync(webContentsId)
    if (conversationId) {
      this.commandPermissionService.clearConversation(conversationId)
      presenter.filePermissionService?.clearConversation(conversationId)
      presenter.settingsPermissionService?.clearConversation(conversationId)
    }
    this.conversationManager.clearActiveConversationBinding(webContentsId, options)
  }

  clearActiveConversation(webContentsId: number, options: { notify?: boolean } = {}): void {
    this.clearActiveConversationBindingInternal(webContentsId, options)
  }

  clearConversationBindings(conversationId: string): void {
    this.commandPermissionService.clearConversation(conversationId)
    presenter.filePermissionService?.clearConversation(conversationId)
    presenter.settingsPermissionService?.clearConversation(conversationId)
    this.conversationManager.clearConversationBindings(conversationId)
  }

  clearCommandPermissionCache(conversationId?: string): void {
    if (conversationId) {
      this.commandPermissionService.clearConversation(conversationId)
      presenter.filePermissionService?.clearConversation(conversationId)
      presenter.settingsPermissionService?.clearConversation(conversationId)
      return
    }
    this.commandPermissionService.clearAll()
    presenter.filePermissionService?.clearAll()
    presenter.settingsPermissionService?.clearAll()
  }

  private focusWindowForWebContents(webContentsId: number): void {
    const targetContents = electronWebContents.fromId(webContentsId)
    if (!targetContents || targetContents.isDestroyed()) {
      return
    }

    const targetWindow = BrowserWindow.fromWebContents(targetContents)
    if (!targetWindow || targetWindow.isDestroyed()) {
      return
    }

    presenter.windowPresenter.show(targetWindow.id, true)
  }

  async setActiveConversation(conversationId: string, webContentsId: number): Promise<void> {
    await this.conversationManager.setActiveConversation(conversationId, webContentsId)
  }

  async openConversationInNewWindow(payload: {
    conversationId: string
    webContentsId?: number
    messageId?: string
    childConversationId?: string
  }): Promise<number | null> {
    const { conversationId, messageId, childConversationId } = payload

    await this.sqlitePresenter.getConversation(conversationId)

    const existingWebContentsId =
      await this.conversationManager.findWebContentsForConversation(conversationId)
    if (existingWebContentsId !== null) {
      this.focusWindowForWebContents(existingWebContentsId)
      if (messageId || childConversationId) {
        await presenter.windowPresenter.sendToWebContents(
          existingWebContentsId,
          CONVERSATION_EVENTS.SCROLL_TO_MESSAGE,
          {
            conversationId,
            messageId,
            childConversationId
          }
        )
      }
      return existingWebContentsId
    }

    const newWindowId = await presenter.windowPresenter.createAppWindow({ initialRoute: 'chat' })
    if (newWindowId == null) {
      return null
    }

    const targetWindow =
      BrowserWindow.fromId(newWindowId) ??
      presenter.windowPresenter.getAllWindows().find((window) => window.id === newWindowId)
    const targetWebContentsId = targetWindow?.webContents.id ?? null
    if (targetWebContentsId == null) {
      return null
    }

    await this.conversationManager.setActiveConversation(conversationId, targetWebContentsId)
    this.focusWindowForWebContents(targetWebContentsId)
    if (messageId || childConversationId) {
      await presenter.windowPresenter.sendToWebContents(
        targetWebContentsId,
        CONVERSATION_EVENTS.SCROLL_TO_MESSAGE,
        {
          conversationId,
          messageId,
          childConversationId
        }
      )
    }

    return targetWebContentsId
  }

  async openConversationInNewTab(payload: {
    conversationId: string
    tabId?: number
    messageId?: string
    childConversationId?: string
  }): Promise<number | null> {
    const { conversationId, tabId, messageId, childConversationId } = payload
    const existingWebContentsId =
      await this.conversationManager.findWebContentsForConversation(conversationId)

    if (existingWebContentsId !== null) {
      this.focusWindowForWebContents(existingWebContentsId)
      if (messageId || childConversationId) {
        await presenter.windowPresenter.sendToWebContents(
          existingWebContentsId,
          CONVERSATION_EVENTS.SCROLL_TO_MESSAGE,
          {
            conversationId,
            messageId,
            childConversationId
          }
        )
      }
      return existingWebContentsId
    }

    if (typeof tabId === 'number') {
      await this.conversationManager.setActiveConversation(conversationId, tabId)
      if (messageId || childConversationId) {
        await presenter.windowPresenter.sendToWebContents(
          tabId,
          CONVERSATION_EVENTS.SCROLL_TO_MESSAGE,
          {
            conversationId,
            messageId,
            childConversationId
          }
        )
      }
      return tabId
    }

    return this.openConversationInNewWindow({
      conversationId,
      messageId,
      childConversationId
    })
  }

  async getActiveConversation(webContentsId: number): Promise<CONVERSATION | null> {
    return this.conversationManager.getActiveConversation(webContentsId)
  }

  async getConversation(conversationId: string): Promise<CONVERSATION> {
    return this.conversationManager.getConversation(conversationId)
  }

  async createConversation(
    title: string,
    settings: Partial<CONVERSATION_SETTINGS> = {},
    webContentsId: number,
    options: CreateConversationOptions = {}
  ): Promise<string> {
    const conversationId = await this.conversationManager.createConversation(
      title,
      settings,
      webContentsId,
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
    await presenter.cleanupLegacyConversationRuntime(conversationId)
    this.commandPermissionService.clearConversation(conversationId)
    presenter.filePermissionService?.clearConversation(conversationId)
    presenter.settingsPermissionService?.clearConversation(conversationId)
    await this.deleteSessionOffloadFiles(conversationId)
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

  private async deleteSessionOffloadFiles(conversationId: string): Promise<void> {
    const sessionDir = resolveSessionDir(conversationId)
    if (!sessionDir) return

    try {
      await fs.rm(sessionDir, { recursive: true, force: true })
    } catch (error) {
      console.warn('[SessionPresenter] Failed to delete session offload files', {
        conversationId,
        error
      })
    }
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

  async getActiveConversationId(webContentsId: number): Promise<string | null> {
    return this.conversationManager.getActiveConversationIdSync(webContentsId)
  }

  async clearActiveConversationBinding(webContentsId: number): Promise<void> {
    this.clearActiveConversationBindingInternal(webContentsId, { notify: true })
  }

  async clearActiveThread(webContentsId: number): Promise<void> {
    this.clearActiveConversationBindingInternal(webContentsId, { notify: true })
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
    webContentsId?: number
    openInNewWindow?: boolean
    tabId?: number
    openInNewTab?: boolean
  }): Promise<string> {
    const {
      parentConversationId,
      parentMessageId,
      parentSelection,
      title,
      settings,
      webContentsId,
      openInNewWindow,
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

    await this.broadcastThreadListUpdate()

    const targetWebContentsId =
      typeof webContentsId === 'number'
        ? webContentsId
        : typeof tabId === 'number'
          ? tabId
          : undefined
    const shouldOpenInNewChatWindow = openInNewWindow ?? openInNewTab ?? true

    if (shouldOpenInNewChatWindow) {
      await this.openConversationInNewWindow({
        conversationId: newConversationId
      })
      return newConversationId
    }

    if (typeof targetWebContentsId === 'number') {
      await this.conversationManager.setActiveConversation(newConversationId, targetWebContentsId)
    }

    return newConversationId
  }

  async listChildConversationsByParent(parentConversationId: string): Promise<CONVERSATION[]> {
    return this.sqlitePresenter.listChildConversationsByParent(parentConversationId)
  }

  async listChildConversationsByMessageIds(parentMessageIds: string[]): Promise<CONVERSATION[]> {
    return this.sqlitePresenter.listChildConversationsByMessageIds(parentMessageIds)
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

  async warmupAcpProcess(agentId: string, workdir?: string): Promise<void> {
    await this.llmProviderPresenter.warmupAcpProcess(agentId, workdir)
  }

  async getAcpProcessModes(
    agentId: string,
    workdir?: string
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
    const boundWebContentsIds = this.conversationManager.getWebContentsIdsByConversation(
      conversation.id
    )
    const webContentsId = boundWebContentsIds.length > 0 ? boundWebContentsIds[0] : null
    const targetContents =
      typeof webContentsId === 'number' ? electronWebContents.fromId(webContentsId) : null
    const targetWindow =
      targetContents && !targetContents.isDestroyed()
        ? BrowserWindow.fromWebContents(targetContents)
        : null
    const floatingWindow = presenter.windowPresenter.getFloatingChatWindow()?.getWindow()
    const windowId = targetWindow?.id ?? null
    const windowType =
      targetWindow == null
        ? webContentsId !== null
          ? 'floating'
          : null
        : floatingWindow && floatingWindow.id === targetWindow.id
          ? 'floating'
          : 'main'
    const sessionContext =
      typeof presenter?.getLegacyRuntimeSessionSync === 'function'
        ? presenter.getLegacyRuntimeSessionSync(conversation.id)
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
        webContentsId: webContentsId ?? null,
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
