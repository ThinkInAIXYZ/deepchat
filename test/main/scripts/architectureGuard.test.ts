import { spawnSync } from 'node:child_process'
import path from 'node:path'
import ts from 'typescript'
import { beforeAll, describe, expect, it } from 'vitest'

import { runArchitectureGuard } from '../../../scripts/architecture-guard.mjs'
import { analyzeMemoryArchitecture } from '../../../scripts/lib/memory-architecture-guard.mjs'

const ROOT = process.cwd()
const MEMORY_ROOT = path.join(ROOT, 'src/main/presenter/memoryPresenter')
const SETTINGS_FIXTURE = path.join(
  ROOT,
  'src/renderer/settings/__architecture_guard_legacy_fixture__.ts'
)
const DOMAIN_FIXTURE = path.join(MEMORY_ROOT, 'domain/__architecture_guard_domain_fixture__.ts')
const CORE_FIXTURE = path.join(MEMORY_ROOT, 'core/__architecture_guard_core_fixture__.ts')
const LINEAGE_PROPERTY_FIXTURE = path.join(
  MEMORY_ROOT,
  'core/__architecture_guard_lineage_property_fixture__.ts'
)
const LINEAGE_WRAPPER_FIXTURE = path.join(
  MEMORY_ROOT,
  'core/__architecture_guard_lineage_wrapper_fixture__.ts'
)
const LINEAGE_FALSE_POSITIVE_FIXTURE = path.join(
  MEMORY_ROOT,
  'core/__architecture_guard_lineage_config_fixture__.ts'
)
const INFRA_FIXTURE = path.join(MEMORY_ROOT, 'infra/__architecture_guard_infra_fixture__.ts')
const SERVICE_FIXTURE = path.join(
  MEMORY_ROOT,
  'services/__architecture_guard_service_fixture__.ts'
)
const POSITIVE_SERVICE_FIXTURE = path.join(
  MEMORY_ROOT,
  'services/__architecture_guard_positive_service_fixture__.ts'
)
const ROOT_FIXTURE = path.join(MEMORY_ROOT, '__architecture_guard_root_fixture__.ts')
const TYPES_PATH = path.join(MEMORY_ROOT, 'types.ts')
const PROVIDER_GATEWAY_PATH = path.join(MEMORY_ROOT, 'infra/providerGateway.ts')
const MEMORY_TABLE_PATH = path.join(
  ROOT,
  'src/main/presenter/sqlitePresenter/tables/agentMemory.ts'
)
const MAIN_ROUTES_PATH = path.join(ROOT, 'src/main/routes/index.ts')

