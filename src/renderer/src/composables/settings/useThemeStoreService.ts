import { useDark, useToggle } from '@vueuse/core'
import { onMounted, onUnmounted, ref } from 'vue'
import type { ThemeMode } from '@/composables/settings/types'
import { useThemeAdapter } from '@/composables/settings/useThemeAdapter'

export const useThemeStoreService = () => {
  const isDark = useDark()
  const toggleDark = useToggle(isDark)
  const themeAdapter = useThemeAdapter()

  const themeMode = ref<ThemeMode>('system')
  let unsubscribeSystemTheme: (() => void) | null = null
  let unsubscribeUserTheme: (() => void) | null = null

  const applyThemeMode = async (mode: ThemeMode) => {
    themeMode.value = mode
    const isDarkMode = await themeAdapter.getCurrentThemeIsDark()
    toggleDark(isDarkMode)
  }

  const initTheme = async () => {
    const currentTheme = await themeAdapter.getTheme()
    themeMode.value = currentTheme
    const isDarkMode = await themeAdapter.getCurrentThemeIsDark()
    toggleDark(isDarkMode)
  }

  const handleSystemThemeChange = (isDarkMode: boolean) => {
    if (themeMode.value === 'system') {
      toggleDark(isDarkMode)
    }
  }

  const handleUserThemeChange = async (theme: ThemeMode) => {
    if (themeMode.value !== theme) {
      await applyThemeMode(theme)
    }
  }

  void initTheme()

  onMounted(() => {
    unsubscribeSystemTheme = themeAdapter.onSystemThemeUpdated(handleSystemThemeChange)
    unsubscribeUserTheme = themeAdapter.onThemeChanged(handleUserThemeChange)
  })

  onUnmounted(() => {
    unsubscribeSystemTheme?.()
    unsubscribeUserTheme?.()
    unsubscribeSystemTheme = null
    unsubscribeUserTheme = null
  })

  const setThemeMode = async (mode: ThemeMode) => {
    themeMode.value = mode
    const isDarkMode = await themeAdapter.setTheme(mode)
    toggleDark(isDarkMode)
  }

  const cycleTheme = async () => {
    if (themeMode.value === 'light') {
      await setThemeMode('dark')
      return
    }
    if (themeMode.value === 'dark') {
      await setThemeMode('system')
      return
    }
    await setThemeMode('light')
  }

  return {
    isDark,
    toggleDark,
    themeMode,
    cycleTheme,
    setThemeMode
  }
}
