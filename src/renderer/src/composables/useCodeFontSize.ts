import { watch } from 'vue'
import { useSettingsStore } from '@/stores/settings'

/**
 * Composable for managing code font size
 * Updates the CSS custom property when the setting changes
 */
export function useCodeFontSize() {
  const settingsStore = useSettingsStore()

  // Update CSS custom property when code font size changes
  watch(
    () => settingsStore.codeFontSizeValue,
    (newSize) => {
      document.documentElement.style.setProperty('--dc-code-font-size', newSize)
    },
    { immediate: true }
  )

  return {
    codeFontSizeLevel: settingsStore.codeFontSizeLevel,
    codeFontSizeValue: settingsStore.codeFontSizeValue,
    updateCodeFontSizeLevel: settingsStore.updateCodeFontSizeLevel
  }
}
