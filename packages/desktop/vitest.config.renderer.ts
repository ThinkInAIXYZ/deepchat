import { defineConfig } from 'vitest/config'
import { dirname, resolve } from 'path'
import { fileURLToPath } from 'node:url'

import vue from '@vitejs/plugin-vue'

const appRoot = dirname(fileURLToPath(import.meta.url))
const workspaceRoot = resolve(appRoot, '../..')
const fromAppRoot = (...segments: string[]) => resolve(appRoot, ...segments)

const isCustomElement = (tag: string) =>
  tag === 'voice-agent-widget' || tag.startsWith('ui-resource-renderer')

export default defineConfig({
  plugins: [
    vue({
      template: {
        compilerOptions: {
          isCustomElement
        }
      }
    })
  ],
  resolve: {
    alias: {
      '@': fromAppRoot('src/renderer/src'),
      '@api': fromAppRoot('src/renderer/api'),
      '@renderer-notifications': fromAppRoot('src/renderer/services/notifications'),
      '@shadcn': fromAppRoot('src/shadcn'),
      '@dc-ui': fromAppRoot('src/dc-ui'),
      '@shared': fromAppRoot('src/shared'),
      vue: 'vue/dist/vue.esm-bundler.js'
    }
  },
  test: {
    globals: true,
    environment: 'jsdom', // 使用jsdom环境，适合renderer进程测试
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html', 'lcov'],
      reportsDirectory: './coverage/renderer',
      include: ['src/renderer/**'],
      exclude: [
        'node_modules/**',
        'dist/**',
        'out/**',
        'test/**',
        '**/*.d.ts',
        'scripts/**',
        'build/**',
        '.vscode/**',
        '.git/**',
        '**/*.stories.{js,ts}',
        '**/*.config.{js,ts}'
      ]
    },
    include: [fromAppRoot('test/renderer/**/*.{test,spec}.{js,ts}')],
    exclude: [
      'node_modules/**',
      'dist/**',
      'out/**'
    ],
    // Heavy jsdom/Markstream suites compete for CPU and GC when unconstrained; keep
    // enough parallelism for feedback while preserving the existing timeout signal.
    minWorkers: 1,
    maxWorkers: 2,
    testTimeout: 10000,
    hookTimeout: 10000,
    setupFiles: [fromAppRoot('test/setup.renderer.ts')]
  }
})
