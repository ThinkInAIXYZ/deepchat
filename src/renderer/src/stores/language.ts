import { defineStore } from 'pinia'
import { ref, onMounted, onScopeDispose } from 'vue'
import { useI18n } from 'vue-i18n'

import { createConfigClient } from '../../api/ConfigClient'

const RTL_LIST = ['fa-IR', 'he-IL']
let languageListenerRegistered = false
let languageInitialization: Promise<void> | null = null
let languageStateRevision = 0
let removeLanguageListener: (() => void) | null = null
export const useLanguageStore = defineStore('language', () => {
  const { locale } = useI18n({ useScope: 'global' })
  const language = ref<string>('system')
  const configClient = createConfigClient()
  const dir = ref('auto' as 'auto' | 'rtl' | 'ltr')
  // 初始化设置
  const initLanguage = async () => {
    if (languageInitialization) {
      return languageInitialization
    }

    const initialization = (async () => {
      try {
        // Register before reading the initial snapshot so an IPC event cannot be lost.
        if (!languageListenerRegistered) {
          languageListenerRegistered = true
          removeLanguageListener = configClient.onLanguageChanged((payload) => {
            languageStateRevision += 1
            language.value = payload.requestedLanguage
            locale.value = payload.locale
            dir.value = payload.direction
          })
        }

        const snapshotRevision = languageStateRevision
        const languageState = await configClient.getLanguageState()
        if (snapshotRevision !== languageStateRevision) {
          return
        }

        language.value = languageState.requestedLanguage || 'system'
        locale.value = languageState.locale
        dir.value = RTL_LIST.includes(locale.value) ? 'rtl' : 'auto'
      } catch (error) {
        languageInitialization = null
        console.error('初始化语言失败:', error)
      }
    })()

    languageInitialization = initialization
    return initialization
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

  onScopeDispose(() => {
    removeLanguageListener?.()
    removeLanguageListener = null
    languageListenerRegistered = false
    languageStateRevision += 1
    languageInitialization = null
  })

  return {
    language,
    updateLanguage,
    initLanguage,
    dir
  }
})
