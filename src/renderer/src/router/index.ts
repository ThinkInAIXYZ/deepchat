import { createRouter, createWebHashHistory } from 'vue-router'

const router = createRouter({
  history: createWebHashHistory(import.meta.env.BASE_URL),
  routes: [
    {
      path: '/',
      redirect: '/chat'
    },
    {
      path: '/chat',
      name: 'chat',
      component: () => import('@/views/ChatTabView.vue'),
      meta: {
        titleKey: 'routes.chat',
        icon: 'lucide:message-square'
      }
    },
    {
      path: '/plugins',
      component: () => import('@/pages/plugins/PluginsHubPage.vue'),
      meta: {
        titleKey: 'routes.plugins',
        icon: 'lucide:puzzle'
      },
      children: [
        {
          path: '',
          name: 'plugins',
          component: () => import('@/pages/plugins/PluginsCatalogPage.vue'),
          meta: {
            titleKey: 'routes.plugins',
            icon: 'lucide:puzzle'
          }
        },
        {
          path: 'skills',
          name: 'plugins-skills',
          component: () => import('@/pages/plugins/SkillsPluginsPage.vue'),
          meta: {
            titleKey: 'routes.settings-skills',
            icon: 'lucide:wand-sparkles'
          }
        },
        {
          path: 'mcp',
          name: 'plugins-mcp',
          component: () => import('@/pages/plugins/McpPluginsPage.vue'),
          meta: {
            titleKey: 'routes.settings-mcp',
            icon: 'lucide:server'
          }
        },
        {
          path: 'remote',
          redirect: { name: 'plugins' }
        },
        {
          path: 'remote/:channel',
          redirect: (to) => ({
            name: 'plugins-detail',
            params: { pluginId: `remote:${String(to.params.channel)}` }
          })
        },
        {
          path: 'official/:pluginId',
          redirect: (to) => ({
            name: 'plugins-detail',
            params: { pluginId: String(to.params.pluginId) }
          })
        },
        {
          path: ':pluginId',
          name: 'plugins-detail',
          component: () => import('@/pages/plugins/OfficialPluginDetailPage.vue'),
          meta: {
            titleKey: 'routes.plugins',
            icon: 'lucide:puzzle'
          }
        }
      ]
    },
    {
      path: '/welcome',
      name: 'welcome',
      component: () => import('@/pages/WelcomePage.vue'),
      meta: {
        titleKey: 'routes.welcome',
        icon: 'lucide:message-square'
      }
    }
  ]
})

export default router
