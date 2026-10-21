import './assets/main.css'
import { createPinia } from 'pinia'
import { PiniaColada } from '@pinia/colada'
import { createApp } from 'vue'
import 'vue-virtual-scroller/dist/vue-virtual-scroller.css'
import 'katex/dist/katex.min.css'

import App from './App.vue'
import router from './router'
import { createRendererI18n } from './i18n/bootstrap'
import { preloadIcons } from './lib/iconLoader'
import { createConfigClient } from '@api/ConfigClient'

async function bootstrap() {
  const configClient = createConfigClient()
  const { i18n, languageState } = await createRendererI18n({
    getLanguageState: () => configClient.getLanguageState()
  })

  document.documentElement.dir = languageState.direction === 'rtl' ? 'rtl' : 'auto'

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
  // Register bundled icons before components request missing icons from the network.
  await preloadIcons()
  app.mount('#app')
}

bootstrap().catch((error) => {
  console.error('Failed to bootstrap the main renderer:', error)
})
