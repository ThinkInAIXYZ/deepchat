import { sharedSourceAliases } from './scripts/shared-source-aliases.mjs'
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
        ...sharedSourceAliases,
      '@': resolve(import.meta.dirname, 'src/renderer/src'),
      '@api': resolve(import.meta.dirname, 'src/renderer/api'),
      '@renderer-notifications': resolve(import.meta.dirname, 'src/renderer/services/notifications'),
      '@shadcn': resolve(import.meta.dirname, 'src/shadcn'),
      '@dc-ui': resolve(import.meta.dirname, 'src/dc-ui'),
      '@shared': resolve(import.meta.dirname, 'src/shared'),
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
