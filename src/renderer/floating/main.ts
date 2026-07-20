import '../src/assets/main.css'
import { createApp, defineComponent, h, ref } from 'vue'
import { createI18n } from 'vue-i18n'
import FloatingButton from './FloatingButton.vue'
import locales, { pluralRules } from '../src/i18n'
import {
  applyDocumentAppearance,
  resolveDocumentDirection
} from '../src/foundation/appearance/documentAppearance'

type FloatingLocale = keyof typeof locales

const i18n = createI18n({
  locale: 'zh-CN',
  fallbackLocale: 'en-US',
  legacy: false,
  pluralRules,
  messages: locales
})

const floatingTheme = ref<'dark' | 'light'>('dark')

const resolveLanguage = (language: string): FloatingLocale => {
  return language in locales ? (language as FloatingLocale) : 'en-US'
}

const applyLanguage = (language: string) => {
  const resolvedLanguage = resolveLanguage(language)

  i18n.global.locale.value = resolvedLanguage
  applyDocumentAppearance({
    language: resolvedLanguage,
    direction: resolveDocumentDirection(resolvedLanguage)
  })
}

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

const app = createApp(Root)

app.use(i18n)
app.mount('#app')

let languageRevision = 0
const unsubscribeLanguageChanged = window.floatingButtonAPI.onLanguageChanged((language) => {
  languageRevision += 1
  applyLanguage(language)
})
const initialLanguageRevision = languageRevision

void window.floatingButtonAPI
  .getLanguage()
  .then((language) => {
    if (languageRevision === initialLanguageRevision) {
      applyLanguage(language)
    }
  })
  .catch((error) => {
    console.warn('Failed to initialize floating widget language:', error)
  })

let themeRevision = 0
const unsubscribeThemeChanged = window.floatingButtonAPI.onThemeChanged((theme) => {
  themeRevision += 1
  applyTheme(theme)
})
const initialThemeRevision = themeRevision

void window.floatingButtonAPI
  .getTheme()
  .then((theme) => {
    if (themeRevision === initialThemeRevision) {
      applyTheme(theme)
    }
  })
  .catch((error) => {
    console.warn('Failed to initialize floating widget theme:', error)
  })

window.addEventListener(
  'beforeunload',
  () => {
    unsubscribeLanguageChanged()
    unsubscribeThemeChanged()
  },
  { once: true }
)