const virtualFiles = new Map<string, string>([
  [
    SETTINGS_FIXTURE,
    `
      import { useLegacyPresenter } from '@api/legacy/presenters'
      import { createMemoryClient as makeMemoryClient } from '@api/MemoryClient'

      const memoryClient = makeMemoryClient()
      window.electron.ipcRenderer.on('settings:navigate', () => {})
      export const fixture = [useLegacyPresenter('configPresenter'), memoryClient.list('deepchat')]
    `
  ],
  [
    DOMAIN_FIXTURE,
    `
      import type { SQLitePresenter } from '../../sqlitePresenter'
      import type { ConfigPresenter } from '../../configPresenter'
      import type { Stats } from 'node:fs'
      export type Fixture = SQLitePresenter | ConfigPresenter | Stats
    `
  ],
  [
    CORE_FIXTURE,
    `
      import type { MemoryRuntimeContext } from '../context'
      import type { AgentMemoryRow } from '../../sqlitePresenter/tables/agentMemory'
      import type { SQLitePresenter } from '../../sqlitePresenter'
      export type Fixture = MemoryRuntimeContext | AgentMemoryRow | SQLitePresenter
    `
  ],
  [
    INFRA_FIXTURE,
    `
      import type { WorkingMemoryService } from '../services/workingMemoryService'
      export type Fixture = WorkingMemoryService
    `
  ],
  [
    SERVICE_FIXTURE,
    `
      import type { WorkingMemoryService } from './workingMemoryService'
      import type { VectorStoreManager } from '../infra/vectorStoreManager'
      import type {
        MemoryAuditRepositoryPort as AuditRepository,
        MemoryRepositoryPort as Repository
      } from '../types'
      import type { MemoryRuntimeContext } from '../context'

      type UnsafeContext = MemoryRuntimeContext & { repositoryGateway: Repository }
      declare const runtime: UnsafeContext
      const alias = runtime
      const { repositoryGateway } = alias
      export const fixture = [runtime.repositoryGateway, alias['repositoryGateway'], repositoryGateway]
      export type Fixture = WorkingMemoryService | VectorStoreManager | AuditRepository
    `
  ],
  [
    POSITIVE_SERVICE_FIXTURE,
    `
      import type { MemoryProvenanceResolverPort } from '../ports'
      export type Fixture = MemoryProvenanceResolverPort
    `
  ],
  [
    ROOT_FIXTURE,
    `
      import type { MemoryPresenter } from './index'
      import type { WorkingMemoryService } from './services/workingMemoryService'
      import type { MemoryReadRepositoryPort } from './ports'
      export class MemoryRuntimeContext {
        repositoryGateway = {}
        isEnabled(): MemoryReadRepositoryPort { throw new Error('fixture') }
      }
      export type Fixture = MemoryPresenter | WorkingMemoryService
    `
  ],
  [
    TYPES_PATH,
    `
      export type * from './domain/types'
      export type {
        MemoryAuditRepositoryPort,
        MemoryRepositoryPort
      } from './ports'
      export interface MemoryPresenterDeps {}
      export interface ConcreteTypeOwner {}
    `
  ],
  [
    PROVIDER_GATEWAY_PATH,
    `
      import type { MemoryProviderGatewayPort, MemoryRepositoryPort } from '../ports'
      export class MemoryProviderGateway implements MemoryProviderGatewayPort {}
      export type ForbiddenRepository = MemoryRepositoryPort
    `
  ],
  [
    MEMORY_TABLE_PATH,
    `
      import type { MemoryRepositoryPort } from '../../memoryPresenter/ports'
      export type { AgentMemoryRow } from '../../memoryPresenter/domain/types'
      export class AgentMemoryTable implements MemoryRepositoryPort {}
    `
  ],
  [
    LINEAGE_PROPERTY_FIXTURE,
    `
      const codec = {
        decodeLineage: (value: string) => JSON.parse(value)
      }
      export function fixture(row: { source_entry_ids: string }) {
        return codec.decodeLineage(row.source_entry_ids)
      }
    `
  ],
  [
    LINEAGE_WRAPPER_FIXTURE,
    `
      const codec = { decode: (value: string) => JSON.parse(value) }
      const wrapper = (value: string) => codec.decode(value)
      export function fixture(row: { sourceEntryIds: string }) {
        const raw = row.sourceEntryIds
        return wrapper(raw)
      }
    `
  ],
  [
    LINEAGE_FALSE_POSITIVE_FIXTURE,
    `
      const note = 'lineage documentation'
      export function parseConfig(lineageConfigJson: string) {
        return { note, config: JSON.parse(lineageConfigJson), literal: JSON.parse('"lineage"') }
      }
    `
  ],
  [
    MAIN_ROUTES_PATH,
    `
      function decode(value: string) { return JSON.parse(value) }
      export function fixture(row: { source_entry_ids: string }) {
        return decode(row.source_entry_ids)
      }
    `
  ]
])

function forFile(violations: string[], filePath: string): string[] {
  const relative = path.relative(ROOT, filePath).split(path.sep).join('/')
  return violations.filter((violation) => violation.includes(relative))
}

async function invalidCompilerViolations(memoryCompiler: Record<string, unknown>) {
  return analyzeMemoryArchitecture({
    root: ROOT,
    fileSet: new Set<string>(),
    readSource: async () => '',
    resolveImport: async () => null,
    compiler: memoryCompiler
  })
}

