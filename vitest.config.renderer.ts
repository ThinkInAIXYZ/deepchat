import { defineConfig } from 'vitest/config'
import { resolve } from 'path'
import vue from '@vitejs/plugin-vue'

export default defineConfig({
  plugins: [vue()],
  resolve: {
    alias: {
      '@': resolve('src/renderer/src'),
      '@shell': resolve('src/renderer/shell'),
      '@shared': resolve('src/shared'),
      '@shadcn': resolve('src/shadcn'),
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
    testTimeout: 10000,
    hookTimeout: 10000,
    setupFiles: ['./test/setup.renderer.ts']
  }
})
