import { describe, expect, it, vi } from 'vitest'

// The main test setup mocks `fs`; this guard needs the real filesystem.
const fs = await vi.importActual<typeof import('node:fs')>('node:fs')
const path = await vi.importActual<typeof import('node:path')>('node:path')

const REPO_ROOT = process.cwd()

const listSourceFiles = (directory: string): string[] => {
  const files: string[] = []
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const entryPath = path.join(directory, entry.name)
    if (entry.isDirectory()) {
      files.push(...listSourceFiles(entryPath))
      continue
    }
    if (/\.(ts|vue)$/.test(entry.name)) {
      files.push(entryPath)
    }
  }
  return files
}

const filesCalling = (sourceRoot: string, needle: string): string[] => {
  return listSourceFiles(path.join(REPO_ROOT, sourceRoot))
    .filter((file) => fs.readFileSync(file, 'utf8').includes(needle))
    .map((file) => path.relative(REPO_ROOT, file).replaceAll('\\', '/'))
    .sort()
}

describe('provider catalog architecture guard', () => {
  it('persists provider catalogs only through the catalog service and its settings layer', () => {
    expect(filesCalling('src/main', 'setProviderModels(')).toEqual([
      'src/main/provider/providerModelHelper.ts',
      'src/main/provider/settings.ts'
    ])
    expect(filesCalling('src/main', 'applyProviderCatalogUpdate(')).toEqual([
      'src/main/provider/catalog/providerCatalogService.ts',
      'src/main/provider/settings.ts'
    ])
  })

  it('never merges catalog sources inside the renderer model store', () => {
    const forbidden = ['getDbProviderModels', 'getModelList', 'getProviderModelConfigs'].filter(
      (needle) =>
        filesCalling('src/renderer/src/stores', needle).includes(
          'src/renderer/src/stores/modelStore.ts'
        )
    )
    expect(forbidden).toEqual([])
  })
})
