import { defineConfig } from 'vitest/config'
import { dirname, join, relative, resolve } from 'path'
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

const KERNEL_PACKAGE_SRC = resolve('packages/agent-kernel/src')

/**
 * Test-only single-instance bridge for the kernel's copied `@shared` modules.
 *
 * The @deepchat/agent-kernel package physically copies the `@shared` value modules it needs
 * (NodeNext emit forbids path aliases), so at test time the kernel and the host would otherwise
 * hold two module instances — breaking `vi.mock('@shared/...')` assertions and any shared
 * module state. This transform rewrites the kernel's relative imports into its `shared/` copy
 * back to the host `@shared` alias, which the main-project alias resolves to `src/shared`.
 * Production dist keeps its own copy; the accepted double-instance effects there are recorded
 * in the Stage 2B plan (logger verbose flag, zod parse-only).
 */
const kernelSharedBridgePlugin = () => ({
  name: 'deepchat-kernel-shared-bridge',
  enforce: 'pre',
  transform(code: string, id: string) {
    if (!id.startsWith(KERNEL_PACKAGE_SRC) || !id.endsWith('.ts')) return null
    const importerDirectory = dirname(id)
    return code.replace(
      /((?:from|import|require)\s*\(?\s*)'([^']+)'/g,
      (whole: string, prefix: string, spec: string) => {
        if (!spec.startsWith('.')) return whole
        const resolved = resolve(importerDirectory, spec.replace(/\.js$/, '.ts'))
        if (!resolved.startsWith(`${KERNEL_PACKAGE_SRC}/shared/`)) return whole
        const sharedPath = relative(KERNEL_PACKAGE_SRC, resolved).replace(/^shared\//, '')
        return `${prefix}'@shared/${sharedPath.replace(/\.ts$/, '')}'`
      }
    )
  }
})

const TEST_TIMEOUT_MS = 10000
const TEST_MAX_WORKERS = 2

/**
 * Old in-tree specifiers for every module that physically moved into the kernel package. Tests
 * and suites still reference the historical paths (and `vi.mock` them by that id), so vitest
 * resolves them straight to the package source — the same module instances the kernel imports
 * through its own relative specifiers. Without this, a `vi.mock('@/agent/deepchat/...')` would
 * bind to the one-line re-export shim while the kernel used the package module, silently
 * bypassing the mock. Directory aliases exist only for trees that moved as a whole; partially
 * moved directories (memory, provider, skill, tool, tape/application) use exact file paths so
 * their host-side siblings keep resolving through the generic '@/' alias.
 */
