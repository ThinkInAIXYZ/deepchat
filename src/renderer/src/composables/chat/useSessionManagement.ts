import { type Ref } from 'vue'
import type { CONVERSATION, CONVERSATION_SETTINGS, ParentSelection } from '@shared/presenter'
import { useConversationCore } from '@/composables/chat/useConversationCore'
import { clearCachedMessagesForThread, clearMessageDomInfo } from '@/lib/messageRuntimeCache'

/**
 * Session management composable
 * Handles session CRUD operations, branching, and child session management
 */
export function useSessionManagement(
  activeSessionId: Ref<string | null>,
  _sessions: Ref<{ dt: string; dtThreads: CONVERSATION[] }[]>,
  messageIds: Ref<string[]>,
  selectedVariantsMap: Ref<Record<string, string>>,
  childThreadsByMessageId: Ref<Map<string, CONVERSATION[]>>,
  pendingContextMentions: Ref<Map<string, any>>,
  pendingScrollTargetByConversation: Ref<Map<string, any>>,
  generatingSessionIds: Ref<Set<string>>,
  generatingMessagesCache: Ref<Map<string, { message: any; sessionId: string }>>,
  configComposable: any,
  setActiveSessionId: (sessionId: string | null) => void,
  setMessageIds: (ids: string[]) => void,
  getTabId: () => number
) {
  const conversationCore = useConversationCore()

  /**
   * Create a new empty thread by clearing the active thread
   */
  const createNewEmptyThread = async () => {
    try {
      await clearActiveThread()
    } catch (error) {
      console.error('Failed to clear active thread and load first page:', error)
      throw error
    }
  }

  /**
   * Create a new thread with settings
   * @param title Thread title
   * @param settings Thread settings
   */
  const createThread = async (title: string, settings: Partial<CONVERSATION_SETTINGS>) => {
    try {
      const normalizedSettings: Partial<CONVERSATION_SETTINGS> = { ...settings }

      if (normalizedSettings.agentWorkspacePath === undefined) {
        const pendingWorkspacePath = configComposable.chatConfig.value.agentWorkspacePath ?? null
        if (pendingWorkspacePath) {
          normalizedSettings.agentWorkspacePath = pendingWorkspacePath
        }
      }
      const sessionId = await conversationCore.createConversation(
        title,
        normalizedSettings,
        getTabId()
      )
      // 因为 createConversation 内部已经调用了 setActiveConversation
      // 并且可以确定是为当前tab激活，所以在这里可以直接、安全地更新本地状态
      // 以确保后续的 sendMessage 能正确获取 activeSessionId。
      setActiveSessionId(sessionId)
      return sessionId
    } catch (error) {
      console.error('Failed to create thread:', error)
      throw error
    }
  }

  /**
   * Set active session
   * @param sessionId Session ID to activate
   */
  const setActiveThread = async (sessionId: string) => {
    // 不在渲染进程进行逻辑判定（查重）和决策，只向主进程发送意图。
    // 主进程会处理"防重"逻辑，并通过 'ACTIVATED' 事件来通知UI更新。
    // 如果主进程决定切换到其他tab，当前tab不会收到此事件，状态也就不会被错误地更新。
    const tabId = getTabId()
    await conversationCore.setActiveConversation(sessionId, tabId)
  }

  /**
   * Open session in a new tab
   * @param sessionId Session ID
   * @param options Optional message ID and child conversation ID
   */
  const openThreadInNewTab = async (
    sessionId: string,
    options?: { messageId?: string; childConversationId?: string }
  ) => {
    if (!sessionId) return
    try {
      const tabId = getTabId()
      const openOptions = options?.messageId
        ? { messageId: options.messageId }
        : options?.childConversationId
          ? { childConversationId: options.childConversationId }
          : undefined
      await conversationCore.openConversationInNewTab(sessionId, tabId, openOptions)
    } catch (error) {
      console.error('Failed to open thread in new tab:', error)
    }
  }

  /**
   * Clear active session and all related state
   */
  const clearActiveThread = async () => {
    const sessionId = activeSessionId.value
    if (!sessionId) return
    const tabId = getTabId()
    await conversationCore.clearActiveThread(tabId)
    setActiveSessionId(null)
    setMessageIds([])
    clearCachedMessagesForThread(sessionId)
    clearMessageDomInfo()
    selectedVariantsMap.value = {}
    childThreadsByMessageId.value = new Map()
    pendingContextMentions.value = new Map()
    pendingScrollTargetByConversation.value = new Map()
    configComposable.resetChatConfig()
  }

  /**
   * Clear session caches for a specific session
   * @param sessionId Session ID to clear caches for
   */
  const clearThreadCachesForTab = (sessionId: string | null) => {
    if (sessionId) {
      clearCachedMessagesForThread(sessionId)
      if (!generatingSessionIds.value.has(sessionId)) {
        const cache = generatingMessagesCache.value
        for (const [messageId, cached] of cache.entries()) {
          if (cached.sessionId === sessionId) {
            cache.delete(messageId)
          }
        }
      }
    }
    setMessageIds([])
    clearMessageDomInfo()
    selectedVariantsMap.value = {}
    childThreadsByMessageId.value = new Map()
    pendingContextMentions.value = new Map()
    pendingScrollTargetByConversation.value = new Map()
    configComposable.resetChatConfig()
  }

  /**
   * Fork a session from a specific message
   * @param messageId Message ID to fork from
   * @param forkTag Tag to append to forked session title
   */
  const forkThread = async (messageId: string, forkTag: string = '(fork)') => {
    const activeSession = activeSessionId.value
    if (!activeSession) return

    try {
      // 获取当前会话信息
      const currentSession = await conversationCore.getConversation(activeSession)

      // 创建分支会话标题
      const newSessionTitle = `${currentSession.title} ${forkTag}`

      // 调用main层的forkConversation方法
      const newSessionId = await conversationCore.forkConversation(
        activeSession,
        messageId,
        newSessionTitle,
        currentSession.settings,
        selectedVariantsMap.value
      )

      // 切换到新会话
      await setActiveThread(newSessionId)

      return newSessionId
    } catch (error) {
      console.error('Failed to create session branch:', error)
      throw error
    }
  }

  /**
   * Create a child session from text selection
   * @param payload Parent message ID and selection details
   */
  const createChildThreadFromSelection = async (payload: {
    parentMessageId: string
    parentSelection: ParentSelection
  }) => {
    const activeSession = activeSessionId.value
    if (!activeSession) return

    try {
      const parentSessionId = activeSession
      const parentConversation = await conversationCore.getConversation(activeSession)
      const selectionSnippet = payload.parentSelection.selectedText
        .trim()
        .replace(/\s+/g, ' ')
        .slice(0, 48)
      const title = selectionSnippet
        ? `${parentConversation.title} - ${selectionSnippet}`
        : parentConversation.title

      const newSessionId = await conversationCore.createChildConversationFromSelection({
        parentConversationId: activeSession,
        parentMessageId: payload.parentMessageId,
        parentSelection: payload.parentSelection,
        title,
        settings: parentConversation.settings,
        tabId: getTabId(),
        openInNewTab: true
      })

      if (!newSessionId) {
        return
      }

      if (activeSessionId.value === parentSessionId) {
        await refreshChildThreadsForActiveThread()
      }
      return newSessionId
    } catch (error) {
      console.error('Failed to create child session from selection:', error)
      throw error
    }
  }

  /**
   * Refresh child sessions for the active session
   */
  const refreshChildThreadsForActiveThread = async () => {
    const sessionId = activeSessionId.value
    if (!sessionId) {
      childThreadsByMessageId.value = new Map()
      return
    }

    const msgIds = messageIds.value
    if (msgIds.length === 0) {
      childThreadsByMessageId.value = new Map()
      return
    }

    const childThreads = (await conversationCore.listChildConversationsByMessageIds(msgIds)) || []
    const nextMap = new Map<string, CONVERSATION[]>()
    for (const child of childThreads) {
      if (!child.parentMessageId) continue
      if (child.parentConversationId && child.parentConversationId !== sessionId) continue
      const existing = nextMap.get(child.parentMessageId) ?? []
      existing.push(child)
      nextMap.set(child.parentMessageId, existing)
    }
    childThreadsByMessageId.value = nextMap
  }

  /**
   * Rename a session
   * @param sessionId Session ID
   * @param title New title
   */
  const renameThread = async (sessionId: string, title: string) => {
    await conversationCore.renameConversation(sessionId, title)
  }

  /**
   * Toggle session pinned status
   * @param sessionId Session ID
   * @param isPinned New pinned status
   */
  const toggleThreadPinned = async (sessionId: string, isPinned: boolean) => {
    await conversationCore.toggleConversationPinned(sessionId, isPinned)
  }

  return {
    // Thread CRUD
    createNewEmptyThread,
    createThread,
    setActiveThread,
    openThreadInNewTab,
    clearActiveThread,
    clearThreadCachesForTab,
    renameThread,
    toggleThreadPinned,

    // Thread branching
    forkThread,
    createChildThreadFromSelection,

    // Child threads
    refreshChildThreadsForActiveThread
  }
}
