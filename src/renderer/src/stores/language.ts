import { defineStore } from 'pinia'
import { onMounted, onScopeDispose, shallowRef } from 'vue'
import { useI18n } from 'vue-i18n'

import { createConfigClient } from '@api/ConfigClient'
import { loadLocaleMessages, resolveSupportedLocale } from '@/i18n'
import type { RendererLanguageState } from '@/i18n/bootstrap'

const RTL_LIST = ['fa-IR', 'he-IL']

export const useLanguageStore = defineStore('language', () => {
  const { locale, setLocaleMessage } = useI18n({ useScope: 'global' })
  const language = shallowRef<string>('system')
  const configClient = createConfigClient()
  const initialLocale = resolveSupportedLocale(locale.value)
  const dir = shallowRef<'auto' | 'rtl'>(RTL_LIST.includes(initialLocale) ? 'rtl' : 'auto')
  let transitionRevision = 0
  let updateRequestRevision = 0
  let removeLanguageListener: (() => void) | undefined

  const applyLanguageState = async (state: RendererLanguageState, revision: number) => {
    const resolvedLocale = resolveSupportedLocale(state.locale)

    try {
      const messages = await loadLocaleMessages(resolvedLocale)
      if (revision !== transitionRevision) return false

      setLocaleMessage(resolvedLocale, messages)
      locale.value = resolvedLocale
      language.value = state.requestedLanguage || 'system'
      dir.value = state.direction === 'rtl' || RTL_LIST.includes(resolvedLocale) ? 'rtl' : 'auto'
      return true
    } catch (error) {
      if (revision === transitionRevision) {
        console.error(`Failed to load locale ${resolvedLocale}:`, error)
      }
      return false
    }
  }

  const ensureLanguageListener = () => {
    if (removeLanguageListener) return

    removeLanguageListener = configClient.onLanguageChanged((state) => {
      const revision = ++transitionRevision
      void applyLanguageState(state, revision)
    })
  }

  const initLanguage = async () => {
    ensureLanguageListener()
    const revision = ++transitionRevision

    try {
      const languageState = await configClient.getLanguageState()
      await applyLanguageState(languageState, revision)
    } catch (error) {
      console.error('初始化语言失败:', error)
    }
  }

  const updateLanguage = async (newLanguage: string) => {
    ensureLanguageListener()
    const requestRevision = ++updateRequestRevision
    const languageState = await configClient.setLanguage(newLanguage)
    if (requestRevision !== updateRequestRevision) return

    const revision = ++transitionRevision
    await applyLanguageState(languageState, revision)
  }

  onMounted(async () => {
    await initLanguage()
  })

  onScopeDispose(() => {
    removeLanguageListener?.()
    removeLanguageListener = undefined
  })

  return {
    language,
    updateLanguage,
    initLanguage,
    dir
  }
})
