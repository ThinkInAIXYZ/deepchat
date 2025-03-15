import './assets/main.css'
import { addCollection } from '@iconify/vue'
import lucideIcons from '@iconify-json/lucide/icons.json'
import vscodeIcons from '@iconify-json/vscode-icons/icons.json'
import { createPinia } from 'pinia'
import zhCN from './i18n/zh-CN.json'
import enUS from './i18n/en-US.json'
import zhHK from './i18n/zh-HK.json'
import jaJP from './i18n/ja-JP.json'
import koKR from './i18n/ko-KR.json'
import ruRU from './i18n/ru-RU.json'
import { createApp } from 'vue'
import App from './App.vue'
import router from './router'
import { createI18n } from 'vue-i18n'

const i18n = createI18n({
  locale: 'zh-CN',
  fallbackLocale: 'en-US',
  legacy: false,
  messages: {
    'zh-CN': zhCN,
    'en-US': enUS,
    'zh-HK': zhHK,
    'ja-JP': jaJP,
    'ko-KR': koKR,
    'ru-RU': ruRU,
    'zh': zhCN,
    'en': enUS
  }
})
// 添加整个图标集合到本地
addCollection(lucideIcons)
addCollection(vscodeIcons)
const pinia = createPinia()

const app = createApp(App)

app.use(pinia)
app.use(router)
app.use(i18n)
app.mount('#app')
