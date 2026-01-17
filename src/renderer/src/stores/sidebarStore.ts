import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import { usePresenter } from '@/composables/usePresenter'
import { useRouter } from 'vue-router'
import type { CONVERSATION } from '@shared/presenter'

/**
 * Metadata for a conversation tab in the sidebar
 */
export interface ConversationMeta {
  id: string
  title: string
  lastMessageAt: Date
  isLoading: boolean
  hasError: boolean
  modelIcon?: string // modelId for agent mode, agentId for acp-agent mode
  chatMode?: 'chat' | 'agent' | 'acp agent' // Chat mode for icon resolution
  providerId?: string // Provider ID for additional context
}

/**
 * Persisted sidebar state structure
 */
interface PersistedSidebarState {
  openConversationIds: string[]
  lastActiveConversationId?: string
  ui: {
    width: number
    collapsed: boolean
  }
}

export const useSidebarStore = defineStore('sidebar', () => {
  const sessionP = usePresenter('sessionPresenter')
  const configP = usePresenter('configPresenter')
  const router = useRouter()

  // State
  const openConversations = ref<Map<string, ConversationMeta>>(new Map())
  const tabOrder = ref<string[]>([])
  const width = ref(240)
  const collapsed = ref(false)
  const isInitialized = ref(false)

  // Getters
  const sortedConversations = computed(() => {
    return tabOrder.value
      .map((id) => openConversations.value.get(id))
      .filter((c): c is ConversationMeta => c !== undefined)
  })

  const conversationCount = computed(() => openConversations.value.size)

  const hasOpenConversations = computed(() => openConversations.value.size > 0)

  // Actions
  async function openConversation(threadId: string): Promise<void> {
    if (!openConversations.value.has(threadId)) {
      // Set loading state
      openConversations.value.set(threadId, {
        id: threadId,
        title: 'Loading...',
        lastMessageAt: new Date(),
        isLoading: true,
        hasError: false
      })
      tabOrder.value.push(threadId)

      try {
        const meta = (await sessionP.getConversation(threadId)) as CONVERSATION | null
        if (meta) {
          openConversations.value.set(threadId, {
            id: threadId,
            title: meta.title || 'New Conversation',
            lastMessageAt: new Date(meta.updatedAt),
            isLoading: false,
            hasError: false,
            modelIcon: meta.settings?.modelId,
            chatMode: meta.settings?.chatMode || 'agent',
            providerId: meta.settings?.providerId
          })
        } else {
          // Conversation not found
          openConversations.value.set(threadId, {
            id: threadId,
            title: 'Not Found',
            lastMessageAt: new Date(),
            isLoading: false,
            hasError: true
          })
        }
      } catch (e) {
        console.error(`Failed to load conversation ${threadId}:`, e)
        openConversations.value.set(threadId, {
          id: threadId,
          title: 'Error',
          lastMessageAt: new Date(),
          isLoading: false,
          hasError: true
        })
      }
    }

    // Navigate via router
    router.push(`/conversation/${threadId}`)
    await persistState()
  }

  async function closeConversation(threadId: string): Promise<void> {
    // Find adjacent conversation BEFORE removing from tabOrder
    const currentRoute = router.currentRoute.value
    const isClosingActive = currentRoute.params.id === threadId
    const nextId = isClosingActive ? findAdjacentConversation(threadId) : null

    // Remove from maps
    openConversations.value.delete(threadId)
    tabOrder.value = tabOrder.value.filter((id) => id !== threadId)

    // If closing active conversation, navigate to adjacent
    if (isClosingActive) {
      if (nextId) {
        router.push(`/conversation/${nextId}`)
      } else {
        router.push('/new')
      }
    }

    await persistState()
  }

  async function createConversation(): Promise<string> {
    const tabId = window.api.getWebContentsId()
    // Force create new conversation to avoid reusing empty conversations
    const newThreadId = await sessionP.createConversation('New Conversation', {}, tabId, {
      forceNewAndActivate: true
    })

    // Fetch full conversation metadata including modelIcon
    try {
      const meta = (await sessionP.getConversation(newThreadId)) as CONVERSATION | null
      if (meta) {
        openConversations.value.set(newThreadId, {
          id: newThreadId,
          title: meta.title || 'New Conversation',
          lastMessageAt: new Date(meta.updatedAt),
          isLoading: false,
          hasError: false,
          modelIcon: meta.settings?.modelId,
          chatMode: meta.settings?.chatMode || 'agent',
          providerId: meta.settings?.providerId
        })
      } else {
        // Fallback if conversation not found
        openConversations.value.set(newThreadId, {
          id: newThreadId,
          title: 'New Conversation',
          lastMessageAt: new Date(),
          isLoading: false,
          hasError: false
        })
      }
    } catch (e) {
      console.error('Failed to fetch new conversation metadata:', e)
      // Fallback
      openConversations.value.set(newThreadId, {
        id: newThreadId,
        title: 'New Conversation',
        lastMessageAt: new Date(),
        isLoading: false,
        hasError: false
      })
    }

    tabOrder.value.push(newThreadId)

    router.push(`/conversation/${newThreadId}`)
    await persistState()

    return newThreadId
  }

  function reorderConversations(fromIndex: number, toIndex: number): void {
    if (fromIndex < 0 || fromIndex >= tabOrder.value.length) return
    if (toIndex < 0 || toIndex >= tabOrder.value.length) return

    const item = tabOrder.value.splice(fromIndex, 1)[0]
    tabOrder.value.splice(toIndex, 0, item)
    persistState()
  }

  function findAdjacentConversation(closedId: string): string | null {
    const idx = tabOrder.value.indexOf(closedId)
    if (idx === -1) return tabOrder.value[0] || null

    // Prefer next, fallback to previous
    if (idx < tabOrder.value.length - 1) {
      return tabOrder.value[idx + 1]
    } else if (idx > 0) {
      return tabOrder.value[idx - 1]
    }
    return null
  }

  function updateConversationMeta(threadId: string, updates: Partial<ConversationMeta>): void {
    const existing = openConversations.value.get(threadId)
    if (existing) {
      openConversations.value.set(threadId, { ...existing, ...updates })
    }
  }

  async function refreshConversationMeta(threadId: string): Promise<void> {
    try {
      const meta = (await sessionP.getConversation(threadId)) as CONVERSATION | null
      if (meta && openConversations.value.has(threadId)) {
        openConversations.value.set(threadId, {
          id: threadId,
          title: meta.title || 'New Conversation',
          lastMessageAt: new Date(meta.updatedAt),
          isLoading: false,
          hasError: false,
          modelIcon: meta.settings?.modelId,
          chatMode: meta.settings?.chatMode || 'agent',
          providerId: meta.settings?.providerId
        })
      }
    } catch (e) {
      console.error(`Failed to refresh conversation meta ${threadId}:`, e)
    }
  }

  function setWidth(newWidth: number): void {
    width.value = Math.max(180, Math.min(400, newWidth))
    persistState()
  }

  function setCollapsed(value: boolean): void {
    collapsed.value = value
    persistState()
  }

  async function persistState(): Promise<void> {
    const state: PersistedSidebarState = {
      openConversationIds: tabOrder.value,
      lastActiveConversationId: router.currentRoute.value.params.id as string | undefined,
      ui: {
        width: width.value,
        collapsed: collapsed.value
      }
    }

    try {
      await configP.setSetting('chatWindow.sidebarState', state)
    } catch (e) {
      console.error('Failed to persist sidebar state:', e)
    }
  }

  async function restoreState(): Promise<void> {
    if (isInitialized.value) return

    try {
      const state = (await configP.getSetting(
        'chatWindow.sidebarState'
      )) as PersistedSidebarState | null
      if (!state) {
        isInitialized.value = true
        return
      }

      // Restore UI state
      width.value = state.ui?.width ?? 240
      collapsed.value = state.ui?.collapsed ?? false

      // Restore open conversations
      for (const id of state.openConversationIds || []) {
        try {
          const meta = (await sessionP.getConversation(id)) as CONVERSATION | null
          if (meta) {
            openConversations.value.set(id, {
              id,
              title: meta.title || 'New Conversation',
              lastMessageAt: new Date(meta.updatedAt),
              isLoading: false,
              hasError: false,
              modelIcon: meta.settings?.modelId,
              chatMode: meta.settings?.chatMode || 'agent',
              providerId: meta.settings?.providerId
            })
          }
        } catch (e) {
          console.warn(`Failed to restore conversation ${id}:`, e)
        }
      }

      // Restore tab order (filter out invalid IDs)
      tabOrder.value = (state.openConversationIds || []).filter((id) =>
        openConversations.value.has(id)
      )

      // Navigate to last active or first conversation
      const targetId = state.lastActiveConversationId || tabOrder.value[0]
      if (targetId && openConversations.value.has(targetId)) {
        router.push(`/conversation/${targetId}`)
      }

      isInitialized.value = true
    } catch (e) {
      console.error('Failed to restore sidebar state:', e)
      isInitialized.value = true
    }
  }

  return {
    // State
    openConversations,
    tabOrder,
    width,
    collapsed,
    isInitialized,
    // Getters
    sortedConversations,
    conversationCount,
    hasOpenConversations,
    // Actions
    openConversation,
    closeConversation,
    createConversation,
    reorderConversations,
    updateConversationMeta,
    refreshConversationMeta,
    setWidth,
    setCollapsed,
    persistState,
    restoreState
  }
})
