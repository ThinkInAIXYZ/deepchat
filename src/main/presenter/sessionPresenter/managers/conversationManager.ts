import type {
  CONVERSATION,
  CONVERSATION_SETTINGS,
  IConfigPresenter,
  ISQLitePresenter,
  MESSAGE_METADATA
} from '@shared/presenter'
import type { Message } from '@shared/chat'
import { BrowserWindow, webContents as electronWebContents } from 'electron'
import { presenter } from '@/presenter'
import { eventBus, SendTarget } from '@/eventbus'
import { CONVERSATION_EVENTS } from '@/events'
import { DEFAULT_SETTINGS } from '../const'
import type { MessageManager } from './messageManager'

export interface CreateConversationOptions {
  forceNewAndActivate?: boolean
}

export class ConversationManager {
  private readonly sqlitePresenter: ISQLitePresenter
  private readonly configPresenter: IConfigPresenter
  private readonly messageManager: MessageManager
  private readonly activeConversationBindings: Map<number, string>
  private fetchThreadLength = 300

  private isLegacyTableMissingError(error: unknown): boolean {
    return (
      error instanceof Error &&
      /no such table:\s*(conversations|messages|message_attachments)/i.test(error.message)
    )
  }

  constructor(options: {
    sqlitePresenter: ISQLitePresenter
    configPresenter: IConfigPresenter
    messageManager: MessageManager
    activeConversationBindings: Map<number, string>
  }) {
    this.sqlitePresenter = options.sqlitePresenter
    this.configPresenter = options.configPresenter
    this.messageManager = options.messageManager
    this.activeConversationBindings = options.activeConversationBindings
  }

  getActiveConversationIdSync(webContentsId: number): string | null {
    return this.activeConversationBindings.get(webContentsId) || null
  }

  getWebContentsIdsByConversation(conversationId: string): number[] {
    return Array.from(this.activeConversationBindings.entries())
      .filter(([, id]) => id === conversationId)
      .map(([webContentsId]) => webContentsId)
  }

  getTabsByConversation(conversationId: string): number[] {
    return this.getWebContentsIdsByConversation(conversationId)
  }

  clearActiveConversationBinding(webContentsId: number, options: { notify?: boolean } = {}): void {
    if (!this.activeConversationBindings.has(webContentsId)) {
      return
    }
    this.activeConversationBindings.delete(webContentsId)
    if (options.notify) {
      eventBus.sendToRenderer(CONVERSATION_EVENTS.DEACTIVATED, SendTarget.ALL_WINDOWS, {
        webContentsId
      })
    }
  }

  clearConversationBindings(conversationId: string): void {
    for (const [webContentsId, activeId] of this.activeConversationBindings.entries()) {
      if (activeId === conversationId) {
        this.activeConversationBindings.delete(webContentsId)
        eventBus.sendToRenderer(CONVERSATION_EVENTS.DEACTIVATED, SendTarget.ALL_WINDOWS, {
          webContentsId
        })
      }
    }
  }

  async findWebContentsForConversation(conversationId: string): Promise<number | null> {
    for (const [webContentsId, activeId] of this.activeConversationBindings.entries()) {
      if (activeId === conversationId) {
        try {
          const targetContents = electronWebContents.fromId(webContentsId)
          if (targetContents && !targetContents.isDestroyed()) {
            return webContentsId
          }
        } catch (error) {
          console.error('Error finding bound webContents for conversation:', error)
        }
      }
    }
    return null
  }

  async findTabForConversation(conversationId: string): Promise<number | null> {
    return this.findWebContentsForConversation(conversationId)
  }

  private getWindowTypeForWebContents(webContentsId: number): 'floating' | 'main' | 'unknown' {
    try {
      const targetContents = electronWebContents.fromId(webContentsId)
      if (!targetContents || targetContents.isDestroyed()) {
        return 'unknown'
      }

      const targetWindow = BrowserWindow.fromWebContents(targetContents)
      if (!targetWindow || targetWindow.isDestroyed()) {
        return 'unknown'
      }

      const floatingWindow = presenter.windowPresenter.getFloatingChatWindow()?.getWindow()
      return floatingWindow && floatingWindow.id === targetWindow.id ? 'floating' : 'main'
    } catch (error) {
      console.error('Error determining webContents window type:', error)
      return 'unknown'
    }
  }

