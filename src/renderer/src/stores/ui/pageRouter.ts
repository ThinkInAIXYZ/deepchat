import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import { usePresenter } from '@/composables/usePresenter'

export type PageRoute = { name: 'newThread' } | { name: 'chat'; sessionId: string }
type GoToNewThreadOptions = {
  refresh?: boolean
}

export const usePageRouterStore = defineStore('pageRouter', () => {
  const agentSessionPresenter = usePresenter('agentSessionPresenter')

  // --- State ---
  const route = ref<PageRoute>({ name: 'newThread' })
  const newThreadRefreshKey = ref(0)
  const error = ref<string | null>(null)

  // --- Actions ---

  async function initialize(): Promise<void> {
    try {
      // 1. Check for the active agent session on this webContents first
      const webContentsId = window.api.getWebContentsId()
      const activeAgentSession = await agentSessionPresenter.getActiveSession(webContentsId)
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
