import { defineStore } from 'pinia'
import { ref, computed, onMounted } from 'vue'
import { usePresenter } from '@/composables/usePresenter'
import { useConversationCore } from '@/composables/chat/useConversationCore'
import { useRouter } from 'vue-router'
import { useChatStore } from './chat'
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
  const router = useRouter()
  const chatStore = useChatStore()

  // State
  const conversations = ref<Map<string, ConversationMeta>>(new Map())
  const tabOrder = ref<string[]>([])

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

  async function closeConversation(threadId: string): Promise<void> {
    const isClosingActive = router.currentRoute.value.params.id === threadId
    const idx = tabOrder.value.indexOf(threadId)

    // Remove from state
    conversations.value.delete(threadId)
    tabOrder.value = tabOrder.value.filter((id) => id !== threadId)

    // Navigate to adjacent tab if closing active conversation
    if (isClosingActive) {
      const nextId = tabOrder.value[idx] || tabOrder.value[idx - 1]
      router.push(nextId ? `/conversation/${nextId}` : '/new')
    }

    persistState()
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

  function goHome(): void {
    chatStore.setActiveThreadId(null)
    router.push('/home')
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
  function setupEventListeners(): void {
    // Listen for conversation list updates to sync titles
    window.electron.ipcRenderer.on(
      CONVERSATION_EVENTS.LIST_UPDATED,
      (_, updatedGroupedList: { dt: string; dtThreads: { id: string; title: string }[] }[]) => {
        const flatList = updatedGroupedList.flatMap((g) => g.dtThreads)
        for (const thread of flatList) {
          const existing = conversations.value.get(thread.id)
          if (existing && existing.title !== thread.title) {
            updateConversationTitle(thread.id, thread.title)
          }
        }
      }
    )

    // Listen for conversation activation to ensure it's in sidebar
    window.electron.ipcRenderer.on(CONVERSATION_EVENTS.ACTIVATED, (_, msg) => {
      if (msg.conversationId) {
        ensureConversation(msg.conversationId)
      }
    })
  }

  // Setup listeners when store is created
  onMounted(() => {
    setupEventListeners()
  })

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
    goHome,
    updateConversationTitle,
    ensureConversation,
    persistState
  }
})
