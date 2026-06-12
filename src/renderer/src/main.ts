import './assets/main.css'
import { createPinia } from 'pinia'
import { PiniaColada } from '@pinia/colada'
import { createApp } from 'vue'
import App from './App.vue'
import router from './router'
import { createI18n } from 'vue-i18n'
import locales, { pluralRules } from './i18n'
import 'vue-virtual-scroller/dist/vue-virtual-scroller.css'
import 'katex/dist/katex.min.css'
import { ensureMarkdownWorkers } from './lib/markdownWorkerLifecycle'
import { preloadIcons } from './lib/iconLoader'

// Single owner of the KaTeX/Mermaid workers. ensureMarkdownWorkers is idempotent
// and registers its own beforeunload cleanup, so the renderer never creates or
// tears down these workers directly. markstream-vue degrades to raw text until
// the workers finish loading, so awaiting here is unnecessary.
ensureMarkdownWorkers().catch((error) => {
  console.error('Failed to initialize markdown workers:', error)
})

const i18n = createI18n({
  locale: 'zh-CN',
  fallbackLocale: 'en-US',
  legacy: false,
  pluralRules,
  messages: locales
})
// Icons will be loaded asynchronously on app mount to improve startup performance
const pinia = createPinia()

const app = createApp(App)

app.use(pinia)
app.use(PiniaColada, {
  queryOptions: {
    // Renderer data loads are IPC bound; keep results warm for fast switches.
    staleTime: 30_000,
    gcTime: 300_000
  }
})
app.use(router)
app.use(i18n)
app.mount('#app')

// Preload icons asynchronously after app mount to improve perceived startup time
setTimeout(() => {
  preloadIcons().catch((error) => {
    console.error('Failed to preload icons:', error)
  })
}, 0)
