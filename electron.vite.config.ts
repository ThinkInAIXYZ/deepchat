import { resolve } from 'path'
import { defineConfig, externalizeDepsPlugin } from 'electron-vite'
import vue from '@vitejs/plugin-vue'
import vueDevTools from 'vite-plugin-vue-devtools'
import svgLoader from 'vite-svg-loader'
import monacoEditorPlugin from 'vite-plugin-monaco-editor-esm'
import path from 'node:path'
import tailwindcss from '@tailwindcss/vite'


export default defineConfig({
  main: {
    plugins: [
      externalizeDepsPlugin({
        exclude: ['mermaid']
      }),
    ],
    resolve: {
      alias: {
        '@': resolve('src/main/'),
        '@shared': resolve('src/shared')
      }
    },
    build: {
      rollupOptions: {
        external: ['sharp', '@duckdb/node-api'],
        output: {
          inlineDynamicImports: true,
          manualChunks: undefined,  // Disable automatic chunk splitting
        }
      }
    }
  },
  preload: {
    plugins: [externalizeDepsPlugin()],
    resolve: {
      alias: {
        '@shared': resolve('src/shared')
      }
    },
    build: {
      rollupOptions: {
        input: {
          index: resolve('src/preload/index.ts'),
          floating: resolve('src/preload/floating-preload.ts')
        }
      }
    }
  },
  renderer: {
    define: {
      'import.meta.env.VITE_ENABLE_PLAYGROUND': JSON.stringify(
        process.env.VITE_ENABLE_PLAYGROUND ?? 'false'
      )
    },
    optimizeDeps: {
      include: [
        'monaco-editor',
        'axios'
      ]
    },
    resolve: {
      alias: {
        '@': resolve('src/renderer/src'),
        '@shell': resolve('src/renderer/shell'),
        '@shared': resolve('src/shared'),
        "@shadcn": resolve('src/shadcn'),
        vue: 'vue/dist/vue.esm-bundler.js'
      }
    },
    server: {
      host: '0.0.0.0' // 防止代理干扰，导致vite-electron之间ws://localhost:5713和http://localhost:5713通信失败、页面组件无法加载
    },
    plugins: [
      tailwindcss(),
      monacoEditorPlugin({
        languageWorkers: ['editorWorkerService', 'typescript', 'css', 'html', 'json'],
        customDistPath(_root, buildOutDir, _base) {
          return path.resolve(buildOutDir, 'monacoeditorwork')
        },
      }),
      vue(),
      svgLoader(),
      vueDevTools()
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
          shell: resolve('src/renderer/shell/index.html'),
          index: resolve('src/renderer/index.html'),
          floating: resolve('src/renderer/floating/index.html'),
          splash: resolve('src/renderer/splash/index.html'),
          settings: resolve('src/renderer/settings/index.html')
        }
      }
    }
  }
})
