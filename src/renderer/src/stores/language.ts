import { defineStore } from 'pinia'
import { ref, onMounted } from 'vue'
import { useI18n } from 'vue-i18n'

import { ConfigClient } from '../../api/ConfigClient'

const RTL_LIST = ['fa-IR', 'he-IL']
let languageListenerRegistered = false
export const useLanguageStore = defineStore('language', () => {
  const { locale } = useI18n({ useScope: 'global' })
  const language = ref<string>('system')
  const configClient = new ConfigClient()
  const dir = ref('auto' as 'auto' | 'rtl' | 'ltr')
  // 初始化设置
  const initLanguage = async () => {
    try {
      const languageState = await configClient.getLanguageState()
      // 获取语言
      language.value = languageState.requestedLanguage || 'system'
      // 设置语言
      locale.value = languageState.locale
      dir.value = RTL_LIST.indexOf(locale.value) >= 0 ? 'rtl' : 'auto'
      // 监听语言变更事件
      if (!languageListenerRegistered) {
        languageListenerRegistered = true
        configClient.onLanguageChanged((payload) => {
          language.value = payload.requestedLanguage
          locale.value = payload.locale
          dir.value = payload.direction === 'rtl' ? 'rtl' : 'auto'
        })
      }
    } catch (error) {
      console.error('初始化语言失败:', error)
    }
  }

  // 更新语言
  const updateLanguage = async (newLanguage: string) => {
    await configClient.setLanguage(newLanguage)
    language.value = newLanguage
  }

  // 在 store 创建时初始化
  onMounted(async () => {
    await initLanguage()
  })

  return {
    language,
    updateLanguage,
    initLanguage,
    dir
  }
})
