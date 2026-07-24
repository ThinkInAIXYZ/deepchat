import { describe, expect, it, vi } from 'vitest'
import { parse } from 'yaml'

const fs = await vi.importActual<typeof import('node:fs')>('node:fs')
const path = await vi.importActual<typeof import('node:path')>('node:path')
const { spawnSync } =
  await vi.importActual<typeof import('node:child_process')>('node:child_process')

interface WorkflowStep {
  name?: string
  uses?: string
  run?: string
  shell?: string
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
  strategy?: {
    'fail-fast': boolean
    matrix: { arch: string[] }
  }
  uses?: string
  with?: Record<string, unknown>
  secrets?: Record<string, string>
  steps?: WorkflowStep[]
}

interface PackageCheckWorkflow {
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

const workflowPath = path.resolve('.github/workflows/package-check.yml')
const workflowSource = fs.readFileSync(workflowPath, 'utf8')
const workflow = parse(workflowSource) as PackageCheckWorkflow

const getStep = (job: WorkflowJob, name: string): WorkflowStep => {
  const step = job.steps?.find((candidate) => candidate.name === name)
  if (!step) throw new Error(`Missing workflow step: ${name}`)
  return step
}

const runAggregate = (values: Record<string, string>) => {
  const script = getStep(
    workflow.jobs['package-required'],
    'Verify required package checks'
  ).run!
  return spawnSync('bash', ['-c', script], {
    encoding: 'utf8',
    env: {
      ...process.env,
      ...values
    }
  })
}

describe('PR package check workflow contracts', () => {
  it('always starts read-only and exposes one stable aggregate', () => {
    expect(workflow.on.pull_request).toEqual({
      branches: ['dev']
    })
    expect(workflow.permissions).toEqual({ contents: 'read' })
    expect(workflow.concurrency).toEqual({
      group: '${{ github.workflow }}-pr-${{ github.event.pull_request.number }}',
      'cancel-in-progress': true
    })
    expect(workflow.env).toMatchObject({
      CI: 'true',
      FORCE_JAVASCRIPT_ACTIONS_TO_NODE24: 'true'
    })
    expect(Object.keys(workflow.jobs)).toEqual([
      'package-impact',
      'package-windows',
      'package-linux',
      'package-macos',
      'package-required'
    ])
    expect(workflowSource).not.toContain('pull_request_target')
    expect(workflowSource).not.toContain('secrets: inherit')
  })

  it('uses only the base classifier with an all-target bootstrap fallback', () => {
    const impactJob = workflow.jobs['package-impact']
    const classifyStep = getStep(impactJob, 'Classify package impact')

    expect(impactJob).toMatchObject({
      'runs-on': 'ubuntu-24.04',
      'timeout-minutes': 5,
      outputs: {
        required: '${{ steps.classify.outputs.required }}',
        windows: '${{ steps.classify.outputs.windows }}',
        linux: '${{ steps.classify.outputs.linux }}',
        macos: '${{ steps.classify.outputs.macos }}'
      }
    })
    expect(classifyStep.env).toEqual({
      BASE_SHA: '${{ github.event.pull_request.base.sha }}',
      HEAD_SHA: '${{ github.event.pull_request.head.sha }}'
    })
    expect(classifyStep.run).toContain(
      'merge_base="$(git merge-base "${BASE_SHA}" "${HEAD_SHA}")"'
    )
    expect(classifyStep.run).toContain(
      'git show "${BASE_SHA}:scripts/ci/classify-package-impact.mjs"'
    )
    expect(classifyStep.run).not.toContain(
      'cp scripts/ci/classify-package-impact.mjs "${classifier}"'
    )
    expect(classifyStep.run).toContain(
      'if ! git cat-file -e "${BASE_SHA}:scripts/ci/classify-package-impact.mjs"'
    )
    expect(classifyStep.run).toContain(
      'Base classifier is unavailable; selecting every package target.'
    )
    for (const output of [
      'required=true',
      'windows=true',
      'linux=true',
      'macos=true'
    ]) {
      expect(classifyStep.run).toContain(`echo '${output}'`)
    }
    expect(classifyStep.run).toContain(
      'git diff --name-only --no-renames -z "${merge_base}" "${HEAD_SHA}" > "${changed_paths}"'
    )
    expect(classifyStep.run).toContain(
      'git show "${merge_base}:package.json" > "${base_package_json}"'
    )
    expect(classifyStep.run).toContain(
      'git show "${HEAD_SHA}:package.json" > "${head_package_json}"'
    )
    expect(classifyStep.run).toContain(
      'node - "${base_package_json}" "${head_package_json}"'
    )
    expect(classifyStep.run.indexOf('node - "${base_package_json}"')).toBeLessThan(
      classifyStep.run.indexOf('Base classifier is unavailable')
    )
    expect(classifyStep.run.indexOf('git diff --name-only')).toBeLessThan(
      classifyStep.run.indexOf('Base classifier is unavailable')
    )
    expect(classifyStep.run).toContain('node "${classifier}" \\')
    expect(classifyStep.run).toContain('--github-output "${GITHUB_OUTPUT}"')
    expect(classifyStep.run).toContain(
      '--base-package-json "${base_package_json}"'
    )
    expect(classifyStep.run).toContain(
      '--head-package-json "${head_package_json}"'
    )
    expect(classifyStep.run).toContain('< "${changed_paths}"')

    const actionSteps = impactJob.steps!.filter((step) => step.uses)
    expect(actionSteps.map(({ uses }) => uses)).toEqual([
      'actions/checkout@de0fac2e4500dabe0009e67214ff5f5447ce83dd',
      'actions/setup-node@48b55a011bda9f5d6aeb4c2d9c7362e8dae4041e'
    ])
    for (const step of actionSteps) {
      expect(step.uses).toMatch(/^[^@]+@[0-9a-f]{40}$/)
    }
    expect(actionSteps[0].with).toMatchObject({
      'persist-credentials': false,
      'fetch-depth': 0
    })
    expect(actionSteps[1].with).toEqual({
      'node-version': '24.14.1',
      'package-manager-cache': false
    })
  })

  it('runs both architectures only for selected operating systems', () => {
    const definitions = {
      'package-windows': {
        output: 'windows',
        workflow: './.github/workflows/_package-windows.yml'
      },
      'package-linux': {
        output: 'linux',
        workflow: './.github/workflows/_package-linux.yml'
      },
      'package-macos': {
        output: 'macos',
        workflow: './.github/workflows/_package-macos.yml'
      }
    }

    for (const [jobName, definition] of Object.entries(definitions)) {
      expect(workflow.jobs[jobName]).toEqual({
        needs: 'package-impact',
        if: `needs.package-impact.outputs.${definition.output} == 'true'`,
        permissions: { contents: 'read' },
        strategy: {
          'fail-fast': false,
          matrix: { arch: ['x64', 'arm64'] }
        },
        uses: definition.workflow,
        with: {
          'source-sha': '${{ github.sha }}',
          arch: '${{ matrix.arch }}',
          'artifact-purpose': 'verification',
          'enforce-installer-size': true
        }
      })
    }
    expect(workflowSource).not.toContain('DEEPCHAT_CSC_')
    expect(workflowSource).not.toContain('DEEPCHAT_APPLE_NOTARY_')
  })

  it('fails closed on invalid classifier outputs and unexpected job states', () => {
    const aggregate = workflow.jobs['package-required']
    const aggregateStep = getStep(aggregate, 'Verify required package checks')

    expect(aggregate).toMatchObject({
      if: 'always()',
      needs: ['package-impact', 'package-windows', 'package-linux', 'package-macos'],
      'runs-on': 'ubuntu-24.04',
      'timeout-minutes': 2
    })
    expect(aggregateStep.shell).toBe('bash')
    expect(aggregateStep.env).toEqual({
      PACKAGE_IMPACT_RESULT: '${{ needs.package-impact.result }}',
      WINDOWS_REQUIRED: '${{ needs.package-impact.outputs.windows }}',
      WINDOWS_RESULT: '${{ needs.package-windows.result }}',
      LINUX_REQUIRED: '${{ needs.package-impact.outputs.linux }}',
      LINUX_RESULT: '${{ needs.package-linux.result }}',
      MACOS_REQUIRED: '${{ needs.package-impact.outputs.macos }}',
      MACOS_RESULT: '${{ needs.package-macos.result }}'
    })
    expect(aggregateStep.run).toContain('require_success "package-impact"')
    for (const platform of ['windows', 'linux', 'macos']) {
      expect(aggregateStep.run).toContain(`require_platform_result "${platform}"`)
    }
    expect(aggregateStep.run).toContain('if [[ "${result}" != "skipped" ]]')
    expect(aggregateStep.run).toContain(
      'failures+=("package-impact-${platform}=${required:-missing}")'
    )
    expect(aggregateStep.run).toContain('exit 1')
  })

  it('executes the aggregate success and failure state matrix', () => {
    const skipped = {
      PACKAGE_IMPACT_RESULT: 'success',
      WINDOWS_REQUIRED: 'false',
      WINDOWS_RESULT: 'skipped',
      LINUX_REQUIRED: 'false',
      LINUX_RESULT: 'skipped',
      MACOS_REQUIRED: 'false',
      MACOS_RESULT: 'skipped'
    }
    expect(runAggregate(skipped).status).toBe(0)
    expect(
      runAggregate({
        ...skipped,
        WINDOWS_REQUIRED: 'true',
        WINDOWS_RESULT: 'success'
      }).status
    ).toBe(0)

    for (const invalid of [
      { ...skipped, PACKAGE_IMPACT_RESULT: 'failure' },
      { ...skipped, WINDOWS_REQUIRED: 'true', WINDOWS_RESULT: 'skipped' },
      { ...skipped, WINDOWS_REQUIRED: 'false', WINDOWS_RESULT: 'success' },
      { ...skipped, WINDOWS_REQUIRED: '' }
    ]) {
      const result = runAggregate(invalid)
      expect(result.status).not.toBe(0)
      expect(result.stderr).toContain('Required package checks did not pass')
    }
  })
})
