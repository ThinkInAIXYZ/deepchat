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
    {
      path: '/common',
      name: 'settings-common',
      component: () => import('./components/CommonSettings.vue'),
      meta: {
        titleKey: 'routes.settings-common',
        icon: 'lucide:bolt',
        position: 1,
        group: 'preferences',
        groupPosition: 1,
        groupTitleKey: 'settings.groups.preferences'
      }
    },
    {
      path: '/display',
      name: 'settings-display',
      component: () => import('./components/DisplaySettings.vue'),
      meta: {
        titleKey: 'routes.settings-display',
        icon: 'lucide:monitor',
        position: 2,
        group: 'preferences',
        groupPosition: 1,
        groupTitleKey: 'settings.groups.preferences'
      }
    },
    {
      path: '/provider/:providerId?',
      name: 'settings-provider',
      component: () => import('./components/ModelProviderSettings.vue'),
      meta: {
        titleKey: 'routes.settings-provider',
        icon: 'lucide:cloud-cog',
        position: 3,
        group: 'models',
        groupPosition: 2,
        groupTitleKey: 'settings.groups.models'
      }
    },
    {
      path: '/mcp',
      name: 'settings-mcp',
      component: () => import('./components/McpSettings.vue'),
      meta: {
        titleKey: 'routes.settings-mcp',
        icon: 'lucide:server',
        position: 4,
        group: 'tools',
        groupPosition: 3,
        groupTitleKey: 'settings.groups.tools'
      }
    },
    {
      path: '/mcp-market',
      name: 'settings-mcp-market',
      component: () => import('./components/McpBuiltinMarket.vue'),
      meta: {
        titleKey: 'routes.settings-mcp-market',
        icon: 'lucide:shopping-bag',
        position: 5,
        group: 'tools',
        groupPosition: 3,
        groupTitleKey: 'settings.groups.tools'
      }
    },
    {
      path: '/acp',
      name: 'settings-acp',
      component: () => import('./components/AcpSettings.vue'),
      meta: {
        titleKey: 'routes.settings-acp',
        icon: 'lucide:shield-check',
        position: 6,
        group: 'tools',
        groupPosition: 3,
        groupTitleKey: 'settings.groups.tools'
      }
    },
    {
      path: '/skills',
      name: 'settings-skills',
      component: () => import('./components/skills/SkillsSettings.vue'),
      meta: {
        titleKey: 'routes.settings-skills',
        icon: 'lucide:wand-sparkles',
        position: 7,
        group: 'tools',
        groupPosition: 3,
        groupTitleKey: 'settings.groups.tools'
      }
    },
    {
      path: '/prompt',
      name: 'settings-prompt',
      component: () => import('./components/PromptSetting.vue'),
      meta: {
        titleKey: 'routes.settings-prompt',
        icon: 'lucide:book-open-text',
        position: 8,
        group: 'models',
        groupPosition: 2,
        groupTitleKey: 'settings.groups.models'
      }
    },
    {
      path: '/knowledge-base',
      name: 'settings-knowledge-base',
      component: () => import('./components/KnowledgeBaseSettings.vue'),
      meta: {
        titleKey: 'routes.settings-knowledge-base',
        icon: 'lucide:book-marked',
        position: 9,
        group: 'models',
        groupPosition: 2,
        groupTitleKey: 'settings.groups.models'
      }
    },
    {
      path: '/database',
      name: 'settings-database',
      component: () => import('./components/DataSettings.vue'),
      meta: {
        titleKey: 'routes.settings-database',
        icon: 'lucide:database',
        position: 10,
        group: 'system',
        groupPosition: 4,
        groupTitleKey: 'settings.groups.system'
      }
    },
    {
      path: '/shortcut',
      name: 'settings-shortcut',
      component: () => import('./components/ShortcutSettings.vue'),
      meta: {
        titleKey: 'routes.settings-shortcut',
        icon: 'lucide:keyboard',
        position: 11,
        group: 'preferences',
        groupPosition: 1,
        groupTitleKey: 'settings.groups.preferences'
      }
    },
    {
      path: '/about',
      name: 'settings-about',
      component: () => import('./components/AboutUsSettings.vue'),
      meta: {
        titleKey: 'routes.settings-about',
        icon: 'lucide:info',
        position: 12,
        group: 'system',
        groupPosition: 4,
        groupTitleKey: 'settings.groups.system'
      }
    },
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
