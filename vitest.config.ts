import { defineConfig } from 'vitest/config'
import { resolve } from 'path'
import vue from '@vitejs/plugin-vue'

export default defineConfig({
  plugins: [vue()],
  resolve: {
    alias: [
      // Renderer-specific lib files (must come before generic @/ rules)
      { find: '@/lib/searchHistory', replacement: resolve('src/renderer/src/lib/searchHistory') },
      // Renderer process aliases (match @/components/*, @/composables/*, @/stores/*, @/assets/*)
      { find: /^@\/(components|composables|stores|assets|i18n|views)\//, replacement: resolve('src/renderer/src/') + '/$1/' },
      // Main process aliases (everything else: @/eventbus, @/events, @/presenter, @/utils, @/lib, etc.)
      { find: '@/', replacement: resolve('src/main/') + '/' },
      // Other aliases
      { find: '@shadcn', replacement: resolve('src/shadcn') },
      { find: '@shell', replacement: resolve('src/renderer/shell/') },
      { find: '@shared', replacement: resolve('src/shared') },
      { find: 'electron', replacement: resolve('test/mocks/electron.ts') },
      { find: '@electron-toolkit/utils', replacement: resolve('test/mocks/electron-toolkit-utils.ts') }
    ]
  },
  test: {
    globals: true,
    // Use environmentMatchGlobs to assign different environments based on test file path
    environmentMatchGlobs: [
      ['test/renderer/**', 'jsdom'],  // Renderer tests need DOM
      ['test/main/**', 'node']         // Main process tests use Node
    ],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html', 'lcov'],
      reportsDirectory: './coverage',
      exclude: [
        'node_modules/**',
        'dist/**',
        'out/**',
        'test/**',
        '**/*.d.ts',
        'scripts/**',
        'build/**',
        '.vscode/**',
        '.git/**'
      ],
      thresholds: {
        global: {
          branches: 80,
          functions: 80,
          lines: 80,
          statements: 80
        }
      }
    },
    include: ['test/**/*.{test,spec}.{js,ts}'],
    exclude: [
      'node_modules/**',
      'dist/**',
      'out/**'
    ],
    testTimeout: 10000,
    hookTimeout: 10000,
    setupFiles: ['./test/setup.ts']
  }
})
