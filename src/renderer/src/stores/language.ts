import { defineStore } from 'pinia'
import { onMounted, onScopeDispose, shallowRef } from 'vue'
import { useI18n } from 'vue-i18n'

import { createConfigClient } from '@api/ConfigClient'
import { resolveDocumentDirection } from '@/foundation/appearance/documentAppearance'
import { loadLocaleMessages, resolveSupportedLocale } from '@/i18n'
import type { RendererLanguageState } from '@/i18n/bootstrap'

export const useLanguageStore = defineStore('language', () => {
  const { locale, setLocaleMessage } = useI18n({ useScope: 'global' })
  const language = shallowRef<string>('system')
  const configClient = createConfigClient()
  const initialLocale = resolveSupportedLocale(locale.value)
  const dir = shallowRef<'auto' | 'rtl' | 'ltr'>(resolveDocumentDirection(initialLocale))
  let transitionRevision = 0
  let updateRequestRevision = 0
  let removeLanguageListener: (() => void) | undefined
  let languageInitialization: Promise<void> | null = null

  const applyLanguageState = async (state: RendererLanguageState, revision: number) => {
    const resolvedLocale = resolveSupportedLocale(state.locale)

    try {
      const messages = await loadLocaleMessages(resolvedLocale)
      if (revision !== transitionRevision) return false

      setLocaleMessage(resolvedLocale, messages)
      locale.value = resolvedLocale
      language.value = state.requestedLanguage || 'system'
      dir.value =
        state.direction === 'rtl' || resolveDocumentDirection(resolvedLocale) === 'rtl'
          ? 'rtl'
          : state.direction === 'ltr'
            ? 'ltr'
            : 'auto'
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
    if (languageInitialization) {
      return languageInitialization
    }

    ensureLanguageListener()
    const revision = ++transitionRevision

    const initialization = (async () => {
      try {
        const languageState = await configClient.getLanguageState()
        const applied = await applyLanguageState(languageState, revision)
        if (!applied && revision === transitionRevision) {
          languageInitialization = null
        }
      } catch (error) {
        languageInitialization = null
        console.error('初始化语言失败:', error)
      }
    })()

    languageInitialization = initialization
    return initialization
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
    languageInitialization = null
  })

  return {
    language,
    updateLanguage,
    initLanguage,
    dir
  }
})
