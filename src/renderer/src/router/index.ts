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
      path: '/browser',
      name: 'browser',
      component: () => import('@/views/BrowserWindowView.vue'),
      meta: {
        titleKey: 'common.browser.name',
        icon: 'lucide:compass'
      }
    },
    {
      path: '/welcome',
      name: 'welcome',
      component: () => import('@/views/WelcomeView.vue'),
      meta: {
        titleKey: 'routes.welcome',
        icon: 'lucide:message-square'
      }
    },
    ...(import.meta.env.VITE_ENABLE_PLAYGROUND === 'true'
      ? [
          {
            path: '/playground',
            name: 'playground',
            component: () => import('@/views/PlaygroundTabView.vue'),
            meta: {
              titleKey: 'routes.playground',
              icon: 'lucide:flask-conical'
            }
          }
        ]
      : [])
  ]
})

export default router
