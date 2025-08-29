import { resolve } from 'path'
import { defineConfig, externalizeDepsPlugin } from 'electron-vite'
import vue from '@vitejs/plugin-vue'
import autoprefixer from 'autoprefixer'
import tailwind from 'tailwindcss'
import vueDevTools from 'vite-plugin-vue-devtools'
import svgLoader from 'vite-svg-loader'
import monacoEditorPlugin from 'vite-plugin-monaco-editor-esm'
import path from 'node:path'

export default defineConfig({
  main: {
    plugins: [
      externalizeDepsPlugin({
        exclude: ['mermaid', 'dompurify']
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
        external: ['sharp','@duckdb/node-api'],
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
        vue: 'vue/dist/vue.esm-bundler.js'
      }
    },
    css: {
      postcss: {
        // @ts-ignore
        plugins: [tailwind(), autoprefixer()]
      }
    },
    server: {
      host: '0.0.0.0' // 防止代理干扰，导致vite-electron之间ws://localhost:5713和http://localhost:5713通信失败、页面组件无法加载
    },
    plugins: [
      monacoEditorPlugin({
        languageWorkers: ['editorWorkerService', 'typescript', 'css', 'html', 'json'],
        customDistPath(_root, buildOutDir, _base) {
          return path.resolve(buildOutDir, 'monacoeditorwork')
        },
      }),
      vue(),
      svgLoader(),
      vueDevTools({
        // use export LAUNCH_EDITOR=cursor instead
        // launchEditor: 'cursor'
      })
    ],
    build: {
      minify: 'esbuild',
      rollupOptions: {
        input: {
          shell: resolve('src/renderer/shell/index.html'),
          index: resolve('src/renderer/index.html'),
          floating: resolve('src/renderer/floating/index.html'),
          splash: resolve('src/renderer/splash/index.html')
        }
      }
    }
  }
})
