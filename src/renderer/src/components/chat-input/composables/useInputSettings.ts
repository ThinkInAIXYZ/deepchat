// === Vue Core ===
import { ref, onMounted } from 'vue'

// === Composables ===
import { usePresenter } from '@/composables/usePresenter'

/**
 * Manages input-specific settings (web search, deep thinking)
 */
export function useInputSettings() {
  // === Presenters ===
  const configPresenter = usePresenter('configPresenter')

  // === Local State ===
  const settings = ref({
    deepThinking: false,
    webSearch: false
  })

  // === Public Methods ===
  const toggleWebSearch = async () => {
    const previousValue = settings.value.webSearch
    settings.value.webSearch = !settings.value.webSearch

    try {
      await configPresenter.setSetting('input_webSearch', settings.value.webSearch)
    } catch (error) {
      // Revert to previous value on error
      settings.value.webSearch = previousValue
      console.error('Failed to save web search setting:', error)
      // TODO: Show user-facing notification when toast system is available
    }
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
      settings.value.webSearch = Boolean(await configPresenter.getSetting('input_webSearch'))
    } catch (error) {
      // Fall back to safe defaults on error
      settings.value.deepThinking = false
      settings.value.webSearch = false
      console.error('Failed to load input settings, using defaults:', error)
    }
  }

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
    toggleWebSearch,
    toggleDeepThinking,
    loadSettings
  }
}
