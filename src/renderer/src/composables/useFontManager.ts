import { watch } from 'vue'
import { useUiSettingsStore } from '../stores/uiSettingsStore'

export function useFontManager() {
  const uiSettingsStore = useUiSettingsStore()

  const applyFontVariables = (textFont: string, codeFont: string) => {
    document.documentElement.style.setProperty('--dc-font-family', textFont)
    document.documentElement.style.setProperty('--dc-code-font-family', codeFont)
  }

  const setupFontListener = () => {
    watch(
      [() => uiSettingsStore.formattedFontFamily, () => uiSettingsStore.formattedCodeFontFamily],
      ([textFont, codeFont]) => {
        applyFontVariables(textFont, codeFont)
      },
      { immediate: true }
    )
  }

  return {
    setupFontListener
  }
}
