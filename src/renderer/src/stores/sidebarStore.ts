import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import { usePresenter } from '@/composables/usePresenter'
import { useConversationCore } from '@/composables/chat/useConversationCore'
import { CONVERSATION_EVENTS } from '@/events'

/**
 * Minimal conversation metadata for sidebar tabs
 */
export interface ConversationMeta {
  id: string
  title: string
  isLoading?: boolean
  hasError?: boolean
  modelIcon?: string
}

/**
 * Persisted sidebar state
 */
interface PersistedSidebarState {
  openConversationIds: string[]
}

export const useSidebarStore = defineStore('sidebar', () => {
  const conversationCore = useConversationCore()
  const configP = usePresenter('configPresenter')

  // State
  const conversations = ref<Map<string, ConversationMeta>>(new Map())
  const tabOrder = ref<string[]>([])
  let cleanupListeners: (() => void) | null = null

  // Getters
  const sortedConversations = computed(() => {
    return tabOrder.value
      .map((id) => conversations.value.get(id))
      .filter((c): c is ConversationMeta => c !== undefined)
  })

  // Actions
  async function openConversation(threadId: string, title?: string): Promise<void> {
    // Only update sidebar state, don't navigate
    // Navigation will be handled by caller using useConversationNavigation
    if (!conversations.value.has(threadId)) {
      conversations.value.set(threadId, {
        id: threadId,
        title: title || 'New Conversation'
      })
      tabOrder.value.push(threadId)
    }
    persistState()
  }

  function closeConversation(
    threadId: string,
    activeConversationId?: string | null
  ): string | null {
    const isClosingActive = activeConversationId === threadId
    const idx = tabOrder.value.indexOf(threadId)

    // Remove from state
    conversations.value.delete(threadId)
    tabOrder.value = tabOrder.value.filter((id) => id !== threadId)

    persistState()

    if (!isClosingActive) return null

    return tabOrder.value[idx] || tabOrder.value[idx - 1] || null
  }

  function reorderConversations(fromIndex: number, toIndex: number): void {
    if (fromIndex < 0 || fromIndex >= tabOrder.value.length) return
    if (toIndex < 0 || toIndex >= tabOrder.value.length) return

    const item = tabOrder.value.splice(fromIndex, 1)[0]
    tabOrder.value.splice(toIndex, 0, item)
    persistState()
  }

  async function refreshConversationMeta(threadId: string): Promise<void> {
    const existing = conversations.value.get(threadId)
    if (!existing) return

    try {
      const conversation = await conversationCore.getConversation(threadId)
      if (conversation) {
        conversations.value.set(threadId, {
          id: threadId,
          title: conversation.title || 'New Conversation',
          modelIcon: conversation.settings?.modelId
        })
      }
    } catch (e) {
      console.error(`Failed to refresh conversation meta ${threadId}:`, e)
    }
  }

  function persistState(): void {
    const state: PersistedSidebarState = {
      openConversationIds: tabOrder.value
    }

    try {
      configP.setSetting('chatWindow.sidebarState', state)
    } catch (e) {
      console.error('Failed to persist sidebar state:', e)
    }
  }

  async function restoreState(): Promise<void> {
    try {
      const state = (await configP.getSetting(
        'chatWindow.sidebarState'
      )) as PersistedSidebarState | null

      if (!state) return

      // Restore conversations (titles will be loaded lazily)
      for (const id of state.openConversationIds || []) {
        conversations.value.set(id, {
          id,
          title: 'Loading...'
        })
      }

      tabOrder.value = state.openConversationIds || []
    } catch (e) {
      console.error('Failed to restore sidebar state:', e)
    }
  }

  /**
   * Update conversation title from external event (e.g., LIST_UPDATED)
   */
  function updateConversationTitle(threadId: string, title: string): void {
    const existing = conversations.value.get(threadId)
    if (existing) {
      conversations.value.set(threadId, { ...existing, title })
    }
  }

  /**
   * Add a conversation to the sidebar if not already present
   */
  function ensureConversation(threadId: string, title?: string): void {
    if (!conversations.value.has(threadId)) {
      conversations.value.set(threadId, {
        id: threadId,
        title: title || 'New Conversation'
      })
      tabOrder.value.push(threadId)
      persistState()
    }
  }

  /**
   * Setup event listeners for conversation updates
   */
  function bindEventListeners(): () => void {
    if (cleanupListeners) return cleanupListeners
    const unsubscribers: Array<() => void> = []

    // Listen for conversation list updates to sync titles
    const listUpdatedHandler = (
      _: unknown,
      updatedGroupedList: { dt: string; dtThreads: { id: string; title: string }[] }[]
    ) => {
      const flatList = updatedGroupedList.flatMap((g) => g.dtThreads)
      for (const thread of flatList) {
        const existing = conversations.value.get(thread.id)
        if (existing && existing.title !== thread.title) {
          updateConversationTitle(thread.id, thread.title)
        }
      }
    }
    window.electron.ipcRenderer.on(CONVERSATION_EVENTS.LIST_UPDATED, listUpdatedHandler)
    unsubscribers.push(() => {
      window.electron.ipcRenderer.removeListener(
        CONVERSATION_EVENTS.LIST_UPDATED,
        listUpdatedHandler
      )
    })

    // Listen for conversation activation to ensure it's in sidebar
    const activatedHandler = (_: unknown, msg: { conversationId?: string }) => {
      if (msg.conversationId) {
        ensureConversation(msg.conversationId)
      }
    }
    window.electron.ipcRenderer.on(CONVERSATION_EVENTS.ACTIVATED, activatedHandler)
    unsubscribers.push(() => {
      window.electron.ipcRenderer.removeListener(CONVERSATION_EVENTS.ACTIVATED, activatedHandler)
    })

    cleanupListeners = () => {
      unsubscribers.forEach((unsubscribe) => unsubscribe())
      cleanupListeners = null
    }

    return cleanupListeners
  }

  return {
    // State
    conversations,
    tabOrder,
    // Getters
    sortedConversations,
    // Actions
    openConversation,
    closeConversation,
    reorderConversations,
    refreshConversationMeta,
    restoreState,
    updateConversationTitle,
    ensureConversation,
    persistState,
    bindEventListeners
  }
})