describe('architecture guard', () => {
  let violations: string[]

  beforeAll(async () => {
    violations = await runArchitectureGuard({ virtualFiles })
  })

  it('passes against the current production source through the CLI', () => {
    const result = spawnSync(process.execPath, ['scripts/architecture-guard.mjs'], {
      cwd: ROOT,
      encoding: 'utf8'
    })

    expect(result.status).toBe(0)
    expect(result.stdout).toContain('Architecture guard passed.')
  })

  it('keeps renderer legacy boundaries enforced without writing source fixtures', () => {
    const fixtureViolations = forFile(violations, SETTINGS_FIXTURE).join('\n')
    expect(fixtureViolations).toContain('[renderer-business-direct-use-presenter-import]')
    expect(fixtureViolations).toContain('[renderer-business-direct-use-presenter]')
    expect(fixtureViolations).toContain('[renderer-business-direct-window-electron]')
    expect(fixtureViolations).toContain('[renderer-business-direct-ipc-listener]')
    expect(fixtureViolations).toContain('[memory-legacy-list-caller]')
  })

  it('enforces domain, core, infra, service, and root dependency directions', () => {
    expect(forFile(violations, DOMAIN_FIXTURE).join('\n')).toContain(
      'domain may only import domain files and shared modules'
    )
    expect(forFile(violations, CORE_FIXTURE).join('\n')).toContain(
      'core may only import core files and root contracts'
    )
    expect(forFile(violations, INFRA_FIXTURE).join('\n')).toContain(
      'infra must not import services or facade entrypoints'
    )
    expect(forFile(violations, SERVICE_FIXTURE).join('\n')).toContain(
      'service-to-service imports must use root collaborator ports'
    )
    expect(forFile(violations, SERVICE_FIXTURE).join('\n')).toContain(
      'services must depend on root port contracts'
    )
    expect(forFile(violations, ROOT_FIXTURE).join('\n')).toContain(
      'only memoryPresenter/index.ts may import services'
    )
    expect(forFile(violations, POSITIVE_SERVICE_FIXTURE)).toEqual([])
  })

  it('blocks SQLite concrete imports through direct and barrel paths', () => {
    const fixtureViolations = forFile(violations, CORE_FIXTURE).join('\n')
    expect(fixtureViolations).toContain('[memory-domain-sqlite-concrete]')
    expect(fixtureViolations).toContain('sqlitePresenter/tables/agentMemory.ts')
    expect(fixtureViolations).toContain('sqlitePresenter/index.ts')
  })

  it('restricts composites by resolved symbol and file-specific allowlists', () => {
    const serviceViolations = forFile(violations, SERVICE_FIXTURE).join('\n')
    expect(serviceViolations).toContain('MemoryRepositoryPort')
    expect(serviceViolations).toContain('MemoryAuditRepositoryPort')

    const gatewayViolations = forFile(violations, PROVIDER_GATEWAY_PATH).join('\n')
    expect(gatewayViolations).toContain('MemoryRepositoryPort')
    expect(gatewayViolations).not.toContain('MemoryProviderGatewayPort')
  })

  it('locks the runtime context surface and catches renamed locator access', () => {
    expect(forFile(violations, ROOT_FIXTURE).join('\n')).toContain(
      '[memory-context-public-surface]'
    )
    expect(forFile(violations, ROOT_FIXTURE).join('\n')).toContain('MemoryReadRepositoryPort')
    expect(forFile(violations, SERVICE_FIXTURE).join('\n')).toContain('[memory-context-escape]')
    expect(forFile(violations, SERVICE_FIXTURE).join('\n')).toContain('repositoryGateway')
  })

  it('locks types.ts ownership and explicit compatibility re-exports', () => {
    const fixtureViolations = forFile(violations, TYPES_PATH).join('\n')
    expect(fixtureViolations).toContain('[memory-types-owner]')
    expect(fixtureViolations).toContain('explicit compatibility re-exports')
    expect(fixtureViolations).toContain('ConcreteTypeOwner')
    expect(forFile(violations, MEMORY_TABLE_PATH).join('\n')).toContain(
      '[memory-table-domain-reexport]'
    )
  })

  it('detects object-property and two-stage lineage codecs across actual parser boundaries', () => {
    expect(forFile(violations, LINEAGE_PROPERTY_FIXTURE).join('\n')).toContain(
      '[memory-lineage-codec]'
    )
    expect(forFile(violations, LINEAGE_WRAPPER_FIXTURE).join('\n')).toContain(
      '[memory-lineage-codec]'
    )
    expect(forFile(violations, MAIN_ROUTES_PATH).join('\n')).toContain('[memory-lineage-codec]')
  })

  it('allows unrelated lineage-named config JSON and string literals', () => {
    expect(forFile(violations, LINEAGE_FALSE_POSITIVE_FIXTURE)).toEqual([])
  })

  it('fails closed when the TypeScript guard config is unavailable or invalid', async () => {
    const missing = await invalidCompilerViolations({
      configHost: { ...ts.sys, fileExists: () => false }
    })
    const malformed = await invalidCompilerViolations({
      configPath: '/virtual/tsconfig.node.json',
      configHost: { ...ts.sys, readFile: () => '{' }
    })
    const invalidOption = await invalidCompilerViolations({
      configPath: '/virtual/tsconfig.node.json',
      configHost: {
        ...ts.sys,
        readFile: () => '{"compilerOptions":{"module":"not-a-module"}}'
      }
    })

    expect(missing[0]).toContain('[memory-guard-program-invalid]')
    expect(malformed[0]).toContain('[memory-guard-program-invalid]')
    expect(invalidOption[0]).toContain('[memory-guard-program-invalid]')
  })
})
