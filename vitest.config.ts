import { defineConfig } from 'vitest/config'
import { resolve } from 'path'

export default defineConfig({
  resolve: {
    alias: {
      '@': resolve('src/main/'),
        '@shared': resolve('src/shared'),
        'electron': resolve('test/mocks/electron.ts'),
        '@electron-toolkit/utils': resolve('test/mocks/electron-toolkit-utils.ts')
    }
  },
  test: {
    globals: true,
    environment: 'node', // 默认使用node环境，适合main进程测试
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
