import { spawnSync } from 'node:child_process'
import { rm, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'

const ROOT = process.cwd()
const FIXTURE_PATH = path.join(
  ROOT,
  'src/renderer/settings/__architecture_guard_legacy_fixture__.ts'
)
const MEMORY_CORE_FIXTURE_PATH = path.join(
  ROOT,
  'src/main/presenter/memoryPresenter/core/__architecture_guard_core_fixture__.ts'
)
const MEMORY_INFRA_FIXTURE_PATH = path.join(
  ROOT,
  'src/main/presenter/memoryPresenter/infra/__architecture_guard_infra_fixture__.ts'
)
const MEMORY_SERVICE_FIXTURE_PATH = path.join(
  ROOT,
  'src/main/presenter/memoryPresenter/services/__architecture_guard_service_fixture__.ts'
)
const MEMORY_ROOT_FIXTURE_PATH = path.join(
  ROOT,
  'src/main/presenter/memoryPresenter/__architecture_guard_root_fixture__.ts'
)
const FIXTURE_PATHS = [
  FIXTURE_PATH,
  MEMORY_CORE_FIXTURE_PATH,
  MEMORY_INFRA_FIXTURE_PATH,
  MEMORY_SERVICE_FIXTURE_PATH,
  MEMORY_ROOT_FIXTURE_PATH
]

async function writeSettingsFixture(source: string) {
  await writeFile(FIXTURE_PATH, source, 'utf8')
}

async function writeFixture(filePath: string, source: string) {
  await writeFile(filePath, source, 'utf8')
}

function runArchitectureGuard() {
  return spawnSync(process.execPath, ['scripts/architecture-guard.mjs'], {
    cwd: ROOT,
    encoding: 'utf8'
  })
}

describe.sequential('architecture guard', () => {
  afterEach(async () => {
    await Promise.all(FIXTURE_PATHS.map((filePath) => rm(filePath, { force: true })))
  })

  it('fails when settings imports or calls the retired legacy presenter bridge', async () => {
    await writeSettingsFixture(`
      import { useLegacyPresenter } from '@api/legacy/presenters'

      export const fixture = useLegacyPresenter('configPresenter')
    `)

    const result = runArchitectureGuard()

    expect(result.status).not.toBe(0)
    expect(result.stderr).toContain('[renderer-business-direct-use-presenter-import]')
    expect(result.stderr).toContain('[renderer-business-direct-use-presenter]')
  })

  it('fails when settings reintroduces raw window.electron IPC listeners', async () => {
    await writeSettingsFixture(`
      export function fixture() {
        window.electron.ipcRenderer.on('settings:navigate', () => {})
      }
    `)

    const result = runArchitectureGuard()

    expect(result.status).not.toBe(0)
    expect(result.stderr).toContain('[renderer-business-direct-window-electron]')
    expect(result.stderr).toContain('[renderer-business-direct-ipc-listener]')
  })

  it('fails when renderer business code calls the deprecated unbounded memory list', async () => {
    await writeSettingsFixture(`
      import { createMemoryClient as makeMemoryClient } from '@api/MemoryClient'

      const memoryClient = makeMemoryClient()
      const renamedClient = memoryClient
      const { list: legacyList } = renamedClient
      export const fixture = [
        renamedClient.list('deepchat'),
        legacyList('deepchat'),
        makeMemoryClient().list('deepchat')
      ]
    `)

    const result = runArchitectureGuard()

    expect(result.status).not.toBe(0)
    expect(result.stderr).toContain('[memory-legacy-list-caller]')
    expect(result.stderr).toContain('use memoryClient.page')
  })

  it('fails when renderer business code invokes the legacy memory route directly', async () => {
    await writeSettingsFixture(`
      import { memoryListRoute as legacyMemoryRoute } from '@shared/contracts/routes'

      const bridge = { invoke: async (..._args: unknown[]) => ({ memories: [] }) }
      export const fixture = bridge.invoke(legacyMemoryRoute.name, { agentId: 'deepchat' })
    `)

    const result = runArchitectureGuard()

    expect(result.status).not.toBe(0)
    expect(result.stderr).toContain('[memory-legacy-list-caller]')
  })

  it('fails when memory core imports runtime context', async () => {
    await writeFixture(
      MEMORY_CORE_FIXTURE_PATH,
      `
        import type { MemoryRuntimeContext } from '../context'
        export type Fixture = MemoryRuntimeContext
      `
    )

    const result = runArchitectureGuard()

    expect(result.status).not.toBe(0)
    expect(result.stderr).toContain('[memory-presenter-layer]')
    expect(result.stderr).toContain('core may only import core files and root contracts')
  })

  it('fails when memory infra imports services', async () => {
    await writeFixture(
      MEMORY_INFRA_FIXTURE_PATH,
      `
        import type { WorkingMemoryService } from '../services/workingMemoryService'
        export type Fixture = WorkingMemoryService
      `
    )

    const result = runArchitectureGuard()

    expect(result.status).not.toBe(0)
    expect(result.stderr).toContain('[memory-presenter-layer]')
    expect(result.stderr).toContain('infra must not import services or facade entrypoints')
  })

  it('fails when memory services import another concrete service or infra concrete module', async () => {
    await writeFixture(
      MEMORY_SERVICE_FIXTURE_PATH,
      `
        import type { WorkingMemoryService } from './workingMemoryService'
        import type { VectorStoreManager } from '../infra/vectorStoreManager'
        export type Fixture = WorkingMemoryService | VectorStoreManager
      `
    )

    const result = runArchitectureGuard()

    expect(result.status).not.toBe(0)
    expect(result.stderr).toContain('service-to-service imports must use facade ports')
    expect(result.stderr).toContain('services must depend on root port contracts')
  })

  it('allows memory services to import the shared row mutation leaf', async () => {
    await writeFixture(
      MEMORY_SERVICE_FIXTURE_PATH,
      `
        import type { MemoryRowMutations } from './rowMutations'
        export type Fixture = MemoryRowMutations
      `
    )

    const result = runArchitectureGuard()

    expect(result.status).toBe(0)
  })

  it('fails when non-facade memory root files import the facade or service layer', async () => {
    await writeFixture(
      MEMORY_ROOT_FIXTURE_PATH,
      `
        import type { MemoryPresenter } from './index'
        import type { WorkingMemoryService } from './services/workingMemoryService'
        export type Fixture = MemoryPresenter | WorkingMemoryService
      `
    )

    const result = runArchitectureGuard()

    expect(result.status).not.toBe(0)
    expect(result.stderr).toContain('[memory-presenter-layer]')
    expect(result.stderr).toContain('only memoryPresenter/index.ts may import services')
  })
})
