import { onMounted, onUnmounted, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { useLanguageAdapter } from '@/composables/settings/useLanguageAdapter'

const RTL_LIST = ['fa-IR', 'he-IL']

export const useLanguageStoreService = () => {
  const { locale } = useI18n({ useScope: 'global' })
  const language = ref<string>('system')
  const dir = ref<'auto' | 'rtl' | 'ltr'>('auto')
  const languageAdapter = useLanguageAdapter()

  let unsubscribeLanguage: (() => void) | null = null

  const updateDirection = (value: string) => {
    dir.value = RTL_LIST.includes(value) ? 'rtl' : 'auto'
  }

  const syncLocale = async () => {
    locale.value = await languageAdapter.getLanguage()
    updateDirection(locale.value)
  }

  const initLanguage = async () => {
    try {
      language.value = (await languageAdapter.getLanguageSetting()) || 'system'
      await syncLocale()
    } catch (error) {
      console.error('Failed to initialize language:', error)
    }
  }

  const updateLanguage = async (newLanguage: string) => {
    await languageAdapter.setLanguage(newLanguage)
    language.value = newLanguage
  }

  onMounted(async () => {
    await initLanguage()
    unsubscribeLanguage = languageAdapter.onLanguageChanged(async (newLanguage) => {
      language.value = newLanguage
      await syncLocale()
    })
  })

  onUnmounted(() => {
    unsubscribeLanguage?.()
    unsubscribeLanguage = null
  })

  return {
    language,
    updateLanguage,
    initLanguage,
    dir
  }
}
