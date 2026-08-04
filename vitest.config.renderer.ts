import { defineConfig } from 'vitest/config'
import { resolve } from 'path'
import vue from '@vitejs/plugin-vue'

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
      '@': resolve('src/renderer/src'),
      '@api': resolve('src/renderer/api'),
      '@renderer-notifications': resolve('src/renderer/services/notifications'),
      '@shadcn': resolve('src/shadcn'),
      '@dc-ui': resolve('src/dc-ui'),
      '@shared': resolve('src/shared'),
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
    include: ['test/renderer/**/*.{test,spec}.{js,ts}'],
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
    setupFiles: ['./test/setup.renderer.ts']
  }
})
