import { defineConfig } from 'vitest/config'
import { resolve } from 'path'
import vue from '@vitejs/plugin-vue'

const isCustomElement = (tag: string) =>
  tag === 'voice-agent-widget' || tag.startsWith('ui-resource-renderer')

const vuePlugin = () =>
  vue({
    template: {
      compilerOptions: {
        isCustomElement
      }
    }
  })

const TEST_TIMEOUT_MS = 10000
const TEST_MAX_WORKERS = 2

export default defineConfig({
  test: {
    globals: true,
    // Use projects to define different configurations for main and renderer tests
    // This allows each test suite to use the correct alias resolution
    projects: [
      {
        plugins: [vuePlugin()],
        test: {
          name: 'renderer',
          environment: 'jsdom',
          include: ['test/renderer/**/*.{test,spec}.{js,ts}'],
          setupFiles: ['./test/setup.ts'],
          globals: true,
          testTimeout: TEST_TIMEOUT_MS,
          hookTimeout: TEST_TIMEOUT_MS,
          maxWorkers: TEST_MAX_WORKERS
        },
        resolve: {
          alias: [
            // Renderer process aliases (match electron.vite.config.ts renderer config)
            { find: '@/', replacement: resolve('src/renderer/src/') + '/' },
            { find: '@api', replacement: resolve('src/renderer/api') },
            { find: '@browser', replacement: resolve('src/renderer/browser/') },
            { find: '@shared', replacement: resolve('src/shared') },
            { find: '@shadcn', replacement: resolve('src/shadcn') },
            { find: 'electron', replacement: resolve('test/mocks/electron.ts') },
            { find: '@electron-toolkit/utils', replacement: resolve('test/mocks/electron-toolkit-utils.ts') }
          ]
        }
      },
      {
        plugins: [vuePlugin()],
        test: {
          name: 'main',
          environment: 'node',
          include: ['test/main/**/*.{test,spec}.{js,ts}'],
          setupFiles: ['./test/setup.ts'],
          globals: true,
          testTimeout: TEST_TIMEOUT_MS,
          hookTimeout: TEST_TIMEOUT_MS,
          maxWorkers: TEST_MAX_WORKERS
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
    testTimeout: TEST_TIMEOUT_MS,
    hookTimeout: TEST_TIMEOUT_MS,
    maxWorkers: TEST_MAX_WORKERS
  }
})
