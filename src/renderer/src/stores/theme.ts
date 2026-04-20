import { useLegacyConfigPresenter } from '@api/legacy/presenters'
import { createLegacyIpcSubscriptionScope } from '@api/legacy/runtime'
import { useDark, useToggle } from '@vueuse/core'
import { defineStore } from 'pinia'
import { ref, onMounted, onUnmounted } from 'vue'
import { CONFIG_EVENTS, SYSTEM_EVENTS } from '@/events'

export type ThemeMode = 'dark' | 'light' | 'system'

export const useThemeStore = defineStore('theme', () => {
  const isDark = useDark()
  const toggleDark = useToggle(isDark)
  const configPresenter = useLegacyConfigPresenter()
  const themeEventScope = createLegacyIpcSubscriptionScope()

  // 存储当前主题模式
  const themeMode = ref<ThemeMode>('system')

  // 初始化主题
  const initTheme = async () => {
    const currentTheme = (await configPresenter.getTheme()) as ThemeMode
    themeMode.value = currentTheme

    // 获取当前实际的深色模式状态
    const isDarkMode = await configPresenter.getCurrentThemeIsDark()
    console.log('initTheme - theme:', currentTheme, 'isDark:', isDarkMode)
    toggleDark(isDarkMode)
  }

  initTheme()

  // 监听系统主题变化事件
  const handleSystemThemeChange = (_event: unknown, isDarkMode: boolean) => {
    console.log('handleSystemThemeChange', isDarkMode)
    // 只有在系统模式下才跟随系统主题变化
    if (themeMode.value === 'system') {
      toggleDark(isDarkMode)
    }
  }
  // 监听用户主题变化事件
  const handleUserThemeChange = (_event: unknown, theme: ThemeMode) => {
    if (themeMode.value !== theme) {
      configPresenter.getCurrentThemeIsDark().then((isDark) => {
        console.log('handleUserThemeChange', theme, isDark)
        themeMode.value = theme
        toggleDark(isDark)
      })
    }
  }

  // 注册和清理主题变化监听器
  onMounted(() => {
    themeEventScope.on(SYSTEM_EVENTS.SYSTEM_THEME_UPDATED, handleSystemThemeChange)
    themeEventScope.on(CONFIG_EVENTS.THEME_CHANGED, handleUserThemeChange)
  })

  onUnmounted(() => {
    themeEventScope.cleanup()
  })

  // 设置主题模式
  const setThemeMode = async (mode: ThemeMode) => {
    themeMode.value = mode
    const isDarkMode = await configPresenter.setTheme(mode)

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
