import '../src/assets/main.css'
import { createApp, defineComponent, h, ref } from 'vue'

import FloatingButton from './FloatingButton.vue'
import { createRendererI18n } from '../src/i18n/bootstrap'
import { loadLocaleMessages, resolveSupportedLocale } from '../src/i18n'
import {
  applyDocumentAppearance,
  resolveDocumentDirection
} from '../src/foundation/appearance/documentAppearance'

const floatingTheme = ref<'dark' | 'light'>('dark')

const applyTheme = (nextTheme: 'dark' | 'light') => {
  applyDocumentAppearance({ theme: nextTheme, themeDataset: true })
  floatingTheme.value = nextTheme
}

const Root = defineComponent({
  name: 'FloatingButtonRoot',
  setup() {
    return () => h(FloatingButton, { theme: floatingTheme.value })
  }
})

async function bootstrap() {
  const { i18n, languageState } = await createRendererI18n({
    getLanguageState: async () => {
      const locale = resolveSupportedLocale(await window.floatingButtonAPI.getLanguage())
      return {
        requestedLanguage: locale,
        locale,
        direction: resolveDocumentDirection(locale)
      }
    },
    onError: (message, error) => {
      console.warn(message, error)
    }
  })

  const initialLocale = resolveSupportedLocale(languageState.locale)
  applyDocumentAppearance({
    language: initialLocale,
    direction: resolveDocumentDirection(initialLocale)
  })

  const app = createApp(Root)
  app.use(i18n)
  app.mount('#app')

  let languageRevision = 0
  const applyLanguage = async (language: string) => {
    const revision = ++languageRevision
    const locale = resolveSupportedLocale(language)

    try {
      const messages = await loadLocaleMessages(locale)
      if (revision !== languageRevision) return

      i18n.global.setLocaleMessage(locale, messages)
      i18n.global.locale.value = locale
      applyDocumentAppearance({
        language: locale,
        direction: resolveDocumentDirection(locale)
      })
    } catch (error) {
      if (revision === languageRevision) {
        console.warn(`Failed to load floating widget locale ${locale}:`, error)
      }
    }
  }

  const unsubscribeLanguageChanged = window.floatingButtonAPI.onLanguageChanged((language) => {
    void applyLanguage(language)
  })

  void window.floatingButtonAPI
    .getTheme()
    .then(applyTheme)
    .catch((error) => {
      console.warn('Failed to initialize floating widget theme:', error)
    })

  const unsubscribeThemeChanged = window.floatingButtonAPI.onThemeChanged(applyTheme)

  window.addEventListener(
    'beforeunload',
    () => {
      unsubscribeLanguageChanged()
      unsubscribeThemeChanged()
    },
    { once: true }
  )
}

bootstrap().catch((error) => {
  console.error('Failed to bootstrap the floating renderer:', error)
})
