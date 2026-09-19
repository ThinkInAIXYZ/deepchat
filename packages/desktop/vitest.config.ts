import { providerSourceAliases } from '../../scripts/provider-source-aliases.mjs'
import { sharedSourceAliases } from '../../scripts/shared-source-aliases.mjs'
import { defineConfig } from 'vitest/config'
import { dirname, resolve } from 'path'
import { fileURLToPath } from 'node:url'

import vue from '@vitejs/plugin-vue'

const appRoot = dirname(fileURLToPath(import.meta.url))
const workspaceRoot = resolve(appRoot, '../..')
const fromAppRoot = (...segments: string[]) => resolve(appRoot, ...segments)
const fromWorkspaceRoot = (...segments: string[]) => resolve(workspaceRoot, ...segments)

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

const KERNEL_PACKAGE_SRC = resolve(workspaceRoot, 'packages/agent-kernel/src')

const rootScriptResolverPlugin = () => ({
  name: 'deepchat-root-script-resolver',
  resolveId(source: string, importer?: string) {
    if (!importer || !source.startsWith('../../../scripts/ci/')) return null
    return fromWorkspaceRoot('scripts', source.slice('../../../scripts/'.length))
  }
})

const TEST_TIMEOUT_MS = 10000
const TEST_MAX_WORKERS = 2
const publicSharedSourceAliases = () =>
  Object.entries({ ...sharedSourceAliases, ...providerSourceAliases }).map(([find, replacement]) => ({
    find: new RegExp(`^${find}$`),
    replacement
  }))

export default defineConfig({
  root: appRoot,
  test: {
    globals: true,
    // electron-store 11 is ESM-only and gets externalized; inline it so its
    // `electron` import resolves to the test mock instead of the real package.
    server: {
      deps: {
        inline: ['electron-store']
      }
    },
    // Use projects to define different configurations for main and renderer tests
    // This allows each test suite to use the correct alias resolution
    projects: [
      {
        plugins: [vuePlugin()],
        test: {
          name: 'renderer',
          environment: 'jsdom',
          include: [fromAppRoot('test/renderer/**/*.{test,spec}.{js,ts}')],
          setupFiles: [fromAppRoot('test/setup.renderer.ts')],
          globals: true,
          testTimeout: TEST_TIMEOUT_MS,
          hookTimeout: TEST_TIMEOUT_MS,
          maxWorkers: TEST_MAX_WORKERS
        },
        resolve: {
          alias: [
            ...publicSharedSourceAliases(),
            // Renderer process aliases (match electron.vite.config.ts renderer config)
            { find: '@/', replacement: fromAppRoot('src/renderer/src') + '/' },
            { find: '@api', replacement: fromAppRoot('src/renderer/api') },
            {
              find: '@renderer-notifications',
              replacement: fromAppRoot('src/renderer/services/notifications')
            },
            { find: '@shared', replacement: fromAppRoot('src/shared') },
            { find: '@shadcn', replacement: fromAppRoot('src/shadcn') },
            { find: '@dc-ui', replacement: fromAppRoot('src/dc-ui') },
            { find: 'electron', replacement: fromAppRoot('test/mocks/electron.ts') },
            { find: '@electron-toolkit/utils', replacement: fromAppRoot('test/mocks/electron-toolkit-utils.ts') }
          ]
        }
      },
      {
        plugins: [vuePlugin(), rootScriptResolverPlugin()],
        test: {
          name: 'main',
          environment: 'node',
          include: [fromAppRoot('test/main/**/*.{test,spec}.{js,ts}')],
          setupFiles: [fromAppRoot('test/setup.ts')],
          globals: true,
          testTimeout: TEST_TIMEOUT_MS,
          hookTimeout: TEST_TIMEOUT_MS,
          maxWorkers: TEST_MAX_WORKERS,
          // electron-store 11 is ESM-only and would be externalized; inline it so
          // its `electron` import resolves to the test mock, not the real package.
          server: {
            deps: {
              inline: ['electron-store']
            }
          }
        },
        resolve: {
          alias: [
            ...publicSharedSourceAliases(),
            // Main process aliases (match electron.vite.config.ts main config).
            { find: '@/', replacement: fromAppRoot('src/main') + '/' },
            { find: '@shared', replacement: fromAppRoot('src/shared') },
            {
              find: '@deepchat/cli/launcher',
              replacement: fromWorkspaceRoot('packages/cli/src/launcher.mjs')
            },
            // Workspace kernel package resolves to its source so tests need no prior build
            { find: '@deepchat/agent-kernel', replacement: KERNEL_PACKAGE_SRC },
            { find: '@deepchat/mcp', replacement: fromWorkspaceRoot('packages/mcp/src/index.ts') },
            { find: 'electron', replacement: fromAppRoot('test/mocks/electron.ts') },
            { find: '@electron-toolkit/utils', replacement: fromAppRoot('test/mocks/electron-toolkit-utils.ts') }
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
