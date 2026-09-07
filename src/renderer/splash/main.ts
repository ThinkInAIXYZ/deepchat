import '../src/assets/main.css'
import { createApp } from 'vue'
import Loading from './loading.vue'
import { createRendererI18n } from '../src/i18n/bootstrap'

async function bootstrap() {
  const { i18n, languageState } = await createRendererI18n({
    getLanguageState: () => window.deepchatSplash.getLanguageState()
  })

  document.documentElement.dir = languageState.direction === 'rtl' ? 'rtl' : 'auto'

  const app = createApp(Loading)
  app.use(i18n)
  app.mount('#app')
}

bootstrap().catch((error) => {
  console.error('Failed to bootstrap splash renderer:', error)
})
