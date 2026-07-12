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
const ACP_INSTANCE_FIXTURE = path.join(
  ROOT,
  'src/main/agent/acp/instance/__architecture_guard_fixture__.ts'
)
const RETIRED_ACP_BACKEND_FIXTURE = path.join(
  ROOT,
  'src/main/agent/__architecture_guard_retired_acp_backend_fixture__.ts'
)
const RETIRED_MEMORY_OWNER_FIXTURE = path.join(
  ROOT,
  'src/main/presenter/agentRuntimePresenter/__architecture_guard_retired_memory_owner_fixture__.ts'
)
const MEMORY_COORDINATOR_PATH = path.join(
  ROOT,
  'src/main/agent/deepchat/memory/memoryRuntimeCoordinator.ts'
)
const DUPLICATE_MEMORY_COORDINATOR_FIXTURE = path.join(
  ROOT,
  'src/main/agent/deepchat/memory/__architecture_guard_duplicate_coordinator_fixture__.ts'
)
const CAUSAL_OBSERVATION_SAFE_FIXTURE = path.join(
  ROOT,
  'src/main/presenter/agentRuntimePresenter/__architecture_guard_causal_observation_safe_fixture__.ts'
)
const CAUSAL_OBSERVATION_METHOD_FIXTURE = path.join(
  ROOT,
  'src/main/presenter/agentRuntimePresenter/__architecture_guard_causal_observation_method_fixture__.ts'
)
const CAUSAL_OBSERVATION_BRACKET_FIXTURE = path.join(
  ROOT,
  'src/main/presenter/agentRuntimePresenter/__architecture_guard_causal_observation_bracket_fixture__.ts'
)
const CAUSAL_OBSERVATION_ALIAS_FIXTURE = path.join(
  ROOT,
  'src/main/presenter/agentRuntimePresenter/__architecture_guard_causal_observation_alias_fixture__.ts'
)
const CAUSAL_OBSERVATION_ARROW_FIXTURE = path.join(
  ROOT,
  'src/main/presenter/agentRuntimePresenter/__architecture_guard_causal_observation_arrow_fixture__.ts'
)

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
  ],
  [
    ACP_INSTANCE_FIXTURE,
    `
      import type { LoopRun } from '../../deepchat/loop/loopRun'
      import type { MemoryPresenter } from '../../../presenter/memoryPresenter'
      import type { Presenter } from '../../../presenter'
      import type { SQLitePresenter } from '../../../presenter/sqlitePresenter'
      export type Fixture = LoopRun<unknown> | MemoryPresenter | Presenter | SQLitePresenter
    `
  ],
  [
    RETIRED_ACP_BACKEND_FIXTURE,
    `
      import type { LegacyAcpSessionBackend } from './manager/legacyAgentBackends'
      import { createLegacyAgentBackend } from './manager/legacyAgentBackends'
      const compatibilityImplementation = {}
      export const fixture: LegacyAcpSessionBackend = createLegacyAgentBackend(
        'acp',
        compatibilityImplementation as never
      )
    `
  ],
  [
    RETIRED_MEMORY_OWNER_FIXTURE,
    `
      export class RetiredMemoryOwner {
        private readonly memoryExtractionChains = new Map<string, Promise<void>>()
        private appendMemoryInjection() {}
      }
    `
  ],
  [
    CAUSAL_OBSERVATION_SAFE_FIXTURE,
    `
      import type { DeepChatTapeReplaySlice as MemoryStore } from '@shared/types/tape-replay'
      import { MemoryPresenter as RuntimeAlias } from '../memoryPresenter'
      // MemoryStore append publish CREATE are documentation terms, not executable edges.
      const CREATE_DOCUMENTATION = 'CREATE is documentation, not SQL execution'
      const hash = (value: string) => value
      export class SafeObservationReader {
        readCausalObservationSlice() {
          const metadata = {} as MemoryStore
          return [
            this.table.get('session'),
            this.table.list(),
            hash(CREATE_DOCUMENTATION),
            metadata.sliceId
          ]
        }
        rebuildProjectionOutsideObservation() {
          this.projection.replaceSession('session', [])
          return new RuntimeAlias()
        }
      }
    `
  ],
  [
    CAUSAL_OBSERVATION_METHOD_FIXTURE,
    `
      import { MemoryPresenter as RuntimeAlias } from '../memoryPresenter'
      export class UnsafeMethodObservationReader {
        readCausalObservationSlice() {
          this.ensureSessionTapeReady('session')
          this.publish('completed')
          this.events.subscribe(() => {})
          this.db.exec('CREATE TABLE observation_cache')
          this.projection.applyAppendedEntry({})
          this.projection['replaceSession']('session', [])
          return new RuntimeAlias()
        }
      }
    `
  ],
  [
    CAUSAL_OBSERVATION_BRACKET_FIXTURE,
    `
      export class UnsafeBracketObservationReader {
        readCausalObservationSlice() {
          return this.table['append']({})
        }
      }
    `
  ],
  [
    CAUSAL_OBSERVATION_ALIAS_FIXTURE,
    `
      export class UnsafeAliasObservationReader {
        readCausalObservationSlice() {
          const write = this.table.update
          return write({})
        }
      }
    `
  ],
  [
    CAUSAL_OBSERVATION_ARROW_FIXTURE,
    `
      export class UnsafeArrowObservationReader {
        readCausalObservationSlice = () => this.table.delete('session')
      }
    `
  ]
])

