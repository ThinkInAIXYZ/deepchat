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
  async function navigateToConversation(sessionId: string, title?: string) {
    await sidebarStore.openConversation(sessionId, title)
    await router.push(`/conversation/${sessionId}`)
  }

  /**
   * Navigate to home (new conversation)
   */
  async function navigateToHome() {
    await router.push('/home')
    // ChatTabView will clear active session
  }

  /**
   * Create a new conversation and navigate to it
   */
  async function createAndNavigateToConversation(
    title: string,
    settings: Partial<CONVERSATION_SETTINGS>
  ) {
    // 1. Create the conversation
    const sessionId = await chatStore.createThread(title, settings)

    // 2. Navigate to it
    await navigateToConversation(sessionId, title)

    return sessionId
  }

  return {
    navigateToConversation,
    navigateToHome,
    createAndNavigateToConversation
  }
}
