import { useDark, useToggle } from '@vueuse/core'
import { defineStore } from 'pinia'
import { onScopeDispose, ref } from 'vue'
import { createConfigClient } from '../../api/ConfigClient'

export type ThemeMode = 'dark' | 'light' | 'system'

export const useThemeStore = defineStore('theme', () => {
  const isDark = useDark()
  const toggleDark = useToggle(isDark)
  const configClient = createConfigClient()
  const themeMode = ref<ThemeMode>('system')
  let listenersRegistered = false
  let stateRevision = 0
  let themeInitialization: Promise<void> | null = null
  let removeThemeListeners: (() => void) | null = null

  const applyThemeState = (theme: ThemeMode, dark: boolean) => {
    themeMode.value = theme
    toggleDark(dark)
  }

  const handleSystemThemeChange = (payload: { isDark: boolean }) => {
    stateRevision += 1
    if (themeMode.value === 'system') {
      toggleDark(payload.isDark)
    }
  }

  const handleUserThemeChange = (payload: { theme: ThemeMode; isDark: boolean }) => {
    stateRevision += 1
    applyThemeState(payload.theme, payload.isDark)
  }

  const setupThemeListeners = () => {
    if (listenersRegistered) {
      return
    }

    listenersRegistered = true
    const unsubscribeSystemTheme = configClient.onSystemThemeChanged(handleSystemThemeChange)
    const unsubscribeTheme = configClient.onThemeChanged(handleUserThemeChange)
    removeThemeListeners = () => {
      unsubscribeSystemTheme()
      unsubscribeTheme()
      removeThemeListeners = null
      listenersRegistered = false
      stateRevision += 1
    }
  }

  // Register listeners before reading the snapshot so updates from another window cannot be lost.
  const initTheme = async () => {
    if (themeInitialization) {
      return themeInitialization
    }

    const initialization = (async () => {
      try {
        setupThemeListeners()
        const snapshotRevision = stateRevision
        const themeState = await configClient.getThemeState()
        if (snapshotRevision !== stateRevision) {
          return
        }

        applyThemeState(themeState.theme, themeState.isDark)
      } catch (error) {
        themeInitialization = null
        console.error('初始化主题失败:', error)
      }
    })()

    themeInitialization = initialization
    return initialization
  }

  const setThemeMode = async (mode: ThemeMode) => {
    const requestRevision = ++stateRevision
    themeMode.value = mode
    const isDarkMode = await configClient.setTheme(mode)
    if (requestRevision !== stateRevision) {
      return
    }

    toggleDark(isDarkMode)
  }

  // 循环切换主题：light -> dark -> system -> light
  const cycleTheme = async () => {
    if (themeMode.value === 'light') await setThemeMode('dark')
    else if (themeMode.value === 'dark') await setThemeMode('system')
    else await setThemeMode('light')
  }

  onScopeDispose(() => {
    removeThemeListeners?.()
  })

  void initTheme()

  return {
    isDark,
    toggleDark,
    themeMode,
    initTheme,
    cycleTheme,
    setThemeMode
  }
})
