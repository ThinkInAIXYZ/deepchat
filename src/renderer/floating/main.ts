import '../src/assets/main.css'
import { createApp, defineComponent, h, ref } from 'vue'
import { createI18n } from 'vue-i18n'
import FloatingButton from './FloatingButton.vue'
import locales from '../src/i18n'

const RTL_LANGUAGES = new Set(['fa-IR', 'he-IL'])
type FloatingLocale = keyof typeof locales

const i18n = createI18n({
  locale: 'zh-CN',
  fallbackLocale: 'en-US',
  legacy: false,
  messages: locales
})

const floatingTheme = ref<'dark' | 'light'>('dark')

const resolveLanguage = (language: string): FloatingLocale => {
  return language in locales ? (language as FloatingLocale) : 'en-US'
}

const applyLanguage = (language: string) => {
  const resolvedLanguage = resolveLanguage(language)

  i18n.global.locale.value = resolvedLanguage
  document.documentElement.lang = resolvedLanguage
  document.documentElement.dir = RTL_LANGUAGES.has(resolvedLanguage) ? 'rtl' : 'ltr'
}

const applyTheme = (nextTheme: 'dark' | 'light') => {
  document.documentElement.dataset.theme = nextTheme
  document.documentElement.classList.remove('dark', 'light')
  document.body.classList.remove('dark', 'light')
  document.documentElement.classList.add(nextTheme)
  document.body.classList.add(nextTheme)
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

void window.floatingButtonAPI
  .getLanguage()
  .then(applyLanguage)
  .catch((error) => {
    console.warn('Failed to initialize floating widget language:', error)
  })

window.floatingButtonAPI.onLanguageChanged(applyLanguage)

void window.floatingButtonAPI
  .getTheme()
  .then(applyTheme)
  .catch((error) => {
    console.warn('Failed to initialize floating widget theme:', error)
  })

window.floatingButtonAPI.onThemeChanged(applyTheme)
