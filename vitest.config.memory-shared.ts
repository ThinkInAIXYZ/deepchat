import { resolve } from 'node:path'

export const memoryResolveConfig = {
  alias: [
    {
      find: /^@\/presenter\/memoryPresenter$/,
      replacement: resolve('test/main/presenter/fakes/memoryPresenterTestAdapter.ts')
    },
    { find: '@/', replacement: resolve('src/main/') + '/' },
    { find: '@shared', replacement: resolve('src/shared') },
    { find: 'electron', replacement: resolve('test/mocks/electron.ts') },
    {
      find: '@electron-toolkit/utils',
      replacement: resolve('test/mocks/electron-toolkit-utils.ts')
    }
  ]
}

export const memoryTestDefaults = {
  environment: 'node' as const,
  setupFiles: ['./test/setup.ts'],
  globals: true
}
