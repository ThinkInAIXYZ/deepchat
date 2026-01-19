import { type Ref } from 'vue'
import type { CONVERSATION, CONVERSATION_SETTINGS, ParentSelection } from '@shared/presenter'
import { usePresenter } from '@/composables/usePresenter'
import { clearCachedMessagesForThread, clearMessageDomInfo } from '@/lib/messageRuntimeCache'

/**
 * Thread management composable
 * Handles thread CRUD operations, branching, and child thread management
 */
export function useThreadManagement(
  activeThreadId: Ref<string | null>,
  _threads: Ref<{ dt: string; dtThreads: CONVERSATION[] }[]>,
  messageIds: Ref<string[]>,
  selectedVariantsMap: Ref<Record<string, string>>,
  childThreadsByMessageId: Ref<Map<string, CONVERSATION[]>>,
  pendingContextMentions: Ref<Map<string, any>>,
  pendingScrollTargetByConversation: Ref<Map<string, any>>,
  generatingThreadIds: Ref<Set<string>>,
  generatingMessagesCache: Ref<Map<string, { message: any; threadId: string }>>,
  configComposable: any,
  setActiveThreadId: (threadId: string | null) => void,
  setMessageIds: (ids: string[]) => void,
  getTabId: () => number
) {
  const threadP = usePresenter('sessionPresenter')

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
      const shouldAttachAcpWorkdir =
        (!normalizedSettings.acpWorkdirMap ||
          Object.keys(normalizedSettings.acpWorkdirMap).length === 0) &&
        normalizedSettings.providerId === 'acp' &&
        typeof normalizedSettings.modelId === 'string'

      if (shouldAttachAcpWorkdir && normalizedSettings.modelId) {
        const currentMap = configComposable.chatConfig.value.acpWorkdirMap || {}
        const pendingWorkdir = currentMap[normalizedSettings.modelId]
        if (pendingWorkdir) {
          normalizedSettings.acpWorkdirMap = {
            [normalizedSettings.modelId]: pendingWorkdir
          }
        }
      }

      if (normalizedSettings.agentWorkspacePath === undefined) {
        const pendingWorkspacePath = configComposable.chatConfig.value.agentWorkspacePath ?? null
        if (pendingWorkspacePath) {
          normalizedSettings.agentWorkspacePath = pendingWorkspacePath
        }
      }
      const threadId = await threadP.createConversation(title, normalizedSettings, getTabId())
      // 因为 createConversation 内部已经调用了 setActiveConversation
      // 并且可以确定是为当前tab激活，所以在这里可以直接、安全地更新本地状态
      // 以确保后续的 sendMessage 能正确获取 activeThreadId。
      setActiveThreadId(threadId)
      return threadId
    } catch (error) {
      console.error('Failed to create thread:', error)
      throw error
    }
  }

  /**
   * Set active thread
   * @param threadId Thread ID to activate
   */
  const setActiveThread = async (threadId: string) => {
    // 不在渲染进程进行逻辑判定（查重）和决策，只向主进程发送意图。
    // 主进程会处理"防重"逻辑，并通过 'ACTIVATED' 事件来通知UI更新。
    // 如果主进程决定切换到其他tab，当前tab不会收到此事件，状态也就不会被错误地更新。
    const tabId = getTabId()
    await threadP.setActiveConversation(threadId, tabId)
  }

  /**
   * Open thread in a new tab
   * @param threadId Thread ID
   * @param options Optional message ID and child conversation ID
   */
  const openThreadInNewTab = async (
    threadId: string,
    options?: { messageId?: string; childConversationId?: string }
  ) => {
    if (!threadId) return
    try {
      const tabId = getTabId()
      await threadP.openConversationInNewTab({
        conversationId: threadId,
        tabId,
        messageId: options?.messageId,
        childConversationId: options?.childConversationId
      })
    } catch (error) {
      console.error('Failed to open thread in new tab:', error)
    }
  }

  /**
   * Clear active thread and all related state
   */
  const clearActiveThread = async () => {
    const threadId = activeThreadId.value
    if (!threadId) return
    const tabId = getTabId()
    await threadP.clearActiveThread(tabId)
    setActiveThreadId(null)
    setMessageIds([])
    clearCachedMessagesForThread(threadId)
    clearMessageDomInfo()
    selectedVariantsMap.value = {}
    childThreadsByMessageId.value = new Map()
    pendingContextMentions.value = new Map()
    pendingScrollTargetByConversation.value = new Map()
    configComposable.resetChatConfig()
  }

  /**
   * Clear thread caches for a specific thread
   * @param threadId Thread ID to clear caches for
   */
  const clearThreadCachesForTab = (threadId: string | null) => {
    if (threadId) {
      clearCachedMessagesForThread(threadId)
      if (!generatingThreadIds.value.has(threadId)) {
        const cache = generatingMessagesCache.value
        for (const [messageId, cached] of cache.entries()) {
          if (cached.threadId === threadId) {
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
   * Fork a thread from a specific message
   * @param messageId Message ID to fork from
   * @param forkTag Tag to append to forked thread title
   */
  const forkThread = async (messageId: string, forkTag: string = '(fork)') => {
    const activeThread = activeThreadId.value
    if (!activeThread) return

    try {
      // 获取当前会话信息
      const currentThread = await threadP.getConversation(activeThread)

      // 创建分支会话标题
      const newThreadTitle = `${currentThread.title} ${forkTag}`

      // 调用main层的forkConversation方法
      const newThreadId = await threadP.forkConversation(
        activeThread,
        messageId,
        newThreadTitle,
        currentThread.settings,
        selectedVariantsMap.value
      )

      // 切换到新会话
      await setActiveThread(newThreadId)

      return newThreadId
    } catch (error) {
      console.error('Failed to create thread branch:', error)
      throw error
    }
  }

  /**
   * Create a child thread from text selection
   * @param payload Parent message ID and selection details
   */
  const createChildThreadFromSelection = async (payload: {
    parentMessageId: string
    parentSelection: ParentSelection
  }) => {
    const activeThread = activeThreadId.value
    if (!activeThread) return

    try {
      const parentThreadId = activeThread
      const parentConversation = await threadP.getConversation(activeThread)
      const selectionSnippet = payload.parentSelection.selectedText
        .trim()
        .replace(/\s+/g, ' ')
        .slice(0, 48)
      const title = selectionSnippet
        ? `${parentConversation.title} - ${selectionSnippet}`
        : parentConversation.title

      const newThreadId = await threadP.createChildConversationFromSelection({
        parentConversationId: activeThread,
        parentMessageId: payload.parentMessageId,
        parentSelection: payload.parentSelection,
        title,
        settings: parentConversation.settings,
        tabId: getTabId(),
        openInNewTab: true
      })

      if (!newThreadId) {
        return
      }

      if (activeThreadId.value === parentThreadId) {
        await refreshChildThreadsForActiveThread()
      }
      return newThreadId
    } catch (error) {
      console.error('Failed to create child thread from selection:', error)
      throw error
    }
  }

  /**
   * Refresh child threads for the active thread
   */
  const refreshChildThreadsForActiveThread = async () => {
    const threadId = activeThreadId.value
    if (!threadId) {
      childThreadsByMessageId.value = new Map()
      return
    }

    const msgIds = messageIds.value
    if (msgIds.length === 0) {
      childThreadsByMessageId.value = new Map()
      return
    }

    const childThreads = (await threadP.listChildConversationsByMessageIds(msgIds)) || []
    const nextMap = new Map<string, CONVERSATION[]>()
    for (const child of childThreads) {
      if (!child.parentMessageId) continue
      if (child.parentConversationId && child.parentConversationId !== threadId) continue
      const existing = nextMap.get(child.parentMessageId) ?? []
      existing.push(child)
      nextMap.set(child.parentMessageId, existing)
    }
    childThreadsByMessageId.value = nextMap
  }

  /**
   * Rename a thread
   * @param threadId Thread ID
   * @param title New title
   */
  const renameThread = async (threadId: string, title: string) => {
    await threadP.renameConversation(threadId, title)
  }

  /**
   * Toggle thread pinned status
   * @param threadId Thread ID
   * @param isPinned New pinned status
   */
  const toggleThreadPinned = async (threadId: string, isPinned: boolean) => {
    await threadP.toggleConversationPinned(threadId, isPinned)
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
