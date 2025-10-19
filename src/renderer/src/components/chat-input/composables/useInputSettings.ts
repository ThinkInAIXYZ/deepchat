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
    settings.value.webSearch = !settings.value.webSearch
    await configPresenter.setSetting('input_webSearch', settings.value.webSearch)
  }

  const toggleDeepThinking = async () => {
    settings.value.deepThinking = !settings.value.deepThinking
    await configPresenter.setSetting('input_deepThinking', settings.value.deepThinking)
  }

  const loadSettings = async () => {
    settings.value.deepThinking = Boolean(await configPresenter.getSetting('input_deepThinking'))
    settings.value.webSearch = Boolean(await configPresenter.getSetting('input_webSearch'))
  }

  // === Lifecycle Hooks ===
  onMounted(async () => {
    await loadSettings()
  })

  return {
    settings,
    toggleWebSearch,
    toggleDeepThinking,
    loadSettings
  }
}