  private focusBoundWebContents(webContentsId: number): void {
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
    const existingWebContentsId = await this.findWebContentsForConversation(conversationId)

    if (existingWebContentsId !== null && existingWebContentsId !== webContentsId) {
      console.log(
        `Conversation ${conversationId} is already bound to webContents ${existingWebContentsId}. Focusing that window.`
      )
      const currentWindowType = this.getWindowTypeForWebContents(webContentsId)
      const existingWindowType = this.getWindowTypeForWebContents(existingWebContentsId)

      if (currentWindowType !== existingWindowType) {
        this.activeConversationBindings.delete(existingWebContentsId)
        eventBus.sendToRenderer(CONVERSATION_EVENTS.DEACTIVATED, SendTarget.ALL_WINDOWS, {
          webContentsId: existingWebContentsId
        })
        this.activeConversationBindings.set(webContentsId, conversationId)
        eventBus.sendToRenderer(CONVERSATION_EVENTS.ACTIVATED, SendTarget.ALL_WINDOWS, {
          conversationId,
          webContentsId
        })
        return
      }

      this.focusBoundWebContents(existingWebContentsId)
      return
    }

    const conversation = await this.getConversation(conversationId)
    if (!conversation) {
      throw new Error(`Conversation ${conversationId} not found`)
    }

    if (this.activeConversationBindings.get(webContentsId) === conversationId) {
      return
    }

    this.activeConversationBindings.set(webContentsId, conversationId)
    eventBus.sendToRenderer(CONVERSATION_EVENTS.ACTIVATED, SendTarget.ALL_WINDOWS, {
      conversationId,
      webContentsId
    })
  }

  async getActiveConversation(webContentsId: number): Promise<CONVERSATION | null> {
    const conversationId = this.activeConversationBindings.get(webContentsId)
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
    webContentsId: number,
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
          await this.setActiveConversation(latestConversation.id, webContentsId)
          return latestConversation.id
        }
      }

      let defaultSettings = DEFAULT_SETTINGS
      if (latestConversation?.settings) {
        defaultSettings = { ...latestConversation.settings }
        defaultSettings.systemPrompt = ''
        defaultSettings.reasoningEffort = undefined
        defaultSettings.selectedVariantsMap = {}
        defaultSettings.acpWorkdirMap = {}
        defaultSettings.agentWorkspacePath = null
        defaultSettings.activeSkills = []
      }

      // Apply global defaultModel if caller didn't specify model and no recent conversation settings
      const shouldApplyDefaultModel =
        !settings.modelId &&
        !settings.providerId &&
        !latestConversation?.settings &&
        !defaultSettings.acpWorkdirMap?.['default']

      if (shouldApplyDefaultModel) {
        const globalDefaultModel = this.configPresenter.getDefaultModel()
        if (globalDefaultModel?.modelId && globalDefaultModel?.providerId) {
          defaultSettings.modelId = globalDefaultModel.modelId
          defaultSettings.providerId = globalDefaultModel.providerId
        }
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
        this.activeConversationBindings.set(webContentsId, conversationId)
        eventBus.sendToRenderer(CONVERSATION_EVENTS.ACTIVATED, SendTarget.ALL_WINDOWS, {
          conversationId,
          webContentsId
        })
      } else {
        await this.setActiveConversation(conversationId, webContentsId)
      }

      await this.broadcastThreadListUpdate()
      return conversationId
    } catch (error) {
      console.error('ConversationManager: Failed to create conversation', {
        title,
        webContentsId,
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
    return this.getConversation(conversationId)
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
    let result: { total: number; list: CONVERSATION[] }
    try {
      result = await this.sqlitePresenter.getConversationList(1, this.fetchThreadLength)
    } catch (error) {
      if (this.isLegacyTableMissingError(error)) {
        console.info(
          '[ConversationManager] Skip legacy thread list broadcast: legacy tables not found.'
        )
        return
      }
      throw error
    }

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
