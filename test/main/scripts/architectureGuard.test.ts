import { spawnSync } from 'node:child_process'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
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
const AGENT_EDGE_FIXTURE_PATH = path.join(
  ROOT,
  'src/shared/__architecture_guard_agent_edge_fixture__.ts'
)
const OPERATION_RUNNER_FIXTURE_PATH = path.join(
  ROOT,
  'src/main/routes/__architecture_guard_operation_runner_fixture__.ts'
)
const MAIN_OPERATION_RUNNER_FIXTURE_PATH = path.join(
  ROOT,
  'src/main/__architecture_guard_operation_runner_fixture__.ts'
)
const TRACKED_GROWTH_BASELINE_PATH = path.join(
  ROOT,
  'docs/architecture/baselines/architecture-growth.json'
)
const ARCHITECTURE_GUARD_PATH = path.join(ROOT, 'scripts/architecture-guard.mjs')
const OPERATION_RUNNER_PATH = path.join(ROOT, 'src/main/routes/operationRunner.ts')
const CONFIG_PRESENTER_PATH = path.join(ROOT, 'src/main/presenter/configPresenter/index.ts')
const AGENT_REPOSITORY_PATH = path.join(ROOT, 'src/main/presenter/agentRepository/index.ts')
const FIXTURE_PATHS = [
  FIXTURE_PATH,
  MEMORY_CORE_FIXTURE_PATH,
  MEMORY_INFRA_FIXTURE_PATH,
  MEMORY_SERVICE_FIXTURE_PATH,
  MEMORY_ROOT_FIXTURE_PATH,
  AGENT_EDGE_FIXTURE_PATH,
  OPERATION_RUNNER_FIXTURE_PATH,
  MAIN_OPERATION_RUNNER_FIXTURE_PATH
]
const TEMP_DIRS: string[] = []
const MAIN_COMPOSITION_METRICS = [
  'routeRootLoc',
  'routeTypedCaseCount',
  'routeConcretePresenterImportCount',
  'routeConcreteSqliteTableImportCount',
  'presenterCompatibilityCoreLoc'
] as const

type ArchitectureGrowthBaseline = {
  version: number
  updatedOn: string
  mainComposition: Record<(typeof MAIN_COMPOSITION_METRICS)[number], number>
  agentEdge: Record<'sharedToMainImplementationImportCount', number>
}

async function writeSettingsFixture(source: string) {
  await writeFile(FIXTURE_PATH, source, 'utf8')
}

async function writeFixture(filePath: string, source: string) {
  await writeFile(filePath, source, 'utf8')
}

async function readTrackedGrowthBaseline() {
  return JSON.parse(
    await readFile(TRACKED_GROWTH_BASELINE_PATH, 'utf8')
  ) as ArchitectureGrowthBaseline
}

async function writeTemporaryGrowthBaseline(baseline: ArchitectureGrowthBaseline) {
  const dirPath = await mkdtemp(path.join(tmpdir(), 'deepchat-architecture-guard-'))
  const baselinePath = path.join(dirPath, 'architecture-growth.json')
  TEMP_DIRS.push(dirPath)
  await writeFile(baselinePath, JSON.stringify(baseline), 'utf8')
  return baselinePath
}

function runArchitectureGuard(baselinePath?: string, nodeEnv = 'test') {
  const env = {
    ...process.env,
    NODE_ENV: nodeEnv
  }
  delete env.DEEPCHAT_TEST_ARCHITECTURE_GROWTH_BASELINE_PATH
  if (baselinePath) env.DEEPCHAT_TEST_ARCHITECTURE_GROWTH_BASELINE_PATH = baselinePath

  return spawnSync(process.execPath, ['scripts/architecture-guard.mjs'], {
    cwd: ROOT,
    encoding: 'utf8',
    env
  })
}

