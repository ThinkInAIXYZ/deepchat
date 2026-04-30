import './assets/main.css'
import { createPinia } from 'pinia'
import { PiniaColada } from '@pinia/colada'
import { createApp } from 'vue'
import App from './App.vue'
import router from './router'
import { createI18n } from 'vue-i18n'
import locales, { pluralRules } from './i18n'
import 'vue-virtual-scroller/dist/vue-virtual-scroller.css'
import 'katex/dist/katex.min.css'
import {
  clearKaTeXWorker,
  clearMermaidWorker,
  enableKatex,
  enableMermaid,
  preloadCodeBlockRuntime,
  setKaTeXWorker,
  setMermaidWorker,
  terminateWorker
} from 'markstream-vue'
import KatexWorker from 'markstream-vue/workers/katexRenderer.worker?worker&inline'
import MermaidWorker from 'markstream-vue/workers/mermaidParser.worker?worker&inline'
import { preloadIcons } from './lib/iconLoader'

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

enableKatex()
enableMermaid(() => import('mermaid'))

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

const codeBlockThemes = ['vitesse-dark', 'vitesse-light']
const codeBlockLanguages = [
  'jsx',
  'tsx',
  'vue',
  'csharp',
  'python',
  'java',
  'c',
  'cpp',
  'rust',
  'go',
  'shell',
  'shellscript',
  'powershell',
  'sql',
  'json',
  'html',
  'javascript',
  'typescript',
  'css',
  'markdown',
  'xml',
  'yaml',
  'toml',
  'dockerfile',
  'kotlin',
  'objective-c',
  'objective-cpp',
  'php',
  'ruby',
  'scala',
  'svelte',
  'swift',
  'erlang',
  'angular-html',
  'angular-ts',
  'dart',
  'lua',
  'mermaid',
  'cmake',
  'nginx',
  'plaintext'
]

const preloadCodeBlockRuntimeAsync = async () => {
  try {
    const { registerMonacoThemes } = await import('stream-monaco')

    await Promise.all([
      preloadCodeBlockRuntime(),
      registerMonacoThemes(codeBlockThemes, codeBlockLanguages)
    ])
  } catch (error) {
    console.error('[deepchat] failed to preload code block runtime', error)
  }
}

const scheduleCodeBlockRuntimePreload = () => {
  const requestIdleCallback = window.requestIdleCallback

  if (typeof requestIdleCallback === 'function') {
    requestIdleCallback(
      () => {
        void preloadCodeBlockRuntimeAsync()
      },
      { timeout: 1500 }
    )
    return
  }

  window.setTimeout(() => {
    void preloadCodeBlockRuntimeAsync()
  }, 0)
}

const i18n = createI18n({
  locale: 'zh-CN',
  fallbackLocale: 'en-US',
  legacy: false,
  pluralRules,
  messages: locales
})
// Icons will be loaded asynchronously on app mount to improve startup performance
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

// Preload icons asynchronously after app mount to improve perceived startup time
setTimeout(() => {
  preloadIcons().catch((error) => {
    console.error('Failed to preload icons:', error)
  })
}, 0)

scheduleCodeBlockRuntimePreload()
