import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { providerSourceAliases } from '../../scripts/provider-source-aliases.mjs'
import { sharedSourceAliases } from '../../scripts/shared-source-aliases.mjs'

const appRoot = dirname(fileURLToPath(import.meta.url))
const workspaceRoot = resolve(appRoot, '../..')
const fromAppRoot = (...segments: string[]) => resolve(appRoot, ...segments)


const KERNEL_PACKAGE_SRC = resolve(workspaceRoot, 'packages/agent-kernel/src')

// Workspace packages resolve from source, matching the aggregate config contract: memory suites
// must never require a prebuilt shared or provider dist.
const publicSharedSourceAliases = () =>
  Object.entries({ ...sharedSourceAliases, ...providerSourceAliases }).map(([find, replacement]) => ({
    find: new RegExp(`^${find}$`),
    replacement
  }))

export const memoryResolveConfig = {
  alias: [
    ...publicSharedSourceAliases(),
    {
      find: /^@\/presenter\/memoryPresenter$/,
      replacement: fromAppRoot('test/main/presenter/fakes/memoryPresenterTestAdapter.ts')
    },
    { find: '@/', replacement: fromAppRoot('src/main') + '/' },
    { find: '@shared', replacement: fromAppRoot('src/shared') },
    { find: '@deepchat/agent-kernel', replacement: KERNEL_PACKAGE_SRC },
    { find: 'electron', replacement: fromAppRoot('test/mocks/electron.ts') },
    {
      find: '@electron-toolkit/utils',
      replacement: fromAppRoot('test/mocks/electron-toolkit-utils.ts')
    }
  ]
}

export const memoryTestDefaults = {
  environment: 'node' as const,
  setupFiles: [fromAppRoot('test/setup.ts')],
  globals: true
}
