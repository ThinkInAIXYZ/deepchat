import './assets/main.css'
import { addCollection } from '@iconify/vue'
import lucideIcons from '@iconify-json/lucide/icons.json'
import vscodeIcons from '@iconify-json/vscode-icons/icons.json'
import { createPinia } from 'pinia'
import { PiniaColada } from '@pinia/colada'
import { createApp } from 'vue'
import App from './App.vue'
import router from './router'
import { createI18n } from 'vue-i18n'
import locales from './i18n'
import 'vue-virtual-scroller/dist/vue-virtual-scroller.css'
import 'katex/dist/katex.min.css'
import '@mcp-ui/client/ui-resource-renderer.wc.js'
import {
  clearKaTeXWorker,
  clearMermaidWorker,
  setKaTeXWorker,
  setMermaidWorker,
  terminateWorker
} from 'markstream-vue'
import KatexWorker from 'markstream-vue/workers/katexRenderer.worker?worker&inline'
import MermaidWorker from 'markstream-vue/workers/mermaidParser.worker?worker&inline'

const globalScope = globalThis as typeof globalThis & {
  __markdownWorkers?: {
    katex: Worker
    mermaid: Worker
  }
}

if (!globalScope.__markdownWorkers) {
  const katex = new KatexWorker()
  const mermaid = new MermaidWorker()
  globalScope.__markdownWorkers = { katex, mermaid }
  setKaTeXWorker(katex)
  setMermaidWorker(mermaid)
}

window.addEventListener('beforeunload', () => {
  const workers = globalScope.__markdownWorkers
  if (workers) {
    workers.katex.terminate()
    workers.mermaid.terminate()
    globalScope.__markdownWorkers = undefined
  }
  clearKaTeXWorker()
  clearMermaidWorker()
  terminateWorker()
})

const i18n = createI18n({
  locale: 'zh-CN',
  fallbackLocale: 'en-US',
  legacy: false,
  messages: locales
})
// Add complete icon collections locally
addCollection(lucideIcons)
addCollection(vscodeIcons)
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
app.mount('#app')
