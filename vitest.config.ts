import { sharedSourceAliases } from './scripts/shared-source-aliases.mjs'
import { defineConfig } from 'vitest/config'
import { join, resolve } from 'path'
import vue from '@vitejs/plugin-vue'

const isCustomElement = (tag: string) =>
  tag === 'voice-agent-widget' || tag.startsWith('ui-resource-renderer')

const vuePlugin = () =>
  vue({
    template: { compilerOptions: { isCustomElement } }
  })

const KERNEL_PACKAGE_SRC = resolve(import.meta.dirname, 'packages/agent-kernel/src')
const TEST_TIMEOUT_MS = 10000
const TEST_MAX_WORKERS = 2

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
].map(([find, packagePath]) => ({ find, replacement: join(KERNEL_PACKAGE_SRC, packagePath) }))

const sharedAliases = () =>
  Object.entries(sharedSourceAliases).map(([find, replacement]) => ({
    find: new RegExp(`^${find}$`),
    replacement
  }))

export default defineConfig({
  test: {
    globals: true,
    server: { deps: { inline: ['electron-store'] } },
    projects: [
      {
        plugins: [vuePlugin()],
        test: {
          name: 'renderer', environment: 'jsdom', include: ['test/renderer/**/*.{test,spec}.{js,ts}'],
          setupFiles: ['./test/setup.renderer.ts'], globals: true, testTimeout: TEST_TIMEOUT_MS,
          hookTimeout: TEST_TIMEOUT_MS, maxWorkers: TEST_MAX_WORKERS
        },
        resolve: {
          alias: [
            ...sharedAliases(),
            { find: '@/', replacement: resolve(import.meta.dirname, 'src/renderer/src/') + '/' },
            { find: '@api', replacement: resolve(import.meta.dirname, 'src/renderer/api') },
            { find: '@renderer-notifications', replacement: resolve(import.meta.dirname, 'src/renderer/services/notifications') },
            { find: '@shared', replacement: resolve(import.meta.dirname, 'src/shared') },
            { find: '@shadcn', replacement: resolve(import.meta.dirname, 'src/shadcn') },
            { find: '@dc-ui', replacement: resolve(import.meta.dirname, 'src/dc-ui') },
            { find: 'electron', replacement: resolve(import.meta.dirname, 'test/mocks/electron.ts') },
            { find: '@electron-toolkit/utils', replacement: resolve(import.meta.dirname, 'test/mocks/electron-toolkit-utils.ts') }
          ]
        }
      },
      {
        plugins: [vuePlugin()],
        test: {
          name: 'main', environment: 'node', include: ['test/main/**/*.{test,spec}.{js,ts}'],
          setupFiles: ['./test/setup.ts'], globals: true, testTimeout: TEST_TIMEOUT_MS,
          hookTimeout: TEST_TIMEOUT_MS, maxWorkers: TEST_MAX_WORKERS,
          server: { deps: { inline: ['electron-store'] } }
        },
        resolve: {
          alias: [
            ...sharedAliases(), ...KERNEL_PATH_ALIASES,
            { find: '@/', replacement: resolve(import.meta.dirname, 'src/main/') + '/' },
            { find: '@shared', replacement: resolve(import.meta.dirname, 'src/shared') },
            { find: '@deepchat/agent-kernel', replacement: KERNEL_PACKAGE_SRC },
            { find: 'electron', replacement: resolve(import.meta.dirname, 'test/mocks/electron.ts') },
            { find: '@electron-toolkit/utils', replacement: resolve(import.meta.dirname, 'test/mocks/electron-toolkit-utils.ts') }
          ]
        }
      }
    ],
    coverage: {
      provider: 'v8', reporter: ['text', 'html', 'lcov'], reportsDirectory: './coverage',
      exclude: ['node_modules/**', 'dist/**', 'out/**', 'test/**', '**/*.d.ts', 'scripts/**', 'build/**', '.vscode/**', '.git/**'],
      thresholds: { global: { branches: 80, functions: 80, lines: 80, statements: 80 } }
    },
    testTimeout: TEST_TIMEOUT_MS, hookTimeout: TEST_TIMEOUT_MS, maxWorkers: TEST_MAX_WORKERS
  }
})
