import { describe, expect, it, vi } from 'vitest'
import { parse } from 'yaml'

const fs = await vi.importActual<typeof import('node:fs')>('node:fs')
const path = await vi.importActual<typeof import('node:path')>('node:path')

interface WorkflowStep {
  name?: string
  uses?: string
  if?: string
  shell?: string
  run?: string
  env?: Record<string, string>
  with?: Record<string, unknown>
}

interface WorkflowJob {
  if?: string
  needs?: string | string[]
  'runs-on'?: string
  'timeout-minutes'?: number
  permissions?: Record<string, string>
  outputs?: Record<string, string>
  strategy?: unknown
  uses?: string
  with?: Record<string, unknown>
  secrets?: Record<string, string>
  steps?: WorkflowStep[]
}

interface PrCheckWorkflow {
  on: {
    pull_request: {
      branches: string[]
      paths?: string[]
      'paths-ignore'?: string[]
    }
  }
  permissions: Record<string, string>
  concurrency: {
    group: string
    'cancel-in-progress': boolean
  }
  env: Record<string, string>
  jobs: Record<string, WorkflowJob>
}

const workflowPath = path.join(process.cwd(), '.github/workflows/prcheck.yml')
const workflowSource = fs.readFileSync(workflowPath, 'utf8')
const workflow = parse(workflowSource) as PrCheckWorkflow
const packageJson = JSON.parse(
  fs.readFileSync(path.join(process.cwd(), 'package.json'), 'utf8')
) as {
  devDependencies: Record<string, string>
}

const expectedJobNames = [
  'static',
  'test-main',
  'test-renderer',
  'test-native-memory',
  'build',
  'pr-required'
]

const expectedActionUses = [
  ...Array(5).fill('actions/checkout@de0fac2e4500dabe0009e67214ff5f5447ce83dd'),
  ...Array(5).fill('actions/setup-node@48b55a011bda9f5d6aeb4c2d9c7362e8dae4041e'),
  ...Array(5).fill('pnpm/action-setup@0e279bb959325dab635dd2c09392533439d90093'),
  'actions/upload-artifact@b7c566a772e6b6bfb58ed0dc250532a479d7789f'
]

const getStep = (job: WorkflowJob, name: string): WorkflowStep => {
  const step = job.steps?.find((candidate) => candidate.name === name)
  if (!step) {
    throw new Error(`Missing workflow step: ${name}`)
  }
  return step
}

const getRunCommands = (job: WorkflowJob): string[] =>
  (job.steps ?? []).flatMap((step) => (step.run ? [step.run] : []))

