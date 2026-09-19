import { sharedSourceAliases } from './scripts/shared-source-aliases.mjs'
import { resolve } from 'path'
import { defineConfig } from 'electron-vite'
import vue from '@vitejs/plugin-vue'
import vueDevTools from 'vite-plugin-vue-devtools'
import svgLoader from 'vite-svg-loader'
import monacoEditorPlugin from 'vite-plugin-monaco-editor-esm'
import path from 'node:path'
import tailwindcss from '@tailwindcss/vite'

const isCustomElement = (tag: string) =>
  tag === 'voice-agent-widget' || tag.startsWith('ui-resource-renderer')
const isVueDevToolsOverlayEnabled = process.env.DEEPCHAT_VUE_DEVTOOLS_OVERLAY !== '0'

export default defineConfig({
  main: {
    resolve: {
      alias: [
            ...Object.entries(sharedSourceAliases).map(([find, replacement]) => ({ find: new RegExp(`^${find}$`), replacement })),
        { find: '@', replacement: resolve(import.meta.dirname, 'src/main/') },
        { find: '@shared', replacement: resolve(import.meta.dirname, 'src/shared') },
        // Workspace kernel package compiles from source in the app build
        { find: '@deepchat/agent-kernel', replacement: resolve(import.meta.dirname, 'packages/agent-kernel/src') }
      ]
    },
    build: {
      externalizeDeps: {
        exclude: ['mermaid', '@deepchat/agent-kernel', '@deepchat/shared']
      },
      rollupOptions: {
        input: {
          index: resolve(import.meta.dirname, 'src/main/index.ts'),
          backgroundExecUtilityHost: resolve(import.meta.dirname, 'src/main/backgroundExecUtilityHostEntry.ts'),
          fileWatcherUtilityHost: resolve(import.meta.dirname, 'src/main/fileWatcherUtilityHostEntry.ts'),
          schedulerUtilityHost: resolve(import.meta.dirname, 'src/main/schedulerUtilityHostEntry.ts'),
          codeModeUtilityHost: resolve(import.meta.dirname, 'src/main/codeModeUtilityHostEntry.ts'),
          lightOcrHelper: resolve(import.meta.dirname, 'src/main/lightOcrHelperEntry.ts')
        },
        external: ['sharp', '@duckdb/node-api'],
        output: {
          entryFileNames: '[name].js',
          chunkFileNames: 'chunks/[name]-[hash].js',
          manualChunks: undefined
        }
      }
    }
  },
  preload: {
    resolve: {
      alias: {
        ...sharedSourceAliases,
        '@shared': resolve(import.meta.dirname, 'src/shared')
      }
    },
    build: {
      rollupOptions: {
        input: {
          index: resolve(import.meta.dirname, 'src/preload/index.ts'),
          splash: resolve(import.meta.dirname, 'src/preload/splash-preload.ts'),
          floating: resolve(import.meta.dirname, 'src/preload/floating-preload.ts'),
          browserOverlay: resolve(import.meta.dirname, 'src/preload/browser-overlay-preload.ts'),
          pluginSettings: resolve(import.meta.dirname, 'src/preload/plugin-settings-preload.ts')
        }
      }
    }
  },
  renderer: {
    optimizeDeps: {
      exclude: ['markstream-vue', 'stream-monaco'],
      include: [
        '@antv/infographic',
        'monaco-editor',
        'axios'
      ]
    },
    resolve: {
      alias: {
        ...sharedSourceAliases,
        '@': resolve(import.meta.dirname, 'src/renderer/src'),
        '@api': resolve(import.meta.dirname, 'src/renderer/api'),
        '@renderer-notifications': resolve(import.meta.dirname, 'src/renderer/services/notifications'),
        '@shared': resolve(import.meta.dirname, 'src/shared'),
        '@shadcn': resolve(import.meta.dirname, 'src/shadcn'),
        '@dc-ui': resolve(import.meta.dirname, 'src/dc-ui'),
        vue: 'vue/dist/vue.esm-bundler.js'
      }
    },
    server: {
      host: '0.0.0.0' // 防止代理干扰，导致vite-electron之间ws://localhost:5713和http://localhost:5713通信失败、页面组件无法加载
    },
    plugins: [
      tailwindcss(),
      monacoEditorPlugin({
        languageWorkers: [],
        customWorkers: [
          {
            label: 'editorWorkerService',
            entry: 'monaco-editor/esm/vs/editor/editor.worker.js',
          },
          {
            label: 'typescript',
            entry: 'monaco-editor/esm/vs/language/typescript/ts.worker.js',
          },
          {
            label: 'css',
            entry: 'monaco-editor/esm/vs/language/css/css.worker.js',
          },
          {
            label: 'html',
            entry: 'monaco-editor/esm/vs/language/html/html.worker.js',
          },
          {
            label: 'json',
            entry: 'monaco-editor/esm/vs/language/json/json.worker.js',
          },
        ],
        customDistPath(_root, buildOutDir, _base) {
          return path.resolve(buildOutDir, 'monacoeditorwork')
        },
      }),
      vue({
        template: {
          compilerOptions: {
            isCustomElement
          }
        }
      }),
      svgLoader(),
      ...(isVueDevToolsOverlayEnabled
        ? [
            vueDevTools({
              appendTo: 'src/renderer/src/main.ts'
            })
          ]
        : [])
    ],
    worker: {
      format: 'es'
    },
    build: {
      minify: 'esbuild',
      // Ensure CSS order in build matches import order in dev
      // This prevents extracted CSS from async chunks from reordering
      // and breaking cascade precedence (e.g. markdown renderer vs app styles)
      cssCodeSplit: false,
      rollupOptions: {
        input: {
          index: resolve(import.meta.dirname, 'src/renderer/index.html'),
          browserOverlay: resolve(import.meta.dirname, 'src/renderer/browser-overlay/index.html'),
          floating: resolve(import.meta.dirname, 'src/renderer/floating/index.html'),
          splash: resolve(import.meta.dirname, 'src/renderer/splash/index.html'),
          settings: resolve(import.meta.dirname, 'src/renderer/settings/index.html')
        }
      }
    }
  }
})
