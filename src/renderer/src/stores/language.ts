import { defineStore } from 'pinia'
import { ref, onMounted } from 'vue'
import { useI18n } from 'vue-i18n'

import { useLegacyConfigPresenter } from '@api/legacy/presenters'
import { onLegacyIpcChannel } from '@api/legacy/runtime'
import { CONFIG_EVENTS } from '@/events'

const RTL_LIST = ['fa-IR', 'he-IL']
let languageListenerRegistered = false
export const useLanguageStore = defineStore('language', () => {
  const { locale } = useI18n({ useScope: 'global' })
  const language = ref<string>('system')
  const configPresenter = useLegacyConfigPresenter()
  const dir = ref('auto' as 'auto' | 'rtl' | 'ltr')
  // 初始化设置
  const initLanguage = async () => {
    try {
      // 获取语言
      language.value = (await configPresenter.getSetting('language')) || 'system'
      // 设置语言
      locale.value = await configPresenter.getLanguage()
      if (RTL_LIST.indexOf(locale.value) >= 0) {
        dir.value = 'rtl'
      } else {
        dir.value = 'auto'
      }
      // 监听语言变更事件
      if (!languageListenerRegistered) {
        languageListenerRegistered = true
        onLegacyIpcChannel(CONFIG_EVENTS.LANGUAGE_CHANGED, async (_event, newLanguage: string) => {
          language.value = newLanguage
          locale.value = await configPresenter.getLanguage()
          if (RTL_LIST.indexOf(locale.value) >= 0) {
            dir.value = 'rtl'
          } else {
            dir.value = 'auto'
          }
        })
      }
    } catch (error) {
      console.error('初始化语言失败:', error)
    }
  }

  // 更新语言
  const updateLanguage = async (newLanguage: string) => {
    await configPresenter.setLanguage(newLanguage)
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
