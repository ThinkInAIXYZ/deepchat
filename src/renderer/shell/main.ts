import '@/assets/main.css'
import { addCollection } from '@iconify/vue'
import lucideIcons from '@iconify-json/lucide/icons.json'
import vscodeIcons from '@iconify-json/vscode-icons/icons.json'
import { createPinia } from 'pinia'
import { createApp } from 'vue'
import App from './App.vue'

import { createI18n } from 'vue-i18n'
import locales from '@/i18n'

const i18n = createI18n({
  locale: 'zh-CN',
  fallbackLocale: 'en-US',
  legacy: false,
  messages: locales
})
// Add icon collections to local registry
addCollection(lucideIcons)
addCollection(vscodeIcons)
const pinia = createPinia()

const app = createApp(App)

app.use(pinia)
app.use(i18n)
app.mount('#app')
