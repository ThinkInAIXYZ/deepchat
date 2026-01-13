import type {
  CONVERSATION,
  CONVERSATION_SETTINGS,
  IConfigPresenter,
  ISQLitePresenter,
  MESSAGE_METADATA
} from '@shared/presenter'
import type { Message } from '@shared/chat'
import { presenter } from '@/presenter'
import { eventBus, SendTarget } from '@/eventbus'
import { CONVERSATION_EVENTS, TAB_EVENTS } from '@/events'
import { DEFAULT_SETTINGS } from '../const'
import type { MessageManager } from './messageManager'

export interface CreateConversationOptions {
  forceNewAndActivate?: boolean
}

export class ConversationManager {
  private readonly sqlitePresenter: ISQLitePresenter
  private readonly configPresenter: IConfigPresenter
  private readonly messageManager: MessageManager
  private readonly activeConversationIds: Map<number, string>
  private fetchThreadLength = 300

  constructor(options: {
    sqlitePresenter: ISQLitePresenter
    configPresenter: IConfigPresenter
    messageManager: MessageManager
    activeConversationIds: Map<number, string>
  }) {
    this.sqlitePresenter = options.sqlitePresenter
    this.configPresenter = options.configPresenter
    this.messageManager = options.messageManager
    this.activeConversationIds = options.activeConversationIds
  }

  getActiveConversationIdSync(tabId: number): string | null {
    return this.activeConversationIds.get(tabId) || null
  }

  getTabsByConversation(conversationId: string): number[] {
    return Array.from(this.activeConversationIds.entries())
      .filter(([, id]) => id === conversationId)
      .map(([tabId]) => tabId)
  }

  clearActiveConversation(tabId: number, options: { notify?: boolean } = {}): void {
    if (!this.activeConversationIds.has(tabId)) {
      return
    }
    this.activeConversationIds.delete(tabId)
    if (options.notify) {
      eventBus.sendToRenderer(CONVERSATION_EVENTS.DEACTIVATED, SendTarget.ALL_WINDOWS, { tabId })
    }
  }

  clearConversationBindings(conversationId: string): void {
    for (const [tabId, activeId] of this.activeConversationIds.entries()) {
      if (activeId === conversationId) {
        this.activeConversationIds.delete(tabId)
        eventBus.sendToRenderer(CONVERSATION_EVENTS.DEACTIVATED, SendTarget.ALL_WINDOWS, {
          tabId
        })
      }
    }
  }

  async findTabForConversation(conversationId: string): Promise<number | null> {
    for (const [tabId, activeId] of this.activeConversationIds.entries()) {
      if (activeId === conversationId) {
        try {
          const tabView = await presenter.tabPresenter.getTab(tabId)
          if (tabView && !tabView.webContents.isDestroyed()) {
            return tabId
          }
        } catch (error) {
          console.error('Error finding tab for conversation:', error)
        }
      }
    }
    return null
  }

  private async getTabWindowType(tabId: number): Promise<'floating' | 'main' | 'unknown'> {
    try {
      const tabView = await presenter.tabPresenter.getTab(tabId)
      if (!tabView) {
        return 'unknown'
      }
      const windowId = presenter.tabPresenter.getTabWindowId(tabId)
      return windowId ? 'main' : 'floating'
    } catch (error) {
      console.error('Error determining tab window type:', error)
      return 'unknown'
    }
  }

  async setActiveConversation(conversationId: string, tabId: number): Promise<void> {
    const existingTabId = await this.findTabForConversation(conversationId)

    if (existingTabId !== null && existingTabId !== tabId) {
      console.log(
        `Conversation ${conversationId} is already open in tab ${existingTabId}. Switching to it.`
      )
      const currentTabType = await this.getTabWindowType(tabId)
      const existingTabType = await this.getTabWindowType(existingTabId)

      if (currentTabType !== existingTabType) {
        this.activeConversationIds.delete(existingTabId)
        eventBus.sendToRenderer(CONVERSATION_EVENTS.DEACTIVATED, SendTarget.ALL_WINDOWS, {
          tabId: existingTabId
        })
        this.activeConversationIds.set(tabId, conversationId)
        eventBus.sendToRenderer(CONVERSATION_EVENTS.ACTIVATED, SendTarget.ALL_WINDOWS, {
          conversationId,
          tabId
        })
        return
      }

      await presenter.tabPresenter.switchTab(existingTabId)
      return
    }

    const conversation = await this.getConversation(conversationId)
    if (!conversation) {
      throw new Error(`Conversation ${conversationId} not found`)
    }

    if (this.activeConversationIds.get(tabId) === conversationId) {
      return
    }

    this.activeConversationIds.set(tabId, conversationId)
    eventBus.sendToRenderer(CONVERSATION_EVENTS.ACTIVATED, SendTarget.ALL_WINDOWS, {
      conversationId,
      tabId
    })
  }

