// === Vue Core ===
import { onMounted, ref, watch } from 'vue'

// === Composables ===
import { usePresenter } from '@/composables/usePresenter'
import { useChatStore } from '@/stores/chat'

/**
 * Manages input-specific settings (web search, deep thinking)
 */
export function useInputSettings() {
  // === Presenters ===
  const configPresenter = usePresenter('configPresenter')
  const chatStore = useChatStore()

  // === Local State ===
  const settings = ref({
    deepThinking: false,
    webSearch: Boolean(chatStore.chatConfig.enableBrowser)
  })

  // === Public Methods ===
  const setWebSearch = async (value: boolean) => {
    const previousValue = settings.value.webSearch
    settings.value.webSearch = value

    try {
      await chatStore.updateChatConfig({ enableBrowser: value })
    } catch (error) {
      // Revert to previous value on error
      settings.value.webSearch = previousValue
      console.error('Failed to save web search setting:', error)
      // TODO: Show user-facing notification when toast system is available
    }
  }

  const toggleWebSearch = async () => {
    await setWebSearch(!settings.value.webSearch)
  }

  const toggleDeepThinking = async () => {
    const previousValue = settings.value.deepThinking
    settings.value.deepThinking = !settings.value.deepThinking

    try {
      await configPresenter.setSetting('input_deepThinking', settings.value.deepThinking)
    } catch (error) {
      // Revert to previous value on error
      settings.value.deepThinking = previousValue
      console.error('Failed to save deep thinking setting:', error)
      // TODO: Show user-facing notification when toast system is available
    }
  }

  const loadSettings = async () => {
    try {
      settings.value.deepThinking = Boolean(await configPresenter.getSetting('input_deepThinking'))
      settings.value.webSearch = Boolean(chatStore.chatConfig.enableBrowser)
    } catch (error) {
      // Fall back to safe defaults on error
      settings.value.deepThinking = false
      settings.value.webSearch = Boolean(chatStore.chatConfig.enableBrowser)
      console.error('Failed to load input settings, using defaults:', error)
    }
  }

  watch(
    () => chatStore.chatConfig.enableBrowser,
    (value) => {
      settings.value.webSearch = Boolean(value)
    },
    { immediate: true }
  )

  // === Lifecycle Hooks ===
  onMounted(async () => {
    try {
      await loadSettings()
    } catch (error) {
      console.error('Failed to initialize input settings:', error)
    }
  })

  return {
    settings,
    setWebSearch,
    toggleWebSearch,
    toggleDeepThinking,
    loadSettings
  }
}
