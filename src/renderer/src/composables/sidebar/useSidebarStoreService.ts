import { computed, ref } from 'vue'
import { useConversationCore } from '@/composables/chat/useConversationCore'
import {
  useSidebarAdapter,
  type ConversationActivatedPayload,
  type ConversationListPayload
} from '@/composables/sidebar/useSidebarAdapter'

export interface ConversationMeta {
  id: string
  title: string
  isLoading?: boolean
  hasError?: boolean
  modelIcon?: string
}

interface PersistedSidebarState {
  openConversationIds: string[]
}

export const useSidebarStoreService = () => {
  const conversationCore = useConversationCore()
  const sidebarAdapter = useSidebarAdapter()

  const conversations = ref<Map<string, ConversationMeta>>(new Map())
  const tabOrder = ref<string[]>([])
  let cleanupListeners: (() => void) | null = null

  const sortedConversations = computed(() => {
    return tabOrder.value
      .map((id) => conversations.value.get(id))
      .filter((conversation): conversation is ConversationMeta => conversation !== undefined)
  })

  async function openConversation(threadId: string, title?: string): Promise<void> {
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
    } catch (err) {
      console.error(`Failed to refresh conversation meta ${threadId}:`, err)
    }
  }

  function persistState(): void {
    const state: PersistedSidebarState = {
      openConversationIds: tabOrder.value
    }

    sidebarAdapter.setSetting('chatWindow.sidebarState', state).catch((err) => {
      console.error('Failed to persist sidebar state:', err)
    })
  }

  async function restoreState(): Promise<void> {
    try {
      const state = (await sidebarAdapter.getSetting(
        'chatWindow.sidebarState'
      )) as PersistedSidebarState | null

      if (!state) return

      for (const id of state.openConversationIds || []) {
        conversations.value.set(id, {
          id,
          title: 'Loading...'
        })
      }

      tabOrder.value = state.openConversationIds || []
    } catch (err) {
      console.error('Failed to restore sidebar state:', err)
    }
  }

  function updateConversationTitle(threadId: string, title: string): void {
    const existing = conversations.value.get(threadId)
    if (existing) {
      conversations.value.set(threadId, { ...existing, title })
    }
  }

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

  function bindEventListeners(): () => void {
    if (cleanupListeners) return cleanupListeners

    const listUpdatedHandler = (updatedGroupedList: ConversationListPayload) => {
      const flatList = updatedGroupedList.flatMap((group) => group.dtThreads)
      for (const thread of flatList) {
        const existing = conversations.value.get(thread.id)
        if (existing && existing.title !== thread.title) {
          updateConversationTitle(thread.id, thread.title)
        }
      }
    }

    const activatedHandler = (payload: ConversationActivatedPayload) => {
      if (payload.conversationId) {
        ensureConversation(payload.conversationId)
      }
    }

    const unsubscribers = [
      sidebarAdapter.onConversationListUpdated(listUpdatedHandler),
      sidebarAdapter.onConversationActivated(activatedHandler)
    ]

    cleanupListeners = () => {
      unsubscribers.forEach((unsubscribe) => unsubscribe())
      cleanupListeners = null
    }

    return cleanupListeners
  }

  return {
    conversations,
    tabOrder,
    sortedConversations,
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
}
