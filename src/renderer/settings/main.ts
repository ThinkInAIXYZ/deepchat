import '@/assets/main.css'
import { addCollection } from '@iconify/vue'
import lucideIcons from '@iconify-json/lucide/icons.json'
import vscodeIcons from '@iconify-json/vscode-icons/icons.json'
import { createPinia } from 'pinia'
import { createApp } from 'vue'
import App from './App.vue'
import { createRouter, createWebHashHistory } from 'vue-router'

import { createI18n } from 'vue-i18n'
import locales from '@/i18n'
import { SETTINGS_NAVIGATION_ITEMS } from '@shared/settingsNavigation'

const settingsRouteComponents = {
  'settings-common': () => import('./components/CommonSettings.vue'),
  'settings-display': () => import('./components/DisplaySettings.vue'),
  'settings-environments': () => import('./components/EnvironmentsSettings.vue'),
  'settings-provider': () => import('./components/ModelProviderSettings.vue'),
  'settings-dashboard': () => import('./components/DashboardSettings.vue'),
  'settings-mcp': () => import('./components/McpSettings.vue'),
  'settings-deepchat-agents': () => import('./components/DeepChatAgentsSettings.vue'),
  'settings-acp': () => import('./components/AcpSettings.vue'),
  'settings-remote': () => import('./components/RemoteSettings.vue'),
  'settings-notifications-hooks': () => import('./components/NotificationsHooksSettings.vue'),
  'settings-skills': () => import('./components/skills/SkillsSettings.vue'),
  'settings-prompt': () => import('./components/PromptSetting.vue'),
  'settings-knowledge-base': () => import('./components/KnowledgeBaseSettings.vue'),
  'settings-database': () => import('./components/DataSettings.vue'),
  'settings-shortcut': () => import('./components/ShortcutSettings.vue'),
  'settings-about': () => import('./components/AboutUsSettings.vue')
} as const

// Create i18n instance
const i18n = createI18n({
  locale: 'zh-CN',
  fallbackLocale: 'en-US',
  legacy: false,
  messages: locales
})

// Create router instance specifically for settings
const router = createRouter({
  history: createWebHashHistory(import.meta.env.BASE_URL),
  routes: [
    ...SETTINGS_NAVIGATION_ITEMS.map((item) => ({
      path: item.path,
      name: item.routeName,
      component: settingsRouteComponents[item.routeName],
      meta: {
        titleKey: item.titleKey,
        icon: item.icon,
        position: item.position
      }
    })),
    {
      path: '/',
      redirect: '/common'
    }
  ]
})

// Add icon collections to local registry
addCollection(lucideIcons)
addCollection(vscodeIcons)

const pinia = createPinia()
const app = createApp(App)

app.use(pinia)
app.use(i18n)
app.use(router)
app.mount('#app')