function forFile(violations: string[], filePath: string): string[] {
  const relative = path.relative(ROOT, filePath).split(path.sep).join('/')
  return violations.filter((violation) => violation.includes(relative))
}

const VALID_MEMORY_COORDINATOR_FIXTURE = `
  interface MemoryInjectionAccessTurnEntry {}
  export class MemoryRuntimeCoordinator {
    private readonly extractionChains = new Map<string, Promise<void>>()
    private readonly extractionQueue = new Map<
      number,
      { sessionId: string; queuedAt: number }
    >()
    private nextExtractionQueueId = 0
    private readonly extractionEpochs = new Map<string, number>()
    private readonly ingestionProjectionRetryAfter = new Map<string, number>()
    private readonly injectionAccessByTurn =
      new Map<string, MemoryInjectionAccessTurnEntry>()
  }
`

async function memoryCoordinatorFixtureViolations(
  source: string,
  additionalVirtualFiles: Map<string, string> = new Map()
): Promise<string[]> {
  const violations = await runArchitectureGuard({
    virtualFiles: new Map([[MEMORY_COORDINATOR_PATH, source], ...additionalVirtualFiles])
  })
  return violations.filter((violation) => violation.includes('[memory-coordinator-'))
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

  it('keeps Memory orchestration and injection callbacks out of the runtime presenter', () => {
    const fixtureViolations = forFile(violations, RETIRED_MEMORY_OWNER_FIXTURE).join('\n')
    expect(fixtureViolations).toContain(
      '[memory-retired-presenter-owner]'
    )
    expect(fixtureViolations).toContain('[memory-retired-presenter-injection]')
  })

  it(
    'requires the coordinator owner structure without locking method bodies',
    async () => {
      const emptyFixture = 'export class MemoryRuntimeCoordinator {}'
      const missingQueueFixture = VALID_MEMORY_COORDINATOR_FIXTURE.replace(
        /\s+private readonly extractionQueue = new Map<[\s\S]*?>\(\)/,
        ''
      )
      const missingCounterFixture = VALID_MEMORY_COORDINATOR_FIXTURE.replace(
        '\n    private nextExtractionQueueId = 0',
        ''
      )
      const [valid, empty, missingQueue, missingCounter, duplicate] = await Promise.all([
        memoryCoordinatorFixtureViolations(VALID_MEMORY_COORDINATOR_FIXTURE),
        memoryCoordinatorFixtureViolations(emptyFixture),
        memoryCoordinatorFixtureViolations(missingQueueFixture),
        memoryCoordinatorFixtureViolations(missingCounterFixture),
        memoryCoordinatorFixtureViolations(
          VALID_MEMORY_COORDINATOR_FIXTURE,
          new Map([
            [
              DUPLICATE_MEMORY_COORDINATOR_FIXTURE,
              'export class MemoryRuntimeCoordinator {}'
            ]
          ])
        )
      ])

      expect(valid).toEqual([])
      expect(empty.join('\n')).toContain('[memory-coordinator-missing-extraction-chain]')
      expect(empty.join('\n')).toContain('[memory-coordinator-missing-queue-diagnostics]')
      expect(empty.join('\n')).toContain('[memory-coordinator-missing-monotonic-counter]')
      expect(missingQueue).toEqual([
        expect.stringContaining('[memory-coordinator-missing-queue-diagnostics]')
      ])
      expect(missingCounter).toEqual([
        expect.stringContaining('[memory-coordinator-missing-monotonic-counter]')
      ])
      expect(duplicate).toEqual([
        expect.stringContaining(
          '[memory-coordinator-owner-count] expected exactly 1 MemoryRuntimeCoordinator class, found 2'
        )
      ])
    },
    20_000
  )

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

  it('keeps the direct ACP instance out of DeepChat loop, Memory, presenter root and SQLite', () => {
    const fixtureViolations = forFile(violations, ACP_INSTANCE_FIXTURE).join('\n')
    expect(fixtureViolations).toContain('[acp-direct-instance-deepchat-loop]')
    expect(fixtureViolations).toContain('[acp-direct-instance-memory]')
    expect(fixtureViolations).toContain('[acp-direct-instance-presenter-root]')
    expect(fixtureViolations).toContain('[acp-direct-instance-sqlite]')
  })

  it('keeps retired legacy ACP backend symbols and factories out of main source', () => {
    expect(forFile(violations, RETIRED_ACP_BACKEND_FIXTURE).join('\n')).toContain(
      '[acp-retired-legacy-backend]'
    )
  })

  it('allows read-only causal observation code despite Memory types and CREATE documentation', () => {
    expect(forFile(violations, CAUSAL_OBSERVATION_SAFE_FIXTURE)).toEqual([])
  })

  it('reports precise causal observation violations across method and property implementations', () => {
    const causalViolations = (filePath: string) =>
      forFile(violations, filePath).filter((violation) =>
        violation.includes('[causal-observation-write-edge]')
      )

    const methodViolations = causalViolations(CAUSAL_OBSERVATION_METHOD_FIXTURE)
    expect(methodViolations).toHaveLength(7)
    expect(methodViolations.join('\n')).toContain('bootstrap/lifecycle member "ensureSessionTapeReady"')
    expect(methodViolations.join('\n')).toContain('event publication member "publish"')
    expect(methodViolations.join('\n')).toContain('event subscription member "subscribe"')
    expect(methodViolations.join('\n')).toContain('SQL execution member "exec"')
    expect(methodViolations.join('\n')).toContain(
      'projection mutation member "applyAppendedEntry"'
    )
    expect(methodViolations.join('\n')).toContain('projection mutation member "replaceSession"')
    expect(methodViolations.join('\n')).toContain('Memory API call "RuntimeAlias"')

    const bracketViolations = causalViolations(CAUSAL_OBSERVATION_BRACKET_FIXTURE)
    expect(bracketViolations).toHaveLength(1)
    expect(bracketViolations[0]).toContain('mutation member "append"')

    const aliasViolations = causalViolations(CAUSAL_OBSERVATION_ALIAS_FIXTURE)
    expect(aliasViolations).toHaveLength(1)
    expect(aliasViolations[0]).toContain('mutation member "update"')

    const arrowViolations = causalViolations(CAUSAL_OBSERVATION_ARROW_FIXTURE)
    expect(arrowViolations).toHaveLength(1)
    expect(arrowViolations[0]).toContain('mutation member "delete"')
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
