import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import { usePresenter } from '@/composables/usePresenter'
import { CONFIG_EVENTS } from '@/events'

export type PageRoute =
  | { name: 'welcome' }
  | { name: 'newThread' }
  | { name: 'chat'; sessionId: string }

export const usePageRouterStore = defineStore('pageRouter', () => {
  const configPresenter = usePresenter('configPresenter')
  const sessionPresenter = usePresenter('sessionPresenter')

  // --- State ---
  const route = ref<PageRoute>({ name: 'newThread' })
  const error = ref<string | null>(null)

  // --- Actions ---

  async function initialize(): Promise<void> {
    try {
      // 1. Check if any provider is enabled
      const enabledProviders = configPresenter.getEnabledProviders()
      if (!enabledProviders || enabledProviders.length === 0) {
        route.value = { name: 'welcome' }
        return
      }

      // 2. Check for active session on this tab
      const tabId = window.api.getWebContentsId()
      const activeSession = await sessionPresenter.getActiveSession(tabId)
      if (activeSession) {
        route.value = { name: 'chat', sessionId: activeSession.sessionId }
        return
      }

      // 3. Default to new thread
      route.value = { name: 'newThread' }
    } catch (e) {
      error.value = String(e)
      route.value = { name: 'newThread' }
    }
  }

  function goToWelcome(): void {
    route.value = { name: 'welcome' }
  }

  function goToNewThread(): void {
    route.value = { name: 'newThread' }
  }

  function goToChat(sessionId: string): void {
    route.value = { name: 'chat', sessionId }
  }

  // --- Getters ---

  const currentRoute = computed(() => route.value.name)
  const chatSessionId = computed(() => (route.value.name === 'chat' ? route.value.sessionId : null))

  // --- Event Listeners ---

  window.electron.ipcRenderer.on(CONFIG_EVENTS.PROVIDER_CHANGED, async () => {
    try {
      const enabledProviders = configPresenter.getEnabledProviders()
      if (!enabledProviders || enabledProviders.length === 0) {
        goToWelcome()
      } else if (route.value.name === 'welcome') {
        // Providers became available, go to new thread
        goToNewThread()
      }
    } catch (e) {
      error.value = String(e)
    }
  })

  return {
    route,
    error,
    initialize,
    goToWelcome,
    goToNewThread,
    goToChat,
    currentRoute,
    chatSessionId
  }
})