const KERNEL_PATH_ALIASES = [
  ['@/agent/deepchat/loop', 'loop'],
  ['@/agent/deepchat/runtime', 'runtime'],
  ['@/agent/deepchat/memory', 'memory'],
  ['@/agent/deepchat/resources', 'resources'],
  ['@/agent/deepchat/instance', 'instance'],
  ['@/agent/deepchat/contracts', 'contracts'],
  ['@/agent/deepchat/harness/pendingInputWakeupBinding', 'composition/pendingInputWakeupBinding'],
  ['@/agent/shared/agentSessionIds', 'collab/agent-shared/agentSessionIds'],
  ['@/agent/shared/agentSessionNormalization', 'collab/agent-shared/agentSessionNormalization'],
  ['@/agent/shared/storage/sessionPaths', 'collab/agent-shared/storage/sessionPaths'],
  ['@/lib/awaitWithAbort', 'collab/lib/awaitWithAbort'],
  ['@/lib/monotonicTime', 'collab/lib/monotonicTime'],
  ['@/lib/redact', 'collab/lib/redact'],
  ['@/hook/events', 'collab/hook/events'],
  ['@/hook/observer', 'collab/hook/observer'],
  ['@/memory/injection', 'collab/memory/injection'],
  ['@/memory/types', 'collab/memory/types'],
  ['@/memory/ports', 'collab/memory/ports'],
  ['@/memory/domain/audit', 'collab/memory/domain/audit'],
  ['@/memory/domain/clock', 'collab/memory/domain/clock'],
  ['@/memory/domain/directives', 'collab/memory/domain/directives'],
  ['@/memory/domain/types', 'collab/memory/domain/types'],
  ['@/memory/core/asyncDeadline', 'collab/memory/core/asyncDeadline'],
  ['@/memory/core/contributionBudget', 'collab/memory/core/contributionBudget'],
  ['@/memory/core/directiveContribution', 'collab/memory/core/directiveContribution'],
  ['@/memory/core/executionIdentity', 'collab/memory/core/executionIdentity'],
  ['@/memory/core/injectionPort', 'collab/memory/core/injectionPort'],
  ['@/provider/ports', 'collab/provider/ports'],
  ['@/provider/providerFailure', 'collab/provider/providerFailure'],
  ['@/provider/requestTrace', 'collab/provider/requestTrace'],
  ['@/provider/deepseekResponsesAdapter', 'collab/provider/deepseekResponsesAdapter'],
  ['@/session/subagentAuthority', 'collab/session/subagentAuthority'],
  ['@/skill/routingCatalog', 'collab/skill/routingCatalog'],
  ['@/skill/toolNameMapping', 'collab/skill/toolNameMapping'],
  ['@/tool/permission/commandPermissionService', 'collab/tool/permission/commandPermissionService'],
  ['@/tool/permission/commandPermissionCache', 'collab/tool/permission/commandPermissionCache'],
  ['@/tool/permission/permissionMode', 'collab/tool/permission/permissionMode'],
  ['@/tool/codeMode/toolModeTools', 'collab/tool/codeMode/toolModeTools'],
  ['@/tool/agentTools/questionTool', 'collab/tool/agentTools/questionTool'],
  ['@/tool/agentTools/agentPlanTool', 'collab/tool/agentTools/agentPlanTool'],
  ['@/tape/domain', 'tape/domain'],
  ['@/tape/ports', 'tape/ports'],
  ['@/tape/application/capabilityAdapters', 'tape/application/capabilityAdapters'],
  ['@/tape/application/factPersistence', 'tape/application/factPersistence']
].map(([find, packagePath]) => ({
  find,
  replacement: join(KERNEL_PACKAGE_SRC, packagePath)
}))

export default defineConfig({
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
          include: ['test/renderer/**/*.{test,spec}.{js,ts}'],
          setupFiles: ['./test/setup.renderer.ts'],
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
            {
              find: '@renderer-notifications',
              replacement: resolve('src/renderer/services/notifications')
            },
            { find: '@shared', replacement: resolve('src/shared') },
            { find: '@shadcn', replacement: resolve('src/shadcn') },
            { find: '@dc-ui', replacement: resolve('src/dc-ui') },
            { find: 'electron', replacement: resolve('test/mocks/electron.ts') },
            { find: '@electron-toolkit/utils', replacement: resolve('test/mocks/electron-toolkit-utils.ts') }
          ]
        }
      },
      {
        plugins: [vuePlugin(), kernelSharedBridgePlugin()],
        test: {
          name: 'main',
          environment: 'node',
          include: ['test/main/**/*.{test,spec}.{js,ts}'],
          setupFiles: ['./test/setup.ts'],
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
            // Main process aliases (match electron.vite.config.ts main config). The kernel
            // deep-path aliases must precede the generic '@/' alias so old kernel specifiers
            // (and vi.mock ids) resolve to the package source, not the re-export shims.
            ...KERNEL_PATH_ALIASES,
            { find: '@/', replacement: resolve('src/main/') + '/' },
            { find: '@shared', replacement: resolve('src/shared') },
            // Workspace kernel package resolves to its source so tests need no prior build
            { find: '@deepchat/agent-kernel', replacement: KERNEL_PACKAGE_SRC },
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
