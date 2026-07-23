import path from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { parse } from 'yaml'

const fs = await vi.importActual<typeof import('node:fs')>('node:fs')

interface WorkflowStep {
  name?: string
  uses?: string
  if?: string
  run?: string
  with?: Record<string, unknown>
}

interface ReusableWorkflow {
  on: {
    workflow_call: {
      inputs: Record<string, { required: boolean; type: string }>
      secrets: Record<string, { required: boolean }>
    }
  }
  permissions: Record<string, string>
  env: Record<string, string>
  jobs: {
    package: {
      'runs-on': string
      'timeout-minutes': number
      permissions: Record<string, string>
      steps: WorkflowStep[]
    }
  }
}

interface BuildWorkflowJob {
  if: string
  permissions: Record<string, string>
  strategy: {
    'fail-fast': boolean
    matrix: { arch: string[] }
  }
  uses: string
  with: Record<string, unknown>
  secrets: Record<string, string>
}

interface BuildWorkflow {
  permissions: Record<string, string>
  jobs: Record<string, BuildWorkflowJob>
}

interface RegressionWorkflow extends BuildWorkflow {
  on: {
    workflow_call: {
      inputs: Record<string, { required: boolean; type: string }>
      secrets: Record<string, { required: boolean }>
    }
    workflow_dispatch: Record<string, never>
    schedule: Array<{ cron: string }>
  }
}