describe('PR Check workflow contracts', () => {
  it('keeps the workflow read-only, PR-scoped, and cancellation-aware', () => {
    expect(workflow.on.pull_request).toEqual({
      branches: ['dev']
    })
    expect(workflow.permissions).toEqual({
      contents: 'read'
    })
    expect(workflow.concurrency).toEqual({
      group: '${{ github.workflow }}-pr-${{ github.event.pull_request.number }}',
      'cancel-in-progress': true
    })
    expect(workflow.env).toMatchObject({
      CI: 'true',
      FORCE_JAVASCRIPT_ACTIONS_TO_NODE24: 'true'
    })
  })

  it('keeps every quality gate independent, bounded, and pinned', () => {
    expect(Object.keys(workflow.jobs).sort()).toEqual([...expectedJobNames].sort())

    for (const job of Object.values(workflow.jobs).filter((candidate) => !candidate.uses)) {
      expect(job['runs-on']).toBe('ubuntu-24.04')
      expect(job['timeout-minutes']).toBeGreaterThan(0)
      expect(job.strategy).toBeUndefined()
    }

    const actionSteps = Object.values(workflow.jobs).flatMap((job) =>
      (job.steps ?? []).filter((step) => step.uses)
    )
    expect(
      actionSteps.map((step) => step.uses).sort()
    ).toEqual([...expectedActionUses].sort())
    for (const step of actionSteps) {
      expect(step.uses).toMatch(/^[^@]+@[0-9a-f]{40}$/)
    }

    const checkoutSteps = actionSteps.filter((step) => step.uses?.startsWith('actions/checkout@'))
    expect(checkoutSteps).toHaveLength(5)
    for (const step of checkoutSteps) {
      expect(step.with).toMatchObject({
        'persist-credentials': false
      })
    }

    const setupNodeSteps = actionSteps.filter((step) =>
      step.uses?.startsWith('actions/setup-node@')
    )
    expect(setupNodeSteps).toHaveLength(5)
    for (const step of setupNodeSteps) {
      expect(step.with).toMatchObject({
        'node-version': '24.18.0',
        'package-manager-cache': false
      })
    }
  })

  it('keeps static checks and complete test suites in dedicated jobs', () => {
    expect(getRunCommands(workflow.jobs.static)).toEqual([
      'pnpm install --frozen-lockfile',
      'pnpm run lint',
      'pnpm run format:check',
      'pnpm run i18n',
      'pnpm run architecture:renderer-baseline:check',
      'pnpm run icons:check',
      'pnpm run typecheck'
    ])
    expect(getRunCommands(workflow.jobs['test-main'])).toEqual([
      'pnpm install --frozen-lockfile',
      'pnpm run test:main'
    ])
    expect(getRunCommands(workflow.jobs['test-renderer'])).toEqual([
      'pnpm install --frozen-lockfile',
      'pnpm run test:renderer'
    ])
    expect(getRunCommands(workflow.jobs.build)).toEqual([
      'pnpm install --frozen-lockfile',
      'pnpm run build'
    ])

    expect(workflowSource).not.toContain('matrix:')
    expect(workflowSource).not.toContain('pnpm run install:sharp')
    expect(workflowSource).not.toContain('pnpm run test:agent:eval')
  })

  it('pins external icon generator inputs for reproducible checks', () => {
    const exactVersion = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/

    expect(packageJson.devDependencies['@iconify-json/lucide']).toMatch(exactVersion)
    expect(packageJson.devDependencies['@iconify-json/vscode-icons']).toMatch(exactVersion)
  })

  it('keeps Native Memory validation ordered and workflow-owned', () => {
    const nativeJob = workflow.jobs['test-native-memory']
    const orderedStepNames = [
      'Install dependencies',
      'Install and verify DuckDB VSS',
      'Validate portable memory behavior',
      'Prepare native SQLite for the Node ABI',
      'Smoke native SQLite',
      'Validate native Tape storage',
      'Validate encrypted OCR artifact storage',
      'Validate native memory storage',
      'Validate memory retrieval quality',
      'Validate memory performance bounds',
      'Upload memory retrieval report'
    ]
    const indexes = orderedStepNames.map((name) =>
      nativeJob.steps!.findIndex((step) => step.name === name)
    )

    expect(indexes.every((index) => index >= 0)).toBe(true)
    expect(indexes).toEqual([...indexes].sort((left, right) => left - right))
    expect(
      getRunCommands(nativeJob).some((command) =>
        command.includes('pnpm run test:memory:scope')
      )
    ).toBe(false)
    expect(getStep(nativeJob, 'Install and verify DuckDB VSS').run).toContain(
      'pnpm run installRuntime:duckdb:vss:linux:x64'
    )
    expect(getStep(nativeJob, 'Install and verify DuckDB VSS').run).toContain(
      'pnpm run smoke:duckdb:vss -- --platform linux --arch x64'
    )
    expect(getStep(nativeJob, 'Validate portable memory behavior').run).toBe(
      'pnpm run test:memory'
    )
    expect(getStep(nativeJob, 'Prepare native SQLite for the Node ABI').run).toBe(
      'pnpm --dir node_modules/better-sqlite3-multiple-ciphers run install'
    )
    expect(getStep(nativeJob, 'Smoke native SQLite').run).toBe(
      'node scripts/smoke-memory-native-sqlite.js'
    )
    expect(getStep(nativeJob, 'Validate native Tape storage').run).toContain(
      'test/main/tape/traceInspector.test.ts'
    )
    expect(getStep(nativeJob, 'Validate encrypted OCR artifact storage').run).toBe(
      'pnpm exec vitest --config vitest.config.ts --run test/main/ocr/ocrArtifactStore.test.ts test/main/ocr/documentOcrArtifactStore.test.ts'
    )
    expect(getStep(nativeJob, 'Validate encrypted OCR artifact storage').env).toEqual({
      DEEPCHAT_REQUIRE_NATIVE_SQLITE: '1'
    })
    expect(getStep(nativeJob, 'Validate native memory storage').run).toBe(
      'pnpm exec vitest --config vitest.config.memory-native.ts --run'
    )
    expect(getStep(nativeJob, 'Validate native memory storage').env).toEqual({
      DEEPCHAT_REQUIRE_NATIVE_SQLITE: '1',
      DEEPCHAT_REQUIRE_NATIVE_DUCKDB_VSS: '1'
    })
    expect(getStep(nativeJob, 'Validate memory retrieval quality').run).toBe(
      'pnpm run test:memory:eval'
    )
    expect(getStep(nativeJob, 'Validate memory retrieval quality').env).toEqual({
      DEEPCHAT_REQUIRE_NATIVE_SQLITE: '1'
    })
    expect(getStep(nativeJob, 'Validate memory performance bounds').run).toBe(
      'pnpm run test:main:memory-perf'
    )
    expect(getStep(nativeJob, 'Validate memory performance bounds').env).toEqual({
      DEEPCHAT_REQUIRE_NATIVE_SQLITE: '1'
    })
    expect(getStep(nativeJob, 'Upload memory retrieval report')).toMatchObject({
      if: 'always()',
      with: {
        name: 'memory-retrieval-v1',
        path: 'test-results/memory/retrieval-v1.json',
        'if-no-files-found': 'error'
      }
    })
  })

  it('fails closed unless every fast required job succeeds', () => {
    const aggregateJob = workflow.jobs['pr-required']
    const aggregateStep = getStep(aggregateJob, 'Verify required PR checks')

    expect(aggregateJob.if).toBe('always()')
    expect(aggregateJob.needs).toEqual([
      'static',
      'test-main',
      'test-renderer',
      'test-native-memory',
      'build'
    ])
    expect(aggregateJob.steps).toHaveLength(1)
    expect(aggregateStep.shell).toBe('bash')
    expect(aggregateStep.env).toEqual({
      STATIC_RESULT: '${{ needs.static.result }}',
      TEST_MAIN_RESULT: '${{ needs.test-main.result }}',
      TEST_RENDERER_RESULT: '${{ needs.test-renderer.result }}',
      TEST_NATIVE_MEMORY_RESULT: '${{ needs.test-native-memory.result }}',
      BUILD_RESULT: '${{ needs.build.result }}'
    })
    expect(aggregateStep.run).toContain('if [[ "${result}" != "success" ]]')
    for (const jobName of [
      'static',
      'test-main',
      'test-renderer',
      'test-native-memory',
      'build'
    ]) {
      expect(aggregateStep.run).toContain(`require_success "${jobName}"`)
    }
    expect(workflowSource).not.toContain('package-impact')
    expect(workflowSource).not.toContain('package-regression')
    expect(workflowSource).not.toContain('main-release-guard')
    expect(aggregateStep.run).toContain('exit 1')
  })
})