  async getActiveConversation(tabId: number): Promise<CONVERSATION | null> {
    const conversationId = this.activeConversationIds.get(tabId)
    if (!conversationId) {
      return null
    }
    return this.getConversation(conversationId)
  }

  async getConversation(conversationId: string): Promise<CONVERSATION> {
    return await this.sqlitePresenter.getConversation(conversationId)
  }

  async createConversation(
    title: string,
    settings: Partial<CONVERSATION_SETTINGS> = {},
    tabId: number,
    options: CreateConversationOptions = {}
  ): Promise<string> {
    let latestConversation: CONVERSATION | null = null

    try {
      latestConversation = await this.getLatestConversation()

      if (!options.forceNewAndActivate && latestConversation) {
        const { list: messages } = await this.messageManager.getMessageThread(
          latestConversation.id,
          1,
          1
        )
        if (messages.length === 0) {
          await this.setActiveConversation(latestConversation.id, tabId)
          return latestConversation.id
        }
      }

      let defaultSettings = DEFAULT_SETTINGS
      if (latestConversation?.settings) {
        defaultSettings = { ...latestConversation.settings }
        if (defaultSettings.chatMode === 'chat') {
          defaultSettings.chatMode = 'agent'
        }
        defaultSettings.systemPrompt = ''
        defaultSettings.reasoningEffort = undefined
        defaultSettings.enableSearch = undefined
        defaultSettings.forcedSearch = undefined
        defaultSettings.searchStrategy = undefined
        defaultSettings.selectedVariantsMap = {}
        defaultSettings.acpWorkdirMap = {}
        defaultSettings.agentWorkspacePath = null
        defaultSettings.activeSkills = []
      }

      const sanitizedSettings: Partial<CONVERSATION_SETTINGS> = { ...settings }
      Object.keys(sanitizedSettings).forEach((key) => {
        const typedKey = key as keyof CONVERSATION_SETTINGS
        const value = sanitizedSettings[typedKey]
        if (value === undefined || value === null || value === '') {
          delete sanitizedSettings[typedKey]
        }
      })
      const mergedSettings = { ...defaultSettings }
      const previewSettings = { ...mergedSettings, ...sanitizedSettings }

      const defaultModelsSettings = this.configPresenter.getModelConfig(
        previewSettings.modelId,
        previewSettings.providerId
      )

      if (defaultModelsSettings) {
        if (defaultModelsSettings.maxTokens !== undefined) {
          mergedSettings.maxTokens = defaultModelsSettings.maxTokens
        }
        if (defaultModelsSettings.contextLength !== undefined) {
          mergedSettings.contextLength = defaultModelsSettings.contextLength
        }
        mergedSettings.temperature = defaultModelsSettings.temperature ?? 0.7
        if (
          sanitizedSettings.thinkingBudget === undefined &&
          defaultModelsSettings.thinkingBudget !== undefined
        ) {
          mergedSettings.thinkingBudget = defaultModelsSettings.thinkingBudget
        }
      }

      Object.assign(mergedSettings, sanitizedSettings)

      if (mergedSettings.temperature === undefined || mergedSettings.temperature === null) {
        mergedSettings.temperature = defaultModelsSettings?.temperature ?? 0.7
      }
      const conversationId = await this.sqlitePresenter.createConversation(title, mergedSettings)

      if (options.forceNewAndActivate) {
        this.activeConversationIds.set(tabId, conversationId)
        eventBus.sendToRenderer(CONVERSATION_EVENTS.ACTIVATED, SendTarget.ALL_WINDOWS, {
          conversationId,
          tabId
        })
      } else {
        await this.setActiveConversation(conversationId, tabId)
      }

      await this.broadcastThreadListUpdate()
      return conversationId
    } catch (error) {
      console.error('ConversationManager: Failed to create conversation', {
        title,
        tabId,
        options,
        latestConversationId: latestConversation?.id,
        errorMessage: error instanceof Error ? error.message : String(error),
        errorStack: error instanceof Error ? error.stack : undefined
      })
      throw error
    }
  }

