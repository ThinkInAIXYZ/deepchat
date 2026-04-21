import { useDark, useToggle } from '@vueuse/core'
import { defineStore } from 'pinia'
import { ref } from 'vue'
import { createConfigClient } from '../../api/ConfigClient'

export type ThemeMode = 'dark' | 'light' | 'system'

export const useThemeStore = defineStore('theme', () => {
  const isDark = useDark()
  const toggleDark = useToggle(isDark)
  const configClient = createConfigClient()
  let listenersRegistered = false

  // 存储当前主题模式
  const themeMode = ref<ThemeMode>('system')

  // 初始化主题
  const initTheme = async () => {
    const currentTheme = (await configClient.getTheme()) as ThemeMode
    themeMode.value = currentTheme

    // 获取当前实际的深色模式状态
    const isDarkMode = await configClient.getCurrentThemeIsDark()
    console.log('initTheme - theme:', currentTheme, 'isDark:', isDarkMode)
    toggleDark(isDarkMode)
    setupThemeListeners()
  }

  initTheme()

  const handleSystemThemeChange = (payload: { isDark: boolean }) => {
    const isDarkMode = payload.isDark
    console.log('handleSystemThemeChange', isDarkMode)
    // 只有在系统模式下才跟随系统主题变化
    if (themeMode.value === 'system') {
      toggleDark(isDarkMode)
    }
  }
  const handleUserThemeChange = (payload: { theme: ThemeMode }) => {
    const theme = payload.theme
    if (themeMode.value !== theme) {
      configClient.getCurrentThemeIsDark().then((isDark) => {
        console.log('handleUserThemeChange', theme, isDark)
        themeMode.value = theme
        toggleDark(isDark)
      })
    }
  }

  const setupThemeListeners = () => {
    if (listenersRegistered) {
      return
    }

    listenersRegistered = true
    configClient.onSystemThemeChanged(handleSystemThemeChange)
    configClient.onThemeChanged(handleUserThemeChange)
  }

  // 设置主题模式
  const setThemeMode = async (mode: ThemeMode) => {
    themeMode.value = mode
    const isDarkMode = await configClient.setTheme(mode)

    // 设置界面深色/浅色状态
    toggleDark(isDarkMode)
  }

  // 循环切换主题：light -> dark -> system -> light
  const cycleTheme = async () => {
    console.log('cycleTheme', themeMode.value)
    if (themeMode.value === 'light') await setThemeMode('dark')
    else if (themeMode.value === 'dark') await setThemeMode('system')
    else await setThemeMode('light')
  }

  return {
    isDark,
    toggleDark,
    themeMode,
    cycleTheme,
    setThemeMode
  }
})
