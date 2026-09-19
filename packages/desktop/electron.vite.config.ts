import { sharedSourceAliases } from '../../scripts/shared-source-aliases.mjs'
import { fileURLToPath } from 'node:url'
import { defineConfig } from 'electron-vite'
import vue from '@vitejs/plugin-vue'
import vueDevTools from 'vite-plugin-vue-devtools'
import svgLoader from 'vite-svg-loader'
import monacoEditorPlugin from 'vite-plugin-monaco-editor-esm'
import path from 'node:path'
import tailwindcss from '@tailwindcss/vite'

const appRoot = path.dirname(fileURLToPath(import.meta.url))
const workspaceRoot = path.resolve(appRoot, '../..')
const fromAppRoot = (...segments: string[]) => path.join(appRoot, ...segments)

const isCustomElement = (tag: string) =>
  tag === 'voice-agent-widget' || tag.startsWith('ui-resource-renderer')
const isVueDevToolsOverlayEnabled = process.env.DEEPCHAT_VUE_DEVTOOLS_OVERLAY !== '0'

export default defineConfig({
  main: {
    resolve: {
      alias: [
        ...Object.entries(sharedSourceAliases).map(([find, replacement]) => ({
          find: new RegExp(`^${find}$`),
          replacement
        })),
        { find: '@', replacement: fromAppRoot('src', 'main') },
        { find: '@shared', replacement: fromAppRoot('src', 'shared') },
        {
          find: '@deepchat/cli/launcher',
          replacement: path.join(workspaceRoot, 'packages', 'cli', 'src', 'launcher.mjs')
        },
        // Workspace kernel package compiles from source in the app build
        { find: '@deepchat/agent-kernel', replacement: path.join(workspaceRoot, 'packages', 'agent-kernel', 'src') }
      ]
    },
    build: {
      externalizeDeps: {
        exclude: ['mermaid', '@deepchat/agent-kernel', '@deepchat/cli', '@deepchat/shared']
      },
      rollupOptions: {
        input: {
          index: fromAppRoot('src', 'main', 'index.ts'),
          backgroundExecUtilityHost: fromAppRoot('src', 'main', 'backgroundExecUtilityHostEntry.ts'),
          fileWatcherUtilityHost: fromAppRoot('src', 'main', 'fileWatcherUtilityHostEntry.ts'),
          schedulerUtilityHost: fromAppRoot('src', 'main', 'schedulerUtilityHostEntry.ts'),
          codeModeUtilityHost: fromAppRoot('src', 'main', 'codeModeUtilityHostEntry.ts'),
          lightOcrHelper: fromAppRoot('src', 'main', 'lightOcrHelperEntry.ts')
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
        '@shared': fromAppRoot('src', 'shared')
      }
    },
    build: {
      rollupOptions: {
        input: {
          index: fromAppRoot('src', 'preload', 'index.ts'),
          splash: fromAppRoot('src', 'preload', 'splash-preload.ts'),
          floating: fromAppRoot('src', 'preload', 'floating-preload.ts'),
          browserOverlay: fromAppRoot('src', 'preload', 'browser-overlay-preload.ts'),
          pluginSettings: fromAppRoot('src', 'preload', 'plugin-settings-preload.ts')
        }
      }
    }
  },
  renderer: {
    optimizeDeps: {
      exclude: ['markstream-vue', 'stream-monaco'],
      include: ['@antv/infographic', 'monaco-editor', 'axios']
    },
    resolve: {
      alias: {
        ...sharedSourceAliases,
        '@': fromAppRoot('src', 'renderer', 'src'),
        '@api': fromAppRoot('src', 'renderer', 'api'),
        '@renderer-notifications': fromAppRoot('src', 'renderer', 'services', 'notifications'),
        '@shared': fromAppRoot('src', 'shared'),
        '@shadcn': fromAppRoot('src', 'shadcn'),
        '@dc-ui': fromAppRoot('src', 'dc-ui'),
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
          { label: 'editorWorkerService', entry: 'monaco-editor/esm/vs/editor/editor.worker.js' },
          { label: 'typescript', entry: 'monaco-editor/esm/vs/language/typescript/ts.worker.js' },
          { label: 'css', entry: 'monaco-editor/esm/vs/language/css/css.worker.js' },
          { label: 'html', entry: 'monaco-editor/esm/vs/language/html/html.worker.js' },
          { label: 'json', entry: 'monaco-editor/esm/vs/language/json/json.worker.js' }
        ],
        customDistPath(_root, buildOutDir, _base) {
          return path.resolve(buildOutDir, 'monacoeditorwork')
        }
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
          index: fromAppRoot('src', 'renderer', 'index.html'),
          browserOverlay: fromAppRoot('src', 'renderer', 'browser-overlay', 'index.html'),
          floating: fromAppRoot('src', 'renderer', 'floating', 'index.html'),
          splash: fromAppRoot('src', 'renderer', 'splash', 'index.html'),
          settings: fromAppRoot('src', 'renderer', 'settings', 'index.html')
        }
      }
    }
  }
})
