import { createRouter, createWebHistory } from 'vue-router'

const router = createRouter({
  history: createWebHistory(import.meta.env.BASE_URL),
  routes: [
    {
      path: '/conversation/:id',
      name: 'conversation',
      component: () => import('@/views/ChatTabView.vue'),
      meta: {
        titleKey: 'routes.conversation',
        icon: 'lucide:message-square'
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
      : []),
    {
      path: '/',
      redirect: '/home'
    },
    {
      path: '/home',
      name: 'home',
      component: () => import('@/views/HomeTabView.vue')
    }
  ]
})

export default router
