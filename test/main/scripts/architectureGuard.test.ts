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
const RETIRED_AGENT_RUNTIME_FIXTURE = path.join(
  ROOT,
  'test/main/agent/__architecture_guard_retired_runtime_fixture__.ts'
)
const RETIRED_AGENT_RUNTIME_KIND_FIXTURE = path.join(
  ROOT,
  'test/main/agent/manager/__architecture_guard_retired_runtime_kind_fixture__.ts'
)
const RETIRED_AGENT_RUNTIME_KIND_TYPE_FIXTURE = path.join(
  ROOT,
  'test/main/agent/manager/__architecture_guard_retired_runtime_kind_type_fixture__.ts'
)
const AGENT_KIND_ALIAS_FALLBACK_FIXTURE = path.join(
  ROOT,
  'test/main/agent/__architecture_guard_kind_alias_fixture__.ts'
)
const AGENT_KIND_OPTIONAL_ALIAS_FALLBACK_FIXTURE = path.join(
  ROOT,
  'test/main/agent/__architecture_guard_optional_kind_alias_fixture__.ts'
)
const PROVIDER_RUNTIME_KIND_FIXTURE = path.join(
  ROOT,
  'test/main/presenter/llmProviderPresenter/__architecture_guard_runtime_kind_fixture__.ts'
)
const DEEPCHAT_LOOP_IMPORT_FIXTURE = path.join(
  ROOT,
  'src/main/agent/deepchat/loop/__architecture_guard_import_fixture__.ts'
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
const AGENT_SESSION_PRESENTER_PATH = path.join(
  ROOT,
  'src/main/presenter/agentSessionPresenter/index.ts'
)
const AGENT_SESSION_PRESENTER_INTERFACE_PATH = path.join(
  ROOT,
  'src/shared/types/presenters/agent-session.presenter.d.ts'
)
const SESSION_BOUNDARY_HOOK_FIXTURE_PATH = path.join(
  ROOT,
  'src/main/presenter/lifecyclePresenter/hooks/after-start/legacyImportHook.ts'
)

const retiredAgentRuntimeSymbols = [
  ['IAgent', 'Implementation'].join(''),
  ['createLegacy', 'AgentBackend'].join(''),
  ['LegacyDeepChat', 'SessionBackend'].join(''),
  ['LegacyAcp', 'SessionBackend'].join(''),
  ['LegacyAcp', 'SessionHandle'].join(''),
  ['LegacyToolFacts', 'SnapshotPort'].join(''),
  ['appendAssistantToolFacts', 'Snapshot'].join('')
]
const retiredAgentRuntimeSource = retiredAgentRuntimeSymbols
  .map((symbol, index) => `export const retired${index} = '${symbol}'`)
  .join('\n')
const retiredRuntimeKindSource = ['leg', 'acy', 'dir', 'ect']
const runtimeKindProperty = ['runtime', 'Kind'].join('')
const kindAliasProperty = ['agent', 'Type'].join('')
const typeProperty = ['ty', 'pe'].join('')

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
      import type { LegacyAgentMemoryStatus as LegacyStatus } from '@shared/types/agent-memory'
      import type * as MemoryTypes from '@shared/types/agent-memory'
      export type { LegacyAgentMemoryStatus } from '@shared/types/agent-memory'
      declare const row: AgentMemoryRow
      type NamespaceStatus = MemoryTypes.LegacyAgentMemoryStatus
      type InlineStatus = import('@shared/types/agent-memory').LegacyAgentMemoryStatus
      export const legacyStatus = row.status
      export const bracketStatus = row['status']
      export const { status } = row
      export const { status: structuredAlias } = row
      export type Fixture = MemoryRuntimeContext | AgentMemoryRow | SQLitePresenter | LegacyStatus | NamespaceStatus | InlineStatus
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
  [RETIRED_AGENT_RUNTIME_FIXTURE, retiredAgentRuntimeSource],
  [
    RETIRED_AGENT_RUNTIME_KIND_FIXTURE,
    `
      declare const handle: { ${runtimeKindProperty}: string }
      export const first = { ${runtimeKindProperty}: '${retiredRuntimeKindSource[0]}${retiredRuntimeKindSource[1]}' }
      export class Third {
        ${runtimeKindProperty} = '${retiredRuntimeKindSource[2]}${retiredRuntimeKindSource[3]}'
      }
      export const forward = handle.${runtimeKindProperty} !== '${retiredRuntimeKindSource[0]}${retiredRuntimeKindSource[1]}'
    `
  ],
  [
    RETIRED_AGENT_RUNTIME_KIND_TYPE_FIXTURE,
    `
      type Handle = { ${runtimeKindProperty}?: '${retiredRuntimeKindSource[0]}${retiredRuntimeKindSource[1]}' | '${retiredRuntimeKindSource[2]}${retiredRuntimeKindSource[3]}' }
      declare const handle: { ${runtimeKindProperty}: string }
      export const reverse = '${retiredRuntimeKindSource[2]}${retiredRuntimeKindSource[3]}' === handle.${runtimeKindProperty}
      export const assign = () => (handle.${runtimeKindProperty} = '${retiredRuntimeKindSource[2]}${retiredRuntimeKindSource[3]}')
    `
  ],
  [
    AGENT_KIND_ALIAS_FALLBACK_FIXTURE,
    `
      declare const row: { ${kindAliasProperty}?: string; ${typeProperty}?: string }
      export const kind = row.${kindAliasProperty} ?? row.${typeProperty}
    `
  ],
  [
    AGENT_KIND_OPTIONAL_ALIAS_FALLBACK_FIXTURE,
    `
      declare const row: { ${kindAliasProperty}?: string; ${typeProperty}?: string }
      export const optionalKind = row?.${typeProperty} ?? row?.${kindAliasProperty}
    `
  ],
  [
    PROVIDER_RUNTIME_KIND_FIXTURE,
    `export const providerDefinition = { ${runtimeKindProperty}: '${retiredRuntimeKindSource[2]}${retiredRuntimeKindSource[3]}' }`
  ],
  [
    DEEPCHAT_LOOP_IMPORT_FIXTURE,
    `
      import type { AgentRuntimePresenter } from '@/presenter/agentRuntimePresenter'
      import type { SQLitePresenter } from '@/presenter/sqlitePresenter'
      import type { AcpAgentInstance } from '@/agent/acp/instance'
      import type { SessionService } from '@/routes/sessions/sessionService'
      import type { BrowserWindow } from 'electron'
      export type Fixture =
        | AgentRuntimePresenter
        | SQLitePresenter
        | AcpAgentInstance
        | SessionService
        | BrowserWindow
    `
  ],
  [
    RETIRED_MEMORY_OWNER_FIXTURE,
    `
      export class RetiredMemoryOwner {
        private readonly memoryExtractionChains = new Map<string, Promise<void>>()
        private appendMemoryInjection() {}
        private trigger() {
          this.memoryCoordinator.triggerExtractionFallback('session')
        }
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
  ],
  [
    AGENT_SESSION_PRESENTER_PATH,
    `
      import { LegacyChatImportService } from '../startupMigrations/legacyChatImportService'
      import { runMainlineNormalizationMigration } from '../startupMigrations/sessionDataMigrations'
      import { UsageStatsService } from '../usageStatsService'
      import { rtkRuntimeService } from '../../agent/shared/process/rtkRuntimeService'
      import { generateExportFilename } from '../exporter/formats/conversationExporter'
      import { SessionHistorySearch } from '../../routes/sessions/sessionHistorySearch'
      import { translateSessionText } from '../../routes/sessions/sessionTranslation'
      import { listAvailableAgents } from '../../agent/shared/availableAgentCatalog'
      export class AgentSessionPresenter {
        searchHistory() {}
        startLegacyImportTask() {}
        getUsageDashboard() {}
        exportSession() {}
      }
    `
  ],
  [
    AGENT_SESSION_PRESENTER_INTERFACE_PATH,
    `
      export interface IAgentSessionPresenter {
        translateText(): Promise<string>
        getAgents(): Promise<unknown[]>
        retryRtkHealthCheck(): Promise<void>
      }
    `
  ],
])

function forFile(violations: string[], filePath: string): string[] {
  const relative = path.relative(ROOT, filePath).split(path.sep).join('/')
  return violations.filter((violation) => violation.includes(relative))
}

async function sessionBoundaryHookFixtureViolations(source: string): Promise<string[]> {
  const fixtureViolations = await runArchitectureGuard({
    virtualFiles: new Map([[SESSION_BOUNDARY_HOOK_FIXTURE_PATH, source]])
  })
  return forFile(fixtureViolations, SESSION_BOUNDARY_HOOK_FIXTURE_PATH)
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

  it('keeps moved capabilities and owners out of AgentSessionPresenter', () => {
    const fixtureViolations = forFile(violations, AGENT_SESSION_PRESENTER_PATH).join('\n')
    expect(fixtureViolations).toContain('[session-boundary-presenter-method]')
    for (const owner of [
      'legacy import',
      'startup migrations',
      'usage owner or policy',
      'RTK runtime',
      'exporter formats',
      'history search',
      'session translation',
      'agent catalog'
    ]) {
      expect(fixtureViolations).toContain(`must not import ${owner}`)
    }
  })

  it('keeps moved capabilities out of IAgentSessionPresenter', () => {
    expect(forFile(violations, AGENT_SESSION_PRESENTER_INTERFACE_PATH).join('\n')).toContain(
      '[session-boundary-interface-method]'
    )
  })

  it(
    'keeps startup hooks on required typed owners across semantic access forms',
    async () => {
      const presenterSources = [
        `
          declare const presenter: { agentSessionPresenter: unknown }
          export const owner = presenter.agentSessionPresenter
        `,
        `
          declare const presenter: { agentSessionPresenter: unknown }
          export const owner = presenter['agentSessionPresenter']
        `,
        `
          declare const presenter: { agentSessionPresenter: unknown }
          export const { agentSessionPresenter } = presenter
        `,
        `
          declare const presenter: { agentSessionPresenter: unknown }
          export const { agentSessionPresenter: owner } = presenter
        `
      ]
      const optionalTaskSources = [
        `
          declare const owner: Record<string, (() => void) | undefined>
          const { startLegacyImportTask } = owner
          startLegacyImportTask?.()
        `,
        `
          declare const startLegacyImportTask: (() => void) | undefined
          startLegacyImportTask?.()
        `
      ]
      const unsafeCastSource = `
        import type { AgentSessionPresenter } from '../../../agentSessionPresenter'
        declare const presenter: unknown
        export const owner = presenter as unknown as AgentSessionPresenter
      `
      const [presenterResults, optionalTaskResults, unsafeCastResult] = await Promise.all([
        Promise.all(presenterSources.map(sessionBoundaryHookFixtureViolations)),
        Promise.all(optionalTaskSources.map(sessionBoundaryHookFixtureViolations)),
        sessionBoundaryHookFixtureViolations(unsafeCastSource)
      ])

      for (const fixtureViolations of presenterResults) {
        const result = fixtureViolations.join('\n')
        expect(result).toContain('[session-boundary-hook-presenter]')
        expect(result).not.toContain('[session-boundary-hook-optional-task]')
        expect(result).not.toContain('[session-boundary-hook-type-cast]')
      }
      for (const fixtureViolations of optionalTaskResults) {
        const result = fixtureViolations.join('\n')
        expect(result).toContain('[session-boundary-hook-optional-task]')
        expect(result).not.toContain('[session-boundary-hook-presenter]')
        expect(result).not.toContain('[session-boundary-hook-type-cast]')
      }
      expect(unsafeCastResult.join('\n')).toContain('[session-boundary-hook-presenter]')
      expect(unsafeCastResult.join('\n')).toContain('[session-boundary-hook-unknown-cast]')
      expect(unsafeCastResult.join('\n')).toContain('[session-boundary-hook-type-cast]')
      expect(unsafeCastResult.join('\n')).not.toContain('[session-boundary-hook-optional-task]')
    },
    30_000
  )

  it('keeps Memory orchestration and injection callbacks out of the runtime presenter', () => {
    const fixtureViolations = forFile(violations, RETIRED_MEMORY_OWNER_FIXTURE).join('\n')
    expect(fixtureViolations).toContain(
      '[memory-retired-presenter-owner]'
    )
    expect(fixtureViolations).toContain('[memory-retired-presenter-injection]')
    expect(fixtureViolations).toContain('[memory-retired-presenter-ingestion-trigger]')
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
    expect(fixtureViolations).toContain('[memory-canonical-state]')
    expect(fixtureViolations).toContain('must not import LegacyAgentMemoryStatus')
    expect(fixtureViolations).toContain('must not access AgentMemoryRow.status')
    expect(fixtureViolations).toContain('must not destructure AgentMemoryRow.status')
  })

  it('keeps the direct ACP instance out of DeepChat loop, Memory, presenter root and SQLite', () => {
    const fixtureViolations = forFile(violations, ACP_INSTANCE_FIXTURE).join('\n')
    expect(fixtureViolations).toContain('[acp-direct-instance-deepchat-loop]')
    expect(fixtureViolations).toContain('[acp-direct-instance-memory]')
    expect(fixtureViolations).toContain('[acp-direct-instance-presenter-root]')
    expect(fixtureViolations).toContain('[acp-direct-instance-sqlite]')
  })

  it('keeps retired agent runtime symbols out of production and regular tests', () => {
    const fixtureViolations = forFile(violations, RETIRED_AGENT_RUNTIME_FIXTURE).filter(
      (violation) => violation.includes('[agent-retired-runtime-symbol]')
    )
    expect(fixtureViolations).toHaveLength(retiredAgentRuntimeSymbols.length)
  })

  it('keeps legacy/direct runtimeKind literals out of agent handles and backends', () => {
    expect(forFile(violations, RETIRED_AGENT_RUNTIME_KIND_FIXTURE).join('\n')).toContain(
      'found 3'
    )
  })

  it('detects retired runtimeKind type declarations, reverse comparisons, and assignments', () => {
    expect(forFile(violations, RETIRED_AGENT_RUNTIME_KIND_TYPE_FIXTURE).join('\n')).toContain(
      'found 3'
    )
  })

  it('leaves provider runtimeKind definitions outside the agent handle guard', () => {
    expect(forFile(violations, PROVIDER_RUNTIME_KIND_FIXTURE)).toEqual([])
  })

  it('keeps legacy kind alias fallback outside internal agent routing', () => {
    const fixtureViolations = forFile(violations, AGENT_KIND_ALIAS_FALLBACK_FIXTURE).join('\n')
    expect(fixtureViolations).toContain('[agent-kind-alias-fallback]')
    expect(fixtureViolations).toContain('found 1')
  })

  it('detects optional and reverse internal agent kind alias fallback', () => {
    const fixtureViolations = forFile(
      violations,
      AGENT_KIND_OPTIONAL_ALIAS_FALLBACK_FIXTURE
    ).join('\n')
    expect(fixtureViolations).toContain('[agent-kind-alias-fallback]')
    expect(fixtureViolations).toContain('found 1')
  })

  it('keeps the DeepChat loop out of presenters, SQLite, routes, Electron, and ACP', () => {
    const fixtureViolations = forFile(violations, DEEPCHAT_LOOP_IMPORT_FIXTURE).join('\n')
    expect(fixtureViolations).toContain('[deepchat-loop-presenter]')
    expect(fixtureViolations).toContain('[deepchat-loop-sqlite]')
    expect(fixtureViolations).toContain('[deepchat-loop-routes]')
    expect(fixtureViolations).toContain('[deepchat-loop-electron]')
    expect(fixtureViolations).toContain('[deepchat-loop-acp]')
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