  async renameConversation(conversationId: string, title: string): Promise<CONVERSATION> {
    await this.sqlitePresenter.renameConversation(conversationId, title)
    await this.broadcastThreadListUpdate()

    const conversation = await this.getConversation(conversationId)

    let tabId: number | undefined
    for (const [key, value] of this.activeConversationIds.entries()) {
      if (value === conversationId) {
        tabId = key
        break
      }
    }

    if (tabId !== undefined) {
      const windowId = presenter.tabPresenter.getTabWindowId(tabId)
      eventBus.sendToRenderer(TAB_EVENTS.TITLE_UPDATED, SendTarget.ALL_WINDOWS, {
        tabId,
        conversationId,
        title: conversation.title,
        windowId
      })
    }

    return conversation
  }

  async deleteConversation(conversationId: string): Promise<void> {
    await this.sqlitePresenter.deleteConversation(conversationId)
    this.clearConversationBindings(conversationId)
    await this.broadcastThreadListUpdate()
  }

  async toggleConversationPinned(conversationId: string, pinned: boolean): Promise<void> {
    await this.sqlitePresenter.updateConversation(conversationId, { is_pinned: pinned ? 1 : 0 })
    await this.broadcastThreadListUpdate()
  }

  async updateConversationTitle(conversationId: string, title: string): Promise<void> {
    await this.sqlitePresenter.updateConversation(conversationId, { title })
    await this.broadcastThreadListUpdate()
  }

  async updateConversationSettings(
    conversationId: string,
    settings: Partial<CONVERSATION_SETTINGS>
  ): Promise<void> {
    const conversation = await this.getConversation(conversationId)
    const mergedSettings = { ...conversation.settings }

    const sanitizedOverrides = Object.fromEntries(
      Object.entries(settings).filter(([, value]) => value !== undefined)
    ) as Partial<CONVERSATION_SETTINGS>
    Object.assign(mergedSettings, sanitizedOverrides)

    const modelChanged =
      (settings.modelId !== undefined && settings.modelId !== conversation.settings.modelId) ||
      (settings.providerId !== undefined &&
        settings.providerId !== conversation.settings.providerId)

    if (modelChanged) {
      const modelConfig = this.configPresenter.getModelConfig(
        mergedSettings.modelId,
        mergedSettings.providerId
      )
      if (modelConfig) {
        mergedSettings.maxTokens = modelConfig.maxTokens
        mergedSettings.contextLength = modelConfig.contextLength
      }
    }

    await this.sqlitePresenter.updateConversation(conversationId, { settings: mergedSettings })
    await this.broadcastThreadListUpdate()
  }

  async getConversationList(
    page: number,
    pageSize: number
  ): Promise<{ total: number; list: CONVERSATION[] }> {
    return await this.sqlitePresenter.getConversationList(page, pageSize)
  }

  async loadMoreThreads(): Promise<{ hasMore: boolean; total: number }> {
    const total = await this.sqlitePresenter.getConversationCount()
    const hasMore = this.fetchThreadLength < total

    if (hasMore) {
      this.fetchThreadLength = Math.min(this.fetchThreadLength + 300, total)
      await this.broadcastThreadListUpdate()
    }

    return { hasMore: this.fetchThreadLength < total, total }
  }

  async broadcastThreadListUpdate(): Promise<void> {
    const result = await this.sqlitePresenter.getConversationList(1, this.fetchThreadLength)

    const pinnedConversations: CONVERSATION[] = []
    const normalConversations: CONVERSATION[] = []

    result.list.forEach((conv) => {
      if (conv.is_pinned === 1) {
        pinnedConversations.push(conv)
      } else {
        normalConversations.push(conv)
      }
    })

    pinnedConversations.sort((a, b) => b.updatedAt - a.updatedAt)
    normalConversations.sort((a, b) => b.updatedAt - a.updatedAt)

    const groupedThreads: Map<string, CONVERSATION[]> = new Map()

    if (pinnedConversations.length > 0) {
      groupedThreads.set('Pinned', pinnedConversations)
    }

    normalConversations.forEach((conv) => {
      const date = new Date(conv.updatedAt).toISOString().split('T')[0]
      if (!groupedThreads.has(date)) {
        groupedThreads.set(date, [])
      }
      groupedThreads.get(date)!.push(conv)
    })

    const finalGroupedList = Array.from(groupedThreads.entries()).map(([dt, dtThreads]) => ({
      dt,
      dtThreads
    }))

    eventBus.sendToRenderer(
      CONVERSATION_EVENTS.LIST_UPDATED,
      SendTarget.ALL_WINDOWS,
      finalGroupedList
    )
  }

