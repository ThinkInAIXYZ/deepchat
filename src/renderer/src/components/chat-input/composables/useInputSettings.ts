// === Vue Core ===
import { ref, onMounted } from 'vue'

// === Composables ===
import { usePresenter } from '@/composables/usePresenter'

/**
 * Manages input-specific settings (deep thinking)
 */
export function useInputSettings() {
  // === Presenters ===
  const configPresenter = usePresenter('configPresenter')

  // === Local State ===
  const settings = ref({
    deepThinking: false
  })

  // === Public Methods ===
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
    } catch (error) {
      // Fall back to safe defaults on error
      settings.value.deepThinking = false
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
    toggleDeepThinking,
    loadSettings
  }
}
