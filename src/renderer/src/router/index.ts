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