  async forkConversation(
    targetConversationId: string,
    targetMessageId: string,
    newTitle: string,
    settings?: Partial<CONVERSATION_SETTINGS>,
    selectedVariantsMap?: Record<string, string>
  ): Promise<string> {
    try {
      const sourceConversation = await this.sqlitePresenter.getConversation(targetConversationId)
      if (!sourceConversation) {
        throw new Error('源会话不存在')
      }

      const newConversationId = await this.sqlitePresenter.createConversation(newTitle)

      const newSettings = { ...(settings || sourceConversation.settings) }
      newSettings.selectedVariantsMap = {}
      await this.updateConversationSettings(newConversationId, newSettings)

      await this.sqlitePresenter.updateConversation(newConversationId, { is_new: 0 })

      const { list: fullHistory } = await this.messageManager.getMessageThread(
        targetConversationId,
        1,
        99999
      )

      const targetMessage = await this.messageManager.getMessage(targetMessageId)
      if (!targetMessage) {
        throw new Error('目标消息不存在')
      }

      let mainTargetId: string | null = null
      if (targetMessage.is_variant) {
        if (!targetMessage.parentId) {
          throw new Error('变体消息缺少 parentId，无法定位主消息')
        }
        const mainMessage = await this.messageManager.getMainMessageByParentId(
          targetConversationId,
          targetMessage.parentId
        )
        mainTargetId = mainMessage ? mainMessage.id : null
      } else {
        mainTargetId = targetMessage.id
      }

      if (!mainTargetId) {
        throw new Error('无法确定用于分叉的历史记录目标主消息ID')
      }

      const forkEndIndex = fullHistory.findIndex((msg) => msg.id === mainTargetId)
      if (forkEndIndex === -1) {
        throw new Error('目标主消息在会话历史中未找到，无法分叉。')
      }

      const messageHistory = fullHistory.slice(0, forkEndIndex + 1)

      const messageIdMap = new Map<string, string>()
      const messagesToProcess: Array<{ msg: Message; orderSeq: number }> = []

      for (const msg of messageHistory) {
        if (msg.status !== 'sent') {
          continue
        }
        const orderSeq = (await this.sqlitePresenter.getMaxOrderSeq(newConversationId)) + 1
        messagesToProcess.push({ msg, orderSeq })
      }

      for (const { msg, orderSeq } of messagesToProcess) {
        let finalMsg = msg
        if (msg.role === 'assistant' && selectedVariantsMap && selectedVariantsMap[msg.id]) {
          const selectedVariantId = selectedVariantsMap[msg.id]
          const variant = msg.variants?.find((v) => v.id === selectedVariantId)
          if (variant) {
            finalMsg = variant
          }
        }

        const metadata: MESSAGE_METADATA = {
          totalTokens: finalMsg.usage?.total_tokens || 0,
          generationTime: 0,
          firstTokenTime: 0,
          tokensPerSecond: 0,
          contextUsage: 0,
          inputTokens: finalMsg.usage?.input_tokens || 0,
          outputTokens: finalMsg.usage?.output_tokens || 0,
          ...(finalMsg.model_id ? { model: finalMsg.model_id } : {}),
          ...(finalMsg.model_provider ? { provider: finalMsg.model_provider } : {})
        }

        const tokenCount = finalMsg.usage?.total_tokens || 0
        const content =
          typeof finalMsg.content === 'string' ? finalMsg.content : JSON.stringify(finalMsg.content)

        const newMessageId = await this.sqlitePresenter.insertMessage(
          newConversationId,
          content,
          finalMsg.role,
          '',
          JSON.stringify(metadata),
          orderSeq,
          tokenCount,
          'sent',
          0,
          0
        )
        messageIdMap.set(msg.id, newMessageId)
      }

      for (const { msg } of messagesToProcess) {
        if (msg.parentId && msg.parentId !== '') {
          const newMessageId = messageIdMap.get(msg.id)
          const newParentId = messageIdMap.get(msg.parentId)
          if (newMessageId && newParentId) {
            await this.sqlitePresenter.updateMessageParentId(newMessageId, newParentId)
          }
        }
      }

      await this.broadcastThreadListUpdate()

      return newConversationId
    } catch (error) {
      console.error('分支会话失败:', error)
      throw error
    }
  }

  private async getLatestConversation(): Promise<CONVERSATION | null> {
    const result = await this.getConversationList(1, 1)
    return result.list[0] || null
  }
}
