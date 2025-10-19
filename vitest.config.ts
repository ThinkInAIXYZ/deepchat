import { defineConfig } from 'vitest/config'
import { resolve } from 'path'
import vue from '@vitejs/plugin-vue'

export default defineConfig({
  test: {
    globals: true,
    // Use projects to define different configurations for main and renderer tests
    // This allows each test suite to use the correct alias resolution
    projects: [
      {
        plugins: [vue()],
        test: {
          name: 'renderer',
          environment: 'jsdom',
          include: ['test/renderer/**/*.{test,spec}.{js,ts}'],
          setupFiles: ['./test/setup.ts'],
          globals: true
        },
        resolve: {
          alias: [
            // Renderer process aliases (match electron.vite.config.ts renderer config)
            { find: '@/', replacement: resolve('src/renderer/src/') + '/' },
            { find: '@shell', replacement: resolve('src/renderer/shell/') },
            { find: '@shared', replacement: resolve('src/shared') },
            { find: '@shadcn', replacement: resolve('src/shadcn') },
            { find: 'electron', replacement: resolve('test/mocks/electron.ts') },
            { find: '@electron-toolkit/utils', replacement: resolve('test/mocks/electron-toolkit-utils.ts') }
          ]
        }
      },
      {
        plugins: [vue()],
        test: {
          name: 'main',
          environment: 'node',
          include: ['test/main/**/*.{test,spec}.{js,ts}'],
          setupFiles: ['./test/setup.ts'],
          globals: true
        },
        resolve: {
          alias: [
            // Main process aliases (match electron.vite.config.ts main config)
            { find: '@/', replacement: resolve('src/main/') + '/' },
            { find: '@shared', replacement: resolve('src/shared') },
            { find: 'electron', replacement: resolve('test/mocks/electron.ts') },
            { find: '@electron-toolkit/utils', replacement: resolve('test/mocks/electron-toolkit-utils.ts') }
          ]
        }
      }
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
    testTimeout: 10000,
    hookTimeout: 10000
  }
})
