import type {
  CONVERSATION_SETTINGS,
  MESSAGE_METADATA,
  MESSAGE_STATUS,
  ParentSelection
} from '@shared/presenter'
import { usePresenter } from '@/composables/usePresenter'

type OpenConversationOptions =
  | { messageId: string; childConversationId?: never }
  | { messageId?: never; childConversationId: string }
  | { messageId?: never; childConversationId?: never }

type CreateConversationOptions = {
  forceNewAndActivate?: boolean
}

/**
 * Conversation core adapter for session presenter interactions.
 */
export function useConversationCore() {
  const sessionPresenter = usePresenter('sessionPresenter')

  const ensureNonEmptyString = (value: string, label: string) => {
    if (typeof value !== 'string' || !value.trim()) {
      throw new Error(`${label} is required`)
    }
  }

  const ensureTabId = (tabId: number) => {
    if (!Number.isInteger(tabId) || tabId < 0) {
      throw new Error('Invalid tab ID')
    }
  }

  const ensurePage = (page: number, pageSize: number) => {
    if (!Number.isInteger(page) || page < 0) {
      throw new Error('Invalid page')
    }
    if (!Number.isInteger(pageSize) || pageSize <= 0) {
      throw new Error('Invalid page size')
    }
  }

  const wrap = async <T>(label: string, fn: () => Promise<T>) => {
    try {
      return await fn()
    } catch (error) {
      console.error(`[ConversationCore] ${label} failed`, error)
      throw error
    }
  }

  const createConversation = async (
    title: string,
    settings: Partial<CONVERSATION_SETTINGS>,
    tabId: number,
    options?: CreateConversationOptions
  ) => {
    ensureNonEmptyString(title, 'Conversation title')
    ensureTabId(tabId)
    return wrap('createConversation', () =>
      sessionPresenter.createConversation(title, settings, tabId, options)
    )
  }

  const getConversation = (conversationId: string) => {
    ensureNonEmptyString(conversationId, 'Conversation ID')
    return sessionPresenter.getConversation(conversationId)
  }

  const getConversationList = (page: number, pageSize: number) => {
    ensurePage(page, pageSize)
    return sessionPresenter.getConversationList(page, pageSize)
  }

  const loadMoreThreads = () => {
    return sessionPresenter.loadMoreThreads()
  }

  const getActiveConversation = (tabId: number) => {
    ensureTabId(tabId)
    return sessionPresenter.getActiveConversation(tabId)
  }

  const getActiveConversationId = (tabId: number) => {
    ensureTabId(tabId)
    return sessionPresenter.getActiveConversationId(tabId)
  }

  const findTabForConversation = (conversationId: string) => {
    ensureNonEmptyString(conversationId, 'Conversation ID')
    return sessionPresenter.findTabForConversation(conversationId)
  }

  const renameConversation = async (conversationId: string, title: string) => {
    ensureNonEmptyString(conversationId, 'Conversation ID')
    ensureNonEmptyString(title, 'Conversation title')
    return wrap('renameConversation', () =>
      sessionPresenter.renameConversation(conversationId, title)
    )
  }

  const updateConversationSettings = (
    conversationId: string,
    settings: Partial<CONVERSATION_SETTINGS>
  ) => {
    return sessionPresenter.updateConversationSettings(conversationId, settings)
  }

  const deleteConversation = (conversationId: string) => {
    ensureNonEmptyString(conversationId, 'Conversation ID')
    return sessionPresenter.deleteConversation(conversationId)
  }

  const toggleConversationPinned = (conversationId: string, isPinned: boolean) => {
    ensureNonEmptyString(conversationId, 'Conversation ID')
    return sessionPresenter.toggleConversationPinned(conversationId, isPinned)
  }

  const getMessageThread = (conversationId: string, page: number, pageSize: number) => {
    ensureNonEmptyString(conversationId, 'Conversation ID')
    ensurePage(page, pageSize)
    return sessionPresenter.getMessageThread(conversationId, page, pageSize)
  }

  const getMessageIds = (conversationId: string) => {
    ensureNonEmptyString(conversationId, 'Conversation ID')
    return sessionPresenter.getMessageIds(conversationId)
  }

  const getMessage = (messageId: string) => {
    ensureNonEmptyString(messageId, 'Message ID')
    return sessionPresenter.getMessage(messageId)
  }

  const getMessagesByIds = (messageIds: string[]) => {
    if (!Array.isArray(messageIds) || messageIds.length === 0) {
      throw new Error('Message IDs are required')
    }
    return sessionPresenter.getMessagesByIds(messageIds)
  }

  const editMessage = (messageId: string, content: string) => {
    ensureNonEmptyString(messageId, 'Message ID')
    ensureNonEmptyString(content, 'Message content')
    return sessionPresenter.editMessage(messageId, content)
  }

  const deleteMessage = (messageId: string) => {
    ensureNonEmptyString(messageId, 'Message ID')
    return sessionPresenter.deleteMessage(messageId)
  }

  const clearAllMessages = (conversationId: string) => {
    ensureNonEmptyString(conversationId, 'Conversation ID')
    return sessionPresenter.clearAllMessages(conversationId)
  }

  const getContextMessages = (conversationId: string) => {
    ensureNonEmptyString(conversationId, 'Conversation ID')
    return sessionPresenter.getContextMessages(conversationId)
  }

  const getMessageVariants = (messageId: string) => {
    ensureNonEmptyString(messageId, 'Message ID')
    return sessionPresenter.getMessageVariants(messageId)
  }

  const getMessageExtraInfo = (messageId: string, type: string) => {
    ensureNonEmptyString(messageId, 'Message ID')
    ensureNonEmptyString(type, 'Extra info type')
    return sessionPresenter.getMessageExtraInfo(messageId, type)
  }

  const getMainMessageByParentId = (conversationId: string, parentId: string) => {
    ensureNonEmptyString(conversationId, 'Conversation ID')
    ensureNonEmptyString(parentId, 'Parent message ID')
    return sessionPresenter.getMainMessageByParentId(conversationId, parentId)
  }

  const getSearchResults = (messageId: string, searchId?: string) => {
    ensureNonEmptyString(messageId, 'Message ID')
    return sessionPresenter.getSearchResults(messageId, searchId)
  }

  const updateMessageStatus = (messageId: string, status: MESSAGE_STATUS) => {
    ensureNonEmptyString(messageId, 'Message ID')
    return sessionPresenter.updateMessageStatus(messageId, status)
  }

  const updateMessageMetadata = (messageId: string, metadata: Partial<MESSAGE_METADATA>) => {
    ensureNonEmptyString(messageId, 'Message ID')
    return sessionPresenter.updateMessageMetadata(messageId, metadata)
  }

  const markMessageAsContextEdge = (messageId: string, isEdge: boolean) => {
    ensureNonEmptyString(messageId, 'Message ID')
    return sessionPresenter.markMessageAsContextEdge(messageId, isEdge)
  }

  const setActiveConversation = (conversationId: string, tabId: number) => {
    ensureNonEmptyString(conversationId, 'Conversation ID')
    ensureTabId(tabId)
    return sessionPresenter.setActiveConversation(conversationId, tabId)
  }

  const openConversationInNewTab = async (
    conversationId: string,
    tabId: number,
    options?: OpenConversationOptions
  ) => {
    ensureNonEmptyString(conversationId, 'Conversation ID')
    ensureTabId(tabId)
    if (options?.messageId && options?.childConversationId) {
      throw new Error('messageId and childConversationId are mutually exclusive')
    }
    return wrap('openConversationInNewTab', () =>
      sessionPresenter.openConversationInNewTab({
        conversationId,
        tabId,
        messageId: options?.messageId,
        childConversationId: options?.childConversationId
      })
    )
  }

  const clearActiveThread = (tabId: number) => {
    ensureTabId(tabId)
    return sessionPresenter.clearActiveThread(tabId)
  }

  const forkConversation = async (
    targetConversationId: string,
    targetMessageId: string,
    newTitle: string,
    settings?: Partial<CONVERSATION_SETTINGS>,
    selectedVariantsMap?: Record<string, string>
  ) => {
    ensureNonEmptyString(targetConversationId, 'Conversation ID')
    ensureNonEmptyString(targetMessageId, 'Message ID')
    ensureNonEmptyString(newTitle, 'Conversation title')
    return wrap('forkConversation', () =>
      sessionPresenter.forkConversation(
        targetConversationId,
        targetMessageId,
        newTitle,
        settings,
        selectedVariantsMap
      )
    )
  }

  const createChildConversationFromSelection = async (payload: {
    parentConversationId: string
    parentMessageId: string
    parentSelection: ParentSelection | string
    title: string
    settings?: Partial<CONVERSATION_SETTINGS>
    tabId?: number
    openInNewTab?: boolean
  }) => {
    ensureNonEmptyString(payload.parentConversationId, 'Conversation ID')
    ensureNonEmptyString(payload.parentMessageId, 'Message ID')
    ensureNonEmptyString(payload.title, 'Conversation title')
    if (payload.tabId !== undefined) {
      ensureTabId(payload.tabId)
    }
    return wrap('createChildConversationFromSelection', () =>
      sessionPresenter.createChildConversationFromSelection(payload)
    )
  }

  const listChildConversationsByMessageIds = (messageIds: string[]) => {
    if (!Array.isArray(messageIds) || messageIds.length === 0) {
      throw new Error('Message IDs are required')
    }
    return sessionPresenter.listChildConversationsByMessageIds(messageIds)
  }

  return {
    createConversation,
    getConversation,
    getConversationList,
    loadMoreThreads,
    getActiveConversation,
    getActiveConversationId,
    findTabForConversation,
    renameConversation,
    updateConversationSettings,
    deleteConversation,
    toggleConversationPinned,
    getMessageThread,
    getMessageIds,
    getMessage,
    getMessagesByIds,
    editMessage,
    deleteMessage,
    clearAllMessages,
    getContextMessages,
    getMessageVariants,
    getMessageExtraInfo,
    getMainMessageByParentId,
    getSearchResults,
    updateMessageStatus,
    updateMessageMetadata,
    markMessageAsContextEdge,
    setActiveConversation,
    openConversationInNewTab,
    clearActiveThread,
    forkConversation,
    createChildConversationFromSelection,
    listChildConversationsByMessageIds
  }
}
