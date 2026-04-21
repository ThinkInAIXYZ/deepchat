import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import { createSessionClient } from '../../../api/SessionClient'

export type PageRoute = { name: 'newThread' } | { name: 'chat'; sessionId: string }
type GoToNewThreadOptions = {
  refresh?: boolean
}
type InitializePageRouterOptions = {
  activeSessionId?: string | null
}

export const usePageRouterStore = defineStore('pageRouter', () => {
  const sessionClient = createSessionClient()

  // --- State ---
  const route = ref<PageRoute>({ name: 'newThread' })
  const newThreadRefreshKey = ref(0)
  const error = ref<string | null>(null)

  // --- Actions ---

  async function initialize(options: InitializePageRouterOptions = {}): Promise<void> {
    try {
      if (options.activeSessionId !== undefined) {
        route.value = options.activeSessionId
          ? { name: 'chat', sessionId: options.activeSessionId }
          : { name: 'newThread' }
        return
      }

      // 1. Check for the active agent session bound to this renderer first.
      const { session: activeAgentSession } = await sessionClient.getActive()
      if (activeAgentSession) {
        route.value = { name: 'chat', sessionId: activeAgentSession.id }
        return
      }

      // 2. Default to new thread
      route.value = { name: 'newThread' }
    } catch (e) {
      error.value = String(e)
      route.value = { name: 'newThread' }
    }
  }

  function goToNewThread(options: GoToNewThreadOptions = {}): void {
    route.value = { name: 'newThread' }
    if (options.refresh) {
      newThreadRefreshKey.value += 1
    }
  }

  function goToChat(sessionId: string): void {
    route.value = { name: 'chat', sessionId }
  }

  // --- Getters ---

  const currentRoute = computed(() => route.value.name)
  const chatSessionId = computed(() => (route.value.name === 'chat' ? route.value.sessionId : null))

  return {
    route,
    newThreadRefreshKey,
    error,
    initialize,
    goToNewThread,
    goToChat,
    currentRoute,
    chatSessionId
  }
})
