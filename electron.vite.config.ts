import { resolve } from 'path'
import { defineConfig } from 'electron-vite'
import vue from '@vitejs/plugin-vue'
import vueDevTools from 'vite-plugin-vue-devtools'
import svgLoader from 'vite-svg-loader'
import tailwindcss from '@tailwindcss/vite'

const isCustomElement = (tag: string) =>
  tag === 'voice-agent-widget' || tag.startsWith('ui-resource-renderer')
const isVueDevToolsOverlayEnabled = process.env.DEEPCHAT_VUE_DEVTOOLS_OVERLAY !== '0'

export default defineConfig({
  main: {
    resolve: {
      alias: {
        '@': resolve('src/main/'),
        '@shared': resolve('src/shared')
      }
    },
    build: {
      externalizeDeps: {
        exclude: ['mermaid']
      },
      rollupOptions: {
        input: {
          index: resolve('src/main/index.ts'),
          backgroundExecUtilityHost: resolve('src/main/backgroundExecUtilityHostEntry.ts'),
          fileWatcherUtilityHost: resolve('src/main/fileWatcherUtilityHostEntry.ts'),
          schedulerUtilityHost: resolve('src/main/schedulerUtilityHostEntry.ts'),
          lightOcrHelper: resolve('src/main/lightOcrHelperEntry.ts')
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
        '@shared': resolve('src/shared')
      }
    },
    build: {
      rollupOptions: {
        input: {
          index: resolve('src/preload/index.ts'),
          splash: resolve('src/preload/splash-preload.ts'),
          floating: resolve('src/preload/floating-preload.ts'),
          browserOverlay: resolve('src/preload/browser-overlay-preload.ts'),
          pluginSettings: resolve('src/preload/plugin-settings-preload.ts')
        }
      }
    }
  },
  renderer: {
    optimizeDeps: {
      exclude: ['markstream-vue', 'stream-diffs'],
      include: [
        '@antv/infographic',
        // The stream-diffs editor lazily imports Pierre's editor, whose CJS
        // dependencies need prebundling even though stream-diffs is excluded.
        '@pierre/diffs > lru_map',
        'axios'
      ]
    },
    resolve: {
      alias: {
        '@': resolve('src/renderer/src'),
        '@api': resolve('src/renderer/api'),
        '@renderer-notifications': resolve('src/renderer/services/notifications'),
        '@shared': resolve('src/shared'),
        '@shadcn': resolve('src/shadcn'),
        '@dc-ui': resolve('src/dc-ui'),
        vue: 'vue/dist/vue.esm-bundler.js'
      }
    },
    server: {
      host: '0.0.0.0' // 防止代理干扰，导致vite-electron之间ws://localhost:5713和http://localhost:5713通信失败、页面组件无法加载
    },
    plugins: [
      tailwindcss(),
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
          index: resolve('src/renderer/index.html'),
          browserOverlay: resolve('src/renderer/browser-overlay/index.html'),
          floating: resolve('src/renderer/floating/index.html'),
          splash: resolve('src/renderer/splash/index.html'),
          settings: resolve('src/renderer/settings/index.html')
        }
      }
    }
  }
})
