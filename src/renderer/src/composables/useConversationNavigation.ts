import { useRouter } from 'vue-router'
import { useChatStore } from '@/stores/chat'
import { useSidebarStore } from '@/stores/sidebarStore'
import type { CONVERSATION_SETTINGS } from '@shared/presenter'

/**
 * Unified conversation navigation composable
 * Coordinates router, chatStore, and sidebarStore for consistent navigation
 */
export function useConversationNavigation() {
  const router = useRouter()
  const chatStore = useChatStore()
  const sidebarStore = useSidebarStore()

  /**
   * Navigate to a conversation
   * Updates sidebar state and navigates to the conversation route
   */
  async function navigateToConversation(threadId: string, title?: string) {
    await sidebarStore.openConversation(threadId, title)
    await router.push(`/conversation/${threadId}`)
  }

  /**
   * Navigate to home (new conversation)
   */
  async function navigateToHome() {
    await router.push('/home')
    // ChatTabView will clear active thread
  }

  /**
   * Create a new conversation and navigate to it
   */
  async function createAndNavigateToConversation(
    title: string,
    settings: Partial<CONVERSATION_SETTINGS>
  ) {
    // 1. Create the conversation
    const threadId = await chatStore.createThread(title, settings)

    // 2. Navigate to it
    await navigateToConversation(threadId, title)

    return threadId
  }

  return {
    navigateToConversation,
    navigateToHome,
    createAndNavigateToConversation
  }
}
