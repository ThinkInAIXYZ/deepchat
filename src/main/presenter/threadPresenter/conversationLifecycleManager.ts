import {
  CONVERSATION,
  CONVERSATION_SETTINGS,
  ISQLitePresenter,
  IConfigPresenter,
  IMessageManager
} from '../../../shared/presenter'
import { eventBus, SendTarget } from '@/eventbus'
import { CONVERSATION_EVENTS, TAB_EVENTS } from '@/events'
import { presenter } from '@/presenter'
import { DEFAULT_SETTINGS } from './const'

export interface CreateConversationOptions {
  forceNewAndActivate?: boolean
}

interface ConversationLifecycleDependencies {
  sqlitePresenter: ISQLitePresenter
  configPresenter: IConfigPresenter
  messageManager: IMessageManager
}

export class ConversationLifecycleManager {
  private sqlitePresenter: ISQLitePresenter
  private configPresenter: IConfigPresenter
  private messageManager: IMessageManager
  private activeConversationIds: Map<number, string> = new Map()
  private fetchThreadLength = 300

  constructor({
    sqlitePresenter,
    configPresenter,
    messageManager
  }: ConversationLifecycleDependencies) {
    this.sqlitePresenter = sqlitePresenter
    this.configPresenter = configPresenter
    this.messageManager = messageManager
  }

  getActiveConversationId(tabId: number): string | null {
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
        const tabView = await presenter.tabPresenter.getTab(tabId)
        if (tabView && !tabView.webContents.isDestroyed()) {
          return tabId
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
      const windowId = presenter.tabPresenter['tabWindowMap'].get(tabId)
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
    settings: Partial<CONVERSATION_SETTINGS>,
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
        defaultSettings.systemPrompt = ''
        defaultSettings.reasoningEffort = undefined
        defaultSettings.enableSearch = undefined
        defaultSettings.forcedSearch = undefined
        defaultSettings.searchStrategy = undefined
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
      console.error('ThreadPresenter: Failed to create conversation', {
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
      const windowId = presenter.tabPresenter['tabWindowMap'].get(tabId)
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

    for (const key in settings) {
      if (settings[key] !== undefined) {
        mergedSettings[key] = settings[key]
      }
    }

    if (settings.modelId && settings.modelId !== conversation.settings.modelId) {
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

  private async getLatestConversation(): Promise<CONVERSATION | null> {
    const result = await this.getConversationList(1, 1)
    return result.list[0] || null
  }
}