describe.sequential('architecture guard', () => {
  afterEach(async () => {
    await Promise.all([
      ...FIXTURE_PATHS.map((filePath) => rm(filePath, { force: true })),
      ...TEMP_DIRS.splice(0).map((dirPath) => rm(dirPath, { force: true, recursive: true }))
    ])
  })

  it('allows the tracked historical debt at its current baseline', async () => {
    const baseline = await readTrackedGrowthBaseline()

    expect(Object.values(baseline.mainComposition).every((value) => value > 0)).toBe(true)
    expect(baseline.agentEdge.sharedToMainImplementationImportCount).toBeGreaterThan(0)

    const result = runArchitectureGuard()

    expect(result.status).toBe(0)
    expect(result.stdout).toContain('Architecture guard passed.')
  })

  it('pins removal of the final legacy call and retry surface', async () => {
    const [guardSource, runnerSource] = await Promise.all([
      readFile(ARCHITECTURE_GUARD_PATH, 'utf8'),
      readFile(OPERATION_RUNNER_PATH, 'utf8')
    ])
    const allowlistBody = guardSource.match(
      /const LEGACY_OPERATION_RUNNER_ALLOWLIST = new Map\(\[([\s\S]*?)\]\)/
    )?.[1]
    const allowlistedCalls = [
      ...(allowlistBody ?? '').matchAll(/\['([^']+)',\s*(\d+)\]/g)
    ].map((match) => [match[1], Number(match[2])])
    const runnerInterface = runnerSource.match(
      /export interface OperationRunner \{([\s\S]*?)^\}/m
    )?.[1]

    expect(allowlistedCalls).toEqual([])
    expect(allowlistBody).not.toContain('#retry')
    expect(runnerInterface).not.toMatch(/^\s*retry(?:<|\s*\()/m)

    const result = runArchitectureGuard()
    expect(result.status).toBe(0)
  })

  it('pins session create DTO ownership, durable queue, and typed renderer caller', async () => {
    const [guardSource, agentInterfaceSource, sessionClientSource, sessionStoreSource] =
      await Promise.all([
      readFile(ARCHITECTURE_GUARD_PATH, 'utf8'),
      readFile(path.join(ROOT, 'src/shared/types/agent-interface.d.ts'), 'utf8'),
      readFile(path.join(ROOT, 'src/renderer/api/SessionClient.ts'), 'utf8'),
      readFile(path.join(ROOT, 'src/renderer/src/stores/ui/session.ts'), 'utf8')
    ])

    expect(guardSource).toContain('[session-create-operation-dto-owner]')
    expect(guardSource).toContain('[session-create-durable-queue]')
    expect(guardSource).toContain('[session-create-owner-inventory]')
    expect(guardSource).toContain('[session-create-operation-id-owner]')
    expect(guardSource).toContain('[session-create-production-caller]')
    expect(agentInterfaceSource).not.toMatch(
      /(?:CreateSessionOperation|SessionCreateOperation|CreateOperation)(?:State|Stage|Summary|Output|Envelope|Cursor)?\b/
    )
    expect(sessionClientSource).not.toMatch(
      /input\s+as\s+DeepchatRouteInput<\s*typeof sessionsCreateRoute\.name\s*>/
    )
    expect(sessionStoreSource.match(/\bsessionClient\.create\s*\(/g)).toHaveLength(1)
    expect(sessionStoreSource).toContain('sessionClient.create(input, operationId)')

    const result = runArchitectureGuard()
    expect(result.status).toBe(0)
  })

  it('keeps the pre-journal agent type lookup local and finite', async () => {
    const [configSource, repositorySource] = await Promise.all([
      readFile(CONFIG_PRESENTER_PATH, 'utf8'),
      readFile(AGENT_REPOSITORY_PATH, 'utf8')
    ])
    const configBody = configSource.match(
      /async getAgentType\(agentId: string\): Promise<AgentType \| null> \{([\s\S]*?)\n  \}/
    )?.[1]
    const repositoryBody = repositorySource.match(
      /getAgentType\(agentId: string\): 'deepchat' \| 'acp' \| null \{([\s\S]*?)\n  \}/
    )?.[1]

    expect(configBody?.trim()).toBe(
      'return this.getAgentRepositoryOrThrow().getAgentType(agentId)'
    )
    expect(repositoryBody).toContain('this.sqlitePresenter.agentsTable.get(agentId)')
    expect(`${configBody}\n${repositoryBody}`).not.toMatch(
      /\b(?:await|fetch|request|ipc|https?)\b/
    )
  })

  it('fails when agent-interface duplicates the session create operation DTO', async () => {
    const agentInterfacePath = path.join(ROOT, 'src/shared/types/agent-interface.d.ts')
    const original = await readFile(agentInterfacePath, 'utf8')
    try {
      await writeFile(
        agentInterfacePath,
        `${original}\nexport interface CreateSessionOperationSummary { operationId: string }\n`,
        'utf8'
      )

      const result = runArchitectureGuard()
      expect(result.status).not.toBe(0)
      expect(result.stderr).toContain('[session-create-operation-dto-owner]')
    } finally {
      await writeFile(agentInterfacePath, original, 'utf8')
    }
  })

  it('fails when SessionClient casts around the required operation id', async () => {
    const sessionClientPath = path.join(ROOT, 'src/renderer/api/SessionClient.ts')
    const original = await readFile(sessionClientPath, 'utf8')
    try {
      await writeFile(
        sessionClientPath,
        original.replace(
          '{ ...input, operationId }',
          'input as DeepchatRouteInput<typeof sessionsCreateRoute.name>'
        ),
        'utf8'
      )

      const result = runArchitectureGuard()
      expect(result.status).not.toBe(0)
      expect(result.stderr).toContain('[session-create-production-caller]')
    } finally {
      await writeFile(sessionClientPath, original, 'utf8')
    }
  })

  it('fails when the production store omits the operation id', async () => {
    const sessionStorePath = path.join(ROOT, 'src/renderer/src/stores/ui/session.ts')
    const original = await readFile(sessionStorePath, 'utf8')
    try {
      await writeFile(
        sessionStorePath,
        original.replace('sessionClient.create(input, operationId)', 'sessionClient.create(input)'),
        'utf8'
      )

      const result = runArchitectureGuard()
      expect(result.status).not.toBe(0)
      expect(result.stderr).toContain('[session-create-production-caller]')
    } finally {
      await writeFile(sessionStorePath, original, 'utf8')
    }
  })

  it.each([
    [
      'namespace factory',
      OPERATION_RUNNER_FIXTURE_PATH,
      `
        import * as runnerApi from './operationRunner'
        const runner = runnerApi.createNodeOperationRunner()
        export const load = () => runner.timeout({ task: Promise.resolve(), ms: 1, reason: 'new' })
      `
    ],
    [
      'namespace type',
      OPERATION_RUNNER_FIXTURE_PATH,
      `
        import * as runnerApi from './operationRunner'
        export class Fixture {
          constructor(private readonly runner: runnerApi.OperationRunner) {}
          load() {
            return this.runner.timeout({ task: Promise.resolve(), ms: 1, reason: 'new' })
          }
        }
      `
    ],
    [
      'namespace destructure and method alias outside routes',
      MAIN_OPERATION_RUNNER_FIXTURE_PATH,
      `
        import * as runnerApi from './routes/operationRunner'
        const { createNodeOperationRunner: makeRunner } = runnerApi
        const { timeout: wait } = makeRunner()
        export const renamedOwner = () => wait({ task: Promise.resolve(), ms: 1, reason: 'new' })
      `
    ]
  ])('fails closed for an operation runner %s import', async (_label, filePath, source) => {
    await writeFixture(filePath, source)

    const result = runArchitectureGuard()

    expect(result.status).not.toBe(0)
    expect(result.stderr).toContain('[operation-runner-namespace-import]')
    expect(result.stderr).toContain(path.basename(filePath))
  })

  it('tracks named factory and property aliases to a renamed owner', async () => {
    await writeFixture(
      OPERATION_RUNNER_FIXTURE_PATH,
      `
        import { createNodeOperationRunner as importedFactory } from './operationRunner'

        export function renamedOwner() {
          const factoryAlias = importedFactory
          const runnerAlias = factoryAlias()
          const timeoutAlias = runnerAlias.timeout
          return timeoutAlias({ task: Promise.resolve(), ms: 1, reason: 'new' })
        }
      `
    )

    const result = runArchitectureGuard()

    expect(result.status).not.toBe(0)
    expect(result.stderr).toContain('[operation-runner-legacy-call]')
    expect(result.stderr).toContain(
      '__architecture_guard_operation_runner_fixture__.ts#renamedOwner#timeout'
    )
  })

  it('tracks a named import through a local type alias', async () => {
    await writeFixture(
      OPERATION_RUNNER_FIXTURE_PATH,
      `
        import type { OperationRunner as ImportedRunner } from './operationRunner'
        type LocalRunner = ImportedRunner

        export class Fixture {
          constructor(private readonly runner: LocalRunner) {}

          async renamedOwner() {
            return await this.runner.timeout({ task: Promise.resolve(), ms: 1, reason: 'new' })
          }
        }
      `
    )

    const result = runArchitectureGuard()

    expect(result.status).not.toBe(0)
    expect(result.stderr).toContain('[operation-runner-legacy-call]')
    expect(result.stderr).toContain(
      '__architecture_guard_operation_runner_fixture__.ts#renamedOwner#timeout'
    )
  })

  it('fails when a renamed route field makes a direct legacy operation runner call', async () => {
    await writeFixture(
      OPERATION_RUNNER_FIXTURE_PATH,
      `
        import type { OperationRunner as Runner } from './operationRunner'

        export class Fixture {
          constructor(private readonly runner: Runner) {}

          async load() {
            return await this.runner.timeout({ task: Promise.resolve(), ms: 1, reason: 'new' })
          }
        }
      `
    )

    const result = runArchitectureGuard()

    expect(result.status).not.toBe(0)
    expect(result.stderr).toContain('[operation-runner-legacy-call]')
    expect(result.stderr).toContain('__architecture_guard_operation_runner_fixture__.ts#load#timeout')
  })

  it('fails when an aliased operation runner makes a legacy call', async () => {
    await writeFixture(
      OPERATION_RUNNER_FIXTURE_PATH,
      `
        import type { OperationRunner } from './operationRunner'

        export class Fixture {
          constructor(private readonly runner: OperationRunner) {}

          async load() {
            const aliasedRunner = this.runner
            const retry = aliasedRunner.retry
            return await retry({
              task: () => Promise.resolve(),
              maxAttempts: 1,
              initialDelayMs: 0,
              backoff: 1,
              reason: 'new'
            })
          }
        }
      `
    )

    const result = runArchitectureGuard()

    expect(result.status).not.toBe(0)
    expect(result.stderr).toContain('[operation-runner-legacy-call]')
    expect(result.stderr).toContain('__architecture_guard_operation_runner_fixture__.ts#load#retry')
  })

  it('fails for a destructured legacy operation runner call outside routes', async () => {
    await writeFixture(
      MAIN_OPERATION_RUNNER_FIXTURE_PATH,
      `
        import type { OperationRunner } from './routes/operationRunner'

        export class Fixture {
          constructor(private readonly runner: OperationRunner) {}

          async load() {
            const { timeout: wait } = this.runner
            return await wait({ task: Promise.resolve(), ms: 1, reason: 'new' })
          }
        }
      `
    )

    const result = runArchitectureGuard()

    expect(result.status).not.toBe(0)
    expect(result.stderr).toContain('[operation-runner-legacy-call]')
    expect(result.stderr).toContain('src/main/__architecture_guard_operation_runner_fixture__.ts#load#timeout')
  })

  it('fails when a route prebuilds the unused cancellable operation abstraction', async () => {
    await writeFixture(
      OPERATION_RUNNER_FIXTURE_PATH,
      `export const runCancellable = () => Promise.resolve()`
    )

    const result = runArchitectureGuard()

    expect(result.status).not.toBe(0)
    expect(result.stderr).toContain('[operation-runner-unused-cancellable]')
    expect(result.stderr).toContain('__architecture_guard_operation_runner_fixture__.ts')
  })

  it('allows metrics to fall below a stale baseline', async () => {
    const baseline = await readTrackedGrowthBaseline()
    for (const metric of MAIN_COMPOSITION_METRICS) {
      baseline.mainComposition[metric] += 1
    }
    baseline.agentEdge.sharedToMainImplementationImportCount += 1

    const baselinePath = await writeTemporaryGrowthBaseline(baseline)
    const result = runArchitectureGuard(baselinePath)

    expect(result.status).toBe(0)
  })

  it('fails closed for an unsupported baseline version', async () => {
    const baseline = await readTrackedGrowthBaseline()
    baseline.version = 2

    const baselinePath = await writeTemporaryGrowthBaseline(baseline)
    const result = runArchitectureGuard(baselinePath)

    expect(result.status).not.toBe(0)
    expect(result.stderr).toContain('[architecture-growth-baseline-invalid]')
    expect(result.stderr).toContain('version must be 1')
  })

  it('fails closed for malformed baseline metadata', async () => {
    const baseline = await readTrackedGrowthBaseline()
    baseline.updatedOn = '2026-02-30'

    const baselinePath = await writeTemporaryGrowthBaseline(baseline)
    const result = runArchitectureGuard(baselinePath)

    expect(result.status).not.toBe(0)
    expect(result.stderr).toContain('[architecture-growth-baseline-invalid]')
    expect(result.stderr).toContain('updatedOn must be a valid YYYY-MM-DD date')
  })

  it('ignores the test baseline override outside test mode', async () => {
    const baseline = await readTrackedGrowthBaseline()
    baseline.version = 2

    const baselinePath = await writeTemporaryGrowthBaseline(baseline)
    const result = runArchitectureGuard(baselinePath, 'production')

    expect(result.status).toBe(0)
  })

  it.each(MAIN_COMPOSITION_METRICS)(
    'reports main-composition growth when %s exceeds its baseline',
    async (metric) => {
      const baseline = await readTrackedGrowthBaseline()
      baseline.mainComposition[metric] -= 1

      const baselinePath = await writeTemporaryGrowthBaseline(baseline)
      const result = runArchitectureGuard(baselinePath)

      expect(result.status).not.toBe(0)
      expect(result.stderr).toContain('[main-composition-growth]')
      expect(result.stderr).toContain(metric)
    }
  )

  it.each([
    ['main presenter alias', '@/presenter/configPresenter/shortcutKeySettings'],
    ['explicit main specifier', 'src/main/presenter/configPresenter'],
    ['relative main path', '../main/presenter/configPresenter'],
    [
      'absolute main path',
      path.join(ROOT, 'src/main/presenter/configPresenter').split(path.sep).join('/')
    ]
  ])('reports agent-edge growth for a shared %s import', async (_label, specifier) => {
    await writeFixture(AGENT_EDGE_FIXTURE_PATH, `import '${specifier}'\n`)

    const result = runArchitectureGuard()

    expect(result.status).not.toBe(0)
    expect(result.stderr).toContain('[agent-edge-growth]')
    expect(result.stderr).toContain('sharedToMainImplementationImportCount')
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