interface ReleaseWorkflowJob {
  needs?: string | string[]
  'runs-on'?: string
  permissions: Record<string, string>
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

interface ReleaseWorkflow {
  permissions: Record<string, string>
  concurrency: {
    group: string
    'cancel-in-progress': boolean
  }
  jobs: Record<string, ReleaseWorkflowJob>
}

const workflowDirectory = path.resolve('.github/workflows')
const readWorkflowSource = (name: string) =>
  fs.readFileSync(path.join(workflowDirectory, name), 'utf8')
const readWorkflow = <T>(name: string) => parse(readWorkflowSource(name)) as T

const commonInputs = {
  'source-sha': { required: true, type: 'string' },
  arch: { required: true, type: 'string' },
  'artifact-purpose': { required: true, type: 'string' },
  'enforce-installer-size': { required: true, type: 'boolean' }
}

const commonSecrets = {
  RTK_GITHUB_TOKEN: { required: false },
  DC_GITHUB_CLIENT_ID: { required: false },
  DC_GITHUB_CLIENT_SECRET: { required: false },
  DC_GITHUB_REDIRECT_URI: { required: false }
}

const reusableWorkflows = {
  windows: {
    name: '_package-windows.yml',
    runner: "${{ inputs.arch == 'arm64' && 'windows-11-arm' || 'windows-2025-vs2026' }}",
    artifact: 'deepchat-package-win32-${{ inputs.arch }}'
  },
  linux: {
    name: '_package-linux.yml',
    runner: "${{ inputs.arch == 'arm64' && 'ubuntu-24.04-arm' || 'ubuntu-24.04' }}",
    artifact: 'deepchat-package-linux-${{ inputs.arch }}'
  },
  macos: {
    name: '_package-macos.yml',
    runner: "${{ inputs.arch == 'arm64' && 'macos-15' || 'macos-15-intel' }}",
    artifact: 'deepchat-package-darwin-${{ inputs.arch }}'
  }
}

const getStep = (workflow: ReusableWorkflow, name: string) => {
  const step = workflow.jobs.package.steps.find((candidate) => candidate.name === name)
  if (!step) throw new Error(`Missing workflow step: ${name}`)
  return step
}

describe('native package reusable workflows', () => {
  it('owns the fixed runner mapping and a shared immutable input contract', () => {
    for (const definition of Object.values(reusableWorkflows)) {
      const workflow = readWorkflow<ReusableWorkflow>(definition.name)
      expect(Object.keys(workflow.on.workflow_call.inputs)).toEqual(
        Object.keys(commonInputs)
      )
      expect(workflow.on.workflow_call.inputs).toMatchObject(commonInputs)
      expect(workflow.permissions).toEqual({ contents: 'read' })
      expect(workflow.env).toMatchObject({
        CI: 'true',
        FORCE_JAVASCRIPT_ACTIONS_TO_NODE24: 'true'
      })
      expect(workflow.jobs.package['runs-on']).toBe(definition.runner)
      expect(workflow.jobs.package['timeout-minutes']).toBeGreaterThan(0)
      expect(workflow.jobs.package.permissions).toEqual({ contents: 'read' })
      expect(workflow.jobs.package.steps[0]).toMatchObject({
        name: 'Validate immutable source input'
      })
      expect(workflow.jobs.package.steps[0].run).toContain(
        '^[a-f0-9]{40}$'
      )
    }
  })

  it('passes only explicit platform secrets and never inherits caller secrets', () => {
    const windows = readWorkflow<ReusableWorkflow>(reusableWorkflows.windows.name)
    const linux = readWorkflow<ReusableWorkflow>(reusableWorkflows.linux.name)
    const macos = readWorkflow<ReusableWorkflow>(reusableWorkflows.macos.name)
    expect(windows.on.workflow_call.secrets).toEqual(commonSecrets)
    expect(linux.on.workflow_call.secrets).toEqual(commonSecrets)
    expect(macos.on.workflow_call.secrets).toEqual({
      ...commonSecrets,
      DEEPCHAT_CSC_LINK: { required: false },
      DEEPCHAT_CSC_KEY_PASS: { required: false },
      DEEPCHAT_APPLE_NOTARY_USERNAME: { required: false },
      DEEPCHAT_APPLE_NOTARY_TEAM_ID: { required: false },
      DEEPCHAT_APPLE_NOTARY_PASSWORD: { required: false }
    })
    for (const definition of Object.values(reusableWorkflows)) {
      expect(readWorkflowSource(definition.name)).not.toContain('secrets: inherit')
    }
    expect(readWorkflowSource(reusableWorkflows.windows.name)).not.toContain(
      'DEEPCHAT_APPLE_NOTARY_'
    )
    expect(readWorkflowSource(reusableWorkflows.linux.name)).not.toContain(
      'DEEPCHAT_APPLE_NOTARY_'
    )
  })

  it('keeps target dependency installation frozen and ordered after install:sharp', () => {
    for (const definition of Object.values(reusableWorkflows)) {
      const workflow = readWorkflow<ReusableWorkflow>(definition.name)
      const steps = workflow.jobs.package.steps
      const installs = steps
        .map((step, index) => ({ index, run: step.run }))
        .filter(({ run }) => run === 'pnpm install --frozen-lockfile')
      const sharpIndex = steps.findIndex((step) => step.run === 'pnpm run install:sharp')
      expect(installs).toHaveLength(2)
      expect(installs[0].index).toBeLessThan(sharpIndex)
      expect(sharpIndex).toBeLessThan(installs[1].index)
      const setupNode = steps.find((step) => step.uses?.startsWith('actions/setup-node@'))
      expect(setupNode?.with).toMatchObject({
        'node-version': '24.14.1',
        'package-manager-cache': false
      })
    }
  })

  it('pins external actions and checks out the requested immutable source', () => {
    for (const definition of Object.values(reusableWorkflows)) {
      const workflow = readWorkflow<ReusableWorkflow>(definition.name)
      const actionSteps = workflow.jobs.package.steps.filter((step) => step.uses)
      for (const step of actionSteps) {
        expect(step.uses).toMatch(/^[^@]+@[0-9a-f]{40}$/)
      }
      const checkout = actionSteps.find((step) => step.uses?.startsWith('actions/checkout@'))
      expect(checkout?.with).toMatchObject({
        ref: '${{ inputs.source-sha }}',
        'fetch-depth': 1,
        'persist-credentials': false
      })
    }
  })

  it('uploads only the package contract for distribution and reports for verification', () => {
    for (const definition of Object.values(reusableWorkflows)) {
      const workflow = readWorkflow<ReusableWorkflow>(definition.name)
      const distribution = getStep(workflow, 'Upload distribution package')
      const diagnostics = getStep(workflow, 'Upload verification diagnostics')
      expect(distribution.if).toContain("inputs.artifact-purpose == 'distribution'")
      expect(distribution.with).toMatchObject({
        name: definition.artifact,
        path: 'package-output/',
        'if-no-files-found': 'error',
        'compression-level': 0,
        overwrite: true
      })
      expect(diagnostics.if).toContain("inputs.artifact-purpose == 'verification'")
      expect(String(diagnostics.with?.path)).not.toContain('package-output/files')
      expect(String(diagnostics.with?.path)).not.toContain('package-output/metadata')
      expect(diagnostics.with?.overwrite).toBe(true)
    }
  })

  it('derives macOS distribution evidence and disables identity discovery for verification', () => {
    const source = readWorkflowSource(reusableWorkflows.macos.name)
    const workflow = readWorkflow<ReusableWorkflow>(reusableWorkflows.macos.name)
    expect(source).toContain("if [[ \"${PACKAGE_PURPOSE}\" == 'distribution' ]]")
    expect(source).toContain(
      "CSC_IDENTITY_AUTO_DISCOVERY: ${{ inputs.artifact-purpose == 'verification' && 'false' || '' }}"
    )
    expect(source).toContain(
      "build_for_release: ${{ inputs.artifact-purpose == 'distribution' && '2' || '' }}"
    )
    expect(getStep(workflow, 'Create package manifest and verify distribution evidence').run).toContain(
      'scripts/ci/package-manifest.mjs'
    )
    expect(source).not.toContain('signed:')
  })
})

describe('Build Application caller', () => {
  const workflow = readWorkflow<BuildWorkflow>('build.yml')
  const source = readWorkflowSource('build.yml')

  it('uses a matrix to call each OS workflow with a fixed distribution purpose', () => {
    expect(workflow.permissions).toEqual({ contents: 'read' })
    expect(Object.keys(workflow.jobs)).toEqual([
      'package-windows',
      'package-linux',
      'package-macos'
    ])
    const expectedUses = {
      'package-windows': './.github/workflows/_package-windows.yml',
      'package-linux': './.github/workflows/_package-linux.yml',
      'package-macos': './.github/workflows/_package-macos.yml'
    }
    for (const [name, job] of Object.entries(workflow.jobs)) {
      expect(job.permissions).toEqual({ contents: 'read' })
      expect(job.strategy).toEqual({
        'fail-fast': false,
        matrix: { arch: ['x64', 'arm64'] }
      })
      expect(job.uses).toBe(expectedUses[name as keyof typeof expectedUses])
      expect(job.with).toEqual({
        'source-sha': '${{ github.sha }}',
        arch: '${{ matrix.arch }}',
        'artifact-purpose': 'distribution',
        'enforce-installer-size': false
      })
    }
    expect(source).not.toContain('secrets: inherit')
  })

  it('passes Apple credentials only to the macOS distribution caller', () => {
    const windowsSecrets = Object.keys(workflow.jobs['package-windows'].secrets)
    const linuxSecrets = Object.keys(workflow.jobs['package-linux'].secrets)
    const macSecrets = Object.keys(workflow.jobs['package-macos'].secrets)
    expect(windowsSecrets).toEqual(Object.keys(commonSecrets))
    expect(linuxSecrets).toEqual(Object.keys(commonSecrets))
    expect(macSecrets).toEqual([
      ...Object.keys(commonSecrets),
      'DEEPCHAT_CSC_LINK',
      'DEEPCHAT_CSC_KEY_PASS',
      'DEEPCHAT_APPLE_NOTARY_USERNAME',
      'DEEPCHAT_APPLE_NOTARY_TEAM_ID',
      'DEEPCHAT_APPLE_NOTARY_PASSWORD'
    ])
  })
})

describe('Package Regression caller', () => {
  const workflow = readWorkflow<RegressionWorkflow>('package-regression.yml')
  const source = readWorkflowSource('package-regression.yml')

  it('supports reusable, manual, and daily six-target verification', () => {
    expect(workflow.on.workflow_call.inputs).toMatchObject({
      'source-sha': { required: true, type: 'string' }
    })
    expect(workflow.on.workflow_dispatch).toEqual({})
    expect(workflow.on.schedule).toEqual([{ cron: '37 18 * * *' }])
    expect(workflow.permissions).toEqual({ contents: 'read' })
    expect(Object.keys(workflow.jobs)).toEqual([
      'package-windows',
      'package-linux',
      'package-macos'
    ])

    const expectedUses = {
      'package-windows': './.github/workflows/_package-windows.yml',
      'package-linux': './.github/workflows/_package-linux.yml',
      'package-macos': './.github/workflows/_package-macos.yml'
    }
    for (const [name, job] of Object.entries(workflow.jobs)) {
      expect(job.permissions).toEqual({ contents: 'read' })
      expect(job.strategy).toEqual({
        'fail-fast': false,
        matrix: { arch: ['x64', 'arm64'] }
      })
      expect(job.uses).toBe(expectedUses[name as keyof typeof expectedUses])
      expect(job.with).toEqual({
        'source-sha': '${{ inputs.source-sha || github.sha }}',
        arch: '${{ matrix.arch }}',
        'artifact-purpose': 'verification',
        'enforce-installer-size': true
      })
      expect(Object.keys(job.secrets!)).toEqual(Object.keys(commonSecrets))
    }
  })

  it('cannot receive or forward Apple signing credentials', () => {
    expect(workflow.on.workflow_call.secrets).toEqual(commonSecrets)
    expect(source).not.toContain('DEEPCHAT_CSC')
    expect(source).not.toContain('DEEPCHAT_APPLE')
    expect(source).not.toContain('secrets: inherit')
  })
})

describe('Release caller and publication boundary', () => {
  const workflow = readWorkflow<ReleaseWorkflow>('release.yml')
  const source = readWorkflowSource('release.yml')

  it('runs preflight before six distribution packages and keeps write access isolated', () => {
    expect(workflow.permissions).toEqual({ contents: 'read' })
    expect(workflow.concurrency).toMatchObject({ 'cancel-in-progress': false })
    expect(Object.keys(workflow.jobs)).toEqual([
      'preflight',
      'package-windows',
      'package-linux',
      'package-macos',
      'assemble',
      'publish'
    ])
    for (const [name, job] of Object.entries(workflow.jobs)) {
      expect(job.permissions).toEqual({
        contents: name === 'publish' ? 'write' : 'read'
      })
    }

    const expectedUses = {
      'package-windows': './.github/workflows/_package-windows.yml',
      'package-linux': './.github/workflows/_package-linux.yml',
      'package-macos': './.github/workflows/_package-macos.yml'
    }
    for (const [name, reusable] of Object.entries(expectedUses)) {
      const job = workflow.jobs[name]
      expect(job.needs).toBe('preflight')
      expect(job.strategy).toEqual({
        'fail-fast': false,
        matrix: { arch: ['x64', 'arm64'] }
      })
      expect(job.uses).toBe(reusable)
      expect(job.with).toEqual({
        'source-sha': '${{ needs.preflight.outputs.sha }}',
        arch: '${{ matrix.arch }}',
        'artifact-purpose': 'distribution',
        'enforce-installer-size': true
      })
    }
    expect(Object.keys(workflow.jobs['package-windows'].secrets!)).toEqual(
      Object.keys(commonSecrets)
    )
    expect(Object.keys(workflow.jobs['package-linux'].secrets!)).toEqual(
      Object.keys(commonSecrets)
    )
    expect(Object.keys(workflow.jobs['package-macos'].secrets!)).toEqual([
      ...Object.keys(commonSecrets),
      'DEEPCHAT_CSC_LINK',
      'DEEPCHAT_CSC_KEY_PASS',
      'DEEPCHAT_APPLE_NOTARY_USERNAME',
      'DEEPCHAT_APPLE_NOTARY_TEAM_ID',
      'DEEPCHAT_APPLE_NOTARY_PASSWORD'
    ])
  })

  it('downloads exactly six named package artifacts before fail-closed assembly', () => {
    const assemble = workflow.jobs.assemble
    expect(assemble.needs).toEqual([
      'preflight',
      'package-windows',
      'package-linux',
      'package-macos'
    ])
    const downloads = assemble.steps!.filter((step) =>
      step.uses?.startsWith('actions/download-artifact@')
    )
    expect(downloads.map((step) => step.with?.name)).toEqual([
      'deepchat-package-win32-x64',
      'deepchat-package-win32-arm64',
      'deepchat-package-linux-x64',
      'deepchat-package-linux-arm64',
      'deepchat-package-darwin-x64',
      'deepchat-package-darwin-arm64'
    ])
    for (const download of downloads) {
      expect(download.with).toMatchObject({ 'digest-mismatch': 'error' })
    }
    const assembly = assemble.steps!.find(
      (step) => step.name === 'Assemble fail-closed release assets'
    )
    expect(assembly?.run).toContain('scripts/ci/assemble-release.mjs')
    const upload = assemble.steps!.find(
      (step) => step.name === 'Upload verified release assets'
    )
    expect(upload?.with).toMatchObject({
      name: 'deepchat-release-assets',
      path: 'release-assets/',
      'if-no-files-found': 'error',
      'compression-level': 0,
      overwrite: true
    })
  })

  it('revalidates local and remote draft assets before reporting publication success', () => {
    const preflight = workflow.jobs.preflight.steps!.find(
      (step) => step.name === 'Resolve and validate release source'
    )
    expect(preflight?.run).toContain('refs/tags/${release_tag}^{commit}')
    expect(preflight?.run).toContain('git merge-base --is-ancestor')
    expect(preflight?.run).toContain('scripts/ci/release-preflight.mjs')

    const publishSteps = workflow.jobs.publish.steps!
    const release = publishSteps.find((step) => step.name === 'Create draft release')
    expect(release?.uses).toBe(
      'softprops/action-gh-release@3d0d9888cb7fd7b750713d6e236d1fcb99157228'
    )
    expect(release?.with).toMatchObject({
      draft: true,
      files: 'release-assets/*',
      fail_on_unmatched_files: true,
      overwrite_files: true
    })
    expect(
      publishSteps.find((step) => step.name === 'Reject unknown assets in an existing draft')
        ?.run
    ).toContain('--allow-partial-assets')
    expect(
      publishSteps.find((step) => step.name === 'Verify published draft assets')?.run
    ).toContain('scripts/ci/verify-release-assets.mjs remote')
  })

  it('pins every external action and removes tolerant legacy assembly', () => {
    for (const job of Object.values(workflow.jobs)) {
      for (const step of job.steps ?? []) {
        if (step.uses) expect(step.uses).toMatch(/^[^@]+@[0-9a-f]{40}$/)
      }
    }
    expect(source).not.toContain('secrets: inherit')
    expect(source).not.toContain('context.sha')
    expect(source).not.toContain('|| true')
    expect(source).not.toContain('ruby ')
    expect(source).not.toContain('release_assets')
    expect(source).not.toContain('.github/actions/light-ocr-package-size')
  })
})
